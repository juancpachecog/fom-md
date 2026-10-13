import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import FichaUnidad, { estadoUnidad } from './FichaUnidad'
import { vehicleMarkerSvg, MARKER_SIZE, MARKER_ANCHOR, validPosition } from './vehicleMarker'
import { pintarCola, pintarRuta } from './rutaLeaflet'
import '../../styles/fleet-map.css'

// ============================================================
// MAPA REAL (Leaflet encima; debajo Mapbox si hay token, si no OpenStreetMap)
// Servicio público sin garantía de disponibilidad. Respetar la política de
// teselas: identificación del sitio, caché del navegador y atribución visible.
//
// La atribución a OpenStreetMap es OBLIGATORIA por su licencia (ODbL) y va
// siempre visible en la esquina del mapa.
// ============================================================

// UN SOLO proveedor de teselas: OpenStreetMap, para los dos temas.
//
// Antes el tema oscuro usaba CARTO Dark Matter. Se retiró porque
// `basemaps.cartocdn.com` no responde desde la red de operación: las teselas
// no daban error, simplemente se colgaban hasta agotar el tiempo. Y como el
// respaldo se disparaba con el evento `tileerror`, que un timeout nunca
// dispara, el mapa se quedaba en negro sin avisar de nada.
//
// El aspecto oscuro se consigue ahora con un filtro CSS sobre las mismas
// teselas (ver `.pnl-mapa.oscuro` en panel.css). Menos dependencias externas
// y un modo menos que se puede romper por su cuenta.
const TESELAS = {
  claro: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    atribucion: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  oscuro: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    atribucion: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
}

/**
 * Mapa VECTORIAL opcional. Con `VITE_MAPA_ESTILO` (la URL de un estilo MapLibre/Mapbox GL, por ejemplo
 * el de OpenFreeMap o el de MapTiler) las calles se dibujan en vectores, con más detalle y nitidez en
 * cualquier zoom, en lugar de las teselas de imagen de OpenStreetMap. Es el mismo tipo de estilo que
 * el catálogo de mapas del servidor (`/maps/*`) entrega a la app, para que web y app muestren un solo mapa.
 * Sin esa variable todo sigue como antes.
 */
const ESTILO_VECTORIAL = import.meta.env?.VITE_MAPA_ESTILO || ''

/**
 * MAPBOX (decisión de Marco, 13 oct 2026): con `VITE_MAPBOX_TOKEN` (un token
 * público `pk.` restringido por URL en la cuenta de Mapbox) el mapa de debajo
 * pasa a ser Mapbox GL JS v3 con el estilo Standard: calles en vector, 3D,
 * luz del día, satélite si se cambia el estilo. Marcadores, recorridos y
 * fichas siguen en Leaflet encima, sin cambios. Se cobra por «carga de
 * mapa» (50.000 gratis al mes). Sin token, todo sigue como antes. Si el
 * token falla (vencido, URL no permitida), se vuelve a OpenStreetMap y se
 * avisa, en vez de dejar el mapa en blanco.
 */
const MAPBOX_TOKEN = String(import.meta.env?.VITE_MAPBOX_TOKEN || '').trim()
const MAPBOX_ESTILO = import.meta.env?.VITE_MAPBOX_ESTILO || 'mapbox://styles/mapbox/standard'
// dawn | day | dusk | night: la luz del estilo Standard. El panel es oscuro: noche.
const MAPBOX_LUZ = import.meta.env?.VITE_MAPBOX_LUZ || 'night'
const HAY_MAPBOX = /^pk\./u.test(MAPBOX_TOKEN)
const ATRIBUCION_VECTORIAL = import.meta.env?.VITE_MAPA_ATRIBUCION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

/**
 * Lleva un marcador de su posición actual a la nueva deslizándose.
 *
 * Los equipos reportan cada uno a cinco minutos, así que sin esto el punto
 * desaparece de un sitio y aparece en otro. Interpolando el trayecto durante
 * poco más de un segundo se lee como un vehículo avanzando, que es lo que el
 * supervisor espera de un rastreador.
 *
 * Devuelve una función para cancelar, porque si llega una posición todavía más
 * nueva a mitad del recorrido hay que abandonar el anterior y salir hacia la
 * última: si no, dos animaciones pelean por el mismo marcador.
 */
function deslizar(marcador, destino, ms = 1200) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { marcador.setLatLng(destino); return () => {} }
  const origen = marcador.getLatLng()
  const dLat = destino[0] - origen.lat
  const dLng = destino[1] - origen.lng

  // Salto enorme (primer dato, o el vehículo reapareció lejos): no se anima,
  // se coloca. Un deslizamiento de kilómetros sería una mentira visual.
  if (Math.abs(dLat) > 0.05 || Math.abs(dLng) > 0.05 || (dLat === 0 && dLng === 0)) {
    marcador.setLatLng(destino)
    return () => {}
  }

  let cuadro = 0
  const inicio = performance.now()
  const paso = (ahora) => {
    const t = Math.min(1, (ahora - inicio) / ms)
    const suave = 1 - Math.pow(1 - t, 3)
    marcador.setLatLng([origen.lat + dLat * suave, origen.lng + dLng * suave])
    if (t < 1) cuadro = requestAnimationFrame(paso)
  }
  cuadro = requestAnimationFrame(paso)
  return () => cancelAnimationFrame(cuadro)
}

// Costa Oriental del Lago
const CENTRO = [10.32, -71.42]

function leerTokens() {
  const raiz = document.querySelector('.pnl') || document.documentElement
  const cs = getComputedStyle(raiz)
  return {
    primario: cs.getPropertyValue('--e-primario').trim() || '#208AEF',
    exito: cs.getPropertyValue('--e-exito').trim() || '#1E9E5A',
    tenue: cs.getPropertyValue('--e-texto-3').trim() || '#8A919E',
    superficie: cs.getPropertyValue('--e-sup').trim() || '#FFFFFF',
  }
}

function iconoUnidad(v, seleccionado) {
  return L.divIcon({ className: `fleet-marker${seleccionado ? ' selected' : ''}`, html: vehicleMarkerSvg(v, seleccionado), iconSize: MARKER_SIZE, iconAnchor: MARKER_ANCHOR })
}

export default function MapaLibre({
  vehiculos = [],
  seleccionado = null,
  alSeleccionar,
  // La leyenda («N unidades · M reportando») y la ficha flotante sobran
  // cuando el mapa muestra UNA sola unidad y la pantalla ya dice quién es
  // (Mi unidad): ahí se apagan y la pantalla pone sus propias cifras.
  leyenda = true,
  ficha = true,
  recorrido = null,
  // Recorrido con sus viajes y paradas (ver datos/recorrido.js), la cola de los últimos
  // minutos y un lugar al que llevar la vista.
  viajes = null,
  paradas = null,
  cola = null,
  foco = null,
  viajeActivo = null,
  alElegirViaje,
  alVerRecorrido,
  espacioFicha = false,
  alto = 'clamp(320px, 52vh, 560px)',
}) {
  const contenedor = useRef(null)
  const mapa = useRef(null)
  const capa = useRef(null)
  const marcadores = useRef(new Map())
  // Cancelador de la animación en curso de cada unidad, para que dos
  // posiciones seguidas no se peleen por mover el mismo marcador.
  const animaciones = useRef(new Map())
  const linea = useRef(null)
  const viajesRef = useRef(viajes)
  const paradasRef = useRef(paradas)
  viajesRef.current = viajes
  paradasRef.current = paradas
  const vehiculosRef = useRef(vehiculos)
  vehiculosRef.current = vehiculos
  const rutaCapa = useRef(null)
  const resaltarRef = useRef(null)
  const viajeActivoRef = useRef(viajeActivo)
  const alElegirViajeRef = useRef(alElegirViaje)
  viajeActivoRef.current = viajeActivo
  alElegirViajeRef.current = alElegirViaje
  const colaCapa = useRef(null)
  const colaEncuadrada = useRef(null)
  const encuadrado = useRef(false)
  const [fallaTeselas, setFallaTeselas] = useState(false)
  // Mapbox cargó mal (token inválido, URL no permitida, sin WebGL 2): se cae a OpenStreetMap.
  const [mapboxFallo, setMapboxFallo] = useState(false)
  const conMapbox = HAY_MAPBOX && !mapboxFallo

  const esquema = 'oscuro'

  // Crear el mapa una sola vez
  useEffect(() => {
    if (mapa.current || !contenedor.current) return undefined
    mapa.current = L.map(contenedor.current, {
      center: CENTRO,
      zoom: 9,
      // Tope de acercamiento: nivel 19, el último que trae el mapa. Más allá solo se agranda la imagen.
      maxZoom: 19,
      zoomControl: false,
      attributionControl: true,
    })
    L.control.zoom({ position: 'bottomright' }).addTo(mapa.current)
    // Los carros se achican al alejar el mapa y, muy lejos, se apagan las etiquetas: a escala de región
    // un carro de tamaño completo tapa a los vecinos y al propio mapa.
    const raiz = contenedor.current.parentElement
    const mapaVivo = mapa.current
    const ajustarMarcadores = () => {
      const z = mapaVivo.getZoom()
      // Crece poco a poco con el zoom y se queda en 0,85: a escala de calle el carro a tamaño completo era más ancho que la calle.
      const k = Math.max(0.4, Math.min(0.85, 0.4 + (z - 9) * 0.075))
      raiz.style.setProperty('--marcador-k', String(k))
      raiz.dataset.zoom = z <= 12 ? 'lejos' : 'cerca'
    }
    mapaVivo.on('zoomend', ajustarMarcadores)
    ajustarMarcadores()
    const animacionesActivas = animaciones.current
    return () => {
      animacionesActivas.forEach((cancelar) => cancelar())
      animacionesActivas.clear()
      mapa.current?.remove()
      mapa.current = null
      marcadores.current.clear()
      // El mapa nuevo que venga tiene que volver a encuadrarse. Sin esto, en
      // desarrollo (StrictMode monta, desmonta y vuelve a montar) el segundo
      // mapa se quedaba en el centro por defecto y a zoom regional.
      encuadrado.current = false
    }
  }, [])

  // Teselas según el modo claro u oscuro
  useEffect(() => {
    if (!mapa.current) return
    const t = TESELAS[esquema]
    if (capa.current) capa.current.remove()
    let fallos = 0
    let cargoAlguna = false
    if (conMapbox) {
      let cancelado = false
      Promise.all([import('mapbox-gl'), import('mapbox-gl/dist/mapbox-gl.css'), import('./mapboxLeaflet')])
        .then(([mapboxgl, , { crearCapaMapbox }]) => {
          if (cancelado || !mapa.current) return
          const gl = mapboxgl.default ?? mapboxgl
          if (!gl.supported?.({ failIfMajorPerformanceCaveat: false })) throw new Error('Este navegador no puede dibujar el mapa de Mapbox (WebGL 2).')
          const esStandard = /\/standard(?:-satellite)?$/u.test(MAPBOX_ESTILO)
          capa.current = crearCapaMapbox(gl)({
            accessToken: MAPBOX_TOKEN,
            style: MAPBOX_ESTILO,
            config: esStandard ? { basemap: { lightPreset: MAPBOX_LUZ, showPointOfInterestLabels: true, showPlaceLabels: true, showRoadLabels: true, showTransitLabels: false } } : undefined,
            attribution: '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            alCargar: () => setFallaTeselas(false),
            alError: (error) => {
              // Un 401 o 403 es el token; un fallo de estilo o de WebGL es el entorno. En todos los
              // casos la respuesta es la misma: mapa de respaldo y aviso, nunca un rectángulo vacío.
              console.warn('[mapa] Mapbox no cargó; se usa OpenStreetMap:', error?.message || error)
              setMapboxFallo(true)
            },
          })
          capa.current.addTo(mapa.current)
        })
        .catch((error) => {
          console.warn('[mapa] Mapbox no cargó; se usa OpenStreetMap:', error?.message || error)
          setMapboxFallo(true)
        })
      return () => {
        cancelado = true
        capa.current?.remove()
        capa.current = null
      }
    }
    if (ESTILO_VECTORIAL) {
      // Carga perezosa: el motor vectorial pesa y solo se baja si hay un estilo configurado.
      let cancelado = false
      // El worker se pide con `?worker&url`: Vite lo empaqueta con sus dependencias y la URL sirve igual
      // en desarrollo que en producción (la ruta relativa que trae MapLibre se rompe al empaquetar).
      Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'), import('@maplibre/maplibre-gl-leaflet'), import('maplibre-gl/dist/maplibre-gl.css')])
        .then(([maplibregl, { default: urlWorker }, { maplibreGL }]) => {
          maplibregl.setWorkerUrl(urlWorker)
          if (cancelado || !mapa.current) return
          capa.current = maplibreGL({ style: ESTILO_VECTORIAL, attribution: ATRIBUCION_VECTORIAL })
          capa.current.addTo(mapa.current)
        })
        .catch(() => setFallaTeselas(true))
      return () => {
        cancelado = true
        capa.current?.remove()
        capa.current = null
      }
    }
    capa.current = L.tileLayer(t.url, {
      attribution: t.atribucion,
      maxNativeZoom: t.maxZoom,
      maxZoom: 19,
      // OSM necesita el origen real del sitio; no enviar rutas del panel.
      referrerPolicy: 'strict-origin',
    })
    capa.current.on('tileerror', () => {
      fallos += 1
      if (fallos > 6) setFallaTeselas(true)
    })
    capa.current.on('tileload', () => {
      cargoAlguna = true
      setFallaTeselas(false)
    })
    capa.current.addTo(mapa.current)

    // Un proveedor caído no siempre falla: a veces solo se cuelga, y entonces
    // `tileerror` no llega nunca. Si a los 8 segundos no cargó ni una tesela,
    // se avisa igual en vez de dejar un rectángulo vacío.
    const vigilante = setTimeout(() => {
      if (!cargoAlguna) setFallaTeselas(true)
    }, 8000)
    return () => clearTimeout(vigilante)
  }, [esquema, conMapbox])

  // Marcadores de las unidades
  useEffect(() => {
    if (!mapa.current) return
    const vistos = new Set()

    vehiculos
      .filter(validPosition)
      .forEach((v) => {
        vistos.add(v.id)
        const sel = seleccionado === v.id
        let m = marcadores.current.get(v.id)
        if (!m) {
          m = L.marker([v.lat, v.lng], {
            icon: iconoUnidad(v, sel),
            title: `${v.alias} · ${v.placa}`,
            keyboard: true,
            alt: `${v.alias || v.placa}, ${estadoUnidad(v).texto}`,
          })
          m.addTo(mapa.current)
          marcadores.current.set(v.id, m)
        } else {
          const previa = m.getLatLng()
          if (previa.lat !== v.lat || previa.lng !== v.lng) {
            animaciones.current.get(v.id)?.()
            animaciones.current.set(v.id, deslizar(m, [v.lat, v.lng]))
          }
          m.setIcon(iconoUnidad(v, sel))
        }
        m.off('click').on('click', () => alSeleccionar?.(seleccionado === v.id ? null : v.id))
        m.setZIndexOffset(sel ? 1000 : 0)
        const elemento = m.getElement()
        if (elemento) {
          elemento.setAttribute('aria-label', `${v.placa || v.alias || 'Sin placa'}, ${estadoUnidad(v).texto}`)
          elemento.setAttribute('aria-pressed', String(sel))
        }
      })

    marcadores.current.forEach((m, id) => {
      if (!vistos.has(id)) {
        animaciones.current.get(id)?.()
        animaciones.current.delete(id)
        m.remove()
        marcadores.current.delete(id)
      }
    })

    // Encuadrar toda la flota la primera vez
    if (!encuadrado.current && vistos.size) {
      const puntos = vehiculos.filter(validPosition).map((v) => [v.lat, v.lng])
      if (puntos.length) {
        // Una sola unidad: centrarla a un zoom de ciudad. Encuadrar «los
        // límites» de un único punto depende del tamaño que tenga el lienzo
        // en ese instante y en pantallas anchas salía medio continente.
        if (puntos.length === 1) mapa.current.setView(puntos[0], 13)
        else mapa.current.fitBounds(puntos, { padding: [48, 48], maxZoom: 12 })
        encuadrado.current = true
      }
    }
  }, [vehiculos, seleccionado, alSeleccionar, esquema])

  // Al ELEGIR una unidad se centra en ella (una sola vez, sin tocar el zoom). Los refrescos de la flota
  // no mueven nada: la vista solo la mueve quien la usa.
  useEffect(() => {
    colaEncuadrada.current = null
    if (!mapa.current || !seleccionado) return
    const v = vehiculosRef.current.find((x) => x.id === seleccionado)
    if (!validPosition(v)) return
    const size = mapa.current.getSize()
    const punto = mapa.current.project([v.lat, v.lng])
    const offset = (ficha || espacioFicha) ? (size.x > 600 ? L.point(-175, 0) : L.point(0, size.y * .18)) : L.point(0, 0)
    mapa.current.panTo(mapa.current.unproject(punto.add(offset)), { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionado])

  // Recorrido con viajes (inicio y fin), paradas y hora de cada punto
  useEffect(() => {
    if (!mapa.current) return undefined
    rutaCapa.current?.remove()
    rutaCapa.current = null
    if (!viajes?.length && !paradas?.length) return undefined
    const { grupo, resaltar } = pintarRuta(L, mapa.current, { viajes: viajes ?? [], paradas: paradas ?? [], color: leerTokens().primario, alElegirViaje: (n) => alElegirViajeRef.current?.(n) })
    rutaCapa.current = grupo
    resaltarRef.current = resaltar
    resaltar(viajeActivoRef.current)
    return () => {
      grupo.remove()
    }
  }, [viajes, paradas, seleccionado])

  // Resaltar el viaje elegido en la lista sin volver a dibujar nada
  useEffect(() => {
    resaltarRef.current?.(viajeActivo)
  }, [viajeActivo])

  // Cola: los últimos minutos de camino de la unidad elegida, sin pedir el recorrido
  useEffect(() => {
    if (!mapa.current) return undefined
    colaCapa.current?.remove()
    colaCapa.current = null
    if (!cola || cola.length < 2) return undefined
    const util = cola.filter(validPosition)
    if (util.length < 2) return undefined
    const grupo = pintarCola(L, mapa.current, util, leerTokens().primario)
    colaCapa.current = grupo
    if (seleccionado && colaEncuadrada.current !== seleccionado) {
      const size = mapa.current.getSize()
      mapa.current.fitBounds(L.latLngBounds(util.map(p => [p.lat, p.lng])), {
        paddingTopLeft: [(ficha || espacioFicha) && size.x > 600 ? 410 : 40, 150],
        paddingBottomRight: [80, (ficha || espacioFicha) && size.x <= 600 ? Math.min(size.y * .45, 350) : 80],
        maxZoom: 16,
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      })
      colaEncuadrada.current = seleccionado
    }
    return () => {
      grupo.remove()
    }
  }, [cola, seleccionado])

  // Llevar la vista a un punto (una parada o un viaje de la lista)
  useEffect(() => {
    if (!mapa.current || !foco) return
    if (foco.limites?.length > 1) {
      const ancho = mapa.current.getSize().x
      mapa.current.fitBounds(L.latLngBounds(foco.limites), { paddingTopLeft: [ancho > 600 ? 440 : 30, 110], paddingBottomRight: [60, 80], maxZoom: 17, duration: 0.8 })
      return
    }
    mapa.current.flyTo([foco.lat, foco.lng], Math.max(mapa.current.getZoom(), 16), { duration: 0.8 })
  }, [foco])

  // El contenedor cambia de tamaño al abrirse el módulo: recalcular
  useEffect(() => {
    const observer = new ResizeObserver(() => mapa.current?.invalidateSize())
    if (contenedor.current) observer.observe(contenedor.current)
    return () => observer.disconnect()
  }, [alto])

  // Ocultar solo etiquetas que colisionan, conservando cada vehículo seleccionable.
  useEffect(() => {
    const m = mapa.current
    if (!m) return
    const ordenar = () => {
      const cajas = []
      const orden = [...vehiculos].sort((a, b) => Number(b.id === seleccionado) - Number(a.id === seleccionado))
      orden.filter(validPosition).forEach(v => {
        const elemento = marcadores.current.get(v.id)?.getElement()
        if (!elemento) return
        const p = m.latLngToContainerPoint([v.lat, v.lng])
        const caja = { x: p.x + 20, y: p.y - 37, w: 125, h: 48 }
        const choque = cajas.some(c => caja.x < c.x + c.w && caja.x + caja.w > c.x && caja.y < c.y + c.h && caja.y + caja.h > c.y)
        // Con el recorrido a la vista, las etiquetas de las demás unidades se apagan: tapan la ruta.
        const enRuta = Boolean(viajesRef.current?.length || paradasRef.current?.length)
        elemento.classList.toggle('is-muted', (choque || enRuta) && v.id !== seleccionado)
        if (!choque || v.id === seleccionado) cajas.push(caja)
      })
    }
    ordenar()
    m.on('zoomend moveend', ordenar)
    return () => m.off('zoomend moveend', ordenar)
  }, [vehiculos, seleccionado, viajes, paradas])

  const v = vehiculos.find((x) => x.id === seleccionado)
  const estados = [...new Map(vehiculos.map(v => { const e = estadoUnidad(v); return [e.clave, e] })).values()]

  return (
    <div className={`pnl-mapa fleet-map${esquema === 'oscuro' ? ' oscuro' : ''}${conMapbox ? ' con-mapbox' : ''}`} style={{ height: alto }}>
      <div ref={contenedor} className="pnl-mapa-lienzo" />

      {fallaTeselas && (
        <div className="pnl-mapa-aviso">
          No se pudieron cargar las imágenes del mapa. Revisa la conexión.
        </div>
      )}

      {leyenda && estados.length > 0 && <div className="fleet-map-legend" aria-label="Estados de los vehículos">{estados.map(e => <span className={e.color} key={e.clave}><i />{e.texto}</span>)}</div>}

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
