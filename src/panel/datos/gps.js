// ============================================================
// GPS — reglas puras del inventario, el alta y el diagnóstico
// ------------------------------------------------------------
// Sin React ni red: validar IMEI e ICCID, armar los comandos SMS del
// equipo, decir si tiene señal y medir la calidad de recepción. La pantalla
// (AdminGps*) y las pruebas usan estas mismas funciones.
// La regla de «con señal» es la de todo FOM: algo del mismo IMEI en los
// últimos 5 minutos (`transmitiendo` de sinSenal.js, igual que la app).
// ============================================================
import { tiempoSinSenal, transmitiendo } from './sinSenal.js'

/**
 * Marcas y modelos que el receptor FOM sabe leer. El modelo elige el
 * protocolo. Meitrack sólo ofrece preparación controlada: su presencia en el
 * catálogo no acredita un receptor disponible ni habilita activación.
 */
export const CATALOGO_GPS = {
  Meitrack: {
    T399L: { protocolo: 'meitrack-t399', protocoloNombre: 'Meitrack T399 (preparación controlada)', transporte: 'tcp' },
  },
  Coban: {
    'GPS-403': { protocolo: 'coban-gps103', protocoloNombre: 'Coban GPS103', transporte: 'tcp' },
  },
}

export const ESTADOS_SIM = [
  ['active', 'Activa'], ['inactive', 'Inactiva'], ['suspended', 'Suspendida'], ['unknown', 'Desconocido'],
]

/** Nombre del protocolo para mostrar: «coban-gps103» → «Coban GPS103». */
export function nombreProtocolo(clave) {
  for (const modelos of Object.values(CATALOGO_GPS)) {
    for (const m of Object.values(modelos)) if (m.protocolo === clave) return m.protocoloNombre
  }
  return clave || '—'
}

/** «Coban GPS-403»: marca y modelo, sin repetir la marca si el modelo ya la trae. */
export function nombreEquipo(g) {
  const modelo = String(g?.modelo ?? '').trim()
  const marca = String(g?.fabricante ?? '').trim()
  if (!modelo) return marca || 'Equipo GPS'
  if (!marca || modelo.toLowerCase().startsWith(marca.toLowerCase())) return modelo
  return `${marca} ${modelo}`
}

/** Puerto del receptor FOM (TCP y UDP). La IP sale de la configuración, nunca del código. */
export const PUERTO_RECEPTOR = 5001
export const IP_RECEPTOR_FALTA = '[IP del receptor]'

const soloDigitos = (v) => String(v ?? '').replace(/\D/gu, '')

/** IMEI: 15 dígitos exactos. Devuelve `{ valor, error }`, con un mensaje llano. */
export function validarImei(texto) {
  const crudo = String(texto ?? '').trim()
  if (!crudo) return { valor: '', error: 'Escribe el IMEI o elige uno de «Detectados sin registrar».' }
  if (/[^\d\s-]/u.test(crudo)) return { valor: '', error: 'El IMEI lleva solo números.' }
  const valor = soloDigitos(crudo)
  if (valor.length !== 15) return { valor, error: `El IMEI tiene 15 dígitos; este tiene ${valor.length}.` }
  return { valor, error: '' }
}

/** ICCID de la SIM: de 18 a 22 dígitos (viene impreso en la tarjeta). */
export function validarIccid(texto) {
  const crudo = String(texto ?? '').trim()
  if (!crudo) return { valor: '', error: 'Escribe el ICCID: viene impreso en la tarjeta SIM.' }
  if (/[^\d\s]/u.test(crudo)) return { valor: '', error: 'El ICCID lleva solo números.' }
  const valor = soloDigitos(crudo)
  if (valor.length < 18 || valor.length > 22) {
    return { valor, error: `El ICCID tiene de 18 a 22 dígitos; este tiene ${valor.length}.` }
  }
  return { valor, error: '' }
}

/** Número de la línea: se guarda como se escribe, pero con al menos 7 dígitos. */
export function validarTelefono(texto) {
  const valor = String(texto ?? '').trim()
  if (!valor) return { valor, error: 'Escribe el número de la línea del equipo.' }
  if (/[^\d\s+()-]/u.test(valor)) return { valor, error: 'El número lleva solo dígitos, espacios, guiones o «+».' }
  const n = soloDigitos(valor).length
  if (n < 7 || n > 15) return { valor, error: 'Ese número no parece completo: revisa los dígitos.' }
  return { valor, error: '' }
}

/** Paso 1. Errores por campo; vacío = todo bien. */
export function validarEquipo({ marca, modelo, imei, serie = '', firmware = '' } = {}) {
  const errores = {}
  if (!CATALOGO_GPS[marca]) errores.marca = 'Elige la marca del equipo.'
  else if (!CATALOGO_GPS[marca][modelo]) errores.modelo = 'Elige el modelo del equipo.'
  const i = validarImei(imei)
  if (i.error) errores.imei = i.error
  if (String(serie).trim().length > 100) errores.serie = 'El número de serie admite hasta 100 caracteres.'
  if (String(firmware).trim().length > 100) errores.firmware = 'El firmware admite hasta 100 caracteres.'
  return errores
}

/** Paso 2. Errores por campo; vacío = todo bien. */
export function validarLinea({ telefono, iccid, operador, apn, estadoSim, plan = '' } = {}) {
  const errores = {}
  const t = validarTelefono(telefono)
  if (t.error) errores.telefono = t.error
  const c = validarIccid(iccid)
  if (c.error) errores.iccid = c.error
  if (!String(operador ?? '').trim()) errores.operador = 'Escribe el operador de la línea (Movistar, Digitel…).'
  else if (String(operador).trim().length > 80) errores.operador = 'El operador admite hasta 80 caracteres.'
  if (!String(apn ?? '').trim()) errores.apn = 'Escribe el APN: lo da el operador para los datos.'
  else if (/\s/u.test(String(apn).trim())) errores.apn = 'El APN no lleva espacios.'
  else if (String(apn).trim().length > 120) errores.apn = 'El APN admite hasta 120 caracteres.'
  if (!ESTADOS_SIM.some(([v]) => v === estadoSim)) errores.estadoSim = 'Elige el estado de la SIM.'
  if (String(plan).trim().length > 120) errores.plan = 'El plan admite hasta 120 caracteres.'
  return errores
}

/** Lo que se ve en pantalla en lugar de la clave SMS: nunca la clave. */
export const PUNTOS_CLAVE = '······'

/**
 * Los cinco comandos SMS del Coban GPS-403 (los mismos de gps-web).
 * `texto` lleva la clave y es lo que se copia; `visible` la cambia por
 * puntos y es lo único que se pinta. La clave no se guarda en ningún lado.
 */
export function armarComandos({ clave = '', apn = '', ip = '', puerto = PUERTO_RECEPTOR, transporte = 'tcp' } = {}) {
  const c = String(clave).trim() || '123456'
  const udp = transporte === 'udp'
  const destino = String(ip).trim() || IP_RECEPTOR_FALTA
  const lista = [
    { titulo: 'Poner el APN', cuerpo: (k) => `APN${k} ${String(apn).trim()}`, respuesta: 'Responde: APN OK' },
    { titulo: 'Apuntar al receptor FOM', cuerpo: (k) => `adminip${k} ${destino} ${puerto}`, respuesta: 'Guarda la dirección y el puerto' },
    { titulo: udp ? 'Encender datos por UDP' : 'Encender datos por TCP', cuerpo: (k) => `GPRS${k},${udp ? '1,1' : '0,0'}`, respuesta: 'Responde: GPRS OK' },
    { titulo: 'Comprobar', cuerpo: (k) => `check${k}`, respuesta: `Debe decir GPRS ON y PORT ${puerto}` },
    { titulo: 'Pedir el IMEI (opcional)', cuerpo: (k) => `imei${k}`, respuesta: 'Si no responde, FOM lo toma de la señal' },
  ]
  return lista.map(({ titulo, cuerpo, respuesta }, i) => ({
    n: String(i + 1).padStart(2, '0'),
    titulo,
    texto: cuerpo(c),
    visible: cuerpo(PUNTOS_CLAVE),
    respuesta,
  }))
}

/** «hace 40 s» bajo el minuto; desde ahí, el mismo texto que el resto de FOM («hace 3 h»). */
export function haceCuanto(iso, ahora = Date.now()) {
  if (!iso) return 'nunca reportó'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'nunca reportó'
  const s = Math.max(0, Math.floor((ahora - t) / 1000))
  if (s < 60) return `hace ${s} s`
  return tiempoSinSenal(iso, ahora)
}

/**
 * La pastilla de señal de un equipo del inventario.
 *   con    → reportó en los últimos 5 min
 *   sin    → instalado y callado
 *   probado→ sin instalar, ya se le oyó alguna vez
 *   nunca  → jamás ha reportado
 */
export function senalDe(equipo, ahora = Date.now()) {
  const ultimo = equipo?.ultimaConexion ?? null
  if (ultimo && transmitiendo(ultimo, ahora)) {
    return { clave: 'con', tono: 'ok', texto: `Con señal · ${haceCuanto(ultimo, ahora)}` }
  }
  if (equipo?.vehiculoId) {
    return { clave: 'sin', tono: 'bad', texto: ultimo ? `Sin señal · ${haceCuanto(ultimo, ahora)}` : 'Sin señal · nunca reportó' }
  }
  if (ultimo) return { clave: 'probado', tono: 'mute', texto: `Probado · ${haceCuanto(ultimo, ahora)}` }
  return { clave: 'nunca', tono: 'mute', texto: 'Nunca ha reportado' }
}

const ESTADOS_EQUIPO = {
  active: { texto: 'Activo', tono: 'ok' },
  inventory: { texto: 'En inventario', tono: 'info' },
  inactive: { texto: 'Inactivo', tono: 'mute' },
  maintenance: { texto: 'En mantenimiento', tono: 'warn' },
  lost: { texto: 'Extraviado', tono: 'bad' },
  archived: { texto: 'Archivado', tono: 'mute' },
}

/** Estado del equipo dicho en español, con su tono de pastilla. */
export function estadoEquipo(estado) {
  return ESTADOS_EQUIPO[estado] ?? { texto: estado ? String(estado) : 'Sin estado', tono: 'mute' }
}

/** Las cuatro cifras de arriba del inventario, con la misma regla de señal. */
export function cifrasInventario(lista, ahora = Date.now()) {
  const c = { equipos: lista.length, conSenal: 0, sinSenal: 0, sinInstalar: 0 }
  for (const g of lista) {
    const s = senalDe(g, ahora).clave
    if (s === 'con') c.conSenal += 1
    if (s === 'sin') c.sinSenal += 1
    if (!g.vehiculoId && g.estado !== 'inactive' && g.estado !== 'archived') c.sinInstalar += 1
  }
  return c
}

export const FILTROS_INVENTARIO = [
  { clave: 'todos', titulo: 'Todos', pasa: () => true },
  { clave: 'con', titulo: 'Con señal', pasa: (g, ahora) => senalDe(g, ahora).clave === 'con' },
  { clave: 'sin', titulo: 'Sin señal', pasa: (g, ahora) => senalDe(g, ahora).clave === 'sin' },
  { clave: 'libres', titulo: 'Sin instalar', pasa: (g) => !g.vehiculoId && g.estado !== 'inactive' && g.estado !== 'archived' },
]

/** Busca por IMEI, línea o unidad (lo que dice el buscador). */
export function buscarEquipos(lista, q) {
  const t = String(q ?? '').trim().toLowerCase()
  if (!t) return lista
  const digitos = soloDigitos(t)
  return lista.filter((g) => {
    const textos = [g.imei, g.linea, g.vehiculoNombre, g.modelo, g.fabricante, g.carrier]
    if (textos.some((v) => String(v ?? '').toLowerCase().includes(t))) return true
    return digitos.length >= 4 && [g.imei, g.linea].some((v) => soloDigitos(v).includes(digitos))
  })
}

const LECTURAS = {
  position_valid: 'Posición válida',
  position_invalid: 'Posición sin fijar',
  heartbeat: 'Latido (sin posición)',
  malformed: 'Trama que no se entiende',
  unsupported: 'Mensaje no soportado',
  persistence_error: 'Fallo al guardar',
  archived_device: 'Equipo archivado',
}

/**
 * Lo que dice una trama, en llano. `diagnostico` es el del servidor
 * («coban-gps103 · position_valid»); `posicion`, la que salió de esa trama.
 */
export function lecturaTrama(diagnostico, posicion = null) {
  const partes = String(diagnostico ?? '').split('·').map((p) => p.trim()).filter(Boolean)
  const tipo = partes.find((p) => LECTURAS[p])
  let texto = tipo ? LECTURAS[tipo] : (partes.length ? partes.slice(1).join(' · ') || partes[0] : 'Sin leer todavía')
  if (posicion && (tipo === 'position_valid' || tipo === 'position_invalid')) {
    const v = posicion.velocidad
    if (Number.isFinite(v)) texto += ` · ${Math.round(v)} km/h`
    if (Number.isFinite(v) && v > 0 && Number.isFinite(posicion.rumbo)) texto += ` · rumbo ${Math.round(posicion.rumbo)}°`
    else if (posicion.encendido === false) texto += ' · motor apagado'
  }
  return texto
}

/** ¿La trama trae una lectura útil (posición o latido)? */
const tramaSana = (m) => !/malformed|unsupported|persistence_error|archived_device/u.test(String(m?.diagnostico ?? ''))

/** «30 s», «4 min», «2 h». */
export function intervaloTexto(segundos) {
  if (!Number.isFinite(segundos) || segundos <= 0) return '—'
  if (segundos < 90) return `${Math.round(segundos)} s`
  if (segundos < 5400) return `${Math.round(segundos / 60)} min`
  return `${Math.round(segundos / 3600)} h`
}

/**
 * Calidad de recepción sobre las tramas que haya (hasta 50), medida entre
 * ellas y no contra la hora de ahora: así dice cómo recibía ANTES del corte.
 * Puntaje de 0 a 100, a la manera de gps-web:
 *   45 · continuidad: saltos entre tramas de 90 s o menos
 *   35 · identidad: tramas con el IMEI del equipo
 *   20 · regularidad: intervalo medio ≤ 120 s (10 si ≤ 300 s)
 * Con menos de 2 tramas no hay calidad que medir: `porcentaje` es null.
 */
export function calidadRecepcion(mensajes = []) {
  const lista = mensajes.slice(0, 50)
  const tiempos = lista
    .map((m) => new Date(m.recibido).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)
  const muestras = lista.length
  const base = { muestras, porcentaje: null, etiqueta: 'Sin datos suficientes', tono: 'mute', mensajesPorHora: null, intervaloS: null, imeiCoincidePct: null }
  if (tiempos.length < 2) return base
  const saltos = tiempos.slice(0, -1).map((t, i) => (t - tiempos[i + 1]) / 1000)
  const positivos = saltos.filter((s) => s > 0)
  const intervaloS = positivos.length ? positivos.reduce((a, b) => a + b, 0) / positivos.length : 0
  const continuidad = saltos.filter((s) => s <= 90).length / saltos.length
  const coinciden = lista.filter((m) => m.imeiCoincide !== false && tramaSana(m)).length / muestras
  const regularidad = intervaloS > 0 && intervaloS <= 120 ? 20 : intervaloS > 0 && intervaloS <= 300 ? 10 : 0
  const porcentaje = Math.max(0, Math.min(100, Math.round(continuidad * 45 + coinciden * 35 + regularidad)))
  const horas = Math.max((tiempos[0] - tiempos[tiempos.length - 1]) / 3_600_000, 1 / 60)
  const [etiqueta, tono] = porcentaje >= 80 ? ['Muy buena', 'ok'] : porcentaje >= 55 ? ['Aceptable', 'warn'] : ['Deficiente', 'bad']
  return {
    muestras,
    porcentaje,
    etiqueta,
    tono,
    mensajesPorHora: Math.round(muestras / horas),
    intervaloS,
    imeiCoincidePct: Math.round(coinciden * 100),
  }
}

/** Une cada trama con la posición que salió de ella (misma hora de recepción). */
export function unirTramasConPosiciones(mensajes = [], posiciones = []) {
  const porHora = new Map()
  for (const p of posiciones) {
    const t = new Date(p.recibido).getTime()
    if (Number.isFinite(t)) porHora.set(t, p)
  }
  return mensajes.map((m) => ({ ...m, posicion: porHora.get(new Date(m.recibido).getTime()) ?? null }))
}

/** Las cuatro comprobaciones de la prueba de señal, sin inventar las que el servidor no dijo. */
export function comprobacionesPrueba({ telemetria, imei, huella = null, ahora = Date.now() } = {}) {
  const ultima = telemetria?.mensajes?.[0] ?? null
  const reciente = Boolean(ultima && (ultima.fresco ?? transmitiendo(ultima.recibido, ahora)))
  return [
    { clave: 'reciente', texto: 'Señal en los últimos 5 minutos', ok: reciente },
    { clave: 'imei', texto: 'El IMEI coincide con el registrado', ok: Boolean(ultima && (!telemetria?.imei || telemetria.imei === imei) && ultima.imeiCoincide !== false) },
    { clave: 'guardada', texto: 'Trama guardada tal como llegó', ok: Boolean(ultima) },
    { clave: 'huella', texto: 'Huella SHA-256 calculada', ok: Boolean(huella || ultima?.huella) },
  ]
}

/** «9f2c84e1…b7c041ad»: la huella completa no cabe y no hace falta. */
export function huellaCorta(sha) {
  const s = String(sha ?? '')
  return s.length > 20 ? `${s.slice(0, 8)}…${s.slice(-8)}` : s
}

/** «10,6427 N 71,6125 O». */
export function coordenadasTexto(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return ''
  const n = (v) => Math.abs(v).toFixed(4).replace('.', ',')
  return `${n(lat)} ${lat >= 0 ? 'N' : 'S'} ${n(lng)} ${lng >= 0 ? 'E' : 'O'}`
}
