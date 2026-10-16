import { estadoUnidad } from '../datos/estadoUnidad.js'

export const MARKER_SIZE = [174, 76]
export const MARKER_ANCHOR = [26, 40]
const COLORS = { verde: '#35e888', ambar: '#ffbf43', gris: '#a1afbf' }
export const escapeXml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))

/** SVG shared by Leaflet, Google Maps and the schematic fallback. No HTML from API. */
export function vehicleMarkerSvg(vehicle, selected = false) {
  const status = estadoUnidad(vehicle)
  const color = COLORS[status.color]
  const accent = selected ? '#168fff' : color
  const heading = Number.isFinite(vehicle.rumbo) ? ((vehicle.rumbo % 360) + 360) % 360 : null
  const plate = escapeXml(String(vehicle.placa || vehicle.alias || 'Sin placa').slice(0, 22))
  const labelSize = plate.length > 11 ? 10 : 13
  // La sombra va dibujada dentro del SVG (formas negras translúcidas, sin <filter>): un
  // `filter: drop-shadow` en CSS obligaba a repintar cada marcador en cada cuadro al mover el mapa.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="174" height="76" viewBox="0 0 174 76">
    <g class="fleet-marker-label">
      <rect x="45" y="5" width="127" height="49" rx="13" fill="#000" fill-opacity=".14"/>
      <rect x="46" y="5.5" width="125" height="46.5" rx="12" fill="#000" fill-opacity=".2"/>
      <rect x="46" y="3" width="125" height="46" rx="12" fill="#0b1927" stroke="${accent}" stroke-width="${selected ? 2.5 : 1}"/>
      <circle cx="58" cy="18" r="4" fill="${color}"/>
      <text x="69" y="23" fill="#f5f8fc" font-family="Arial,sans-serif" font-size="${labelSize}" font-weight="700">${plate}</text>
      <text x="69" y="39" fill="${color}" font-family="Arial,sans-serif" font-size="11">${status.texto}</text>
    </g>
    <g transform="rotate(${heading ?? 0} 26 40)">
      <rect x="13" y="19" width="26" height="47" rx="9" fill="#000" fill-opacity=".14"/>
      <rect x="14" y="20" width="24" height="45" rx="8" fill="#000" fill-opacity=".2"/>
      ${selected ? '<rect x="12" y="14" width="28" height="52" rx="9" fill="#0c2e4f" stroke="#168fff" stroke-width="2"/>' : ''}
      <rect x="11" y="26" width="5" height="10" rx="2" fill="#070e16"/>
      <rect x="36" y="26" width="5" height="10" rx="2" fill="#070e16"/>
      <rect x="12" y="48" width="4" height="10" rx="1" fill="#070e16"/>
      <rect x="36" y="48" width="4" height="10" rx="1" fill="#070e16"/>
      <rect x="15" y="18" width="22" height="44" rx="7" fill="#e4e9ef" stroke="#4b5968" stroke-width="1.5"/>
      <path d="M18 29 Q26 25 34 29 L33 36 L19 36Z" fill="#203344"/>
      <path d="M18 47 L34 47 L33 57 L19 57Z" fill="#344658"/>
      <rect x="19" y="37" width="14" height="9" rx="2" fill="#fafcff"/>
      <path d="M17 23h5m8 0h5" stroke="#fff" stroke-width="2"/>
      ${heading == null ? '' : `<path d="M26 4 L32 13 L26 11 L20 13Z" fill="${accent}" stroke="#07121e" stroke-width="1"/>`}
    </g>
  </svg>`
}

export const vehicleMarkerUrl = (vehicle, selected) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(vehicleMarkerSvg(vehicle, selected))}`

export function validPosition(v) {
  return Number.isFinite(v?.lat) && Number.isFinite(v?.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180
}
