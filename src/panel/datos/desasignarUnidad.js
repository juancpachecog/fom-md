/** End one observed relationship, never cascade or retry an uncertain mutation. */
export async function desasignarUnidad(vehiculoId, relacion, motivo, acciones) {
  if (!vehiculoId || !relacion?.id || !['gps', 'conductor'].includes(relacion.tipo) || !motivo?.trim()) throw Error('Selecciona una asignación y escribe el motivo.')
  const clave = relacion.tipo === 'gps' ? 'gps' : 'conductores'
  const previo = await acciones.leer(vehiculoId)
  if (!previo[clave].some(a => a.id === relacion.id)) throw Error('La asignación cambió. Actualiza la ficha antes de continuar.')
  if (relacion.tipo === 'gps') await acciones.quitarGps(relacion.id, motivo.trim())
  else await acciones.quitarConductor(relacion.id, motivo.trim())
  const posterior = await acciones.leer(vehiculoId)
  if (posterior[clave].some(a => a.id === relacion.id)) throw Error('La retirada no quedó comprobada. Actualiza la ficha antes de repetir.')
  return posterior
}
