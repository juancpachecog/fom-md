// Imágenes en Cloudinary: fotos de unidades, documentos y perfiles.
//
// FOM no guarda imágenes. Cada foto vive en Cloudinary bajo una DIRECCIÓN BASE que lleva el id de FOM de lo que
// retrata (`fom/vehiculo/<id>`, `fom/avatar/<userId>`, `fom/documento/<id>/<cara>`).
//
// Cloudinary NO deja sobrescribir en una subida sin firma (devuelve la foto que ya existe), así que reemplazar se
// hace con VERSIONES NUMERADAS: la primera foto es `<base>/1`, la siguiente `<base>/2`, y la vigente es la de número
// más alto. Para saber cuál es, se prueba si existen (una consulta liviana por foto, con búsqueda por saltos), así no
// hace falta la «lista de recursos» ni ningún dato en el servidor. Nada se borra: lo anterior solo deja de mostrarse.
//
// La subida usa un UPLOAD PRESET SIN FIRMA (unsigned): en el navegador no puede haber ningún secreto.
//   VITE_CLOUDINARY_CLOUD_NAME=<nombre de la nube>
//   VITE_CLOUDINARY_UPLOAD_PRESET=<preset unsigned, con Overwrite activado>

let nube = import.meta.env?.VITE_CLOUDINARY_CLOUD_NAME || ''
let preset = import.meta.env?.VITE_CLOUDINARY_UPLOAD_PRESET || ''

/** Solo para pruebas: fija las credenciales sin pasar por `.env`. */
export function configurarCloudinary(datos = {}) {
  nube = datos.nube ?? ''
  preset = datos.preset ?? ''
}

/** ¿Hay nube y preset en el entorno? Sin ellos la web lo dice y no sube nada. */
export function cloudinaryConfigurado() {
  return Boolean(nube && preset)
}

/** Dirección fija de cada foto. Subir otra con la misma dirección la reemplaza. */
export const ids = {
  vehiculo: (id) => `fom/vehiculo/${id}`,
  avatar: (userId) => `fom/avatar/${userId}`,
  /** Un documento tiene dos caras: «frente» y «reverso». */
  documento: (id, cara) => `fom/documento/${id}/${cara}`,
}

/** Etiquetas (tags) que también se ponen al subir: la app del conductor las usa para encontrar sus fotos. */
export const etiquetas = {
  documento: (id) => `fom_documento_${id}`,
  vehiculo: (id) => `fom_vehiculo_${id}`,
  avatar: (userId) => `fom_avatar_${userId}`,
}

// Cuando se reemplaza una foto, el navegador y la red de Cloudinary pueden seguir mostrando la anterior. Un número
// al final de la dirección fuerza a pedirla de nuevo; cambia al abrir la web y cada vez que se sube una foto aquí.
let version = Date.now()
let ultimaSubida = 0
const oyentes = new Set()
export function alCambiarFotos(f) {
  oyentes.add(f)
  return () => oyentes.delete(f)
}
function avisarCambio() {
  version = Date.now()
  ultimaSubida = version
  oyentes.forEach((f) => f(version))
}

// --- Versiones numeradas -----------------------------------------------------
const memoria = new Map() // base -> Promise<número de la foto vigente (0 si no hay)>

const pista = (base) => {
  try { return Number(globalThis.localStorage?.getItem(`fom_foto_${base}`)) || 0 } catch { return 0 }
}
const guardarPista = (base, n) => {
  try { globalThis.localStorage?.setItem(`fom_foto_${base}`, String(n)) } catch { /* sin almacenamiento: no pasa nada */ }
}

/** ¿Existe esa foto en Cloudinary? Consulta liviana (solo cabeceras). */
async function existe(publicId) {
  try {
    const r = await fetch(`https://res.cloudinary.com/${nube}/image/upload/${publicId}?p=${Date.now()}`, { method: 'HEAD' })
    return r.ok
  } catch {
    return false
  }
}

/** Busca el número más alto que existe: parte de lo último que se vio y avanza por saltos (1, 2, 4…) y luego afina. */
async function buscarUltima(base) {
  let n = pista(base)
  if (n > 0 && !(await existe(`${base}/${n}`))) n = 0
  if (n === 0) {
    if (!(await existe(`${base}/1`))) return 0
    n = 1
  }
  let paso = 1
  while (await existe(`${base}/${n + paso}`)) { n += paso; paso *= 2 }
  let bajo = n
  let alto = n + paso
  while (alto - bajo > 1) {
    const medio = Math.floor((bajo + alto) / 2)
    if (await existe(`${base}/${medio}`)) bajo = medio
    else alto = medio
  }
  return bajo
}

/** El número de la foto vigente de una dirección base (0 si todavía no hay ninguna). Se recuerda por sesión. */
export function ultimaVersion(base) {
  if (!nube || !base) return Promise.resolve(0)
  if (!memoria.has(base)) {
    memoria.set(base, buscarUltima(base).then((n) => { if (n) guardarPista(base, n); return n }))
  }
  return memoria.get(base)
}

/** La dirección completa de la foto vigente (`<base>/<n>`), o `null` si todavía no hay foto. */
export async function idVigente(base) {
  const n = await ultimaVersion(base)
  return n ? `${base}/${n}` : null
}

/** Solo para pruebas: olvida lo recordado. */
export function olvidarFotos() {
  memoria.clear()
}

/** ¿Se subió una foto desde esta web hace poco? Justo después, Cloudinary tarda un instante en servirla. */
export function huboSubidaReciente(ms = 45_000) {
  return Date.now() - ultimaSubida < ms
}

// Quitar el fondo lo hace Cloudinary AI (`e_background_removal`, un complemento de la cuenta). Si la cuenta no lo
// tiene activo o la foto no se puede procesar (por ejemplo, menos de 64x64), Cloudinary responde con error: la web lo
// detecta una vez, deja de pedirlo y muestra la foto normal. Nunca se queda sin foto.
// OJO: es un complemento de PAGO (consume cupo/créditos de la cuenta). Por eso viene APAGADO y se enciende a propósito con
// VITE_CLOUDINARY_SIN_FONDO=1. Apagado, la ficha muestra la foto normal en un marco ordenado y no gasta nada.
let fondoDisponible = ['1', 'si', 'true'].includes(String(import.meta.env?.VITE_CLOUDINARY_SIN_FONDO ?? '').toLowerCase())
export function quitarFondoDisponible() {
  return fondoDisponible
}
export function desactivarQuitarFondo() {
  fondoDisponible = false
}

/**
 * La URL pública optimizada. `ajuste: 'contener'` limita el tamaño sin recortar la imagen ni aumentar la resolución.
 * El valor predeterminado conserva el recorte de los avatares. Con `sinFondo`, el
 * carro viene recortado sobre fondo transparente (sin recorte al marco: se respeta su silueta completa).
 */
export function urlDe(publicId, ancho = 480, alto = 0, { sinFondo = false, ajuste = 'recortar' } = {}) {
  if (!nube || !publicId) return ''
  if (sinFondo && fondoDisponible) {
    return `https://res.cloudinary.com/${nube}/image/upload/e_background_removal/f_auto,q_auto,w_${ancho},c_limit/${publicId}?v=${version}`
  }
  const t = ['f_auto', 'q_auto', `w_${ancho}`, ...(alto ? [`h_${alto}`] : []),
    ...(alto && ajuste !== 'contener' ? ['c_fill', 'g_auto'] : ['c_limit'])].join(',')
  return `https://res.cloudinary.com/${nube}/image/upload/${t}/${publicId}?v=${version}`
}

/** La misma foto sin recortar, para abrirla completa. */
export function urlOriginal(publicId) {
  return nube && publicId ? `https://res.cloudinary.com/${nube}/image/upload/${publicId}?v=${version}` : ''
}

/** Lo más que se espera una subida antes de darla por perdida. */
const TIEMPO_LIMITE = 45_000
const MAX_MB = 10
const TIPOS = /^image\/(jpeg|png|webp|gif|heic|heif)$/i

/** Dice qué le pasa a un archivo que no se puede subir, o `null` si está bien. Con `permitirPdf`, también acepta PDF. */
export function problemaDelArchivo(archivo, { permitirPdf = false } = {}) {
  if (!archivo) return 'No hay archivo.'
  const esPdf = permitirPdf && /^application\/pdf$/i.test(archivo.type || '')
  if (!esPdf && !TIPOS.test(archivo.type || '')) {
    return permitirPdf
      ? `«${archivo.name}» no es una imagen ni un PDF (JPG, PNG, WebP, HEIC o PDF).`
      : `«${archivo.name}» no es una imagen (JPG, PNG, WebP o HEIC).`
  }
  if (archivo.size > MAX_MB * 1024 * 1024) return `«${archivo.name}» pesa más de ${MAX_MB} MB.`
  return null
}

/**
 * Sube UNA imagen como la versión siguiente de su dirección base (`publicId`) y la deja como la vigente. Lanza un
 * Error con el motivo si no se pudo: la pantalla no debe decir «guardado» si la foto no llegó.
 */
export async function subirImagen(archivo, { publicId: base, etiqueta, titulo, permitirPdf = false } = {}) {
  if (!cloudinaryConfigurado()) throw new Error('Cloudinary no está configurado en esta web.')
  if (!base) throw new Error('Falta saber a qué pertenece la foto.')
  const mal = problemaDelArchivo(archivo, { permitirPdf })
  if (mal) throw new Error(mal)

  let n = (await ultimaVersion(base)) + 1
  // Si alguien subió otra foto al mismo tiempo, Cloudinary devuelve la que ya existía (`existing`): se pasa a la siguiente.
  for (let intento = 0; intento < 4; intento += 1, n += 1) {
    const cuerpo = new FormData()
    cuerpo.append('file', archivo)
    cuerpo.append('upload_preset', preset)
    cuerpo.append('public_id', `${base}/${n}`)
    if (etiqueta) cuerpo.append('tags', etiqueta)
    // `|` y `=` separan los pares del contexto: dentro de un título lo romperían.
    if (titulo) cuerpo.append('context', `caption=${String(titulo).replace(/[|=]/g, ' ')}`)

    const corte = new AbortController()
    const reloj = setTimeout(() => corte.abort(), TIEMPO_LIMITE)
    let respuesta
    try {
      respuesta = await fetch(`https://api.cloudinary.com/v1_1/${nube}/image/upload`, { method: 'POST', body: cuerpo, signal: corte.signal })
    } catch {
      throw new Error('No se pudo subir la foto. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      clearTimeout(reloj)
    }
    if (!respuesta.ok) {
      const detalle = await respuesta.json().then((j) => j?.error?.message).catch(() => null)
      throw new Error(detalle ? `Cloudinary rechazó la foto: ${detalle}` : 'Cloudinary rechazó la foto.')
    }
    const json = await respuesta.json()
    if (json.existing) continue
    if (!json.secure_url) throw new Error('Cloudinary no devolvió la dirección de la foto.')
    // La nueva es la vigente: se recuerda sin tener que volver a buscarla.
    memoria.set(base, Promise.resolve(n))
    guardarPista(base, n)
    avisarCambio()
    return json.secure_url
  }
  throw new Error('No se pudo guardar la foto: hubo cambios al mismo tiempo. Inténtalo de nuevo.')
}
