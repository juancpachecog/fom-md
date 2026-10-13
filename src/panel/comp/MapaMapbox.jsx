import { useEffect, useRef, useState } from 'react'
import FichaUnidad, { estadoUnidad } from './FichaUnidad'
import { vehicleMarkerSvg, MARKER_SIZE, MARKER_ANCHOR, validPosition } from './vehicleMarker'
import { pintarCola, pintarRuta } from './rutaMapbox'
import CapasMapa from './CapasMapa'
import { configDe, estiloDe, guardarPrefs, leerPrefs, luzEfectiva, nieblaDe } from './mapaPrefs'
import '../../styles/fleet-map.css'
import '../../styles/mapa-mapbox.css'

// ============================================================
// MAPA DE FLOTA SOBRE MAPBOX GL JS v3 (decisión de Marco, 13 oct 2026)
// ------------------------------------------------------------
// El mismo mapa que `MapaLibre.jsx` (mismas props, mismos marcadores,
// recorrido, cola y fichas) dibujado directo con Mapbox: estilo Standard
// con luz del día real, edificios y árboles en 3D, satélite, relieve,
// tráfico en vivo y cámara inclinable. Se cobra por «carga de mapa»: una
// por cada vez que esta pantalla se abre (50.000 gratis al mes).
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
const RELIEVE_FUENTE = 'mapbox-dem'

function leerTokens() {
  const raiz = document.querySelector('.pnl') || document.documentElement
  const cs = getComputedStyle(raiz)
  return { primario: cs.getPropertyValue('--e-primario').trim() || '#208AEF' }
}

const sinMovimiento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Lleva un marcador de su posición actual a la nueva deslizándose (ver MapaLibre.jsx). */
function deslizar(marcador, destino, ms = 1200) {
  if (sinMovimiento()) { marcador.setLngLat(destino); return () => {} }
  const origen = marcador.getLngLat()
  const dLng = destino[0] - origen.lng
  const dLat = destino[1] - origen.lat
  if (Math.abs(dLat) > 0.05 || Math.abs(dLng) > 0.05 || (dLat === 0 && dLng === 0)) {
    marcador.setLngLat(destino)
    return () => {}
  }
  let cuadro = 0
  const inicio = performance.now()
  const paso = (ahora) => {
    const t = Math.min(1, (ahora - inicio) / ms)
    const suave = 1 - Math.pow(1 - t, 3)
    marcador.setLngLat([origen.lng + dLng * suave, origen.lat + dLat * suave])
    if (t < 1) cuadro = requestAnimationFrame(paso)
  }
  cuadro = requestAnimationFrame(paso)
  return () => cancelAnimationFrame(cuadro)
}

/** Elemento HTML de un marcador de unidad: el mismo SVG que usan Leaflet y Google. */
function elementoUnidad(v, seleccionado) {
  const el = document.createElement('div')
  el.className = `fleet-marker${seleccionado ? ' selected' : ''}`
  el.style.width = `${MARKER_SIZE[0]}px`
  el.style.height = `${MARKER_SIZE[1]}px`
  el.innerHTML = vehicleMarkerSvg(v, seleccionado)
  el.dataset.html = el.innerHTML
  el.setAttribute('role', 'button')
  el.tabIndex = 0
  return el
}

/** Aplica al mapa lo que diga el panel de capas: luz, 3D, relieve, tráfico, niebla y lluvia. */
function aplicarPrefs(mapa, prefs) {
  const luz = luzEfectiva(prefs)
  const config = configDe(prefs)
  for (const [clave, valor] of Object.entries(config)) {
    try { mapa.setConfigProperty('basemap', clave, valor) } catch { /* propiedad que este estilo no tiene */ }
  }
  try { mapa.setFog(nieblaDe(luz)) } catch { /* sin niebla */ }

  // Relieve: el modelo de elevación de Mapbox, con un poco de exageración para que se note.
  try {
    if (prefs.relieve) {
      if (!mapa.getSource(RELIEVE_FUENTE)) mapa.addSource(RELIEVE_FUENTE, { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 })
      mapa.setTerrain({ source: RELIEVE_FUENTE, exaggeration: 1.4 })
    } else if (mapa.getTerrain()) {
      mapa.setTerrain(null)
    }
  } catch { /* sin relieve */ }

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
  alFallar,
}) {
  const contenedor = useRef(null)
  const mapa = useRef(null)
  const gl = useRef(null)
  const marcadores = useRef(new Map())
  const animaciones = useRef(new Map())
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
  // `isStyleLoaded()` de Mapbox se pone en falso un instante cada vez que se toca el estilo
  // (añadir relieve, tráfico…), así que no sirve para saber si ya se puede dibujar. Esto sí:
  // verdadero desde `style.load` hasta el siguiente `setStyle`.
  const estiloListo = useRef(false)
  const [listo, setListo] = useState(0)
  const [prefs, setPrefs] = useState(() => leerPrefs())
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const [luzActual, setLuzActual] = useState(() => luzEfectiva(prefs))

  // Crear el mapa una sola vez
  useEffect(() => {
    if (mapa.current || !contenedor.current) return undefined
    let cancelado = false
    let vigilante = 0
    const animacionesActivas = animaciones.current
    const marcadoresActivos = marcadores.current
    const raiz = contenedor.current.parentElement

    Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css')])
      .then(([modulo]) => {
        if (cancelado || !contenedor.current) return
        const mapboxgl = modulo.default ?? modulo
        if (!mapboxgl.supported?.({ failIfMajorPerformanceCaveat: false })) throw new Error('Este navegador no puede dibujar el mapa de Mapbox (WebGL 2).')
        mapboxgl.accessToken = MAPBOX_TOKEN
        gl.current = mapboxgl
        const p = prefsRef.current
        const m = new mapboxgl.Map({
          container: contenedor.current,
          style: estiloDe(p),
          config: { basemap: configDe(p) },
          center: CENTRO,
          zoom: 8,
          minZoom: 3,
          maxZoom: 19,
          pitch: p.vista3d ? 55 : 0,
          bearing: 0,
          projection: 'mercator',
          language: 'es',
          attributionControl: false,
          logoPosition: 'bottom-left',
          // Girar con el botón derecho o con dos dedos; inclinar igual. Las teclas de flecha mueven el mapa.
          dragRotate: true,
          touchPitch: true,
          pitchWithRotate: true,
        })
        mapa.current = m
        // Solo en desarrollo: para inspeccionar el mapa desde la consola del navegador.
        if (import.meta.env?.DEV) window.__fomMapa = m
        m.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
        m.addControl(new mapboxgl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), 'bottom-right')

        // Si en 25 s no cargó nada, el token o la red fallaron: se avisa para volver a Leaflet.
        vigilante = window.setTimeout(() => {
          if (!m.loaded()) {
            console.warn('[mapa] Mapbox no respondió a tiempo; se usa el mapa de respaldo.')
            alFallarRef.current?.()
          }
        }, 25000)
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
        m.on('load', () => window.clearTimeout(vigilante))
        // Cada vez que entra un estilo (al crear el mapa y al cambiar entre calles y satélite)
        // se vuelven a aplicar las preferencias y se avisa para repintar recorrido y cola.
        m.on('style.load', () => {
          estiloListo.current = true
          aplicarPrefs(m, prefsRef.current)
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
      })
      .catch((error) => {
        console.warn('[mapa] Mapbox no cargó; se usa el mapa de respaldo:', error?.message || error)
        alFallarRef.current?.()
      })

    return () => {
      cancelado = true
      window.clearTimeout(vigilante)
      animacionesActivas.forEach((cancelar) => cancelar())
      animacionesActivas.clear()
      marcadoresActivos.forEach((mk) => mk.remove())
      marcadoresActivos.clear()
      ruta.current?.quitar?.()
      ruta.current = null
      colaCapa.current?.quitar?.()
      colaCapa.current = null
      mapa.current?.remove()
      mapa.current = null
      encuadrado.current = false
    }
  }, [])

  // La luz automática cambia con la hora: se revisa cada cinco minutos.
  useEffect(() => {
    const t = setInterval(() => {
      const luz = luzEfectiva(prefsRef.current)
      setLuzActual((actual) => {
        if (actual === luz) return actual
        if (mapa.current && estiloListo.current) aplicarPrefs(mapa.current, prefsRef.current)
        return luz
      })
    }, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // Cambiar preferencias: se guardan, y si cambia la vista (calles/satélite) se carga el otro estilo.
  const cambiarPrefs = (nuevas) => {
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
      estiloListo.current = false
      m.setStyle(estiloDe(nuevas), { config: { basemap: configDe(nuevas) } })
    } else if (estiloListo.current) {
      aplicarPrefs(m, nuevas)
    }
    if (nuevas.vista3d !== previas.vista3d) {
      m.easeTo({ pitch: nuevas.vista3d ? 55 : 0, bearing: nuevas.vista3d ? m.getBearing() : 0, duration: sinMovimiento() ? 0 : 900 })
    }
  }

  // Marcadores de las unidades
  useEffect(() => {
    const m = mapa.current
    const mapboxgl = gl.current
    if (!m || !mapboxgl) return
    const vistos = new Set()

    vehiculos
      .filter(validPosition)
      .forEach((v) => {
        vistos.add(v.id)
        const sel = seleccionado === v.id
        let mk = marcadores.current.get(v.id)
        if (!mk) {
          const el = elementoUnidad(v, sel)
          mk = new mapboxgl.Marker({ element: el, anchor: 'top-left', offset: [-MARKER_ANCHOR[0], -MARKER_ANCHOR[1]] })
            .setLngLat([v.lng, v.lat])
            .addTo(m)
          marcadores.current.set(v.id, mk)
        } else {
          const previa = mk.getLngLat()
          if (previa.lat !== v.lat || previa.lng !== v.lng) {
            animaciones.current.get(v.id)?.()
            animaciones.current.set(v.id, deslizar(mk, [v.lng, v.lat]))
          }
          const el = mk.getElement()
          const html = vehicleMarkerSvg(v, sel)
          if (el.dataset.html !== html) {
            el.innerHTML = html
            el.dataset.html = html
          }
          el.classList.toggle('selected', sel)
        }
        const el = mk.getElement()
        el.onclick = (e) => {
          e.stopPropagation()
          alSeleccionar?.(seleccionado === v.id ? null : v.id)
        }
        el.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            alSeleccionar?.(seleccionado === v.id ? null : v.id)
          }
        }
        el.style.zIndex = sel ? '1000' : '0'
        el.title = `${v.alias} · ${v.placa}`
        el.setAttribute('aria-label', `${v.placa || v.alias || 'Sin placa'}, ${estadoUnidad(v).texto}`)
        el.setAttribute('aria-pressed', String(sel))
      })

    marcadores.current.forEach((mk, id) => {
      if (!vistos.has(id)) {
        animaciones.current.get(id)?.()
        animaciones.current.delete(id)
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
  }, [vehiculos, seleccionado, alSeleccionar, listo])

  // Al ELEGIR una unidad se centra en ella (una sola vez, sin tocar el zoom).
  useEffect(() => {
    colaEncuadrada.current = null
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
    const r = pintarRuta(mapboxgl, m, { viajes: viajes ?? [], paradas: paradas ?? [], color: leerTokens().primario, alElegirViaje: (n) => alElegirViajeRef.current?.(n) })
    ruta.current = r
    resaltarRef.current = r.resaltar
    r.resaltar(viajeActivoRef.current)
    return () => {
      r.quitar()
      if (ruta.current === r) ruta.current = null
    }
  }, [viajes, paradas, seleccionado, listo])

  // Resaltar el viaje elegido en la lista sin volver a dibujar nada
  useEffect(() => {
    resaltarRef.current?.(viajeActivo)
  }, [viajeActivo])

  // Cola: los últimos minutos de camino de la unidad elegida
  useEffect(() => {
    const m = mapa.current
    const mapboxgl = gl.current
    colaCapa.current?.quitar?.()
    colaCapa.current = null
    if (!m || !mapboxgl || !listo || !estiloListo.current) return undefined
    if (!cola || cola.length < 2) return undefined
    const util = cola.filter(validPosition)
    if (util.length < 2) return undefined
    const c = pintarCola(mapboxgl, m, util, leerTokens().primario)
    colaCapa.current = c
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
    return () => {
      c.quitar()
      if (colaCapa.current === c) colaCapa.current = null
    }
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

  // Ocultar solo etiquetas que colisionan, conservando cada vehículo seleccionable.
  useEffect(() => {
    const m = mapa.current
    if (!m) return undefined
    const ordenar = () => {
      const cajas = []
      const orden = [...vehiculos].sort((a, b) => Number(b.id === seleccionado) - Number(a.id === seleccionado))
      const enRuta = Boolean(viajesRef.current?.length || paradasRef.current?.length)
      orden.filter(validPosition).forEach((v) => {
        const elemento = marcadores.current.get(v.id)?.getElement()
        if (!elemento) return
        const p = m.project([v.lng, v.lat])
        const caja = { x: p.x + 20, y: p.y - 37, w: 125, h: 48 }
        const choque = cajas.some((c) => caja.x < c.x + c.w && caja.x + caja.w > c.x && caja.y < c.y + c.h && caja.y + caja.h > c.y)
        elemento.classList.toggle('is-muted', (choque || enRuta) && v.id !== seleccionado)
        if (!choque || v.id === seleccionado) cajas.push(caja)
      })
    }
    ordenar()
    m.on('zoomend', ordenar)
    m.on('moveend', ordenar)
    return () => {
      m.off('zoomend', ordenar)
      m.off('moveend', ordenar)
    }
  }, [vehiculos, seleccionado, viajes, paradas, listo])

  const v = vehiculos.find((x) => x.id === seleccionado)
  const estados = [...new Map(vehiculos.map((u) => { const e = estadoUnidad(u); return [e.clave, e] })).values()]

  return (
    <div className={`pnl-mapa fleet-map oscuro con-mapbox luz-${luzActual}${prefs.vista3d ? ' vista-3d' : ''}`} style={{ height: alto }}>
      <div ref={contenedor} className="pnl-mapa-lienzo" />

      <CapasMapa prefs={prefs} alCambiar={cambiarPrefs} luzActual={luzActual} />

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
