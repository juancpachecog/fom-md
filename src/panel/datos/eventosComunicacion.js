// Closed metadata only: never request bodies, identities, URLs or credentials.
const oyentes = new Set()
export function alCambiarComunicacion(fn) { oyentes.add(fn); return () => oyentes.delete(fn) }
export function avisarComunicacion(evento) {
  const seguro = { tipo: evento.tipo, estado: evento.estado || 0 }
  for (const fn of oyentes) { try { fn(seguro) } catch { /* Request outcome stays unchanged. */ } }
}
