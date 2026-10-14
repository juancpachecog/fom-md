import FotosDe from './FotosDe'
import './fotos-identidad.css'

// ============================================================
// FOTOS DE LOS DOCUMENTOS DE UNA PERSONA
// ------------------------------------------------------------
// Cédula (frente y reverso), licencia de conducir (frente y reverso) y
// carta médica. Cada foto vive en una dirección fija con el id de la
// persona (`fom/persona/<userId>/<documento>/<cara>`): la ve igual ella en
// «Mi perfil» que el supervisor en su ficha. Reemplazar sube una versión
// nueva; nada se borra.
//
// El servidor de FOM no tiene todavía dónde guardar la foto de la cédula
// (sus propósitos son licencia y certificado médico, y su almacén está
// apagado en producción), así que hoy van a Cloudinary como las demás.
// ============================================================

export const DOCS_PERSONA = Object.freeze({
  cedula: { titulo: 'Cédula de identidad', caras: ['frente', 'reverso'] },
  licencia: { titulo: 'Licencia de conducir', caras: ['frente', 'reverso'] },
  carta_medica: { titulo: 'Carta médica', caras: ['frente'] },
})

const NOMBRE_CARA = { frente: 'Frente', reverso: 'Reverso' }

/** Los huecos de foto de un documento de la persona. */
export function huecosPersona(userId, clave) {
  const doc = DOCS_PERSONA[clave]
  if (!userId || !doc) return []
  return doc.caras.map((cara) => ({
    clave: `${clave}-${cara}`,
    titulo: doc.caras.length > 1 ? NOMBRE_CARA[cara] : 'Foto o escaneo',
    publicId: `fom/persona/${userId}/${clave}/${cara}`,
    etiqueta: `fom_persona_${userId}`,
  }))
}

/** A qué documento de la persona corresponde un tipo escrito («Cédula de identidad», «licencia_conducir»…). */
export function claveDeTipo(tipo) {
  const t = String(tipo || '').toLowerCase()
  if (/c[eé]dula|identidad|national_id/u.test(t)) return 'cedula'
  if (/licencia|license/u.test(t)) return 'licencia'
  if (/m[eé]dic|medical/u.test(t)) return 'carta_medica'
  return null
}

/** Las fotos de los documentos de una persona; licencia y carta médica solo si conduce. */
export default function FotosIdentidad({ userId, conduce = false, permiteSubir = true }) {
  if (!userId) return null
  const claves = conduce ? ['cedula', 'licencia', 'carta_medica'] : ['cedula']
  return (
    <div className="fid">
      {claves.map((clave) => (
        <section key={clave} className="fid-doc" aria-label={DOCS_PERSONA[clave].titulo}>
          <h4>{DOCS_PERSONA[clave].titulo}</h4>
          <FotosDe huecos={huecosPersona(userId, clave)} permiteSubir={permiteSubir} />
        </section>
      ))}
    </div>
  )
}
