import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'vite'

const tenant = '11111111-1111-4111-8111-111111111111'
const another = '22222222-2222-4222-8222-222222222222'
const entity = '33333333-3333-4333-8333-333333333333'
const key = '44444444-4444-4444-8444-444444444444'
const bundle = await build({ configFile: false, envFile: false, logLevel: 'silent',
  define: { 'import.meta.env.VITE_FOM_API': '"/synthetic"' },
  build: { ssr: 'test/fixtures/ciclo-datos/client-entry.js', write: false, minify: false } })
const code = bundle.output.find(item => item.type === 'chunk' && item.isEntry).code
const client = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)

test('cliente real compilado conserva empresa explícita, CSRF y la misma llave sin escrituras adicionales', async () => {
  const previous = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ id: key }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    client.fijarEmpresaGestion(another)
    await client.leerCiclo(tenant)
    assert.match(calls[0].url, new RegExp(`/lifecycle/tenants/${tenant}$`))
    await client.crearConjuntoPrueba(tenant, 'Procedencia sintética', key)
    await client.crearConjuntoPrueba(tenant, 'Procedencia sintética', key)
    assert.equal(calls.length, 3)
    assert.equal(calls[1].options.headers['idempotency-key'], key)
    assert.equal(calls[2].options.headers['idempotency-key'], key)
    assert.equal(calls[1].options.headers['x-fom-csrf'], 'fom-browser-v1')
    assert.deepEqual(JSON.parse(calls[1].options.body), { reason: 'Procedencia sintética' })
    assert.throws(() => client.leerCiclo('../otro-tenant'), /registro válido/)
    assert.equal(calls.length, 3)
    await client.retirarRegistro(tenant, { type: 'vehicle', id: entity, status: 'active' }, 'Prueba', key)
    assert.deepEqual(JSON.parse(calls[3].options.body), { reason: 'Prueba', expectedStatus: 'active' })
  } finally { globalThis.fetch = previous; client.fijarEmpresaGestion(null) }
})

test('fallo de lectura no se convierte en una lista vacía ni dispara reintentos de escritura', async () => {
  const previous = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ message: 'Synthetic unavailable' }),
    { status: 503, headers: { 'content-type': 'application/json' } }) }
  try {
    await assert.rejects(client.candidatosCiclo(tenant), e => e.estado === 503)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = previous }
})

test('resumen elige la versión más reciente de cada familia sin rejuvenecer las otras', () => {
  const policies = [{ family: 'raw_ingress', version: 3, calendarMonths: 3 },
    { family: 'canonical_telemetry', version: 1, calendarMonths: 6 },
    { family: 'raw_ingress', version: 2, calendarMonths: 6 }]
  assert.equal(client.versionActual(policies, 'raw_ingress').version, 3)
  assert.equal(client.versionActual(policies, 'canonical_telemetry').calendarMonths, 6)
  assert.equal(client.versionActual([], 'raw_ingress'), null)
})
