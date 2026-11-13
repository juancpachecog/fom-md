import test from 'node:test'
import assert from 'node:assert/strict'
import { estadoUnidad } from '../src/panel/datos/estadoUnidad.js'
import { vehicleMarkerSvg, vehicleRotation, validPosition } from '../src/panel/comp/vehicleMarker.js'
import { firmaFlota } from '../src/panel/datos/firmaFlota.js'

test('el carro sigue los cuatro rumbos y la etiqueta queda fuera del grupo que gira', () => {
  for (const rumbo of [0, 90, 180, 270]) {
    const svg = vehicleMarkerSvg({ placa: 'PRUEBA', rumbo })
    const car = svg.slice(svg.indexOf('<g class="fleet-marker-vehicle"'))
    assert.ok(car.includes(`rotate(${rumbo} 26 40)`))
    assert.ok(!car.includes('<text'))
    assert.ok(svg.indexOf('fleet-marker-label') < svg.indexOf('fleet-marker-vehicle'))
  }
  assert.equal(vehicleRotation(90, 90), 0)
  assert.equal(vehicleRotation(0, 90), 270)
  assert.equal(vehicleRotation(270, -90), 0)
  for (const heading of [null, undefined, NaN, Infinity, '90']) assert.equal(vehicleRotation(heading, 45), null)
});

test('un cambio sólo de rumbo invalida la flota estable, incluido norte cero y ausencia', () => {
  const v = { id: 'synthetic', lat: 1, lng: 2, rumbo: null }
  assert.equal(firmaFlota([v]), firmaFlota([{ ...v }]))
  const firmas = [null, 0, 90, 180, 270].map(rumbo => firmaFlota([{ ...v, rumbo }]))
  assert.equal(new Set(firmas).size, 5)
});

test('GPS sin señal prevalece sobre la última velocidad y el encendido', () => {
  assert.equal(estadoUnidad({ conectado: false, ignition: true, velocidadKmh: 54 }).clave, 'sin_senal')
  assert.equal(estadoUnidad({ conectado: true }).clave, 'reportando')
  assert.equal(estadoUnidad({ conectado: true, velocidadKmh: 0 }).color, 'ambar')
  assert.equal(estadoUnidad({ conectado: true, velocidadKmh: 54 }).clave, 'en_marcha')
})

test('marcadores no ejecutan placas como HTML y no inventan rumbo', () => {
  const markup = vehicleMarkerSvg({ placa: '<script>x</script>', conectado: true })
  assert.ok(!markup.includes('<script>'))
  assert.ok(markup.includes('&lt;script&gt;'))
  assert.ok(!markup.includes('M26 4 L32 13'))
  const north = vehicleMarkerSvg({ placa: 'AB538RM', conectado: true, rumbo: 0 }, true)
  assert.ok(north.includes('M26 4 L32 13'))
  assert.ok(north.includes('rotate(0 26 40)'))
  assert.ok(north.includes('stroke="#168fff"'))
  assert.ok(vehicleMarkerSvg({ rumbo: -90 }).includes('rotate(270 26 40)'))
})

test('mapas aceptan coordenadas cero y rechazan coordenadas inválidas', () => {
  assert.equal(validPosition({ lat: 0, lng: 0 }), true)
  for (const v of [{ lat: null, lng: 0 }, { lat: NaN, lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }]) assert.equal(validPosition(v), false)
})
