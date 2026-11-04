/** Estado comprobable: la falta de señal prevalece sobre telemetría antigua. */
export function estadoUnidad(v) {
  if (!v || v.conectado === false) return { clave: 'sin_senal', texto: 'Sin señal', color: 'gris' }
  if (v.soloRecepcion) return { clave: 'reportando', texto: 'Reportando', color: 'verde' }
  if (v.estadoMarcha === 'en_marcha' || (Number.isFinite(v.velocidadKmh) && v.velocidadKmh > 0))
    return { clave: 'en_marcha', texto: 'En marcha', color: 'verde' }
  if (v.estadoMarcha === 'parada' || v.velocidadKmh === 0)
    return { clave: 'parada', texto: 'Detenido', color: 'ambar' }
  if (v.ignition === true) return { clave: 'encendido', texto: 'Encendido', color: 'verde' }
  if (v.ignition === false) return { clave: 'apagado', texto: 'Apagado', color: 'ambar' }
  return v.conectado
    ? { clave: 'reportando', texto: 'Reportando', color: 'verde' }
    : { clave: 'sin_senal', texto: 'Sin señal', color: 'gris' }
}
