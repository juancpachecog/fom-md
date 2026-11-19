import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'vite'
const bundled = await build({ configFile: false, envFile: false, logLevel: 'silent',
  define: { 'import.meta.env.VITE_FOM_API': '"/synthetic"' },
  build: { ssr: 'test/fixtures/ciclo-datos/communication-entry.js', write: false, minify: false } })
const code = bundled.output.find(x => x.isEntry && x.type === 'chunk').code
const client = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

test('corte durante el cuerpo avisa pérdida de comunicación sin filtrar ruta ni respuesta', async t => {
  const previous = globalThis.fetch, events = [], off = client.alCambiarComunicacion(e => events.push(e))
  t.after(() => { globalThis.fetch = previous; off() })
  globalThis.fetch = async () => ({ ok: true, status: 200, async text() { throw new TypeError('synthetic private body') } })
  await assert.rejects(client.pedir('/api/v1/console/vehicles'), /No se pudo conectar/u)
  assert.deepEqual(events, [{ tipo: 'red', estado: 0 }])
})

test('el tope cubre el cuerpo lento después de recibir cabeceras', async t => {
  const previous = globalThis.fetch, events = [], off = client.alCambiarComunicacion(e => events.push(e))
  t.after(() => { globalThis.fetch = previous; off() })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  globalThis.fetch = async (_url, options) => ({ ok: true, status: 200,
    text: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('synthetic abort'), { name: 'AbortError' })), { once: true })) })
  const request = client.pedir('/api/v1/console/vehicles?synthetic=slow')
  await new Promise(resolve => setImmediate(resolve))
  t.mock.timers.tick(25000)
  await assert.rejects(request, /tardó demasiado/u)
  assert.deepEqual(events, [{ tipo: 'red', estado: 0 }])
})
