// ============================================================
// SERVICIOS DE MAPBOX QUE USA EL MAPA (decisión de Marco, 13 oct 2026)
// ------------------------------------------------------------
// Tres llamadas, todas con el token público del navegador:
//   - Map Matching: pega un recorrido GPS a las calles (quita el «garabato»).
//   - Directions (driving-traffic): cuánto tarda una unidad en llegar a un
//     punto con el tráfico de ahora, y por dónde.
//   - Isochrone: hasta dónde llega una unidad en 10, 20 o 30 minutos.
// Cada una tiene 100.000 peticiones gratis al mes. Los resultados se
// guardan en memoria para no repetir la misma pregunta en cada refresco.
// ============================================================

const TOKEN = String(import.meta.env?.VITE_MAPBOX_TOKEN || '').trim()
const BASE = 'https://api.mapbox.com'
const cache = new Map()

function recordar(clave, calcular) {
  if (!cache.has(clave)) {
    const p = calcular().catch((e) => { cache.delete(clave); throw e })
    cache.set(clave, p)
  }
  return cache.get(clave)
}

async function pedirJson(url, señal) {
  const r = await fetch(url, { signal: señal })
  if (!r.ok) {
    let detalle = ''
    try { detalle = (await r.json())?.message || '' } catch { /* sin cuerpo */ }
    throw new Error(`Mapbox respondió ${r.status}${detalle ? `: ${detalle}` : ''}`)
  }
  return r.json()
}

const coord = (p) => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`

/** Metros entre dos [lng, lat] (haversine). */
function metros(a, b) {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLng = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
const largoDe = (coords) => coords.reduce((t, c, i) => (i ? t + metros(coords[i - 1], c) : 0), 0)
const claveDe = (puntos) => `${puntos.length}:${coord(puntos[0])}:${coord(puntos[Math.floor(puntos.length / 2)])}:${coord(puntos.at(-1))}`

// --- Map Matching --------------------------------------------------------

/** Parte una lista en trozos de `tam` puntos que comparten `solape` puntos con el anterior (el tope de Mapbox son 100). */
export function partirPuntos(puntos, tam = 100, solape = 1) {
  if (puntos.length <= tam) return [puntos]
  const trozos = []
  let desde = 0
  while (desde < puntos.length) {
    const trozo = puntos.slice(desde, desde + tam)
    trozos.push(trozo)
    if (desde + tam >= puntos.length) break
    desde += tam - solape
  }
  return trozos
}

/** Une los trazos de varios trozos en uno solo, sin repetir el punto donde se tocan. */
export function unirTrazos(trazos) {
  const salida = []
  for (const trazo of trazos) {
    for (const c of trazo) {
      const u = salida.at(-1)
      if (u && u[0] === c[0] && u[1] === c[1]) continue
      salida.push(c)
    }
  }
  return salida
}

/**
 * Lo que devuelve Mapbox para un trozo, convertido a lo que usa el mapa: los mismos
 * puntos (con su hora y velocidad) movidos a la calle, y el trazo por las calles.
 * Devuelve null si no hubo coincidencia o si el trazo resultante es un disparate
 * (mucho más largo que el camino crudo: Mapbox dio una vuelta que no existió).
 * La «confianza» que manda Mapbox no se usa como filtro: con puntos cada uno o
 * cinco minutos, como los de los equipos GPS, sale casi siempre en cero.
 */
export function aplicarEmparejado(puntos, respuesta) {
  const matchings = respuesta?.matchings ?? []
  if (respuesta?.code !== 'Ok' || !matchings.length) return null
  const confianza = Math.max(...matchings.map((m) => Number(m.confidence) || 0))
  const trazo = unirTrazos(matchings.map((m) => m.geometry?.coordinates ?? []))
  if (trazo.length < 2) return null
  const crudo = largoDe(puntos.map((p) => [p.lng, p.lat]))
  if (largoDe(trazo) > crudo * 2.5 + 500) return null
  const trace = respuesta.tracepoints ?? []
  const ajustados = puntos.map((p, i) => {
    const t = trace[i]
    return t?.location ? { ...p, lng: t.location[0], lat: t.location[1], crudo: { lat: p.lat, lng: p.lng } } : p
  })
  return { puntos: ajustados, trazo, confianza }
}

/**
 * Pega un recorrido a las calles. Devuelve `{ puntos, trazo }` o null si no se pudo
 * (sin token, sin red, o Mapbox no encontró calles para ese trazo).
 */
export function emparejarPuntos(puntos, { señal, perfil = 'driving' } = {}) {
  if (!TOKEN || !Array.isArray(puntos) || puntos.length < 2) return Promise.resolve(null)
  return recordar(`mm:${perfil}:${claveDe(puntos)}`, async () => {
    const trozos = partirPuntos(puntos, 100, 1)
    const partes = []
    for (const trozo of trozos) {
      const coords = trozo.map(coord).join(';')
      const radios = trozo.map(() => 25).join(';')
      const url = `${BASE}/matching/v5/mapbox/${perfil}/${coords}?geometries=geojson&overview=full&tidy=true&radiuses=${radios}&access_token=${encodeURIComponent(TOKEN)}`
      const r = await pedirJson(url, señal)
      const parte = aplicarEmparejado(trozo, r)
      if (!parte) return null
      partes.push(parte)
    }
    // Los trozos comparten su primer punto con el último del anterior: se quita el repetido.
    const puntosUnidos = partes.flatMap((p, i) => (i === 0 ? p.puntos : p.puntos.slice(1)))
    return { puntos: puntosUnidos, trazo: unirTrazos(partes.map((p) => p.trazo)), confianza: Math.min(...partes.map((p) => p.confianza)) }
  })
}

/** Los viajes de un recorrido, cada uno pegado a las calles (los que no se puedan, quedan como estaban). */
export async function emparejarViajes(viajes, { señal } = {}) {
  const salida = await Promise.all(
    (viajes ?? []).map(async (viaje) => {
      try {
        const r = await emparejarPuntos(viaje.puntos, { señal })
        return r ? { ...viaje, puntos: r.puntos, trazo: r.trazo, pegado: true } : viaje
      } catch (e) {
        if (e?.name === 'AbortError') throw e
        return viaje
      }
    }),
  )
  return salida
}

// --- Directions: llegada con tráfico ------------------------------------

/** Parte el trazo de una ruta en tramos seguidos con el mismo nivel de tráfico. */
export function tramosDeRuta(coordenadas, congestion = []) {
  const tramos = []
  for (let i = 0; i < coordenadas.length - 1; i += 1) {
    const nivel = congestion[i] || 'unknown'
    const u = tramos.at(-1)
    if (u && u.congestion === nivel) u.coords.push(coordenadas[i + 1])
    else tramos.push({ congestion: nivel, coords: [coordenadas[i], coordenadas[i + 1]] })
  }
  return tramos
}

/**
 * Cuánto tarda en llegar de `origen` a `destino` manejando con el tráfico de ahora.
 * Devuelve minutos, kilómetros, el trazo y los tramos coloreados por tráfico.
 */
export function rutaConTrafico(origen, destino, { señal } = {}) {
  if (!TOKEN) return Promise.reject(new Error('Sin token de Mapbox.'))
  return recordar(`dir:${coord(origen)}>${coord(destino)}:${Math.floor(Date.now() / 120000)}`, async () => {
    const url = `${BASE}/directions/v5/mapbox/driving-traffic/${coord(origen)};${coord(destino)}?geometries=geojson&overview=full&annotations=congestion&language=es&access_token=${encodeURIComponent(TOKEN)}`
    const r = await pedirJson(url, señal)
    const ruta = r?.routes?.[0]
    if (r?.code !== 'Ok' || !ruta) throw new Error(r?.message || 'Mapbox no encontró una ruta por carretera.')
    const coords = ruta.geometry?.coordinates ?? []
    const congestion = ruta.legs?.flatMap((l) => l.annotation?.congestion ?? []) ?? []
    return {
      minutos: Math.max(1, Math.round(ruta.duration / 60)),
      minutosNormales: ruta.duration_typical ? Math.max(1, Math.round(ruta.duration_typical / 60)) : null,
      km: ruta.distance / 1000,
      trazo: coords,
      tramos: tramosDeRuta(coords, congestion),
    }
  })
}

// --- Isochrone: alcance en minutos ---------------------------------------

/** Hasta dónde llega una unidad desde `origen` en cada uno de los `minutos` dados (polígonos). */
export function alcanceDesde(origen, minutos = [10, 20, 30], { señal } = {}) {
  if (!TOKEN) return Promise.reject(new Error('Sin token de Mapbox.'))
  const lista = [...new Set(minutos.map((m) => Math.min(60, Math.max(1, Math.round(m)))))].sort((a, b) => a - b)
  return recordar(`iso:${coord(origen)}:${lista.join(',')}:${Math.floor(Date.now() / 300000)}`, async () => {
    const pedir = (perfil) => pedirJson(`${BASE}/isochrone/v1/mapbox/${perfil}/${coord(origen)}?contours_minutes=${lista.join(',')}&polygons=true&denoise=1&access_token=${encodeURIComponent(TOKEN)}`, señal)
    let r
    try {
      r = await pedir('driving-traffic')
    } catch (e) {
      if (e?.name === 'AbortError') throw e
      r = await pedir('driving')
    }
    const features = (r?.features ?? []).slice().sort((a, b) => (b.properties?.contour ?? 0) - (a.properties?.contour ?? 0))
    if (!features.length) throw new Error('Mapbox no devolvió zonas de alcance.')
    return { type: 'FeatureCollection', features }
  })
}
