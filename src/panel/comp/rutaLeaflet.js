// Dibujo del recorrido sobre Leaflet: viajes con su inicio y su fin, paradas, la hora de
// cada punto al pasar el cursor o hacer clic, y la cola de los últimos minutos.
import * as f from '../datos/formato'
import { distanciaM, puntoEnRuta } from '../datos/recorrido'
import { leafletDirections } from './routeDirections'
import { gruposDeParadas, detalleParadas } from './paradasMapa'

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const pin = (clase, letra, texto, detalle = '') =>
  `<span class="ruta-pin ${clase}"><b>${esc(letra)}</b>${texto ? `<em>${esc(texto)}${detalle ? `<small>${esc(detalle)}</small>` : ''}</em>` : ''}</span>`

function icono(L, html, ancho = 130) {
  return L.divIcon({ className: 'ruta-pin-caja', html, iconSize: [ancho, 30], iconAnchor: [15, 15] })
}

/** El texto de un punto del trazado: la hora y, si se sabe, la velocidad. */
function textoPunto(p, viaje) {
  const vel = p.velocidadKmh == null ? '' : ` · ${f.velocidad(p.velocidadKmh)}`
  return `<b>${esc(f.hora(p.hora))}</b>${vel}`
}

/**
 * Pinta viajes y paradas en un grupo de capas nuevo y lo devuelve junto a los límites.
 * Cada viaje es una línea visible y otra invisible, más ancha, que recibe el cursor.
 */
export function pintarRuta(L, mapa, { viajes = [], paradas = [], color = '#349bfa', alElegirViaje }) {
  const grupo = L.layerGroup().addTo(mapa)
  const sentido = leafletDirections(L, mapa, viajes, grupo)
  grupo.once('remove', () => sentido.remove())
  const limites = []
  const lineas = new Map()
  const marcas = new Map()
  // El inicio o el fin que caen en una parada se cuentan en la propia parada: un solo marcador.
  const enParada = (lugar) => paradas.some((x) => distanciaM(lugar, x) <= 150)
  let popupAbierto = false
  mapa.on('popupclose', () => { popupAbierto = false })
  const sonda = L.circleMarker([0, 0], { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, interactive: false })

  for (const viaje of viajes) {
    const trazo = viaje.puntos.map((p) => [p.lat, p.lng])
    limites.push(...trazo)
    lineas.set(viaje.numero, L.polyline(trazo, { color, weight: 5, opacity: 0.95, lineJoin: 'round' }).addTo(grupo))
    marcas.set(viaje.numero, [])
    const zona = L.polyline(trazo, { color, weight: 24, opacity: 0.001, lineJoin: 'round' }).addTo(grupo)
    zona.on('mousemove', (e) => {
      const p = puntoEnRuta(viaje.puntos, e.latlng)
      if (!p || popupAbierto) return
      sonda.setLatLng([p.lat, p.lng])
      if (!mapa.hasLayer(sonda)) sonda.addTo(mapa)
      sonda.unbindTooltip().bindTooltip(textoPunto(p, viaje), { permanent: true, direction: 'bottom', offset: [0, 12], className: 'ruta-hora' }).openTooltip()
    })
    zona.on('mouseout', () => sonda.remove())
    zona.on('click', (e) => {
      const p = puntoEnRuta(viaje.puntos, e.latlng)
      if (!p) return
      popupAbierto = true
      alElegirViaje?.(viaje.numero)
      sonda.remove()
      L.popup({ className: 'ruta-popup', closeButton: true, offset: [0, -4], autoPan: false })
        .setLatLng([p.lat, p.lng])
        .setContent(
          `<strong>${esc(f.hora(p.hora))}</strong><span>${esc(f.fechaCorta(p.hora))}</span>` +
            (p.velocidadKmh == null ? '' : `<span>${esc(f.velocidad(p.velocidadKmh))}</span>`) +
            `<span>Viaje ${viaje.numero}</span>`,
        )
        .openOn(mapa)
    })

    if (!enParada(viaje.inicio)) {
      const marcaA = L.marker([viaje.inicio.lat, viaje.inicio.lng], {
        icon: icono(L, pin('inicio', 'A', `Inicio ${f.hora(viaje.inicio.hora)}`), 150),
        zIndexOffset: 400,
      })
        .bindPopup(`<strong>Inicio del viaje ${viaje.numero}</strong><span>${esc(f.fechaHora(viaje.inicio.hora))}</span>`, { className: 'ruta-popup', autoPan: false })
        .addTo(grupo)
      marcas.get(viaje.numero).push(marcaA)
    }

    if (!viaje.fin.enCurso && !enParada(viaje.fin)) {
      const marcaB = L.marker([viaje.fin.lat, viaje.fin.lng], {
        icon: icono(L, pin('fin', 'B', `Fin ${f.hora(viaje.fin.hora)}`), 150),
        zIndexOffset: 400,
      })
        .bindPopup(
          `<strong>Fin del viaje ${viaje.numero}</strong><span>${esc(f.fechaHora(viaje.fin.hora))}</span>` +
            `<span>${esc(f.duracion(viaje.minutos))} · ${esc((viaje.distanciaM / 1000).toFixed(1))} km</span>`,
          { className: 'ruta-popup', autoPan: false },
        )
        .addTo(grupo)
      marcas.get(viaje.numero).push(marcaB)
    }
  }

  for (const parada of gruposDeParadas(paradas)) {
    limites.push(...parada.paradas.map(p => [p.lat, p.lng]))
    L.marker([parada.lat, parada.lng], {
      icon: icono(L, pin(parada.clase, parada.numeros, parada.texto), 100),
      title: `Parada ${parada.numeros}`,
      zIndexOffset: 300,
    })
      .bindPopup(
        detalleParadas(parada),
        { className: 'ruta-popup', autoPan: false },
      )
      .addTo(grupo)
  }
  /** Resalta un viaje (`numero`) y aclara los demás; sin número, todos vuelven a su estilo normal. */
  const resaltar = (numero) => {
    sentido.highlight(numero)
    const hay = numero != null
    for (const [n, linea] of lineas) {
      const es = n === numero
      linea.setStyle({ opacity: hay && !es ? 0.2 : 0.95, weight: es ? 8 : 5 })
      if (es) linea.bringToFront()
      marcas.get(n)?.forEach((m) => m.setOpacity(hay && !es ? 0.3 : 1))
    }
  }
  return { grupo, limites, resaltar }
}

/** La cola reciente: una línea punteada y tenue, con un punto donde empieza. */
export function pintarCola(L, mapa, puntos, color = '#349bfa') {
  const grupo = L.layerGroup().addTo(mapa)
  const trazo = puntos.map((p) => [p.lat, p.lng])
  L.polyline(trazo, { color, weight: 6, opacity: 0.9, dashArray: '1 11', lineCap: 'round' }).addTo(grupo)
  const primero = puntos[0]
  L.circleMarker(trazo[0], { radius: 5, color, weight: 2, fillColor: '#0b1824', fillOpacity: 1 })
    .bindTooltip(`Hace unos minutos · ${f.hora(primero.hora)}`, { direction: 'top', className: 'ruta-hora' })
    .addTo(grupo)
  return grupo
}
