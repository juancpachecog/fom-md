import { leerTodasLasPaginas, listarTodasOdts } from './listar-odts'
// ============================================================
// REPOSITORIO REAL — traduce la API de fom-core a las formas del panel
// ------------------------------------------------------------
// Lee de `/api/v1/console`, la superficie aprobada en el Issue #173. Antes leía
// del inventario de equipos GPS, que es otra cosa: un vehículo sin equipo
// instalado no aparecía en la flota, y el identificador que manejaba el panel
// era el del aparato y no el de la unidad.
//
// Regla que se respeta aquí: no inventar. Un dato que la base no tiene se
// devuelve `null`, nunca un cero ni un valor plausible. Un panel que muestra
// "0 km/h" cuando en realidad no sabe la velocidad miente, y nadie se entera.
// ============================================================

import { api, empresaGestionActualId, escriturasHechas, pedir } from './api'
import { asignarPrincipal } from './asignarConductor'
import { normalizarCodigoPlan, validarCodigoPlan } from './codigoPlan'
import { hoyISO } from './formato'
import { AVISO_SIN_DIAS_EN_SERVIDOR, diasParaEnviar, normalizarDias } from './diasPlanilla'
import { quitarSaltos } from './recorrido'
import { transmitiendo } from './sinSenal.js'
import { conRecepcionEquipo } from './recepcionUnidad.js'
import { coleccionDePersona, indiceDePersona } from './perfilUsuario'
import { cuerpoCredencial, credencialesVigentes } from './credencialesPersona'
import { cambiosGps } from './metadatosGps'
import { buscarEquipoGps, mensajeInstalarGps } from './instalarGps'
import { crearUnidad, gpsDisponible } from './altaUnidad'
import { placaMayuscula } from './placas'
import { LIMITE_EVENTOS, comoEventoManejo, diasServidor } from './eventosManejo'
import { cloudinaryConfigurado, subirImagen } from './cloudinary'
import { carpetaDe } from './archivos'
import { alCambiar, perfilActual } from '../auth'

/**
 * Une el vehículo con su estado en vivo en la forma que consumen los módulos.
 *
 * `speedKph` llega nulo mientras la unidad del campo de GPS103 no esté
 * demostrada (Issue #159). El servidor lo dice explícitamente en su contrato, y
 * aquí se respeta: nulo significa «no se sabe» y no debe convertirse en cero en
 * ningún punto del camino.
 */
function comoUnidad(v) {
  const alias = v.alias || v.fleetNumber || v.code
  return {
    id: v.id,
    vehiculoId: v.id,
    empresaId: null,

    marca: v.make || '—',
    modelo: v.model || '—',
    anio: v.modelYear ?? null,
    placa: v.plate || '—',
    numero: v.fleetNumber || v.code || '—',
    numeroFlota: v.fleetNumber ?? null,
    alias,
    tipo: v.vehicleType || 'otro',
    estado: v.status,

    areaId: v.areaId ?? null,
    areaNombre: v.areaName ?? null,

    // Telemetría. Todo `?? null`: la distinción entre «apagado» y «no se sabe»
    // se pierde en cuanto alguien la sustituye por un valor por defecto.
    velocidadKmh: v.speedKph ?? null,
    rumbo: v.headingDeg ?? null,
    ignition: v.ignition ?? null,
    km: v.odometerKm ?? null,

    // `motionState` lo calcula la base desde la velocidad. Con la velocidad
    // nula vale 'unknown', que es lo correcto: sin velocidad no se puede
    // afirmar si la unidad va rodando.
    estadoMarcha:
      v.motionState === 'en_marcha' || v.motionState === 'parada'
        ? v.motionState
        : null,

    lat: v.latitude ?? null,
    lng: v.longitude ?? null,
    ultimoReporte: v.lastReportAt ?? null,
    posicionEn: v.lastPositionAt ?? null,
    // Con señal = reportó hace menos de 5 min, la regla de la app (no «alguna vez reportó»).
    // Las pantallas la recalculan cada minuto con `conSenalAlDia`.
    conectado: transmitiendo(v.lastReportAt),
    conexion: transmitiendo(v.lastReportAt) ? 'reportando' : 'sin_senal',

    // Sin respaldo todavía en la superficie de lectura.
    conductorPrincipalId: null,
    conductorNombre: 'Sin asignar',
    indiceSeguro: null,
    aceitePct: null,
    tempMotorC: null,
    ubicacionTexto: null,
    docsVencidos: null,
    docsPorVencer: null,
    gps: null,
  }
}

/**
 * Flota completa. El estado en vivo viene ya unido en el servidor; lo que no
 * cabe es la flota entera en una página: el servidor entrega 200 como máximo,
 * así que se leen todas las páginas (la primera dice el total y las demás se
 * piden a la vez). Si se agota el tope de páginas, la lista sale `incompleta`.
 */
const VENTANA_COMPARTIDA_MS = 3000
let enVuelo = null
let enVueloDesde = 0
let enVueloEmpresa = null

async function flota(q = '') {
  const ahora = Date.now()
  const empresaContexto = empresaGestionActualId()
  if (!q && enVuelo && enVueloEmpresa === empresaContexto && ahora - enVueloDesde < VENTANA_COMPARTIDA_MS) {
    return enVuelo
  }
  const peticion = leerTodasLasPaginas((desplazamiento, limite) => api.vehiculos({ q, limite, desplazamiento }))
    .then(async (r) => {
      const lista = await conPosicionDirecta(r.items.map(comoUnidad))
      if (r.incompleta) lista.incompleta = true
      return lista
    })
  if (!q) {
    enVueloDesde = ahora
    enVueloEmpresa = empresaContexto
    enVuelo = peticion
    // Un fallo no debe quedar cacheado: el siguiente intento tiene que salir
    // de verdad al servidor.
    peticion.catch(() => {
      if (enVuelo === peticion) enVuelo = null
    })
  }
  return peticion
}

// Unidades que ya contestaron «sin posición» (o fallaron), y hasta cuándo no se
// les vuelve a preguntar. Sin esto, cada refresco de 15 s repetía la misma
// ronda de lecturas para unidades que nunca han reportado.
const SIN_POSICION_MS = 5 * 60_000
const sinPosicionHasta = new Map()

/**
 * PUENTE mientras el estado vivo del servidor llega vacío (Issue #169,
 * PR #194 de fom-core): si una unidad viene sin último reporte, se le pide
 * su ÚLTIMA posición — una sola lectura por unidad, no el recorrido — y con
 * eso el mapa pinta y el contador de reportando dice la verdad.
 *
 * El tope de 25 unidades es deliberado: este puente es para flotas chicas
 * mientras el servidor no proyecta el estado vivo; con flotas grandes la
 * ronda de peticiones se volvería el problema, y la respuesta correcta es
 * la proyección del lado de la base, no más peticiones. Cuando el servidor
 * empiece a mandar lastReportAt, este código deja de ejecutarse solo.
 */
async function conPosicionDirecta(lista) {
  // Se pide por FALTA DE COORDENADAS, no por falta de fecha. El listado
  // del servidor manda `lastReportAt` pero NO manda latitud ni longitud, asi
  // que mirar la fecha daba por resuelto lo que seguia sin resolverse: la
  // unidad contaba como «reportando» y el mapa se quedaba sin punto.
  const ahora = Date.now()
  const sinVivo = lista.filter(
    (v) => (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) && !((sinPosicionHasta.get(v.id) ?? 0) > ahora),
  )
  if (sinVivo.length === 0 || sinVivo.length > 25) return lista
  const posiciones = await Promise.all(
    sinVivo.map((v) =>
      api
        .posicionDeVehiculo(v.id)
        .then((r) => r?.position ?? null)
        // Sin posición no hay nada que corregir: la unidad queda como estaba.
        .catch(() => null),
    ),
  )
  const porId = new Map()
  sinVivo.forEach((v, i) => {
    porId.set(v.id, posiciones[i])
    if (!posiciones[i]) sinPosicionHasta.set(v.id, ahora + SIN_POSICION_MS)
    else sinPosicionHasta.delete(v.id)
  })
  return lista.map((v) => {
    const p = porId.get(v.id)
    if (!p) return v
    return {
      ...v,
      lat: p.latitude ?? v.lat,
      lng: p.longitude ?? v.lng,
      // La fecha que ya traia el listado es la buena si la posicion no trae
      // una suya: no se pisa un dato cierto con un nulo.
      ultimoReporte: p.receivedAt ?? v.ultimoReporte ?? null,
      posicionEn: p.receivedAt ?? v.posicionEn ?? null,
      rumbo: p.telemetry?.headingDeg ?? null,
      velocidadKmh: p.telemetry?.speedKph ?? null,
      conectado: transmitiendo(p.receivedAt ?? v.ultimoReporte),
      conexion:
        transmitiendo(p.receivedAt ?? v.ultimoReporte) ? 'reportando' : 'sin_senal',
    }
  })
}

/**
 * Clave temporal legible pero no adivinable. Se genera en el navegador y
 * viaja una sola vez: el servidor guarda el hash y obliga a cambiarla.
 */
function claveTemporal() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint32Array(12)
  crypto.getRandomValues(bytes)
  const cuerpo = [...bytes].map((b) => alfabeto[b % alfabeto.length]).join('')
  return `Fom-${cuerpo.slice(0, 4)}-${cuerpo.slice(4, 8)}-${cuerpo.slice(8, 12)}`
}

/** El rol canonico en palabras, como lo ve la gente. */
const ETIQUETA_ROL = {
  admin_fom: 'Administrador FOM',
  supervisor: 'Supervisor',
  conductor: 'Conductor',
  operator: 'Operador',
  usuario: 'Usuario',
}

/**
 * Convierte cualquier texto en el «motivo» que exige el servidor: un codigo
 * corto, en minusculas, sin espacios ni acentos (^[a-z0-9][a-z0-9._-]{0,99}$).
 *
 * Las cuatro rutas que reciben motivo lo validan igual y devuelven 400 ante
 * una frase con espacios. El panel escribia frases —«Suspendida desde la
 * consola»— y todos esos botones habrian fallado al primer clic. Se normaliza
 * aqui, en un solo sitio, para que ningun caller tenga que acordarse.
 */
function motivo(texto, porDefecto = 'consola') {
  const base = String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '') // los acentos, ya separados por NFD
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+/u, '')
    .replace(/-+/gu, '-')
    .replace(/-$/u, '')
    .slice(0, 100)
  return base || porDefecto
}

/**
 * Inspecciones de la empresa desde `desde` hasta hoy, página a página.
 * `GET /inspections` llega de la más nueva a la más vieja y solo acepta
 * `vehicleId`, `limit` (hasta 200) y `offset`: se sigue pidiendo hasta que la
 * última de la página es anterior a `desde`. Tope de 25 páginas (5 000
 * inspecciones); si se alcanza, la lista sale marcada como incompleta.
 */
export async function inspeccionesDelPeriodo({ vehiculoId = '', desde }, pedirPagina = (offset) => {
  const p = new URLSearchParams({ limit: 200, offset })
  if (vehiculoId) p.set('vehicleId', vehiculoId)
  return pedir(`/api/v1/console/inspections?${p}`)
}) {
  const items = new Map()
  for (let vuelta = 0; vuelta < 25; vuelta++) {
    const r = await pedirPagina(items.size)
    const pagina = r?.items ?? []
    const antes = items.size
    for (const i of pagina) items.set(i.id, i)
    const total = Number(r?.page?.total)
    const ultima = String(pagina.at(-1)?.inspectionDate ?? '').slice(0, 10)
    if (pagina.length < 200 || (Number.isFinite(total) && items.size >= total) || (ultima && ultima < desde)) return { items: [...items.values()] }
    if (items.size === antes) throw new Error('No se pudieron leer todas las inspecciones del mes: el servidor repitió una página. Vuelve a intentarlo.')
  }
  return { items: [...items.values()], incompleta: true }
}

/**
 * Asignaciones vigentes de conductores, TODAS las páginas. Cambian poco y la
 * flota se refresca cada 15–30 s: se guardan 5 minutos por empresa en vez de
 * pedirlas en cada vuelta. Cualquier escritura del panel (asignar, quitar,
 * transferir…) las da por viejas, y `fresco` obliga a leerlas de nuevo.
 */
const ASIGNACIONES_MS = 5 * 60_000
let asignacionesGuardadas = null

export function asignacionesVigentes({ fresco = false } = {}) {
  const empresa = empresaGestionActualId()
  const escrituras = escriturasHechas()
  const g = asignacionesGuardadas
  if (!fresco && g && g.empresa === empresa && g.escrituras === escrituras && Date.now() - g.desde < ASIGNACIONES_MS) {
    return g.peticion
  }
  const peticion = leerTodasLasPaginas(
    (desplazamiento, limite) => api.conductores({ desplazamiento, limite }),
    { clave: (c) => c?.assignmentId, repetida: 'El servidor repitió una página de asignaciones. Vuelve a intentarlo.' },
  ).then((r) => r.items)
  const guardada = { empresa, escrituras, desde: Date.now(), peticion }
  asignacionesGuardadas = guardada
  // Un fallo no se guarda: el siguiente intento sale de verdad al servidor.
  peticion.catch(() => { if (asignacionesGuardadas === guardada) asignacionesGuardadas = null })
  return peticion
}

/**
 * Para listas que llegan de la más nueva a la más vieja: corta cuando la última
 * leída es anterior a `corte`. Solo si lo leído viene de verdad en orden de
 * creación; si aparece una más nueva después de una más vieja (el servidor
 * ordena por otra fecha), se sigue leyendo todo para no perder ninguna.
 */
function pararAntesDe(corte, fecha = (o) => o.createdAt) {
  let enOrden = true
  let previa = Infinity
  return (pagina) => {
    for (const o of pagina) {
      const t = Date.parse(fecha(o) ?? '')
      if (!Number.isFinite(t)) continue
      if (t > previa) enOrden = false
      previa = t
    }
    return enOrden && previa < corte
  }
}

function conductoresPorVehiculo(lista) {
  const porVehiculo = new Map()
  // Una unidad puede tener un conductor principal y uno o más secundarios: manda el principal, no el primero que llega.
  const ordenados = [...lista].sort((a, b) => (a.role === 'principal' ? 0 : 1) - (b.role === 'principal' ? 0 : 1))
  for (const c of ordenados) {
    if (!porVehiculo.has(c.vehicleId)) porVehiculo.set(c.vehicleId, c)
  }
  return porVehiculo
}

/** Metros entre dos puntos (haversine). */
function metrosEntre(a, b) {
  const R = 6371000
  const rad = (g) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const DERIVA_METROS = 20

function normalizarCedula(texto) {
  const t = String(texto).trim().toLowerCase().replace(/[\s.]/gu, '')
  const m = t.match(/^([ve])-?(\d{6,9})$/u)
  if (m) return `${m[1]}-${m[2]}`
  if (/^\d{6,9}$/u.test(t)) return `v-${t}`
  return t
}

function normalizarTelefono(texto) {
  let t = String(texto).replace(/[\s().-]/gu, '')
  if (t.startsWith('00')) t = `+${t.slice(2)}`
  if (/^0\d{10}$/u.test(t)) t = `+58${t.slice(1)}`
  if (/^\d{10}$/u.test(t)) t = `+58${t}`
  if (!t.startsWith('+') && /^\d{7,15}$/u.test(t)) t = `+${t}`
  return t
}

const MANTENIMIENTO_ES_PLAN =
  'Las reglas de mantenimiento por kilometraje ya no existen como alerta: el ' +
  'servidor las convirtió en planes de mantenimiento, con su propia pantalla ' +
  'que el panel todavía no tiene. Las reglas de velocidad sí se pueden crear.'

/** Reductor: conserva un punto solo si se alejó de verdad del último. */
function sinDeriva(acum, p, i, todos) {
  const ultimo = acum[acum.length - 1]
  if (!ultimo || i === todos.length - 1 || metrosEntre(ultimo, p) >= DERIVA_METROS) acum.push(p)
  return acum
}

/** Filas de posiciones del servidor (más nuevas primero) → puntos válidos, del más antiguo al más nuevo. */
/**
 * El score del servidor (política driving-v1) en la forma de la pantalla. `index` y la tasa llegan en null cuando
 * no hubo kilómetros (rating «unavailable»): no se inventa nada, se devuelve null o el aviso.
 */
function scoreDe(s, aunSinIndice = false) {
  if (!s) return null
  const sinIndice = s.index == null || s.rating === 'unavailable'
  if (sinIndice && !aunSinIndice) return null
  return {
    indice: s.index ?? null,
    eventosPor100: s.eventsPer100Km ?? null,
    km: Number(s.km ?? 0),
    dias: s.days,
    frenadas: s.harshBraking ?? 0,
    aceleraciones: s.harshAcceleration ?? 0,
    excesos: s.speeding ?? 0,
    rating: s.rating,
  }
}

const RANKING_MS = 5 * 60_000
const rankingsGuardados = new Map()

/**
 * Olvida lo guardado en memoria (rankings, asignaciones, flota y unidades sin
 * posición). Pasa solo al cerrar la sesión o cambiar de persona: lo de una
 * cuenta no se le muestra a la siguiente en el mismo navegador.
 */
export function olvidarMemorias() {
  rankingsGuardados.clear()
  asignacionesGuardadas = null
  enVuelo = null
  enVueloEmpresa = null
  sinPosicionHasta.clear()
}

let personaDeLaMemoria = perfilActual()?.id ?? null
alCambiar((s) => {
  // null = sin sesión (salió o expiró). Sin perfil pero con algo = resolviendo o sin conexión: no cambia de quién es.
  if (s === null) { olvidarMemorias(); personaDeLaMemoria = null; return }
  const persona = s?.perfil?.id
  if (!persona) return
  if (personaDeLaMemoria && persona !== personaDeLaMemoria) olvidarMemorias()
  personaDeLaMemoria = persona
})

function puntosDe(filas) {
  return quitarSaltos(filas
    .filter((p) => p.positionValid && p.latitude != null && p.longitude != null)
    .map((p) => ({
      lat: p.latitude,
      lng: p.longitude,
      velocidadKmh: p.telemetry?.speedKph ?? null,
      rumbo: p.telemetry?.headingDeg ?? null,
      ignition: p.telemetry?.ignition ?? null,
      hora: p.eventTime || p.receivedAt,
    }))
    .reverse())
}

/** Un equipo GPS del servidor dicho como lo usa el panel (inventario y detalle). */
function comoEquipoGps(d) {
  return {
    id: d.id,
    imei: d.imei,
    modelo: d.model,
    fabricante: d.manufacturer ?? null,
    protocolo: d.protocolFamily,
    linea: d.simPhone ?? null,
    simPhone: d.simPhone ?? null,
    iccid: d.iccid ?? null,
    carrier: d.carrier ?? null,
    apn: d.apn ?? null,
    simStatus: d.simStatus ?? null,
    simPlan: d.simPlan ?? null,
    firmwareVersion: d.firmwareVersion ?? null,
    transport: d.transport ?? null,
    estado: d.status,
    // «Verificado» = el receptor ya lo oyó alguna vez. Es informativo: el servidor deja instalar
    // cualquier equipo en inventario, haya reportado o no.
    verificado: Boolean(d.connected || d.lastConnectionAt),
    conectado: Boolean(d.connected),
    ultimaConexion: d.lastConnectionAt ?? null,
    panicoProbado: false,
    empresaNombre: '—',
    vehiculoId: d.vehicleId ?? null,
    vehiculoNombre: d.vehicleId ? [d.vehicleCode, d.vehiclePlate].filter(Boolean).join(' · ') : null,
    vehiculoPlaca: d.vehiclePlate ?? null,
    ubicacion: d.storageLocation ?? null,
    serie: d.serialNumber ?? null,
    pinSupport: Boolean(d.panicSupported ?? d.pinSupport),
    instalacionId: d.installationId ?? d.activeInstallationId ?? d.installation?.id ?? null,
    instaladoEn: d.installedAt ?? null,
    tecnico: d.technician ?? null,
    ubicacionInstalacion: d.installationLocation ?? null,
  }
}

/** Una posición de un equipo (`position/latest` y `positions`). */
function comoPosicionGps(p) {
  return {
    id: p.id,
    recibido: p.receivedAt,
    hora: p.eventTime || p.receivedAt,
    lat: Number(p.latitude),
    lng: Number(p.longitude),
    valida: Boolean(p.quality?.positionValid),
    velocidad: p.telemetry?.speedKph ?? null,
    rumbo: p.telemetry?.headingDeg ?? null,
    encendido: p.telemetry?.ignition ?? null,
  }
}

export const repoApi = {
  /**
   * Score de manejo del conductor en sesión. El servidor aún no lo entrega (pendiente en #631/Issue de manejo):
   * devuelve null y la tarjeta lo dice, en vez de inventar un número. Cuando exista, debe devolver
   * { indice, eventosPor100, km, dias, frenadas, aceleraciones, excesos }.
   */
  manejo: {
    /** Mi score (conductor). `null` si el servidor aún no tiene recorridos suficientes. */
    async miScore({ dias = 7 } = {}) {
      return scoreDe(await api.miScoreManejo(dias))
    },
    /**
     * Ranking de los conductores de la empresa, del mejor al peor. Una lectura por empresa y período,
     * guardada 5 minutos: la lista de Usuarios, la ficha del vehículo y la de la persona sacan de aquí
     * la pastilla de cada conductor en vez de pedir una por persona.
     */
    ranking({ dias = 7, fresco = false } = {}) {
      // Por persona además de empresa: otra cuenta en el mismo navegador no ve lo de la anterior.
      const clave = `${empresaGestionActualId() || ''}:${perfilActual()?.id || ''}:${dias}`
      const g = rankingsGuardados.get(clave)
      if (!fresco && g && Date.now() - g.desde < RANKING_MS) return g.peticion
      const peticion = api.scoresManejo(dias).then((r) =>
        (Array.isArray(r) ? r : r?.items ?? []).map((x) => ({ id: x.userId, nombre: x.displayName, ...scoreDe(x, true) })))
      const guardado = { desde: Date.now(), peticion }
      rankingsGuardados.set(clave, guardado)
      // Un fallo no se guarda: el siguiente intento sale de verdad al servidor.
      peticion.catch(() => { if (rankingsGuardados.get(clave) === guardado) rankingsGuardados.delete(clave) })
      return peticion
    },
    /**
     * Frenadas, aceleraciones y excesos de un conductor (`propio`: los míos, por `me/`), del más nuevo
     * al más viejo. El servidor solo acepta 7, 30 o 90 días: se pide el que cubre `dias` y la pantalla
     * recorta. Trae como mucho 100: `tope` dice si pudo haber más viejos que no llegaron.
     */
    async eventos({ userId, propio = false, dias = 7 } = {}) {
      const d = diasServidor(dias)
      const r = propio ? await api.misEventosManejo(d, LIMITE_EVENTOS) : await api.eventosManejoDe(userId, d, LIMITE_EVENTOS)
      const filas = Array.isArray(r) ? r : r?.items ?? []
      const lista = filas.map(comoEventoManejo)
      if (filas.length >= LIMITE_EVENTOS) lista.tope = true
      return lista
    },
  },

  admin: {
    usuarios: {
      async listar({ q = '', rol = '' } = {}) {
        const r = await api.usuarios({ q, limite: 200 })
        let lista = (r?.items ?? []).map((u) => ({
          id: u.userId,
          nombre: u.displayName,
          email: u.email,
          rol: u.role,
          rolEtiqueta: u.role === 'supervisor'
            ? 'Supervisor'
            : u.role === 'conductor'
              ? 'Conductor'
              : u.role === 'operator'
                ? 'Operador'
                : 'Usuario',
          empresaId: null,
          empresaNombre: 'Empresa actual',
          conduce: u.role === 'conductor',
          claveTemporal: null,
          perfilCompleto: null,
          esDesempleado: false,
          estado: u.status,
          activadoEn: u.activatedAt,
        }))
        if (rol) lista = lista.filter((u) => u.rol === rol)
        return lista
      },

      async crear({ nombre, email, rol, clave, empresaDestinoId }) {
        const r = await api.crearUsuario({
          email,
          displayName: nombre,
          role: rol,
          temporaryPassword: clave,
          tenantId: empresaDestinoId,
        })
        return {
          id: r.userId,
          nombre: r.displayName,
          email: r.email,
          rol: r.role,
          clave: r.passwordSet ? clave : null,
          claveCreada: Boolean(r.passwordSet),
          debeCambiarClave: Boolean(r.mustChangePassword),
        }
      },

      /**
       * Cambiar el perfil o el estado de alguien.
       *
       * `revoked` es terminal por diseño del ciclo de vida: de ahi no se
       * vuelve. Suspender, en cambio, se deshace.
       */
      async cambiar(id, { rol, estado, motivo: razon, empresaId } = {}) {
        await api.actualizarMiembro(id, {
          role: rol || undefined,
          status: estado || undefined,
          reason: motivo(razon),
          tenantId: empresaId,
        })
        return true
      },

      async suspender(id, razon) {
        await api.actualizarMiembro(id, { status: 'suspended', reason: motivo(razon, 'suspendida-desde-consola') })
        return true
      },

      async reactivar(id, razon) {
        await api.actualizarMiembro(id, { status: 'active', reason: motivo(razon, 'reactivada-desde-consola') })
        return true
      },

      /**
       * Reiniciar la clave. La nueva se genera AQUI y se devuelve una sola
       * vez para entregarla en mano; el servidor solo guarda su hash y la
       * marca como obligada a cambiarse en el primer ingreso.
       */
      async cambiarClave(id) {
        const clave = claveTemporal()
        await api.reiniciarClave(id, {
          temporaryPassword: clave,
          reason: 'reinicio-desde-consola',
        })
        return { clave, debeCambiarClave: true }
      },

      /**
       * Sacar a alguien del ente. El servidor NO borra la membresia: la
       * revoca, y con eso caen sus sesiones. Borrarla dejaria sin dueño el
       * rastro de todo lo que esa persona hizo.
       */
      async enviarADesempleados(id) {
        await api.actualizarMiembro(id, {
          status: 'revoked',
          reason: 'salida-del-ente-desde-consola',
        })
        return true
      },

      /** Mismo camino: revocar. Aqui no existe el borrado definitivo. */
      async eliminar(id) {
        await api.actualizarMiembro(id, {
          status: 'revoked',
          reason: 'acceso-revocado-desde-consola',
        })
        return true
      },

      async eliminarDefinitivo() {
        throw new Error(
          'Una cuenta no se borra: se revoca, y su rastro queda. Borrarla ' +
            'dejaria sin dueño todo lo que esa persona registro — ordenes, ' +
            'inspecciones y firmas. Usa «revocar acceso».',
        )
      },

      async mover() {
        throw new Error(
          'Mover a una persona de empresa se hace desde Transferencias, a doble ' +
            'control: el ente de origen la libera y el de destino la acepta, ' +
            'igual que en la app. Ábrela ahí.',
        )
      },
    },
  },

  vehiculos: {
    /**
     * Kilómetros recorridos por día, calculados por el servidor con TODAS las posiciones del día (la lectura de
     * posiciones solo entrega 1.000 por consulta, unas 11 horas, y por eso el cálculo desde el navegador se movía).
     * Devuelve los últimos `dias` días, del más reciente al más antiguo.
     */
    async kmPorDia(vehiculoId, dias = 7) {
      const fecha = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const hasta = new Date()
      const desde = new Date(Date.now() - (dias - 1) * 86400000)
      const r = await api.metricasDiarias(vehiculoId, fecha(desde), fecha(hasta))
      return (r?.items ?? [])
        .map((m) => ({ fecha: m.metricDate, km: Number(m.distanceMeters ?? 0) / 1000, posiciones: Number(m.positionCount ?? 0), parcial: m.calculationStatus !== 'complete' }))
        .sort((a, b) => b.fecha.localeCompare(a.fecha))
    },
    /** Registra la lectura actual del odómetro (la que marca el tablero del carro). */
    async registrarOdometro(vehiculoId, km) {
      await api.registrarOdometro(vehiculoId, { odometerKm: Number(km), observedAt: new Date().toISOString() })
      return true
    },
    /** La lectura OFICIAL más reciente del odómetro (km, como número) o null si nunca hubo una. */
    async odometro(vehiculoId) {
      const r = await api.odometroOficial(vehiculoId, 1)
      const lectura = (r?.items ?? [])[0]
      return lectura ? { km: Number(lectura.odometerKm), origen: lectura.source, en: lectura.observedAt } : null
    },
    async listar({ q = '', areaId = '' } = {}) {
      const [lista, conductores] = await Promise.all([
        flota(q),
        // Los conductores no son imprescindibles para pintar el mapa: si esa
        // llamada falla, la flota se muestra igual y sin nombre en vez de no
        // mostrarse. Salen de lo guardado (5 min), no de un pedido por refresco.
        asignacionesVigentes().catch(() => []),
      ])
      const porVehiculo = conductoresPorVehiculo(conductores)
      const salida = lista
        .filter(v => !areaId || v.areaId === areaId)
        .map((v) => {
          const c = porVehiculo.get(v.id)
          return c
            ? { ...v, conductorPrincipalId: c.userId, conductorNombre: c.displayName }
            : v
        })
        .sort((a, b) => a.alias.localeCompare(b.alias))
      // La pantalla avisa si la flota no se pudo leer entera.
      if (lista.incompleta) salida.incompleta = true
      return salida
    },

    /** Todas las asignaciones (todas las páginas): la unidad puede estar después de los primeros 200 registros. */
    async usuariosAsignados(id) {
      const asignaciones = await asignacionesVigentes()
      return asignaciones
        .filter(c => c.vehicleId === id)
        .map(c => ({
          id: c.userId, nombre: c.displayName, rol: c.role,
          asignacionId: c.assignmentId, desde: c.validFrom ?? null,
        }))
        .sort((a, b) => (a.rol === 'principal' ? 0 : 1) - (b.rol === 'principal' ? 0 : 1))
    },

    async obtener(id) {
      const [ficha, recorrido] = await Promise.all([
        api.vehiculo(id),
        repoApi.recorrido(id),
      ])
      // El expediente trae ahora sus dominios reales. Cada uno cae a lista
      // vacía por separado: un fallo en documentos no debe dejar el vehículo
      // sin mapa.
      const [documentos, odts, inspecciones] = await Promise.all([
        repoApi.documentos.listar({ vehiculoId: id }).catch(() => []),
        // Solo las de esta unidad, filtradas por el servidor (`vehicleId`), no las ~3.000 de la empresa.
        repoApi.odts.listar({ vehiculoId: id }).then((l) => l.filter((o) => o.vehiculoId === id)).catch(() => []),
        repoApi.inspecciones.listar({ vehiculoId: id }).catch(() => []),
      ])
      // La ficha del servidor no trae al conductor: vive en las asignaciones.
      // Sin esto el expediente decia «Sin conductor» aunque la asignacion se
      // hubiera guardado, y el selector volvia a vacio: parecia que no dejaba.
      let asignacionesError = false
      const delaUnidad = await repoApi.vehiculos.usuariosAsignados(id).catch(() => { asignacionesError = true; return [] })
      const asignacion = delaUnidad.find(c => c.rol === 'principal') ?? null
      // El detalle del vehículo no trae su GPS: se une desde la lista de equipos por el id de la unidad.
      const equipo = await api
        .equiposGps()
        .then((r) => { const equipos = (r?.devices ?? []).filter(d => d.vehicleId === id); return equipos.length === 1 ? equipos[0] : null })
        .catch(() => null)
      const ubicacionGps = equipo?.protocolFamily === 'meitrack-t399'
        ? await repoApi.gpsEscritura.telemetria(equipo.id, { limite: 1 }).then(r => r.ubicacion).catch(() => null) : null
      return {
        ...conRecepcionEquipo(comoUnidad(ficha.vehicle), equipo, ubicacionGps),
        conductorPrincipalId: asignacion?.id ?? null,
        asignacionId: asignacion?.asignacionId ?? null,
        conductorNombre: asignacion?.nombre ?? 'Sin asignar',
        conductores: delaUnidad,
        asignacionesError,
        gps: equipo
          ? {
              modelo: equipo.model ?? 'Equipo GPS',
              imei: equipo.imei,
              linea: equipo.simPhone ?? null,
              verificado: Boolean(equipo.connected || equipo.lastConnectionAt),
              conectado: Boolean(equipo.connected),
              pinSupport: false,
              instalacionId: equipo.installationId ?? null,
            }
          : null,
        recorrido,
        documentos,
        odts,
        inspecciones,
        eventos: [],
        costos: [],
      }
    },
  },

  /**
   * Trazado del recorrido, del más antiguo al más reciente.
   *
   * Se limpia la «deriva»: un GPS parado sigue mandando puntos que bailan
   * unos metros alrededor del sitio real, y dibujarlos todos pinta un
   * garabato encima del estacionamiento y suma kilómetros que la unidad no
   * hizo. Solo se conserva un punto cuando se alejó al menos 20 m del último
   * conservado; el primero y el último se quedan siempre.
   */
  async recorrido(vehiculoId) {
    if (!vehiculoId) return []
    try {
      const r = await api.recorrido(vehiculoId, 300)
      return (r?.positions ?? [])
        .filter((p) => p.positionValid && p.latitude != null && p.longitude != null)
        .map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
          velocidadKmh: p.telemetry?.speedKph ?? null,
          rumbo: p.telemetry?.headingDeg ?? null,
          hora: p.eventTime || p.receivedAt,
        }))
        .reverse()
        .reduce(sinDeriva, [])
    } catch (error) {
        throw error
      }
  },

  /**
   * Posiciones CRUDAS de las últimas `horas`, del más antiguo al más reciente. Sin el filtro
   * de deriva: para saber cuánto tiempo estuvo estacionada la unidad hacen falta justo los
   * puntos que ese filtro borra. `truncado` avisa de que el servidor cortó en el límite y
   * faltan los puntos más viejos del rango.
   */
  async recorridoDetallado(vehiculoId, { horas = 24, limite = 1000 } = {}) {
    if (!vehiculoId) return { puntos: [], truncado: false }
    const desde = new Date(Date.now() - horas * 3600000).toISOString()
    const r = await api.recorrido(vehiculoId, limite, desde)
    const filas = r?.positions ?? []
    return { puntos: puntosDe(filas), truncado: filas.length >= limite }
  },

  /** Las últimas posiciones de la unidad, para dibujar de dónde viene sin pedir el día entero. */
  async colaReciente(vehiculoId, limite = 60) {
    if (!vehiculoId) return []
    const r = await api.recorrido(vehiculoId, limite)
    return puntosDe(r?.positions ?? [])
  },

  /** Áreas reales. Ya no se devuelve una lista vacía. */
  async areas() {
    try {
      const r = await api.areas()
      return (r?.items ?? []).filter(a => a.status !== 'archived').map((a) => ({
        id: a.id,
        nombre: a.name,
        tipo: a.kind,
        estado: a.status,
        vehiculos: a.vehicleCount,
      }))
    } catch (error) {
        throw error
      }
  },

  /** Conductores con asignación vigente (todas las páginas, guardadas 5 min). Sin cédula ni teléfono: ver #168. */
  async conductores() {
    try {
      const items = await asignacionesVigentes()
      return items.map((c) => ({
        id: c.userId,
        nombre: c.displayName,
        rol: c.role,
        vehiculoId: c.vehicleId,
        vehiculo: c.vehiclePlate || c.vehicleCode,
        desde: c.validFrom,
      }))
    } catch (error) {
        throw error
      }
  },

  // --- Operación y cumplimiento --------------------------------------------
  //
  // La forma de cada elemento imita a la de la semilla para que los módulos no
  // cambien: la migración es del dato, no de la interfaz.

  /**
   * La gente del ente, en UNA sola forma.
   *
   * Antes habia dos: `personal` (que estaba vacia) y `admin.usuarios`. Eran
   * dos vistas de la misma persona, y la base lo dice sola — un documento de
   * persona apunta a su membresia, asi que aqui no existe alguien sin cuenta.
   */
  gente: {
    async guardarCredencial(userId, borrador, idempotencia) {
      const cuerpo = cuerpoCredencial(borrador)
      const r = await api.actualizarCredencialPersona(userId, cuerpo, idempotencia)
      if (!r?.credential?.id || r.credential.kind !== cuerpo.kind) throw new Error('El servidor no confirmó la credencial guardada. Recarga el perfil para comprobarla antes de repetir.')
      return r.credential
    },
    /**
     * Una persona por su identificador. El directorio no tiene ruta de
     * detalle: se busca en la lista. Antes «obtener» caía en la semilla y
     * devolvía null siempre: el expediente decía «no conseguimos a esta
     * persona» para todo el mundo.
     */
    async obtener(id) {
      const lista = await repoApi.gente.listar({})
      const p = lista.find((x) => x.userId === id || x.id === id)
      if (!p) return null
      const [insp, odts, docs, manejo] = await Promise.allSettled([
        repoApi.inspecciones.listar({}),
        // Un conductor con unidad: solo las órdenes de esa unidad (filtro del servidor). Sin unidad, todas.
        repoApi.odts.listar(p.conduce && p.unidad ? { vehiculoId: p.unidad } : {}),
        repoApi.documentos.listar({ ambito: 'persona' }),
        // Los mismos 7 días que la tarjeta «Manejo» abre por defecto: es la misma lectura guardada.
        p.conduce ? repoApi.manejo.ranking({ dias: 7 }) : Promise.resolve([]),
      ])
      const inspecciones = coleccionDePersona(insp, p.userId, ['conductorId'])
      // Las preventivas las abre el sistema por km o fecha: no tienen quien las reporte y no son de nadie,
      // así que no impiden contar las que sí abrió esta persona.
      const sinAutomaticas = odts.status === 'fulfilled' && Array.isArray(odts.value)
        ? { ...odts, value: odts.value.filter(o => o.creadorId || o.tipo !== 'preventiva') } : odts
      const ordenes = coleccionDePersona(sinAutomaticas, p.userId, ['creadorId'])
      const documentos = coleccionDePersona(docs, p.userId, ['personaId', 'titularId'])
      const score = manejo.status === 'fulfilled' ? manejo.value.find(s => s.id === p.userId) : null
      const credenciales = credencialesVigentes(p.credenciales)
      const licencia = credenciales.find(c => c.kind === 'driver_license')
      const medica = credenciales.find(c => c.kind === 'medical_certificate')
      const documentoLicencia = documentos.registros.find(d => d.tipo === 'licencia_conducir')
      const documentoMedico = documentos.registros.find(d => d.tipo === 'certificado_medico')
      return {
        ...p,
        administrable: lista.alcance?.administrable !== false,
        unidad: p.unidad ? { id: p.unidad, alias: p.unidadAlias ?? p.unidadNombre ?? p.unidad, placa: p.unidadPlaca ?? '' } : null,
        eventos: [],
        eventosDisponibles: false,
        eventosError: p.conduce ? 'El servidor todavía no entrega el detalle de eventos de manejo para este perfil.' : '',
        manejo: score,
        manejoError: manejo.status === 'rejected' ? manejo.reason.message : '',
        indiceFuente: 'conductor',
        inspecciones: inspecciones.registros,
        inspeccionesError: inspecciones.error,
        inspeccionesDisponibles: inspecciones.disponible,
        odts: ordenes.registros,
        odtsDisponibles: ordenes.disponible,
        odtsError: ordenes.error,
        documentos: documentos.registros,
        documentosError: documentos.error,
        direccion: p.direccion ?? null,
        fechaNacimiento: p.fechaNacimiento ?? null,
        credenciales,
        licenciaNumero: licencia?.number ?? documentoLicencia?.numero ?? null,
        licenciaCategoria: licencia?.category ?? null,
        licenciaVence: licencia?.expiresAt ?? documentoLicencia?.venceEn ?? null,
        cartaMedicaVence: medica?.expiresAt ?? documentoMedico?.venceEn ?? null,
        indiceSeguro: indiceDePersona(score),
        creadoEn: p.activadoEn ?? null,
      }
    },
    async listar({ q = '', rol = '', enteId = '', soloConductores = false } = {}) {
      // La lista de entes viaja en paralelo y se tolera su falta: sirve solo
      // para poner NOMBRE a la empresa de cada persona. Todas las filas de una
      // lectura pertenecen al mismo ente —el propio, o el contratista pedido—
      // asi que basta con encontrar ese uno.
      const [r, entes] = await Promise.all([
        api.directorio({ q, enteId }),
        api.entes().then((e) => e?.items ?? []).catch(() => []),
      ])
      const enteDeLaLista = r?.scope?.tenantId ?? enteId ?? null
      const empresa = entes.find((t) => t.id === enteDeLaLista) ?? null
      let lista = (r?.items ?? []).map((p) => ({
        id: p.userId,
        userId: p.userId,
        nombre: p.displayName,
        email: p.email,
        rol: p.role,
        rolEtiqueta: ETIQUETA_ROL[p.role] ?? p.role ?? '—',
        estado: p.status,
        activadoEn: p.activatedAt,
        empresaId: enteDeLaLista,
        // Sin nombre resuelto se deja vacio, no un texto inventado: el panel
        // muestra la fila igual y el hueco dice la verdad.
        empresaNombre: empresa?.name ?? null,
        credenciales: p.credentials ?? [],

        // Datos personales. Vienen NULOS cuando se lee un contratista: la
        // politica de fila de la base exige compartir ente, y una compania no
        // lo comparte con la gente ajena. Se ve quien es, no su cedula.
        cedula: p.nationalId ?? null,
        telefono: p.phone ?? null,
        direccion: p.address ?? null,
        fechaNacimiento: p.birthDate ?? null,
        perfilCompleto: Boolean(p.profileComplete),

        unidad: p.vehicleId ?? null,
        unidadNombre: [p.vehicleCode, p.vehiclePlate].filter(Boolean).join(' · ') || null,
        // Sueltos además de juntos: el expediente los pinta en dos líneas.
        unidadAlias: p.vehicleCode ?? null,
        unidadPlaca: p.vehiclePlate ?? null,
        rolEnUnidad: p.assignmentRole ?? null,
        conduce: Boolean(p.vehicleId) || p.role === 'conductor',

        // El papel que vence antes, con los dias que faltan calculados por la
        // base. Un numero negativo es un documento YA vencido.
        documentoTipo: p.nextDocumentType ?? null,
        documentoVence: p.nextDocumentExpiresOn ?? null,
        documentoDias:
          p.nextDocumentDaysToExpiry === null || p.nextDocumentDaysToExpiry === undefined
            ? null
            : Number(p.nextDocumentDaysToExpiry),
        papelesPendientes: Number(p.expiringDocumentCount ?? 0),
      }))
      if (rol) lista = lista.filter((p) => p.rol === rol)
      // Un supervisor no maneja: el selector de conductor de una unidad solo
      // ofrece a quien puede llevarla.
      if (soloConductores) lista = lista.filter((p) => p.rol === 'conductor')
      // El alcance viaja pegado a la lista: el panel necesita saber si puede
      // ofrecer botones o si esta mirando a un contratista.
      lista.alcance = {
        enteId: r?.scope?.tenantId ?? null,
        administrable: r?.scope?.writable !== false,
      }
      return lista
    },

    async actualizarPerfil(userId, { nombre, cedula, telefono, direccion, nacimiento }) {
      // El servidor exige `v-12345678` / `e-1234567` y `+584141234567`. La
      // gente escribe «V12345678» y «0414-1234567»: se traduce aquí, no se
      // rechaza.
      const ced = cedula === undefined || cedula === '' ? undefined : normalizarCedula(cedula)
      const tel = telefono === undefined || telefono === '' ? undefined : normalizarTelefono(telefono)
      const r = await api.actualizarPerfil(userId, {
        displayName: nombre,
        nationalId: ced,
        phone: tel,
        address: direccion,
        birthDate: nacimiento,
      })
      return {
        cedula: r?.profile?.nationalId ?? null,
        telefono: r?.profile?.phone ?? null,
        perfilCompleto: Boolean(r?.profile?.profileComplete),
      }
    },
  },

  avisosEscritura: {
    /**
     * Dar un aviso por visto. Marca para TODA la empresa: la base no guarda
     * quien lo leyo, porque el aviso describe algo de la flota y no del que
     * lo mira. Si un supervisor lo marca, deja de aparecerle a sus companeros.
     */
    async marcarLeida(avisoId) {
      await api.marcarAvisoLeido(avisoId)
      return true
    },
    async marcarTodasLeidas() {
      const r = await api.marcarTodosLosAvisos()
      return { marcados: r?.markedCount ?? 0 }
    },
    /** Descartar saca el aviso de la bandeja de ESTA persona; el hecho sigue. */
    async descartar(avisoId) {
      await api.descartarAviso(avisoId)
      return true
    },
    async descartarLeidos() {
      const r = await api.descartarAvisosLeidos()
      return { descartados: r?.dismissedCount ?? r?.markedCount ?? 0 }
    },
  },

  documentosEscritura: {
    async crear({ ambito, vehiculoId, personaId, tipo, numero, emitidoEn, venceEn, notas }) {
      const r = await api.crearDocumento({
        scope: ambito === 'persona' ? 'persona' : 'vehiculo',
        vehicleId: ambito === 'persona' ? undefined : vehiculoId,
        holderUserId: ambito === 'persona' ? personaId : undefined,
        documentType: tipo,
        documentNumber: numero || undefined,
        issuedOn: emitidoEn || undefined,
        expiresOn: venceEn,
        notes: notas || undefined,
      })
      return { id: r?.document?.id ?? null }
    },

    /** La correccion mas frecuente del modulo: mover el vencimiento. */
    async actualizarVencimiento(documentoId, venceEn) {
      await api.actualizarDocumento(documentoId, { expiresOn: venceEn })
      return true
    },

    async actualizar(documentoId, { numero, emitidoEn, venceEn, notas, estado }) {
      await api.actualizarDocumento(documentoId, {
        documentNumber: numero,
        issuedOn: emitidoEn,
        expiresOn: venceEn,
        notes: notas,
        status: estado,
      })
      return true
    },

    /** Archivar no borra: saca de la vigilancia y conserva el historial. */
    async archivar(documentoId) {
      await api.actualizarDocumento(documentoId, { status: 'archived' })
      return true
    },
  },

  // Desde la publicación del 18 de septiembre de 2026 el servidor solo
  // conoce reglas de «velocidad» y de «condicion» (una variable de telemetría
  // contra un umbral). Las reglas de mantenimiento por kilometraje dejaron de
  // ser reglas de alerta: ahora son PLANES de mantenimiento, con su propio
  // módulo en el servidor que el panel todavía no tiene.
  reglasEscritura: {
    async crear({ tipo, umbralKmh, activa = true, vehiculoIds = [] }) {
      if (tipo !== 'velocidad') {
        throw new Error(MANTENIMIENTO_ES_PLAN)
      }
      const r = await api.crearRegla({
        ruleType: 'velocidad',
        thresholdKph: Number(umbralKmh),
        isActive: activa,
        vehicleIds: vehiculoIds,
      })
      return { id: r?.alertRule?.id ?? null }
    },
    async set(reglaId, { umbralKmh, umbralKm, servicio, activa, vehiculoIds }) {
      if (umbralKm !== undefined || servicio !== undefined) {
        throw new Error(MANTENIMIENTO_ES_PLAN)
      }
      await api.actualizarRegla(reglaId, {
        thresholdKph: umbralKmh === undefined ? undefined : Number(umbralKmh),
        isActive: activa,
        vehicleIds: vehiculoIds,
      })
      return true
    },
    async eliminar(reglaId) {
      // Una regla no se borra: se desactiva. Borrarla dejaria sin explicacion
      // las alertas que ya genero.
      await api.actualizarRegla(reglaId, { isActive: false })
      return true
    },
  },

  gpsEscritura: {
    async disponibles() {
      return (await repoApi.gpsEscritura.listar()).filter(gpsDisponible)
    },
    /**
     * Inventario real desde `GET /gps-devices`. Antes «listar» caía en la
     * semilla vacía y el inventario salía en cero aunque hubiera equipos
     * instalados y reportando.
     */
    async listar({ q = '' } = {}) {
      const r = await api.equiposGps()
      const t = q.trim().toLowerCase()
      return (r?.devices ?? [])
        .map(comoEquipoGps)
        .filter((g) => !t || [g.imei, g.modelo, g.linea, g.vehiculoNombre].some((v) => String(v ?? '').toLowerCase().includes(t)))
    },
    /** Un equipo, con su instalación vigente (`GET gps-devices/:id`). */
    async obtener(equipoId) {
      // Si el detalle da 404 pero el equipo está en el inventario, se toma de la lista (T-208).
      const d = await buscarEquipoGps(equipoId, { detalle: api.equipoGps, lista: api.equiposGps })
      return d ? comoEquipoGps(d) : null
    },
    /**
     * Las últimas tramas del equipo, ya saneadas por el servidor: hora, vía,
     * tamaño y lectura. La huella SHA-256 solo llega si el servidor la manda.
     */
    async telemetria(equipoId, { limite = 50 } = {}) {
      const r = await api.telemetriaGps(equipoId, limite)
      return {
        conectado: Boolean(r?.connected),
        imei: r?.imei ?? null,
        ultimaRecepcion: r?.lastReceivedAt ?? null,
        frescuraS: Number(r?.freshnessSeconds) || 300,
        ubicacion: r?.location ?? null,
        mensajes: (r?.messages ?? []).map((m) => ({
          id: m.receiptId ?? m.id,
          recibido: m.receivedAt,
          via: String(m.transport ?? '').toUpperCase(),
          bytes: m.bytes ?? null,
          diagnostico: m.diagnostic ?? '',
          fresco: Boolean(m.isFresh),
          imeiCoincide: m.imeiMatches ?? true,
          huella: m.sha256 ?? null,
        })),
      }
    },
    async ultimaPosicion(equipoId) {
      const r = await api.ultimaPosicionGps(equipoId)
      return r?.position ? comoPosicionGps(r.position) : null
    },
    async posiciones(equipoId, { limite = 50 } = {}) {
      const r = await api.posicionesGps(equipoId, limite)
      return (r?.positions ?? []).map(comoPosicionGps)
    },
    /** Qué sabe hacer el equipo (pánico, PIN, encendido); `null` = sin confirmar. */
    async capacidades(equipoId) {
      const r = await api.capacidadesGps(equipoId)
      const c = r?.capabilities ?? {}
      return {
        panico: c.supportsPanicButton ?? null,
        pin: c.supportsDriverPin ?? null,
        encendido: c.supportsIgnitionSense ?? null,
        verificadasEn: c.verifiedAt ?? null,
      }
    },
    /** Abre (o retoma) la prueba de señal. El servidor la abre solo con el equipo instalado. */
    async iniciarPrueba(equipoId) {
      const r = await api.iniciarPruebaGps(equipoId)
      return { sesionId: r?.id ?? null, existente: Boolean(r?.existing) }
    },
    /** Cierra la prueba: aprobada activa el equipo; fallida lo deja en el inventario con su historial. */
    async completarPrueba(sesionId, { aprobada, motivo, notas } = {}) {
      const r = await api.completarPruebaGps(sesionId, {
        status: aprobada ? 'passed' : 'failed',
        ...(aprobada ? {} : { failureCode: motivo || 'manual_failure' }),
        ...(notas?.trim() ? { notes: notas.trim() } : {}),
      })
      return {
        estado: r?.status ?? null,
        estadoEquipo: r?.deviceStatus ?? null,
        huella: r?.sha256 ?? null,
        ultimaRecepcion: r?.lastReceivedAt ?? null,
      }
    },
    /** Unidades de una empresa para instalar, marcando las que ya llevan un equipo de este inventario. */
    async unidadesDe(empresaId) {
      const [paginas, equipos] = await Promise.all([
        leerTodasLasPaginas((desplazamiento, limite) => api.vehiculos({ enteId: empresaId, limite, desplazamiento })),
        api.equiposGps().then((r) => r?.devices ?? []).catch(() => []),
      ])
      const porUnidad = new Map(equipos.filter((d) => d.vehicleId).map((d) => [d.vehicleId, d]))
      return paginas.items.map((v) => {
        const d = porUnidad.get(v.id)
        return {
          id: v.id,
          alias: v.alias || v.fleetNumber || v.code || 'Sin nombre',
          placa: v.plate || '',
          marca: v.make || '',
          modelo: v.model || '',
          anio: v.modelYear ?? null,
          conductorNombre: null,
          gps: d ? { id: d.id, imei: d.imei } : null,
        }
      })
    },
    /** Instala el equipo en la unidad elegida, por la ruta de su empresa si no es la propia. */
    // `empresaId`: `null` = ruta propia (donde vive el equipo del inventario); un id = la ruta de esa
    // empresa. El servidor exige equipo y unidad en la misma empresa (ver instalarGps.js).
    async instalar(equipoId, { vehiculoId, empresaId, tecnico, ubicacion, notas, nombrePropia } = {}) {
      try {
        await api.instalarEquipoGps(equipoId, {
          vehicleId: vehiculoId,
          technician: tecnico?.trim() || undefined,
          installationLocation: ubicacion?.trim() || undefined,
          notes: notas?.trim() || undefined,
        }, empresaId)
      } catch (e) {
        throw new Error(mensajeInstalarGps(e, { otraEmpresa: Boolean(empresaId), nombrePropia }))
      }
      return true
    },
    async registrar({ imei, modelo, protocolo, fabricante, serie, linea, ...metadata }) {
      const r = await api.registrarEquipoGps({
        imei,
        model: modelo,
        protocolFamily: protocolo || 'coban-gps103',
        manufacturer: fabricante || undefined,
        serialNumber: serie || undefined,
        ...cambiosGps({ ...metadata, simPhone: linea || metadata.simPhone }),
      })
      return { id: r?.gpsDevice?.id ?? r?.device?.id ?? r?.id ?? null }
    },
    async asociar(equipoId, vehiculoId, notas, { tecnico, ubicacion } = {}) {
      await api.instalarEquipoGps(equipoId, {
        vehicleId: vehiculoId,
        notes: notas || undefined,
        technician: tecnico?.trim() || undefined,
        installationLocation: ubicacion?.trim() || undefined,
      })
      return true
    },
    async desmontar(instalacionId, notas, ubicacion) {
      await api.desmontarEquipoGps(instalacionId, { notes: notas || undefined, storageLocation: ubicacion?.trim() || undefined })
      return true
    },
    async set(equipoId, { estado, fabricante, serie, metadatos = {} }) {
      await api.actualizarEquipoGps(equipoId, {
        status: estado,
        manufacturer: fabricante,
        serialNumber: serie,
        ...metadatos,
      })
      return true
    },
  },

  empresas: {
    /**
     * Los tres tipos del panel son las tres categorias de la base:
     * «estandar» es un contratista, «predefinida» es una compania (la que
     * cuelga contratistas de si misma) y «personal» es la de una persona.
     */
    async listar({ q = '', tipo = '' } = {}) {
      const r = await api.entes()
      return (r?.items ?? []).map((t) => ({
        id: t.id,
        nombre: t.name,
        codigo: t.code,
        tipo:
          t.category === 'compania'
            ? 'predefinida'
            : t.category === 'personal'
              ? 'personal'
              : 'estandar',
        estado: t.status,
        servicioActivo: t.status === 'active',
        rif: t.rif ?? '',
        telefono: t.phone ?? '',
        email: t.email ?? '',
        contacto: t.contactName ?? '',
        creadoEn: t.createdAt ?? null,
        // «home» es el ente propio; «contractor», uno colgado de mi compañia.
        alcance: t.scopeKind ?? 'home',
      })).filter(t => (!tipo || t.tipo === tipo) && (!q.trim() || [t.nombre, t.rif, t.contacto, t.email].some(v => String(v ?? '').toLowerCase().includes(q.trim().toLowerCase()))))
    },

    async crear({ nombre, tipo, rif, contacto, telefono, email }) {
      const r = await api.crearEnte({
        name: nombre,
        category:
          tipo === 'predefinida'
            ? 'compania'
            : tipo === 'personal'
              ? 'personal'
              : 'contratista',
        rif: rif || undefined,
        phone: telefono || undefined,
        email: email || undefined,
        contactName: contacto || undefined,
      })
      return { id: r?.tenantId ?? r?.tenant?.id ?? null }
    },

    /** Suspender o reactivar el servicio de un ente. */
    async setServicio(id, activo, _actor, razon) {
      await api.actualizarEnte(id, {
        status: activo ? 'active' : 'suspended',
        reason: motivo(razon, 'cambio-de-servicio-desde-consola'),
      })
      return true
    },

    async eliminar(id, _actor, razon) {
      // Un ente con historial no se borra. Suspenderlo lo saca de operacion
      // y deja el rastro en pie, que es lo que la auditoria necesita.
      await api.actualizarEnte(id, {
        status: 'suspended',
        reason: motivo(razon, 'ente-retirado-desde-consola'),
      })
      return true
    },

    /** Colgar un contratista de una compania. */
    async asignar(companiaId, contratistaId) {
      await api.colgarContratista(companiaId, {
        contractorTenantId: contratistaId,
      })
      return true
    },

    async desasignar(relacionId, razon) {
      await api.descolgarContratista(relacionId, {
        reason: razon ? motivo(razon) : undefined,
      })
      return true
    },

    async asignarPredefinidas(companiaId, contratistas = []) {
      for (const contratistaId of contratistas) {
        await api.colgarContratista(companiaId, {
          contractorTenantId: contratistaId,
        })
      }
      return true
    },
  },

  areasEscritura: {
    // Tipos que admite el servidor: ubicacion | sector | contrato.
    async crear(tenantId, { nombre, tipo = 'ubicacion' }) {
      const r = await api.crearArea(tenantId, { name: nombre, kind: tipo })
      return { id: r?.areaId ?? r?.area?.id ?? null }
    },
    async set(areaId, { nombre, tipo, estado }) {
      await api.actualizarArea(areaId, {
        name: nombre,
        kind: tipo,
        status: estado,
      })
      return true
    },
  },

  vehiculosEscritura: {
    /** Alta independiente; efectos posteriores informados sin repetir el alta. */
    async crear(datos) {
      return crearUnidad(datos, api)
    },

    async set(id, parche) {
      await api.actualizarVehiculo(id, {
        plate: placaMayuscula(parche.placa),
        alias: parche.alias,
        fleetNumber: parche.numero === undefined ? undefined : parche.numero?.trim() || null,
        make: parche.marca,
        model: parche.modelo,
        modelYear: parche.anio ? Number(parche.anio) : undefined,
        vehicleType: parche.tipo,
        areaId: parche.areaId,
      })
      return true
    },

    /** El area del vehiculo es un campo suyo, no una tabla aparte. */
    async asignarArea(id, areaId) {
      await api.actualizarVehiculo(id, { areaId: areaId || null })
      return true
    },

    /**
     * Asignar conductor. Sin `userId` la intencion es DESASIGNAR, y eso el
     * servidor no lo hace borrando sino revocando la asignacion vigente, que
     * es la que deja rastro de quien manejo y hasta cuando.
     */
    async asignarConductor(id, userId, { rol = 'principal', pin } = {}) {
      if (rol === 'principal') return asignarPrincipal(api, id, userId)
      if (!userId) {
        // Quitar = REVOCAR la asignación vigente, con fecha y rastro, que es
        // el paso de la app. Se busca la asignación abierta de la unidad.
        // Antes de escribir, lo vigente de verdad: todas las páginas y sin lo guardado.
        const vigentes = await asignacionesVigentes({ fresco: true }).then((l) => l.filter((c) => c.vehicleId === id))
        if (vigentes.length === 0) return true
        const principal = vigentes.find((c) => c.role === 'principal') ?? vigentes[0]
        await api.revocarAsignacion(principal.assignmentId, { reason: 'quitado-desde-consola' })
        return true
      }
      // AssignDriverDto: userId, role, pin. No admite `reason`: mandarlo
      // es un 400 «property reason should not exist».
      try {
        await api.asignarConductor(id, {
          userId,
          role: rol,
          pin: pin || undefined,
        })
      } catch (error) {
        if (error.message?.includes('already has an active principal driver')) {
          throw new Error('Esta unidad ya tiene conductor principal. Selecciona «Sin conductor» y confirma «Quitar asignación»; después elige al nuevo conductor y pulsa «Asignar».')
        }
        throw error
      }
      return true
    },

    /** Qué impide archivar la unidad (jornadas, asignaciones, GPS, órdenes, emergencias abiertas). */
    async preflightArchivo(id) {
      const r = await api.preflightArchivoVehiculo(id)
      return {
        estadoActual: r?.currentStatus ?? null,
        sePuede: Boolean(r?.canArchive),
        bloqueos: r?.blockers ?? {},
      }
    },
    /** Archivar: la unidad sale de la operación y conserva su historial. */
    async archivar(id, { estadoActual, motivo: razon }) {
      await api.archivarVehiculo(id, { expectedStatus: estadoActual, reason: motivo(razon || '', 'archivada-desde-consola') })
      return true
    },
    async revocarAsignacion(asignacionId, razon) {
      await api.revocarAsignacion(asignacionId, { reason: razon ? motivo(razon) : undefined })
      return true
    },
  },

  odts: {
    /**
     * Cambio de estado con el estado que se vio (`expectedStatus`) y una nota
     * que queda en el historial. Es la misma ruta que usa la app.
     */
    async cambiarEstado(id, nuevo, { estadoActual, nota, notaSolucion, costo, moneda, odometro } = {}) {
      const r = await api.moverOdt(id, {
        expectedStatus: estadoActual,
        status: nuevo,
        note: nota,
        resolutionNote: notaSolucion || undefined,
        resolutionCost: costo === undefined || costo === null || costo === '' ? undefined : Number(costo),
        resolutionCurrency: costo === undefined || costo === null || costo === '' ? undefined : moneda || 'USD',
        completionOdometerKm: odometro === undefined || odometro === null || odometro === '' ? undefined : Number(odometro),
      })
      return { estado: r?.workOrder?.status ?? null }
    },
    /**
     * Quién es el responsable vigente y qué pasó en el taller. Solo el
     * responsable puede iniciar, pausar, reanudar o entregar (así lo exige
     * el servidor, igual que la app); el gestor lo ve.
     */
    /**
     * El historial COMPLETO de la orden, tal como lo guarda la base: cada cambio de estado con quién lo hizo,
     * cuándo y la nota. El servidor lo devuelve junto con la orden (`events`), del primero al último.
     */
    async historial(id) {
      const r = await api.odt(id)
      return (r?.events ?? []).map((e) => ({
        n: e.sequence,
        de: e.fromStatus ?? null,
        a: e.toStatus,
        nota: e.note ?? '',
        en: e.occurredAt,
        actor: e.actorName ?? null,
      }))
    },
    async ejecucion(id) {
      const r = await api.ejecucionOdt(id)
      const vigente = (r?.assignments ?? []).find((a) => !a.endedAt) ?? null
      return {
        estado: r?.workOrder?.status ?? null,
        responsable: vigente ? { id: vigente.userId, nombre: vigente.displayName, desde: vigente.assignedAt } : null,
        eventos: (r?.events ?? []).map((e) => ({
          id: e.id,
          tipo: e.eventKind,
          de: e.fromStatus,
          a: e.toStatus,
          nota: e.note ?? '',
          actor: e.actorName ?? '—',
          en: e.occurredAt,
        })),
        totales: r?.totals ?? null,
      }
    },
    /** Aprobada → asignada (o reasignar): quién ejecuta el trabajo. */
    async asignarResponsable(id, { usuarioId, nota }) {
      const r = await api.asignarResponsableOdt(id, { userId: usuarioId, note: nota || undefined })
      return { estado: r?.workOrder?.status ?? null }
    },
    /** Evento de ejecución desde el taller: inicio, pausa, reanudación, entrega. */
    async ejecutar(odt, accion, nota) {
      const r = await api.ejecutarOdt(odt.id, {
        clientEventId: uuid(),
        action: accion,
        expectedStatus: odt.estado,
        note: nota || undefined,
      })
      return { estado: r?.workOrder?.status ?? null }
    },
    /**
     * Con `vehiculoId`, solo las de esa unidad (lo filtra el servidor). Con
     * `desde` (AAAA-MM-DD), solo las creadas desde ese día: se leen páginas
     * mientras sigan siendo de ese día o posteriores.
     */
    async listar({ estado = '', q = '', vehiculoId = '', desde = '' } = {}) {
      try {
        const corte = desde ? new Date(`${desde}T00:00:00`).getTime() : null
        const r = { items: await listarTodasOdts(api, { estado, vehiculoId }, { parar: corte == null ? null : pararAntesDe(corte) }) }
        let lista = (r?.items ?? []).map((o) => ({
          id: o.id,
          estado: o.status,
          planId: o.maintenancePlanId ?? null,
          prioridad: o.severity ?? null,
          responsableId: o.assigneeUserId ?? null,
          responsable: o.assigneeDisplayName ?? o.assigneeName ?? null,
          tipo: o.kind,
          descripcion: o.description,
          falla: o.failureType,
          tipoFalla: o.failureType,
          ubicacion: o.location,
          notaResolucion: o.resolutionNote,
          notaSolucion: o.resolutionNote,
          costo: o.resolutionCost,
          resueltaEn: o.resolvedAt,
          creadaEn: o.createdAt,
          vehiculoId: o.vehicleId,
          vehiculoNombre: [o.vehicleCode, o.vehiclePlate].filter(Boolean).join(' · ') || '—',
          creadorNombre: o.createdByName || 'Sistema',
          creadorId: o.createdByUserId ?? null,
        }))
        if (corte != null) lista = lista.filter((o) => Date.parse(o.creadaEn) >= corte)
        if (q) {
          const t = q.toLowerCase()
          lista = lista.filter((o) =>
            [o.descripcion, o.vehiculoNombre].join(' ').toLowerCase().includes(t))
        }
        if (r.items.incompleta) lista.incompleta = true
        return lista
      } catch (error) {
        throw error
      }
    },

    /**
   * Abrir una orden. El servidor decide el estado inicial y el histórico:
   * aquí solo viaja lo que el supervisor escribió.
   */
    async crear({ vehiculoId, descripcion, tipoFalla, ubicacion, tipo, prioridad, comoConductor = false }) {
      // El conductor tiene su propia ruta (solo su unidad asignada); la consola general es del supervisor.
      if (comoConductor) {
        const c = await api.reportarFallaConductor(vehiculoId, {
          description: descripcion,
          severity: prioridad || undefined,
          failureType: tipoFalla || undefined,
          location: ubicacion || undefined,
        })
        return { id: c?.workOrderId ?? c?.workOrder?.id ?? null, estado: c?.workOrder?.status ?? 'abierta' }
      }
      const r = await api.crearOdt({
        vehicleId: vehiculoId,
        description: descripcion,
        kind: tipo || 'correctiva',
        // baja | media | alta. El servidor pone «media» si no viaja.
        severity: prioridad || undefined,
        failureType: tipoFalla || undefined,
        location: ubicacion || undefined,
      })
      return { id: r?.workOrder?.id ?? null, estado: r?.workOrder?.status ?? null }
    },

    /**
     * Mover la orden de estado. `estadoEsperado` es el que el panel acaba de
     * leer: si otro lo movio mientras tanto, el servidor responde 409 en vez
     * de pisar su trabajo.
     */
    async mover(id, { estadoEsperado, estado, nota, notaResolucion, costo, moneda }) {
      const r = await api.moverOdt(id, {
        expectedStatus: estadoEsperado,
        status: estado,
        note: nota,
        resolutionNote: notaResolucion || undefined,
        resolutionCost: costo === undefined || costo === null || costo === ''
          ? undefined
          : Number(costo),
        resolutionCurrency: moneda || undefined,
      })
      return { estado: r?.workOrder?.status ?? null }
    },

    async obtener(id) {
      const r = await api.odt(id)
      const o = r.workOrder
      return {
        id: o.id,
        estado: o.status,
        tipo: o.kind,
        descripcion: o.description,
        falla: o.failureType,
        planId: o.maintenancePlanId ?? null,
        ubicacion: o.location,
        notaResolucion: o.resolutionNote,
          notaSolucion: o.resolutionNote,
        costo: o.resolutionCost,
        resueltaEn: o.resolvedAt,
        creadaEn: o.createdAt,
        vehiculoId: o.vehicleId,
        vehiculoNombre: [o.vehicleCode, o.vehiclePlate].filter(Boolean).join(' · ') || '—',
        creadorNombre: o.createdByName || 'Sistema',
        // El historial es inmutable: lo escribe la base al cambiar el estado.
        eventos: (r.events ?? []).map((e) => ({
          orden: e.sequence,
          de: e.fromStatus,
          a: e.toStatus,
          nota: e.note,
          cuando: e.occurredAt,
          quien: e.actorName || 'Sistema',
        })),
      }
    },
  },

  inspecciones: {
    async obtener(id) {
      const r = await api.inspeccion(id)
      return (r.findings ?? []).map(i => ({ id: i.id, nombre: i.name, categoria: i.category, critico: i.isCritical, estadoItem: i.itemState, nota: i.note, evidencias: i.evidence ?? [] }))
    },
    /**
     * Unidades sin inspección de hoy: la flota menos las que ya tienen una
     * inspección con fecha de hoy. Es una LECTURA; antes caía en el rechazo
     * genérico de escritura y tumbaba la pantalla entera de Inspecciones.
     */
    async pendientesHoy() {
      const hoy = hoyISO()
      const [flota, hechas] = await Promise.all([
        repoApi.vehiculos.listar(),
        // El día completo (desde las 00:00), no las últimas 100: con una flota
        // grande, las de la mañana quedaban fuera y esas unidades salían «sin la diaria».
        repoApi.inspecciones.listar({ desde: hoy, hasta: hoy }),
      ])
      const revisadas = new Set(hechas.filter((i) => String(i.fecha ?? '').slice(0, 10) === hoy).map((i) => i.vehiculoId))
      const faltan = flota.filter((v) => !revisadas.has(v.id))
      if (hechas.incompleta || flota.incompleta) faltan.incompleta = true
      return faltan
    },
    /**
     * Con `desde`/`hasta` (YYYY-MM-DD) se lee el periodo entero: el servidor no
     * filtra por fecha, pero ordena de la más nueva a la más vieja, así que se
     * pasan páginas de 200 hasta cruzar `desde`. Una lectura por periodo, no
     * una por día ni por persona. Sin `desde`, la lectura de siempre (100).
     */
    async listar({ vehiculoId = '', fecha = '', q = '', desde = '', hasta = '' } = {}) {
      try {
        const r = desde ? await inspeccionesDelPeriodo({ vehiculoId, desde }) : await api.inspecciones({ vehiculoId })
        const lista = (r?.items ?? []).map((i) => ({
          id: i.id,
          resultado: i.result,
          fecha: i.inspectionDate,
          ubicacion: i.location,
          enviadaEn: i.submittedAt,
          creadaEn: i.submittedAt ?? i.inspectionDate,
          vehiculoId: i.vehicleId,
          vehiculoNombre: [i.vehicleCode, i.vehiclePlate].filter(Boolean).join(' · ') || '—',
          conductorNombre: i.driverName || '—',
          conductorId: i.driverUserId ?? null,
          plantilla: i.templateName,
          // «daily» (la diaria de cada conductor) o «scheduled» (la que fija el supervisor): lo clasifica el servidor.
          clase: i.kind ?? null,
          // GET /inspections no trae conteos ni tipo de unidad (solo resultado, unidad, conductor y plantilla).
          // Se dejan en null, no en 0: «sin dato» no es «sin fallas». El detalle los cuenta de sus respuestas.
          fallasCriticas: null,
          observaciones: null,
          tipoVehiculo: null,
        })).filter(i => !fecha || String(i.fecha).slice(0, 10) === fecha)
          .filter(i => !desde || String(i.fecha).slice(0, 10) >= desde)
          .filter(i => !hasta || String(i.fecha).slice(0, 10) <= hasta)
          .filter(i => !q || `${i.vehiculoNombre} ${i.conductorNombre}`.toLowerCase().includes(q.toLowerCase()))
        // Si se agotó el tope de páginas sin llegar a `desde`, la pantalla lo dice en vez de contar «no hecha».
        if (r?.incompleta) lista.incompleta = true
        return lista
      } catch (error) {
        throw error
      }
    },
  },

  documentos: {
    /**
     * Lista con el vocabulario de la pantalla: `titular`, `venceEn` y un
     * `estado` de vigilancia (vigente | por_vencer | vencido) calculado con
     * los días que manda la base, no con el reloj del navegador. Los
     * archivados no se listan: salieron de la vigilancia.
     */
    async listar({ vehiculoId = '', ambito = '', estado = '', q = '' } = {}) {
      try {
        const r = await api.documentos({ vehiculoId })
        const t = q.trim().toLowerCase()
        return (r?.items ?? [])
          .filter((d) => d.status !== 'archived')
          .map((d) => {
            const dias = d.daysToExpiry
            const vigilancia = dias == null ? 'vigente' : dias < 0 ? 'vencido' : dias <= 30 ? 'por_vencer' : 'vigente'
            const titular = d.scope === 'persona'
              ? d.holderDisplayName || d.holderName || '—'
              : [d.vehicleCode, d.vehiclePlate].filter(Boolean).join(' · ') || '—'
            return {
              id: d.id,
              ambito: d.scope,
              tipo: d.documentType,
              numero: d.documentNumber,
              emitidoEl: d.issuedOn,
              emitidoEn: d.issuedOn,
              venceEl: d.expiresOn,
              venceEn: d.expiresOn,
              diasParaVencer: dias,
              estado: vigilancia,
              activo: d.status,
              notas: d.notes,
              titular,
              titularId: d.scope === 'persona' ? d.holderUserId ?? null : d.vehicleId ?? null,
              personaId: d.holderUserId ?? null,
              vehiculoId: d.vehicleId,
              vehiculoNombre: [d.vehicleCode, d.vehiclePlate].filter(Boolean).join(' · ') || '—',
              archivos: d.fileCount,
            }
          })
          .filter((d) => !ambito || d.ambito === ambito)
          .filter((d) => !estado || d.estado === estado)
          .filter((d) => !t || [d.tipo, d.titular, d.numero].join(' ').toLowerCase().includes(t))
      } catch (error) {
        throw error
      }
    },
  },

  alertas: {
    async eventos({ dias = 30 } = {}) {
      const corte = Date.now() - dias * 86400000
      const items = []
      let offset = 0
      // La ruta no filtra por fecha. Si llega del más nuevo al más viejo, al pasar
      // el corte ya no queda nada útil y se deja de pedir; si el orden no es ese,
      // se baja todo como antes para no perder eventos.
      let descendente = true
      let previo = Infinity
      while (true) {
        const r = await api.eventosDeAlerta({ limit: 100, offset })
        const page = r.items ?? []
        items.push(...page)
        offset += page.length
        for (const e of page) {
          const t = new Date(e.occurredAt).getTime()
          if (!Number.isFinite(t)) continue
          if (t > previo) descendente = false
          previo = t
        }
        if (!page.length || offset >= (r.page?.total ?? offset)) break
        if (descendente && previo < corte) break
      }
      return items.filter(e => new Date(e.occurredAt).getTime() >= corte).map(e => ({ id: e.id, vehiculoId: e.vehicleId, vehiculo: e.vehicleId ? { id: e.vehicleId, alias: e.vehicleCode || e.vehiclePlate } : null, clave: e.ruleType === 'velocidad' ? 'exceso_velocidad' : 'condicion', nombre: e.ruleType === 'velocidad' ? 'Exceso de velocidad' : 'Condición de telemetría', severidad: e.severity === 'critical' ? 'alta' : e.severity === 'warning' ? 'media' : 'baja', valor: e.observedValue, creadaEn: e.occurredAt, conductorNombre: e.driverName ?? 'Sin dato', ubicacion: e.location ?? 'Sin dato' }))
    },
    async listar({ soloSinLeer = false } = {}) {
      try {
        const r = await api.notificaciones({ soloSinLeer })
        return (r?.items ?? []).map((n) => ({
          id: n.id,
          tipo: n.notificationType,
          titulo: n.title,
          detalle: n.detail,
          odtId: n.workOrderId,
          leidaEn: n.readAt,
          creadaEn: n.createdAt,
        }))
      } catch (error) {
        throw error
      }
    },
  },

  reglas: {
    async listar() {
      try {
        const r = await api.reglasAlerta()
        return (r?.items ?? []).map((g) => ({
          id: g.id,
          tipo: g.ruleType,
          umbralKmh: g.thresholdKph,
          umbralKm: g.thresholdKm,
          servicio: g.serviceName,
          activa: g.isActive,
          vehiculos: g.vehicleCount,
        }))
      } catch (error) {
        throw error
      }
    },
  },

  /** Resumen con lo que la base puede afirmar hoy. */
  async resumen() {
    const [lista, areas, operacion] = await Promise.all([
      // Con los conductores ya unidos: `flota()` cruda dice «Sin asignar»
      // para todas y el contador de «sin conductor» salía inflado.
      repoApi.vehiculos.listar(),
      repoApi.areas().catch(() => []),
      // Si los contadores fallan, el panel muestra el resto igual.
      api.resumenOperacion(),
    ])
    const reportando = lista.filter((v) => v.conectado).length
    const sabeMarcha = lista.some((v) => v.estadoMarcha != null)
    return {
      totalVehiculos: lista.length,
      reportando,
      sinSenal: lista.length - reportando,
      conPosicion: lista.filter((v) => v.lat != null).length,
      // `null` mientras la velocidad no se guarde: contar cero en marcha sería
      // afirmar que la flota está parada, y lo cierto es que no se sabe.
      enMarcha: sabeMarcha
        ? lista.filter((v) => v.estadoMarcha === 'en_marcha').length
        : null,
      detenidos: sabeMarcha
        ? lista.filter((v) => v.estadoMarcha === 'parada').length
        : null,
      conductores: null,
      sinConductor: lista.filter((v) => v.conductorNombre === 'Sin asignar').length,
      porArea: areas.map((a) => ({ area: a.nombre, total: a.vehiculos })),
      // Contadores reales de operación, todos del mismo instante.
      ...operacion,
      // Sin respaldo todavía.
      indiceSeguroPromedio: null,
      unidadesBloqueadas: null,
    }
  },
}


// ============================================================
// Lo que el administrador FOM ve en la consola de Juan (paridad web,
// 18 sep 2026), traducido al vocabulario del panel. Cada módulo devuelve
// filas en español y deja los catálogos cerrados como los manda el servidor.
// ============================================================

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const h = () => Math.floor(Math.random() * 16).toString(16)
  const s = (n) => Array.from({ length: n }, h).join('')
  return `${s(8)}-${s(4)}-4${s(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${s(3)}-${s(12)}`
}

const pagina = (r) => ({
  total: r?.page?.total ?? (r?.items?.length ?? 0),
  limite: r?.page?.limit ?? null,
  desde: r?.page?.offset ?? 0,
})

Object.assign(repoApi, {
  /** Bitácora real del ente (`GET /audit`), en el vocabulario de la pantalla. */
  auditoria: {
    async listar({ tipo = '', q = '' } = {}) {
      const r = await api.auditoria({ action: tipo || undefined })
      const t = q.trim().toLowerCase()
      const lista = (r?.items ?? []).map((e) => ({
        id: e.id,
        tipo: e.action,
        objetivo: `${e.entityType ?? ''}${e.entityId ? ` ${String(e.entityId).slice(0, 8)}` : ''}`.trim() || '—',
        detalle: resumirCambios(e.changes),
        actorNombre: e.actorName ?? (e.actorKind === 'system' ? 'Sistema' : e.actorUserId?.slice(0, 8) ?? '—'),
        empresaNombre: '',
        fecha: e.occurredAt,
      }))
      const tipos = [...new Set((r?.items ?? []).map((e) => e.action))].sort()
      const salida = t ? lista.filter((a) => [a.objetivo, a.detalle, a.actorNombre, a.tipo].join(' ').toLowerCase().includes(t)) : lista
      salida.tipos = tipos
      return salida
    },
  },

  /** Eventos de alerta (reglas que se cumplieron) y emergencias (SOS). */
  seguridad: {
    async eventos({ estado = '', severidad = '', vehiculoId = '' } = {}) {
      const r = await api.eventosDeAlerta({ status: estado, severity: severidad, vehicleId: vehiculoId })
      const lista = (r?.items ?? []).map((e) => ({
        id: e.id,
        tipo: e.ruleType,
        vehiculoId: e.vehicleId ?? null,
        vehiculo: e.vehicleCode,
        placa: e.vehiclePlate ?? null,
        severidad: e.severity,
        valor: e.observedValue ?? null,
        estado: e.status,
        ocurrioEn: e.occurredAt,
        odtId: e.workOrderId ?? null,
      }))
      lista.pagina = pagina(r)
      return lista
    },
    async reconocerEvento(id) {
      await api.reconocerEventoDeAlerta(id)
      return true
    },
    async resolverEvento(id) {
      await api.resolverEventoDeAlerta(id)
      return true
    },
    async emergencias({ estado = '' } = {}) {
      const r = await api.emergencias({ status: estado })
      return (r?.items ?? []).map(emergenciaParaConsola)
    },
    async reconocerEmergencia(id) {
      await api.reconocerEmergencia(id)
      return true
    },
    async resolverEmergencia(id) {
      await api.resolverEmergencia(id)
      return true
    },
  },

  /** Jornadas de conducción: quién manejó qué unidad y cuándo. */
  jornadas: {
    async listar({ estado = '', vehiculoId = '', usuarioId = '', limite = 100, desplazamiento = 0 } = {}) {
      const r = await api.jornadas({ status: estado, vehicleId: vehiculoId, userId: usuarioId, limit: limite, offset: desplazamiento })
      const lista = (r?.items ?? []).map((j) => ({
        id: j.id,
        usuarioId: j.userId ?? j.driverUserId ?? null,
        conductor: j.displayName ?? '—',
        vehiculo: j.vehicleCode,
        placa: j.vehiclePlate ?? null,
        rol: j.assignmentRole,
        origen: j.source,
        estado: j.status,
        inicio: j.startedAt,
        fin: j.endedAt ?? null,
      }))
      lista.pagina = pagina(r)
      return lista
    },
  },

  /** Planes de mantenimiento y sus acciones (lo que antes eran «reglas de mantenimiento»). */
  planes: {
    async listar({ q = '' } = {}) {
      const r = await api.planesDeMantenimiento({ q })
      return (r?.items ?? []).map((p) => ({
        id: p.id,
        codigo: p.code,
        servicio: p.serviceName,
        descripcion: p.description ?? '',
        estrategia: p.strategy,
        cadaKm: p.intervalKm ?? null,
        cadaDias: p.intervalDays ?? null,
        criticidad: p.criticality,
        activo: Boolean(p.enabled),
        unidades: Number(p.vehicleCount ?? 0),
      }))
    },
    /** PUT idempotente: mismo id, mismo plan. Sin id, es un plan nuevo. */
    async guardar({ id, codigo, servicio, descripcion, estrategia, cadaKm, cadaDias, criticidad, activo = true }) {
      const planId = id || uuid()
      const r = await api.guardarPlanDeMantenimiento(planId, {
        code: validarCodigoPlan(normalizarCodigoPlan(codigo)),
        serviceName: servicio,
        description: descripcion || undefined,
        strategy: estrategia,
        intervalKm: cadaKm ? Number(cadaKm) : undefined,
        intervalDays: cadaDias ? Number(cadaDias) : undefined,
        criticality: criticidad,
        enabled: Boolean(activo),
      })
      return { id: r?.plan?.id ?? planId }
    },
    /** Apaga o vuelve a encender un plan sin tocar el resto de sus datos. */
    async encender(plan, activo) {
      return repoApi.planes.guardar({ id: plan.id, codigo: plan.codigo, servicio: plan.servicio, descripcion: plan.descripcion, estrategia: plan.estrategia, cadaKm: plan.cadaKm, cadaDias: plan.cadaDias, criticidad: plan.criticidad, activo })
    },
    async cubrirUnidad(planId, vehiculoId, { ultimoServicioKm, proximoKm, proximaFecha } = {}) {
      await api.cubrirUnidadEnPlan(planId, vehiculoId, {
        lastServiceOdometerKm: ultimoServicioKm === undefined || ultimoServicioKm === null || ultimoServicioKm === '' ? undefined : Number(ultimoServicioKm),
        nextDueOdometerKm: proximoKm === undefined || proximoKm === null || proximoKm === '' ? undefined : Number(proximoKm),
        nextDueAt: proximaFecha ? new Date(proximaFecha).toISOString() : undefined,
        enabled: true,
      })
      return true
    },
    async quitarUnidad(planId, vehiculoId) {
      await api.quitarUnidadDePlan(planId, vehiculoId)
      return true
    },
    async acciones({ vehiculoId = '', estado = '', q = '' } = {}) {
      const r = await api.accionesDeMantenimiento({ vehicleId: vehiculoId, status: estado, q })
      return (r?.items ?? []).map((a) => ({
        id: a.id,
        vehiculoId: a.vehicleId,
        vehiculo: a.vehicleCode,
        placa: a.plate ?? null,
        planId: a.planId ?? null,
        plan: a.planName ?? null,
        ciclo: a.cycleOrdinal ?? null,
        odtId: a.workOrderId ?? null,
        tipo: a.kind,
        titulo: a.title,
        detalle: a.detail ?? '',
        relevancia: a.relevance,
        estado: a.status,
        venceKm: a.dueOdometerKm ?? null,
        venceEn: a.dueAt ?? null,
        avance: a.progressRatio ?? null,
        costo: a.costAmount ?? null,
        moneda: a.costCurrency ?? null,
      }))
    },
    async crearAccion({ vehiculoId, planId, ciclo, tipo = 'preventive', titulo, detalle, relevancia = 'medium', venceKm, venceEn, costo, moneda }) {
      if ((venceKm === undefined || venceKm === null || venceKm === '') && !venceEn) {
        throw new Error('Indica cuándo vence la acción: kilometraje, fecha o ambos.')
      }
      if (tipo === 'preventive' && (!planId || !Number.isInteger(Number(ciclo)) || Number(ciclo) < 1)) {
        throw new Error('Una acción preventiva necesita un plan y un número de ciclo mayor que cero.')
      }
      const actionId = uuid()
      await api.guardarAccionDeMantenimiento(actionId, {
        vehicleId: vehiculoId,
        planId: planId || undefined,
        kind: tipo,
        cycleOrdinal: tipo === 'preventive' ? Number(ciclo) : undefined,
        title: titulo,
        detail: detalle || undefined,
        relevance: relevancia,
        dueOdometerKm: venceKm === undefined || venceKm === null || venceKm === '' ? undefined : Number(venceKm),
        // Mediodía UTC: a medianoche UTC, en Venezuela (UTC-4) la fecha se veía un día antes.
        dueAt: venceEn ? new Date(`${String(venceEn).slice(0, 10)}T12:00:00.000Z`).toISOString() : undefined,
        costAmount: costo === undefined || costo === null || costo === '' ? undefined : Number(costo),
        costCurrency: costo === undefined || costo === null || costo === '' ? undefined : moneda || 'USD',
      })
      return { id: actionId }
    },
    /** in_progress | completed | dismissed, con el estado esperado para no pisar a nadie. */
    async moverAccion(accion, destino, nota) {
      await api.moverAccionDeMantenimiento(accion.id, {
        expectedStatus: accion.estado,
        status: destino,
        note: nota,
        // El servidor solo acepta `progressRatio` mientras la acción sigue en curso: al completarla se rechaza
        // («Progress only applies while in progress»). Completar no lleva avance.
      })
      return true
    },
    /** Abre una ODT preventiva vinculada a la acción. */
    async odtDesdeAccion(accion) {
      const r = await api.crearOdt({
        vehicleId: accion.vehiculoId,
        maintenanceActionId: accion.id,
        description: accion.detalle && accion.detalle.length >= 10 ? accion.detalle : `Ejecutar acción de mantenimiento: ${accion.titulo}`,
        kind: 'preventiva',
        severity: accion.relevancia === 'critical' || accion.relevancia === 'high' ? 'alta' : 'media',
      })
      return { id: r?.workOrder?.id ?? null }
    },
  },

  /** Transferencias de personas y vehículos entre entes, a doble control. */
  transferencias: {
    /** Read candidates from the selected, server-authorized tenant, never the session fleet. */
    async opciones({ tipo, origenId }) {
      if (!origenId) return []
      const lista = []
      let desplazamiento = 0
      while (true) {
        const parametros = { enteId: origenId, limite: 200, desplazamiento }
        const r = await (tipo === 'identidad' ? api.directorio(parametros) : api.vehiculos(parametros))
        const items = r?.items ?? []
        lista.push(...items)
        desplazamiento += items.length
        if (!items.length || desplazamiento >= (r?.page?.total ?? desplazamiento)) break
      }
      return tipo === 'identidad'
        ? lista.filter(p => p.role !== 'admin_fom').map(p => ({ id: p.userId, nombre: `${p.displayName} · ${p.email}`, empresaId: origenId }))
        : lista.map(v => ({ id: v.id, nombre: `${v.alias || v.fleetNumber || v.code} · ${v.plate || 'Sin placa'}`, empresaId: origenId }))
    },
    identidad: {
      async listar({ estado = '' } = {}) {
        const r = await api.transferenciasDeIdentidad({ status: estado })
        return (r?.items ?? []).map(comoTransferencia)
      },
      async crear({ usuarioId, origenId, destinoId, rolDestino, motivo: motivo_ }) {
        const r = await api.crearTransferenciaDeIdentidad({
          userId: usuarioId,
          originTenantId: origenId,
          destinationTenantId: destinoId,
          destinationRole: rolDestino,
          reason: motivo(motivo_ || '', 'transferencia'),
        })
        return { id: r?.transfer?.id ?? null }
      },
      async decidir(t, paso, motivo_) {
        const cierre = paso === 'rejection' || paso === 'cancellation'
        await api.decidirTransferenciaDeIdentidad(t.id, paso, {
          expectedVersion: t.version,
          ...(cierre ? { reason: motivo(motivo_ || '', paso) } : {}),
        })
        return true
      },
    },
    vehiculo: {
      async listar({ estado = '' } = {}) {
        const r = await api.transferenciasDeVehiculo({ status: estado })
        return (r?.items ?? []).map(comoTransferencia)
      },
      async crear({ vehiculoId, origenId, destinoId, codigoDestino, motivo: motivo_ }) {
        const r = await api.crearTransferenciaDeVehiculo({
          vehicleId: vehiculoId,
          originTenantId: origenId,
          destinationTenantId: destinoId,
          destinationCode: codigoDestino,
          reason: motivo(motivo_ || '', 'transferencia'),
        })
        return { id: r?.transfer?.id ?? null }
      },
      async decidir(t, paso, motivo_) {
        const cierre = paso === 'rejection' || paso === 'cancellation'
        await api.decidirTransferenciaDeVehiculo(t.id, paso, {
          expectedVersion: t.version,
          ...(cierre ? { reason: motivo(motivo_ || '', paso) } : {}),
        })
        return true
      },
    },
  },

  /** Personas de TODOS los entes: una fila por membresía. Solo administrador FOM. */
  plataforma: {
    async personas({ q = '', limite = 50, desde = 0, empresa = null } = {}) {
      const r = empresa
        ? await api.directorio({ q, limite, desplazamiento: desde, enteId: empresa.id })
        : await api.personasDePlataforma({ q, limit: limite, offset: desde })
      const lista = (r?.items ?? []).map((u) => ({
        id: `${u.userId}:${empresa?.id ?? u.tenantId}`,
        userId: u.userId,
        nombre: u.displayName,
        email: u.email,
        empresaId: empresa?.id ?? u.tenantId,
        empresaCodigo: empresa?.codigo ?? u.tenantCode,
        empresaNombre: empresa?.nombre ?? u.tenantName,
        rol: u.role,
        estado: u.status,
      }))
      lista.pagina = pagina(r)
      return lista
    },
  },

  /** Programa de inspecciones: plantillas, citas y hallazgos con seguimiento. */
  programaInspecciones: {
    async crearPlantilla({ codigo, nombre, version = 1, descripcion, puntos, dias }) {
      const cuerpo = cuerpoPlantilla({ codigo, nombre, version, descripcion, puntos, dias })
      const r = await crearPlantillaConDias(cuerpo, { estricto: true })
      return { id: r?.template?.id ?? r?.id ?? r?.templateId }
    },
    /**
     * Formato listo (JSON con code, version, items…): lo crea y lo publica.
     * Si esa versión ya existe en la empresa no la duplica: si está en
     * borrador la publica y si ya está publicada lo dice.
     */
    async publicarFormato(formato) {
      const buscar = async () => {
        const r = await api.plantillasDeInspeccion({})
        const t = (r?.items ?? []).find((x) => x.code === formato.code && Number(x.version) === Number(formato.version))
        return t ? { id: t.id, estado: t.status } : null
      }
      let actual = await buscar()
      let creada = false
      if (!actual) {
        try {
          const r = await crearPlantillaConDias(cuerpoPlantilla(argumentosDeFormato(formato)), { estricto: false })
          actual = { id: r?.template?.id ?? r?.id ?? r?.templateId, estado: 'borrador' }
          creada = true
        } catch (e) {
          // Otro la creó a la vez: se trabaja sobre la que ya existe.
          if (e?.estado !== 409) throw e
          actual = await buscar()
          if (!actual) throw e
        }
      }
      return publicarSiHaceFalta(actual, creada, (id, cuerpo) => api.moverPlantillaInspeccion(id, cuerpo))
    },
    async cambiarPlantilla(plantilla, estado) {
      return api.moverPlantillaInspeccion(plantilla.id, { expectedStatus: plantilla.estado, status: estado })
    },
    /** Días en que toca la planilla. El servidor viejo no tiene la ruta (404): se avisa en llano. */
    async cambiarDias(plantilla, dias) {
      try {
        const r = await api.cambiarDiasPlantillaInspeccion(plantilla.id, { weekdays: diasParaEnviar(dias) })
        return { dias: normalizarDias(r?.template?.weekdays ?? dias) }
      } catch (e) {
        if (e?.estado === 404 && plantilla.soportaDias === false) {
          servidorConDias = false
          const error = new Error(AVISO_SIN_DIAS_EN_SERVIDOR)
          error.estado = 404
          throw error
        }
        if (e?.estado === 409) {
          const error = new Error('Una plantilla archivada ya no puede cambiar sus días.')
          error.estado = 409
          throw error
        }
        throw e
      }
    },
    async plantillas({ estado = '' } = {}) {
      const r = await api.plantillasDeInspeccion({ status: estado })
      const items = r?.items ?? []
      // El servidor con días trae `weekdays` en cada plantilla; el viejo no lo trae.
      if (items.length) servidorConDias = items.some((t) => Array.isArray(t.weekdays))
      return items.map(plantillaDelServidor)
    },
    async citas({ estado = '', vehiculoId = '' } = {}) {
      const r = await api.programasDeInspeccion({ status: estado, vehicleId: vehiculoId })
      return (r?.items ?? []).map((s) => ({
        id: s.id,
        estado: s.status,
        fecha: s.scheduledFor,
        vehiculo: s.vehicleCode,
        placa: s.vehiclePlate ?? null,
        plantilla: s.templateName,
        asignadoA: s.assignedUserName,
        inspeccionId: s.inspectionId ?? null,
      }))
    },
    async programar({ vehiculoId, plantillaId, asignadoA, fecha }) {
      const r = await api.crearProgramaDeInspeccion({
        vehicleId: vehiculoId,
        templateId: plantillaId,
        assignedUserId: asignadoA,
        scheduledFor: String(fecha).slice(0, 10),
      })
      return { id: r?.schedule?.id ?? null }
    },
    async cancelar(id, motivo_) {
      await api.cancelarProgramaDeInspeccion(id, {
        expectedStatus: 'programada',
        reason: motivo(motivo_ || '', 'cancelada-desde-el-panel'),
      })
      return true
    },
    async hallazgos({ estado = '', vehiculoId = '' } = {}) {
      const r = await api.hallazgosDeInspeccion({ status: estado, vehicleId: vehiculoId })
      return (r?.items ?? []).map((h) => ({
        id: h.id,
        inspeccionId: h.inspectionId,
        vehiculo: h.vehicleCode,
        punto: h.itemName,
        estadoPunto: h.itemState,
        critico: Boolean(h.isCritical),
        nota: h.note ?? '',
        odtId: h.workOrderId ?? null,
        estado: h.status,
      }))
    },
    /** en_seguimiento | resuelto | descartado, con nota obligatoria. */
    async moverHallazgo(h, destino, nota, odtId) {
      await api.moverHallazgo(h.inspeccionId, h.id, {
        expectedStatus: h.estado,
        status: destino,
        note: nota,
        workOrderId: odtId || undefined,
        clientActionId: uuid(),
      })
      return true
    },
  },
})

// --- Plantillas de inspección: piezas compartidas con la semilla -----------

/** null = aún no se sabe; false = el servidor viejo (no guarda días de la semana). */
let servidorConDias = null

/** Una plantilla del servidor en la forma del panel. `soportaDias` dice si ese servidor ya guarda días. */
export function plantillaDelServidor(t) {
  const soportaDias = Array.isArray(t.weekdays)
  return {
    id: t.id, codigo: t.code, version: t.version, nombre: t.name, estado: t.status, puntos: t.itemCount ?? 0,
    dias: normalizarDias(t.weekdays), soportaDias,
  }
}

function errorSinDias() {
  const error = new Error('Este servidor todavía no guarda los días de la semana. Quita los días marcados o espera a que se actualice.')
  error.estado = 400
  return error
}

/**
 * Crea la plantilla. El servidor viejo rechaza `weekdays` con 400: si ya sabemos que es el viejo
 * (o lo descubrimos ahora) no se manda. `estricto`: avisar en vez de crear sin los días pedidos.
 */
async function crearPlantillaConDias(cuerpo, { estricto }) {
  if (!cuerpo.weekdays) return api.crearPlantillaInspeccion(cuerpo)
  const { weekdays: _dias, ...sinDias } = cuerpo
  if (servidorConDias === false) {
    if (estricto) throw errorSinDias()
    return api.crearPlantillaInspeccion(sinDias)
  }
  try {
    return await api.crearPlantillaInspeccion(cuerpo)
  } catch (e) {
    if (e?.estado !== 400 || !/weekdays/iu.test(e.message || '')) throw e
    servidorConDias = false
    if (estricto) throw errorSinDias()
    return api.crearPlantillaInspeccion(sinDias)
  }
}

/**
 * Cuerpo de POST /inspection-templates. Lo opcional (descripción, código del
 * punto, ayuda, tipos de vehículo, orden) se manda tal cual si viene; si no,
 * se genera como siempre.
 */
export function cuerpoPlantilla({ codigo, nombre, version = 1, descripcion, puntos, dias }) {
  const code = normalizarCodigoPlan(codigo).slice(0, 50)
  if (!code || String(nombre ?? '').trim().length < 2 || !puntos?.length) throw new Error('Completa código, nombre y al menos un punto de inspección.')
  const cuerpo = {
    code,
    name: nombre.trim(),
    version: Number(version),
    items: puntos.map((p, i) => ({
      code: p.codigo || `punto-${i + 1}`,
      category: p.categoria || 'General',
      name: p.nombre.trim(),
      isCritical: Boolean(p.critico),
      ...(p.ayuda ? { helpText: p.ayuda } : {}),
      displayOrder: p.orden ?? i + 1,
      vehicleTypes: Array.isArray(p.tiposVehiculo) ? p.tiposVehiculo : [],
    })),
  }
  if (descripcion) cuerpo.description = descripcion
  // Sin días (o todos) no se manda: el servidor viejo rechaza el campo y el nuevo ya lo toma como «todos».
  const semana = diasParaEnviar(dias)
  if (semana.length) cuerpo.weekdays = semana
  return cuerpo
}

/** Un formato listo (forma del servidor) en los argumentos de crearPlantilla. */
export function argumentosDeFormato(formato) {
  return {
    codigo: formato.code,
    nombre: formato.name,
    version: formato.version,
    descripcion: formato.description,
    dias: formato.weekdays,
    puntos: [...formato.items].sort((a, b) => a.displayOrder - b.displayOrder).map((i) => ({
      codigo: i.code,
      categoria: i.category,
      nombre: i.name,
      critico: i.isCritical,
      ayuda: i.helpText,
      tiposVehiculo: i.vehicleTypes,
      orden: i.displayOrder,
    })),
  }
}

/**
 * Último paso de publicarFormato: borrador → publicada, o decir por qué no.
 * resultado: creada | borrador_publicada | ya_publicada | archivada.
 */
export async function publicarSiHaceFalta(actual, creada, mover) {
  if (actual.estado === 'publicada') return { id: actual.id, resultado: 'ya_publicada' }
  if (actual.estado !== 'borrador') return { id: actual.id, resultado: 'archivada' }
  try {
    await mover(actual.id, { expectedStatus: 'borrador', status: 'publicada' })
  } catch (e) {
    // La base admite una sola versión publicada por código.
    if (e?.estado === 409 && /published version/iu.test(e.message || '')) {
      const error = new Error('Ya hay otra versión de este formato publicada en esta empresa. Archívala en Plantillas y vuelve a publicar; esta quedó guardada como borrador.')
      error.estado = 409
      throw error
    }
    throw e
  }
  return { id: actual.id, resultado: creada ? 'creada' : 'borrador_publicada' }
}

/** Los cambios de una entrada de auditoría, en una línea legible. */
function resumirCambios(cambios) {
  if (!cambios || typeof cambios !== 'object') return ''
  const partes = []
  for (const [k, v] of Object.entries(cambios)) {
    if (v && typeof v === 'object' && ('from' in v || 'to' in v)) partes.push(`${k}: ${v.from ?? '—'} → ${v.to ?? '—'}`)
    else if (v && typeof v === 'object') partes.push(`${k}: ${JSON.stringify(v).slice(0, 60)}`)
    else partes.push(`${k}: ${v}`)
  }
  return partes.slice(0, 4).join(' · ')
}

function comoTransferencia(t) {
  return {
    id: t.id,
    usuarioId: t.userId ?? null,
    vehiculoId: t.vehicleId ?? null,
    origenId: t.originTenantId,
    destinoId: t.destinationTenantId,
    rolDestino: t.destinationRole ?? null,
    codigoOrigen: t.originCode ?? null,
    codigoDestino: t.destinationCode ?? null,
    estado: t.status,
    motivo: t.reason,
    motivoCierre: t.closedReason ?? null,
    version: t.version,
    liberadaEn: t.originReleasedAt ?? null,
    aceptadaEn: t.destinationAcceptedAt ?? null,
    completadaEn: t.completedAt ?? null,
    cerradaEn: t.closedAt ?? null,
    creadaEn: t.createdAt,
  }
}

/** La bandeja de IMEI que reportan sin ente: solo administrador FOM. */
repoApi.gpsEscritura.sinEmparejar = async function sinEmparejar() {
  const r = await api.gpsSinEmparejar()
  return (r?.devices ?? []).map((d) => ({
    imei: d.observedImei,
    primeraVez: d.firstSeenAt,
    ultimaVez: d.lastSeenAt,
    mensajes: d.messageCount,
    transporte: d.transport,
    reportando: Boolean(d.isReporting),
    bytesUltimo: d.lastMessageBytes ?? null,
  }))
}

// ============================================================
// INSPECCIÓN DIARIA DEL CONDUCTOR (T-167a)
// ------------------------------------------------------------
// Copia de src/services/inspeccionService.ts de la app: las mismas rutas de
// `/api/v1/mobile` (ver api.js), el mismo cuerpo y las mismas reglas. FOM
// decide el resultado —un ítem crítico en falla bloquea la unidad— y crea las
// órdenes. Las fotos no van a FOM: suben a Cloudinary en la misma dirección
// que la app (`fom/inspections/<id>/inspection_evidence`), con el ítem de título.
//
// Las piezas exportadas las usa también la demostración (repoSemilla.js), para
// que las dos digan lo mismo con la misma forma.
// ============================================================

/** La diaria recordada en este navegador, por empresa y unidad: la misma unidad en otra empresa es otra cuenta. */
const claveDiaria = (empresaId, vehiculoId) => `fom:inspeccion-diaria:${empresaId ?? ''}:${vehiculoId}`

/**
 * Lo que este navegador recuerda de la diaria de hoy de una unidad: `{ detalle }`
 * (detalle `null` si solo se sabe que existe), o `null`. La de otro día no dice nada de hoy.
 */
export function leerDiariaGuardada(empresaId, vehiculoId, fecha = hoyISO(), almacen = globalThis.localStorage) {
  try {
    const g = JSON.parse(almacen?.getItem(claveDiaria(empresaId, vehiculoId)) || 'null')
    return g?.fecha === fecha ? { detalle: g.detalle ?? null } : null
  } catch {
    return null
  }
}

export function guardarDiaria(empresaId, vehiculoId, detalle, fecha = hoyISO(), almacen = globalThis.localStorage) {
  try {
    almacen?.setItem(claveDiaria(empresaId, vehiculoId), JSON.stringify({ fecha, detalle }))
  } catch {
    // Sin almacenamiento solo se pierde el recuerdo; FOM sigue teniendo la inspección.
  }
}

/**
 * Un formato (forma del servidor: `{ id, name, items: [{ id, category, name,
 * isCritical, helpText, displayOrder }] }`) agrupado por categoría en su orden.
 * Sin formato sale vacío: la pantalla dice que la empresa no publicó ninguno.
 */
export function plantillaDeFormato(formato, tipo = 'otro') {
  const categorias = []
  const items = [...(formato?.items ?? [])].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
  for (const item of items) {
    let categoria = categorias.find((c) => c.nombre === item.category)
    if (!categoria) {
      categoria = { nombre: item.category, items: [] }
      categorias.push(categoria)
    }
    categoria.items.push({
      id: item.id,
      categoria: item.category,
      nombre: item.name,
      critico: Boolean(item.isCritical),
      ayuda: item.helpText || null,
    })
  }
  return { formatoId: formato?.id ?? null, nombre: formato?.name || 'Inspección preoperacional', tipo, categorias }
}

/**
 * Las planillas de la unidad para hoy, de la respuesta de `GET …/inspection-templates` (T-200).
 * Servidor nuevo (trae `date`): cada una con `dueToday` y, si ya se llenó, `hecha` con su
 * inspección; las de hoy primero. Servidor viejo (sin `date`): UNA planilla —la primera, como
 * antes— que toca hoy y sin estado de hecha (se sabe aparte, con `diariaDeHoy`).
 * Una planilla sin puntos para el tipo de la unidad no se puede llenar y no sale.
 * Devuelve `{ nuevo, fecha, planillas: [{ id, plantilla, dueToday, hecha }] }`; `hecha`
 * es `{ resultado, inspeccionId, enviadaEn }` o `null`.
 */
export function planillasDeRespuesta(respuesta, tipo = 'otro') {
  const nuevo = typeof respuesta?.date === 'string'
  const formatos = Array.isArray(respuesta?.items) ? respuesta.items : []
  const lista = (nuevo ? formatos : formatos.slice(0, 1))
    .map((f, orden) => ({ orden, f, plantilla: plantillaDeFormato(f, tipo) }))
    .filter(({ plantilla }) => plantilla.categorias.length > 0)
    .map(({ orden, f, plantilla }) => ({
      orden,
      id: plantilla.formatoId ?? `formato-${orden}`,
      plantilla,
      dueToday: nuevo ? f.dueToday !== false : true,
      hecha: nuevo && f.submittedToday
        ? { resultado: RESULTADOS_DIARIA.includes(f.result) ? f.result : 'pendiente', inspeccionId: f.inspectionId ?? null, enviadaEn: f.submittedAt ?? null }
        : null,
    }))
    // Las de hoy primero; entre iguales, el orden en que las manda el servidor.
    .sort((a, b) => Number(b.dueToday) - Number(a.dueToday) || a.orden - b.orden)
    .map(({ orden, ...planilla }) => planilla)
  return { nuevo, fecha: nuevo ? respuesta.date : null, planillas: lista }
}

/**
 * El cuerpo de `POST /mobile/vehicles/{id}/inspections`, como `enviar` de la app:
 * las fallas en ítems CRÍTICOS piden su orden siempre; las demás, si el
 * conductor respondió «Sí, crear ODT».
 */
export function cuerpoInspeccion({ plantilla, respuestas, ubicacion }) {
  const items = new Map(plantilla.categorias.flatMap((c) => c.items).map((i) => [i.id, i]))
  const lugar = String(ubicacion ?? '').trim()
  return {
    templateId: plantilla.formatoId,
    ...(lugar.length >= 2 ? { location: lugar.slice(0, 200) } : {}),
    answers: respuestas.map((r) => ({
      templateItemId: r.itemId,
      itemState: r.estado,
      ...(r.nota?.trim() ? { note: r.nota.trim().slice(0, 1000) } : {}),
      ...(r.estado === 'falla' && (items.get(r.itemId)?.critico || r.crearOdt === true) ? { requestedWorkOrder: true } : {}),
    })),
  }
}

/** Cómo se nombra la unidad en la hoja: su número (U-001) y, si no tiene, su alias. */
export function unidadDeVehiculo(v) {
  const valido = (x) => (x && x !== '—' ? x : null)
  return { unidad: valido(v?.numero) ?? valido(v?.alias) ?? 'Unidad', placa: valido(v?.placa) }
}

/** Lo enviado, en la forma de «Ver resultado». El orden del formato es el de la hoja impresa. */
export function detalleDeEnvio({ id, resultado, enviadaEn, vehiculo, plantilla, respuestas, ubicacion, quien }) {
  const orden = new Map(plantilla.categorias.flatMap((c) => c.items).map((item, n) => [item.id, { item, n }]))
  const lugar = String(ubicacion ?? '').trim()
  return {
    id,
    resultado,
    clase: 'daily',
    fecha: hoyISO(new Date(enviadaEn)),
    enviadaEn,
    vehiculoId: vehiculo.id,
    ...unidadDeVehiculo(vehiculo),
    conductor: quien.nombre,
    conductorId: quien.id,
    ubicacion: lugar || null,
    formato: plantilla.nombre,
    respuestas: respuestas
      .map((r) => {
        const deFormato = orden.get(r.itemId)
        return {
          id: r.itemId,
          itemId: r.itemId,
          categoria: deFormato?.item.categoria ?? '',
          nombre: deFormato?.item.nombre ?? r.itemId,
          estado: r.estado,
          critico: deFormato?.item.critico ?? false,
          nota: r.nota?.trim() || null,
          orden: deFormato?.n ?? 0,
        }
      })
      .sort((a, b) => a.orden - b.orden),
  }
}

/**
 * FOM rechazó el envío porque la unidad ya tiene su diaria de hoy (409). Es su
 * propia clase para que la pantalla no muestre un error y ya: pasa a «ya está
 * hecha», que es lo que de verdad ocurre.
 */
export class InspeccionYaHecha extends Error {
  /** `porPlanilla`: el servidor nuevo (T-200) dice que ESA planilla ya se llenó, no que la unidad ya cumplió. */
  constructor({ porPlanilla = false } = {}) {
    super(porPlanilla ? 'Esta planilla ya se llenó hoy.' : 'La inspección de hoy de esta unidad ya está hecha.')
    this.name = 'InspeccionYaHecha'
    this.yaHecha = true
    this.porPlanilla = porPlanilla
  }
}

/** Lo que contesta FOM sobre una inspección, dicho para quien lo lee (errorDeInspeccion de la app). */
function errorDeInspeccion(e) {
  const texto = String(e?.message ?? '')
  // «…inspection for that template and vehicle» es del servidor nuevo; el viejo dice «…for this vehicle».
  if (e?.estado === 409 && /already submitted today/iu.test(texto)) return new InspeccionYaHecha({ porPlanilla: /for that template/iu.test(texto) })
  if (e?.estado === 403 && !/contraseña/u.test(texto)) return new Error('No estás asignado a esta unidad.')
  if (e?.estado === 404 && texto === 'Ese recurso no existe en el servidor.') return new Error('Esta unidad o su formato de inspección ya no están disponibles.')
  if (e?.estado === 400 && /every item/iu.test(texto)) return new Error('Responde todos los ítems antes de enviar.')
  return e instanceof Error ? e : new Error(texto || 'No se pudo completar la inspección.')
}

const RESULTADOS_DIARIA = ['aprobada', 'aprobada_con_observaciones', 'bloqueada']

/** Una inspección de la lista de FOM en el vocabulario de la pantalla. */
function resumenDeFila(f) {
  return {
    id: f.id,
    resultado: RESULTADOS_DIARIA.includes(f.result) ? f.result : 'pendiente',
    clase: f.kind ?? null,
    fecha: f.inspectionDate,
    enviadaEn: f.submittedAt ?? null,
    vehiculoId: f.vehicleId,
    unidad: f.vehicleCode,
    placa: f.vehiclePlate ?? null,
    conductor: f.driverName?.trim() || 'Sin conductor',
    conductorId: f.driverUserId ?? null,
    ubicacion: f.location?.trim() || null,
    formato: f.templateName,
  }
}

/**
 * Sube las fotos de las fallas, una por una, a la carpeta de la inspección.
 * La inspección ya quedó guardada: si una foto no llega se cuenta y se dice,
 * no se deshace el envío.
 */
async function subirFotosDeInspeccion(inspeccionId, plantilla, respuestas) {
  const nombres = new Map(plantilla.categorias.flatMap((c) => c.items).map((i) => [i.id, i.nombre]))
  const conFoto = respuestas.filter((r) => r.estado === 'falla' && r.fotos?.length)
  const total = conFoto.reduce((n, r) => n + r.fotos.length, 0)
  if (total === 0) return { subidas: 0, fallidas: 0, motivo: null }
  if (!cloudinaryConfigurado()) return { subidas: 0, fallidas: total, motivo: 'Cloudinary no está configurado en esta web.' }
  let subidas = 0
  let motivo = null
  for (const r of conFoto) {
    for (const archivo of r.fotos) {
      try {
        await subirImagen(archivo, {
          publicId: carpetaDe('inspections', inspeccionId, 'inspection_evidence'),
          etiqueta: `fom_inspections_${inspeccionId}`,
          titulo: nombres.get(r.itemId) ?? r.itemId,
        })
        subidas += 1
      } catch (e) {
        motivo ??= e?.message || 'No se pudo subir la foto.'
      }
    }
  }
  return { subidas, fallidas: total - subidas, motivo }
}

/** Lo que se cuenta del envío, como `ResultadoInspeccion` de la app. */
export function resultadoDeEnvio(estado, plantilla, respuestas, ordenesGeneradas, completadaEn) {
  const criticos = new Set(plantilla.categorias.flatMap((c) => c.items).filter((i) => i.critico).map((i) => i.id))
  const fallas = respuestas.filter((r) => r.estado === 'falla')
  return { estado, fallas: fallas.length, fallasCriticas: fallas.filter((r) => criticos.has(r.itemId)).length, ordenesGeneradas, completadaEn }
}

/** El aviso de «pide otra unidad», el mismo de la app. */
export const AVISO_OTRA_UNIDAD = {
  kind: 'replacement_request',
  category: 'fleet',
  title: 'Pide otra unidad',
  detail: 'Su unidad quedó bloqueada en la inspección y necesita otra para salir.',
}
/** El aviso de unidad bloqueada que sale con el envío. */
export const AVISO_BLOQUEADA = {
  kind: 'inspection_blocked',
  category: 'safety',
  title: 'Unidad bloqueada en la inspección',
  detail: 'Una falla crítica en la inspección preoperacional impide salir con la unidad.',
}

export const inspeccionConductor = {
  /** El formato de la unidad; FOM ya lo filtra por su tipo. Con más de uno publicado se usa el primero. */
  async plantilla(vehiculo) {
    try {
      const r = await api.formatosDeInspeccion(vehiculo.id)
      return plantillaDeFormato(r?.items?.[0], vehiculo.tipo)
    } catch (e) {
      throw errorDeInspeccion(e)
    }
  },

  /**
   * TODAS las planillas de hoy de la unidad, cada una con su estado (T-200).
   * Devuelve `{ nuevo, planillas: [{ id, plantilla, dueToday, hecha }], motivo }`, con
   * `hecha` = `null` o `{ inspeccion, detalle }`.
   *  · Servidor nuevo: el estado de cada planilla viene en la misma respuesta (lo ve
   *    también el conductor); de cada hecha se pide el detalle para ver quién y cómo.
   *  · Servidor viejo: una planilla, hecha o no según `diariaDeHoy` (una por unidad y día).
   * `motivo` solo si no se pudo comprobar si ya está hecha: se deja hacer y se avisa.
   */
  async planillasDeHoy(vehiculo, { empresaId = null } = {}) {
    let r
    try {
      r = await api.formatosDeInspeccion(vehiculo.id, { soloHoy: true })
    } catch (e) {
      throw errorDeInspeccion(e)
    }
    const { nuevo, fecha, planillas } = planillasDeRespuesta(r, vehiculo.tipo)
    if (nuevo) {
      const completas = await Promise.all(planillas.map(async (p) => {
        if (!p.hecha) return p
        const { resultado, inspeccionId, enviadaEn } = p.hecha
        // Quién y cómo salió: si no se puede leer, queda lo que ya dijo la lista.
        const detalle = inspeccionId ? await inspeccionConductor.detalle(inspeccionId).catch(() => null) : null
        const inspeccion = detalle ?? {
          id: inspeccionId, resultado, clase: 'daily', fecha, enviadaEn, vehiculoId: vehiculo.id,
          ...unidadDeVehiculo(vehiculo), conductor: null, conductorId: null, ubicacion: null, formato: p.plantilla.nombre,
        }
        return { ...p, hecha: { inspeccion, detalle } }
      }))
      return { nuevo, planillas: completas, motivo: null }
    }
    if (planillas.length === 0) return { nuevo, planillas, motivo: null }
    const diaria = await inspeccionConductor.diariaDeHoy(vehiculo.id, { empresaId })
    const [unica] = planillas
    return {
      nuevo,
      planillas: [{ ...unica, hecha: diaria.estado === 'hecha' ? { inspeccion: diaria.inspeccion, detalle: diaria.detalle } : null }],
      motivo: diaria.estado === 'sin_comprobar' ? diaria.motivo : null,
    }
  },

  /**
   * ¿La unidad ya tiene su DIARIA de hoy? Como getDiariaDeHoy de la app, mira
   * en dos sitios: la lista de la unidad en FOM (ve también la que hizo otra
   * persona) y lo enviado desde este navegador (cubre al conductor, a quien FOM
   * puede no dejarle leer esa lista). Si FOM no contesta y el navegador no sabe
   * nada, `sin_comprobar`: se deja hacerla —mejor que bloquear sin datos— y se avisa.
   */
  async diariaDeHoy(vehiculoId, { empresaId = null } = {}) {
    const fecha = hoyISO()
    const guardada = leerDiariaGuardada(empresaId, vehiculoId, fecha)
    try {
      const r = await api.inspeccionesDeUnidad(vehiculoId, { limit: 20, offset: 0 })
      // Si hubo dos (servidor sin la regla de una por día), manda la última.
      const diaria = (r?.items ?? [])
        .map(resumenDeFila)
        .filter((i) => i.fecha === fecha && i.clase !== 'scheduled' && i.resultado !== 'pendiente')
        .sort((a, b) => String(b.enviadaEn ?? '').localeCompare(String(a.enviadaEn ?? '')))[0]
      if (diaria) {
        return { estado: 'hecha', inspeccion: diaria, detalle: guardada?.detalle?.id === diaria.id ? guardada.detalle : null }
      }
    } catch (e) {
      if (!guardada) {
        return {
          estado: 'sin_comprobar',
          motivo: e?.estado
            ? 'No pudimos comprobar en FOM si esta unidad ya tiene la inspección de hoy. Puedes hacerla igual.'
            : 'Sin conexión: no pudimos comprobar si esta unidad ya tiene la inspección de hoy. Puedes hacerla igual.',
        }
      }
    }
    // Lo enviado desde este navegador vale aunque la lista de FOM no lo enseñe.
    if (guardada) return { estado: 'hecha', inspeccion: guardada.detalle, detalle: guardada.detalle }
    return { estado: 'pendiente' }
  },

  /** Una inspección con lo respondido, ítem por ítem, en el orden del formato. */
  async detalle(id) {
    try {
      const r = await api.inspeccionDeUnidad(id)
      return {
        ...resumenDeFila(r.inspection),
        respuestas: [...(r.findings ?? [])]
          .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
          .map((f) => ({
            id: f.id,
            itemId: f.templateItemId,
            categoria: f.category,
            nombre: f.name,
            estado: ['conforme', 'observacion', 'falla'].includes(f.itemState) ? f.itemState : 'conforme',
            critico: Boolean(f.isCritical),
            nota: f.note?.trim() || null,
            orden: f.displayOrder ?? 0,
          })),
      }
    } catch (e) {
      throw errorDeInspeccion(e)
    }
  },

  /**
   * Envía la diaria y la recuerda en este navegador con lo respondido. Si FOM
   * dice que ya había una (409), también se recuerda: el formulario no se
   * vuelve a ofrecer hoy. Devuelve `{ resultado, detalle, fotos }`.
   */
  async enviar({ vehiculo, plantilla, respuestas, ubicacion }, quien) {
    if (!plantilla?.formatoId) throw new Error('Tu empresa no tiene un formato de inspección publicado.')
    let enviada
    try {
      enviada = await api.enviarInspeccionDiaria(vehiculo.id, cuerpoInspeccion({ plantilla, respuestas, ubicacion }))
    } catch (e) {
      const error = errorDeInspeccion(e)
      // Con el servidor nuevo la lista de hoy ya dice cuál se llenó; el recuerdo es del viejo (una por unidad y día).
      if (error instanceof InspeccionYaHecha && !error.porPlanilla) guardarDiaria(quien.empresaId, vehiculo.id, null)
      throw error
    }
    const fotos = await subirFotosDeInspeccion(enviada.inspectionId, plantilla, respuestas)
    if (enviada.result === 'bloqueada') {
      // El aviso es un extra: si FOM no lo toma, la inspección ya quedó guardada.
      await api.avisarAlSupervisor({ ...AVISO_BLOQUEADA, vehicleId: vehiculo.id, inspectionId: enviada.inspectionId, severity: 'high' }).catch(() => undefined)
    }
    const ordenes = await Promise.all((enviada.workOrderIds ?? []).map((id) =>
      api.ordenDeInspeccion(id)
        .then((r) => ({ id: r?.workOrder?.id ?? id, estado: r?.workOrder?.status ?? 'abierta', descripcion: r?.workOrder?.description ?? '' }))
        .catch(() => null)))
    const completadaEn = new Date().toISOString()
    const resultado = resultadoDeEnvio(enviada.result, plantilla, respuestas, ordenes.filter(Boolean), completadaEn)
    const detalle = detalleDeEnvio({ id: enviada.inspectionId, resultado: enviada.result, enviadaEn: completadaEn, vehiculo, plantilla, respuestas, ubicacion, quien })
    guardarDiaria(quien.empresaId, vehiculo.id, detalle)
    return { resultado, detalle, fotos }
  },

  /** El conductor pide otra unidad porque la suya quedó bloqueada. */
  async pedirOtraUnidad(vehiculoId) {
    try {
      await api.avisarAlSupervisor({ ...AVISO_OTRA_UNIDAD, vehicleId: vehiculoId, severity: 'high' })
    } catch (e) {
      if (/todavía no está en el servidor publicado/u.test(String(e?.message))) throw new Error('Pedir otra unidad todavía no está publicado en FOM.')
      throw e
    }
  },
}

repoApi.inspeccionConductor = inspeccionConductor

// ============================================================
// EL SOS DEL CONDUCTOR (T-167b)
// ------------------------------------------------------------
// Copia de src/services/emergencyService.ts de la app: el aviso viaja UNA vez
// y completo —quién, en qué unidad, qué pasa y dónde— y llega al supervisor
// en «Eventos y SOS». Nace ACTIVO; el supervisor lo TOMA (va ayuda) y, tomado,
// se RESUELVE. Quien lo mandó puede retirarlo mientras nadie lo haya tomado.
//
// Las piezas exportadas las usa también la demostración (repoSemilla.js).
// ============================================================

/** Cómo nombra la consola del supervisor un aviso (forma de `seguridad.emergencias`). */
export function emergenciaParaConsola(e) {
  return {
    id: e.id,
    vehiculoId: e.vehicleId ?? null,
    reportadaPor: e.reportedByUserId,
    tipo: e.kind,
    tipoOtro: e.kindOther ?? null,
    detalle: e.detail,
    estado: e.status,
    reportadaEn: e.reportedAt,
    ubicacionReportante: e.reporterLocation ?? null,
    ubicacionVehiculo: e.vehicleLocation ?? null,
  }
}

/** Los tipos de la app y su nombre en FOM. */
export const TIPO_SOS_FOM = { accidente: 'accident', mecanica: 'mechanical', salud: 'medical', seguridad: 'security', otro: 'other' }
const TIPO_SOS_APP = Object.fromEntries(Object.entries(TIPO_SOS_FOM).map(([app, fom]) => [fom, app]))
const ESTADO_SOS_APP = { active: 'activa', acknowledged: 'atendida', resolved: 'terminada', cancelled: 'cancelada' }

/** Etiqueta legible de cada tipo, como EMERGENCIA_LABEL de la app. */
export const ETIQUETA_SOS = { accidente: 'Accidente', mecanica: 'Falla mecánica', salud: 'Salud', seguridad: 'Seguridad', otro: 'Otro' }

/** Con «Otro» manda lo que escribió el conductor: «Otro» a secas no le dice nada a quien va a ir. */
export function etiquetaEmergencia(e) {
  const libre = String(e?.tipoOtro ?? '').trim()
  return e?.tipo === 'otro' && libre ? libre : ETIQUETA_SOS[e?.tipo] ?? 'Emergencia'
}

/**
 * FOM guarda las coordenadas, no la dirección en palabras: la dirección viaja
 * al final del detalle —quien lo lee en la consola la ve ahí— y de ahí se lee.
 */
const DONDE_SOS = '\nDónde: '

export function detalleParaFom(detalle, ubicacionTexto) {
  const texto = String(ubicacionTexto ?? '').trim()
  return (texto ? `${String(detalle).trim()}${DONDE_SOS}${texto}` : String(detalle).trim()).slice(0, 2000)
}

function separarDetalle(detail) {
  const texto = String(detail ?? '')
  const corte = texto.lastIndexOf(DONDE_SOS)
  return corte < 0
    ? { detalle: texto, ubicacionTexto: '' }
    : { detalle: texto.slice(0, corte), ubicacionTexto: texto.slice(corte + DONDE_SOS.length) }
}

const puntoSos = (p) => (p && p.latitude != null && p.longitude != null ? { lat: Number(p.latitude), lng: Number(p.longitude) } : null)

/** El cuerpo de `POST /mobile/emergencies`, como `enviarSOS` de la app. */
export function cuerpoEmergencia({ vehiculoId, tipo, tipoOtro, detalle, ubicacionTexto, coords }) {
  // Seis decimales: medio metro basta para llegar.
  const seis = (x) => Math.round(x * 1e6) / 1e6
  const libre = String(tipoOtro ?? '').trim()
  return {
    ...(vehiculoId ? { vehicleId: vehiculoId } : {}),
    kind: TIPO_SOS_FOM[tipo],
    // Solo cuenta con «Otro»: en los demás el tipo ya se nombra solo.
    ...(tipo === 'otro' && libre ? { kindOther: libre.slice(0, 120) } : {}),
    detail: detalleParaFom(detalle, ubicacionTexto),
    ...(coords ? { reporterLatitude: seis(coords.lat), reporterLongitude: seis(coords.lng) } : {}),
  }
}

/**
 * Un aviso de FOM en el vocabulario de la pantalla del conductor (`Emergencia`
 * de la app). `nombres` pone quién lo tomó; sin él, «Tu supervisor».
 */
export function emergenciaDelConductor(e, nombres = new Map()) {
  const { detalle, ubicacionTexto } = separarDetalle(e.detail)
  return {
    id: e.id,
    tipo: TIPO_SOS_APP[e.kind] ?? 'otro',
    tipoOtro: e.kindOther ?? null,
    estado: ESTADO_SOS_APP[e.status] ?? 'activa',
    detalle,
    ubicacionTexto,
    creadaEn: e.reportedAt,
    coords: puntoSos(e.reporterLocation),
    coordsUnidad: puntoSos(e.vehicleLocation),
    creadorId: e.reportedByUserId,
    vehiculoId: e.vehicleId ?? null,
    atendidaPor: e.acknowledgedByUserId ? nombres.get(e.acknowledgedByUserId) ?? 'Tu supervisor' : null,
    atendidaEn: e.acknowledgedAt ?? null,
  }
}

/** Lo que contesta FOM sobre un aviso, dicho para quien lo lee (errorDeSOS de la app). */
function errorDeSos(e, porDefecto) {
  if (/todavía no está en el servidor publicado/u.test(String(e?.message))) return new Error('Esa acción todavía no está publicada en FOM.')
  switch (e?.estado) {
    case 403: return new Error('Eso lo hace el supervisor.')
    case 404: return new Error('Ese aviso ya no está a tu alcance.')
    case 409: return new Error(/cancel/iu.test(String(e?.message)) ? 'Tu supervisor ya lo tomó: ya no se puede retirar.' : 'El aviso cambió mientras lo tenías abierto. Vuelve a abrirlo.')
    case undefined: return new Error(e?.message || porDefecto)
    default: return new Error(`${porDefecto} ${e?.message ?? ''}`.trim())
  }
}

/** Lo más que el envío espera a la lectura previa (ms): con mala señal, el aviso sale igual. */
const TOPE_SOS_MS = 4_000
function conTope(lectura, respaldo) {
  let reloj
  const tope = new Promise((listo) => { reloj = setTimeout(() => listo(respaldo), TOPE_SOS_MS) })
  return Promise.race([lectura.catch(() => respaldo), tope]).finally(() => clearTimeout(reloj))
}

/** Activos y tomados, el más nuevo primero (`enCurso` de la app). */
async function avisosEnCurso() {
  const [activas, tomadas] = await Promise.all(['active', 'acknowledged'].map((s) => api.emergenciasDelConductor(s)))
  return [...(activas?.items ?? []), ...(tomadas?.items ?? [])].sort((a, b) => String(b.reportedAt).localeCompare(String(a.reportedAt)))
}

/**
 * El aviso propio entre los que devuelve FOM. Al conductor FOM solo le da los
 * suyos; si la sesión web no trae su id (solo el correo), el primero es suyo.
 */
const elMio = (filas, usuarioId) => (usuarioId ? filas.find((e) => e.reportedByUserId === usuarioId) ?? null : filas[0] ?? null)

export const sosConductor = {
  /** Mi aviso en curso (activo o tomado), o `null`. Para reanudar la pantalla. */
  async miEmergencia({ usuarioId = null } = {}) {
    const mia = elMio(await avisosEnCurso(), usuarioId)
    return mia ? emergenciaDelConductor(mia) : null
  },

  /**
   * Manda el aviso y devuelve la emergencia ya creada. Si ya hay uno en curso,
   * es ESE: dos avisos de la misma persona son la misma emergencia contada dos
   * veces. Falla A LA CARA: nunca se dice que va ayuda si no salió.
   */
  async enviar(entrada, { usuarioId = null } = {}) {
    const previa = elMio(await conTope(avisosEnCurso(), []), usuarioId)
    if (previa) return emergenciaDelConductor(previa)
    try {
      const r = await api.enviarEmergencia(cuerpoEmergencia(entrada), entrada.idempotencia)
      return emergenciaDelConductor(r.emergency)
    } catch (e) {
      throw errorDeSos(e, 'No pudimos enviar el aviso. Intenta de nuevo.')
    }
  },

  async cancelar(emergencia) {
    try {
      await api.cancelarEmergencia(emergencia.id)
    } catch (e) {
      throw errorDeSos(e, 'No pudimos retirar el aviso.')
    }
  },

  async terminar(emergencia) {
    try {
      await api.terminarEmergencia(emergencia.id)
    } catch (e) {
      throw errorDeSos(e, 'No pudimos cerrar el aviso.')
    }
  },
}

// ============================================================
// OTRA UNIDAD CON PIN (T-167b)
// ------------------------------------------------------------
// Copia de pin-unidad.tsx con asignacionService/fomConduccion de la app: la
// lista es la de SUS unidades como secundario (`/drivers/me`), el PIN abre la
// sesión de conducción y «Dejar el vehículo» la cierra.
// ============================================================

/** Lo que dice FOM al tomar una unidad, para quien lo lee (tomarUnidadFom de la app). */
export function errorDeTomarUnidad(e) {
  if (e?.codigo === 'invalid_driver_pin') return new Error('PIN incorrecto para esta unidad. Verifica con tu supervisor.')
  if (e?.estado === 403) return new Error('No estás autorizado en esta unidad.')
  if (e?.estado === 409) return new Error(/vehicle/iu.test(String(e?.message)) ? 'Otra persona está usando esa unidad.' : 'Ya estás usando otra unidad: déjala primero.')
  return e instanceof Error ? e : new Error('No se pudo activar el PIN.')
}

/** Una asignación de `/drivers/me` en el vocabulario de la pantalla. */
export function unidadParaPin(f) {
  return { vehiculoId: f.vehicleId, nombre: f.vehicleCode ?? 'Unidad', placa: f.vehiclePlate ?? null }
}

/** La sesión de conducción de FOM, si está abierta. */
export function sesionDeConduccion(s) {
  return s?.status === 'active' ? { id: s.id, vehiculoId: s.vehicleId, rol: s.assignmentRole } : null
}

export const otraUnidad = {
  /** MIS unidades como secundario. */
  async unidades() {
    const { items: filas } = await leerTodasLasPaginas(
      (offset, limit) => api.misAsignaciones({ limit, offset }),
      { limite: 100, clave: (f) => f?.assignmentId },
    )
    return filas.filter((f) => f.role === 'secundario').map(unidadParaPin)
  },

  /** La unidad que estoy usando ahora (`{ id, vehiculoId, rol }`), o `null`. */
  async sesionActual() {
    const r = await api.sesionDeConduccion()
    return sesionDeConduccion(r?.session)
  },

  async usar(vehiculoId, pin) {
    try {
      await api.tomarUnidad(vehiculoId, String(pin).trim())
    } catch (e) {
      throw errorDeTomarUnidad(e)
    }
  },

  /** Deja la unidad: cierra la sesión abierta, si la hay. */
  async dejar() {
    const sesion = await otraUnidad.sesionActual()
    if (sesion) await api.terminarSesionDeConduccion(sesion.id)
  },
}

repoApi.sos = sosConductor
repoApi.otraUnidad = otraUnidad

export default repoApi
