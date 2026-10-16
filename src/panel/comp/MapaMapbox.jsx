import { useEffect, useRef, useState } from 'react'
import FichaUnidad, { estadoUnidad } from './FichaUnidad'
import { vehicleMarkerSvg, MARKER_SIZE, MARKER_ANCHOR, validPosition } from './vehicleMarker'
import { pintarCola, pintarRuta } from './rutaMapbox'
import CapasMapa from './CapasMapa'
import HerramientasRuta from './HerramientasRuta'
import { limitesDe, pintarAlcance, pintarLlegada } from './herramientasMapbox'
import { alcanceDesde, emparejarPuntos, emparejarViajes, rutaConTrafico } from '../datos/mapboxApi'
import { CLAVES_COLOR, coloresDe, configDe, estiloDe, guardarPrefs, leerPrefs, luzEfectiva, sin3d } from './mapaPrefs'
import '../../styles/fleet-map.css'
import '../../styles/mapa-mapbox.css'

// ============================================================
// MAPA DE FLOTA SOBRE MAPBOX GL JS v3 (decisión de Marco, 13 oct 2026)
// ------------------------------------------------------------
// El mismo mapa que `MapaLibre.jsx` (mismas props, mismos marcadores,
// recorrido, cola y fichas) dibujado directo con Mapbox: estilo Standard
// con luz del día real, satélite y tráfico en vivo. Sin 3D (pedido del
// dueño, 16 oct 2026): ni edificios, ni relieve, ni cámara inclinada, ni
// niebla; es lo que más pesaba. Se cobra por «carga de mapa»: una por cada
// vez que esta pantalla se abre (50.000 gratis al mes).
//
// El token es público (`pk.`), restringido por URL, y vive en `.env` como
// `VITE_MAPBOX_TOKEN`. Si falla (vencido, URL no permitida, navegador sin
// WebGL 2) se avisa con `alFallar` y el panel vuelve a Leaflet.
// ============================================================

export const MAPBOX_TOKEN = String(import.meta.env?.VITE_MAPBOX_TOKEN || '').trim()
export const HAY_MAPBOX = /^pk\./u.test(MAPBOX_TOKEN)

// Costa Oriental del Lago
const CENTRO = [-71.42, 10.32]
const TRAFICO_FUENTE = 'fom-trafico'
const TRAFICO_CAPA = 'fom-trafico-linea'

function leerTokens() {
  const raiz = document.querySelector('.pnl') || document.documentElement
  const cs = getComputedStyle(raiz)
  return { primario: cs.getPropertyValue('--e-primario').trim() || '#208AEF' }
}

const HERR_VACIO = Object.freeze({ eligiendo: false, llegada: null, cargandoLlegada: false, errorLlegada: null, alcance: null, cargandoAlcance: false, errorAlcance: null })

const sinMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
// Un punto de la cola reconocible entre refrescos (la cola se corre: entran puntos y salen otros).
const marcaDe = (p) => `${p.hora}|${p.lat}|${p.lng}`

/**
 * Desliza los marcadores de su posición a la nueva (ver MapaLibre.jsx) con UN solo bucle
 * de animación para todas las unidades que se mueven: antes cada una arrancaba el suyo
 * en cada refresco.
 */
function crearDeslizador(ms = 1200) {
  const activos = new Map()
  let cuadro = 0
  const paso = (ahora) => {
    cuadro = 0
    for (const [id, a] of activos) {
      const t = Math.min(1, Math.max(0, (ahora - a.inicio) / ms))
      const suave = 1 - Math.pow(1 - t, 3)
      a.marcador.setLngLat([a.lng + a.dLng * suave, a.lat + a.dLat * suave])
      if (t >= 1) activos.delete(id)
    }
    if (activos.size) cuadro = requestAnimationFrame(paso)
  }
  return {
    mover(id, marcador, destino) {
      activos.delete(id)
      const origen = marcador.getLngLat()
      const dLng = destino[0] - origen.lng
      const dLat = destino[1] - origen.lat
      // Sin animación si el usuario la pidió así, si no se movió o si «saltó» lejos.
      if (sinMovimiento() || Math.abs(dLat) > 0.05 || Math.abs(dLng) > 0.05 || (dLat === 0 && dLng === 0)) {
        marcador.setLngLat(destino)
        return
      }
      activos.set(id, { marcador, lng: origen.lng, lat: origen.lat, dLng, dLat, inicio: performance.now() })
      if (!cuadro) cuadro = requestAnimationFrame(paso)
    },
    parar(id) { activos.delete(id) },
    pararTodo() {
      activos.clear()
      cancelAnimationFrame(cuadro)
      cuadro = 0
    },
  }
}

/** Elemento HTML de un marcador de unidad (el SVG, el mismo de Leaflet y Google, lo pone `pintarUnidad`). */
function elementoUnidad() {
  const el = document.createElement('div')
  el.className = 'fleet-marker'
  el.style.width = `${MARKER_SIZE[0]}px`
  el.style.height = `${MARKER_SIZE[1]}px`
  el.setAttribute('role', 'button')
  el.tabIndex = 0
  return el
}

/**
 * Pone el dibujo y los textos de una unidad en su marcador, solo si cambió algo que se ve
 * (placa, rumbo, estado o si está elegida): antes se regeneraba el SVG de todas en cada render.
 */
function pintarUnidad(el, v, sel) {
  const estado = estadoUnidad(v)
  const firma = [sel ? 1 : 0, v.placa ?? '', v.alias ?? '', v.rumbo ?? '', estado.clave].join('|')
  if (el.dataset.firma === firma) return
  el.dataset.firma = firma
  el.innerHTML = vehicleMarkerSvg(v, sel)
  el.classList.toggle('selected', sel)
  el.style.zIndex = sel ? '1000' : '0'
  el.title = `${v.alias} · ${v.placa}`
  el.setAttribute('aria-label', `${v.placa || v.alias || 'Sin placa'}, ${estado.texto}`)
  el.setAttribute('aria-pressed', String(sel))
}

// La etiqueta de un marcador en pantalla, respecto a su punto (ver vehicleMarker.js), para ver choques.
const ETIQUETA = { dx: 20, dy: -37, w: 125, h: 48 }

/**
 * Apaga las etiquetas que chocan con otra (siguen saliendo al pasar el cursor o con el foco);
 * el carro sigue visible y se puede elegir. Los choques se buscan en una rejilla del tamaño
 * de una etiqueta (solo contra las vecinas) y se saltan las unidades fuera de la vista: antes
 * se comparaba cada una con todas.
 */
function ordenarEtiquetas(m, vehiculos, marcadores, seleccionado, enRuta) {
  const lienzo = m.getContainer()
  const ancho = lienzo.clientWidth
  const alto = lienzo.clientHeight
  const celdas = new Map()
  const clavesDe = (c) => {
    const claves = []
    for (let i = Math.floor(c.x / ETIQUETA.w); i <= Math.floor((c.x + ETIQUETA.w) / ETIQUETA.w); i += 1) {
      for (let j = Math.floor(c.y / ETIQUETA.h); j <= Math.floor((c.y + ETIQUETA.h) / ETIQUETA.h); j += 1) claves.push(`${i}:${j}`)
    }
    return claves
  }
  const choca = (c) => clavesDe(c).some((k) => (celdas.get(k) ?? []).some((o) =>
    c.x < o.x + ETIQUETA.w && c.x + ETIQUETA.w > o.x && c.y < o.y + ETIQUETA.h && c.y + ETIQUETA.h > o.y))
  const poner = (c) => clavesDe(c).forEach((k) => {
    if (celdas.has(k)) celdas.get(k).push(c)
    else celdas.set(k, [c])
  })

  // La elegida va primero: su etiqueta siempre se ve.
  const lista = vehiculos.filter(validPosition)
  const i = lista.findIndex((v) => v.id === seleccionado)
  if (i > 0) lista.unshift(...lista.splice(i, 1))
  for (const v of lista) {
    const el = marcadores.get(v.id)?.getElement()
    if (!el) continue
    const elegida = v.id === seleccionado
    // Con un recorrido en pantalla solo la elegida lleva etiqueta: no hace falta medir nada.
    if (enRuta) {
      el.classList.toggle('is-muted', !elegida)
      continue
    }
    const p = m.project([v.lng, v.lat])
    // Fuera de la vista no tapa a nadie; cuando entre, el siguiente `moveend` la ordena.
    if (!elegida && (p.x < -200 || p.y < -100 || p.x > ancho + 60 || p.y > alto + 100)) continue
    const caja = { x: p.x + ETIQUETA.dx, y: p.y + ETIQUETA.dy }
    const choque = !elegida && choca(caja)
    el.classList.toggle('is-muted', choque)
    if (!choque) poner(caja)
  }
}

/** Todo el `config.basemap` del estilo: opciones y, si tocan, los colores de noche de FOM. */
const configCompleta = (prefs) => ({ ...configDe(prefs), ...coloresDe(prefs) })

// Lo último que se le dio a `config.basemap` de cada mapa, para tocar solo lo que cambió.
const configAplicada = new WeakMap()

/**
 * Pasa al estilo solo las opciones que cambiaron. Al crear el mapa y al cambiar de estilo el
 * config completo va en el constructor o en `setStyle`, así que en `style.load` esto casi
 * nunca hace nada; antes se reponían ~10 opciones y se leían y escribían 9 colores en cada carga.
 */
function aplicarConfig(mapa, prefs) {
  const previa = configAplicada.get(mapa) ?? {}
  const nueva = configCompleta(prefs)
  const poner = (clave, valor) => {
    try { mapa.setConfigProperty('basemap', clave, valor) } catch { /* propiedad que este estilo no tiene */ }
  }
  for (const [clave, valor] of Object.entries(nueva)) if (previa[clave] !== valor) poner(clave, valor)
  // Colores de FOM que ya no tocan (tema «Original», de día…): se devuelven a mano al valor
  // por defecto del estilo, que viene en su esquema.
  let esquema = null
  for (const clave of CLAVES_COLOR) {
    if (previa[clave] === undefined || nueva[clave] !== undefined) continue
    try { esquema ??= mapa.getSchema('basemap') } catch { /* sin esquema */ }
    const porDefecto = esquema?.[clave]?.default
    if (porDefecto != null) poner(clave, porDefecto)
  }
  configAplicada.set(mapa, nueva)
}

/** Lo que no va en `config`: tráfico y lluvia. Sin 3D: se quitan niebla y relieve por si el estilo los trae. */
function aplicarEfectos(mapa, prefs) {
  try { mapa.setFog(null) } catch { /* sin niebla */ }
  try { if (mapa.getTerrain()) mapa.setTerrain(null) } catch { /* sin relieve */ }

  // Tráfico en vivo: la capa de tráfico de Mapbox, coloreada por congestión.
  try {
    if (prefs.trafico) {
      if (!mapa.getSource(TRAFICO_FUENTE)) mapa.addSource(TRAFICO_FUENTE, { type: 'vector', url: 'mapbox://mapbox.mapbox-traffic-v1' })
      if (!mapa.getLayer(TRAFICO_CAPA)) {
        mapa.addLayer({
          id: TRAFICO_CAPA,
          type: 'line',
          source: TRAFICO_FUENTE,
          'source-layer': 'traffic',
          slot: 'middle',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 3, 18, 7],
            'line-color': ['match', ['get', 'congestion'], 'low', '#35e888', 'moderate', '#ffbf43', 'heavy', '#ff7a45', 'severe', '#f43f5e', '#8a919e'],
            'line-opacity': 0.9,
            'line-emissive-strength': 1,
          },
        })
      }
    } else if (mapa.getLayer(TRAFICO_CAPA)) {
      mapa.removeLayer(TRAFICO_CAPA)
    }
  } catch { /* sin tráfico */ }

  // Lluvia: puro ambiente, se desvanece al alejar el mapa.
  try {
    if (prefs.lluvia) {
      const revelar = (v) => ['interpolate', ['linear'], ['zoom'], 10, 0, 12, v]
      mapa.setRain({ density: revelar(0.5), intensity: 1, color: '#a8adbc', opacity: 0.6, vignette: revelar(0.8), 'vignette-color': '#2b3340', direction: [0, 80], 'droplet-size': [2.6, 18.2], 'distortion-strength': 0.6, 'center-thinning': 0 })
    } else {
      mapa.setRain(null)
    }
  } catch { /* versión sin lluvia */ }
}

export default function MapaMapbox({
  vehiculos = [],
  seleccionado = null,
  alSeleccionar,
  leyenda = true,
  ficha = true,
  viajes = null,
  paradas = null,
  cola = null,
  foco = null,
  viajeActivo = null,
  alElegirViaje,
  alVerRecorrido,
  espacioFicha = false,
  alto = 'clamp(320px, 52vh, 560px)',
  // «Llegada y alcance» solo donde se opera la flota (Centro de control); en
  // el Resumen o Mi unidad el mapa es de consulta y no las muestra.
  herramientas = false,
  alFallar,
}) {
  const contenedor = useRef(null)
  const mapa = useRef(null)
  const gl = useRef(null)
  const marcadores = useRef(new Map())
  // Dónde debe quedar cada marcador (la última posición del GPS), aunque aún se esté deslizando.
  const destinos = useRef(new Map())
  const deslizador = useRef(null)
  if (!deslizador.current) deslizador.current = crearDeslizador()
  const viajesRef = useRef(viajes)
  const paradasRef = useRef(paradas)
  viajesRef.current = viajes
  paradasRef.current = paradas
  const vehiculosRef = useRef(vehiculos)
  vehiculosRef.current = vehiculos
  const ruta = useRef(null)
  const resaltarRef = useRef(null)
  const viajeActivoRef = useRef(viajeActivo)
  const alElegirViajeRef = useRef(alElegirViaje)
  viajeActivoRef.current = viajeActivo
  alElegirViajeRef.current = alElegirViaje
  const colaCapa = useRef(null)
  const colaEncuadrada = useRef(null)
  const encuadrado = useRef(false)
  const alFallarRef = useRef(alFallar)
  alFallarRef.current = alFallar
  // En una ref: el padre pasa una flecha nueva en cada render y, como dependencia, rehacía
  // todos los marcadores cada vez.
  const alSeleccionarRef = useRef(alSeleccionar)
  alSeleccionarRef.current = alSeleccionar
  // La última pegada a las calles de la cola de la unidad elegida (ver el efecto de la cola).
  const colaPegada = useRef(null)
  const ordenCuadro = useRef(0)
  // `isStyleLoaded()` de Mapbox se pone en falso un instante cada vez que se toca el estilo
  // (añadir tráfico, lluvia…), así que no sirve para saber si ya se puede dibujar. Esto sí:
  // verdadero desde `style.load` hasta el siguiente `setStyle`.
  const estiloListo = useRef(false)
  const [listo, setListo] = useState(0)
  const [prefs, setPrefs] = useState(() => leerPrefs())
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const [luzActual, setLuzActual] = useState(() => luzEfectiva(prefs))
  const seleccionadoRef = useRef(seleccionado)
  seleccionadoRef.current = seleccionado

  // Llegada y alcance de la unidad elegida (Directions e Isochrone de Mapbox)
  const [herr, setHerr] = useState(HERR_VACIO)
  const modoDestino = useRef(false)
  const llegadaCapa = useRef(null)
  const alcanceCapa = useRef(null)
  const elegirDestinoRef = useRef(null)

  const limpiarHerramientas = () => {
    modoDestino.current = false
    llegadaCapa.current?.quitar?.()
    llegadaCapa.current = null
    alcanceCapa.current?.quitar?.()
    alcanceCapa.current = null
    setHerr(HERR_VACIO)
  }

  const encuadre = (m) => {
    const ancho = m.getContainer().getBoundingClientRect().width
    return { top: 110, left: ancho > 600 && (ficha || espacioFicha) ? 420 : 40, right: ancho > 600 ? 340 : 40, bottom: 90 }
  }

  const elegirDestino = async (destino) => {
    const m = mapa.current
    const mapboxgl = gl.current
    const u = vehiculosRef.current.find((x) => x.id === seleccionadoRef.current)
    if (!m || !mapboxgl || !validPosition(u)) return
    modoDestino.current = false
    llegadaCapa.current?.quitar?.()
    llegadaCapa.current = null
    setHerr((h) => ({ ...h, eligiendo: false, cargandoLlegada: true, errorLlegada: null, llegada: null }))
    try {
      const r = await rutaConTrafico({ lat: u.lat, lng: u.lng }, destino)
      if (!mapa.current || seleccionadoRef.current !== u.id || !estiloListo.current) return
      llegadaCapa.current = pintarLlegada(mapboxgl, m, { tramos: r.tramos, destino })
      const limites = limitesDe(mapboxgl, r.trazo)
      if (limites) m.fitBounds(limites, { padding: encuadre(m), maxZoom: 15, duration: sinMovimiento() ? 0 : 800 })
      setHerr((h) => ({ ...h, cargandoLlegada: false, llegada: r }))
    } catch (e) {
      setHerr((h) => ({ ...h, cargandoLlegada: false, errorLlegada: `No se pudo calcular la llegada. ${e?.message || ''}`.trim() }))
    }
  }
  elegirDestinoRef.current = elegirDestino

  const empezarDestino = () => {
    modoDestino.current = true
    setHerr((h) => ({ ...h, eligiendo: true, errorLlegada: null }))
  }
  const quitarLlegada = () => {
    modoDestino.current = false
    llegadaCapa.current?.quitar?.()
    llegadaCapa.current = null
    setHerr((h) => ({ ...h, eligiendo: false, llegada: null, errorLlegada: null }))
  }
  const alternarAlcance = async () => {
    const m = mapa.current
    const mapboxgl = gl.current
    if (alcanceCapa.current) {
      alcanceCapa.current.quitar()
      alcanceCapa.current = null
      setHerr((h) => ({ ...h, alcance: null, errorAlcance: null }))
      return
    }
    const u = vehiculosRef.current.find((x) => x.id === seleccionadoRef.current)
    if (!m || !mapboxgl || !validPosition(u)) return
    setHerr((h) => ({ ...h, cargandoAlcance: true, errorAlcance: null }))
    try {
      const zonas = await alcanceDesde({ lat: u.lat, lng: u.lng }, [10, 20, 30])
      if (!mapa.current || seleccionadoRef.current !== u.id || !estiloListo.current) return
      alcanceCapa.current = pintarAlcance(m, zonas)
      const limites = limitesDe(mapboxgl, zonas.features.map((z) => z.geometry?.coordinates))
      if (limites) m.fitBounds(limites, { padding: encuadre(m), duration: sinMovimiento() ? 0 : 800 })
      setHerr((h) => ({ ...h, cargandoAlcance: false, alcance: zonas }))
    } catch (e) {
      setHerr((h) => ({ ...h, cargandoAlcance: false, errorAlcance: `No se pudo calcular el alcance. ${e?.message || ''}`.trim() }))
    }
  }

  // Crear el mapa una sola vez
  useEffect(() => {
    if (mapa.current || !contenedor.current) return undefined
    let cancelado = false
    let vigilante = 0
    const deslizadorActivo = deslizador.current
    const marcadoresActivos = marcadores.current
    const destinosActivos = destinos.current
    const raiz = contenedor.current.parentElement

    Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')])
      .then(([modulo]) => {
        if (cancelado || !contenedor.current) return
        const mapboxgl = modulo.default ?? modulo
        if (!mapboxgl.supported?.({ failIfMajorPerformanceCaveat: false })) throw new Error('Este navegador no puede dibujar el mapa de Mapbox (WebGL 2).')
        mapboxgl.accessToken = MAPBOX_TOKEN
        gl.current = mapboxgl
        const p = prefsRef.current
        // Todo el config (opciones y colores) va en el constructor: así `style.load` no
        // tiene que reponerlo.
        const config = configCompleta(p)
        const m = new mapboxgl.Map({
          container: contenedor.current,
          style: estiloDe(p),
          config: { basemap: config },
          center: CENTRO,
          zoom: 8,
          minZoom: 3,
          maxZoom: 19,
          // Siempre cenital: sin 3D no se inclina la cámara.
          pitch: 0,
          maxPitch: 0,
          bearing: 0,
          projection: 'mercator',
          language: 'es',
          attributionControl: false,
          logoPosition: 'bottom-left',
          // Girar con el botón derecho o con dos dedos. Las teclas de flecha mueven el mapa.
          dragRotate: true,
          touchPitch: false,
          pitchWithRotate: false,
        })
        configAplicada.set(m, config)
        mapa.current = m
        // Solo en desarrollo: para inspeccionar el mapa desde la consola del navegador.
        if (import.meta.env?.DEV) window.__fomMapa = m
        m.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
        m.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: false }), 'bottom-right')

        // Si en 25 s no cargó nada, el token o la red fallaron: se avisa para volver a Leaflet.
        // El estilo llegó = el token sirve; con eso basta. Si la pestaña está en segundo
        // plano el navegador no dibuja y Mapbox no avanza: se espera a que vuelva al frente
        // en vez de darlo por caído.
        let respondio = false
        const vigilar = () => {
          vigilante = window.setTimeout(() => {
            if (respondio || cancelado) return
            if (document.hidden) { vigilar(); return }
            console.warn('[mapa] Mapbox no respondió a tiempo; se usa el mapa de respaldo.')
            alFallarRef.current?.()
          }, 25000)
        }
        vigilar()
        m.once('style.load', () => { respondio = true; window.clearTimeout(vigilante) })
        m.on('error', (e) => {
          const error = e?.error
          const estado = error?.status ?? error?.statusCode
          const texto = String(error?.message || '')
          if (estado === 401 || estado === 403 || /access token/iu.test(texto)) {
            console.warn('[mapa] Mapbox rechazó el token; se usa el mapa de respaldo:', texto)
            window.clearTimeout(vigilante)
            alFallarRef.current?.()
          }
        })
        m.on('load', () => { respondio = true; window.clearTimeout(vigilante) })
        // Cada vez que entra un estilo (al crear el mapa y al cambiar entre calles y satélite)
        // se ponen tráfico y lluvia y se avisa para repintar recorrido y cola. El config ya
        // vino con el estilo: `aplicarConfig` solo toca lo que se haya cambiado mientras cargaba.
        m.on('style.load', () => {
          estiloListo.current = true
          aplicarConfig(m, prefsRef.current)
          aplicarEfectos(m, prefsRef.current)
          setListo((n) => n + 1)
        })

        // Los carros se achican al alejar el mapa y, muy lejos, se apagan las etiquetas.
        const ajustarMarcadores = () => {
          const z = m.getZoom()
          const k = Math.max(0.4, Math.min(0.85, 0.4 + (z - 9) * 0.075))
          raiz.style.setProperty('--marcador-k', String(k))
          raiz.dataset.zoom = z <= 12 ? 'lejos' : 'cerca'
        }
        m.on('zoomend', ajustarMarcadores)
        ajustarMarcadores()
        // Eligiendo destino: un toque en el mapa es el destino.
        m.on('click', (e) => {
          if (modoDestino.current) elegirDestinoRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng })
        })
      })
      .catch((error) => {
        console.warn('[mapa] Mapbox no cargó; se usa el mapa de respaldo:', error?.message || error)
        alFallarRef.current?.()
      })

    return () => {
      cancelado = true
      window.clearTimeout(vigilante)
      cancelAnimationFrame(ordenCuadro.current)
      ordenCuadro.current = 0
      deslizadorActivo.pararTodo()
      marcadoresActivos.forEach((mk) => mk.remove())
      marcadoresActivos.clear()
      destinosActivos.clear()
      ruta.current?.quitar?.()
      ruta.current = null
      colaCapa.current?.quitar?.()
      colaCapa.current = null
      colaPegada.current = null
      mapa.current?.remove()
      mapa.current = null
      encuadrado.current = false
    }
  }, [])

  // Escape cancela la elección de destino.
  useEffect(() => {
    const tecla = (e) => {
      if (e.key === 'Escape' && modoDestino.current) {
        modoDestino.current = false
        setHerr((h) => ({ ...h, eligiendo: false }))
      }
    }
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [])

  // Al desmontar se quitan las capas de llegada y alcance.
  useEffect(() => () => {
    llegadaCapa.current?.quitar?.()
    alcanceCapa.current?.quitar?.()
  }, [])

  // La luz automática cambia con la hora: se revisa cada cinco minutos. Solo cambia
  // `lightPreset` (y los colores de noche de FOM al entrar o salir de la noche).
  useEffect(() => {
    const t = setInterval(() => {
      const luz = luzEfectiva(prefsRef.current)
      setLuzActual((actual) => {
        if (actual === luz) return actual
        if (mapa.current && estiloListo.current) aplicarConfig(mapa.current, prefsRef.current)
        return luz
      })
    }, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // Cambiar preferencias: se guardan, y si cambia la vista (calles/satélite) se carga el otro estilo.
  const cambiarPrefs = (pedidas) => {
    // Sin 3D: si el panel «Capas» todavía manda edificios, relieve o vista 3D, se ignoran.
    const nuevas = sin3d(pedidas)
    const previas = prefsRef.current
    setPrefs(nuevas)
    guardarPrefs(nuevas)
    setLuzActual(luzEfectiva(nuevas))
    const m = mapa.current
    if (!m) return
    if (nuevas.vista !== previas.vista) {
      // Al cambiar de estilo se pierden recorrido y cola; `style.load` los vuelve a pintar.
      ruta.current?.quitar?.()
      ruta.current = null
      colaCapa.current?.quitar?.()
      colaCapa.current = null
      limpiarHerramientas()
      estiloListo.current = false
      const config = configCompleta(nuevas)
      configAplicada.set(m, config)
      m.setStyle(estiloDe(nuevas), { config: { basemap: config } })
    } else if (estiloListo.current) {
      aplicarConfig(m, nuevas)
      aplicarEfectos(m, nuevas)
    }
  }

  // Ordenar etiquetas una vez por cuadro como mucho, leyendo todo de refs: al terminar de
  // mover el mapa y cuando cambian las unidades, la elegida o el recorrido.
  const ordenarLuego = () => {
    if (ordenCuadro.current) return
    ordenCuadro.current = requestAnimationFrame(() => {
      ordenCuadro.current = 0
      const m = mapa.current
      if (!m) return
      const enRuta = Boolean(viajesRef.current?.length || paradasRef.current?.length)
      ordenarEtiquetas(m, vehiculosRef.current, marcadores.current, seleccionadoRef.current, enRuta)
    })
  }

  // Marcadores de las unidades
  useEffect(() => {
    const m = mapa.current
    const mapboxgl = gl.current
    if (!m || !mapboxgl) return
    const vistos = new Set()
    // Toque o Enter sobre una unidad. Lee todo de refs: se fija una sola vez al crear el marcador.
    const pulsar = (id, conDestino) => {
      if (conDestino && modoDestino.current && id !== seleccionadoRef.current) {
        const u = vehiculosRef.current.find((x) => x.id === id)
        if (validPosition(u)) elegirDestinoRef.current?.({ lat: u.lat, lng: u.lng })
        return
      }
      alSeleccionarRef.current?.(seleccionadoRef.current === id ? null : id)
    }

    vehiculos
      .filter(validPosition)
      .forEach((v) => {
        vistos.add(v.id)
        const sel = seleccionado === v.id
        let mk = marcadores.current.get(v.id)
        if (!mk) {
          const el = elementoUnidad()
          const id = v.id
          el.onclick = (e) => {
            e.stopPropagation()
            pulsar(id, true)
          }
          el.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              pulsar(id, false)
            }
          }
          mk = new mapboxgl.Marker({ element: el, anchor: 'top-left', offset: [-MARKER_ANCHOR[0], -MARKER_ANCHOR[1]] })
            .setLngLat([v.lng, v.lat])
            .addTo(m)
          marcadores.current.set(v.id, mk)
          destinos.current.set(v.id, `${v.lng},${v.lat}`)
        } else {
          // Se compara con el destino, no con la posición del marcador, que a mitad de
          // deslizarse no es ninguna de las dos.
          const destino = `${v.lng},${v.lat}`
          if (destinos.current.get(v.id) !== destino) {
            destinos.current.set(v.id, destino)
            deslizador.current.mover(v.id, mk, [v.lng, v.lat])
          }
        }
        pintarUnidad(mk.getElement(), v, sel)
      })

    marcadores.current.forEach((mk, id) => {
      if (!vistos.has(id)) {
        deslizador.current.parar(id)
        destinos.current.delete(id)
        mk.remove()
        marcadores.current.delete(id)
      }
    })

    // Encuadrar toda la flota la primera vez
    if (!encuadrado.current && vistos.size) {
      const puntos = vehiculos.filter(validPosition).map((v) => [v.lng, v.lat])
      if (puntos.length === 1) {
        m.jumpTo({ center: puntos[0], zoom: 13 })
      } else {
        const limites = puntos.reduce((b, p) => b.extend(p), new mapboxgl.LngLatBounds(puntos[0], puntos[0]))
        m.fitBounds(limites, { padding: 48, maxZoom: 12, duration: 0 })
      }
      encuadrado.current = true
    }
    ordenarLuego()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiculos, seleccionado, listo])

  // Al ELEGIR una unidad se centra en ella (una sola vez, sin tocar el zoom).
  useEffect(() => {
    colaEncuadrada.current = null
    limpiarHerramientas()
    const m = mapa.current
    if (!m || !seleccionado) return
    const v = vehiculosRef.current.find((x) => x.id === seleccionado)
    if (!validPosition(v)) return
    const lienzo = m.getContainer().getBoundingClientRect()
    const offset = (ficha || espacioFicha) ? (lienzo.width > 600 ? [175, 0] : [0, -lienzo.height * 0.18]) : [0, 0]
    m.easeTo({ center: [v.lng, v.lat], offset, duration: sinMovimiento() ? 0 : 600 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionado])

  // Recorrido con viajes (inicio y fin), paradas y hora de cada punto
  useEffect(() => {
    const m = mapa.current
    const mapboxgl = gl.current
    ruta.current?.quitar?.()
    ruta.current = null
    if (!m || !mapboxgl || !listo || !estiloListo.current) return undefined
    if (!viajes?.length && !paradas?.length) return undefined
    const color = leerTokens().primario
    // Se pinta de una vez tal como vino del GPS y, cuando Mapbox lo pega a las calles, solo
    // se le cambia el trazo (sin quitar ni volver a crear capas y pines).
    const r = pintarRuta(mapboxgl, m, { viajes: viajes ?? [], paradas: paradas ?? [], color, alElegirViaje: (n) => alElegirViajeRef.current?.(n) })
    ruta.current = r
    resaltarRef.current = r.resaltar
    r.resaltar(viajeActivoRef.current)
    const control = new AbortController()
    emparejarViajes(viajes ?? [], { señal: control.signal })
      .then((pegados) => {
        if (control.signal.aborted || !mapa.current || !estiloListo.current || ruta.current !== r) return
        if (pegados.some((x) => x.pegado)) r.actualizar(pegados)
      })
      .catch(() => { /* se queda el trazo crudo */ })
    return () => {
      control.abort()
      ruta.current?.quitar?.()
      ruta.current = null
    }
  }, [viajes, paradas, listo])

  // Con o sin recorrido cambia qué etiquetas se ven.
  useEffect(() => {
    ordenarLuego()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viajes, paradas])

  // Resaltar el viaje elegido en la lista sin volver a dibujar nada
  useEffect(() => {
    resaltarRef.current?.(viajeActivo)
  }, [viajeActivo])

  // Cola: los últimos minutos de camino de la unidad elegida. La capa se crea una vez y en
  // cada refresco solo se le cambian los datos. Pegarla a las calles (Map Matching) se repite
  // solo si llegaron 5 puntos nuevos o pasó un minuto: antes era una petición cada 15 s.
  useEffect(() => {
    const m = mapa.current
    const mapboxgl = gl.current
    const util = (cola ?? []).filter(validPosition)
    if (util.length < 2) colaPegada.current = null
    if (!m || !mapboxgl || !listo || !estiloListo.current || util.length < 2) {
      colaCapa.current?.quitar?.()
      colaCapa.current = null
      return undefined
    }
    const color = leerTokens().primario
    const dibujar = (puntos, trazo) => {
      if (colaCapa.current) colaCapa.current.actualizar(puntos, trazo)
      else colaCapa.current = pintarCola(mapboxgl, m, puntos, color, trazo)
    }
    // Otra unidad: lo pegado antes no sirve.
    if (colaPegada.current && colaPegada.current.unidad !== seleccionado) colaPegada.current = null
    const pegada = colaPegada.current
    // Lo ya pegado a las calles más, tal como llegaron, los puntos que vinieron después.
    const desde = pegada?.trazo && pegada.ultimo ? util.findIndex((p) => marcaDe(p) === pegada.ultimo) : -1
    const nuevos = desde >= 0 ? util.slice(desde + 1) : util
    // La cola suelta puntos por delante: el trazo pegado se recorta para empezar donde empieza util[0].
    let trazoPegado = null
    if (desde >= 0) {
      let ini = 0
      if (desde > 0) {
        let mejor = Infinity
        pegada.trazo.forEach(([lng, lat], i) => {
          const d = (lng - util[0].lng) ** 2 + (lat - util[0].lat) ** 2
          if (d < mejor) { mejor = d; ini = i }
        })
      }
      trazoPegado = [...pegada.trazo.slice(ini), ...nuevos.map((p) => [p.lng, p.lat])]
    }
    dibujar(util, trazoPegado)

    const espera = Date.now() - (pegada?.cuando ?? 0)
    const toca = !pegada
      || (pegada.fallo ? espera >= 60000 : desde < 0 || (nuevos.length > 0 && (nuevos.length >= 5 || espera >= 60000)))
    const control = new AbortController()
    if (toca) {
      const unidad = seleccionado
      const ultimo = marcaDe(util.at(-1))
      emparejarPuntos(util, { señal: control.signal })
        .then((r) => {
          if (control.signal.aborted || !mapa.current || !estiloListo.current) return
          if (!r?.trazo) {
            // Sin calles para este trazo: se queda lo que había y no se reintenta hasta dentro de un minuto.
            colaPegada.current = { ...(pegada ?? { unidad }), cuando: Date.now(), fallo: true }
            return
          }
          colaPegada.current = { unidad, ultimo, trazo: r.trazo, cuando: Date.now(), fallo: false }
          dibujar(r.puntos, r.trazo)
        })
        .catch((e) => {
          if (e?.name === 'AbortError' || control.signal.aborted) return
          colaPegada.current = { ...(pegada ?? { unidad }), cuando: Date.now(), fallo: true }
        })
    }
    if (seleccionado && colaEncuadrada.current !== seleccionado) {
      const lienzo = m.getContainer().getBoundingClientRect()
      const limites = util.reduce((b, p) => b.extend([p.lng, p.lat]), new mapboxgl.LngLatBounds([util[0].lng, util[0].lat], [util[0].lng, util[0].lat]))
      const ancho = lienzo.width > 600
      m.fitBounds(limites, {
        padding: { top: 150, left: (ficha || espacioFicha) && ancho ? 410 : 40, right: 80, bottom: (ficha || espacioFicha) && !ancho ? Math.min(lienzo.height * 0.45, 350) : 80 },
        maxZoom: 16,
        duration: sinMovimiento() ? 0 : 800,
      })
      colaEncuadrada.current = seleccionado
    }
    // La capa se queda entre refrescos; se quita al no haber cola, al cambiar de estilo o al desmontar.
    return () => control.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cola, seleccionado, listo])

  // Llevar la vista a un punto (una parada o un viaje de la lista)
  useEffect(() => {
    const m = mapa.current
    const mapboxgl = gl.current
    if (!m || !mapboxgl || !foco) return
    if (foco.limites?.length > 1) {
      const ancho = m.getContainer().getBoundingClientRect().width
      const limites = foco.limites.reduce((b, p) => b.extend([p[1], p[0]]), new mapboxgl.LngLatBounds([foco.limites[0][1], foco.limites[0][0]], [foco.limites[0][1], foco.limites[0][0]]))
      m.fitBounds(limites, { padding: { top: 110, left: ancho > 600 ? 440 : 30, right: 60, bottom: 80 }, maxZoom: 17, duration: 800 })
      return
    }
    m.flyTo({ center: [foco.lng, foco.lat], zoom: Math.max(m.getZoom(), 16), duration: 800 })
  }, [foco])

  // El contenedor cambia de tamaño al abrirse el módulo: recalcular
  useEffect(() => {
    const observer = new ResizeObserver(() => mapa.current?.resize())
    if (contenedor.current) observer.observe(contenedor.current)
    return () => observer.disconnect()
  }, [alto])

  // Ocultar solo etiquetas que colisionan, conservando cada vehículo seleccionable. Se
  // suscribe una vez por estilo (no en cada refresco) y lee las unidades de refs.
  useEffect(() => {
    const m = mapa.current
    if (!m || !listo) return undefined
    m.on('moveend', ordenarLuego)
    ordenarLuego()
    return () => m.off('moveend', ordenarLuego)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listo])

  const v = vehiculos.find((x) => x.id === seleccionado)
  const estados = [...new Map(vehiculos.map((u) => { const e = estadoUnidad(u); return [e.clave, e] })).values()]

  return (
    <div className={`pnl-mapa fleet-map oscuro con-mapbox luz-${luzActual}${herr.eligiendo ? ' eligiendo-destino' : ''}`} style={{ height: alto }}>
      <div ref={contenedor} className="pnl-mapa-lienzo" />

      <CapasMapa prefs={prefs} alCambiar={cambiarPrefs} luzActual={luzActual} />

      {herramientas && v && validPosition(v) && (
        <HerramientasRuta unidad={v} estado={herr} alElegirDestino={empezarDestino} alQuitarLlegada={quitarLlegada} alAlternarAlcance={alternarAlcance} />
      )}

      {leyenda && estados.length > 0 && <div className="fleet-map-legend" aria-label="Estados de los vehículos">{estados.map((e) => <span className={e.color} key={e.clave}><i />{e.texto}</span>)}</div>}

      {ficha && v && (
        <FichaUnidad
          unidad={v}
          variante="flotante"
          alCerrar={() => alSeleccionar?.(null)}
          alVerRecorrido={alVerRecorrido}
        />
      )}
    </div>
  )
}
