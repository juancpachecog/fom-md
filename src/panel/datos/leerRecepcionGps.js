/** Un fallo de lectura no demuestra que el GPS nunca haya reportado. */
export async function leerRecepcionGps(leer, { opcional = true } = {}) {
  try {
    const respuesta = await leer()
    if (!Array.isArray(respuesta?.devices)) throw new Error('inventory_contract')
    return respuesta.devices
  } catch (causa) {
    // Algunos perfiles no pueden consultar inventario; conservan su lectura de flota autorizada.
    if (opcional && causa?.estado === 403) return []
    const error = new Error('No se pudo comprobar la recepción GPS. Reintenta la lectura; este fallo no significa que el equipo esté sin señal.')
    error.estado = causa?.estado
    throw error
  }
}
