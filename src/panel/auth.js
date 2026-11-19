// ============================================================
// ACCESO AL PANEL
// ------------------------------------------------------------
// Con la API configurada (`VITE_FOM_API`) esto es autenticación REAL contra
// `fom-core`: usuarios de `fom.users`, clave verificada con argon2 y sesión
// revocable del lado del servidor.
//
// El testigo de sesión NO vive en el navegador. La API lo emite en una cookie
// `__Host-`, que el puente de desarrollo retiene del lado del servidor y
// reenvía como cabecera en cada petición. Por eso aquí no se guarda nada: la
// pregunta "¿hay sesión?" se le hace al servidor con `GET /auth/session`.
//
// Sin API configurada, el sitio sigue funcionando con dos cuentas de
// demostración comparadas en el navegador. No es seguridad: es una vitrina.
//
// `sesionActual()` devuelve:
//   undefined -> todavía se está resolviendo (mostrar cargando)
//   null      -> no hay sesión (mandar a /entrar)
//   {perfil}  -> sesión activa
// ============================================================

import { api, HAY_API, fijarEmpresaGestion } from './datos/api'
import { iniciales as inicialesDe } from './datos/formato'
import { esAdminFom, etiquetaRolSesion, rolCanonico, tipoEmpresaDe } from './roles'
import { olvidarFotos } from './datos/cloudinary'
import { olvidarLogos } from './datos/logos'
import { CUENTAS as CUENTAS_VITRINA } from './cuentasDemo'
import { crearRelojInactividad, INACTIVIDAD_SESION_MS } from './actividadSesion'
import { alCambiarComunicacion } from './datos/eventosComunicacion'

const CLAVE_SESION = 'fom.panel.sesion'
const CLAVE_SALIDA_PENDIENTE = 'fom.session.salida-pendiente'
const CLAVE_GENERACION = 'fom.session.generacion', CLAVE_ACTIVIDAD = 'fom.session.actividad'
let generacionActiva = null
let revisionSesion = 0, detenerVigilancia = () => {}, relojActividad = null
let salidaEnCurso = null, comprobandoConexion = false, canalSesion = null
let pendienteEnMemoria = false, almacenSalidaDisponible = true

/**
 * Traducción de los roles que existen hoy en producción al catálogo del
 * producto. Mismo criterio que `fom.canonical_membership_role()` de la
 * migración de identidad: primero el código entiende los dos juegos de
 * valores, después se migran las filas, y solo al final se retiran los viejos.
 */
// --- Cuentas de demostración (solo sin API) --------------------------------
// Vite cambia `import.meta.env.VITE_FOM_API` por su valor al construir. Con la
// API puesta queda `"/fom-api" ? [] : …`, Rollup descarta la otra rama y el
// módulo con las claves de la vitrina no entra al paquete publicado.
const CUENTAS = import.meta.env.VITE_FOM_API ? [] : CUENTAS_VITRINA

const oyentes = new Set()

// `undefined` = aún resolviendo. Solo ocurre con API real, que pregunta al
// servidor antes de saberlo.
let sesion = HAY_API ? undefined : leerSesionDemo()

function avisar() {
  oyentes.forEach((fn) => fn(sesion))
}

function fijar(nueva) {
  const estabaActiva = Boolean(sesion?.perfil && !sesion.debeCambiarClave)
  if (nueva?.perfil || nueva === null || nueva?.finalizada) fijarEmpresaGestion(nueva?.perfil?.empresaGestion?.id)
  sesion = nueva
  revisionSesion++
  avisar()
  const activa = Boolean(nueva?.perfil && !nueva.debeCambiarClave)
  if (!activa) { detenerVigilancia(); relojActividad = null }
  else if (!estabaActiva) activarVigilancia()
}

// ============================================================
// Modo demostración
// ============================================================
function leerSesionDemo() {
  try {
    const crudo = localStorage.getItem(CLAVE_SESION)
    if (!crudo) return null
    const s = JSON.parse(crudo)
    if (!s?.expira || Date.now() > s.expira) {
      localStorage.removeItem(CLAVE_SESION)
      return null
    }
    return s
  } catch {
    return null
  }
}

function entrarDemo({ usuario, clave, recordar }) {
  const u = String(usuario || '').trim().toLowerCase()
  const c = String(clave || '')
  if (!u || !c) return { ok: false, error: 'Escribe tu usuario y tu clave.' }

  const cuenta = CUENTAS.find((x) => x.usuario.toLowerCase() === u && x.clave === c)
  if (!cuenta) return { ok: false, error: 'Usuario o clave incorrectos.' }

  const duracion = recordar ? 1000 * 60 * 60 * 24 * 7 : 1000 * 60 * 60 * 8
  const nueva = { perfil: cuenta.perfil, inicio: Date.now(), expira: Date.now() + duracion }
  try {
    localStorage.setItem(CLAVE_SESION, JSON.stringify(nueva))
  } catch {
    /* almacenamiento bloqueado: la sesión vive solo en memoria */
  }
  fijar(nueva)
  return { ok: true, perfil: cuenta.perfil }
}

// ============================================================
// Modo real
// ============================================================

/**
 * Arma el perfil que consume la consola.
 *
 * El rol decide qué ve cada quien, incluida la capa de administración de FOM.
 * De dónde sale, por orden de preferencia:
 *
 *   `GET /api/v1/mobile/auth/me` — la puerta PÚBLICA, la misma que usa la app
 *   móvil. Devuelve `tenant: { id, name, role }` y no necesita token interno.
 *   Es a donde debe migrar la consola.
 *
 *   `GET /api/v1/console/auth/session` — la consola pública que devuelve el
 *   rol resuelto por el servidor y la obligación de cambio inicial de clave.
 *
 * Si no llega ningún rol se queda en `null` y `esAdminFom` da false: sin dato,
 * no se abre la administración. Inventar un rol aquí sería abrir una puerta que
 * el servidor no autorizó.
 */
function armarPerfil(usuario) {
  const nombre = usuario?.displayName || usuario?.email || 'Usuario'
  // Rol canónico de FOM-02. Los valores que hoy existen en producción
  // (`owner`, `administrator`, `fleet_manager`, `operator`, `viewer`) se
  // traducen al catálogo del producto; ver `canonical_membership_role` en la
  // migración de identidad, que hace lo mismo del lado de la base.
  const rol = rolCanonico(usuario?.role)
  return {
    id: usuario?.email || 'desconocido',
    nombre,
    correo: usuario?.email || '',
    rol,
    rolNombre: etiquetaRolSesion(rol),
    // El servidor manda el identificador del ente en la sesion pero no su
    // nombre; el nombre se resuelve aparte, contra la lista de entes. Hasta
    // entonces se muestra un texto neutro y NUNCA uno inventado: un nombre de
    // empresa escrito a mano en el codigo es una mentira con buena letra.
    empresa: 'Tu empresa',
    empresaId: usuario?.tenantId ?? null,
    sede: 'Conectado a la base real',
    iniciales: inicialesDe(nombre),
  }
}

/**
 * Pone el nombre real del ente en el perfil. Se hace despues de entrar y sin
 * bloquear: si la lista de entes falla, la sesion sigue valiendo y el nombre
 * queda en el texto neutro. Lo que no se hace es fingir que se sabe.
 */
async function resolverNombreDeEmpresa(perfil) {
  if (!perfil?.empresaId) return perfil
  // La lista de entes es de gestores. Pedirla como conductor es un 403
  // seguro: no se intenta, y el nombre queda en el texto neutro.
  const rol = rolCanonico(perfil.rol)
  if (rol !== 'admin_fom' && rol !== 'supervisor') return perfil
  try {
    const r = await api.entes()
    const mio = (r?.items ?? []).find((t) => t.id === perfil.empresaId)
    // El TIPO de ente decide el area de la sesion (compañia, contratista o
    // personal), asi que viaja junto al nombre.
    return mio
      ? { ...perfil, empresa: mio.name, empresaTipo: tipoEmpresaDe(mio.category) }
      : perfil
  } catch {
    return perfil
  }
}

/** Le pregunta al servidor si hay sesión viva. */
export async function resolverSesion() {
  if (salidaPendiente()) return reintentarSalida()
  if (sesion?.finalizada) return
  const revision = revisionSesion
  try {
    const r = await conBloqueoSesion(async () => {
      const r = await api.sesion()
      if (r?.authenticated && HAY_API) {
        const gen = leerGeneracion() || crypto.randomUUID()
        guardarLocal(CLAVE_GENERACION, gen)
        try { if (!globalThis.localStorage?.getItem(CLAVE_ACTIVIDAD)) guardarLocal(CLAVE_ACTIVIDAD, Date.now()) } catch { /* Optional storage. */ }
        generacionActiva = gen
      }
      return r
    })
    if (revision !== revisionSesion || salidaPendiente()) return
    const perfil = r?.authenticated ? await resolverNombreDeEmpresa(armarPerfil(r.user)) : null
    if (revision !== revisionSesion || salidaPendiente()) return
    if (HAY_API && generacionActiva && leerGeneracion() && generacionActiva !== leerGeneracion()) {
      fijar({ finalizada: { motivo: 'otra-pestana', pendiente: false } }); return
    }
    fijar(
      r?.authenticated
        ? {
            perfil,
            inicio: Date.now(),
            debeCambiarClave: Boolean(r.mustChangePassword),
          }
        : null,
    )
  } catch (error) {
    if (revision !== revisionSesion || salidaPendiente()) return
    if (error.estado === 401) {
      if (actividadGuardada() || sesion?.perfil) await finalizarSesion('sesion', { yaRevocada: true })
      else fijar(null)
    }
    else if (sesion?.perfil || actividadGuardada()) await finalizarSesion('conexion')
    else fijar({ errorConexion: error.message })
  }
}

// ============================================================
// API pública (idéntica para los dos modos)
// ============================================================

/** Sesión activa, `null` si no hay, `undefined` mientras se resuelve. */
export function sesionActual() {
  return sesion
}

/** Perfil activo, o null. */
export function perfilActual() {
  return sesion?.perfil ?? null
}

/** Select a resource company without changing the administrator's identity. */
export async function entrarEmpresa(empresa) {
  if (!esAdminFom(sesion?.perfil)) throw new Error('Solo el administrador FOM puede entrar a otra empresa.')
  if (!empresa?.id) throw new Error('Selecciona una empresa.')
  const anterior = sesion
  if (HAY_API) {
    const contexto = await api.contextoEmpresa(empresa.id)
    if (contexto?.tenantId !== empresa.id) throw new Error('El servidor no confirmó la empresa seleccionada.')
  }
  if (sesion !== anterior || !sesion?.perfil) throw new Error('La sesión cambió. Vuelve a iniciar sesión.')
  const perfil = sesion.perfil
  const original = sesion.perfilGlobal ?? perfil
  fijar({ ...sesion, perfilGlobal: original, perfil: {
    ...perfil, empresaId: empresa.id, empresa: empresa.nombre, empresaTipo: empresa.tipo,
    empresaGestion: { id: empresa.id, nombre: empresa.nombre },
  } })
}

export function salirEmpresa() {
  if (!sesion?.perfilGlobal) return
  const { perfilGlobal, ...resto } = sesion
  fijar({ ...resto, perfil: perfilGlobal })
}

/** Refleja un nombre confirmado por el servidor sin cambiar rol ni alcance. */
export function actualizarNombreSesion(correo, nombre) {
  if (!sesion || sesion.perfil.correo !== correo) return
  const nueva = { ...sesion, perfil: { ...sesion.perfil, nombre, iniciales: inicialesDe(nombre) } }
  if (!HAY_API) {
    try { localStorage.setItem(CLAVE_SESION, JSON.stringify(nueva)) } catch { /* sesión en memoria */ }
  }
  fijar(nueva)
}

/** Suscribe a cambios de sesión. Devuelve la función para desuscribirse. */
export function alCambiar(fn) {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}

/**
 * Inicia sesión. Siempre asíncrona.
 * @returns {Promise<{ok: true, perfil: object} | {ok: false, error: string}>}
 */
export async function iniciarSesion({ usuario, clave, recordar = true }) {
  if (salidaEnCurso) await salidaEnCurso
  if (salidaPendiente()) {
    await reintentarSalida()
    if (salidaPendiente()) return { ok: false, error: 'Primero hay que confirmar el cierre anterior. Revisa la conexión y reintenta.' }
  }
  if (!HAY_API) return entrarDemo({ usuario, clave, recordar })

  const email = String(usuario || '').trim().toLowerCase()
  const password = String(clave || '')
  if (!email || !password) return { ok: false, error: 'Escribe tu usuario y tu clave.' }

  try {
    const r = await conBloqueoSesion(async () => {
      if (salidaPendiente()) throw new Error('Falta confirmar la salida anterior. Reintenta cuando vuelva la conexión.')
      const r = await api.entrar(email, password)
      generacionActiva = crypto.randomUUID()
      guardarLocal(CLAVE_GENERACION, generacionActiva)
      guardarLocal(CLAVE_ACTIVIDAD, Date.now())
      canalSesion?.postMessage({ tipo: 'entrada', generacion: generacionActiva })
      return r
    })
    const perfil = await resolverNombreDeEmpresa(armarPerfil(r?.user))
    if (leerGeneracion() && leerGeneracion() !== generacionActiva) throw new Error('La sesión cambió en otra pestaña. Vuelve a entrar.')
    const debeCambiarClave = Boolean(r?.mustChangePassword)
    fijar({ perfil, inicio: Date.now(), debeCambiarClave })
    return { ok: true, perfil, debeCambiarClave }
  } catch (error) {
    // Un 401 aqui NO es una sesion caida: es que el servidor rechazo el
    // usuario o la clave. Decirle «tu sesion expiro» a quien nunca entro lo
    // manda a buscar el problema donde no esta. Tambien se avisa del bloqueo
    // por intentos, porque es lo siguiente que le va a pasar si insiste.
    if (error?.estado === 401) {
      return {
        ok: false,
        error:
          'Usuario o clave incorrectos. Ojo: tras varios intentos fallidos la ' +
          'cuenta se bloquea un rato; si la acabas de crear, reinicia su clave ' +
          'desde Usuarios y usa la temporal nueva.',
      }
    }
    return { ok: false, error: error.message || 'Usuario o clave incorrectos.' }
  }
}

// --- Salir sin dejar rastro ------------------------------------------------

export const AVISO_SALIDA_FALLIDA =
  'No pudimos cerrar tu sesión en el servidor. Revisa tu conexión e inténtalo de nuevo.'

/**
 * Lo que se queda aunque salga alguien: preferencias de pantalla de este
 * navegador y los datos de la vitrina (sin API, lo que manda el conductor le
 * llega al supervisor por `fom.panel.cambios`).
 */
const SE_QUEDAN = new Set(['fom.panel.modo', 'fom.mapa.prefs', 'fom.demo.estres', 'fom.panel.cambios', 'fom.panel.cambios.estres', CLAVE_SALIDA_PENDIENTE])
const seQueda = (clave) => SE_QUEDAN.has(clave) || clave.startsWith('fom.apariencia.')

/** Claves del panel (`fom…`) y los avisos del conductor (`notis:…`, la misma clave que la app). */
export const esClaveDeSesion = (clave) => typeof clave === 'string' && /^(fom|notis:)/u.test(clave) && !seQueda(clave)

/** Borra de un almacén (localStorage o sessionStorage) lo que dejó la sesión. */
export function borrarClavesDeSesion(almacen) {
  if (!almacen) return
  try {
    const claves = []
    for (let i = 0; i < almacen.length; i += 1) claves.push(almacen.key(i))
    // Se juntan primero: borrar mientras se recorre corre los índices.
    claves.filter(esClaveDeSesion).forEach((clave) => almacen.removeItem(clave))
  } catch {
    /* almacenamiento bloqueado: no hay nada que borrar */
  }
}

/**
 * Borra la base de las hojas de inspección (`fom-hojas`). Si la página aún la
 * tiene abierta, el navegador la borra al cerrar esa conexión (la recarga a
 * /entrar): no se espera más de `espera` ms.
 */
export function borrarBaseHojas(idb = globalThis.indexedDB, espera = 1500) {
  if (!idb?.deleteDatabase) return Promise.resolve()
  return new Promise((listo) => {
    const reloj = setTimeout(listo, espera)
    const fin = () => { clearTimeout(reloj); listo() }
    try {
      const pedido = idb.deleteDatabase('fom-hojas')
      pedido.onsuccess = fin
      pedido.onerror = fin
      pedido.onblocked = fin
    } catch {
      fin()
    }
  })
}

async function borrarRastros() {
  borrarClavesDeSesion(globalThis.localStorage)
  borrarClavesDeSesion(globalThis.sessionStorage)
  // Las memorias de `repoApi` se borran solas al quedar la sesión en null (ver `alCambiar` allí).
  olvidarFotos()
  olvidarLogos()
  await borrarBaseHojas()
}

/**
 * Cierra la sesión y deja el navegador limpio para el siguiente: claves del
 * panel, hojas guardadas y memorias. Luego recarga en /entrar para que no
 * quede nada en memoria. Si el servidor no confirma la salida, la sesión
 * sigue abierta y se avisa: decir «saliste» sin serlo es peor en una
 * computadora compartida.
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export async function cerrarSesion() {
  const generacion = generacionActiva
  try {
    await conBloqueoSesion(async () => {
      if (HAY_API && generacion && leerGeneracion() && leerGeneracion() !== generacion) return
      if (HAY_API) {
        try { await api.salir() } catch (error) { if (error?.estado !== 401) throw error }
      }
      await borrarRastros()
    })
  } catch (error) {
      // 401: el servidor ya no tenía esa sesión, así que salir es cierto.
        // Los botones de «Cerrar sesión» no leen la respuesta: el aviso se muestra aquí.
        globalThis.alert?.(AVISO_SALIDA_FALLIDA)
        return { ok: false, error: AVISO_SALIDA_FALLIDA }
  }
  fijar(null)
  canalSesion?.postMessage({ tipo: 'cerrada', generacion })
  globalThis.location?.replace?.('/entrar')
  return { ok: true }
}

/** ¿La sesión es del administrador de FOM? (rango 4, ve todo el sistema) */
export async function completarCambioInicial({ claveActual, claveNueva }) {
  if (!HAY_API) return { ok: true }
  try {
    await api.cambiarClaveInicial(claveActual, claveNueva)
    // El servidor revoca atomicamente todas las sesiones abiertas con la
    // clave temporal. Esta sesión también termina: hay que volver a entrar
    // con la clave definitiva para obtener un testigo nuevo.
    fijar(null)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error.message || 'No se pudo cambiar la contraseña.' }
  }
}

export { esAdminFom }

/** ¿El acceso está validando contra la base real? Lo muestra la pantalla de acceso. */
export const CONECTADO_A_BD = HAY_API

/** Cuentas de demostración: solo existen cuando NO hay API. */
export const CUENTAS_DEMO = HAY_API
  ? []
  : CUENTAS.map((c) => ({ usuario: c.usuario, clave: c.clave, rol: c.perfil.rolNombre }))
export const CUENTA_DEMO = CUENTAS_DEMO[0]

export function inicioDeSesion(s) {
  if (s?.debeCambiarClave) return '/cambiar-clave-inicial'
  return esAdminFom(s?.perfil) ? '/panel/seleccionar-empresa' : '/panel'
}

function salidaPendiente() {
  if (!almacenSalidaDisponible) return pendienteEnMemoria
  try { return globalThis.localStorage ? globalThis.localStorage.getItem(CLAVE_SALIDA_PENDIENTE) === '1' : pendienteEnMemoria } catch { return pendienteEnMemoria }
}
function marcarSalida(pendiente) {
  pendienteEnMemoria = pendiente
  try {
    if (!globalThis.localStorage) { almacenSalidaDisponible = false; return }
    if (pendiente) globalThis.localStorage?.setItem(CLAVE_SALIDA_PENDIENTE, '1')
    else globalThis.localStorage?.removeItem(CLAVE_SALIDA_PENDIENTE)
  } catch { almacenSalidaDisponible = false }
}
function guardarLocal(clave, valor) { try { globalThis.localStorage?.setItem(clave, String(valor)) } catch { /* Private browser mode. */ } }
function actividadGuardada() { try { return Number(globalThis.localStorage?.getItem(CLAVE_ACTIVIDAD)) > 0 } catch { return false } }
function leerGeneracion() { try { return globalThis.localStorage?.getItem(CLAVE_GENERACION) || null } catch { return null } }
function conBloqueoSesion(fn) {
  return globalThis.navigator?.locks?.request
    ? navigator.locks.request('fom.panel.autenticacion', fn) : Promise.resolve().then(fn)
}

/** Hide immediately; remote revocation is reported separately and never assumed offline. */
export function finalizarSesion(motivo = 'inactividad', { yaRevocada = false, propagar = true } = {}) {
  if (salidaEnCurso) return salidaEnCurso
  const generacion = generacionActiva
  if (HAY_API && generacion && leerGeneracion() && leerGeneracion() !== generacion) {
    fijar({ finalizada: { motivo: 'otra-pestana', pendiente: false } })
    return Promise.resolve({ ok: true })
  }
  marcarSalida(!yaRevocada && HAY_API)
  fijar({ finalizada: { motivo, pendiente: !yaRevocada && HAY_API } })
  if (propagar) canalSesion?.postMessage({ tipo: 'salida', motivo, generacion })
  salidaEnCurso = (async () => {
    const confirmada = await conBloqueoSesion(async () => {
      if (HAY_API && generacion && leerGeneracion() && leerGeneracion() !== generacion) return true
      // A previous tab may already have completed revocation while this one waited.
      if (!yaRevocada && HAY_API && !salidaPendiente()) return true
      let ok = yaRevocada || !HAY_API
      try { if (!ok) { await api.salir(); ok = true } } catch (e) { ok = e?.estado === 401 }
      await borrarRastros()
      // Retain the generation while revocation is pending; no token or identity is stored.
      if (!ok && generacion) guardarLocal(CLAVE_GENERACION, generacion)
      marcarSalida(!ok)
      return ok
    })
    fijar({ finalizada: { motivo, pendiente: !confirmada } })
    return { ok: confirmada }
  })().finally(() => { salidaEnCurso = null })
  return salidaEnCurso
}

export function reintentarSalida() {
  return finalizarSesion(sesion?.finalizada?.motivo || 'conexion', { propagar: false })
}

async function comprobarComunicacion(evento) {
  if (!sesion?.perfil || comprobandoConexion || salidaEnCurso) return
  comprobandoConexion = true
  const previa = sesion
  if (evento.tipo !== 'servidor') fijar({ ...previa, comprobandoConexion: true })
  const revision = revisionSesion, control = new AbortController()
  const timer = setTimeout(() => control.abort(), 5000)
  try {
    const r = await api.sesion({ señal: control.signal })
    if (revision !== revisionSesion) return
    if (!r?.authenticated || r.user?.email !== previa.perfil.correo) await finalizarSesion('sesion', { yaRevocada: !r?.authenticated })
    else if (sesion.comprobandoConexion) fijar(previa)
  } catch (e) {
    if (revision !== revisionSesion) return
    if ([401, 403].includes(e.estado)) await finalizarSesion('sesion', { yaRevocada: e.estado === 401 })
    else if (!e.estado || [500, 502, 503, 504].includes(e.estado)) await finalizarSesion('conexion')
    else if (sesion.comprobandoConexion) fijar(previa)
  } finally { clearTimeout(timer); comprobandoConexion = false }
}

function activarVigilancia() {
  if (!globalThis.document || !globalThis.addEventListener) return
  detenerVigilancia()
  let ultimaActividad
  try { ultimaActividad = Number(globalThis.localStorage?.getItem(CLAVE_ACTIVIDAD)) } catch { /* Use current activity below. */ }
  if (!ultimaActividad || !Number.isFinite(ultimaActividad)) ultimaActividad = Date.now()
  if (ultimaActividad > Date.now() + 2000) ultimaActividad = Date.now() - INACTIVIDAD_SESION_MS
  relojActividad = crearRelojInactividad({ ultimaActividad, autoIniciar: false, alVencer: () => finalizarSesion('inactividad') })
  let ultimoAviso = 0
  const actividad = e => {
    if (!e.isTrusted || document.visibilityState === 'hidden') return
    const ahora = Date.now()
    if (ahora - ultimoAviso < 1000) { relojActividad?.comprobar(); return }
    ultimoAviso = ahora
    if (relojActividad?.actividad()) {
      guardarLocal(CLAVE_ACTIVIDAD, ahora)
      canalSesion?.postMessage({ tipo: 'actividad', instante: ahora, generacion: generacionActiva })
    }
  }
  const comprobar = () => relojActividad?.comprobar()
  const offline = () => finalizarSesion('conexion')
  const eventos = ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel']
  for (const nombre of eventos) globalThis.addEventListener(nombre, actividad, { passive: true })
  globalThis.addEventListener('focus', comprobar)
  globalThis.addEventListener('offline', offline)
  document.addEventListener('visibilitychange', comprobar)
  detenerVigilancia = () => {
    relojActividad?.detener()
    for (const nombre of eventos) globalThis.removeEventListener(nombre, actividad)
    globalThis.removeEventListener('focus', comprobar)
    globalThis.removeEventListener('offline', offline)
    document.removeEventListener('visibilitychange', comprobar)
  }
  relojActividad.comprobar()
}

alCambiarComunicacion(comprobarComunicacion)
if (globalThis.document && globalThis.addEventListener) {
  if (globalThis.BroadcastChannel) {
    canalSesion = new BroadcastChannel('fom.panel.sesion.eventos')
    canalSesion.onmessage = ({ data }) => {
      if (data?.tipo === 'entrada' && data.generacion !== generacionActiva && (sesion?.perfil || sesion === undefined)) {
        fijar({ finalizada: { motivo: 'otra-pestana', pendiente: false } }); return
      }
      if (data?.generacion && data.generacion !== generacionActiva) return
      if (data?.tipo === 'actividad') relojActividad?.actividad(data.instante)
      if (data?.tipo === 'salida' && sesion?.perfil) finalizarSesion('otra-pestana', { propagar: false })
      if (data?.tipo === 'cerrada' && sesion?.perfil) fijar({ finalizada: { motivo: 'otra-pestana', pendiente: false } })
    }
  }
  globalThis.addEventListener('online', () => { if (salidaPendiente() || sesion?.errorConexion) reintentarSalida() })
  globalThis.addEventListener('storage', e => {
    if (e.key === CLAVE_SALIDA_PENDIENTE && e.newValue === '1' && sesion?.perfil) finalizarSesion('otra-pestana', { propagar: false })
    if (e.key === CLAVE_ACTIVIDAD && leerGeneracion() === generacionActiva) relojActividad?.actividad(Number(e.newValue))
  })
}
if (HAY_API) resolverSesion()
else if (sesion?.perfil) activarVigilancia()
