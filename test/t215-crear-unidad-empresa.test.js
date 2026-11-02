import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { build } from 'vite'
import { cuerpoUnidad, mensajeCrearUnidad, validarUnidad } from '../src/panel/datos/unidadEnEmpresa.js'
import { equiposParaNuevaUnidad, mensajeInstalarGps } from '../src/panel/datos/instalarGps.js'

// ============================================================
// T-215 · El administrador FOM crea la unidad en cualquier empresa sin entrar a ella
// ------------------------------------------------------------
// Antes, para asignar un GPS a una empresa sin unidades había que «entrar» a esa empresa a crear
// la unidad. Ahora la unidad se crea por `/tenants/{id}/vehicles` y el equipo se instala por
// `/tenants/{id}/gps-devices/{equipo}/installation`, con el panel parado en la empresa propia.
// ============================================================

const FOM = 'fom-0000'
const OTRA = 'otra-1111'
const buena = { numero: 'Unidad 27', placa: 'A12BC3D', marca: 'Toyota', modelo: 'Hilux', anio: '', tipo: 'camioneta' }

test('validar: número, placa, marca y modelo son obligatorios; lo demás, opcional', () => {
  assert.deepEqual(validarUnidad(buena), {})
  const vacio = validarUnidad({})
  assert.deepEqual(Object.keys(vacio).sort(), ['marca', 'modelo', 'numero', 'placa'])
  assert.match(vacio.numero, /número o código/u)
  assert.deepEqual(Object.keys(validarUnidad({ ...buena, numero: '   ' })), ['numero'])
})

test('validar: respeta los topes del servidor y el rango del año', () => {
  assert.match(validarUnidad({ ...buena, numero: 'x'.repeat(31) }).numero, /Máximo 30/u)
  assert.match(validarUnidad({ ...buena, placa: 'x'.repeat(21) }).placa, /Máximo 20/u)
  assert.match(validarUnidad({ ...buena, anio: '1900' }).anio, /1950 y 2100/u)
  assert.match(validarUnidad({ ...buena, anio: '20x6' }).anio, /1950 y 2100/u)
  assert.deepEqual(validarUnidad({ ...buena, anio: '2026' }), {})
})

test('cuerpo: código sin espacios y en minúsculas, y el año solo si se escribió', () => {
  const c = cuerpoUnidad({ ...buena, numero: '  Unidad 27 ' })
  assert.equal(c.code, 'unidad-27')
  assert.equal(c.alias, 'Unidad 27')
  assert.equal(c.fleetNumber, 'Unidad 27')
  assert.equal(c.plate, 'A12BC3D')
  assert.equal(c.modelYear, undefined)
  assert.equal(cuerpoUnidad({ ...buena, anio: '2024' }).modelYear, 2024)
})

test('mensajes de crear la unidad, en llano', () => {
  assert.match(mensajeCrearUnidad({ estado: 409 }), /ya tiene una unidad con ese número o esa placa/u)
  assert.match(mensajeCrearUnidad({ estado: 403 }), /No tienes permiso/u)
  assert.match(mensajeCrearUnidad({ estado: 501 }), /todavía no permite crear unidades/u)
  assert.equal(mensajeCrearUnidad(new Error('Algo raro')), 'Algo raro')
})

test('equipos libres con el inventario global: se ofrecen de cualquier empresa', () => {
  const eq = (id, extra = {}) => ({ id, imei: `86${id}`, modelo: 'GPS103', estado: 'inventory', vehiculoId: null, empresaId: null, verificado: true, ...extra })
  const lista = [eq('libre'), eq('de-fom', { empresaId: FOM }), eq('de-otra', { empresaId: OTRA }), eq('puesto', { vehiculoId: 'v1' })]
  assert.deepEqual(equiposParaNuevaUnidad(lista, { destino: OTRA, propia: FOM, global: true }).map((g) => g.id).sort(), ['de-fom', 'de-otra', 'libre'])
  // Sin `global` se conserva lo de T-214 (dentro de una empresa, solo los de esa empresa).
  assert.deepEqual(equiposParaNuevaUnidad(lista, { destino: OTRA, propia: FOM }).map((g) => g.id), ['de-otra'])
})

test('si el servidor publicado rechaza instalar en otra empresa, lo dice en llano', () => {
  const m = mensajeInstalarGps({ estado: 404 }, { otraEmpresa: true, nombrePropia: 'FOM Operations' })
  assert.match(m, /no aceptó instalar este equipo en una unidad de otra empresa/u)
  assert.match(m, /inventario global/u)
})

// --- Contra un servidor FALSO (se sustituye `fetch`) -----------------------------------------

const raiz = join(import.meta.dirname, '..')

async function modulos() {
  const salida = await build({
    root: raiz,
    logLevel: 'error',
    define: { 'import.meta.env.VITE_FOM_API': JSON.stringify('http://servidor-falso.invalid') },
    plugins: [{
      name: 't215-entrada',
      enforce: 'pre',
      resolveId: (id) => (id.endsWith('virtual:t215') ? '\0t215' : null),
      load: (id) => (id === '\0t215'
        ? [
          `export { repoApi } from ${JSON.stringify(join(raiz, 'src/panel/datos/repoApi.js'))}`,
          `export { fijarEmpresaGestion } from ${JSON.stringify(join(raiz, 'src/panel/datos/api.js'))}`,
          `export { crearUnidadEnEmpresa } from ${JSON.stringify(join(raiz, 'src/panel/datos/unidadEnEmpresaApi.js'))}`,
        ].join('\n')
        : null),
    }],
    build: { write: false, minify: false, lib: { entry: 'virtual:t215', formats: ['es'], fileName: 't215' } },
  })
  return import('data:text/javascript;base64,' + Buffer.from(`${salida[0].output[0].code}\n// ${Math.random()}`).toString('base64'))
}

const respuesta = (cuerpo, estado = 200) => ({
  ok: estado < 400,
  status: estado,
  headers: { get: () => 'application/json' },
  text: async () => JSON.stringify(cuerpo),
  json: async () => cuerpo,
})

function servidorFalso({ crear = () => respuesta({ vehicleId: 'v-nueva' }), instalar = () => respuesta({ ok: true }), equipos = [] } = {}) {
  const llamadas = []
  const fetch = async (direccion, opciones = {}) => {
    const ruta = new URL(direccion).pathname.replace('/api/v1/console', '')
    const metodo = opciones.method ?? 'GET'
    llamadas.push({ metodo, ruta, cuerpo: opciones.body ? JSON.parse(opciones.body) : null })
    if (metodo === 'GET' && ruta === '/gps-devices') return respuesta({ devices: equipos })
    if (metodo === 'POST' && /\/vehicles$/u.test(ruta)) return crear()
    if (metodo === 'POST' && /\/installation$/u.test(ruta)) return instalar()
    throw new Error(`Ruta no prevista en la prueba: ${metodo} ${ruta}`)
  }
  return { fetch, llamadas }
}

async function conServidor(t, opciones) {
  const servidor = servidorFalso(opciones)
  const original = globalThis.fetch
  globalThis.fetch = servidor.fetch
  t.after(() => { globalThis.fetch = original })
  const modulo = await modulos()
  t.after(() => modulo.fijarEmpresaGestion(null))
  return { servidor, ...modulo }
}

const posts = (servidor) => servidor.llamadas.filter((l) => l.metodo === 'POST').map((l) => l.ruta)

test('crear en otra empresa va por /tenants/{id}/vehicles, sin fijar esa empresa', async (t) => {
  const { crearUnidadEnEmpresa, servidor } = await conServidor(t)
  const r = await crearUnidadEnEmpresa({ empresaId: OTRA, propia: FOM, datos: buena })
  assert.equal(r.id, 'v-nueva')
  assert.deepEqual(posts(servidor), [`/tenants/${OTRA}/vehicles`])
  const cuerpo = servidor.llamadas.find((l) => l.metodo === 'POST').cuerpo
  assert.equal(cuerpo.code, 'unidad-27')
  assert.equal(cuerpo.make, 'Toyota')
})

test('crear en la empresa propia va por la ruta propia, aunque se esté dentro de otra', async (t) => {
  const { crearUnidadEnEmpresa, servidor, fijarEmpresaGestion } = await conServidor(t)
  fijarEmpresaGestion(OTRA)
  await crearUnidadEnEmpresa({ empresaId: FOM, propia: FOM, datos: buena })
  assert.deepEqual(posts(servidor), ['/vehicles'])
})

test('crear e instalar: la unidad y el equipo van por la ruta de la empresa elegida', async (t) => {
  const { crearUnidadEnEmpresa, repoApi, servidor } = await conServidor(t)
  const { id } = await crearUnidadEnEmpresa({ empresaId: OTRA, propia: FOM, datos: buena })
  await repoApi.gpsEscritura.instalar('gps-1', { vehiculoId: id, empresaId: OTRA, nombrePropia: 'FOM' })
  assert.deepEqual(posts(servidor), [`/tenants/${OTRA}/vehicles`, `/tenants/${OTRA}/gps-devices/gps-1/installation`])
  assert.equal(servidor.llamadas.at(-1).cuerpo.vehicleId, 'v-nueva')
})

test('si el servidor rechaza el alta, el error sale en llano y con su estado', async (t) => {
  const { crearUnidadEnEmpresa } = await conServidor(t, { crear: () => respuesta({ message: 'duplicate' }, 409) })
  await assert.rejects(crearUnidadEnEmpresa({ empresaId: OTRA, propia: FOM, datos: buena }), (e) => e.estado === 409 && /ya tiene una unidad/u.test(e.message))
})

test('si el servidor no devuelve el id de la unidad, avisa de no reintentar a ciegas', async (t) => {
  const { crearUnidadEnEmpresa } = await conServidor(t, { crear: () => respuesta({}) })
  await assert.rejects(crearUnidadEnEmpresa({ empresaId: OTRA, propia: FOM, datos: buena }), /Revisa la flota de la empresa antes de reintentar/u)
})

test('instalar en otra empresa rechazado por el servidor: mensaje claro', async (t) => {
  const { repoApi } = await conServidor(t, { instalar: () => respuesta({ message: 'Not found' }, 404) })
  await assert.rejects(
    repoApi.gpsEscritura.instalar('gps-1', { vehiculoId: 'v', empresaId: OTRA, nombrePropia: 'FOM' }),
    /no aceptó instalar este equipo en una unidad de otra empresa/u,
  )
})

test('disponibles({ global }) ofrece los equipos libres sin filtrar por empresa', async (t) => {
  const crudo = (id, extra = {}) => ({ id, imei: `86${id}`, model: 'GPS103', protocolFamily: 'coban-gps103', status: 'inventory', connected: true, lastConnectionAt: new Date().toISOString(), vehicleId: null, ...extra })
  const { repoApi } = await conServidor(t, { equipos: [crudo('1', { tenantId: OTRA }), crudo('2'), crudo('3', { vehicleId: 'v9' })] })
  assert.deepEqual((await repoApi.gpsEscritura.disponibles({ global: true })).map((g) => g.id).sort(), ['1', '2'])
})
