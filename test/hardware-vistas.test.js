import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'vite'
const bundle = await build({ configFile: false, envFile: false, logLevel: 'silent', esbuild: { jsx: 'automatic' },
  plugins: [{ name: 'hardware-synthetic-read-state', enforce: 'pre', load(id) {
    if (/\/src\/panel\/useDatos\.js$/u.test(id)) return 'export function useDatos(){return {datos:globalThis.__hardware807,estado:"ok",error:null,recargar(){}}}'
    if (/\/src\/panel\/useSesion\.js$/u.test(id)) return 'export function useSesion(){return {perfil:{rol:"admin_fom"}}}'
  } }], ssr: { noExternal: true },
  build: { ssr: 'test/fixtures/hardware-entry.jsx', write: false, minify: false } })
const code = bundle.output.find(x => x.type === 'chunk' && x.isEntry).code
const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
test('vistas React compiladas enlazan al equipo exacto y mantienen separados catálogo, etiquetas y perfiles', () => {
  const deviceId = '11111111-1111-4111-8111-111111111111'
  const html = api.render('pruebas', [{ id: deviceId, fabricante: 'Meitrack', modelo: 'T399L', vehiculoNombre: 'Unidad de prueba sintética' }])
  assert.ok(html.includes(`/panel/admin/gps/${deviceId}/probar`))
  assert.ok(html.includes(`/panel/admin/gps/${deviceId}?vista=funciones`))
  assert.ok(html.includes('Meitrack T399L'))
  const profile = api.render('perfiles', { items: [{ profileId: 'synthetic.profile', profileVersion: 2, manufacturer: 'Marca sintética', model: 'Modelo', protocolFamily: 'synthetic' }] })
  assert.ok(profile.includes('Marca sintética')); assert.ok(profile.includes('synthetic.profile'))
  const variable = api.render('variable', { items: [], total: 0 })
  const tag = api.render('tag', { items: [], total: 0 })
  assert.ok(variable.includes('Variables y funciones')); assert.ok(variable.includes('/panel/admin/etiquetas'))
  assert.ok(tag.includes('Etiquetas administrativas')); assert.ok(tag.includes('/panel/admin/funciones'))
  assert.ok(!tag.includes('Configurar funciones de un equipo'))
})
