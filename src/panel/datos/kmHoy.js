export function fechaEnZona(ahora, zona) {
  try {
    const partes = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(ahora)
    const valor = tipo => partes.find(p => p.type === tipo)?.value
    return `${valor('year')}-${valor('month')}-${valor('day')}`
  } catch { return null }
}

// Hoy se define en la zona del acumulado del servidor, nunca como últimas24h.
export function metricaDeHoy(items, ahora = Date.now()) {
  const actuales = (items ?? []).filter(m => typeof m.timezoneName === 'string' && m.timezoneName && m.metricDate === fechaEnZona(ahora, m.timezoneName))
  if (actuales.length !== 1) return null
  const m = actuales[0]
  if (!['number','string'].includes(typeof m.distanceMeters) || typeof m.distanceMeters === 'string' && !m.distanceMeters.trim()) return null
  if (m.distanceMeters == null || m.distanceMeters === '' || !Number.isFinite(Number(m.distanceMeters)) || Number(m.distanceMeters) < 0) return null
  return { km:Number(m.distanceMeters)/1000, parcial:m.calculationStatus !== 'complete', fecha:m.metricDate, zona:m.timezoneName, calculadoEn:m.computedAt ?? null }
}

export async function leerKmHoy(pedirMetricas, vehiculoId, ahora = Date.now()) {
  // Incluye ambos lados del día UTC para localizar hoy en la zona publicada.
  const desde = new Date(ahora - 86400000).toISOString().slice(0,10)
  const hasta = new Date(ahora + 86400000).toISOString().slice(0,10)
  const r = await pedirMetricas(vehiculoId, desde, hasta)
  return metricaDeHoy(r?.items, ahora)
}

export function lecturaKmSeleccionado(carga, vehiculoId) {
  const coincide = carga.datos?.vehiculoId === vehiculoId
  return { estado: carga.estado === 'error' ? 'error' : !coincide ? 'cargando' : carga.estado,
    metrica: coincide ? carga.datos.metrica : null }
}
