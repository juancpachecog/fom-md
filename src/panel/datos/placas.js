/** Placa visible/capturada. No normaliza alias, códigos opacos ni números internos. */
export const placaMayuscula = (valor) => typeof valor === 'string' ? valor.toUpperCase() : valor

const campos = new Set(['plate', 'vehiclePlate', 'placa', 'vehiculoPlaca', 'unidadPlaca'])
const pares = [['plate', 'code'], ['vehiclePlate', 'vehicleCode']]

/** Vista común de las respuestas: también cubre selectores, CSV y rótulos de mapas. */
export function placasEnRespuesta(valor) {
  if (Array.isArray(valor)) return valor.map(placasEnRespuesta)
  if (!valor || typeof valor !== 'object') return valor
  const vista = Object.fromEntries(Object.entries(valor).map(([k, v]) => [k,
    campos.has(k) ? placaMayuscula(v) : placasEnRespuesta(v),
  ]))
  for (const [campo, codigo] of pares) {
    const placa = vista[campo], etiqueta = vista[codigo]
    // El código histórico no cambia en el servidor: sólo su rótulo cuando ES la placa.
    if (typeof placa === 'string' && placa.trim() && typeof etiqueta === 'string'
      && etiqueta.trim().toUpperCase() === placa.trim()) vista[codigo] = etiqueta.toUpperCase()
  }
  return vista
}
