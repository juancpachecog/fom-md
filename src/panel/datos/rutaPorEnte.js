// Cómo trabaja el administrador FOM «dentro» de una empresa.
//
// El servidor ya no lee una cabecera para cambiar de empresa (Issue 567): cada lectura o
// escritura de una empresa ajena viaja con la empresa EN LA RUTA, `/tenants/{id}/...`, y el
// servidor vuelve a autorizarla. Desde la Issue 594 casi toda la consola tiene su versión por
// empresa (lista abajo, copiada de las rutas publicadas en fom-core). Lo que NO la tiene se
// rechaza antes de salir: mandarlo tal cual devolvería los datos de la empresa propia del
// administrador como si fueran los de la elegida.

const CONSOLA = '/api/v1/console'

/** Rutas que son del administrador o de la plataforma, no de una empresa: no cambian. */
const GLOBALES = [
  /^\/auth\//,
  /^\/tenants(\/|\?|$)/,
  /^\/tenant-relationships\//,
  /^\/platform\//,
  /^\/audit(\?|$)/,
  /^\/identity-transfers/,
  /^\/vehicle-transfers/,
  /^\/gps-devices(\/|\?|$)/,
  /^\/gps-installations\//,
]

const Q = '(?:\\?.*)?'
const ID = '[^/?]+'

/** `:x` → un segmento cualquiera; el resto, literal. */
function patron(ruta) {
  const cuerpo = ruta
    .split('/')
    .map((s) => (s.startsWith(':') ? ID : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp(`^${cuerpo}${Q}$`)
}

/** Rutas con versión `/tenants/{id}/…` en fom-core, por método (relativas a /api/v1/console). */
const ESPEJOS = {
  GET: [
    '/gps-managed-catalog', '/gps-managed-catalog/:id', '/gps-managed-catalog/:id/history',
    '/vehicles', '/vehicles/:v', '/vehicles/:v/daily-metrics', '/vehicles/:v/position/latest', '/vehicles/:v/positions',
    '/vehicles/:v/telemetry-capabilities', '/vehicles/:v/odometer', '/vehicles/:v/archive-preflight',
    '/directory', '/notifications', '/summary', '/areas', '/drivers',
    '/fleet-expenses', '/fleet-expenses/months', '/driver-metrics', '/operational-report',
    '/work-orders', '/work-orders/:w', '/work-orders/:w/execution',
    '/inspections', '/inspections/:i', '/inspection-schedules', '/inspection-findings',
    '/inspections/:i/findings/:a/follow-up', '/inspection-templates', '/inspection-templates/:t',
    '/documents', '/alert-rules', '/maintenance/plans', '/maintenance/plans/:p', '/maintenance/actions', '/maintenance/actions/:a',
    '/driving-scores', '/drivers/:d/driving-score', '/drivers/:d/driving-events',
    '/alert-events', '/alert-events/:e', '/emergencies', '/emergencies/:e', '/driver-sessions', '/driver-sessions/:s',
    '/:coleccion/:padre/objects',
  ],
  POST: [
    '/gps-managed-catalog',
    '/users', '/users/:u/rehire', '/users/:u/credential-reset', '/fleet-expenses',
    '/vehicles', '/vehicles/:v/drivers', '/vehicles/:v/archive', '/areas',
    '/work-orders', '/work-orders/:w/execution-events',
    '/inspection-schedules', '/inspection-schedules/:s/cancel', '/inspections/:i/findings/:a/follow-up', '/inspection-templates',
    '/documents', '/alert-rules',
    '/alert-events/:e/acknowledge', '/alert-events/:e/resolve', '/emergencies/:e/acknowledge', '/emergencies/:e/resolve',
    '/notifications/read-all', '/notifications/dismiss-read',
    '/gps-devices', '/gps-devices/:d/installation',
    '/:coleccion/:padre/uploads', '/uploads/:u/complete', '/:coleccion/:padre/objects/:o/downloads',
  ],
  PATCH: [
    '/users/:u/credentials',
    '/users/:u', '/users/:u/profile', '/vehicles/:v', '/driver-assignments/:a/revoke', '/driver-assignments/:a/pin', '/areas/:a',
    '/work-orders/:w/status', '/inspection-templates/:t/status', '/inspection-templates/:t/weekdays', '/documents/:d', '/alert-rules/:r',
    '/maintenance/plans/:p', '/maintenance/actions/:a/status',
    '/notifications/:n/read', '/notifications/:n/dismiss',
    '/gps-devices/:d', '/gps-installations/:a/remove',
  ],
  PUT: [
    '/gps-managed-catalog/:id',
    '/work-orders/:w/assignee', '/maintenance/plans/:p', '/maintenance/plans/:p/vehicles/:v', '/maintenance/actions/:a',
    '/gps-devices/:d/capabilities',
  ],
  DELETE: ['/maintenance/plans/:p/vehicles/:v'],
}

const REGLAS = Object.fromEntries(Object.entries(ESPEJOS).map(([m, lista]) => [m, lista.map(patron)]))

/**
 * `null` si la ruta no tiene versión por empresa; la misma ruta si es global; o la ruta con
 * la empresa en el camino. `ruta` incluye el prefijo `/api/v1/console`.
 */
export function aRutaPorEnte(ruta, metodo, enteId) {
  if (!enteId || !ruta.startsWith(`${CONSOLA}/`)) return ruta
  const resto = ruta.slice(CONSOLA.length)
  // Primero las que tienen versión por empresa (incluidas las altas de equipos GPS); después, lo global.
  const reglas = REGLAS[metodo.toUpperCase()] ?? []
  if (reglas.some((r) => r.test(resto))) return `${CONSOLA}/tenants/${enteId}${resto}`
  if (GLOBALES.some((r) => r.test(resto))) return ruta
  return null
}

export const SIN_RUTA_POR_ENTE =
  'Esta pantalla todavía no se puede ver ni modificar desde otra empresa: el servidor aún no tiene esa ruta por empresa. Sal de la empresa para ver tus propios datos.'
