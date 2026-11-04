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

test('ámbito global es explícito y el plan usa POST con CSRF; recibo posterior solo GET', async () => {
  const previous = globalThis.fetch, calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ planId: key }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    client.fijarEmpresaGestion(another)
    await client.leerCiclo('global')
    assert.match(calls[0].url, /\/lifecycle\/global$/u)
    await client.revisarLimpieza(key)
    assert.match(calls[1].url, /\/cleanup-plans$/u)
    assert.equal(calls[1].options.method, 'POST')
    assert.equal(calls[1].options.headers['x-fom-csrf'], 'fom-browser-v1')
    await client.limpiarPruebas(key, { planId: key, confirmation: 'ELIMINAR PRUEBAS' }, key)
    await client.leerReciboLimpieza(key)
    assert.equal(calls.length, 4)
    assert.equal(calls[3].options.method, 'GET')
    assert.match(calls[3].url, new RegExp(`/cleanup-receipts/${key}$`))
    assert.equal(calls.some(x => x.url.includes(`/tenants/${another}`)), false)
  } finally { globalThis.fetch = previous; client.fijarEmpresaGestion(null) }
})

const cambiosRetencion = ['raw_ingress', 'canonical_telemetry'].map(family => ({ family, calendarMonths: 6,
  expectedVersion: 0, reason: 'Política sintética' }))
const respuesta = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

test('guardar retención consulta ambas versiones aparte y resuelve una respuesta perdida sin repetir POST', async () => {
  const previous = globalThis.fetch, calls = [], policies = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (options.method === 'GET') return respuesta({ policies })
    const body = JSON.parse(options.body)
    policies.push({ ...body, version: body.expectedVersion + 1 })
    return policies.length === 2 ? respuesta({ message: 'Synthetic lost response after commit' }, 503) : respuesta({ id: key })
  }
  try {
    const actual = await client.guardarRetencionVerificada(tenant, cambiosRetencion)
    assert.equal(actual.policies.length, 2)
    assert.deepEqual(calls.map(c => c.options.method), ['POST', 'POST', 'GET'])
    assert.ok(calls.every(c => c.url.includes(`/tenants/${tenant}`)))
    assert.equal(calls[0].options.headers['x-fom-csrf'], 'fom-browser-v1')
  } finally { globalThis.fetch = previous }
})

test('un guardado parcial no se declara completo y no continúa escribiendo tras una respuesta incierta', async () => {
  const previous = globalThis.fetch, methods = [], policies = []
  globalThis.fetch = async (_url, options) => {
    methods.push(options.method)
    if (options.method === 'GET') return respuesta({ policies })
    const body = JSON.parse(options.body)
    policies.push({ ...body, version: 1 })
    return respuesta({ message: 'Synthetic lost first response' }, 503)
  }
  try {
    await assert.rejects(client.guardarRetencionVerificada(tenant, cambiosRetencion), /configuración completa/)
    assert.deepEqual(methods, ['POST', 'GET'])
    assert.equal(policies.length, 1)
  } finally { globalThis.fetch = previous }
})

test('sin lectura independiente no acredita políticas aunque los dos POST respondan éxito', async () => {
  const previous = globalThis.fetch, methods = []
  globalThis.fetch = async (_url, options) => {
    methods.push(options.method)
    return options.method === 'GET' ? respuesta({ message: 'Synthetic read unavailable' }, 503) : respuesta({ id: key })
  }
  try {
    await assert.rejects(client.guardarRetencionVerificada('global', cambiosRetencion), /No se pudo comprobar/)
    assert.deepEqual(methods, ['POST', 'POST', 'GET'])
  } finally { globalThis.fetch = previous }
})

test('reintentar una configuración parcial conserva la familia ya observada y verifica el conjunto', async () => {
  const previous = globalThis.fetch, methods = []
  const policies = [{ ...cambiosRetencion[0], version: 1 }]
  globalThis.fetch = async (_url, options) => {
    methods.push(options.method)
    if (options.method === 'GET') return respuesta({ policies })
    const body = JSON.parse(options.body)
    assert.equal(body.family, 'canonical_telemetry')
    assert.equal(Object.hasOwn(body, 'sinCambios'), false)
    policies.push({ ...body, version: 1 })
    return respuesta({ id: key })
  }
  try {
    await client.guardarRetencionVerificada(tenant, [{ ...cambiosRetencion[0], expectedVersion: 1, sinCambios: true }, cambiosRetencion[1]])
    assert.deepEqual(methods, ['POST', 'GET'])
    assert.equal(policies.filter(p => p.family === 'raw_ingress').length, 1)
  } finally { globalThis.fetch = previous }
})
