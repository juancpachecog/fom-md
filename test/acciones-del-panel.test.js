import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'vite'

// ============================================================
// Ningún botón puede llamar a algo que no existe
// ------------------------------------------------------------
// El panel llama al repositorio como `repo.coleccion.accion(...)`. En modo
// conectado ese repositorio se arma mezclando lo real con avisos, y una acción
// que se quede fuera de la mezcla no da error de compilación: queda como
// `undefined` y revienta al pulsar el botón con «no es una función».
//
// Ese mensaje no le dice nada a quien lo lee —ni si el problema es suyo, ni si
// es de permisos, ni si la función existe en algún lado—. Esta prueba carga el
// repositorio DE VERDAD, en modo conectado, y comprueba que cada acción que la
// interfaz invoca resuelve a una función. Lo que no tenga respaldo debe fallar
// con su motivo, que es muy distinto de no existir.
// ============================================================

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')

/** Todas las llamadas `repo.x.y(` que hace la interfaz del panel. */
function accionesInvocadas() {
  const encontradas = new Set()
  const recorrer = (dir) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name)
      if (entrada.isDirectory()) recorrer(ruta)
      else if (/\.jsx?$/u.test(entrada.name)) {
        const fuente = readFileSync(ruta, 'utf8')
        for (const m of fuente.matchAll(/\brepo\.((?:[a-zA-Z]+\.)*[a-zA-Z]+)\(/gu)) {
          encontradas.add(m[1])
        }
      }
    }
  }
  recorrer(join(raiz, 'src/panel'))
  return [...encontradas].sort()
}

/**
 * El repositorio en modo CONECTADO. Se compila con Vite porque el módulo lee
 * `import.meta.env`, y se evalúa en memoria: sin esto la prueba comprobaría el
 * modo semilla, que es justo el que nunca falla.
 */
async function repositorioConectado() {
  const salida = await build({
    root: raiz,
    logLevel: 'error',
    define: { 'import.meta.env.VITE_FOM_API': JSON.stringify('/fom-api') },
    build: {
      write: false,
      lib: {
        entry: join(raiz, 'src/panel/datos/repo.js'),
        formats: ['es'],
        fileName: 'repo',
      },
    },
  })
  const codigo = salida[0].output[0].code
  const modulo = await import(
    'data:text/javascript;base64,' + Buffer.from(codigo).toString('base64')
  )
  return modulo.repo
}

test('contratos verificados: vínculos, identificadores, ciclos, fechas y errores visibles', async () => {
  const repo = await repositorioConectado()
  const original = globalThis.fetch
  const llamadas = []
  try {
    globalThis.fetch = async (url, opts = {}) => {
      llamadas.push({ url, body: JSON.parse(opts.body || '{}') })
      const data = url.endsWith('/vehicles') ? { vehicleId: 'vehiculo-real' } : url.endsWith('/tenants') ? { tenantId: 'empresa-real' } : { workOrder: { id: 'odt-real' } }
      return new Response(JSON.stringify(data), { status: 200 })
    }
    assert.equal((await repo.vehiculos.crear({ alias: 'QA' })).id, 'vehiculo-real')
    assert.equal((await repo.admin.empresas.crear({ nombre: 'QA', tipo: 'estandar' })).id, 'empresa-real')
    await repo.planes.odtDesdeAccion({ id: 'accion', vehiculoId: 'vehiculo', titulo: 'QA' })
    assert.equal(llamadas.at(-1).body.maintenanceActionId, 'accion')
    await assert.rejects(repo.planes.crearAccion({ vehiculoId: 'v', tipo: 'preventive', venceKm: 1000 }), /plan y un número de ciclo/)
    await repo.planes.crearAccion({ vehiculoId: 'v', planId: 'p', ciclo: 2, titulo: 'QA', venceKm: 0, costo: 0 })
    assert.equal(llamadas.at(-1).body.cycleOrdinal, 2)
    assert.equal(llamadas.at(-1).body.costAmount, 0)
    assert.equal(llamadas.at(-1).body.dueOdometerKm, 0)
    await repo.programaInspecciones.programar({ fecha: '2026-10-01T12:00:00.000Z' })
    assert.equal(llamadas.at(-1).body.scheduledFor, '2026-10-01')
    await repo.reglas.crear({ tipo: 'velocidad', umbralKmh: 90, vehiculoIds: ['v'] })
    assert.deepEqual(llamadas.at(-1).body.vehicleIds, ['v'])
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Fallo comprobable' }), { status: 500 })
    for (const fn of [repo.odts.listar, repo.documentos.listar, repo.inspecciones.listar, repo.reglas.listar, repo.alertas.listar]) await assert.rejects(fn(), /Fallo comprobable/)
  } finally { globalThis.fetch = original }
})

test('Costos conectado usa sesión, empresa y gastos reales; no semilla ni escrituras', async () => {
  const repo = await repositorioConectado()
  const original = globalThis.fetch
  const llamadas = []
  const id = '11111111-1111-4111-8111-111111111111'
  try {
    globalThis.fetch = async (ruta, opciones = {}) => {
      llamadas.push({ ruta, opciones })
      const u = new URL(ruta, 'https://ejemplo.test')
      let data
      if (u.pathname.endsWith('/auth/session')) data = { user: { tenantId: id } }
      else if (u.pathname.endsWith(`/tenants/${id}`)) data = { tenant: { id, timezone: 'UTC' } }
      else if (u.pathname.endsWith('/fleet-expenses')) data = {
        items: [{ id: 'g1', amount: '7.25', currency: 'EUR', category: 'fuel', expenseDate: u.searchParams.get('to') }],
        page: { offset: 0, limit: 200, count: 1, total: 1 },
        range: { from: u.searchParams.get('from'), to: u.searchParams.get('to'), timezone: 'UTC' },
      }
      else throw new Error('Ruta inesperada')
      return new Response(JSON.stringify(data), { status: 200 })
    }
    const r = await repo.costos.resumen()
    assert.equal(r.movimientos, 1)
    assert.equal(r.porMoneda[0].total, '7.25')
    assert.equal(r.porMoneda[0].moneda, 'EUR')
    assert.equal(r.costoPorKm, null)
    assert.equal(llamadas.length, 3)
    assert.ok(llamadas.every(c => c.opciones.method === 'GET' && !c.opciones.body))
    await assert.rejects(repo.costos.crear({}), /no está integrada/)
    assert.equal(llamadas.length, 3)
    globalThis.fetch = async () => new Response('{}', { status: 503 })
    await assert.rejects(repo.costos.resumen())
  } finally { globalThis.fetch = original }
})

test('toda acción que invoca el panel existe en el repositorio conectado', async () => {
  const repo = await repositorioConectado()
  const acciones = accionesInvocadas()
  assert.ok(acciones.length > 20, 'no se detectaron las llamadas del panel')

  const rotas = []
  for (const ruta of acciones) {
    let nodo = repo
    for (const parte of ruta.split('.')) {
      nodo = nodo?.[parte]
      if (nodo === undefined) break
    }
    if (typeof nodo !== 'function') {
      rotas.push(`${ruta} → ${nodo === undefined ? 'NO EXISTE' : typeof nodo}`)
    }
  }
  assert.deepEqual(rotas, [], `acciones sin respaldo:\n  ${rotas.join('\n  ')}`)
})

test('lo que no tiene servidor avisa sin salir a la red', async () => {
  const repo = await repositorioConectado()

  // Estas NO tienen superficie en el servidor. Cada una debe rechazar con su
  // motivo propio y, sobre todo, SIN intentar la petición: si saliera a la
  // red, el usuario vería un fallo de conexión en vez de la explicación, que
  // es un diagnóstico falso.
  //
  // Si alguna empieza a existir, hay que sacarla de aquí; si otra deja de
  // existir, hay que meterla. Esa es la parte útil de la lista.
  const sinServidor = [
    ['documentos.subir', () => repo.documentos.subir('d', {})],
    ['admin.gps.verificar', () => repo.admin.gps.verificar('g')],
    ['admin.gps.probarPanico', () => repo.admin.gps.probarPanico('g')],
    ['admin.usuarios.eliminarDefinitivo', () => repo.admin.usuarios.eliminarDefinitivo('u')],
    ['admin.usuarios.mover', () => repo.admin.usuarios.mover('u', 'e')],
    ['costos.registrar', () => repo.costos.registrar({})],
  ]

  const original = globalThis.fetch
  try {
    for (const [nombre, llamar] of sinServidor) {
      let saliUALaRed = false
      globalThis.fetch = async () => {
        saliUALaRed = true
        throw new Error('no debería haberse llamado')
      }
      await assert.rejects(llamar(), (error) => {
        assert.equal(
          saliUALaRed,
          false,
          `${nombre} salió a la red en vez de explicar que no existe`,
        )
        assert.ok(
          error.message.length > 40,
          `${nombre} falla con un mensaje demasiado corto para explicar nada`,
        )
        assert.ok(
          !/int[eé]ntalo otra vez/iu.test(error.message),
          `${nombre} invita a repetir algo que no puede funcionar`,
        )
        return true
      }, nombre)
    }
  } finally {
    globalThis.fetch = original
  }
})

test('lo que sí tiene servidor sale a la red, no se queda en un aviso', async () => {
  const repo = await repositorioConectado()

  // La otra mitad de la anterior, y la que de verdad se rompió: una acción
  // real que quede envuelta en un aviso pasa desapercibida, porque el panel
  // sigue “funcionando” — solo que sin hacer nada.
  const conServidor = [
    ['vehiculos.crear', () => repo.vehiculos.crear({ alias: 'a', placa: 'b' })],
    ['vehiculos.asignarConductor', () => repo.vehiculos.asignarConductor('v', 'u')],
    ['odts.crear', () => repo.odts.crear({ vehiculoId: 'v', descripcion: 'una falla descrita' })],
    ['odts.mover', () => repo.odts.mover('o', { estadoEsperado: 'abierta', estado: 'cerrada', nota: 'x' })],
    ['admin.usuarios.cambiar', () => repo.admin.usuarios.cambiar('u', { rol: 'supervisor' })],
    ['admin.empresas.crear', () => repo.admin.empresas.crear({ nombre: 'n', tipo: 'estandar' })],
    ['alertas.marcarLeida', () => repo.alertas.marcarLeida('n')],
    ['alertas.marcarTodasLeidas', () => repo.alertas.marcarTodasLeidas()],
    ['documentos.actualizarVencimiento', () => repo.documentos.actualizarVencimiento('d', '2028-01-31')],
    ['reglas.crear', () => repo.reglas.crear({ tipo: 'velocidad', umbralKmh: 90 })],
    ['admin.gps.registrar', () => repo.admin.gps.registrar({ imei: '860000000000001', modelo: 'GT06N' })],
    ['admin.gps.asociar', () => repo.admin.gps.asociar('g', 'v')],
  ]

  const original = globalThis.fetch
  try {
    for (const [nombre, llamar] of conServidor) {
      let salio = false
      globalThis.fetch = async () => {
        salio = true
        throw new Error('corte deliberado')
      }
      await llamar().catch(() => {})
      assert.ok(salio, `${nombre} no llegó a llamar al servidor`)
    }
  } finally {
    globalThis.fetch = original
  }
})

test('abrir una ODT manda una Idempotency-Key en formato UUID v4', async () => {
  const repo = await repositorioConectado()
  // Desde la publicación del 18 de septiembre de 2026 el servidor responde
  // 400 «Idempotency-Key must be a UUID v4» a toda apertura sin la cabecera.
  // Esta prueba se escribió después de que Marco no pudiera abrir órdenes.
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  const original = globalThis.fetch
  try {
    const claves = []
    globalThis.fetch = async (_url, opciones) => {
      claves.push(opciones?.headers?.['idempotency-key'])
      throw new Error('corte deliberado')
    }
    await repo.odts.crear({ vehiculoId: 'v', descripcion: 'Se calienta al subir', tipo: 'correctiva' }).catch(() => {})
    await repo.odts.crear({ vehiculoId: 'v', descripcion: 'Se calienta al subir', tipo: 'correctiva' }).catch(() => {})
    assert.equal(claves.length, 2)
    for (const c of claves) assert.match(String(c), UUID_V4, `clave inválida: ${c}`)
    assert.notEqual(claves[0], claves[1], 'dos intentos distintos no pueden compartir clave')
  } finally {
    globalThis.fetch = original
  }
})

test('todo motivo que viaja al servidor cumple su patrón', async () => {
  const repo = await repositorioConectado()

  // Las rutas que aceptan `reason` lo validan con ^[a-z0-9][a-z0-9._-]{0,99}$
  // y devuelven 400 ante una frase con espacios. Esta prueba captura el
  // cuerpo que el panel manda y comprueba el patrón, pasando motivos escritos
  // como los escribe una persona. Se encontró al reiniciar una clave real:
  // el servidor rechazó «Reinicio solicitado desde la consola».
  const PATRON = /^[a-z0-9][a-z0-9._-]{0,99}$/u
  const acciones = [
    ['usuarios.cambiarClave', () => repo.admin.usuarios.cambiarClave('u')],
    ['usuarios.suspender', () => repo.admin.usuarios.suspender('u', 'Suspendida desde la consola')],
    ['usuarios.reactivar', () => repo.admin.usuarios.reactivar('u', 'Reactivación por revisión')],
    ['usuarios.eliminar', () => repo.admin.usuarios.eliminar('u')],
    ['usuarios.enviarADesempleados', () => repo.admin.usuarios.enviarADesempleados('u')],
    ['usuarios.cambiar', () => repo.admin.usuarios.cambiar('u', { rol: 'supervisor', motivo: 'Ascenso a supervisor' })],
    ['empresas.setServicio', () => repo.admin.empresas.setServicio('e', false, null, 'Impago del mes')],
    ['empresas.eliminar', () => repo.admin.empresas.eliminar('e', null, 'Cierre de contrato')],
    ['vehiculos.revocarAsignacion', () => repo.vehiculos.revocarAsignacion('a', 'Cambio de conductor')],
  ]

  const original = globalThis.fetch
  try {
    for (const [nombre, llamar] of acciones) {
      let cuerpo = null
      globalThis.fetch = async (_url, opciones) => {
        cuerpo = JSON.parse(opciones?.body ?? '{}')
        throw new Error('corte deliberado')
      }
      await llamar().catch(() => {})
      assert.ok(cuerpo, `${nombre} no envió cuerpo`)
      if (cuerpo.reason !== undefined) {
        assert.match(cuerpo.reason, PATRON, `${nombre} manda un motivo que el servidor rechaza: «${cuerpo.reason}»`)
      }
    }
  } finally {
    globalThis.fetch = original
  }
})

test('administración global conserva empresa destino y nunca reintenta en la empresa de sesión', async () => {
  const repo = await repositorioConectado()
  const original = globalThis.fetch
  const llamadas = []
  try {
    globalThis.fetch = async (url, opts = {}) => {
      llamadas.push({url, body: JSON.parse(opts.body || '{}')})
      return new Response(JSON.stringify({userId:'persona',displayName:'QA',items:[],page:{total:0}}), {status:200})
    }
    await repo.admin.usuarios.cambiar('persona', {rol:'supervisor',empresaId:'empresa-elegida'})
    assert.equal(llamadas.at(-1).url, '/fom-api/api/v1/console/tenants/empresa-elegida/users/persona')
    assert.equal(llamadas.at(-1).body.role, 'supervisor')
    await repo.admin.usuarios.crear({nombre:'QA',email:'qa@example.invalid',rol:'conductor',empresaDestinoId:'otra-empresa'})
    assert.equal(llamadas.at(-1).url, '/fom-api/api/v1/console/tenants/otra-empresa/users')
    await repo.admin.plataforma.personas({empresa:{id:'otra-empresa',nombre:'QA'},limite:50,desde:50})
    assert.match(llamadas.at(-1).url, /tenants\/otra-empresa\/directory\?limit=50&offset=50/)
    let fallos = 0
    globalThis.fetch = async () => { fallos++; return new Response(JSON.stringify({message:'Not found'}),{status:404}) }
    await assert.rejects(repo.admin.usuarios.cambiar('persona',{rol:'supervisor',empresaId:'ajena'}))
    assert.equal(fallos, 1)
  } finally { globalThis.fetch = original }
})
