import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectarParadas } from '../src/panel/datos/recorrido.js'
import { gruposDeParadas, detalleParadas } from '../src/panel/comp/paradasMapa.js'
const start = Date.parse('2026-01-01T12:00:00Z')
const point = (minute, lat) => ({ lat, lng: -71, hora: new Date(start + minute * 60000).toISOString() })

test('stops are numbered oldest first despite descending readings and chronological order stays attached in reverse panel order', () => {
  const points = [...Array.from({ length: 8 }, (_, i) => point(i, 10)),
    ...Array.from({ length: 8 }, (_, i) => point(i + 20, 10.02)),
    ...Array.from({ length: 8 }, (_, i) => point(i + 40, 10))].reverse()
  const { paradas } = detectarParadas(points)
  assert.deepEqual(paradas.map(p => p.numero), [1, 2, 3])
  assert.deepEqual([...paradas].sort((a, b) => Date.parse(b.desde) - Date.parse(a.desde)).map(p => p.numero), [3, 2, 1])
  const groups = gruposDeParadas(paradas)
  assert.deepEqual(groups.map(g => g.numeros), ['1·3', '2'])
  assert.equal(groups[0].paradas.length, 2)
  assert.ok(detalleParadas(groups[0]).includes('Parada 1'))
  assert.ok(detalleParadas(groups[0]).includes('Parada 3'))
  // A newly requested range has its own chronological numbering.
  assert.deepEqual(detectarParadas(points.filter(p => Date.parse(p.hora) >= start + 20 * 60000)).paradas.map(p => p.numero), [1, 2])
})
test('nearby visits retain individual numbers, times and duration without mutating the stop data', () => {
  const stops = [1, 2, 3].map((numero, i) => ({ numero, lat: 10 + i * 0.0001, lng: -71, minutos: i + 5,
    desde: point(i * 20, 10).hora, hasta: point(i * 20 + 5, 10).hora }))
  const copy = structuredClone(stops)
  const groups = gruposDeParadas([...stops].reverse())
  assert.equal(groups.length, 1)
  assert.equal(groups[0].numeros, '1·2·3')
  assert.equal(groups[0].texto, '3 paradas')
  assert.deepEqual(stops, copy)
  assert.deepEqual(groups[0].paradas.map(p => p.minutos), [5, 6, 7])
  assert.deepEqual(gruposDeParadas([]), [])
})
