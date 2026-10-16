// Dibujo del recorrido sobre Mapbox GL: viajes con su inicio y su fin, paradas, la hora de
// cada punto al pasar el cursor o hacer clic, y la cola de los últimos minutos.
// Es el mismo dibujo que `rutaLeaflet.js`, con capas GeoJSON en vez de polilíneas.
import * as f from '../datos/formato'
import { distanciaM, puntoEnRuta } from '../datos/recorrido'

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const pin = (clase, letra, texto, detalle = '') =>
  `<span class="ruta-pin ${clase}"><b>${esc(letra)}</b>${texto ? `<em>${esc(texto)}${detalle ? `<small>${esc(detalle)}</small>` : ''}</em>` : ''}</span>`

/** El texto de un punto del trazado: la hora y, si se sabe, la velocidad. */
function textoPunto(p) {
  const vel = p.velocidadKmh == null ? '' : ` · ${f.velocidad(p.velocidadKmh)}`
  return `<b>${esc(f.hora(p.hora))}</b>${vel}`
}

function marcadorHtml(gl, html, lngLat, { anchor = 'left', offset = [-15, 0], zIndex = 0 } = {}) {
  const el = document.createElement('div')
  el.className = 'ruta-pin-caja'
  el.innerHTML = html
  if (zIndex) el.style.zIndex = String(zIndex)
  return new gl.Marker({ element: el, anchor, offset }).setLngLat(lngLat)
}

function popup(gl, html, extra = {}) {
  return new gl.Popup({ className: 'ruta-popup', closeButton: true, closeOnClick: true, maxWidth: '260px', ...extra }).setHTML(html)
}

const linea = (puntos) => ({ type: 'LineString', coordinates: puntos.map((p) => [p.lng, p.lat]) })
// Un viaje pegado a las calles (Map Matching) trae `trazo` ya en [lng, lat]; si no, se une punto a punto.
const trazoDe = (viaje) => (viaje.trazo?.length > 1 ? { type: 'LineString', coordinates: viaje.trazo } : linea(viaje.puntos))

const coleccionDe = (viajes) => ({
  type: 'FeatureCollection',
  features: viajes.map((viaje) => ({ type: 'Feature', properties: { numero: viaje.numero }, geometry: trazoDe(viaje) })),
})

/**
 * Pinta viajes y paradas y devuelve cómo quitarlos, cómo resaltar uno y cómo
 * cambiarles el trazo sin volver a crear capas (`actualizar`).
 * Cada viaje es una línea visible y otra casi invisible, más ancha, que recibe el cursor.
 */
export function pintarRuta(gl, mapa, { viajes = [], paradas = [], color = '#349bfa', alElegirViaje }) {
  const ID = `ruta-${Date.now().toString(36)}`
  const limites = []
  const marcadores = []
  const marcasPorViaje = new Map()
  const enParada = (lugar) => paradas.some((x) => distanciaM(lugar, x) <= 150)
  let popupAbierto = false
  let popupActual = null

  for (const viaje of viajes) limites.push(...viaje.puntos.map((p) => [p.lng, p.lat]))
  mapa.addSource(ID, { type: 'geojson', data: coleccionDe(viajes) })
  mapa.addLayer({
    id: `${ID}-linea`,
    type: 'line',
    source: ID,
    slot: 'top',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': color, 'line-width': 5, 'line-opacity': 0.95 },
  })
  mapa.addLayer({
    id: `${ID}-zona`,
    type: 'line',
    source: ID,
    slot: 'top',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': color, 'line-width': 24, 'line-opacity': 0.01 },
  })

  // La sonda: un punto que sigue el cursor por el trazado con la hora de ese punto.
  const sondaEl = document.createElement('div')
  sondaEl.className = 'ruta-sonda'
  sondaEl.innerHTML = '<i></i><span class="ruta-hora"></span>'
  const sonda = new gl.Marker({ element: sondaEl, anchor: 'center' })
  let sondaPuesta = false
  const viajePorNumero = new Map(viajes.map((v) => [v.numero, v]))

  const alMover = (e) => {
    if (popupAbierto) return
    const numero = e.features?.[0]?.properties?.numero
    const viaje = viajePorNumero.get(numero) ?? viajePorNumero.get(Number(numero))
    if (!viaje) return
    const p = puntoEnRuta(viaje.puntos, { lat: e.lngLat.lat, lng: e.lngLat.lng })
    if (!p) return
    sonda.setLngLat([p.lng, p.lat])
    sondaEl.querySelector('.ruta-hora').innerHTML = textoPunto(p)
    if (!sondaPuesta) {
      sonda.addTo(mapa)
      sondaPuesta = true
    }
    mapa.getCanvas().style.cursor = 'pointer'
  }
  const alSalir = () => {
    if (sondaPuesta) {
      sonda.remove()
      sondaPuesta = false
    }
    mapa.getCanvas().style.cursor = ''
  }
  const alClic = (e) => {
    const numero = e.features?.[0]?.properties?.numero
    const viaje = viajePorNumero.get(numero) ?? viajePorNumero.get(Number(numero))
    if (!viaje) return
    const p = puntoEnRuta(viaje.puntos, { lat: e.lngLat.lat, lng: e.lngLat.lng })
    if (!p) return
    popupAbierto = true
    alElegirViaje?.(viaje.numero)
    alSalir()
    popupActual?.remove()
    popupActual = popup(gl, `<strong>${esc(f.hora(p.hora))}</strong><span>${esc(f.fechaCorta(p.hora))}</span>` +
      (p.velocidadKmh == null ? '' : `<span>${esc(f.velocidad(p.velocidadKmh))}</span>`) +
      `<span>Viaje ${esc(viaje.numero)}</span>`, { offset: 8 })
      .setLngLat([p.lng, p.lat])
      .addTo(mapa)
    popupActual.on('close', () => { popupAbierto = false })
  }
  mapa.on('mousemove', `${ID}-zona`, alMover)
  mapa.on('mouseleave', `${ID}-zona`, alSalir)
  mapa.on('click', `${ID}-zona`, alClic)

  for (const viaje of viajes) {
    marcasPorViaje.set(viaje.numero, [])
    if (!enParada(viaje.inicio)) {
      const m = marcadorHtml(gl, pin('inicio', 'A', `Inicio ${f.hora(viaje.inicio.hora)}`), [viaje.inicio.lng, viaje.inicio.lat], { zIndex: 4 })
        .setPopup(popup(gl, `<strong>Inicio del viaje ${esc(viaje.numero)}</strong><span>${esc(f.fechaHora(viaje.inicio.hora))}</span>`, { offset: 18 }))
        .addTo(mapa)
      marcadores.push(m)
      marcasPorViaje.get(viaje.numero).push(m)
    }
    if (!viaje.fin.enCurso && !enParada(viaje.fin)) {
      const m = marcadorHtml(gl, pin('fin', 'B', `Fin ${f.hora(viaje.fin.hora)}`), [viaje.fin.lng, viaje.fin.lat], { zIndex: 4 })
        .setPopup(popup(gl, `<strong>Fin del viaje ${esc(viaje.numero)}</strong><span>${esc(f.fechaHora(viaje.fin.hora))}</span>` +
          `<span>${esc(f.duracion(viaje.minutos))} · ${esc((viaje.distanciaM / 1000).toFixed(1))} km</span>`, { offset: 18 }))
        .addTo(mapa)
      marcadores.push(m)
      marcasPorViaje.get(viaje.numero).push(m)
    }
  }

  for (const parada of paradas) {
    limites.push([parada.lng, parada.lat])
    const m = marcadorHtml(gl, pin('parada', 'P', f.duracion(parada.minutos)), [parada.lng, parada.lat], { zIndex: 3 })
      .setPopup(popup(gl, `<strong>Estacionada ${esc(f.duracion(parada.minutos))}</strong>` +
        `<span>${esc(f.hora(parada.desde))} → ${esc(f.hora(parada.hasta))}</span>` +
        `<span>${esc(f.fechaCorta(parada.desde))}</span>`, { offset: 18 }))
      .addTo(mapa)
    marcadores.push(m)
  }

  /** Resalta un viaje (`numero`) y aclara los demás; sin número, todos vuelven a su estilo normal. */
  const resaltar = (numero) => {
    if (!mapa.getLayer(`${ID}-linea`)) return
    const hay = numero != null
    mapa.setPaintProperty(`${ID}-linea`, 'line-opacity', hay ? ['case', ['==', ['get', 'numero'], numero], 0.95, 0.2] : 0.95)
    mapa.setPaintProperty(`${ID}-linea`, 'line-width', hay ? ['case', ['==', ['get', 'numero'], numero], 8, 5] : 5)
    for (const [n, marcas] of marcasPorViaje) {
      marcas.forEach((m) => { m.getElement().style.opacity = hay && n !== numero ? '0.3' : '1' })
    }
  }

  /**
   * Los mismos viajes con otro trazo (por ejemplo, ya pegados a las calles): solo cambia
   * la línea y los puntos de la sonda; las capas y los pines de inicio, fin y paradas se quedan.
   */
  const actualizar = (nuevos = []) => {
    const fuente = mapa.getSource(ID)
    if (!fuente) return
    fuente.setData(coleccionDe(nuevos))
    viajePorNumero.clear()
    for (const v of nuevos) viajePorNumero.set(v.numero, v)
  }

  const quitar = () => {
    mapa.off('mousemove', `${ID}-zona`, alMover)
    mapa.off('mouseleave', `${ID}-zona`, alSalir)
    mapa.off('click', `${ID}-zona`, alClic)
    alSalir()
    popupActual?.remove()
    marcadores.forEach((m) => m.remove())
    for (const capa of [`${ID}-zona`, `${ID}-linea`]) if (mapa.getLayer(capa)) mapa.removeLayer(capa)
    if (mapa.getSource(ID)) mapa.removeSource(ID)
  }

  return { quitar, limites, resaltar, actualizar }
}

const datosCola = (puntos, trazo) => ({ type: 'Feature', properties: {}, geometry: trazo?.length > 1 ? { type: 'LineString', coordinates: trazo } : linea(puntos) })

/**
 * La cola reciente: una línea punteada y tenue, con un punto donde empieza.
 * `actualizar(puntos, trazo)` la mueve en cada refresco sin quitar ni volver a crear la capa.
 */
export function pintarCola(gl, mapa, puntos, color = '#349bfa', trazo = null) {
  const ID = `cola-${Date.now().toString(36)}`
  mapa.addSource(ID, { type: 'geojson', data: datosCola(puntos, trazo) })
  mapa.addLayer({
    id: `${ID}-linea`,
    type: 'line',
    source: ID,
    slot: 'top',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': 6, 'line-opacity': 0.9, 'line-dasharray': [0.1, 1.8] },
  })
  const primero = puntos[0]
  const el = document.createElement('div')
  el.className = 'ruta-cola-inicio'
  el.title = `Hace unos minutos · ${f.hora(primero.hora)}`
  el.style.setProperty('--color', color)
  const marca = new gl.Marker({ element: el, anchor: 'center' }).setLngLat([primero.lng, primero.lat]).addTo(mapa)
  return {
    actualizar: (nuevos, nuevoTrazo = null) => {
      const fuente = mapa.getSource(ID)
      if (!fuente || !nuevos?.length) return
      fuente.setData(datosCola(nuevos, nuevoTrazo))
      marca.setLngLat([nuevos[0].lng, nuevos[0].lat])
      el.title = `Hace unos minutos · ${f.hora(nuevos[0].hora)}`
    },
    quitar: () => {
      marca.remove()
      if (mapa.getLayer(`${ID}-linea`)) mapa.removeLayer(`${ID}-linea`)
      if (mapa.getSource(ID)) mapa.removeSource(ID)
    },
  }
}
