// Dibujo de las herramientas de Mapbox sobre el mapa: la ruta de llegada con su
// tráfico y las zonas de alcance. Cada función devuelve cómo quitarlo.

const COLOR_TRAFICO = ['match', ['get', 'congestion'], 'low', '#35e888', 'moderate', '#ffbf43', 'heavy', '#ff7a45', 'severe', '#f43f5e', '#9ec5ff']
const COLOR_ALCANCE = ['match', ['get', 'contour'], 10, '#35e888', 20, '#ffbf43', 30, '#f43f5e', '#9ec5ff']

/** La ruta hasta el destino, coloreada por tráfico, con un pin en el destino. */
export function pintarLlegada(gl, mapa, { tramos, destino }) {
  const ID = `llegada-${Date.now().toString(36)}`
  mapa.addSource(ID, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: tramos.map((t) => ({ type: 'Feature', properties: { congestion: t.congestion }, geometry: { type: 'LineString', coordinates: t.coords } })) },
  })
  mapa.addLayer({ id: `${ID}-borde`, type: 'line', source: ID, slot: 'top', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#07121e', 'line-width': 9, 'line-opacity': 0.8 } })
  mapa.addLayer({ id: `${ID}-linea`, type: 'line', source: ID, slot: 'top', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': COLOR_TRAFICO, 'line-width': 5, 'line-emissive-strength': 1 } })
  const el = document.createElement('div')
  el.className = 'mapa-destino'
  el.innerHTML = '<i></i>'
  el.title = 'Destino'
  const pin = new gl.Marker({ element: el, anchor: 'bottom' }).setLngLat([destino.lng, destino.lat]).addTo(mapa)
  return {
    quitar: () => {
      pin.remove()
      for (const capa of [`${ID}-linea`, `${ID}-borde`]) if (mapa.getLayer(capa)) mapa.removeLayer(capa)
      if (mapa.getSource(ID)) mapa.removeSource(ID)
    },
  }
}

/** Las zonas de alcance (10, 20, 30 min) como manchas translúcidas con su borde. */
export function pintarAlcance(mapa, coleccion) {
  const ID = `alcance-${Date.now().toString(36)}`
  mapa.addSource(ID, { type: 'geojson', data: coleccion })
  mapa.addLayer({ id: `${ID}-relleno`, type: 'fill', source: ID, slot: 'middle', paint: { 'fill-color': COLOR_ALCANCE, 'fill-opacity': 0.16, 'fill-emissive-strength': 1 } })
  mapa.addLayer({ id: `${ID}-borde`, type: 'line', source: ID, slot: 'top', paint: { 'line-color': COLOR_ALCANCE, 'line-width': 1.5, 'line-opacity': 0.9, 'line-emissive-strength': 1 } })
  return {
    quitar: () => {
      for (const capa of [`${ID}-borde`, `${ID}-relleno`]) if (mapa.getLayer(capa)) mapa.removeLayer(capa)
      if (mapa.getSource(ID)) mapa.removeSource(ID)
    },
  }
}

/** Los límites de una colección de polígonos o líneas, para encuadrarla. */
export function limitesDe(gl, coordenadas) {
  const planas = []
  const recorrer = (c) => {
    if (typeof c?.[0] === 'number') planas.push(c)
    else if (Array.isArray(c)) c.forEach(recorrer)
  }
  recorrer(coordenadas)
  if (!planas.length) return null
  return planas.reduce((b, p) => b.extend(p), new gl.LngLatBounds(planas[0], planas[0]))
}
