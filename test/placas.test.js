import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placasEnRespuesta, placaMayuscula } from '../src/panel/datos/placas.js'
import { cuerpoNuevaUnidad } from '../src/panel/datos/altaUnidad.js'
import { build } from 'vite'
import { resolve } from 'node:path'

test('placas en mayúsculas en campos anidados, sin mutar respuesta original ni IDs/alias/números', () => {
  const original = { items: [{ id: 'abc-id', code: 'ab123cd', plate: 'AB123CD', alias: 'Manlift azul', fleetNumber: 'ml-01' }], nested: { vehiclePlate: 'abc123', vehicleCode: 'abc123', imei: '123' }, unidad: { unidadPlaca: 'xyz12' } }
  const view = placasEnRespuesta(original)
  assert.equal(view.items[0].code, 'AB123CD')
  assert.equal(view.nested.vehiclePlate, 'ABC123')
  assert.equal(view.nested.vehicleCode, 'ABC123')
  assert.equal(view.unidad.unidadPlaca, 'XYZ12')
  assert.equal(view.items[0].alias, 'Manlift azul')
  assert.equal(view.items[0].fleetNumber, 'ml-01')
  assert.equal(view.items[0].id, 'abc-id')
  assert.equal(original.items[0].code, 'ab123cd')
  assert.equal(original.nested.vehiclePlate, 'abc123')
})

test('placas ausentes y códigos distintos conservan su significado', () => {
  assert.deepEqual(placasEnRespuesta({ plate: null, code: 'manlift-01', vehiclePlate: '', vehicleCode: 'v001' }), { plate: null, code: 'manlift-01', vehiclePlate: '', vehicleCode: 'v001' })
  assert.deepEqual(placasEnRespuesta({ plate: 'abc123', code: 'interno-01' }), { plate: 'ABC123', code: 'interno-01' })
  assert.equal(placaMayuscula(undefined), undefined)
  assert.equal(placaMayuscula(null), null)
  assert.equal(placaMayuscula(''), '')
  assert.equal(cuerpoNuevaUnidad({ placa: ' aBc123 ' }).plate, 'ABC123')
  assert.equal(cuerpoNuevaUnidad({ alias: 'Manlift azul', numero: 'ml-01' }).plate, undefined)
})

test('HTTP común y mapper real muestran placa/rótulo en mayúsculas y PATCH envía placa en mayúsculas', async (t) => {
  const entry = resolve('fixture769.js')
  const output = await build({ logLevel: 'error', plugins: [{ name: 'fixture-769', resolveId(id) { if (id === entry) return entry }, load(id) { if (id === entry) return `export {repoApi} from '${resolve('src/panel/datos/repoApi.js').replaceAll('\\','/')}'; export {pedir} from '${resolve('src/panel/datos/api.js').replaceAll('\\','/')}';` } }], define: { 'import.meta.env.VITE_FOM_API': JSON.stringify('http://synthetic.invalid') }, build: { write: false, minify: false, lib: { entry, formats: ['es'] } } })
  const original = globalThis.fetch
  const writes = []
  globalThis.fetch = async (url, options) => {
    const method = options.method ?? 'GET'
    if (method === 'PATCH') { writes.push(JSON.parse(options.body)); return new Response('{}') }
    if (String(url).includes('/vehicles')) return new Response(JSON.stringify({ items: [{ id: 'v1', code: 'ab123cd', plate: 'ab123cd', status: 'active' }], page: { total: 1 } }))
    if (String(url).includes('/drivers')) return new Response(JSON.stringify({ items: [], page: { total: 0 } }))
    if (String(url).includes('/synthetic')) return new Response(JSON.stringify({ nested: { vehiclePlate: 'ef456gh', vehicleCode: 'ef456gh' } }))
    throw Error('nominal_network_disabled')
  }
  t.after(() => { globalThis.fetch = original })
  const { repoApi, pedir } = await import('data:text/javascript;base64,' + Buffer.from(output[0].output[0].code).toString('base64'))
  await new Promise(resolve => setImmediate(resolve))
  const [vehicle] = await repoApi.vehiculos.listar()
  assert.equal(vehicle.placa, 'AB123CD'); assert.equal(vehicle.alias, 'AB123CD'); assert.equal(vehicle.numero, 'AB123CD')
  assert.equal((await pedir('/synthetic')).nested.vehicleCode, 'EF456GH')
  await repoApi.vehiculosEscritura.set('v1', { placa: 'ef456gh' })
  assert.equal(writes[0].plate, 'EF456GH')
  assert.equal(writes.length, 1)
})
