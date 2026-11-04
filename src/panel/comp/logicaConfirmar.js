// ============================================================
// Lógica del diálogo de confirmación (sin pantalla, para poder probarla)
// Reemplaza las ventanas confirm y prompt del navegador, que en algunos navegadores
// incrustados se cancelan solos y devuelven false sin mostrarse.
// ============================================================

/**
 * Normaliza lo que pide quien llama. `campo` (opcional) convierte el diálogo
 * en lo que hacía el prompt del navegador: un texto que se devuelve al aceptar.
 *   campo: { etiqueta, obligatorio?, placeholder? }
 */
export function normalizarPeticion(op = {}) {
  const peligro = !!op.peligro
  const campo = op.campo
    ? {
      etiqueta: String(op.campo.etiqueta ?? ''),
      obligatorio: !!op.campo.obligatorio,
      placeholder: String(op.campo.placeholder ?? ''),
    }
    : null
  return {
    titulo: String(op.titulo ?? '¿Confirmas?'),
    texto: op.texto ? String(op.texto) : '',
    accion: String(op.accion ?? 'Confirmar'),
    cancelar: String(op.cancelar ?? 'Cancelar'),
    peligro,
    campo,
  }
}

/** ¿Se puede aceptar? Con un campo obligatorio hace falta que traiga texto. */
export function puedeAceptar(peticion, valor = '') {
  if (!peticion?.campo?.obligatorio) return true
  return String(valor).trim().length > 0
}

/**
 * Lo que recibe quien espera la promesa.
 * - Sin campo: true al aceptar, false al cancelar.
 * - Con campo: el texto (recortado) al aceptar, null al cancelar.
 */
export function resultadoDe(peticion, aceptado, valor = '') {
  if (peticion?.campo) {
    if (!aceptado || !puedeAceptar(peticion, valor)) return null
    return String(valor).trim()
  }
  return !!aceptado
}
