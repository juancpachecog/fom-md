import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'vite'
import { coincideConPlaca, conflictoDeDependencias, dependenciasConfirmadas, dependenciasDeTransferencia, explicarAceptacion } from '../src/panel/datos/transferenciasVehiculos.js'

// ============================================================
// T-26: tres arreglos pequeños del panel
// ------------------------------------------------------------
// 1. Transferencias ya no culpa a una publicación pendiente ante un 403.
// 2. La lista de inspecciones no inventa ceros: el servidor no manda conteos.
// 3. Un GPS que nunca reportó se puede instalar desde la web.
// ============================================================

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')

/** El repositorio en modo CONECTADO, compilado con Vite como en acciones-del-panel. */
async function repositorioConectado() {
  const salida = await build({
    root: raiz,
    logLevel: 'error',
    define: { 'import.meta.env.VITE_FOM_API': JSON.stringify('/fom-api') },
    build: {
      write: false,
      lib: { entry: join(raiz, 'src/panel/datos/repo.js'), formats: ['es'], fileName: 'repo' },
    },
  })
  const codigo = salida[0].output[0].code
  const modulo = await import('data:text/javascript;base64,' + Buffer.from(codigo).toString('base64'))
  return modulo.repo
}

test('transferencias: el 403 se explica sin hablar de una publicación pendiente', () => {
  const fuente = readFileSync(join(raiz, 'src/panel/modulos/Transferencias.jsx'), 'utf8')
  assert.doesNotMatch(fuente, /lo publique|falta que Juan|no se ha publicado/u)
  assert.match(fuente, /negó el permiso para esta operación/u)
})

test('transferencias consultan la placa y las dependencias con el ente autorizado de la unidad', async (t) => {
  const repo = await repositorioConectado()
  const original = globalThis.fetch
  const llamadas = []
  globalThis.fetch = async (url, options) => {
    const ruta = String(url)
    llamadas.push(ruta)
    assert.equal(options.method, 'GET')
    if (ruta.endsWith('/tenants/origen/vehicles/u1/archive-preflight')) {
      return Response.json({ vehicleId: 'u1', blockers: { gpsInstallations: 1, driverAssignments: 1, workOrders: 5 } })
    }
    if (ruta.endsWith('/tenants/origen/vehicles/u1')) return Response.json({ vehicle: { id: 'u1', plate: 'xy321ab' } })
    if (ruta.endsWith('/tenants/destino/vehicles/u2')) return Response.json({ vehicle: { id: 'distinto', plate: 'xy321ab' } })
    return Response.json({ message: 'Not found' }, { status: 404 })
  }
  t.after(() => { globalThis.fetch = original })
  const pendiente = { id: 't1', vehiculoId: 'u1', origenId: 'origen', destinoId: 'destino', estado: 'pending' }
  const completada = { ...pendiente, id: 't3', vehiculoId: 'u2', estado: 'completed' }
  const ajena = { ...pendiente, id: 't4', origenId: 'ajeno' }
  const placas = await repo.transferencias.vehiculo.placas([pendiente, { ...pendiente, id: 't2' }, completada, ajena])
  assert.deepEqual({ ...placas }, { t1: 'XY321AB', t2: 'XY321AB' })
  assert.equal(llamadas.filter(r => r.endsWith('/tenants/origen/vehicles/u1')).length, 1)
  const conteos = await repo.transferencias.vehiculo.dependencias(pendiente)
  assert.deepEqual(dependenciasDeTransferencia(conteos).map(x => x.texto), [
    '1 GPS instalado', '1 asignación de conductor vigente', '5 órdenes de trabajo abiertas',
  ])
  assert.equal(dependenciasConfirmadas(conteos), false)
  assert.equal(dependenciasConfirmadas({ ...conteos, driverSessions: 0, emergencies: 0 }), true)
  assert.equal(dependenciasConfirmadas({ ...conteos, driverSessions: -1, emergencies: 0 }), false)
  assert.equal(coincideConPlaca('xy321ab', placas.t1), true)
  assert.equal(coincideConPlaca('flota-01', placas.t1), false)
  assert.equal(conflictoDeDependencias({ estado: 409, message: 'Vehicle has active dependencies' }), true)
  assert.equal(conflictoDeDependencias({ estado: 409, message: 'Vehicle transfer version changed' }), false)
})

test('transferencias revisan la versión vigente y conservan la clave en un reintento', async (t) => {
  const repo = await repositorioConectado()
  const original = globalThis.fetch
  const mutaciones = []
  const actual = { id: 't1', version: 7, status: 'pending', originReleasedAt: '2026-11-24T10:00:00Z' }
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/vehicle-transfers/t1') && options.method === 'GET') return Response.json({ transfer: actual })
    assert.ok(String(url).endsWith('/vehicle-transfers/t1/destination-acceptance'))
    assert.equal(options.method, 'POST')
    mutaciones.push([JSON.parse(options.body), options.headers['idempotency-key']])
    return Response.json({ transfer: { ...actual, status: 'completed', version: 8 } })
  }
  t.after(() => { globalThis.fetch = original })
  const detalle = await repo.transferencias.vehiculo.detalle('t1')
  assert.equal(detalle.liberadaEn, actual.originReleasedAt)
  const clave = '00000000-0000-4000-8000-000000000123'
  for (const repeticion of [1, 2]) {
    const respuesta = await repo.transferencias.vehiculo.decidir(detalle, 'destination-acceptance', undefined, clave)
    assert.equal(respuesta.estado, 'completed')
    assert.deepEqual(mutaciones[repeticion - 1], [{ expectedVersion: 7 }, clave])
  }
  assert.match(explicarAceptacion({ estado: 409, message: 'Transfer conflicts with current vehicle state' }), /estado o historial/u)
})

test('inspecciones: sin conteos del servidor quedan en null, nunca en 0', async () => {
  const repo = await repositorioConectado()
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (url) => {
      assert.ok(String(url).includes('/api/v1/console/inspections'))
      return new Response(JSON.stringify({
        items: [{
          id: 'insp-1', result: 'bloqueada', inspectionDate: '2026-10-16', vehicleId: 'v1',
          vehicleCode: 'VM-01', vehiclePlate: 'AB123CD', driverName: 'Ana', templateName: 'Diaria', kind: 'daily',
        }],
      }), { status: 200 })
    }
    const [i] = await repo.inspecciones.listar({})
    assert.equal(i.resultado, 'bloqueada')
    assert.equal(i.fallasCriticas, null)
    assert.equal(i.observaciones, null)
    assert.equal(i.tipoVehiculo, null)
  } finally { globalThis.fetch = original }
})

test('gps: la instalación se manda aunque el equipo nunca haya reportado', async () => {
  const repo = await repositorioConectado()
  const original = globalThis.fetch
  const llamadas = []
  try {
    globalThis.fetch = async (url, opts) => {
      llamadas.push({ url: String(url), metodo: opts?.method, body: opts?.body ? JSON.parse(opts.body) : null })
      return new Response(JSON.stringify({ installation: { id: 'inst-1' } }), { status: 200 })
    }
    assert.equal(await repo.admin.gps.asociar('equipo-nuevo', 'v1'), true)
    assert.equal(llamadas.length, 1)
    assert.ok(llamadas[0].url.endsWith('/api/v1/console/gps-devices/equipo-nuevo/installation'))
    assert.equal(llamadas[0].metodo, 'POST')
    assert.equal(llamadas[0].body.vehicleId, 'v1')
  } finally { globalThis.fetch = original }

  // La pantalla ya no esconde el selector tras «verificado» y avisa de comprobar la señal.
  // Desde T-95 la instalación vive en su propia pantalla, AdminGpsInstalar.
  const fuente = readFileSync(join(raiz, 'src/panel/modulos/AdminGpsInstalar.jsx'), 'utf8')
  assert.doesNotMatch(fuente, /activo && g\.verificado && !instalado/u)
  assert.match(fuente, /Este equipo aún no ha reportado; tras instalarlo comprueba que empiece a enviar señal\./u)
})
