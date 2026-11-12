import { distanciaM } from '../datos/recorrido.js'
import * as f from '../datos/formato.js'

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Sólo agrupa las etiquetas de visitas al mismo sitio; no fusiona sus horarios,
// duraciones ni números. Así dos paradas superpuestas siguen siendo encontrables.
export function gruposDeParadas(paradas) {
  const groups = []
  for (const stop of [...paradas].sort((a, b) => a.numero - b.numero)) {
    let group = groups.find(g => distanciaM(g, stop) <= 25)
    if (!group) { group = { lat: stop.lat, lng: stop.lng, paradas: [] }; groups.push(group) }
    group.paradas.push(stop)
  }
  return groups.map(g => ({ ...g, numeros: g.paradas.map(p => p.numero).join('·'),
    clase: g.paradas.length > 1 ? 'parada parada-multiple' : 'parada',
    texto: g.paradas.length > 1 ? `${g.paradas.length} paradas` : f.duracion(g.paradas[0].minutos),
  }))
}

export function detalleParadas(group) {
  return group.paradas.map(p => `<strong>Parada ${esc(p.numero)} · ${esc(f.duracion(p.minutos))}</strong>` +
    `<span>${esc(f.hora(p.desde))} → ${esc(f.hora(p.hasta))}</span>` +
    `<span>${esc(f.fechaCorta(p.desde))}</span>`).join('')
}
