// ============================================================
// CLIENTE DE LA API REAL DE FOM
// ------------------------------------------------------------
// Habla con `fom-core` a través del puente del servidor de desarrollo
// (ver el proxy `/fom-api` en vite.config.js). Aquí NO hay secretos: el
// token interno lo añade el proxy del lado del servidor. Este archivo se
// compila al bundle y cualquiera puede leerlo — que no aparezca nada
// sensible es intencional.
//
// Si `VITE_FOM_API` está vacío, `HAY_API` es false y el panel trabaja con la
// semilla local. Así el sitio nunca depende de que el túnel esté arriba.
// ============================================================
import { aRutaPorEnte, SIN_RUTA_POR_ENTE } from './rutaPorEnte'
import { placasEnRespuesta } from './placas'

const BASE = (import.meta.env?.VITE_FOM_API || '').replace(/\/+$/, '')

/** ¿El panel debe hablar con la API real? */
export const HAY_API = Boolean(BASE)

/** Mensaje en español para cada fallo, listo para mostrar en pantalla. */
// Mensajes del servidor que llegan en inglés, dichos en español.
const MENSAJES = [
  [/Progress only applies while in progress/i, 'El avance solo se registra mientras el servicio está en curso.'],
  [/requires the FOM administrator/i, 'Esta acción es solo del administrador FOM.'],
  [/expected status|status has changed|stale/i, 'Alguien más cambió esto mientras lo mirabas. Recarga y vuelve a intentarlo.'],
  [/not found/i, 'Ese elemento ya no existe.'],
  [/already exists|duplicate/i, 'Ya existe uno igual.'],
]
function enEspanol(texto) {
  if (typeof texto !== 'string') return texto
  return MENSAJES.find(([patron]) => patron.test(texto))?.[1] ?? texto
}

function traducir(estado, cuerpo) {
  const detalle = enEspanol(typeof cuerpo === 'string' ? cuerpo : cuerpo?.message || cuerpo?.error)
  if (estado === 0) {
    return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'
  }
  if (estado === 429) return 'Se alcanzó el límite de consultas. Espera un momento y vuelve a intentarlo.'
  if (estado === 401) return 'Tu sesión no es válida o expiró. Vuelve a entrar.'
  if (estado === 403) {
    if (String(detalle || '').includes('Initial password change pending')) {
      return 'Debes cambiar la contraseña temporal antes de usar la consola.'
    }
    return 'Tu sesión no tiene permiso para esta operación. Revisa el rol y la empresa asignada a tu cuenta.'
  }
  if (estado === 404) {
    // Nest responde «Cannot POST /ruta» cuando la RUTA no existe, y un 404
    // propio cuando el REGISTRO no existe. Son cosas distintas y el que las
    // lee necesita distinguirlas: una se arregla desplegando, la otra
    // buscando otro registro.
    if (/^Cannot (GET|POST|PATCH|PUT|DELETE) /u.test(String(detalle || ''))) {
      return (
        'Esta función todavía no está en el servidor publicado. Ya está ' +
        'construida y espera el despliegue.'
      )
    }
    return 'Ese recurso no existe en el servidor.'
  }
  if (estado === 502) return 'El servicio no está disponible en este momento. Inténtalo de nuevo en unos minutos.'
  if (estado === 503) return detalle || 'El servidor no está listo para responder esto todavía.'
  return detalle || `El servidor respondió ${estado}.`
}

/**
 * Petición a la API. Devuelve el cuerpo ya interpretado, o lanza un Error con
 * el mensaje traducido.
 */
/**
 * Clave de idempotencia: un UUID v4 nuevo por intento. Desde la publicación
 * del 18 de septiembre de 2026, el servidor exige la cabecera
 * `Idempotency-Key` en algunas escrituras (abrir una ODT, entre otras) y
 * responde 400 «Idempotency-Key must be a UUID v4» si falta. Si la misma
 * petición se repite con la misma clave, el servidor devuelve el recibo de la
 * primera en vez de crear dos veces.
 */
export function claveIdempotente() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  // Respaldo para entornos sin `crypto.randomUUID`: mismo formato v4, con los
  // bits de versión y variante fijados.
  const h = () => Math.floor(Math.random() * 16).toString(16)
  const s = (n) => Array.from({ length: n }, h).join('')
  const variante = '89ab'[Math.floor(Math.random() * 4)]
  return `${s(8)}-${s(4)}-4${s(3)}-${variante}${s(3)}-${s(12)}`
}

const lecturasEnCurso = new Map()
// Cuántas escrituras salieron desde que se abrió la página. Lo que se guarda un
// rato en memoria (las asignaciones de conductores) se da por viejo en cuanto
// cambia: tras asignar o quitar a alguien, la siguiente lectura sale de verdad.
let escrituras = 0
export function escriturasHechas() { return escrituras }
let empresaGestionId = null
export function empresaGestionActualId() { return empresaGestionId }
export function fijarEmpresaGestion(id) {
  empresaGestionId = id || null
  lecturasEnCurso.clear()
}
export function pedir(ruta, opciones = {}) {
  if ((opciones.metodo || 'GET') !== 'GET' || opciones.señal) return pedirUnaVez(ruta, opciones)
  const clave = `${empresaGestionId || ''}:${ruta}`
  if (lecturasEnCurso.has(clave)) return lecturasEnCurso.get(clave)
  const peticion = pedirUnaVez(ruta, opciones).finally(() => lecturasEnCurso.delete(clave))
  lecturasEnCurso.set(clave, peticion)
  return peticion
}

async function pedirUnaVez(rutaPedida, { metodo = 'GET', cuerpo, señal, idempotente = false, idempotencia, empresaContexto = empresaGestionId } = {}) {
  if (!HAY_API) throw new Error('La API real no está configurada en este entorno.')

  // Dentro de una empresa ajena la empresa viaja en la ruta (Issue 567); lo que aún no tiene
  // ruta así no sale: devolvería los datos de la empresa del administrador como si fueran de otra.
  const ruta = aRutaPorEnte(rutaPedida, metodo, empresaContexto)
  if (ruta === null) {
    const error = new Error(SIN_RUTA_POR_ENTE)
    error.estado = 501
    throw error
  }

  // Tope de tiempo. Sin esto, una petición que el servidor nunca contesta
  // deja la pantalla en «cargando» para siempre, y como `pedir` reutiliza la
  // lectura en curso, todo intento posterior de esa misma ruta hereda el
  // cuelgue. Las lecturas esperan 25 s; las escrituras, 60 s.
  const mutacionTope = !['GET', 'HEAD', 'OPTIONS'].includes(metodo.toUpperCase())
  const control = new AbortController()
  const tope = setTimeout(() => control.abort('tope'), mutacionTope ? 60_000 : 25_000)
  if (señal) señal.addEventListener('abort', () => control.abort(), { once: true })

  let respuesta
  try {
    const mutacion = !['GET', 'HEAD', 'OPTIONS'].includes(metodo.toUpperCase())
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: {
            ...(mutacion ? {
            'content-type': 'application/json',
            'x-fom-csrf': 'fom-browser-v1',
            ...(idempotente ? { 'idempotency-key': idempotencia || claveIdempotente() } : {}),
          } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: control.signal,
      // En desarrollo la guarda el proxy; publicada, la cookie HttpOnly viaja
      // solo al mismo origen. Nunca se habilitan credenciales cross-origin.
      credentials: 'same-origin',
      // Se cuenta al terminar (bien o mal): una lectura que salió durante la
      // escritura no debe quedar guardada como si ya la reflejara.
    }).finally(() => { if (mutacionTope) escrituras += 1 })
  } catch (error) {
    clearTimeout(tope)
    if (control.signal.reason === 'tope') {
      throw new Error('El servidor tardó demasiado en responder. Revisa la conexión e inténtalo de nuevo.')
    }
    if (error.name === 'AbortError') throw error
    throw new Error(traducir(0))
  }

  clearTimeout(tope)
  const texto = await respuesta.text()
  let datos = null
  if (texto) {
    try {
      datos = JSON.parse(texto)
    } catch {
      datos = texto
    }
  }

  if (!respuesta.ok) {
    // El estado viaja pegado al error: un 401 en el LOGIN significa «clave
    // incorrecta», y el mismo 401 en cualquier otra ruta significa «sesion
    // caida». Sin el numero, quien llama no puede distinguirlos y termina
    // diciendo «tu sesion expiro» a alguien que nunca llego a entrar.
    const error = new Error(traducir(respuesta.status, datos))
    error.estado = respuesta.status
    // El código de FOM (`invalid_driver_pin`…): dice QUÉ falló cuando el
    // estado solo no basta, como `ErrorFom.code` de la app.
    error.codigo = typeof datos?.code === 'string' ? datos.code : null
    throw error
  }
  return placasEnRespuesta(datos)
}

// --- Rutas concretas -------------------------------------------------------

/**
 * Superficie propia de la consola, aprobada en el Issue #173 (opción B).
 *
 * Se autentica SOLO con la sesión en cookie. La superficie vieja
 * —`gps-console-internal`— exige además un token interno que un sitio en el
 * navegador no puede custodiar, y por eso no se puede publicar: funcionaba en
 * local únicamente porque el puente de `vite.config.js` guardaba el token del
 * lado del servidor.
 */
const CONSOLA = '/api/v1/console'

/** La superficie interna. Queda solo para lo que aún no tiene equivalente. */
const INTERNA = '/gps-console-internal/api'

export const api = {
  contextoEmpresa: (id) => pedirUnaVez(`${CONSOLA}/tenants/${encodeURIComponent(id)}/company-context`, { empresaContexto: null }),
  // Acceso por la superficie de consola. No usa `/auth/*`: ese controlador
  // exige el token interno y FOM-TEST no lo tiene configurado, así que
  // responde 503. Estas tres sí funcionan solo con la sesión, igual que el
  // acceso de la app móvil.
  entrar: (email, password) =>
    pedir(`${CONSOLA}/auth/login`, { metodo: 'POST', cuerpo: { email, password } }),
  sesion: () => pedir(`${CONSOLA}/auth/session`),
  salir: () => pedir(`${CONSOLA}/auth/logout`, { metodo: 'POST' }),
  cambiarClaveInicial: (currentPassword, newPassword) =>
    pedir(`${CONSOLA}/auth/password`, {
      metodo: 'POST',
      cuerpo: { currentPassword, newPassword },
    }),

  // Directorio real del ente resuelto por la sesión. El navegador nunca
  // declara tenantId: fom-core lo obtiene del actor autenticado.
  usuarios: ({ limite = 100, desplazamiento = 0, q = '' } = {}) => {
    const p = new URLSearchParams({ limit: limite, offset: desplazamiento })
    if (q) p.set('q', q)
    return pedir(`${CONSOLA}/users?${p}`)
  },
  crearUsuario: ({ email, displayName, role, temporaryPassword, tenantId }) =>
    pedir(`${CONSOLA}${tenantId ? `/tenants/${encodeURIComponent(tenantId)}` : ''}/users`, {
      metodo: 'POST',
      cuerpo: { email, displayName, role, temporaryPassword },
    }),

  /**
   * Levantar una orden de trabajo desde el panel (#258 de fom-core).
   *
   * `vehicleId` viaja en el cuerpo y no en la ruta porque el supervisor abre
   * la orden eligiendo la unidad en un desplegable, no navegando a ella.
   */
  crearOdt: ({ vehicleId, description, kind, severity, failureType, location, maintenanceActionId, alertEventId }) =>
    pedir(`${CONSOLA}/work-orders`, {
      metodo: 'POST',
      cuerpo: { vehicleId, description, kind, severity, failureType, location, maintenanceActionId, alertEventId },
      idempotente: true,
    }),

  /**
   * El CONDUCTOR reporta una falla de SU unidad. Ruta de consola propia del conductor (decidida en el #631):
   * valida la asignación vigente y crea una orden correctiva abierta que el supervisor ve en su lista.
   */
  reportarFallaConductor: (vehicleId, { description, severity, failureType, location }) =>
    pedir(`${CONSOLA}/vehicles/${encodeURIComponent(vehicleId)}/work-orders`, {
      metodo: 'POST',
      cuerpo: { description, severity, failureType, location },
      idempotente: true,
    }),

  // --- Escrituras del directorio (#219 de fom-core) ------------------------

  /** Cambiar perfil o estado de una persona en el ente. */
  actualizarMiembro: (userId, { role, status, reason, tenantId }) =>
    pedir(`${CONSOLA}${tenantId ? `/tenants/${encodeURIComponent(tenantId)}` : ''}/users/${encodeURIComponent(userId)}`, {
      metodo: 'PATCH',
      cuerpo: { role, status, reason },
    }),

  /**
   * Reiniciar la credencial: nace obligada a cambiarse. `empresaId` (T-210): sin dato, la ruta
   * normal; un id, `/tenants/{id}/users/…` (la ruta sin empresa solo halla gente de la empresa
   * propia y da 404 con la de otra); `null`, la ruta propia aunque se esté dentro de otra empresa.
   */
  reiniciarClave: (userId, { temporaryPassword, reason }, empresaId) =>
    pedir(`${CONSOLA}/users/${encodeURIComponent(userId)}/credential-reset`, {
      metodo: 'POST',
      cuerpo: { temporaryPassword, reason },
      ...(empresaId === undefined ? {} : { empresaContexto: empresaId || null }),
    }),

  /**
   * Alta de vehiculo. `empresaId` (T-215): sin dato, la ruta normal (la de la empresa en gestión,
   * si hay); un id, la ruta `/tenants/{id}` de esa empresa, sin entrar a ella; `null`, la ruta propia.
   */
  crearVehiculo: (cuerpo, empresaId) =>
    pedir(`${CONSOLA}/vehicles`, {
      metodo: 'POST',
      cuerpo,
      ...(empresaId === undefined ? {} : { empresaContexto: empresaId || null }),
    }),

  /** Editar el vehiculo, incluida su area. */
  actualizarVehiculo: (vehicleId, cuerpo) =>
    pedir(`${CONSOLA}/vehicles/${vehicleId}`, { metodo: 'PATCH', cuerpo }),

  /** Licencia o aptitud médica: reemplazo versionado, espejo por empresa y recibo idempotente (#643). */
  actualizarCredencialPersona: (userId, cuerpo, idempotencia) =>
    pedir(`${CONSOLA}/users/${encodeURIComponent(userId)}/credentials`, { metodo: 'PATCH', cuerpo, idempotente: true, idempotencia }),

  /** Asignar conductor a una unidad. */
  asignarConductor: (vehicleId, { userId, role, pin }) =>
    pedir(`${CONSOLA}/vehicles/${vehicleId}/drivers`, {
      metodo: 'POST',
      cuerpo: { userId, role, pin },
    }),

  /** Revocar una asignacion. No se borra: se cierra con fecha. */
  revocarAsignacion: (assignmentId, { reason } = {}) =>
    pedir(`${CONSOLA}/driver-assignments/${assignmentId}/revoke`, {
      metodo: 'PATCH',
      cuerpo: { reason },
    }),

  // --- Ordenes de trabajo --------------------------------------------------

  /** Mover una orden de estado. `expectedStatus` evita pisar a otro. */
  moverOdt: (odtId, cuerpo) =>
    pedir(`${CONSOLA}/work-orders/${odtId}/status`, {
      metodo: 'PATCH',
      cuerpo,
    }),

  // --- Entes: empresas, contratistas y areas (#250 de fom-core) ------------

  entes: ({ limite = 100, desplazamiento = 0 } = {}) => {
    const p = new URLSearchParams({ limit: limite, offset: desplazamiento })
    return pedir(`${CONSOLA}/tenants?${p}`)
  },
  crearEnte: (cuerpo) => pedir(`${CONSOLA}/tenants`, { metodo: 'POST', cuerpo }),
  actualizarEnte: (tenantId, cuerpo) =>
    pedir(`${CONSOLA}/tenants/${tenantId}`, { metodo: 'PATCH', cuerpo }),
  colgarContratista: (tenantId, cuerpo) =>
    pedir(`${CONSOLA}/tenants/${tenantId}/contractors`, {
      metodo: 'POST',
      cuerpo,
    }),
  descolgarContratista: (relationshipId, cuerpo = {}) =>
    pedir(`${CONSOLA}/tenant-relationships/${relationshipId}/end`, {
      metodo: 'PATCH',
      cuerpo,
    }),
  crearArea: (tenantId, cuerpo) =>
    pedir(`${CONSOLA}/tenants/${tenantId}/areas`, { metodo: 'POST', cuerpo }),
  actualizarArea: (areaId, cuerpo) =>
    pedir(`${CONSOLA}/areas/${areaId}`, { metodo: 'PATCH', cuerpo }),

  // --- Score de manejo (#634 de fom-core, política driving-v1) --------------
  /** Mi score (solo el conductor en sesión). `me/` no tiene versión por empresa. */
  miScoreManejo: (days = 7) => pedir(`${CONSOLA}/me/driving-score?days=${days}`),
  /** Score de todos los conductores de la empresa (supervisor / administrador). */
  scoresManejo: (days = 7) => pedir(`${CONSOLA}/driving-scores?days=${days}`),
  /** Mis eventos de manejo (solo el conductor en sesión). days: 7 | 30 | 90; limit hasta 100. */
  misEventosManejo: (days = 7, limit = 50) => pedir(`${CONSOLA}/me/driving-events?days=${days}&limit=${limit}`),
  /** Eventos de manejo de un conductor, del más nuevo al más viejo (supervisor / administrador). */
  eventosManejoDe: (userId, days = 7, limit = 50) =>
    pedir(`${CONSOLA}/drivers/${encodeURIComponent(userId)}/driving-events?days=${days}&limit=${limit}`),
  /** Resumen por día de una unidad (kilómetros, posiciones, velocidad máxima), calculado por el servidor. Fechas AAAA-MM-DD. */
  metricasDiarias: (vehicleId, desde, hasta) =>
    pedir(`${CONSOLA}/vehicles/${encodeURIComponent(vehicleId)}/daily-metrics?from=${desde}&to=${hasta}`),
  /** Registra a mano la lectura del odómetro de una unidad (lo que marca el tablero hoy). */
  registrarOdometro: (vehicleId, { odometerKm, observedAt }) =>
    pedir(`${CONSOLA}/vehicles/${encodeURIComponent(vehicleId)}/odometer`, { metodo: 'POST', cuerpo: { odometerKm, observedAt }, idempotente: true }),
  /** Lecturas oficiales del odómetro de una unidad (la más reciente primero). */
  odometroOficial: (vehicleId, limit = 1) => pedir(`${CONSOLA}/vehicles/${encodeURIComponent(vehicleId)}/odometer?limit=${limit}`),

  // --- Cumplimiento y avisos (#260 de fom-core) ---------------------------

  marcarAvisoLeido: (avisoId) =>
    pedir(`${CONSOLA}/notifications/${avisoId}/read`, { metodo: 'PATCH', cuerpo: {} }),
  marcarTodosLosAvisos: () =>
    pedir(`${CONSOLA}/notifications/read-all`, { metodo: 'POST', cuerpo: {} }),
  descartarAviso: (avisoId) =>
    pedir(`${CONSOLA}/notifications/${avisoId}/dismiss`, { metodo: 'PATCH', cuerpo: {} }),
  descartarAvisosLeidos: () =>
    pedir(`${CONSOLA}/notifications/dismiss-read`, { metodo: 'POST', cuerpo: {} }),

  crearDocumento: (cuerpo) =>
    pedir(`${CONSOLA}/documents`, { metodo: 'POST', cuerpo }),
  actualizarDocumento: (documentoId, cuerpo) =>
    pedir(`${CONSOLA}/documents/${documentoId}`, { metodo: 'PATCH', cuerpo }),

  crearRegla: (cuerpo) =>
    pedir(`${CONSOLA}/alert-rules`, { metodo: 'POST', cuerpo }),
  actualizarRegla: (reglaId, cuerpo) =>
    pedir(`${CONSOLA}/alert-rules/${reglaId}`, { metodo: 'PATCH', cuerpo }),

  registrarEquipoGps: (cuerpo) =>
    pedir(`${CONSOLA}/gps-devices`, { metodo: 'POST', cuerpo }),
  // Alta del Meitrack T399L (T-211). El POST de siempre lo rechaza; estas rutas son de la rama
  // agent/issue-727-panel-setup-api de fom-core y pueden no estar publicadas todavía (404 «Cannot POST»).
  // Son del administrador FOM y de la ventana de pruebas: van siempre por la ruta propia, nunca por
  // la de otra empresa (`empresaContexto: null`).
  meitrackVentana: (cuerpo) =>
    pedir(`${CONSOLA}/meitrack-setup/readiness`, { metodo: 'POST', cuerpo, empresaContexto: null }),
  meitrackRecepcion: (cuerpo) =>
    pedir(`${CONSOLA}/meitrack-setup/capture`, { metodo: 'POST', cuerpo, empresaContexto: null }),
  meitrackAlta: (cuerpo) =>
    pedir(`${CONSOLA}/meitrack-setup/registration`, { metodo: 'POST', cuerpo, empresaContexto: null }),
  meitrackRegistrar: (cuerpo) =>
    pedir(`${CONSOLA}/meitrack-setup/register`, { metodo: 'POST', cuerpo, empresaContexto: null }),
  actualizarEquipoGps: (equipoId, cuerpo) =>
    pedir(`${CONSOLA}/gps-devices/${equipoId}`, { metodo: 'PATCH', cuerpo }),
  // `empresaId`: sin dato, la ruta normal (la de la empresa en gestión, si hay); un id, la ruta
  // `/tenants/{id}` de esa empresa; `null`, la ruta propia aunque se esté dentro de otra empresa.
  instalarEquipoGps: (equipoId, cuerpo, empresaId) =>
    pedir(`${CONSOLA}/gps-devices/${equipoId}/installation`, {
      metodo: 'POST',
      cuerpo,
      ...(empresaId === undefined ? {} : { empresaContexto: empresaId || null }),
    }),
  // Lecturas del equipo (T-95). El id va en la ruta; el IMEI y el ICCID nunca.
  equipoGps: (equipoId) => pedir(`${CONSOLA}/gps-devices/${equipoId}`),
  telemetriaGps: (equipoId, limite = 50) =>
    pedir(`${CONSOLA}/gps-devices/${equipoId}/telemetry?limit=${limite}`),
  ultimaPosicionGps: (equipoId) => pedir(`${CONSOLA}/gps-devices/${equipoId}/position/latest`),
  posicionesGps: (equipoId, limite = 50) =>
    pedir(`${CONSOLA}/gps-devices/${equipoId}/positions?limit=${limite}`),
  capacidadesGps: (equipoId) => pedir(`${CONSOLA}/gps-devices/${equipoId}/capabilities`),
  // Prueba de señal: abre (o retoma) la sesión y la cierra aprobada o fallida.
  iniciarPruebaGps: (equipoId) =>
    pedir(`${CONSOLA}/gps-devices/${equipoId}/commissioning`, { metodo: 'POST', cuerpo: {} }),
  completarPruebaGps: (sesionId, cuerpo) =>
    pedir(`${CONSOLA}/gps-commissioning/${sesionId}/complete`, { metodo: 'POST', cuerpo }),
  desmontarEquipoGps: (instalacionId, cuerpo = {}) =>
    pedir(`${CONSOLA}/gps-installations/${instalacionId}/remove`, {
      metodo: 'PATCH',
      cuerpo,
    }),

  // --- La persona completa (#260 de fom-core) ------------------------------

  /**
   * La gente del ente: cuenta, datos personales, la unidad que maneja hoy y
   * el documento que le vence antes, todo en una sola lectura.
   *
   * Con `enteId` se lee un CONTRATISTA, y el ente viaja en la ruta y no en la
   * consulta a propósito: lo que autoriza sale de la sesión, y esto solo
   * elige a cuál de los entes permitidos mirar.
   */
  directorio: ({ limite = 200, desplazamiento = 0, q = '', enteId = '' } = {}) => {
    const p = new URLSearchParams({ limit: limite, offset: desplazamiento })
    if (q) p.set('q', q)
    const ruta = enteId ? `${CONSOLA}/tenants/${enteId}/directory` : `${CONSOLA}/directory`
    return pedir(`${ruta}?${p}`)
  },

  actualizarPerfil: (userId, cuerpo) =>
    pedir(`${CONSOLA}/users/${userId}/profile`, { metodo: 'PATCH', cuerpo }),

  // Estado del backend
  salud: () => pedir('/health'),
  version: () => pedir('/version'),

  // --- Flota, por la superficie de consola ---------------------------------
  //
  // Estas cinco preguntan por VEHÍCULO, no por equipo. Antes la lista de flota
  // salía del inventario de equipos GPS, que es otra cosa: un vehículo sin
  // equipo instalado no aparecía, y el identificador que manejaba el panel era
  // el del aparato y no el de la unidad.

  /** Vehículos de la empresa, con su estado en vivo. Máximo 200 por página: la flota entera se lee en `repoApi`. */
  vehiculos: ({ limite = 200, desplazamiento = 0, q = '', enteId = '' } = {}) => {
    const p = new URLSearchParams({ limit: limite, offset: desplazamiento })
    if (q) p.set('q', q)
    const ruta = enteId ? `${CONSOLA}/tenants/${enteId}/vehicles` : `${CONSOLA}/vehicles`
    return pedir(`${ruta}?${p}`)
  },

  /** Ficha de un vehículo, con su última situación conocida. */
  vehiculo: (vehiculoId) => pedir(`${CONSOLA}/vehicles/${vehiculoId}`),

  /** Última posición válida del vehículo. */
  posicionDeVehiculo: (vehiculoId) =>
    pedir(`${CONSOLA}/vehicles/${vehiculoId}/position/latest`),

  /** Recorrido del vehículo. El rango va sobre la hora de RECEPCIÓN. */
  recorrido: (vehiculoId, limite = 200, desde = null) =>
    pedir(`${CONSOLA}/vehicles/${vehiculoId}/positions?limit=${limite}${desde ? `&from=${encodeURIComponent(desde)}` : ''}`),

  /** Áreas de la empresa, con cuántas unidades tiene cada una. */
  areas: () => pedir(`${CONSOLA}/areas?limit=200`),

  /** Conductores con asignación vigente. Sin datos personales. */
  conductores: ({ desplazamiento = 0, limite = 200 } = {}) => pedir(`${CONSOLA}/drivers?limit=${limite}&offset=${desplazamiento}`),

  // --- Operación y cumplimiento (tablas de #170 y #171) --------------------

  /** Órdenes de trabajo, de la más recientemente movida a la más vieja. */
  odts: ({ estado = '', vehiculoId = '', limite = 100, desplazamiento = 0 } = {}) => {
    const p = new URLSearchParams({ limit: limite, offset: desplazamiento })
    if (estado) p.set('status', estado)
    if (vehiculoId) p.set('vehicleId', vehiculoId)
    return pedir(`${CONSOLA}/work-orders?${p}`)
  },

  /** Ficha de una orden con su historial inmutable. */
  odt: (odtId) => pedir(`${CONSOLA}/work-orders/${odtId}`),

  /** Inspecciones realizadas. */
  inspeccion: (id) => pedir(`${CONSOLA}/inspections/${id}`),
  inspecciones: ({ vehiculoId = '', limite = 100 } = {}) => {
    const p = new URLSearchParams({ limit: limite })
    if (vehiculoId) p.set('vehicleId', vehiculoId)
    return pedir(`${CONSOLA}/inspections?${p}`)
  },

  /** Documentos, del que antes vence al que más tarda. */
  documentos: ({ vehiculoId = '', limite = 100 } = {}) => {
    const p = new URLSearchParams({ limit: limite })
    if (vehiculoId) p.set('vehicleId', vehiculoId)
    return pedir(`${CONSOLA}/documents?${p}`)
  },

  /** Reglas de alerta y a cuántas unidades alcanzan. */
  reglasAlerta: () => pedir(`${CONSOLA}/alert-rules?limit=200`),

  /** Avisos, los no leídos primero. */
  notificaciones: ({ soloSinLeer = false, limite = 100 } = {}) => {
    const p = new URLSearchParams({ limit: limite })
    if (soloSinLeer) p.set('unreadOnly', 'true')
    return pedir(`${CONSOLA}/notifications?${p}`)
  },

  /** Contadores del panel, todos del mismo instante. */
  resumenOperacion: () => pedir(`${CONSOLA}/summary`),

  // --- Todavía por la superficie interna -----------------------------------

  /** Inventario de equipos GPS. Aún no tiene equivalente en `/console`. */
  dispositivos: () => pedir(`${INTERNA}/devices`),

  /** Panorama de la recepción: totales, equipos activos, último mensaje. */
  panorama: () => pedir(`${INTERNA}/observability/overview`),
}


// ============================================================
// Superficie publicada el 18 de septiembre de 2026 (paridad web de Juan).
// Lo que ve el administrador FOM en su consola, ruta por ruta, para que
// el panel enseñe lo mismo. Las lecturas devuelven `{ items, page }`.
// ============================================================

/** Arma una cadena de consulta sin los valores vacíos. */
function consulta(valores) {
  const p = new URLSearchParams()
  Object.entries(valores).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  })
  const s = p.toString()
  return s ? `?${s}` : ''
}

Object.assign(api, {
  pagosServicio: (tenantId, { offset = 0 } = {}) => pedir(`${CONSOLA}/tenants/${tenantId}/service-payments?limit=200&offset=${offset}`),
  crearPagoServicio: (tenantId, cuerpo) => pedir(`${CONSOLA}/tenants/${tenantId}/service-payments`, { metodo: 'POST', cuerpo }),
  moverPagoServicio: (tenantId, id, cuerpo) => pedir(`${CONSOLA}/tenants/${tenantId}/service-payments/${id}/status`, { metodo: 'PATCH', cuerpo }),
  abonarPagoServicio: (tenantId, id, cuerpo) => pedir(`${CONSOLA}/tenants/${tenantId}/service-payments/${id}/receipts`, { metodo: 'POST', cuerpo, idempotente: true }),
  crearPlantillaInspeccion: (cuerpo) => pedir(`${CONSOLA}/inspection-templates`, { metodo: 'POST', cuerpo }),
  moverPlantillaInspeccion: (id, cuerpo) => pedir(`${CONSOLA}/inspection-templates/${id}/status`, { metodo: 'PATCH', cuerpo }),
  // Días de la semana en que toca la planilla (servidor nuevo; el viejo responde 404).
  cambiarDiasPlantillaInspeccion: (id, cuerpo) => pedir(`${CONSOLA}/inspection-templates/${id}/weekdays`, { metodo: 'PATCH', cuerpo }),
  // --- Alertas y SOS -------------------------------------------------------
  eventosDeAlerta: ({ status, severity, vehicleId, limit = 100, offset = 0 } = {}) =>
    pedir(`${CONSOLA}/alert-events${consulta({ status, severity, vehicleId, limit, offset })}`),
  reconocerEventoDeAlerta: (id) => pedir(`${CONSOLA}/alert-events/${id}/acknowledge`, { metodo: 'POST' }),
  resolverEventoDeAlerta: (id) => pedir(`${CONSOLA}/alert-events/${id}/resolve`, { metodo: 'POST' }),
  emergencias: ({ status } = {}) => pedir(`${CONSOLA}/emergencies${consulta({ status })}`),
  reconocerEmergencia: (id) => pedir(`${CONSOLA}/emergencies/${id}/acknowledge`, { metodo: 'POST' }),
  resolverEmergencia: (id) => pedir(`${CONSOLA}/emergencies/${id}/resolve`, { metodo: 'POST' }),

  // --- Jornadas de conducción ---------------------------------------------
  jornadas: ({ status, vehicleId, userId, limit = 100, offset = 0 } = {}) =>
    pedir(`${CONSOLA}/driver-sessions${consulta({ status, vehicleId, userId, limit, offset })}`),

  // --- Planes y acciones de mantenimiento ----------------------------------
  planesDeMantenimiento: ({ q, limit = 200 } = {}) =>
    pedir(`${CONSOLA}/maintenance/plans${consulta({ q, limit })}`),
  guardarPlanDeMantenimiento: (planId, cuerpo) =>
    pedir(`${CONSOLA}/maintenance/plans/${planId}`, { metodo: 'PUT', cuerpo }),
  cubrirUnidadEnPlan: (planId, vehicleId, cuerpo) =>
    pedir(`${CONSOLA}/maintenance/plans/${planId}/vehicles/${vehicleId}`, { metodo: 'PUT', cuerpo }),
  quitarUnidadDePlan: (planId, vehicleId) =>
    pedir(`${CONSOLA}/maintenance/plans/${planId}/vehicles/${vehicleId}`, { metodo: 'DELETE' }),
  accionesDeMantenimiento: ({ vehicleId, status, q, limit = 200 } = {}) =>
    pedir(`${CONSOLA}/maintenance/actions${consulta({ vehicleId, status, q, limit })}`),
  guardarAccionDeMantenimiento: (actionId, cuerpo) =>
    pedir(`${CONSOLA}/maintenance/actions/${actionId}`, { metodo: 'PUT', cuerpo }),
  moverAccionDeMantenimiento: (actionId, cuerpo) =>
    pedir(`${CONSOLA}/maintenance/actions/${actionId}/status`, { metodo: 'PATCH', cuerpo }),

  // --- Transferencias entre entes (doble control) --------------------------
  transferenciasDeIdentidad: ({ status, tenantId, limit = 100 } = {}) =>
    pedir(`${CONSOLA}/identity-transfers${consulta({ status, tenantId, limit })}`),
  crearTransferenciaDeIdentidad: (cuerpo) =>
    pedir(`${CONSOLA}/identity-transfers`, { metodo: 'POST', cuerpo, idempotente: true }),
  decidirTransferenciaDeIdentidad: (id, paso, cuerpo) =>
    pedir(`${CONSOLA}/identity-transfers/${id}/${paso}`, { metodo: 'POST', cuerpo, idempotente: true }),
  transferenciasDeVehiculo: ({ status, tenantId, limit = 100 } = {}) =>
    pedir(`${CONSOLA}/vehicle-transfers${consulta({ status, tenantId, limit })}`),
  crearTransferenciaDeVehiculo: (cuerpo) =>
    pedir(`${CONSOLA}/vehicle-transfers`, { metodo: 'POST', cuerpo, idempotente: true }),
  decidirTransferenciaDeVehiculo: (id, paso, cuerpo) =>
    pedir(`${CONSOLA}/vehicle-transfers/${id}/${paso}`, { metodo: 'POST', cuerpo, idempotente: true }),

  // --- Lecturas de toda la plataforma (solo administrador FOM) -------------
  personasDePlataforma: ({ q, limit = 50, offset = 0 } = {}) =>
    pedir(`${CONSOLA}/platform/users${consulta({ q, limit, offset })}`),
  gpsSinEmparejar: () => pedir(`${CONSOLA}/gps-devices/unpaired`),
  /** Bitácora del ente: quién hizo qué y cuándo. */
  auditoria: ({ entityType, action, limit = 200, offset = 0 } = {}) =>
    pedir(`${CONSOLA}/audit${consulta({ entityType, action, limit, offset })}`),
  /** Archivar una unidad: primero qué lo impide, luego el archivo con clave de idempotencia. */
  preflightArchivoVehiculo: (vehicleId) => pedir(`${CONSOLA}/vehicles/${vehicleId}/archive-preflight`),
  archivarVehiculo: (vehicleId, cuerpo) =>
    pedir(`${CONSOLA}/vehicles/${vehicleId}/archive`, { metodo: 'POST', cuerpo, idempotente: true }),
  /** Quién ejecuta la orden (aprobada → asignada, o reasignar). */
  asignarResponsableOdt: (id, cuerpo) =>
    pedir(`${CONSOLA}/work-orders/${id}/assignee`, { metodo: 'PUT', cuerpo }),
  /** Responsable vigente, eventos de taller y tiempos de la orden. */
  ejecucionOdt: (id) => pedir(`${CONSOLA}/work-orders/${id}/execution`),
  /** inicio | pausa | reanudacion | entrega, como desde el taller en la app. */
  ejecutarOdt: (id, cuerpo) =>
    pedir(`${CONSOLA}/work-orders/${id}/execution-events`, { metodo: 'POST', cuerpo }),
  equiposGps: () => pedir(`${CONSOLA}/gps-devices`),

  // --- Programa de inspecciones: plantillas, citas y hallazgos -------------
  plantillasDeInspeccion: ({ status, limit = 200 } = {}) =>
    pedir(`${CONSOLA}/inspection-templates${consulta({ status, limit })}`),
  programasDeInspeccion: ({ status, vehicleId, limit = 200 } = {}) =>
    pedir(`${CONSOLA}/inspection-schedules${consulta({ status, vehicleId, limit })}`),
  crearProgramaDeInspeccion: (cuerpo) =>
    pedir(`${CONSOLA}/inspection-schedules`, { metodo: 'POST', cuerpo }),
  cancelarProgramaDeInspeccion: (id, cuerpo) =>
    pedir(`${CONSOLA}/inspection-schedules/${id}/cancel`, { metodo: 'POST', cuerpo }),
  hallazgosDeInspeccion: ({ status, vehicleId, limit = 200 } = {}) =>
    pedir(`${CONSOLA}/inspection-findings${consulta({ status, vehicleId, limit })}`),
  moverHallazgo: (inspectionId, answerId, cuerpo) =>
    pedir(`${CONSOLA}/inspections/${inspectionId}/findings/${answerId}/follow-up`, { metodo: 'POST', cuerpo }),
})

// ============================================================
// La inspección DIARIA del conductor (T-167a): las MISMAS rutas que la app
// (src/services/inspeccionService.ts de FOM-DRIVER). La consola no tiene
// versión propia de estas: el formato de la unidad, el envío, la lista de la
// unidad y el aviso al supervisor viven en `/api/v1/mobile`. No pasan por
// `/tenants/{id}`: son del conductor en sesión, nunca de otra empresa.
// ============================================================
const MOVIL = '/api/v1/mobile'

Object.assign(api, {
  /**
   * Los formatos publicados para el tipo de la unidad: `{ items: [{ id, name, items: [...] }] }`.
   * Con `soloHoy` (T-200) pide `?scope=today`: el servidor nuevo manda solo las que tocan hoy,
   * con `date` y, por planilla, `dueToday` / `submittedToday` / `inspectionId` / `result` /
   * `submittedAt`; el viejo ignora el parámetro y manda todas, sin esos campos.
   */
  formatosDeInspeccion: (vehicleId, { soloHoy = false } = {}) =>
    pedir(`${MOVIL}/vehicles/${encodeURIComponent(vehicleId)}/inspection-templates${soloHoy ? '?scope=today' : ''}`),
  /** Envía la inspección: `{ templateId, location?, answers }` → `{ inspectionId, result, workOrderIds }`. */
  enviarInspeccionDiaria: (vehicleId, cuerpo) =>
    pedir(`${MOVIL}/vehicles/${encodeURIComponent(vehicleId)}/inspections`, { metodo: 'POST', cuerpo }),
  /** Las inspecciones de una unidad, de la más nueva a la más vieja (al conductor puede responderle 403). */
  inspeccionesDeUnidad: (vehicleId, { limit = 20, offset = 0 } = {}) =>
    pedir(`${MOVIL}/inspections${consulta({ vehicleId, limit, offset })}`),
  /** Una inspección con sus hallazgos (`{ inspection, findings }`). */
  inspeccionDeUnidad: (id) => pedir(`${MOVIL}/inspections/${encodeURIComponent(id)}`),
  /** La orden que generó la inspección (`{ workOrder }`). */
  ordenDeInspeccion: (id) => pedir(`${MOVIL}/work-orders/${encodeURIComponent(id)}`),
  /** Aviso del conductor a su supervisor: unidad bloqueada o «pide otra unidad». */
  avisarAlSupervisor: (cuerpo) => pedir(`${MOVIL}/notices`, { metodo: 'POST', cuerpo }),
})

// ============================================================
// EL SOS DEL CONDUCTOR (T-167b): las MISMAS rutas que la app
// (src/services/emergencyService.ts de FOM-DRIVER). El supervisor sigue
// leyendo y atendiendo por la consola (`emergencias`, más arriba): es el mismo
// aviso visto desde el otro lado.
// ============================================================
Object.assign(api, {
  /** Los avisos en curso que ve quien tiene la sesión (al conductor, solo los suyos): `{ items }`. */
  emergenciasDelConductor: (status) => pedir(`${MOVIL}/emergencies${consulta({ status, limit: 100 })}`),
  /**
   * Manda el aviso: `{ vehicleId?, kind, kindOther?, detail, reporterLatitude?, reporterLongitude? }`
   * → `{ emergency }`. La clave es la del intento: si el conductor reintenta tras
   * un corte, FOM devuelve el mismo aviso en vez de crear otro.
   */
  enviarEmergencia: (cuerpo, clave) =>
    pedir(`${MOVIL}/emergencies`, { metodo: 'POST', cuerpo, idempotente: true, idempotencia: clave }),
  /** Falsa alarma: la retira quien la creó, mientras nadie la haya tomado. */
  cancelarEmergencia: (id) => pedir(`${MOVIL}/emergencies/${encodeURIComponent(id)}/cancel`, { metodo: 'POST' }),
  /** Ya pasó: la cierra quien la mandó (o quien la tomó), una vez tomada. */
  terminarEmergencia: (id) => pedir(`${MOVIL}/emergencies/${encodeURIComponent(id)}/resolve`, { metodo: 'POST' }),
})

// ============================================================
// OTRA UNIDAD CON PIN (T-167b): las rutas de pin-unidad.tsx de la app
// (fomConduccion.ts). El conductor secundario elige una de SUS unidades, da
// su PIN y FOM abre su sesión de conducción; al dejarla, todo vuelve al titular.
// ============================================================
Object.assign(api, {
  /** MIS asignaciones vigentes, en páginas: `{ items: [{ assignmentId, role, vehicleId, vehicleCode, vehiclePlate }], page }`. */
  misAsignaciones: ({ limit = 100, offset = 0 } = {}) => pedir(`${MOVIL}/drivers/me${consulta({ limit, offset })}`),
  /** La sesión de conducción abierta de quien tiene la sesión: `{ session }` (o `null`). */
  sesionDeConduccion: () => pedir(`${MOVIL}/driver-sessions/current`),
  /** Toma la unidad: el secundario da su PIN. */
  tomarUnidad: (vehicleId, pin) =>
    pedir(`${MOVIL}/vehicles/${encodeURIComponent(vehicleId)}/driver-sessions`, { metodo: 'POST', cuerpo: pin ? { pin } : {} }),
  /** Deja la unidad: cierra esa sesión. */
  terminarSesionDeConduccion: (sesionId) =>
    pedir(`${MOVIL}/driver-sessions/${encodeURIComponent(sesionId)}/end`, { metodo: 'POST' }),
})

export default api
