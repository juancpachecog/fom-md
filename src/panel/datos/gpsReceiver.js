/** Dirección pública del receptor: configuración del despliegue, sin clave SMS. */
export function validReceiverIp(value) {
  const parts = String(value ?? '').trim().split('.')
  return parts.length === 4 && parts.every(p => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)
}
