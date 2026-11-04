// Une únicamente el equipo de la instalación visible en la API autorizada.
// La recepción cambia la señal; nunca crea posición, velocidad ni marcha.
export function conRecepcionEquipo(unidad, equipo, ubicacion = null, ahora = Date.now()) {
  if (!equipo || equipo.vehicleId !== unidad.id || equipo.protocolFamily !== 'meitrack-t399'
    || !equipo.installationId || (unidad.empresaId && equipo.operatingTenantId !== unidad.empresaId)) return unidad
  const recibido = Date.parse(equipo.lastConnectionAt)
  const instalado = Date.parse(equipo.installedAt)
  if (!Number.isFinite(recibido) || !Number.isFinite(instalado) || recibido < instalado || recibido > ahora) return unidad
  const publicado = Date.parse(unidad.ultimoReporte)
  const ultima = Number.isFinite(publicado) && publicado > recibido ? unidad.ultimoReporte : equipo.lastConnectionAt
  const soloRecepcion = !Number.isFinite(publicado) || ahora - publicado >= 300000
  return { ...unidad, ultimoReporte: ultima, recepcionGpsAt: equipo.lastConnectionAt,
    soloRecepcion, ubicacionGps: ubicacion, conectado: ahora - Date.parse(ultima) < 300000,
    conexion: ahora - Date.parse(ultima) < 300000 ? 'reportando' : 'sin_senal',
    ...(soloRecepcion ? { estadoMarcha: null, velocidadKmh: null, ignition: null } : {}) }
}
