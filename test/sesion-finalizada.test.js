import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'vite'

const bundle = await build({ configFile: false, envFile: false, logLevel: 'silent',
  define: { 'import.meta.env.VITE_FOM_API': '"/synthetic"' },
  build: { ssr: 'test/fixtures/ciclo-datos/session-entry.js', write: false, minify: false } })
const code = bundle.output.find(x => x.type === 'chunk' && x.isEntry).code
let sequence = 0
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const user = { email: 'synthetic@fom.invalid', displayName: 'Synthetic', tenantId: '11111111-1111-4111-8111-111111111111', role: 'admin_fom' }
function storage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), key: i => [...map.keys()][i], get length() { return map.size } }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
async function fixture(t, handler) {
  const previous = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage }
  globalThis.localStorage = storage({ 'fom.panel.modo': 'oscuro', 'fom.private.fixture': 'PRIVATE SYNTHETIC' })
  globalThis.sessionStorage = storage()
  globalThis.fetch = (...args) => Promise.resolve().then(() => handler(...args))
  t.after(() => { for (const [k, v] of Object.entries(previous)) if (v === undefined) delete globalThis[k]; else globalThis[k] = v })
  const auth = await import(`data:text/javascript;base64,${Buffer.from(code + `\n//${++sequence}`).toString('base64')}`)
  await tick(); await tick()
  return auth
}
function basic(url) {
  if (url.endsWith('/auth/session')) return response({ authenticated: true, user })
  if (/\/tenants(?:\?|$)/u.test(url)) return response({ items: [] })
  return response({ authenticated: false })
}

test('salida sin red oculta datos, conserva pendiente tras recargar y no inicia otro login', async t => {
  let offline = false, logins = 0
  const auth = await fixture(t, async (url, options) => {
    if (url.endsWith('/auth/logout') && offline) throw new TypeError('synthetic offline')
    if (url.endsWith('/auth/login')) { logins++; return response({ authenticated: true, user }) }
    return basic(url)
  })
  assert.ok(auth.sesionActual().perfil)
  offline = true
  const closing = auth.finalizarSesion('inactividad')
  assert.equal(auth.sesionActual().perfil, undefined)
  assert.equal((await closing).ok, false)
  assert.equal(localStorage.getItem('fom.session.salida-pendiente'), '1')
  assert.equal(localStorage.getItem('fom.private.fixture'), null)
  assert.equal(localStorage.getItem('fom.panel.modo'), 'oscuro')
  assert.equal((await auth.iniciarSesion({ usuario: user.email, clave: 'synthetic-only' })).ok, false)
  assert.equal(logins, 0)
  await auth.resolverSesion(); assert.equal(auth.sesionActual().perfil, undefined)
  offline = false; assert.equal((await auth.reintentarSalida()).ok, true)
  assert.equal(localStorage.getItem('fom.session.salida-pendiente'), null)
  assert.equal(auth.sesionActual().finalizada.pendiente, false)
  assert.equal((await auth.iniciarSesion({ usuario: user.email, clave: 'synthetic-only' })).ok, true)
  assert.equal(auth.inicioDeSesion(auth.sesionActual()), '/panel/seleccionar-empresa')
})

test('respuesta de resolver sesión anterior al cierre nunca vuelve a mostrar el perfil', async t => {
  let resolveSession
  const auth = await fixture(t, url => url.endsWith('/auth/session') ? new Promise(resolve => { resolveSession = resolve }) : basic(url))
  await auth.finalizarSesion('sesion', { yaRevocada: true })
  resolveSession(response({ authenticated: true, user })); await tick(); await tick()
  assert.equal(auth.sesionActual().perfil, undefined)
  assert.equal(auth.sesionActual().finalizada.pendiente, false)
})

test('503 de una capacidad y401 de negocio no cierran una sesión que el servidor revalida', async t => {
  const auth = await fixture(t, async url => basic(url))
  auth.avisarComunicacion({ tipo: 'servidor', estado: 503 }); await tick(); await tick()
  assert.ok(auth.sesionActual().perfil)
  auth.avisarComunicacion({ tipo: 'servidor', estado: 500 }); await tick(); await tick()
  assert.ok(auth.sesionActual().perfil)
  auth.avisarComunicacion({ tipo: 'sesion', estado: 401 }); await tick(); await tick()
  assert.ok(auth.sesionActual().perfil); assert.equal(auth.sesionActual().comprobandoConexion, undefined)
})

test('401 comprobado protege la pantalla y no supone un logout adicional', async t => {
  let expired = false, logouts = 0
  const auth = await fixture(t, async url => {
    if (url.endsWith('/auth/session') && expired) return response({ message: 'Synthetic expired' }, 401)
    if (url.endsWith('/auth/logout')) logouts++
    return basic(url)
  })
  expired = true; auth.avisarComunicacion({ tipo: 'sesion', estado: 401 }); await tick(); await tick()
  assert.equal(auth.sesionActual().perfil, undefined)
  assert.equal(auth.sesionActual().finalizada.pendiente, false)
  assert.equal(logouts, 0)
})

test('una lectura tardía del nombre de empresa no restaura la sesión cerrada', async t => {
  let resolveCompany
  const auth = await fixture(t, url => /\/tenants(?:\?|$)/u.test(url) ? new Promise(resolve => { resolveCompany = resolve }) : basic(url))
  assert.equal(auth.sesionActual(), undefined)
  await auth.finalizarSesion('sesion', { yaRevocada: true })
  resolveCompany(response({ items: [] })); await tick(); await tick()
  assert.equal(auth.sesionActual().perfil, undefined)
  assert.equal(auth.sesionActual().finalizada.pendiente, false)
})

test('un cierre de la generación anterior no revoca el login nuevo de otra pestaña', async t => {
  let logouts = 0
  const auth = await fixture(t, async url => { if (url.endsWith('/auth/logout')) logouts++; return basic(url) })
  localStorage.setItem('fom.session.generacion', 'synthetic-new-generation')
  localStorage.setItem('fom.session.actividad', '1000')
  await auth.finalizarSesion('inactividad')
  assert.equal(logouts, 0)
  assert.equal(localStorage.getItem('fom.session.generacion'), 'synthetic-new-generation')
  assert.equal(localStorage.getItem('fom.session.actividad'), '1000')
  assert.equal(auth.sesionActual().perfil, undefined)
})

test('login espera a que termine el logout anterior y no recibe una limpieza tardía', async t => {
  let resolveLogout, logins = 0
  const auth = await fixture(t, url => {
    if (url.endsWith('/auth/logout')) return new Promise(resolve => { resolveLogout = resolve })
    if (url.endsWith('/auth/login')) { logins++; return Promise.resolve(response({ authenticated: true, user })) }
    return Promise.resolve(basic(url))
  })
  const closing = auth.finalizarSesion('inactividad')
  const login = auth.iniciarSesion({ usuario: user.email, clave: 'synthetic-only' })
  await tick(); assert.equal(logins, 0)
  resolveLogout(response({ authenticated: false })); await closing
  assert.equal((await login).ok, true)
  assert.equal(logins, 1); assert.ok(auth.sesionActual().perfil)
  assert.ok(localStorage.getItem('fom.session.generacion'))
})

test('almacenamiento lleno no se convierte en una revocación remota ficticia', async t => {
  let logouts = 0
  const auth = await fixture(t, async url => {
    if (url.endsWith('/auth/logout')) { logouts++; throw new TypeError('synthetic offline') }
    return basic(url)
  })
  localStorage.setItem = () => { throw new Error('synthetic quota') }
  assert.equal((await auth.finalizarSesion('conexion')).ok, false)
  assert.equal(logouts, 1)
  assert.equal(auth.sesionActual().finalizada.pendiente, true)
})
