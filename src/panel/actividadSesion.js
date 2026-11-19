export const INACTIVIDAD_SESION_MS = 15 * 60_000

/** Human activity only. Wall and monotonic clocks cover suspension and clock changes. */
export function crearRelojInactividad({ ahora = Date.now, monotono = () => performance.now(),
  programar = setTimeout, cancelar = clearTimeout, alVencer, plazo = INACTIVIDAD_SESION_MS,
  ultimaActividad = ahora(), autoIniciar = true } = {}) {
  let ultimo = ultimaActividad, ultimoMonotono = monotono() - Math.max(0, ahora() - ultimaActividad), timer, terminado = false
  const transcurrido = () => Math.max(0, ahora() - ultimo, monotono() - ultimoMonotono)
  function comprobar() {
    if (terminado) return true
    cancelar(timer)
    const restante = plazo - transcurrido()
    if (restante <= 0) { terminado = true; alVencer(); return true }
    timer = programar(comprobar, restante)
    return false
  }
  function actividad(instante = ahora()) {
    // A late first interaction must not revive a session that already expired.
    if (comprobar() || !Number.isFinite(instante) || instante > ahora() + 2000 || instante < ultimo) return false
    ultimo = instante; ultimoMonotono = monotono()
    comprobar()
    return true
  }
  if (autoIniciar) comprobar()
  return { comprobar, actividad, detener() { terminado = true; cancelar(timer) } }
}
