import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { build } from 'vite'
import { leerTodasLasPaginas, listarTodasOdts } from '../src/panel/datos/listar-odts.js'

// ============================================================
// Empresas grandes (T-83): 340 unidades, ~3.000 ODT
// ------------------------------------------------------------
// 1) El lector de páginas: pide todas, en tandas, con tope y corte.
// 2) El repositorio real contra un servidor FALSO (se sustituye `fetch`;
//    nada sale de la máquina): flota y conductores completos, conductores
//    guardados entre refrescos, «faltan hoy» con el día entero y órdenes
//    leídas solo hasta donde hacen falta.
// ============================================================

/** Un servidor paginado como fom-core: `limit` máx. 200, `offset` y `page.total`. */
function paginado(lista, { limite: maximo = 200, conTotal = true } = {}) {
  const llamadas = []
  const pedir = async (desplazamiento, limite) => {
    llamadas.push(desplazamiento)
    const n = Math.min(limite, maximo)
    return { items: lista.slice(desplazamiento, desplazamiento + n), ...(conTotal ? { page: { total: lista.length } } : {}) }
  }
  return { pedir, llamadas }
}
const filas = (n, prefijo = 'x') => Array.from({ length: n }, (_, i) => ({ id: `${prefijo}${i}` }))

test('lee todas las páginas: la primera dice el total y las demás van a la vez', async () => {
  const s = paginado(filas(950))
  const r = await leerTodasLasPaginas(s.pedir, { enParalelo: 10 })
  assert.equal(r.items.length, 950)
  assert.equal(r.incompleta, false)
  assert.deepEqual(s.llamadas, [0, 200, 400, 600, 800])
})

test('si el servidor entrega menos que el límite pedido, avanza con lo que entrega', async () => {
  const s = paginado(filas(250), { limite: 100 })
  const r = await leerTodasLasPaginas(s.pedir)
  assert.equal(r.items.length, 250)
  assert.deepEqual(s.llamadas, [0, 100, 200])
})

test('sin total sigue página a página hasta una más corta', async () => {
  const s = paginado(filas(450), { conTotal: false })
  const r = await leerTodasLasPaginas(s.pedir)
  assert.equal(r.items.length, 450)
  assert.deepEqual(s.llamadas, [0, 200, 400])
})

test('al agotar el tope de páginas la lista sale marcada como incompleta', async () => {
  const s = paginado(filas(1000))
  const r = await leerTodasLasPaginas(s.pedir, { tope: 3 })
  assert.equal(r.items.length, 600)
  assert.equal(r.incompleta, true)
})

test('`parar` corta en cuanto la página ya no sirve, sin pedir el resto', async () => {
  const s = paginado(filas(3000))
  const r = await leerTodasLasPaginas(s.pedir, { parar: (pagina) => Number(pagina.at(-1).id.slice(1)) >= 350 })
  assert.deepEqual(s.llamadas, [0, 200])
  assert.equal(r.items.length, 400)
})

test('listarTodasOdts conserva los filtros (unidad incluida) en cada página', async () => {
  const pedidos = []
  const api = { odts: async (p) => { pedidos.push(p); return { items: filas(p.desplazamiento === 0 ? 200 : 50, 'o').map((o) => ({ id: `${p.desplazamiento}-${o.id}` })), page: { total: 250 } } } }
  const lista = await listarTodasOdts(api, { estado: '', vehiculoId: 'v-7' })
  assert.equal(lista.length, 250)
  assert.deepEqual(pedidos.map((p) => [p.vehiculoId, p.desplazamiento, p.limite]), [['v-7', 0, 200], ['v-7', 200, 200]])
})

// --- El repositorio real contra un servidor falso ------------------------------

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')
const hoyLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function servidorFalso() {
  const hoy = hoyLocal()
  const ayer = hoyLocal(new Date(Date.now() - 86400000))
  const vehiculos = Array.from({ length: 340 }, (_, i) => ({
    id: `v${String(i).padStart(3, '0')}`, alias: `U-${String(i).padStart(3, '0')}`, plate: `P${i}`,
    latitude: 10 + i / 1000, longitude: -71, lastReportAt: new Date().toISOString(),
  }))
  // 260 asignaciones: las de las últimas unidades caen en la segunda página.
  const asignaciones = vehiculos.slice(80).map((v, i) => ({ assignmentId: `a${i}`, userId: `u${i}`, displayName: `Conductor ${i}`, role: 'principal', vehicleId: v.id }))
  // 3.000 órdenes, de la más nueva a la más vieja: 5 de hoy y el resto de días atrás.
  const odts = Array.from({ length: 3000 }, (_, i) => ({
    id: `o${i}`, status: 'abierta', vehicleId: vehiculos[i % 340].id,
    createdAt: new Date(i < 5 ? Date.now() - i * 1000 : new Date(`${hoy}T00:00:00`).getTime() - i * 3600_000).toISOString(),
  }))
  // 250 inspecciones de hoy (más de las 100 de antes) y 400 de ayer.
  const inspecciones = [
    ...vehiculos.slice(0, 250).map((v, i) => ({ id: `i${i}`, vehicleId: v.id, inspectionDate: hoy, result: 'aprobada' })),
    ...Array.from({ length: 400 }, (_, i) => ({ id: `j${i}`, vehicleId: vehiculos[i % 340].id, inspectionDate: ayer, result: 'aprobada' })),
  ]
  const llamadas = []
  const responder = (cuerpo) => ({ ok: true, status: 200, text: async () => JSON.stringify(cuerpo) })
  const pagina = (lista, url) => {
    const limite = Math.min(Number(url.searchParams.get('limit') ?? 100), 200)
    const desde = Number(url.searchParams.get('offset') ?? 0)
    return responder({ items: lista.slice(desde, desde + limite), page: { total: lista.length, limit: limite, offset: desde } })
  }
  const fetch = async (direccion, opciones = {}) => {
    const url = new URL(direccion)
    const ruta = url.pathname.replace('/api/v1/console', '')
    llamadas.push({ metodo: opciones.method ?? 'GET', ruta, url })
    if ((opciones.method ?? 'GET') !== 'GET') return responder({})
    if (ruta === '/vehicles') return pagina(vehiculos, url)
    if (ruta === '/gps-devices') return responder({ devices: [] })
    if (ruta === '/drivers') return pagina(asignaciones, url)
    if (ruta === '/work-orders') {
      const v = url.searchParams.get('vehicleId')
      return pagina(v ? odts.filter((o) => o.vehicleId === v) : odts, url)
    }
    if (ruta === '/inspections') return pagina(inspecciones, url)
    throw new Error(`Ruta no prevista en la prueba: ${ruta}`)
  }
  return { fetch, llamadas, cuantas: (ruta) => llamadas.filter((l) => l.ruta === ruta && l.metodo === 'GET').length }
}

async function repositorioReal() {
  const salida = await build({
    root: raiz,
    logLevel: 'error',
    // Una dirección que no existe: `fetch` se sustituye y nunca sale nada a la red.
    define: { 'import.meta.env.VITE_FOM_API': JSON.stringify('http://servidor-falso.invalid') },
    build: {
      write: false,
      minify: false,
      lib: { entry: join(raiz, 'src/panel/datos/repoApi.js'), formats: ['es'], fileName: 'repoApi' },
    },
  })
  const codigo = salida[0].output[0].code
  return import('data:text/javascript;base64,' + Buffer.from(`${codigo}\n// ${Math.random()}`).toString('base64'))
}

test('repositorio real: flota, conductores, «faltan hoy» y órdenes con una empresa de 340 unidades', async (t) => {
  const servidor = servidorFalso()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = servidor.fetch
  t.after(() => { globalThis.fetch = fetchOriginal })
  const { repoApi, asignacionesVigentes } = await repositorioReal()
  assert.equal(typeof asignacionesVigentes, 'function')

  // Toda la flota y todos los conductores, no solo los primeros 200.
  const flota = await repoApi.vehiculos.listar({})
  assert.equal(flota.length, 340)
  assert.equal(flota.incompleta, undefined)
  assert.equal(flota.find((v) => v.id === 'v339').conductorNombre, 'Conductor 259')
  assert.equal(servidor.cuantas('/vehicles'), 2)
  assert.equal(servidor.cuantas('/drivers'), 2)

  // Lo siguiente que pide conductores no vuelve al servidor (guardados 5 min)...
  const conductores = await repoApi.conductores()
  assert.equal(conductores.length, 260)
  assert.equal(servidor.cuantas('/drivers'), 2)
  // ...pero tras cualquier escritura sí: pudo cambiar una asignación.
  await repoApi.vehiculosEscritura.asignarArea('v000', null)
  await repoApi.conductores()
  assert.equal(servidor.cuantas('/drivers'), 4)

  // «Faltan hoy» con el día entero: 250 hechas hoy, faltan 90.
  const faltan = await repoApi.inspecciones.pendientesHoy()
  assert.equal(faltan.length, 90)

  // Resumen: solo las órdenes de hoy, sin bajar las 3.000.
  const antes = servidor.cuantas('/work-orders')
  const deHoy = await repoApi.odts.listar({ desde: hoyLocal() })
  assert.equal(deHoy.length, 5)
  assert.equal(servidor.cuantas('/work-orders') - antes, 1)

  // Ficha de la unidad: el filtro viaja al servidor.
  const deUnidad = await repoApi.odts.listar({ vehiculoId: 'v001' })
  assert.ok(deUnidad.length > 0 && deUnidad.every((o) => o.vehiculoId === 'v001'))
  assert.equal(servidor.llamadas.filter((l) => l.ruta === '/work-orders').at(-1).url.searchParams.get('vehicleId'), 'v001')
})

test('repositorio compartido rechaza lectura fallida y recupera recepción Meitrack sin posición al reintentar', async (t) => {
  const original = globalThis.fetch
  const llamadas = []
  const ahora = Date.now()
  const recibido = new Date(ahora - 30000).toISOString()
  let falloInventario = true
  globalThis.fetch = async (direccion, opciones = {}) => {
    const ruta = new URL(direccion).pathname.replace('/api/v1/console', '')
    llamadas.push({ ruta, metodo: opciones.method ?? 'GET' })
    let cuerpo
    if (ruta === '/vehicles') cuerpo = { items: [{ id: 'meitrack', alias: 'Unidad sin punto', lastReportAt: null }, { id: 'sin-gps', alias: 'Sin GPS' }], page: { total: 2, limit: 200, offset: 0 } }
    else if (ruta === '/gps-devices') {
      if (falloInventario) {
        falloInventario = false
        return { ok: false, status: 503, text: async () => JSON.stringify({ message: 'private failure' }) }
      }
      cuerpo = { devices: [{ id: 'equipo', vehicleId: 'meitrack', installationId: 'instalacion', protocolFamily: 'meitrack-t399', installedAt: new Date(ahora - 86400000).toISOString(), lastConnectionAt: recibido }] }
    }
    else if (ruta === '/drivers') cuerpo = { items: [], page: { total: 0, limit: 200, offset: 0 } }
    else if (ruta.endsWith('/position/latest')) cuerpo = { position: null }
    else throw Error('Ruta no prevista: ' + ruta)
    return { ok: true, status: 200, text: async () => JSON.stringify(cuerpo) }
  }
  t.after(() => { globalThis.fetch = original })
  const { repoApi } = await repositorioReal()
  await assert.rejects(repoApi.vehiculos.listar({}), /No se pudo comprobar la recepción GPS/)
  const [a, b] = await Promise.all([repoApi.vehiculos.listar({}), repoApi.vehiculos.listar({})])
  const conGps = a.find(v => v.id === 'meitrack')
  const sinGps = a.find(v => v.id === 'sin-gps')
  assert.equal(conGps.conectado, true)
  assert.equal(conGps.ultimoReporte, recibido)
  assert.equal(conGps.soloRecepcion, true)
  assert.equal(conGps.lat, null); assert.equal(conGps.lng, null)
  assert.equal(conGps.velocidadKmh, null); assert.equal(conGps.estadoMarcha, null)
  assert.equal(sinGps.conectado, false); assert.equal(sinGps.ultimoReporte, null)
  assert.deepEqual(a, b)
  assert.equal(llamadas.filter(l => l.ruta === '/gps-devices').length, 2)
  assert.ok(llamadas.every(l => l.metodo === 'GET'))
})
