import { listarTodasOdts } from './listar-odts'
import { crearCostosApi } from './costos-api.js'
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

import { api, pedir, empresaGestionActualId } from './api'
import { asignarPrincipal } from './asignarConductor'
import { normalizarCodigoPlan, validarCodigoPlan } from './codigoPlan'
import { hoyISO } from './formato'
import { quitarSaltos } from './recorrido'

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
    conectado: Boolean(v.lastReportAt),
    conexion: v.lastReportAt ? 'reportando' : 'sin_senal',

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
 * Flota completa. Una sola llamada: el estado en vivo viene ya unido en el
 * servidor, así que desaparece la ronda de una petición de posición por unidad
 * que antes hacía este archivo.
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
  const peticion = api.vehiculos({ q })
    .then((r) => (r?.items ?? []).map(comoUnidad))
    .then(conPosicionDirecta)
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
  const sinVivo = lista.filter(
    (v) => !Number.isFinite(v.lat) || !Number.isFinite(v.lng),
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
  sinVivo.forEach((v, i) => porId.set(v.id, posiciones[i]))
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
      conectado: Boolean(p.receivedAt ?? v.ultimoReporte),
      conexion:
        (p.receivedAt ?? v.ultimoReporte) ? 'reportando' : 'sin_senal',
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

export const repoApi = {
  costos: crearCostosApi(pedir, empresaGestionActualId),
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
    /** Ranking de los conductores de la empresa, del mejor al peor. */
    async ranking({ dias = 7 } = {}) {
      const r = await api.scoresManejo(dias)
      return (Array.isArray(r) ? r : r?.items ?? []).map((x) => ({ id: x.userId, nombre: x.displayName, ...scoreDe(x, true) }))
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
        // mostrarse.
        api.conductores().then((r) => r?.items ?? []).catch(() => []),
      ])
      const porVehiculo = conductoresPorVehiculo(conductores)
      return lista
        .filter(v => !areaId || v.areaId === areaId)
        .map((v) => {
          const c = porVehiculo.get(v.id)
          return c
            ? { ...v, conductorPrincipalId: c.userId, conductorNombre: c.displayName }
            : v
        })
        .sort((a, b) => a.alias.localeCompare(b.alias))
    },

    /** Recorrer el directorio paginado: la unidad puede estar después de los primeros 200 registros. */
    async usuariosAsignados(id) {
      const asignaciones = []
      let desplazamiento = 0
      while (true) {
        const r = await api.conductores({ desplazamiento })
        const items = r?.items ?? []
        asignaciones.push(...items.filter(c => c.vehicleId === id).map(c => ({
          id: c.userId, nombre: c.displayName, rol: c.role,
          asignacionId: c.assignmentId, desde: c.validFrom ?? null,
        })))
        desplazamiento += items.length
        if (!items.length || (r?.page?.total != null ? desplazamiento >= r.page.total : items.length < 200)) break
      }
      return asignaciones.sort((a, b) => (a.rol === 'principal' ? 0 : 1) - (b.rol === 'principal' ? 0 : 1))
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
        repoApi.odts.listar().then((l) => l.filter((o) => o.vehiculoId === id)).catch(() => []),
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
        .then((r) => (r?.devices ?? []).find((d) => d.vehicleId === id) ?? null)
        .catch(() => null)
      return {
        ...comoUnidad(ficha.vehicle),
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

  /** Conductores con asignación vigente. Sin cédula ni teléfono: ver #168. */
  async conductores() {
    try {
      const r = await api.conductores()
      return (r?.items ?? []).map((c) => ({
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
    /**
     * Una persona por su identificador. El directorio no tiene ruta de
     * detalle: se busca en la lista. Antes «obtener» caía en la semilla y
     * devolvía null siempre: el expediente decía «no conseguimos a esta
     * persona» para todo el mundo.
     */
    async obtener(id) {
      const [lista, insp, odts] = await Promise.all([
        repoApi.gente.listar({}),
        repoApi.inspecciones.listar({}).catch(() => []),
        repoApi.odts.listar({}).catch(() => []),
      ])
      const p = lista.find((x) => x.userId === id || x.id === id)
      if (!p) return null
      const nombre = String(p.nombre ?? '').trim().toLowerCase()
      return {
        ...p,
        // El expediente espera la unidad como objeto y las colecciones como
        // listas. Lo que el servidor no sirve por persona queda vacío, no
        // inventado: eventos de manejo y licencia todavía no viajan aquí.
        unidad: p.unidad ? { id: p.unidad, alias: p.unidadAlias ?? p.unidadNombre ?? p.unidad, placa: p.unidadPlaca ?? '' } : null,
        eventos: [],
        inspecciones: insp.filter((i) => String(i.conductorNombre ?? '').trim().toLowerCase() === nombre),
        odts: odts.filter((o) => String(o.creadorNombre ?? '').trim().toLowerCase() === nombre),
        documentos: [],
        direccion: p.direccion ?? null,
        fechaNacimiento: p.fechaNacimiento ?? null,
        licenciaNumero: null,
        licenciaCategoria: null,
        licenciaVence: null,
        cartaMedicaVence: null,
        indiceSeguro: null,
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

        // Datos personales. Vienen NULOS cuando se lee un contratista: la
        // politica de fila de la base exige compartir ente, y una compania no
        // lo comparte con la gente ajena. Se ve quien es, no su cedula.
        cedula: p.nationalId ?? null,
        telefono: p.phone ?? null,
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
    /**
     * Inventario real desde `GET /gps-devices`. Antes «listar» caía en la
     * semilla vacía y el inventario salía en cero aunque hubiera equipos
     * instalados y reportando.
     */
    async listar({ q = '' } = {}) {
      const r = await api.equiposGps()
      const t = q.trim().toLowerCase()
      return (r?.devices ?? [])
        .map((d) => ({
          id: d.id,
          imei: d.imei,
          modelo: d.model,
          fabricante: d.manufacturer ?? null,
          protocolo: d.protocolFamily,
          linea: d.simPhone ?? null,
          estado: d.status,
          // «Verificado» = el receptor ya lo oyó alguna vez.
          verificado: Boolean(d.connected || d.lastConnectionAt),
          conectado: Boolean(d.connected),
          ultimaConexion: d.lastConnectionAt ?? null,
          panicoProbado: false,
          empresaNombre: '—',
          vehiculoId: d.vehicleId ?? null,
          vehiculoNombre: d.vehicleId ? [d.vehicleCode, d.vehiclePlate].filter(Boolean).join(' · ') : null,
          ubicacion: d.storageLocation ?? null,
          serie: d.serialNumber ?? null,
          pinSupport: Boolean(d.panicSupported ?? d.pinSupport),
          instalacionId: d.installationId ?? d.activeInstallationId ?? d.installation?.id ?? null,
        }))
        .filter((g) => !t || [g.imei, g.modelo, g.linea, g.vehiculoNombre].some((v) => String(v ?? '').toLowerCase().includes(t)))
    },
    async registrar({ imei, modelo, protocolo, fabricante, serie }) {
      const r = await api.registrarEquipoGps({
        imei,
        model: modelo,
        protocolFamily: protocolo || 'coban-gps103',
        manufacturer: fabricante || undefined,
        serialNumber: serie || undefined,
      })
      return { id: r?.gpsDevice?.id ?? null }
    },
    async asociar(equipoId, vehiculoId, notas) {
      await api.instalarEquipoGps(equipoId, {
        vehicleId: vehiculoId,
        notes: notas || undefined,
      })
      return true
    },
    async desmontar(instalacionId, notas) {
      await api.desmontarEquipoGps(instalacionId, { notes: notas || undefined })
      return true
    },
    async set(equipoId, { estado, fabricante, serie }) {
      await api.actualizarEquipoGps(equipoId, {
        status: estado,
        manufacturer: fabricante,
        serialNumber: serie,
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
    /**
     * Alta de vehiculo.
     *
     * El panel pide un GPS al crear, pero la superficie de consola da de alta
     * la UNIDAD; el equipo se comisiona aparte desde la app de campo. Se avisa
     * en vez de fingir que el GPS quedo asociado, porque un vehiculo que se
     * cree «con GPS» y no lo tenga es peor que uno que se sepa sin el.
     */
    async crear({ alias, placa, marca, modelo, anio, tipo, areaId, gpsId }) {
      const r = await api.crearVehiculo({
        code: (alias || placa || '').trim().toLowerCase().replace(/\s+/gu, '-'),
        plate: placa || undefined,
        alias: alias || undefined,
        make: marca || undefined,
        model: modelo || undefined,
        modelYear: anio ? Number(anio) : undefined,
        vehicleType: tipo || undefined,
      })
      const id = r?.vehicleId ?? r?.vehicle?.id ?? null
      if (!id) throw new Error('El servidor no devolvió el identificador del vehículo creado. Revisa la flota antes de reintentar.')
      if (id && areaId) await api.actualizarVehiculo(id, { areaId })
      if (gpsId) await api.instalarEquipoGps(gpsId, { vehicleId: id })
      return { id }
    },

    async set(id, parche) {
      await api.actualizarVehiculo(id, {
        plate: parche.placa,
        alias: parche.alias,
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
        const vigentes = await api.conductores().then((r) => (r?.items ?? []).filter((c) => c.vehicleId === id))
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
    async listar({ estado = '', q = '' } = {}) {
      try {
        const r = { items: await listarTodasOdts(api, { estado }) }
        let lista = (r?.items ?? []).map((o) => ({
          id: o.id,
          estado: o.status,
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
        }))
        if (q) {
          const t = q.toLowerCase()
          lista = lista.filter((o) =>
            [o.descripcion, o.vehiculoNombre].join(' ').toLowerCase().includes(t))
        }
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
        repoApi.inspecciones.listar({}),
      ])
      const revisadas = new Set(hechas.filter((i) => String(i.fecha ?? '').slice(0, 10) === hoy).map((i) => i.vehiculoId))
      return flota.filter((v) => !revisadas.has(v.id))
    },
    async listar({ vehiculoId = '', fecha = '', q = '' } = {}) {
      try {
        const r = await api.inspecciones({ vehiculoId })
        return (r?.items ?? []).map((i) => ({
          id: i.id,
          resultado: i.result,
          fecha: i.inspectionDate,
          ubicacion: i.location,
          enviadaEn: i.submittedAt,
          creadaEn: i.submittedAt ?? i.inspectionDate,
          vehiculoId: i.vehicleId,
          vehiculoNombre: [i.vehicleCode, i.vehiclePlate].filter(Boolean).join(' · ') || '—',
          conductorNombre: i.driverName || '—',
          plantilla: i.templateName,
          // «daily» (la diaria de cada conductor) o «scheduled» (la que fija el supervisor): lo clasifica el servidor.
          clase: i.kind ?? null,
        })).filter(i => !fecha || String(i.fecha).slice(0, 10) === fecha)
          .filter(i => !q || `${i.vehiculoNombre} ${i.conductorNombre}`.toLowerCase().includes(q.toLowerCase()))
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
      while (true) {
        const r = await api.eventosDeAlerta({ limit: 100, offset })
        const page = r.items ?? []
        items.push(...page)
        offset += page.length
        if (!page.length || offset >= (r.page?.total ?? offset)) break
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
      return (r?.items ?? []).map((e) => ({
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
      }))
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
    async crearPlantilla({ codigo, nombre, version = 1, puntos }) {
      const code = normalizarCodigoPlan(codigo).slice(0, 50)
      if (!code || nombre.trim().length < 2 || !puntos.length) throw new Error('Completa código, nombre y al menos un punto de inspección.')
      const r = await api.crearPlantillaInspeccion({ code, name: nombre.trim(), version: Number(version), items: puntos.map((p, i) => ({ code: `punto-${i + 1}`, category: p.categoria || 'General', name: p.nombre.trim(), isCritical: Boolean(p.critico), displayOrder: i + 1, vehicleTypes: [] })) })
      return { id: r?.template?.id ?? r?.id ?? r?.templateId }
    },
    async cambiarPlantilla(plantilla, estado) {
      return api.moverPlantillaInspeccion(plantilla.id, { expectedStatus: plantilla.estado, status: estado })
    },
    async plantillas({ estado = '' } = {}) {
      const r = await api.plantillasDeInspeccion({ status: estado })
      return (r?.items ?? []).map((t) => ({
        id: t.id, codigo: t.code, version: t.version, nombre: t.name, estado: t.status, puntos: t.itemCount ?? 0,
      }))
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
  }))
}

export default repoApi
