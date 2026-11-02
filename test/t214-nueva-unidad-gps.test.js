import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { build } from 'vite'
import { equiposParaNuevaUnidad } from '../src/panel/datos/instalarGps.js'

// ============================================================
// T-214 · «Nueva unidad» ofrece los GPS libres del inventario real
// ------------------------------------------------------------
// Antes `admin.gps.disponibles()` era un aviso que siempre rechazaba y el modal decía «No hay
// GPS verificados libres» aunque hubiera un Coban en el inventario.
// ============================================================

const FOM = 'fom-0000'
const OTRA = 'otra-1111'
const hace = (min) => new Date(Date.now() - min * 60_000).toISOString()
const equipo = (id, extra = {}) => ({ id, imei: `86${id}`, modelo: 'GPS103', estado: 'inventory', vehiculoId: null, empresaId: FOM, verificado: true, ultimaConexion: hace(60), ...extra })

test('solo los libres: sin unidad, y ni inactivos ni archivados', () => {
  const lista = equiposParaNuevaUnidad([
    equipo('a'),
    equipo('instalado', { vehiculoId: 'v1' }),
    equipo('inactivo', { estado: 'inactive' }),
    equipo('archivado', { estado: 'archived' }),
    equipo('activo', { estado: 'active' }),
  ], { destino: FOM, propia: FOM })
  assert.deepEqual(lista.map((g) => g.id).sort(), ['a', 'activo'])
})

test('el que nunca reportó no se esconde: sale al final, marcado «sin señal todavía»', () => {
  const lista = equiposParaNuevaUnidad([
    equipo('nuevo', { verificado: false, ultimaConexion: null }),
    equipo('viejo', { ultimaConexion: hace(600) }),
    equipo('reciente', { ultimaConexion: hace(5) }),
  ], { destino: FOM, propia: FOM })
  assert.deepEqual(lista.map((g) => g.id), ['reciente', 'viejo', 'nuevo'])
  assert.equal(lista[2].sinSenal, true)
  assert.match(lista[2].modelo, /sin señal todavía/u)
  assert.equal(lista[0].sinSenal, false)
  assert.equal(lista[0].modelo, 'GPS103')
})

test('dentro de otra empresa: solo los equipos de esa empresa (el servidor no cruza empresas)', () => {
  const equipos = [equipo('propio'), equipo('sin-empresa', { empresaId: null }), equipo('de-otra', { empresaId: OTRA })]
  assert.deepEqual(equiposParaNuevaUnidad(equipos, { destino: OTRA, propia: FOM }).map((g) => g.id), ['de-otra'])
  // En la propia, el equipo sin empresa es del inventario propio.
  assert.deepEqual(equiposParaNuevaUnidad(equipos, { destino: null, propia: FOM }).map((g) => g.id).sort(), ['propio', 'sin-empresa'])
})

test('sin lista o con lista vacía no revienta', () => {
  assert.deepEqual(equiposParaNuevaUnidad(undefined), [])
  assert.deepEqual(equiposParaNuevaUnidad([], { destino: FOM, propia: FOM }), [])
})

// --- El repositorio real contra un servidor FALSO (se sustituye `fetch`) ---------------------

const raiz = join(import.meta.dirname, '..')

async function repositorioReal() {
  const salida = await build({
    root: raiz,
    logLevel: 'error',
    define: { 'import.meta.env.VITE_FOM_API': JSON.stringify('http://servidor-falso.invalid') },
    plugins: [{
      name: 't214-entrada',
      enforce: 'pre',
      // La entrada de la biblioteca llega como ruta absoluta que termina en el nombre virtual.
      resolveId: (id) => (id.endsWith('virtual:t214') ? '\0t214' : null),
      // El repositorio y la llave que fija la empresa «dentro» de la que se trabaja.
      load: (id) => (id === '\0t214'
        ? `export { repoApi } from ${JSON.stringify(join(raiz, 'src/panel/datos/repoApi.js'))}\nexport { fijarEmpresaGestion } from ${JSON.stringify(join(raiz, 'src/panel/datos/api.js'))}`
        : null),
    }],
    build: { write: false, minify: false, lib: { entry: 'virtual:t214', formats: ['es'], fileName: 't214' } },
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

function servidorFalso({ equipos = [], fallaLista = false } = {}) {
  const llamadas = []
  const fetch = async (direccion, opciones = {}) => {
    const url = new URL(direccion)
    const ruta = url.pathname.replace('/api/v1/console', '')
    const metodo = opciones.method ?? 'GET'
    llamadas.push({ metodo, ruta })
    if (metodo === 'GET' && ruta === '/gps-devices') return fallaLista ? respuesta({ error: 'x' }, 500) : respuesta({ devices: equipos })
    if (metodo === 'POST' && /\/vehicles$/u.test(ruta)) return respuesta({ vehicleId: 'v-nueva' })
    if (metodo === 'POST' && /\/installation$/u.test(ruta)) return respuesta({ ok: true })
    throw new Error(`Ruta no prevista en la prueba: ${metodo} ${ruta}`)
  }
  return { fetch, llamadas }
}

// El servidor habla en inglés: así llegan los equipos antes de pasar por `comoEquipoGps`.
const crudo = (id, extra = {}) => ({ id, imei: `86${id}`, model: 'GPS103', protocolFamily: 'coban-gps103', status: 'inventory', connected: false, lastConnectionAt: null, vehicleId: null, ...extra })

async function conServidor(t, opciones) {
  const servidor = servidorFalso(opciones)
  const original = globalThis.fetch
  globalThis.fetch = servidor.fetch
  t.after(() => { globalThis.fetch = original })
  const modulo = await repositorioReal()
  t.after(() => modulo.fijarEmpresaGestion(null))
  return { servidor, ...modulo }
}

test('disponibles() lee el inventario real: un Coban sin reportar sale ofrecido y marcado', async (t) => {
  const { repoApi } = await conServidor(t, { equipos: [crudo('1'), crudo('2', { vehicleId: 'v9' }), crudo('3', { status: 'archived' })] })
  const lista = await repoApi.gpsEscritura.disponibles()
  assert.deepEqual(lista.map((g) => g.id), ['1'])
  assert.equal(lista[0].verificado, false)
  assert.match(lista[0].modelo, /sin señal todavía/u)
})

test('disponibles() deja pasar el error de lectura: no se confunde con «no hay libres»', async (t) => {
  const { repoApi } = await conServidor(t, { fallaLista: true })
  await assert.rejects(repoApi.gpsEscritura.disponibles())
})

test('crear() instala por la ruta propia cuando no se ha entrado a otra empresa', async (t) => {
  const { repoApi, servidor } = await conServidor(t, { equipos: [crudo('1')] })
  await repoApi.vehiculosEscritura.crear({ placa: 'AB1', gpsId: '1' })
  assert.deepEqual(servidor.llamadas.filter((l) => l.metodo === 'POST').map((l) => l.ruta), ['/vehicles', '/gps-devices/1/installation'])
})

test('crear() dentro de otra empresa instala por la ruta de esa empresa', async (t) => {
  const { repoApi, servidor, fijarEmpresaGestion } = await conServidor(t, { equipos: [crudo('1', { tenantId: OTRA })] })
  fijarEmpresaGestion(OTRA)
  const lista = await repoApi.gpsEscritura.disponibles()
  assert.deepEqual(lista.map((g) => g.id), ['1'])
  await repoApi.vehiculosEscritura.crear({ placa: 'AB1', gpsId: '1' })
  assert.deepEqual(
    servidor.llamadas.filter((l) => l.metodo === 'POST').map((l) => l.ruta),
    [`/tenants/${OTRA}/vehicles`, `/tenants/${OTRA}/gps-devices/1/installation`],
  )
})
