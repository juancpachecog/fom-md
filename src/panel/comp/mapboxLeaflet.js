// ============================================================
// MAPBOX GL JS DEBAJO DE LEAFLET
// ------------------------------------------------------------
// Un adaptador que pinta un mapa de Mapbox GL JS (v3, estilo Standard con
// 3D, luz y satélite) como capa base de Leaflet, sincronizando centro y
// zoom. Así los marcadores, recorridos y fichas que ya tiene el panel en
// Leaflet siguen funcionando tal cual, y el mapa de debajo pasa a ser el
// de Mapbox. Es la misma idea que `@maplibre/maplibre-gl-leaflet`, portada
// a `mapbox-gl` (MapLibre no puede cargar los estilos de Mapbox ni el
// Standard). Se cobra como «carga de mapa» de GL JS, no por tesela.
//
// Lo que cambia frente al original:
//   - `projection: 'mercator'` siempre: el estilo Standard arranca en globo
//     y Leaflet es Mercator; en globo las capas no coincidirían.
//   - `pitch` y `bearing` fijos en 0 por lo mismo.
//   - La atribución («© Mapbox © OpenStreetMap») se pasa como `attribution`
//     en las opciones y Leaflet la pone y la quita con la capa, igual que con
//     cualquier otra; el logo de Mapbox queda dentro del lienzo GL, como
//     exige su licencia.
// ============================================================
import L from 'leaflet'

export function crearCapaMapbox(mapboxgl) {
  const CapaMapbox = L.Layer.extend({
    options: {
      updateInterval: 32,
      padding: 0.1,
      interactive: false,
      pane: 'tilePane',
    },

    initialize(options) {
      L.setOptions(this, options)
      this._throttledUpdate = L.Util.throttle(this._update, this.options.updateInterval, this)
    },

    onAdd(map) {
      if (!this._container) this._initContainer()
      map.getPane(this.getPaneName()).appendChild(this._container)
      this._initGL()
      this._offset = this._map.containerPointToLayerPoint([0, 0])
      if (map.options.zoomAnimation) L.DomEvent.on(map._proxy, L.DomUtil.TRANSITION_END, this._transitionEnd, this)
    },

    onRemove(map) {
      if (this._map._proxy && this._map.options.zoomAnimation) {
        L.DomEvent.off(this._map._proxy, L.DomUtil.TRANSITION_END, this._transitionEnd, this)
      }
      map.getPane(this.getPaneName()).removeChild(this._container)
      this._glMap?.remove()
      this._glMap = null
    },

    getEvents() {
      return {
        move: this._throttledUpdate,
        zoomanim: this._animateZoom,
        zoom: this._pinchZoom,
        zoomstart: this._zoomStart,
        zoomend: this._zoomEnd,
        resize: this._resize,
      }
    },

    getMapboxMap() {
      return this._glMap
    },

    getSize() {
      return this._map.getSize().multiplyBy(1 + this.options.padding * 2)
    },

    getPaneName() {
      return this._map.getPane(this.options.pane) ? this.options.pane : 'tilePane'
    },

    _roundPoint(p) {
      return { x: Math.round(p.x), y: Math.round(p.y) }
    },

    _initContainer() {
      const container = (this._container = L.DomUtil.create('div', 'leaflet-gl-layer leaflet-mapbox-layer'))
      this._resizeContainer()
      const offset = this._map.getSize().multiplyBy(this.options.padding)
      const topLeft = this._map.containerPointToLayerPoint([0, 0]).subtract(offset)
      L.DomUtil.setPosition(container, this._roundPoint(topLeft))
    },

    _resizeContainer() {
      const size = this.getSize()
      this._container.style.width = `${size.x}px`
      this._container.style.height = `${size.y}px`
    },

    _initGL() {
      const center = this._map.getCenter()
      const { accessToken, style, config, alError, alCargar, attribution, pane, padding, updateInterval, className, ...resto } = this.options
      if (accessToken) mapboxgl.accessToken = accessToken
      const options = L.extend({}, resto, {
        container: this._container,
        style,
        center: [center.lng, center.lat],
        zoom: this._map.getZoom() - 1,
        pitch: 0,
        bearing: 0,
        projection: 'mercator',
        attributionControl: false,
        interactive: false,
        // Sin flechas ni gestos propios: Leaflet manda.
        dragPan: false,
        scrollZoom: false,
        doubleClickZoom: false,
        touchZoomRotate: false,
        keyboard: false,
        ...(config ? { config } : {}),
      })
      this._glMap = new mapboxgl.Map(options)

      this._glMap.on('load', () => alCargar?.(this._glMap))
      if (alError) this._glMap.on('error', (e) => alError(e?.error ?? e))

      // Leaflet puede pedir centros más allá de ±85°; se le quita a GL el tope de latitud
      // para que los dos mapas no se desalineen en los bordes. Es privado: por eso va protegido.
      try {
        const t = this._glMap.transform
        if (t) {
          if ('latRange' in t) t.latRange = null
          if ('maxValidLatitude' in t) t.maxValidLatitude = Infinity
        }
      } catch {
        /* versión sin esos campos: sin consecuencias visibles en la zona de operación */
      }

      this._transformGL(this._glMap)
      const canvas = this._glMap.getCanvas()
      this._glMap._lienzo = canvas
      L.DomUtil.addClass(canvas, 'leaflet-image-layer')
      L.DomUtil.addClass(canvas, 'leaflet-zoom-animated')
      if (this.options.className) L.DomUtil.addClass(canvas, this.options.className)
    },

    _update() {
      if (!this._map) return
      this._offset = this._map.containerPointToLayerPoint([0, 0])
      if (this._zooming) return
      const offset = this._map.getSize().multiplyBy(this.options.padding)
      const topLeft = this._map.containerPointToLayerPoint([0, 0]).subtract(offset)
      L.DomUtil.setPosition(this._container, this._roundPoint(topLeft))
      this._transformGL(this._glMap)
    },

    _transformGL(gl) {
      if (!gl) return
      const center = this._map.getCenter()
      gl.jumpTo({ center: [center.lng, center.lat], zoom: this._map.getZoom() - 1, pitch: 0, bearing: 0 })
    },

    _pinchZoom() {
      const center = this._map.getCenter()
      this._glMap?.jumpTo({ zoom: this._map.getZoom() - 1, center: [center.lng, center.lat] })
    },

    _animateZoom(e) {
      if (!this._glMap) return
      const scale = this._map.getZoomScale(e.zoom)
      const padding = this._map.getSize().multiplyBy(this.options.padding * scale)
      const viewHalf = this.getSize()._divideBy(2)
      const topLeft = this._map.project(e.center, e.zoom)._subtract(viewHalf)._add(this._map._getMapPanePos().add(padding))._round()
      const offset = this._map.project(this._map.getBounds().getNorthWest(), e.zoom)._subtract(topLeft)
      L.DomUtil.setTransform(this._glMap._lienzo, offset.subtract(this._offset), scale)
    },

    _zoomStart() {
      this._zooming = true
    },

    _zoomEnd() {
      if (!this._glMap) return
      const scale = this._map.getZoomScale(this._map.getZoom())
      L.DomUtil.setTransform(this._glMap._lienzo, null, scale)
      this._zooming = false
      this._update()
    },

    _transitionEnd() {
      L.Util.requestAnimFrame(function () {
        if (!this._glMap || !this._map) return
        const zoom = this._map.getZoom()
        const center = this._map.getCenter()
        const offset = this._map.latLngToContainerPoint(this._map.getBounds().getNorthWest())
        this._resizeContainer()
        L.DomUtil.setTransform(this._glMap._lienzo, offset, 1)
        this._glMap.once('moveend', L.Util.bind(function () { this._zoomEnd() }, this))
        this._glMap.resize()
        this._glMap.jumpTo({ center: [center.lng, center.lat], zoom: zoom - 1 })
      }, this)
    },

    _resize(e) {
      this._transitionEnd(e)
    },
  })

  return (options) => new CapaMapbox(options)
}
