// Screen-space spacing keeps these small chevrons proportional to the 5px line
// at every zoom. Geometry order is the GPS trip order, never vehicle heading.
export const DIRECTION_SVG = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="m3 2 4 3-4 3" fill="none" stroke="#d7edff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'

export function directionImage() {
  const data = new Uint8Array(20 * 20 * 4)
  const distance = (x, y, ax, ay, bx, by) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
    return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay))
  }
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
    const d = Math.min(distance(x + 0.5, y + 0.5, 6, 4, 14, 10), distance(x + 0.5, y + 0.5, 14, 10, 6, 16))
    data.set([215, 237, 255, Math.round(255 * Math.max(0, Math.min(1, 1.9 - d)))], (y * 20 + x) * 4)
  }
  return { width: 20, height: 20, data }
}

function clip(a, b, width, height) {
  let lo = 0, hi = 1
  const dx = b.x - a.x, dy = b.y - a.y
  for (const [p, q] of [[-dx, a.x - 10], [dx, width - 10 - a.x], [-dy, a.y - 10], [dy, height - 10 - a.y]]) {
    if (!p) { if (q < 0) return null; continue }
    const t = q / p
    if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t)
    if (lo > hi) return null
  }
  return [{ x: a.x + lo * dx, y: a.y + lo * dy }, { x: a.x + hi * dx, y: a.y + hi * dy }]
}

export function directionPoints(points, { width, height, spacing = 96, maximum = 80 }) {
  if (!(width > 20 && height > 20 && spacing >= 24 && Number.isInteger(maximum) && maximum > 0)) return []
  const arrows = []
  let remaining = spacing / 2, last = null
  for (let i = 1; i < points.length && arrows.length < maximum; i++) {
    const p = points[i - 1], q = points[i]
    if (![p?.x, p?.y, q?.x, q?.y].every(Number.isFinite)) { last = null; continue }
    const segment = clip(p, q, width, height)
    if (!segment) { last = null; continue }
    const [a, b] = segment, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
    if (length < 0.01) continue
    if (!last || Math.hypot(a.x - last.x, a.y - last.y) > 1) remaining = spacing / 2
    while (remaining < length && arrows.length < maximum) {
      // Avoid placing a chevron across a sharp bend or on an endpoint marker.
      if (remaining >= 7 && length - remaining >= 7)
        arrows.push({ x: a.x + dx * remaining / length, y: a.y + dy * remaining / length, angle: Math.atan2(dy, dx) * 180 / Math.PI })
      remaining += spacing
    }
    remaining -= length
    last = b
  }
  return arrows
}

export function mapboxDirections(map, source) {
  const id = `${source}-sentido`
  map.addImage(id, directionImage(), { pixelRatio: 2 })
  map.addLayer({ id, type: 'symbol', source, slot: 'top', layout: {
    'symbol-placement': 'line', 'symbol-spacing': 96, 'icon-image': id,
    'icon-size': 1, 'icon-rotation-alignment': 'map', 'icon-keep-upright': false,
    'icon-allow-overlap': false, 'icon-ignore-placement': true,
  }, paint: { 'icon-opacity': 0.68, 'icon-emissive-strength': 1 } })
  return {
    highlight(number) {
      if (map.getLayer(id)) map.setPaintProperty(id, 'icon-opacity', number == null ? 0.68 : ['case', ['==', ['get', 'numero'], number], 0.8, 0.15])
    },
    remove() {
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.hasImage(id)) map.removeImage(id)
    },
  }
}

export function leafletDirections(L, map, trips, group) {
  const arrows = L.layerGroup().addTo(group)
  let current = trips, selected = null
  const render = () => {
    arrows.clearLayers()
    const size = map.getSize()
    let budget = 80
    for (const trip of current) {
      if (!budget) break
      const points = trip.puntos.map(p => map.latLngToContainerPoint([p.lat, p.lng]))
      const positions = directionPoints(points, { width: size.x, height: size.y, maximum: budget })
      budget -= positions.length
      const opacity = selected == null ? 0.68 : selected === trip.numero ? 0.8 : 0.15
      for (const p of positions) L.marker(map.containerPointToLatLng([p.x, p.y]), {
        interactive: false, keyboard: false, pane: 'overlayPane', zIndexOffset: 1000, opacity,
        icon: L.divIcon({ className: 'ruta-flecha', iconSize: [10, 10], iconAnchor: [5, 5],
          html: `<span style="display:block;pointer-events:none;width:10px;height:10px;transform:rotate(${p.angle}deg)">${DIRECTION_SVG}</span>` }),
      }).addTo(arrows)
    }
  }
  map.on('zoomend moveend', render)
  render()
  return {
    highlight(number) { selected = number; render() },
    remove() { map.off('zoomend moveend', render); arrows.remove() },
  }
}
