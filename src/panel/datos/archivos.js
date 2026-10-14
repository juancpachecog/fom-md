// ============================================================
// ARCHIVOS DE FOM: fotos y PDF de órdenes, documentos y demás
// ------------------------------------------------------------
// Regla de Marco: los botones siguen los mismos pasos que la app para
// escribir en la base. La app guarda cada archivo en el almacén del
// servidor (`/{colección}/{id}/uploads` → subir los bytes → `complete`),
// con un propósito que dice qué es: `work_order_opening` (fotos del reporte
// de una falla), `work_order_closure` (fotos del trabajo terminado),
// `document_file` (el archivo de un documento), etc.
//
// En producción ese almacén todavía está APAGADO (el servidor responde 503
// `object_storage_unavailable` y las compuertas de Juan exigen que siga así
// hasta que él lo encienda). Mientras tanto, cada archivo se guarda en
// Cloudinary, en una carpeta fija que lleva el id de FOM de lo que acompaña
// (`fom/work-orders/<id>/work_order_opening/1, /2, …`), igual que las fotos
// de unidades, perfiles y documentos que ya existen. El día que el almacén
// se encienda, las subidas nuevas van solas al servidor y la lista muestra
// lo de los dos lados.
// ============================================================
import { HAY_API, pedir } from './api'
import { cloudinaryConfigurado, problemaDelArchivo, subirImagen, ultimaVersion, urlDe, urlOriginal } from './cloudinary'

const CONSOLA = '/api/v1/console'

/** Propósitos que el servidor acepta en cada colección (copiado de fom-core `ALLOWED_PURPOSES`). */
export const PROPOSITOS = Object.freeze({
  'work-orders': ['work_order_opening', 'work_order_closure'],
  documents: ['document_file'],
  inspections: ['inspection_evidence'],
  'driver-notices': ['driver_notice_attachment'],
  'maintenance-actions': ['maintenance_before', 'maintenance_after'],
})

// Las evidencias de inspección y mantenimiento solo pueden ser imágenes en el servidor.
const SOLO_IMAGEN = new Set(['inspections', 'maintenance-actions'])

/** Si el servidor ya dijo que su almacén está apagado, no se le vuelve a preguntar en esta sesión. */
let almacenApagado = false
export function almacenDelServidorApagado() {
  return almacenApagado
}

/** ¿Se puede subir algo desde esta web? (servidor encendido o Cloudinary configurado). */
export function puedeSubirArchivos() {
  return (HAY_API && !almacenApagado) || cloudinaryConfigurado()
}

export const carpetaDe = (coleccion, padreId, proposito) => `fom/${coleccion}/${padreId}/${proposito}`
const etiquetaDe = (coleccion, padreId) => `fom_${coleccion.replace(/-/g, '_')}_${padreId}`

async function sha256Hex(bytes) {
  const resumen = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(resumen)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const esApagado = (e) => e?.estado === 503 || /object_storage_unavailable/u.test(String(e?.message || ''))

/** Los mismos tres pasos que la app. Devuelve el id del objeto, o lanza el error del servidor. */
async function subirAlServidor({ coleccion, padreId, proposito, archivo }) {
  const bytes = await archivo.arrayBuffer()
  const alta = await pedir(`${CONSOLA}/${coleccion}/${padreId}/uploads`, {
    metodo: 'POST',
    idempotente: true,
    cuerpo: { contentType: archivo.type, byteSize: archivo.size, checksumSha256: await sha256Hex(bytes), purpose: proposito },
  })
  const subida = alta?.upload
  const peticion = subida?.request
  if (!subida?.id || !peticion?.url) throw new Error('El servidor no dijo dónde subir el archivo.')
  const puesta = await fetch(peticion.url, {
    method: peticion.method || 'PUT',
    headers: { 'content-type': archivo.type, ...(peticion.requiredHeaders || {}) },
    body: bytes,
  })
  if (!puesta.ok) throw new Error(`No se pudo subir «${archivo.name}» (respuesta ${puesta.status}).`)
  const fin = await pedir(`${CONSOLA}/uploads/${subida.id}/complete`, { metodo: 'POST', cuerpo: {} })
  return fin?.object?.id ?? subida.id
}

/** Qué le pasa a un archivo para esta colección, o null si está bien. */
export function problemaDe(archivo, coleccion) {
  const mal = problemaDelArchivo(archivo, { permitirPdf: !SOLO_IMAGEN.has(coleccion) })
  if (mal) return mal
  if (archivo.size > 25 * 1024 * 1024) return `«${archivo.name}» pesa más de 25 MB.`
  return null
}

/**
 * Sube UN archivo y lo deja asociado a `{ coleccion, padreId }` con su `proposito`.
 * Primero al almacén del servidor (como la app); si está apagado, a Cloudinary.
 */
export async function subirArchivo({ coleccion, padreId, proposito, archivo, titulo = '' }) {
  if (!padreId) throw new Error('Falta saber a qué pertenece el archivo.')
  if (!PROPOSITOS[coleccion]?.includes(proposito)) throw new Error('Ese tipo de archivo no corresponde aquí.')
  const mal = problemaDe(archivo, coleccion)
  if (mal) throw new Error(mal)

  if (HAY_API && !almacenApagado) {
    try {
      const id = await subirAlServidor({ coleccion, padreId, proposito, archivo })
      return { via: 'servidor', id }
    } catch (e) {
      if (!esApagado(e)) throw e
      almacenApagado = true
    }
  }
  if (!cloudinaryConfigurado()) {
    throw new Error('No hay dónde guardar archivos: el almacén del servidor está apagado y Cloudinary no está configurado en esta web.')
  }
  const url = await subirImagen(archivo, {
    publicId: carpetaDe(coleccion, padreId, proposito),
    etiqueta: etiquetaDe(coleccion, padreId),
    titulo: titulo || archivo.name,
    permitirPdf: !SOLO_IMAGEN.has(coleccion),
  })
  return { via: 'cloudinary', url }
}

/** Sube varios archivos uno tras otro. Devuelve cuántos se subieron y los errores, sin cortar en el primero. */
export async function subirVarios({ coleccion, padreId, proposito, archivos }) {
  const errores = []
  let subidos = 0
  for (const archivo of archivos) {
    try {
      await subirArchivo({ coleccion, padreId, proposito, archivo })
      subidos += 1
    } catch (e) {
      errores.push(e?.message || `No se pudo subir «${archivo.name}».`)
    }
  }
  return { subidos, errores }
}

// --- Leer lo que hay -----------------------------------------------------

async function tipoEnCloudinary(publicId) {
  try {
    const r = await fetch(`${urlOriginal(publicId)}&h=1`, { method: 'HEAD' })
    if (!r.ok) return null
    return r.headers.get('content-type') || 'image/jpeg'
  } catch {
    return null
  }
}

async function listarCloudinary(coleccion, padreId, proposito) {
  if (!cloudinaryConfigurado()) return []
  const base = carpetaDe(coleccion, padreId, proposito)
  const n = await ultimaVersion(base)
  const ids = Array.from({ length: n }, (_, i) => `${base}/${i + 1}`)
  const tipos = await Promise.all(ids.map(tipoEnCloudinary))
  // Cada número de 1 a n existe (así se calculó n). Si la consulta del tipo falla justo
  // después de subir, se asume foto: la miniatura reintenta sola hasta que aparezca.
  return ids
    .map((id, i) => ({ id, tipo: tipos[i] || '' }))
    .map(({ id, tipo }) => {
      const pdf = /pdf/iu.test(tipo)
      return {
        clave: `c:${id}`,
        via: 'cloudinary',
        pdf,
        miniatura: urlDe(id, 320, 240),
        url: urlOriginal(id),
        nombre: pdf ? 'Documento PDF' : 'Foto',
      }
    })
}

async function listarServidor(coleccion, padreId, proposito) {
  if (!HAY_API) return []
  try {
    const r = await pedir(`${CONSOLA}/${coleccion}/${padreId}/objects?limit=50`)
    return (r?.items ?? [])
      .filter((o) => o.purpose === proposito && o.status === 'available')
      .map((o) => ({
        clave: `s:${o.id}`,
        via: 'servidor',
        objetoId: o.id,
        pdf: /pdf/iu.test(o.contentType || ''),
        nombre: /pdf/iu.test(o.contentType || '') ? 'Documento PDF' : 'Foto',
        creadoEn: o.createdAt,
      }))
  } catch {
    return []
  }
}

/** La dirección temporal para ver un archivo guardado en el servidor. */
export async function urlDelServidor({ coleccion, padreId, objetoId }) {
  const r = await pedir(`${CONSOLA}/${coleccion}/${padreId}/objects/${objetoId}/downloads`, { metodo: 'POST', cuerpo: {}, idempotente: true })
  return r?.request?.url ?? null
}

/** Todo lo que hay para `{ coleccion, padreId, proposito }`, del servidor y de Cloudinary. */
export async function listarArchivos({ coleccion, padreId, proposito }) {
  if (!padreId) return []
  const [servidor, nube] = await Promise.all([
    listarServidor(coleccion, padreId, proposito),
    listarCloudinary(coleccion, padreId, proposito),
  ])
  return [...servidor, ...nube]
}
