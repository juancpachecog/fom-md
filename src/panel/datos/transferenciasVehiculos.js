import { placaMayuscula } from './placas.js'

const etiquetas = [
  ['gpsInstallations', 'GPS instalado', 'GPS instalados', 'Revisar telemetría', 'telemetria'],
  ['driverAssignments', 'asignación de conductor vigente', 'asignaciones de conductor vigentes', 'Revisar conductores', 'usuarios'],
  ['driverSessions', 'jornada abierta', 'jornadas abiertas', 'Revisar conductores', 'usuarios'],
  ['workOrders', 'orden de trabajo abierta', 'órdenes de trabajo abiertas', 'Revisar órdenes', 'mantenimiento'],
  ['emergencies', 'emergencia pendiente', 'emergencias pendientes', 'Revisar expediente', 'resumen'],
]

const etiquetasGps = [
  ['tests', 'prueba de GPS vigente', 'pruebas de GPS vigentes', 'Revisar telemetría', 'telemetria'],
  ['commands', 'comando de GPS pendiente', 'comandos de GPS pendientes', 'Revisar telemetría', 'telemetria'],
]

function mostrarDependencias(bloqueos, nombres) {
  return nombres.flatMap(([clave, singular, plural, accion, vista]) => {
    const cantidad = bloqueos?.[clave]
    return Number.isSafeInteger(cantidad) && cantidad > 0
      ? [{ clave, texto: `${cantidad} ${cantidad === 1 ? singular : plural}`, accion, vista }]
      : []
  })
}

export function dependenciasDeTransferencia(bloqueos) {
  return mostrarDependencias(bloqueos, etiquetas)
}

export function bloqueosGpsDeEntrega(bloqueos) {
  return mostrarDependencias(bloqueos, etiquetasGps)
}

export function dependenciasConfirmadas(bloqueos) {
  return etiquetas.every(([clave]) => Number.isSafeInteger(bloqueos?.[clave]) && bloqueos[clave] >= 0)
}

export function sugerirContinuidadEntrega(inventario, operaciones) {
  return {
    categories: [],
    gps: operaciones?.gpsInstallations > 0
      && operaciones.gpsInstallationsWithRecentQualifiedPosition === operaciones.gpsInstallations ? 'continue' : null,
    driver: operaciones?.driverAssignments > 0 && operaciones.principalDriverEligible ? 'continue_principal' : null,
    orders: inventario?.openWorkOrders > 0 && inventario.openOrdersLinkedToMaintenance === 0 ? 'continue' : null,
  }
}

export function explicarAceptacion(error) {
  if (conflictoDeDependencias(error)) return 'El origen todavía tiene operaciones activas. Actualiza la revisión para ver los pendientes.'
  if (error?.estado === 409) {
    switch (error.message) {
      case 'Transfer conflicts with current vehicle state':
        return 'El servidor encontró un conflicto con el estado o historial del vehículo. La entrega sigue pendiente.'
      case 'Destination vehicle code is already in use':
        return 'El código del vehículo ya está en uso en la empresa de destino.'
      default:
        return 'La solicitud cambió o ya fue procesada. Actualiza la revisión antes de continuar.'
    }
  }
  return error?.message || 'No se pudo confirmar la entrega.'
}

export function conflictoDeDependencias(error) {
  return error?.estado === 409 && /^Vehicle has active dependencies$/iu.test(error.message ?? '')
}

export function coincideConPlaca(codigo, placa) {
  return typeof placa === 'string' && Boolean(placa.trim())
    && typeof codigo === 'string' && placaMayuscula(codigo.trim()) === placaMayuscula(placa.trim())
}

/** Sólo añade una placa devuelta por la ficha autorizada de la unidad. */
export async function placasDeTransferencias(filas, leerVehiculo) {
  const grupos = new Map()
  for (const fila of filas) {
    const empresa = fila.estado === 'completed' ? fila.destinoId : fila.origenId
    if (!fila.vehiculoId || !empresa) continue
    const clave = `${empresa}:${fila.vehiculoId}`
    if (!grupos.has(clave)) grupos.set(clave, { empresa, vehiculo: fila.vehiculoId, ids: [] })
    grupos.get(clave).ids.push(fila.id)
  }
  const lecturas = [...grupos.values()]
  const placas = Object.create(null)
  for (let i = 0; i < lecturas.length; i += 4) {
    await Promise.allSettled(lecturas.slice(i, i + 4).map(async ({ empresa, vehiculo, ids }) => {
      const { vehicle } = await leerVehiculo(vehiculo, empresa)
      if (vehicle?.id !== vehiculo || !vehicle.plate) return
      for (const id of ids) placas[id] = placaMayuscula(vehicle.plate)
    }))
  }
  return placas
}
