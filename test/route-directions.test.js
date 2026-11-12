import { test } from 'node:test'
import assert from 'node:assert/strict'
import { directionPoints, directionImage, mapboxDirections } from '../src/panel/comp/routeDirections.js'
const view = { width: 600, height: 400 }

test('chronological geometry determines east, west, north and south without upright flipping', () => {
  for (const [points, angle] of [
    [[{ x: 40, y: 50 }, { x: 500, y: 50 }], 0],
    [[{ x: 500, y: 50 }, { x: 40, y: 50 }], 180],
    [[{ x: 50, y: 350 }, { x: 50, y: 30 }], -90],
    [[{ x: 50, y: 30 }, { x: 50, y: 350 }], 90],
  ]) {
    const arrows = directionPoints(points, view)
    assert.ok(arrows.length >= 3)
    assert.ok(arrows.every(p => p.angle === angle))
  }
})
test('arrows remain spaced, bounded and in view even when zoom projects enormous offscreen segments', () => {
  const arrows = directionPoints([{ x: -1e8, y: 80 }, { x: 1e8, y: 80 }], view)
  assert.ok(arrows.length >= 4 && arrows.length <= 7)
  assert.ok(arrows.every(p => p.x >= 10 && p.x <= 590 && p.y === 80))
  for (let i = 1; i < arrows.length; i++) assert.equal(arrows[i].x - arrows[i - 1].x, 96)
})
test('turns, duplicated stationary readings and offscreen gaps do not invent a reverse direction', () => {
  const arrows = directionPoints([{ x: 30, y: 250 }, { x: 30, y: 250 }, { x: 320, y: 250 }, { x: 320, y: 40 }], view)
  assert.ok(arrows.some(p => p.angle === 0)); assert.ok(arrows.some(p => p.angle === -90))
  assert.ok(arrows.every(p => p.angle === 0 || p.angle === -90))
  assert.deepEqual(directionPoints([{ x: 30, y: 30 }, { x: 30, y: 30 }], view), [])
  assert.deepEqual(directionPoints([{ x: NaN, y: 30 }, { x: 50, y: 60 }], view), [])
  assert.equal(directionPoints([{ x: 30, y: 30 }, { x: 550, y: 30 }], { ...view, maximum: 2 }).length, 2)
})
test('native layer follows the same updated line source, preserves direction and removes its image before source cleanup', () => {
  const layers = new Map(), images = new Map(), changes = []
  const map = { addImage(id, data, options) { images.set(id, { data, options }) }, addLayer(layer) { layers.set(layer.id, layer) },
    getLayer: id => layers.get(id), setPaintProperty(...args) { changes.push(args) },
    removeLayer(id) { layers.delete(id) }, hasImage: id => images.has(id), removeImage(id) { images.delete(id) } }
  const control = mapboxDirections(map, 'synthetic-trip')
  const layer = layers.get('synthetic-trip-sentido')
  assert.equal(layer.source, 'synthetic-trip')
  assert.equal(layer.layout['symbol-placement'], 'line')
  assert.equal(layer.layout['icon-keep-upright'], false)
  assert.equal(layer.layout['icon-rotation-alignment'], 'map')
  assert.equal(images.get(layer.id).options.pixelRatio, 2)
  assert.equal(directionImage().data.length, 20 * 20 * 4)
  control.highlight(2); assert.equal(changes.length, 1)
  control.remove(); assert.equal(layers.size, 0); assert.equal(images.size, 0)
})
