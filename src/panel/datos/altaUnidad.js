import { placaMayuscula } from './placas.js'

/** El activo existe independientemente de su telemetría (#767). */
export function cuerpoNuevaUnidad({ alias, placa, marca, modelo, anio, tipo, numero }) {
  const nombre = alias?.trim() || ''
  const matricula = placaMayuscula(placa?.trim()) || ''
  const interno = numero?.trim() || ''
  const code = (interno || matricula || nombre).toLowerCase().replace(/\s+/gu, '-')
  if (!code) throw new Error('Indica una placa, un alias o un número interno para identificar la unidad.')
  if (code.length > 60) throw new Error('Usa un número interno o una identificación de hasta 60 caracteres.')
  return {
    code, plate: matricula || undefined, alias: nombre || undefined,
    fleetNumber: interno || undefined, make: marca?.trim() || undefined,
    model: modelo?.trim() || undefined, modelYear: anio ? Number(anio) : undefined,
    vehicleType: tipo || 'otro',
  }
}

/** Misma elegibilidad administrativa que installGpsDevice; reportar no certifica. */
export function gpsDisponible(g) {
  return g.estado === 'inventory' && !g.vehiculoId && !g.instalacionId
}

export async function crearUnidad(datos, api) {
  const r = await api.crearVehiculo(cuerpoNuevaUnidad(datos))
  const id = r?.vehicleId ?? r?.vehicle?.id ?? null
  if (!id) throw new Error('No se pudo confirmar el identificador de la unidad. Revisa la flota antes de volver a crearla.')
  const pendientes = []
  // Nunca volver a crear ni borrar una unidad porque falle un efecto posterior.
  if (datos.areaId) {
    try { await api.actualizarVehiculo(id, { areaId: datos.areaId }) }
    catch { pendientes.push('No se confirmó el área; revísala en el expediente.') }
  }
  if (datos.gpsId) {
    try { await api.instalarEquipoGps(datos.gpsId, { vehicleId: id }) }
    catch { pendientes.push('No se confirmó la instalación del GPS. Comprueba el inventario y la unidad antes de volver a instalarlo.') }
  }
  return { id, pendientes }
}
