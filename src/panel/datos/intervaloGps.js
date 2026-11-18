// Intervalo de posiciones; no equivale al heartbeat ni acredita envío por SMS.
export const INTERVALO_GPS_PREDETERMINADO = 30
export const INTERVALOS_GPS = [10, 20, 30, 60, 120, 300]
export const esModeloCobanAscii=modelo=>['GPS-103','GPS-403'].includes(modelo)

export function comandoIntervalo({ modelo, clave, segundos = INTERVALO_GPS_PREDETERMINADO, compatible = false }) {
  if (!compatible || !INTERVALOS_GPS.includes(segundos)) return null
  if (modelo === 'T399L' && /^\d{4}$/.test(clave ?? '')) return `${clave},A12,${segundos / 10}`
  if (esModeloCobanAscii(modelo) && /^\d{6}$/.test(clave ?? '')) {
    const tiempo = `${String(segundos).padStart(3, '0')}s`
    return `Sleep${clave} off ${tiempo}${tiempo}***n`
  }
  return null
}
