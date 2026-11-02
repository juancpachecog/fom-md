import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { build } from 'vite'

// ============================================================
// T-167b: lo que la app tiene y la web ya también
//  · el SOS del conductor: las MISMAS rutas de `/api/v1/mobile` que la app,
//    el mismo cuerpo, y en la demo le llega al supervisor;
//  · otra unidad con PIN: las rutas de pin-unidad.tsx;
//  · la campana del conductor en la computadora y el globo de Mi perfil;
//  · los remates de la inspección (T-167a).
// ============================================================

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')
const ruta = (r) => join(raiz, r).replace(/\\/g, '/')
const leer = (r) => readFileSync(join(raiz, r), 'utf8').replace(/\r\n/gu, '\n')

function almacenEnMemoria() {
  const datos = new Map()
  return { getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)), removeItem: (k) => datos.delete(k) }
}

/** Un módulo del panel compilado con Vite (lee `import.meta.env`) y cargado en memoria. */
async function compilar(entrada, conApi) {
  const ENTRADA = `virtual:prueba-t167b-${conApi ? 'api' : 'demo'}`
  const salida = await build({
    root: raiz,
    logLevel: 'error',
    define: { 'import.meta.env.VITE_FOM_API': JSON.stringify(conApi ? '/fom-api' : '') },
    plugins: [{
      name: 'entrada-prueba',
      resolveId: (id) => (id.endsWith(ENTRADA) ? '\0' + ENTRADA : null),
      load: (id) => (id === '\0' + ENTRADA ? entrada : null),
    }],
    build: { write: false, minify: false, lib: { entry: ENTRADA, formats: ['es'], fileName: 'prueba' } },
  })
  return salida[0].output.find((o) => o.type === 'chunk').code
}

let cargas = 0
async function cargar(codigo, sesionDemo = null) {
  globalThis.localStorage = almacenEnMemoria()
  if (sesionDemo) globalThis.localStorage.setItem('fom.panel.sesion', JSON.stringify(sesionDemo))
  globalThis.location = { search: '' }
  try {
    return await import('data:text/javascript;base64,' + Buffer.from(`${codigo}\n// carga ${++cargas}`).toString('base64'))
  } finally {
    delete globalThis.location
  }
}

let codigoDemo = null
async function demo() {
  codigoDemo ??= await compilar(`
    export { default as repo, sosSemilla, seguridadSemilla, otraUnidadSemilla } from '${ruta('src/panel/datos/repoSemilla.js')}'
    export { iniciarSesion } from '${ruta('src/panel/auth.js')}'
  `, false)
  return cargar(codigoDemo)
}
let codigoApi = null
async function conectado() {
  codigoApi ??= await compilar(`
    export { sosConductor, otraUnidad, cuerpoEmergencia, emergenciaDelConductor, etiquetaEmergencia, errorDeTomarUnidad } from '${ruta('src/panel/datos/repoApi.js')}'
  `, true)
  return cargar(codigoApi)
}
let codigoPantallas = null
async function pantallas() {
  codigoPantallas ??= await compilar(`
    export { validarTipoOtro, duracionAviso, haceCuanto } from '${ruta('src/panel/modulos/SosConductorReglas.js')}'
    export { errorDePin } from '${ruta('src/panel/modulos/OtraUnidad.jsx')}'
  `, false)
  return cargar(codigoPantallas)
}

function servidor(respuestas) {
  const llamadas = []
  globalThis.fetch = async (url, opts = {}) => {
    const metodo = opts.method || 'GET'
    llamadas.push({ url, metodo, cuerpo: opts.body ? JSON.parse(opts.body) : null, cabeceras: opts.headers ?? {} })
    const r = respuestas(url, metodo)
    return new Response(JSON.stringify(r.cuerpo ?? {}), { status: r.estado ?? 200 })
  }
  return llamadas
}

const AVISO_FOM = {
  id: 'e-1', vehicleId: 'v1', reportedByUserId: 'u-7', kind: 'mechanical', kindOther: null,
  detail: 'Se rompió la correa\nDónde: 10.12345, -71.54321',
  reporterLocation: { latitude: 10.12345, longitude: -71.54321 }, vehicleLocation: null,
  status: 'active', acknowledgedByUserId: null, acknowledgedAt: null, reportedAt: '2026-10-26T12:00:00.000Z',
}

// ---------------------------------------------------------------- SOS conectado

test('sos conectado: manda el aviso por la ruta de la app, con la clave del intento y el mismo cuerpo', async () => {
  const original = globalThis.fetch
  try {
    const { sosConductor: sos, cuerpoEmergencia } = await conectado()
    const llamadas = servidor((url, metodo) => {
      if (url.includes('/emergencies?')) return { cuerpo: { items: [] } }
      if (url.endsWith('/emergencies') && metodo === 'POST') return { cuerpo: { emergency: AVISO_FOM } }
      return { estado: 404, cuerpo: { message: 'Cannot GET x' } }
    })
    const entrada = {
      vehiculoId: 'v1', tipo: 'mecanica', detalle: ' Se rompió la correa ', ubicacionTexto: '10.12345, -71.54321',
      coords: { lat: 10.1234567, lng: -71.5432109 }, idempotencia: '11111111-1111-4111-8111-111111111111',
    }
    const e = await sos.enviar(entrada, { usuarioId: 'u-7' })

    // Primero mira si ya hay uno en curso (activos y tomados), como la app.
    const lecturas = llamadas.filter((l) => l.metodo === 'GET').map((l) => l.url).sort()
    assert.deepEqual(lecturas, [
      '/fom-api/api/v1/mobile/emergencies?status=acknowledged&limit=100',
      '/fom-api/api/v1/mobile/emergencies?status=active&limit=100',
    ])
    const envio = llamadas.find((l) => l.metodo === 'POST')
    assert.equal(envio.url, '/fom-api/api/v1/mobile/emergencies')
    assert.equal(envio.cabeceras['idempotency-key'], entrada.idempotencia, 'la misma clave en cada reintento')
    assert.deepEqual(envio.cuerpo, cuerpoEmergencia(entrada))
    assert.deepEqual(envio.cuerpo, {
      vehicleId: 'v1', kind: 'mechanical', detail: 'Se rompió la correa\nDónde: 10.12345, -71.54321',
      reporterLatitude: 10.123457, reporterLongitude: -71.543211,
    })
    // Lo que vuelve, en el vocabulario de la pantalla: la dirección sale del detalle.
    assert.equal(e.estado, 'activa')
    assert.equal(e.tipo, 'mecanica')
    assert.equal(e.detalle, 'Se rompió la correa')
    assert.equal(e.ubicacionTexto, '10.12345, -71.54321')
    assert.deepEqual(e.coords, { lat: 10.12345, lng: -71.54321 })
  } finally {
    globalThis.fetch = original
  }
})

test('sos conectado: si ya hay uno en curso es ESE, y retirar / terminar usan sus rutas', async () => {
  const original = globalThis.fetch
  try {
    const { sosConductor: sos } = await conectado()
    const llamadas = servidor((url, metodo) => {
      if (url.includes('status=active')) return { cuerpo: { items: [AVISO_FOM] } }
      if (url.includes('status=acknowledged')) return { cuerpo: { items: [] } }
      if (metodo === 'POST' && url.endsWith('/cancel')) return { estado: 409, cuerpo: { message: 'Emergency cannot be cancelled once acknowledged' } }
      return { cuerpo: {} }
    })
    const e = await sos.enviar({ tipo: 'accidente', detalle: 'Choque', ubicacionTexto: '' }, { usuarioId: 'u-7' })
    assert.equal(e.id, 'e-1')
    assert.equal(llamadas.filter((l) => l.metodo === 'POST').length, 0, 'no se crea un segundo aviso')
    // Sin el id de la persona (la sesión web solo trae el correo), el primero es el suyo.
    assert.equal((await sos.miEmergencia({})).id, 'e-1')

    await assert.rejects(sos.cancelar(e), /Tu supervisor ya lo tomó: ya no se puede retirar\./u)
    assert.equal(llamadas.at(-1).url, '/fom-api/api/v1/mobile/emergencies/e-1/cancel')
    await sos.terminar(e)
    assert.equal(llamadas.at(-1).url, '/fom-api/api/v1/mobile/emergencies/e-1/resolve')
  } finally {
    globalThis.fetch = original
  }
})

test('sos: «Otro» se nombra con lo que escribió y solo entonces viaja kindOther', async () => {
  const { cuerpoEmergencia, emergenciaDelConductor, etiquetaEmergencia } = await conectado()
  const cuerpo = cuerpoEmergencia({ tipo: 'otro', tipoOtro: ' Derrame de combustible ', detalle: 'Hay gasoil en la vía', ubicacionTexto: '' })
  assert.deepEqual(cuerpo, { kind: 'other', kindOther: 'Derrame de combustible', detail: 'Hay gasoil en la vía' })
  assert.equal(cuerpoEmergencia({ tipo: 'salud', tipoOtro: 'x', detalle: 'Mareo', ubicacionTexto: '' }).kindOther, undefined)
  const e = emergenciaDelConductor({ ...AVISO_FOM, kind: 'other', kindOther: 'Derrame de combustible', status: 'acknowledged', acknowledgedByUserId: 's-1' })
  assert.equal(etiquetaEmergencia(e), 'Derrame de combustible')
  assert.equal(e.estado, 'atendida')
  assert.equal(e.atendidaPor, 'Tu supervisor')
  assert.equal(etiquetaEmergencia({ tipo: 'salud' }), 'Salud')
})

// ---------------------------------------------------------------- SOS demo

test('sos demo: lo que manda el conductor le llega al supervisor, que lo toma, y el conductor lo cierra', async () => {
  const { sosSemilla: sos, seguridadSemilla: seguridad, iniciarSesion } = await demo()
  const entrar = (usuario, clave) => iniciarSesion({ usuario, clave })
  await entrar('conductor@fom.com.ve', 'ConductorFOM2026')
  assert.equal(await sos.miEmergencia(), null)
  const e = await sos.enviar({ vehiculoId: 'veh-001', tipo: 'accidente', detalle: 'Volqué en la curva', ubicacionTexto: '10.1, -71.5', coords: { lat: 10.1, lng: -71.5 } })
  assert.equal(e.estado, 'activa')
  assert.equal(e.creadorId, 'usr-002')
  // Un segundo envío es el mismo aviso.
  assert.equal((await sos.enviar({ tipo: 'salud', detalle: 'Otra vez' })).id, e.id)

  await entrar('supervisor@fom.com.ve', 'FlotaFOM2026')
  const activas = await seguridad.emergencias({ estado: 'active' })
  assert.equal(activas.length, 1)
  assert.equal(activas[0].tipo, 'accident')
  assert.equal(activas[0].detalle, 'Volqué en la curva\nDónde: 10.1, -71.5')
  assert.equal(activas[0].reportadaPor, 'usr-002')
  await seguridad.reconocerEmergencia(e.id)
  assert.equal((await seguridad.emergencias({ estado: 'acknowledged' })).length, 1)

  await entrar('conductor@fom.com.ve', 'ConductorFOM2026')
  const tomada = await sos.miEmergencia()
  assert.equal(tomada.estado, 'atendida')
  assert.equal(tomada.atendidaPor, 'Yeison Márquez')
  await assert.rejects(sos.cancelar(tomada), /ya lo tomó/u, 'con alguien yendo, ya no se retira')
  await sos.terminar(tomada)
  assert.equal(await sos.miEmergencia(), null)
  assert.equal((await seguridad.emergencias({ estado: 'resolved' })).length, 1)
})

test('sos demo: una falsa alarma se retira mientras nadie la toma', async () => {
  const { sosSemilla: sos, seguridadSemilla: seguridad, iniciarSesion } = await demo()
  const entrar = (usuario, clave) => iniciarSesion({ usuario, clave })
  await entrar('conductor@fom.com.ve', 'ConductorFOM2026')
  const e = await sos.enviar({ tipo: 'seguridad', detalle: 'Me siguen' })
  await sos.cancelar(e)
  assert.equal(await sos.miEmergencia(), null)
  assert.equal((await seguridad.emergencias({ estado: 'cancelled' })).length, 1)
})

// ---------------------------------------------------------------- otra unidad

test('otra unidad conectado: sus unidades de /drivers/me, el PIN abre la sesión y dejarla la cierra', async () => {
  const original = globalThis.fetch
  try {
    const { otraUnidad } = await conectado()
    const llamadas = servidor((url, metodo) => {
      if (url.includes('/drivers/me')) {
        return { cuerpo: { items: [
          { assignmentId: 'a1', role: 'principal', vehicleId: 'v1', vehicleCode: 'U-001', vehiclePlate: 'A1' },
          { assignmentId: 'a2', role: 'secundario', vehicleId: 'v2', vehicleCode: 'U-002', vehiclePlate: null },
        ], page: { limit: 100, offset: 0, count: 2, total: 2 } } }
      }
      if (url.endsWith('/driver-sessions/current')) return { cuerpo: { session: { id: 's-9', vehicleId: 'v2', assignmentRole: 'secundario', status: 'active' } } }
      if (url.includes('/vehicles/v2/driver-sessions')) return { estado: 401, cuerpo: { code: 'invalid_driver_pin', message: 'Invalid PIN' } }
      return { cuerpo: {} }
    })
    assert.deepEqual(await otraUnidad.unidades(), [{ vehiculoId: 'v2', nombre: 'U-002', placa: null }])
    assert.match(llamadas[0].url, /^\/fom-api\/api\/v1\/mobile\/drivers\/me\?limit=100&offset=0$/u)

    await assert.rejects(otraUnidad.usar('v2', ' 1234 '), /PIN incorrecto para esta unidad/u)
    const toma = llamadas.at(-1)
    assert.equal(toma.url, '/fom-api/api/v1/mobile/vehicles/v2/driver-sessions')
    assert.deepEqual(toma.cuerpo, { pin: '1234' })

    assert.deepEqual(await otraUnidad.sesionActual(), { id: 's-9', vehiculoId: 'v2', rol: 'secundario' })
    await otraUnidad.dejar()
    assert.equal(llamadas.at(-1).url, '/fom-api/api/v1/mobile/driver-sessions/s-9/end')
    assert.equal(llamadas.at(-1).metodo, 'POST')
  } finally {
    globalThis.fetch = original
  }
})

test('otra unidad: lo que dice FOM, en palabras de la app', async () => {
  const { errorDeTomarUnidad } = await conectado()
  const con = (estado, message, codigo = null) => Object.assign(new Error(message), { estado, codigo })
  assert.equal(errorDeTomarUnidad(con(403, 'x')).message, 'No estás autorizado en esta unidad.')
  assert.equal(errorDeTomarUnidad(con(409, 'Vehicle already in use')).message, 'Otra persona está usando esa unidad.')
  assert.equal(errorDeTomarUnidad(con(409, 'Driver already has an active session')).message, 'Ya estás usando otra unidad: déjala primero.')
})

test('otra unidad demo: secundario de dos unidades, toma una con el PIN y la deja', async () => {
  const { otraUnidadSemilla: ou, iniciarSesion } = await demo()
  const entrar = (usuario, clave) => iniciarSesion({ usuario, clave })
  await entrar('conductor@fom.com.ve', 'ConductorFOM2026')
  const unidades = await ou.unidades()
  assert.equal(unidades.length, 2)
  assert.equal(await ou.sesionActual(), null)
  await assert.rejects(ou.usar(unidades[0].vehiculoId, '12'), /PIN incorrecto/u)
  await ou.usar(unidades[0].vehiculoId, '4821')
  assert.deepEqual({ ...(await ou.sesionActual()), id: 'x' }, { id: 'x', vehiculoId: unidades[0].vehiculoId, rol: 'secundario' })
  await assert.rejects(ou.usar(unidades[1].vehiculoId, '4821'), /déjala primero/u)
  await ou.dejar()
  assert.equal(await ou.sesionActual(), null)
})

// ---------------------------------------------------------------- reglas de las pantallas

test('pantallas: «Otro» pide nombre, el PIN de 4 a 8 dígitos, y los tiempos como la app', async () => {
  const p = await pantallas()
  assert.equal(p.validarTipoOtro(''), 'Escribe qué tipo de emergencia es.')
  assert.equal(p.validarTipoOtro('12345'), 'Ponle nombre, no solo números.')
  assert.equal(p.validarTipoOtro('Derrame'), null)
  assert.equal(p.errorDePin('12'), 'El PIN tiene de 4 a 8 dígitos.')
  assert.equal(p.errorDePin(' 4821 '), null)
  const t0 = Date.parse('2026-10-26T12:00:00Z')
  assert.equal(p.duracionAviso('2026-10-26T12:00:00Z', t0 + 20_000), '20 s')
  assert.equal(p.duracionAviso('2026-10-26T12:00:00Z', t0 + 90 * 60_000), '1 h 30 min')
  assert.equal(p.haceCuanto('2026-10-26T12:00:00Z', t0 + 3 * 60_000), 'hace 3 min')
})

// ---------------------------------------------------------------- navegación y remates

test('navegación: SOS y otra unidad del conductor; la campana de escritorio cuenta SUS avisos', () => {
  const consola = leer('src/panel/Consola.jsx')
  assert.match(consola, /<Route path="sos" element=\{area === 'conductor' \? <SosConductor \/>/u)
  assert.match(consola, /<Route path="otra-unidad" element=\{area === 'conductor' \? <OtraUnidad \/>/u)
  assert.match(consola, /\.concat\(\['sos', 'otra-unidad'\]\)/u)
  assert.match(consola, /a: '\/panel\/sos', icono: 'llamar', texto: 'Emergencia \(SOS\)'.*soloEscritorio: true/u)
  assert.match(consola, /useAvisosConductor\(sesion\?\.perfil, \{ activo: esConductor/u)
  assert.match(consola, /const avisos = esConductor \? suyos\.noLeidas : sinLeer/u)
  assert.match(consola, /\{avisos > 0 && <span>\{avisos\}<\/span>\}/u, 'el número de arriba')
  assert.match(consola, /sinLeer=\{avisos\}\n {6}\/>/u, 'el globo del menú lateral')

  const perfil = leer('src/panel/modulos/MiPerfilMovil.jsx')
  assert.match(perfil, /texto: 'Otra unidad'.*navegar\('\/panel\/otra-unidad'\)/u)
  assert.match(perfil, /const suyos = useAvisosConductor\(sesion\)\n {2}const sinLeer = suyos\.noLeidas/u)

  const unidadMovil = leer('src/panel/modulos/MiUnidadMovil.jsx')
  assert.match(unidadMovil, /<BotonSos /u)
  assert.doesNotMatch(unidadMovil, /desde la web no se puede registrar/u)
  assert.match(unidadMovil, /to="\/panel\/inspeccion"/u)
  const unidad = leer('src/panel/modulos/MiUnidad.jsx')
  assert.doesNotMatch(unidad, /se hace desde la app/u)
  assert.match(unidad, /to="\/panel\/inspeccion"/u)
  assert.match(unidad, /to="\/panel\/sos"/u)
})

test('inspección: la colección sale de repo.js y el detalle del supervisor lee lo enviado', () => {
  const repo = leer('src/panel/datos/repo.js')
  assert.match(repo, /inspeccionConductor: repoApi\.inspeccionConductor/u)
  assert.match(repo, /inspeccionConductor: inspeccionConductorSemilla/u)
  const pantalla = leer('src/panel/modulos/InspeccionConductor.jsx')
  assert.match(pantalla, /const datos = repo\.inspeccionConductor/u)
  assert.doesNotMatch(pantalla, /from '\.\.\/datos\/repoSemilla'/u)
  assert.doesNotMatch(pantalla, /Revisa tu unidad antes de salir\. Si algo/u, 'la bajada no se repite en el párrafo')
  const inspecciones = leer('src/panel/modulos/Inspecciones.jsx')
  assert.match(inspecciones, /insp\.detalle\?\.respuestas/u)
})
