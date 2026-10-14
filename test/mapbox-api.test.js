import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aplicarEmparejado, marcasDeTiempo, partirPuntos, tramosDeRuta, unirTrazos } from '../src/panel/datos/mapboxApi.js'

const pt = (i) => ({ lat: 10 + i * 0.001, lng: -71.4, hora: `2026-10-13T08:${String(i % 60).padStart(2, '0')}:00Z` })

test('partirPuntos: hasta 100 puntos van en un solo trozo', () => {
  const puntos = Array.from({ length: 100 }, (_, i) => pt(i))
  assert.equal(partirPuntos(puntos).length, 1)
})

test('partirPuntos: más de 100 se parten compartiendo el punto de unión', () => {
  const puntos = Array.from({ length: 250 }, (_, i) => pt(i))
  const trozos = partirPuntos(puntos, 100, 1)
  assert.equal(trozos.length, 3)
  assert.equal(trozos[0].length, 100)
  assert.equal(trozos[1][0], trozos[0].at(-1))
  assert.equal(trozos[2].at(-1), puntos.at(-1))
  // Ningún punto se pierde: 100 + 100 + 52, menos los dos compartidos.
  assert.equal(trozos.reduce((n, t) => n + t.length, 0) - 2, 250)
})

test('unirTrazos: no repite el punto donde dos trazos se tocan', () => {
  const a = [[-71.4, 10], [-71.41, 10.01]]
  const b = [[-71.41, 10.01], [-71.42, 10.02]]
  assert.deepEqual(unirTrazos([a, b]), [[-71.4, 10], [-71.41, 10.01], [-71.42, 10.02]])
})

test('aplicarEmparejado: mueve cada punto a la calle y conserva su hora', () => {
  const puntos = [pt(0), pt(1), pt(2)]
  const respuesta = {
    code: 'Ok',
    matchings: [{ confidence: 0.9, geometry: { coordinates: [[-71.4001, 10.0001], [-71.4002, 10.0012], [-71.4003, 10.0021]] } }],
    tracepoints: [{ location: [-71.4001, 10.0001] }, null, { location: [-71.4003, 10.0021] }],
  }
  const r = aplicarEmparejado(puntos, respuesta)
  assert.equal(r.puntos.length, 3)
  assert.equal(r.puntos[0].lng, -71.4001)
  assert.equal(r.puntos[0].hora, puntos[0].hora)
  assert.deepEqual(r.puntos[0].crudo, { lat: puntos[0].lat, lng: puntos[0].lng })
  // El punto sin coincidencia se queda donde estaba.
  assert.equal(r.puntos[1].lat, puntos[1].lat)
  // Los extremos del trazo llegan al punto real del GPS (donde están los pines).
  assert.deepEqual(r.trazo[0], [puntos[0].lng, puntos[0].lat])
  assert.deepEqual(r.trazo.at(-1), [puntos[2].lng, puntos[2].lat])
})

test('aplicarEmparejado: une el final por calle con el sitio donde se estacionó', () => {
  // El carro termina 60 m al norte de la calle, dentro de un estacionamiento.
  const puntos = [{ lat: 10, lng: -71.4, hora: 'a' }, { lat: 10.0026, lng: -71.4, hora: 'b' }]
  const respuesta = {
    code: 'Ok',
    matchings: [{ confidence: 0.5, geometry: { coordinates: [[-71.4, 10], [-71.4, 10.002]] } }],
    tracepoints: [{ location: [-71.4, 10] }, null],
  }
  const r = aplicarEmparejado(puntos, respuesta)
  assert.equal(r.trazo.length, 3)
  assert.deepEqual(r.trazo.at(-1), [-71.4, 10.0026])
  // El inicio ya estaba en la calle: no se repite.
  assert.deepEqual(r.trazo[0], [-71.4, 10])
})

test('marcasDeTiempo: segundos de cada punto, o null si falta una hora o van al revés', () => {
  const a = { hora: '2026-10-14T08:00:00Z' }
  const b = { hora: '2026-10-14T08:01:00Z' }
  assert.deepEqual(marcasDeTiempo([a, b]), [Date.parse(a.hora) / 1000, Date.parse(b.hora) / 1000])
  assert.equal(marcasDeTiempo([b, a]), null)
  assert.equal(marcasDeTiempo([a, { hora: null }]), null)
})

test('aplicarEmparejado: sin coincidencia devuelve null, y la confianza baja no estorba', () => {
  assert.equal(aplicarEmparejado([pt(0), pt(1)], { code: 'NoMatch', matchings: [] }), null)
  const r = aplicarEmparejado([pt(0), pt(1)], { code: 'Ok', matchings: [{ confidence: 0, geometry: { coordinates: [[-71.4, 10], [-71.4, 10.001]] } }], tracepoints: [] })
  assert.equal(r.trazo.length, 2)
})

test('aplicarEmparejado: un trazo mucho más largo que el camino crudo se descarta', () => {
  // Dos puntos a ~111 m; Mapbox «devuelve» una vuelta de varios kilómetros.
  const vuelta = [[-71.4, 10], [-71.45, 10], [-71.45, 10.05], [-71.4, 10.001]]
  assert.equal(aplicarEmparejado([pt(0), pt(1)], { code: 'Ok', matchings: [{ confidence: 0.9, geometry: { coordinates: vuelta } }], tracepoints: [] }), null)
})

test('tramosDeRuta: junta los segmentos seguidos con el mismo tráfico', () => {
  const coords = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]
  const tramos = tramosDeRuta(coords, ['low', 'low', 'heavy', 'low'])
  assert.equal(tramos.length, 3)
  assert.deepEqual(tramos[0], { congestion: 'low', coords: [[0, 0], [1, 0], [2, 0]] })
  assert.deepEqual(tramos[1], { congestion: 'heavy', coords: [[2, 0], [3, 0]] })
  assert.equal(tramos[2].congestion, 'low')
})

test('tramosDeRuta: sin anotación de tráfico todo es «unknown»', () => {
  const tramos = tramosDeRuta([[0, 0], [1, 0], [2, 0]])
  assert.equal(tramos.length, 1)
  assert.equal(tramos[0].congestion, 'unknown')
})
