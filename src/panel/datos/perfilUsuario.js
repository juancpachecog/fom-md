/** Nunca atribuir registros a una persona solo porque coincide su nombre. */
export function registrosDePersona(registros, userId, campos) {
  return registros.filter(r => campos.some(campo => r[campo] === userId))
}

export function coleccionDePersona(resultado, userId, campos) {
  if (resultado.status === 'rejected') {
    return { registros: [], disponible: false, error: resultado.reason?.message || 'No se pudo consultar esta información.' }
  }
  const lista = Array.isArray(resultado.value) ? resultado.value : []
  const incompleta = lista.some(r => !campos.some(campo => typeof r[campo] === 'string' && r[campo]))
  return {
    registros: registrosDePersona(lista, userId, campos),
    disponible: !incompleta,
    error: incompleta ? 'Hay registros que el servidor no identifica por usuario; no se atribuyen por el nombre.' : '',
  }
}

export function indiceDePersona(score) {
  const indice = score?.indice
  return typeof indice === 'number' && Number.isFinite(indice) && indice >= 0 && indice <= 100 && score.rating !== 'unavailable'
    ? indice : null
}

export const nombreDocumentoUsuario = tipo => ({
  licencia_conducir: 'Licencia de conducir', certificado_medico: 'Certificado médico', cedula: 'Cédula de identidad',
}[tipo] ?? tipo ?? 'Documento')

/** Solo los campos modificados; los que el directorio no entrega se conservan. */
export function cambiosDatosUsuario(borrador, persona) {
  const patch = {}
  if (borrador.nombre !== undefined && borrador.nombre.trim() !== String(persona.nombre ?? '').trim()) {
    if (borrador.nombre.trim().length < 2 || borrador.nombre.trim().length > 120) throw new Error('El nombre debe tener entre 2 y 120 caracteres.')
    patch.nombre = borrador.nombre.trim()
  }
  for (const [campo, anterior] of [
    ['cedula', persona.cedula], ['telefono', persona.telefono],
    ['direccion', persona.direccion], ['nacimiento', persona.fechaNacimiento],
  ]) {
    const valor = String(borrador[campo] ?? '').trim()
    if (valor === String(anterior ?? '').trim()) continue
    if (!valor) throw new Error('Escribe un nuevo valor para los datos que modificaste.')
    if (campo === 'nacimiento') {
      const fecha = new Date(`${valor}T12:00:00Z`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || !Number.isFinite(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor || fecha > new Date()) {
        throw new Error('Escribe una fecha de nacimiento válida.')
      }
    }
    patch[campo] = valor
  }
  return patch
}
