import test from 'node:test'
import assert from 'node:assert/strict'
import { AVISO_ELIMINACION_EMPRESA, AVISO_IMAGENES_PENDIENTES, crearClienteEliminacionEmpresas,
  eliminacionComprobada, puedeConfirmarEliminacion, validarSolicitudEmpresa } from '../src/panel/datos/eliminacionEmpresasContrato.js'

const tenant = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const id = '33333333-3333-4333-8333-333333333333'
const key = '44444444-4444-4444-8444-444444444444'
const plan = 'a'.repeat(64)
const ready = { tenantId: tenant, requestId: id, companyName: 'Empresa sintética', status: 'ready',
  includesBackups: true, canConfirm: true, planSha256: plan, checkedAt: '2026-11-19T01:00:00Z',
  planExpiresAt: '2026-11-19T01:05:00Z' }

test('confirmación exige ámbito, nombre exacto, plan vigente y respaldos incluidos', () => {
  assert.equal(puedeConfirmarEliminacion(ready, tenant, ready.companyName), true)
  for (const change of [{ tenantId: other }, { includesBackups: false }, { canConfirm: false },
    { planSha256: 'x' }, { checkedAt: 'invalida' }, { planExpiresAt: ready.checkedAt }, { status: 'reviewing' }]) {
    assert.equal(puedeConfirmarEliminacion({ ...ready, ...change }, tenant, ready.companyName), false)
  }
  assert.equal(puedeConfirmarEliminacion(ready, tenant, `${ready.companyName} `), false)
  assert.equal(puedeConfirmarEliminacion(ready, tenant, ready.companyName.toUpperCase()), false)
  assert.throws(() => validarSolicitudEmpresa(ready, other))
})

test('desaparecer de la aplicación o recibir completed no prueba la eliminación completa', () => {
  const completed = { ...ready, status: 'completed', complete: true, liveDeleted: true,
    copiesTotal: 2, copiesVerified: 2, failureCode: null }
  assert.equal(eliminacionComprobada(completed, tenant), true)
  for (const change of [{ status: 'sanitizing_backups' }, { complete: false }, { liveDeleted: false },
    { copiesVerified: 1 }, { copiesTotal: -1 }, { copiesTotal: undefined },
    { failureCode: 'backup_data_remaining' }, { tenantId: other }]) {
    assert.equal(eliminacionComprobada({ ...completed, ...change }, tenant), false)
  }
})

test('cliente usa sólo rutas de eliminación explícita sin heredar la empresa seleccionada', async () => {
  const calls = [], client = crearClienteEliminacionEmpresas(async (...args) => { calls.push(args); return {} })
  await client.preparar(tenant, key)
  await client.preparar(tenant, key)
  await client.confirmar(tenant, id, plan, ready.companyName)
  await client.leer(id)
  await client.listar()
  await client.cancelar(tenant, id)
  assert.equal(calls.length, 6)
  assert.ok(calls.every(([route, options]) => route.startsWith('/api/v1/console/lifecycle/') && options.empresaContexto === null))
  assert.equal(calls[0][1].idempotencia, key)
  assert.deepEqual(calls[0], calls[1])
  assert.deepEqual(calls[2][1].cuerpo, { planSha256: plan, confirmation: ready.companyName, includesBackups: true })
  assert.equal(calls[3][1].metodo, undefined)
  assert.equal(calls[4][1].metodo, undefined)
  assert.deepEqual(calls[5][1].cuerpo, {})
  for (const attempt of [() => client.preparar('../otra', key), () => client.leer('../otra'),
    () => client.confirmar(tenant, id, 'invalido', ready.companyName)]) assert.throws(attempt)
  assert.equal(calls.length, 6)
})

test('error de comunicación conserva la misma solicitud y no inicia una retirada alternativa', async () => {
  const calls = [], client = crearClienteEliminacionEmpresas(async (...args) => {
    calls.push(args); throw new Error('Respuesta perdida sintética')
  })
  await assert.rejects(client.confirmar(tenant, id, plan, ready.companyName), /Respuesta perdida/)
  assert.equal(calls.length, 1)
  assert.match(calls[0][0], new RegExp(`/company-deletions/${id}/confirm$`))
})

test('aviso describe la eliminación definitiva y la dependencia externa sin prometer imágenes borradas', () => {
  assert.match(AVISO_ELIMINACION_EMPRESA, /historial.*respaldos/u)
  assert.match(AVISO_ELIMINACION_EMPRESA, /definitiva/u)
  assert.match(AVISO_IMAGENES_PENDIENTES, /Cloudinary.*pendientes.*recuperar/u)
})
