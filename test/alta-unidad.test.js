import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'vite'
import { resolve } from 'node:path'
import { cuerpoNuevaUnidad, crearUnidad } from '../src/panel/datos/altaUnidad.js'

test('activo sin matrícula ni GPS: alias o número interno identifican, sin identidad inventada', () => {
  assert.equal(cuerpoNuevaUnidad({ alias: 'Manlift 01', tipo: 'otro' }).code, 'manlift-01')
  assert.equal(cuerpoNuevaUnidad({ numero: 'ML-01' }).code, 'ml-01')
  assert.equal(cuerpoNuevaUnidad({ placa: ' ABC123 ' }).plate, 'ABC123')
  assert.equal(cuerpoNuevaUnidad({ alias: 'Manlift' }).plate, undefined)
  assert.throws(() => cuerpoNuevaUnidad({ alias: ' ', numero: ' ', placa: '' }), /identificar/)
  assert.equal(cuerpoNuevaUnidad({ alias: 'x'.repeat(50) }).code.length, 50)
  assert.throws(() => cuerpoNuevaUnidad({ alias: 'x'.repeat(51) }), /50 caracteres/)
})

test('sin GPS no instala, ni con inventario vacío; área y GPS fallidos no ocultan el alta', async () => {
  const writes = []
  const api = {
    crearVehiculo: async (body) => { writes.push(['create', body]); return { vehicleId: 'v1' } },
    actualizarVehiculo: async () => { writes.push(['area']); throw Error('area') },
    instalarEquipoGps: async () => { writes.push(['install']); throw Error('install') },
  }
  assert.deepEqual(await crearUnidad({ alias: 'Manlift' }, api), { id: 'v1', pendientes: [] })
  assert.deepEqual(writes.map(x => x[0]), ['create'])
  writes.length = 0
  const result = await crearUnidad({ alias: 'Camión', gpsId: 'g1', areaId: 'a1' }, api)
  assert.equal(result.id, 'v1'); assert.equal(result.pendientes.length, 2)
  assert.deepEqual(writes.map(x => x[0]), ['create', 'area', 'install'])
})

test('error incierto al crear no dispara efectos posteriores ni reintenta', async () => {
  let creates = 0
  const api = { crearVehiculo: async () => { creates++; throw Error('network') }, instalarEquipoGps: () => assert.fail('install') }
  await assert.rejects(crearUnidad({ alias: 'Equipo', gpsId: 'g1' }, api), /network/)
  assert.equal(creates, 1)
})

test('instala el elegido una vez, sin commissioning ni instalación si falta ID', async () => {
  const calls = []
  const api = { crearVehiculo: async () => ({ vehicleId: 'v1' }), instalarEquipoGps: async (...args) => calls.push(args) }
  assert.deepEqual(await crearUnidad({ alias: 'Equipo', gpsId: 'm1' }, api), { id: 'v1', pendientes: [] })
  assert.deepEqual(calls, [['m1', { vehicleId: 'v1' }]])
  api.crearVehiculo = async () => ({})
  await assert.rejects(crearUnidad({ alias: 'Equipo', gpsId: 'm1' }, api), /identificador/)
  assert.equal(calls.length, 1)
})

test('repo HTTP real: inventario global neutral y alta sin GPS en empresa seleccionada', async (t) => {
  const entry = resolve('fixture767.js')
  const output = await build({ root: resolve('.'), logLevel: 'error', plugins: [{ name: 'fixture-767', resolveId(id) { if (id === entry) return entry }, load(id) { if (id === entry) return `export {default} from '${resolve('src/panel/datos/repo.js').replaceAll('\\','/')}'; export {fijarEmpresaGestion} from '${resolve('src/panel/datos/api.js').replaceAll('\\','/')}';` } }], define: { 'import.meta.env.VITE_FOM_API': JSON.stringify('http://synthetic.invalid') }, build: { write: false, minify: false, lib: { entry, formats: ['es'] } } })
  const code = output[0].output[0].code
  const previousFetch = globalThis.fetch, previousStorage = globalThis.localStorage
  const calls = []
  let failed = false
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: options.body && JSON.parse(options.body) })
    if (String(url).endsWith('/gps-devices')) return new Response(JSON.stringify(failed ? { message: 'denied' } : { devices: [
      { id: 'm', status: 'inventory', protocolFamily: 'meitrack-t399', model: 'T399L', connected: false },
      { id: 'c', status: 'inventory', protocolFamily: 'coban-gps103' },
      { id: 'installed', status: 'inventory', vehicleId: 'v' },
      { id: 'open', status: 'inventory', installationId: 'i' },
      ...['active','lost','maintenance','inactive','archived'].map(status => ({ id: status, status })),
    ] }), { status: failed ? 403 : 200, headers: { 'content-type': 'application/json' } })
    if (String(url).endsWith('/vehicles') && options.method === 'POST') return new Response(JSON.stringify({ vehicleId: 'synthetic-v' }), { status: 201 })
    throw Error('unexpected_http')
  }
  t.after(() => { globalThis.fetch = previousFetch; globalThis.localStorage = previousStorage })
  const { default: repo, fijarEmpresaGestion } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  // Dejar terminar el arranque de sesión sintética antes de elegir el ente.
  await new Promise(resolve => setImmediate(resolve))
  fijarEmpresaGestion('00000000-0000-4000-8000-000000000767')
  assert.deepEqual((await repo.admin.gps.disponibles()).map(g => g.id), ['m','c'])
  const r = await repo.vehiculos.crear({ alias: 'Manlift', tipo: 'otro' })
  assert.equal(r.id, 'synthetic-v')
  assert.equal(calls.filter(c => c.method === 'POST').length, 1)
  assert.equal(calls.at(-1).body.code, 'manlift')
  assert.equal(calls.at(-1).body.plate, undefined)
  assert.ok(calls.some(c => c.url.endsWith('/api/v1/console/gps-devices')))
  assert.ok(!calls.some(c => c.url.includes('/tenants/') && c.url.endsWith('/gps-devices')))
  assert.ok(calls.at(-1).url.endsWith('/api/v1/console/tenants/00000000-0000-4000-8000-000000000767/vehicles'))
  failed = true
  await assert.rejects(repo.admin.gps.disponibles())
})
