import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'vite'
const bundle = await build({ configFile: false, envFile: false, logLevel: 'silent',
  define: { 'import.meta.env.VITE_FOM_API': '"/synthetic"' },
  build: { ssr: 'test/fixtures/ciclo-datos/catalogo-entry.js', write: false, minify: false } })
const code = bundle.output.find(x => x.type === 'chunk' && x.isEntry).code
const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const id = '11111111-1111-4111-8111-111111111111', token = '22222222-2222-4222-8222-222222222222'
test('cliente compilado convierte formulario y verifica escritura por GET independiente', async () => {
  const form = { ...api.formularioDefinicion(null), key: 'puerta', name: 'Puerta', reason: 'Nueva medición' }
  const body = api.cuerpoDefinicion(form, null)
  assert.equal(body.definition.kind, 'boolean'); assert.equal(body.definition.unit, 'none')
  assert.equal(body.expectedVersion, 0)
  const old = globalThis.fetch, calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify(options.method === 'POST' ? { entryId: id, version: 1, replayed: false }
      : { items: [{ id, version: 1, key: body.key, name: body.name, status: body.status }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const result = await api.guardarDefinicion(null, body, token)
    assert.equal(result.version, 1); assert.equal(calls.length, 2)
    assert.equal(calls[0].options.headers['idempotency-key'], token)
    assert.equal(calls[0].options.headers['x-fom-csrf'], 'fom-browser-v1')
    assert.equal(calls[1].options.method, 'GET')
    assert.match(calls[1].url, new RegExp(id + '$'))
  } finally { globalThis.fetch = old }
})
test('no afirma guardado ante readback contrario y no repite escrituras', async () => {
  const old = globalThis.fetch, calls = []
  globalThis.fetch = async (url, options) => {
    calls.push(options.method)
    return new Response(JSON.stringify(options.method === 'POST' ? { entryId: id, version: 1 } : { items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try { await assert.rejects(api.guardarDefinicion(null, { key: 'puerta', name: 'Puerta', status: 'active' }, token), /verificado/); assert.deepEqual(calls, ['POST', 'GET']) }
  finally { globalThis.fetch = old }
})
test('etiqueta no lleva medición y números incompletos no se convierten en cero', () => {
  const form = { ...api.formularioDefinicion(null), key: 'frio', name: 'Frío', category: 'tag', reason: 'Nueva etiqueta' }
  assert.equal(api.cuerpoDefinicion(form, null).definition, null)
  assert.throws(() => api.cuerpoDefinicion({ ...form, category: 'variable', kind: 'numeric', min: '' }, null), /Completa/)
  const d = api.cuerpoDefinicion({ ...form, category: 'variable', kind: 'numeric' }, null).definition
  assert.equal(d.dimension, 'temperature'); assert.equal(d.unit, 'celsius')
})
