// Une únicamente el equipo de la instalación visible en la API autorizada.
// La recepción cambia la señal; nunca crea posición, velocidad ni marcha.
export function conRecepcionEquipo(unidad, equipo, ubicacion = null, ahora = Date.now()) {
  if (!equipo || equipo.vehicleId !== unidad.id || !['meitrack-t399', 'coban-gps103'].includes(equipo.protocolFamily)
    || !equipo.installationId || (unidad.empresaId && equipo.operatingTenantId !== unidad.empresaId)) return unidad
  const recibido = Date.parse(equipo.lastConnectionAt)
  const instalado = Date.parse(equipo.installedAt)
  if (!Number.isFinite(recibido) || !Number.isFinite(instalado) || recibido < instalado || recibido > ahora) return unidad
  const senal = Date.parse(unidad.ultimoReporte)
  const posicion = Date.parse(unidad.posicionEn ?? unidad.ultimoReporte)
  const ultima = Number.isFinite(senal) && senal > recibido ? unidad.ultimoReporte : equipo.lastConnectionAt
  const soloRecepcion = !Number.isFinite(posicion) || ahora - posicion >= 300000
  return { ...unidad, ultimoReporte: ultima, recepcionGpsAt: equipo.lastConnectionAt,
    soloRecepcion, ubicacionGps: ubicacion, conectado: ahora - Date.parse(ultima) < 300000,
    conexion: ahora - Date.parse(ultima) < 300000 ? 'reportando' : 'sin_senal',
    ...(soloRecepcion ? { estadoMarcha: null, velocidadKmh: null, ignition: null } : {}) }
}

/** Inventario autorizado: una sola instalación inequívoca por vehículo. */
export function conRecepcionFlota(unidades, equipos, empresaId = null, ahora = Date.now()) {
  const porVehiculo = new Map()
  for (const equipo of equipos) {
    if (!equipo.vehicleId) continue
    const anteriores = porVehiculo.get(equipo.vehicleId) ?? []
    anteriores.push(equipo)
    porVehiculo.set(equipo.vehicleId, anteriores)
  }
  return unidades.map(unidad => {
    const candidatos = porVehiculo.get(unidad.id) ?? []
    const equipo = candidatos.length === 1 ? candidatos[0] : null
    if (empresaId && equipo?.operatingTenantId !== empresaId) return unidad
    return conRecepcionEquipo(unidad, equipo, unidad.ubicacionGps ?? null, ahora)
  })
}
