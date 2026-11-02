// ============================================================
// MEITRACK T399L — reglas puras del alta y de los comandos SMS (T-211)
// ------------------------------------------------------------
// Sin React ni red. Es la copia fiel del flujo que dejó Juan en fom-core
// (apps/gps-web/app: gps-onboarding-profile.ts, meitrack-setup.ts,
// meitrack-readback.ts) y de las rutas `/api/v1/console/meitrack-setup/`
// de la rama agent/issue-727-panel-setup-api. Nada de aquí es inventado:
// si el servidor cambia un comando, se cambia primero allá.
// Diferencia con el Coban GPS-403: no hay clave de fábrica (la contraseña
// SMS de cuatro dígitos la pone quien configura), el receptor es el puerto
// 5002 por TCP, y antes de apuntar el equipo se guarda su configuración
// para poder devolverla.
// ============================================================
import { PUNTOS_CLAVE } from './gps.js'

export const MEITRACK = {
  marca: 'Meitrack',
  modelo: 'T399L',
  protocolo: 'meitrack-t399',
  firmware: 'T399L-V254',
  puerto: 5002,
  transporte: 'tcp',
}

export const AVISO_RUTA_AUSENTE = 'El registro de Meitrack todavía no está en el servidor publicado.'

export const esMeitrack = (marca, modelo) => marca === MEITRACK.marca && modelo === MEITRACK.modelo

/** Contraseña SMS del equipo: cuatro dígitos. No hay clave de fábrica que suponer. */
export function validarClaveMeitrack(texto) {
  const valor = String(texto ?? '').trim()
  if (!valor) return { valor, error: 'Escribe la contraseña SMS actual del equipo (4 dígitos).' }
  if (!/^\d{4}$/u.test(valor)) return { valor, error: 'La contraseña SMS son 4 números.' }
  return { valor, error: '' }
}

/** APN que acepta el comando de conexión: letras, números, puntos y guiones. */
export function validarApnMeitrack(texto) {
  const valor = String(texto ?? '').trim()
  if (!valor) return { valor, error: 'Escribe el APN de la línea: lo da el operador.' }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,99}$/u.test(valor)) {
    return { valor, error: 'El APN lleva solo letras, números, puntos y guiones, sin espacios.' }
  }
  return { valor, error: '' }
}

const ipv4 = (v) => /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/u.test(v) && v.split('.').every((p) => Number(p) <= 255)
const puertoValido = (v) => /^[1-9]\d{0,4}$/u.test(v) && Number(v) <= 65535

/** ¿La dirección del receptor sirve para el comando? Tiene que ser una IP, no un nombre. */
export const receptorValido = (ip) => ipv4(String(ip ?? '').trim())

/**
 * Códigos que responde E04 («A00,DB4,DA6,E91»): tres caracteres hexadecimales separados por comas.
 * Devuelve la lista, `[]` si está vacío o `null` si no tiene ese formato (pegaron otra cosa).
 */
export function listaComandos(texto) {
  const crudo = String(texto ?? '')
  if (crudo.length > 2048) return null
  if (crudo.trim() === '') return []
  const lista = crudo.split(',').map((c) => c.trim().toUpperCase())
  if (lista.length > 256 || lista.some((c) => !/^[A-F0-9]{3}$/u.test(c))) return null
  return [...new Set(lista)]
}

/** Consulta de solo lectura. DB4 solo se pide si el equipo la anunció en E04. */
export function consultaMeitrack(clave, comando, anunciados = []) {
  if (!/^\d{4}$/u.test(String(clave ?? '')) || !['E91', 'E04', 'DB4', 'DA6'].includes(comando)) return null
  if (['DB4', 'DA6'].includes(comando) && !anunciados.includes(comando)) return null
  return `${clave},${comando}`
}

/**
 * Respuesta de DB4 pegada: 20 celdas separadas por coma, la primera es el IMEI.
 * `tipo` es la conexión que debe decir: CLOSE antes de configurar, TCP después.
 * Devuelve `{ celdas }` o `null`.
 */
export function lecturaDb4(texto, imei, tipo = 'CLOSE') {
  const crudo = String(texto ?? '')
  if (crudo.length > 1024 || !/^\d{15}$/u.test(String(imei ?? ''))) return null
  const limpio = crudo.trim()
  if (/[\u0000-\u001f\u007f]/u.test(limpio)) return null
  const c = limpio.split(',')
  if (c.length !== 20 || c[0] !== imei || c[1] !== 'DB4' || c[2] !== tipo) return null
  if (!c[3].startsWith('IP1:') || !ipv4(c[3].slice(4)) || !c[4].startsWith('PORT1:') || !puertoValido(c[4].slice(6))) return null
  if (!c[5].startsWith('IP2:') || !c[6].startsWith('PORT2:') || c[19] !== '') return null
  const ip2 = c[5].slice(4)
  const puerto2 = c[6].slice(6)
  if ((ip2 === '') !== (puerto2 === '') || (ip2 !== '' && (!ipv4(ip2) || !puertoValido(puerto2)))) return null
  if (!/^[a-zA-Z0-9.-]{0,100}$/u.test(c[8])) return null
  if ([7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].some((i) => !/^[0-9]{1,20}$/u.test(c[i]))) return null
  return { celdas: c }
}

/**
 * SMS que devuelve el equipo a como estaba (destino y APN de la primera lectura, GPRS apagado).
 * Solo sale si la lectura es buena y la persona confirmó que el APN no lleva usuario ni clave.
 */
export function smsRestauracion(clave, base, imei, sinUsuarioNiClave) {
  if (!/^\d{4}$/u.test(String(clave ?? '')) || !sinUsuarioNiClave || !base || !lecturaDb4(base.celdas.join(','), imei)) return null
  return `${clave},A21,0,${base.celdas[3].slice(4)},${base.celdas[4].slice(6)},${base.celdas[8]},,`
}

/** SMS que apunta el equipo al receptor FOM por TCP. */
export function smsConexion({ clave, ip, puerto = MEITRACK.puerto, apn }) {
  if (!/^\d{4}$/u.test(String(clave ?? '')) || !ipv4(String(ip ?? '').trim()) || validarApnMeitrack(apn).error) return null
  return `${clave},A21,1,${String(ip).trim()},${puerto},${String(apn).trim()},,`
}

/** ¿El DB4 de después dice lo previsto? TCP, el destino y el APN nuevos; todo lo demás igual a la primera lectura. */
export function db4Configurado(texto, base, imei, apn, destino) {
  const actual = lecturaDb4(texto, imei, 'TCP')
  if (!actual || !base || !destino) return false
  const esperado = [...base.celdas]
  esperado[2] = 'TCP'
  esperado[3] = `IP1:${destino.ip}`
  esperado[4] = `PORT1:${destino.puerto}`
  esperado[8] = String(apn).trim()
  return actual.celdas.every((celda, i) => celda === esperado[i])
}

/**
 * La ventana de recepción que el servidor tiene abierta para este equipo, usable si le quedan más de
 * 90 s y la lectura es reciente (`transcurrido` = ms desde que llegó la respuesta).
 */
export function ventanaUsable(setup, transcurrido) {
  const w = setup?.window
  if (!setup?.ready || !w || !Number.isFinite(transcurrido) || transcurrido < 0 || transcurrido >= 15_000) return false
  if (w.firmware !== MEITRACK.firmware || w.destination?.port !== MEITRACK.puerto || w.destination?.transport !== MEITRACK.transporte) return false
  return Date.parse(w.expiresAt) - Date.parse(setup.serverNow) - transcurrido > 90_000
}

/**
 * Los comandos del paso 2, en orden, con su motivo de bloqueo (`falta`) si todavía no se pueden copiar.
 * `texto` lleva la contraseña y es lo que se copia; `visible` la cambia por puntos.
 */
export function armarComandosMeitrack({ clave, anunciados, base, sinUsuarioNiClave, restauracionGuardada, apn, ip, ventana }) {
  const claveOk = !validarClaveMeitrack(clave).error
  const fila = (n, titulo, hacer, respuesta, falta) => {
    const bloqueado = falta || (!claveOk ? 'Escribe la contraseña SMS del equipo.' : '')
    return {
      n, titulo, respuesta,
      texto: bloqueado ? null : hacer(clave),
      visible: bloqueado ? null : hacer(PUNTOS_CLAVE),
      falta: bloqueado,
    }
  }
  const sinDb4 = anunciados.includes('DB4') ? '' : 'Antes pega la lista que respondió E04: debe incluir DB4.'
  const restauracion = smsRestauracion(clave, base, base ? base.celdas[0] : '', sinUsuarioNiClave)
  const conexion = smsConexion({ clave, ip, apn })
  let faltaConexion = ''
  if (!restauracion) faltaConexion = 'Antes se necesita la restauración (pasos 3 y 4).'
  else if (!restauracionGuardada) faltaConexion = 'Confirma que conservaste el mensaje de restauración.'
  else if (!anunciados.includes('A21')) faltaConexion = 'El equipo debe anunciar A21 en E04.'
  else if (validarApnMeitrack(apn).error) faltaConexion = 'Falta un APN válido en el paso 1.'
  else if (!receptorValido(ip)) faltaConexion = 'Falta la IP del receptor en la configuración del sitio.'
  else if (!ventana) faltaConexion = 'La ventana de recepción de FOM todavía no está abierta para este equipo.'
  return [
    fila('01', 'Consultar el firmware', (k) => `${k},E91`, 'Debe decir T399L-V254. La respuesta trae el IMEI y la serie: no la compartas.'),
    fila('02', 'Consultar los comandos disponibles', (k) => `${k},E04`, 'Copia abajo solo los códigos que siguen a E04, sin el IMEI.'),
    fila('03', 'Leer la configuración actual', (k) => `${k},DB4`, 'Guarda la respuesta original: es lo que permite devolver el equipo a como estaba.', sinDb4),
    fila('04', 'Guardar la restauración', (k) => (restauracion ? restauracion.replace(/^\d{4}/u, k) : ''), 'Vuelve al destino y APN de la lectura inicial. Conserva este mensaje en tu teléfono.',
      restauracion ? '' : 'Pega la respuesta de DB4 y confirma el APN sin usuario ni clave.'),
    fila('05', 'Apuntar al receptor FOM', (k) => (conexion ? conexion.replace(/^\d{4}/u, k) : ''), `Manda el equipo al receptor por TCP, puerto ${MEITRACK.puerto}. Espera el OK del equipo.`, faltaConexion),
    fila('06', 'Comprobar la configuración', (k) => `${k},DB4`, 'Debe decir TCP, la IP del receptor y PORT1:5002. Pega la respuesta abajo.', sinDb4),
  ]
}

/** Resumen de la consulta de recepción: sin ventana, esperando o recibida. */
export function resumenRecepcion(respuesta) {
  const c = respuesta?.capture
  if (!c || !c.windowAvailable) return { estado: 'sin-ventana', mensajes: [], ultima: null }
  const mensajes = Array.isArray(c.messages) ? c.messages : []
  if (!c.received || mensajes.length === 0) return { estado: 'esperando', mensajes: [], ultima: null }
  return { estado: 'recibida', mensajes, ultima: mensajes[0] }
}

/** Los datos del alta tal como los pide `register`: solo inventario, sin vehículo ni instalación. */
export function cuerpoAltaMeitrack({ imei, telefono, iccid, operador, apn, serie, plan }) {
  const quitarVacios = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''))
  return quitarVacios({
    imei: String(imei).replace(/\D/gu, ''),
    simPhone: String(telefono ?? '').trim(),
    iccid: String(iccid ?? '').replace(/\D/gu, ''),
    carrier: String(operador ?? '').trim(),
    apn: String(apn ?? '').trim(),
    simStatus: 'active',
    simPlan: String(plan ?? '').trim() || undefined,
    manufacturer: MEITRACK.marca,
    model: MEITRACK.modelo,
    protocolFamily: MEITRACK.protocolo,
    serialNumber: String(serie ?? '').trim() || undefined,
    firmwareVersion: MEITRACK.firmware,
    transport: MEITRACK.transporte,
  })
}

/** Una ruta que el servidor publicado todavía no tiene (la rama no se ha desplegado). */
export function rutaAusente(error) {
  if (!error) return false
  if ([404, 405, 501].includes(error.estado)) return true
  return /todavía no está en el servidor publicado|Cannot (GET|POST) /iu.test(String(error.message ?? ''))
}

/** Mensaje en español llano para un fallo de las rutas de Meitrack. */
export function mensajeMeitrack(error) {
  if (rutaAusente(error)) return AVISO_RUTA_AUSENTE
  const texto = String(error?.message ?? '')
  if (/Matching TEST capture required/iu.test(texto)) {
    return 'Todavía no llegó la señal de prueba de este equipo. Espera a que llegue y vuelve a intentarlo.'
  }
  if (/independently confirmed absent/iu.test(texto)) {
    return 'Este equipo ya figura en el inventario, o no se pudo confirmar que no exista. Búscalo en el inventario antes de volver a intentarlo.'
  }
  if (/Only Meitrack T399L/iu.test(texto)) {
    return 'El servidor solo registra aquí el Meitrack T399L con firmware T399L-V254 en el puerto 5002. Revisa los datos del equipo.'
  }
  if (error?.estado === 409) return 'El servidor no aceptó el registro porque ya existe un equipo con esos datos. Búscalo en el inventario.'
  if (error?.estado === 400) return 'El servidor no aceptó los datos del equipo. Revisa el IMEI, el ICCID y la línea SIM.'
  return texto || 'No se pudo completar. Inténtalo de nuevo.'
}
