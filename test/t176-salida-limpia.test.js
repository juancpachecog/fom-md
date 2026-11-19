import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { build } from 'vite'

// ============================================================
// T-176: salir sin dejar rastro y claves de la vitrina fuera del paquete
//  · con la API puesta (producción) las cuentas de demostración no entran al
//    paquete; sin API siguen ahí;
//  · cerrar sesión borra las claves del panel, los avisos del conductor, la
//    base `fom-hojas` y las memorias, y recarga en /entrar;
//  · si el servidor no confirma la salida, se avisa y no se dice que salió;
//  · la memoria de rankings es por persona, no solo por empresa.
// ============================================================

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')
const ruta = (r) => join(raiz, r).replace(/\\/g, '/')
const CLAVES_VITRINA = ['FlotaFOM2026', 'ConductorFOM2026', 'AdminFOM2026']

/** Un módulo del panel compilado con Vite (lee `import.meta.env`). */
async function compilar(entrada, api) {
  const ENTRADA = `virtual:prueba-t176-${api ? 'api' : 'demo'}-${Math.random().toString(36).slice(2)}`
  const salida = await build({
    root: raiz,
    logLevel: 'error',
    define: { 'import.meta.env.VITE_FOM_API': JSON.stringify(api) },
    plugins: [{
      name: 'entrada-prueba',
      resolveId: (id) => (id.endsWith(ENTRADA) ? '\0' + ENTRADA : null),
      load: (id) => (id === '\0' + ENTRADA ? entrada : null),
    }],
    build: { write: false, minify: true, lib: { entry: ENTRADA, formats: ['es'], fileName: 'prueba' } },
  })
  return salida[0].output.filter((o) => o.type === 'chunk').map((o) => o.code).join('\n')
}

/** localStorage / sessionStorage de mentira, con `length` y `key()` como el de verdad. */
function almacen(inicial = {}) {
  const datos = new Map(Object.entries(inicial))
  return {
    get length() { return datos.size },
    key: (i) => [...datos.keys()][i] ?? null,
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
    claves: () => [...datos.keys()].sort(),
  }
}

const LO_QUE_DEJA_UNA_SESION = {
  'fom:inspeccion-diaria:transporte-lago-sur:veh-001': '{"fecha":"2026-10-26"}',
  'fom:inspeccion-fin-de-semana:usr-002': '{"respuesta":"trabajo"}',
  'fom_hojas_transporte-lago-sur': '[]',
  'fom_hoja_transporte-lago-sur_PLAN_v1': '{}',
  'fom_foto_fom/avatar/usr-002': '3',
  'notis:usr-002': '{"a1":{"leida":true}}',
  'fom.panel.manejoBrusco.x': '7',
}
const LO_QUE_SE_QUEDA = {
  'fom.panel.modo': 'oscuro',
  'fom.mapa.prefs': '{"v":3}',
  'fom.apariencia.v1:ana%40fom.com.ve': 'verde',
  'fom.panel.cambios': '{}',
  'otra-web': 'no es nuestra',
}

/** El navegador de la prueba: almacenes, IndexedDB, `location` y `alert`, anotando lo que pasa. */
function navegador(local = {}, sesion = {}) {
  const notas = { bases: [], recargas: [], avisos: [] }
  globalThis.localStorage = almacen(local)
  globalThis.sessionStorage = almacen(sesion)
  globalThis.indexedDB = {
    deleteDatabase(nombre) {
      notas.bases.push(nombre)
      const pedido = {}
      setTimeout(() => pedido.onsuccess?.(), 0)
      return pedido
    },
  }
  globalThis.location = { search: '', replace: (a) => notas.recargas.push(a) }
  globalThis.alert = (m) => notas.avisos.push(m)
  return notas
}
function limpiarNavegador() {
  for (const k of ['localStorage', 'sessionStorage', 'indexedDB', 'location', 'alert']) delete globalThis[k]
}

let cargas = 0
const cargar = (codigo) => import('data:text/javascript;base64,' + Buffer.from(`${codigo}\n// carga ${++cargas}`).toString('base64'))

// ---------------------------------------------------------------- el paquete

test('con la API puesta (producción) las claves de la vitrina no van en el paquete; sin API, sí', async () => {
  const entrada = `export * from '${ruta('src/panel/auth.js')}'`
  const conApi = await compilar(entrada, '/fom-api')
  for (const clave of CLAVES_VITRINA) assert.equal(conApi.includes(clave), false, `${clave} viajó en el paquete`)
  assert.equal(conApi.includes('conductor@fom.com.ve'), false)
  const sinApi = await compilar(entrada, '')
  for (const clave of CLAVES_VITRINA) assert.ok(sinApi.includes(clave), `${clave} falta en la vitrina`)
})

// ---------------------------------------------------------------- vitrina

test('vitrina: salir borra lo de la sesión, la base de hojas y recarga en /entrar; las preferencias se quedan', async (t) => {
  const notas = navegador({ ...LO_QUE_DEJA_UNA_SESION, ...LO_QUE_SE_QUEDA }, { 'fom.panel.manejoBrusco.y': '30', ajena: '1' })
  t.after(limpiarNavegador)
  const auth = await cargar(await compilar(`export * from '${ruta('src/panel/auth.js')}'`, ''))
  assert.equal(auth.CUENTAS_DEMO.length, 3)

  const r = await auth.iniciarSesion({ usuario: 'conductor@fom.com.ve', clave: 'ConductorFOM2026' })
  assert.equal(r.ok, true)
  assert.ok(localStorage.getItem('fom.panel.sesion'))

  assert.deepEqual(await auth.cerrarSesion(), { ok: true })
  assert.equal(auth.sesionActual(), null)
  assert.deepEqual(localStorage.claves(), Object.keys(LO_QUE_SE_QUEDA).sort())
  assert.deepEqual(sessionStorage.claves(), ['ajena'])
  assert.deepEqual(notas.bases, ['fom-hojas'])
  assert.deepEqual(notas.recargas, ['/entrar'])
  assert.deepEqual(notas.avisos, [])
})

// ---------------------------------------------------------------- conectado

/** Servidor de mentira: sesión de `persona`, login que la cambia y la salida que responde `salida`. */
function servidor({ persona, salida = 200 }) {
  const estado = { persona, salida, llamadas: [] }
  const responder = (status, cuerpo) => ({ ok: status >= 200 && status < 300, status, text: async () => (cuerpo == null ? '' : JSON.stringify(cuerpo)) })
  const usuario = (email) => ({ email, displayName: email.split('@')[0], role: 'operator', tenantId: 'ente-1' })
  globalThis.fetch = async (url, op = {}) => {
    const u = String(url)
    const metodo = op.method ?? 'GET'
    estado.llamadas.push(`${metodo} ${u}`)
    if (u.endsWith('/auth/session')) return responder(200, estado.persona ? { authenticated: true, user: usuario(estado.persona) } : { authenticated: false })
    if (u.endsWith('/auth/login')) {
      estado.persona = JSON.parse(op.body).email
      return responder(200, { user: usuario(estado.persona) })
    }
    if (u.endsWith('/auth/logout')) {
      if (estado.salida === 200) estado.persona = null
      return responder(estado.salida, estado.salida === 200 ? null : { message: 'falló' })
    }
    if (u.includes('/driving-scores')) return responder(200, { items: [{ userId: 'u9', displayName: 'Uno', score: 80 }] })
    return responder(404, { message: 'not found' })
  }
  estado.cuantas = (pedazo) => estado.llamadas.filter((l) => l.includes(pedazo)).length
  return estado
}

async function conectado() {
  const codigo = await compilar(`
    export * from '${ruta('src/panel/auth.js')}'
    export { repoApi } from '${ruta('src/panel/datos/repoApi.js')}'
  `, '/fom-api')
  const m = await cargar(codigo)
  // La sesión se le pregunta al servidor al cargar: se espera la respuesta.
  for (let i = 0; i < 100 && m.sesionActual() === undefined; i += 1) await new Promise((r) => setTimeout(r, 5))
  return m
}

test('conectado: si el servidor no confirma la salida, se avisa, la sesión sigue y no se borra nada', async (t) => {
  const fetchOriginal = globalThis.fetch
  const notas = navegador({ ...LO_QUE_DEJA_UNA_SESION })
  t.after(() => { globalThis.fetch = fetchOriginal; limpiarNavegador() })
  const srv = servidor({ persona: 'ana@fom.com.ve', salida: 500 })
  const m = await conectado()
  assert.equal(m.perfilActual()?.correo, 'ana@fom.com.ve')
  const clavesAntesDeSalir = localStorage.claves()

  const r = await m.cerrarSesion()
  assert.equal(r.ok, false)
  assert.match(r.error, /No pudimos cerrar tu sesión en el servidor/)
  assert.deepEqual(notas.avisos, [r.error])
  assert.equal(m.perfilActual()?.correo, 'ana@fom.com.ve', 'no se dice que salió')
  assert.deepEqual(notas.recargas, [])
  assert.deepEqual(notas.bases, [])
  assert.deepEqual(localStorage.claves(), clavesAntesDeSalir)

  // Un 401 al salir es que el servidor ya no tenía la sesión: eso sí es haber salido.
  srv.salida = 401
  assert.deepEqual(await m.cerrarSesion(), { ok: true })
  assert.equal(m.sesionActual(), null)
  assert.deepEqual(localStorage.claves(), [])
  assert.deepEqual(notas.recargas, ['/entrar'])
})

test('conectado: la memoria de rankings es por persona y se borra al salir', async (t) => {
  const fetchOriginal = globalThis.fetch
  navegador()
  t.after(() => { globalThis.fetch = fetchOriginal; limpiarNavegador() })
  const srv = servidor({ persona: 'ana@fom.com.ve' })
  const m = await conectado()

  await m.repoApi.manejo.ranking({ dias: 7 })
  await m.repoApi.manejo.ranking({ dias: 7 })
  assert.equal(srv.cuantas('/driving-scores'), 1, 'la misma persona usa lo guardado')

  // Otra persona en el mismo navegador (misma empresa) no ve el ranking de la anterior.
  await m.iniciarSesion({ usuario: 'beto@fom.com.ve', clave: 'x' })
  await m.repoApi.manejo.ranking({ dias: 7 })
  assert.equal(srv.cuantas('/driving-scores'), 2)
  await m.repoApi.manejo.ranking({ dias: 7 })
  assert.equal(srv.cuantas('/driving-scores'), 2)

  // Al salir se olvida: si la misma persona vuelve a entrar, se pide de nuevo.
  assert.deepEqual(await m.cerrarSesion(), { ok: true })
  await m.iniciarSesion({ usuario: 'beto@fom.com.ve', clave: 'x' })
  await m.repoApi.manejo.ranking({ dias: 7 })
  assert.equal(srv.cuantas('/driving-scores'), 3)
})
