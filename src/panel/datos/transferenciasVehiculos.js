import { placaMayuscula } from './placas.js'

const etiquetas = [
  ['gpsInstallations', 'GPS instalado', 'GPS instalados'],
  ['driverAssignments', 'asignación de conductor vigente', 'asignaciones de conductor vigentes'],
  ['driverSessions', 'jornada abierta', 'jornadas abiertas'],
  ['workOrders', 'orden de trabajo abierta', 'órdenes de trabajo abiertas'],
  ['emergencies', 'emergencia pendiente', 'emergencias pendientes'],
]

export function dependenciasDeTransferencia(bloqueos) {
  return etiquetas.flatMap(([clave, singular, plural]) => {
    const cantidad = bloqueos?.[clave]
    return Number.isSafeInteger(cantidad) && cantidad > 0
      ? [{ clave, texto: `${cantidad} ${cantidad === 1 ? singular : plural}` }]
      : []
  })
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
