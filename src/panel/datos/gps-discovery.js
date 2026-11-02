import { validarEquipo, validarImei } from './gps.js'

// La preparación no crea inventario: la identidad se confirma al final.
export function validarPreparacion(datos) {
  const errores = validarEquipo(datos)
  if (!String(datos.imei ?? '').trim()) delete errores.imei
  return errores
}

export function identidadConfirmada(inicial, sms) {
  const lectura = validarImei(sms), conocido = validarImei(inicial)
  if (lectura.error || (String(inicial ?? '').trim() && (conocido.error || conocido.valor !== lectura.valor))) return null
  return lectura.valor
}

export function coincideDetectado(d, { inicial, sms, transporte, ahora = Date.now() }) {
  const imei = identidadConfirmada(inicial, sms)
  const fecha = Date.parse(d?.ultimaVez)
  return !!imei && d?.imei === imei && d.transporte === transporte && d.reportando === true
    && Number.isFinite(fecha) && fecha <= ahora + 1000 && ahora - fecha < 300000
}

export function testigoInventarioCoban(rows, payload) {
  const found = rows.filter(row => row.imei === payload.imei)
  const result = (state, id = null) => ({ registration: { state, id, activationAllowed: false } })
  if (!found.length) return result('absent')
  if (found.length !== 1) return result('conflict')
  const row = found[0]
  const fields = { modelo: 'model', fabricante: 'manufacturer', protocolo: 'protocolFamily', serie: 'serialNumber',
    transport: 'transport', simPhone: 'simPhone', iccid: 'iccid', carrier: 'carrier', apn: 'apn',
    simStatus: 'simStatus', simPlan: 'simPlan', firmwareVersion: 'firmwareVersion' }
  const same = Object.entries(fields).every(([key, target]) => (row[key] ?? '') === (payload[target] ?? ''))
  return same && row.estado === 'inventory' && !row.vehiculoId && !row.instalacionId
    ? result('matching', row.id) : result('conflict')
}
