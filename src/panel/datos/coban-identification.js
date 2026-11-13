/** Copia manual exclusivamente del cambio SMS/GPRS del 403AB; no envía nada. */
export function cobanIdentificationSms(password, transport) {
  if (!/^\d{6}$/.test(password) || !['tcp','udp'].includes(transport)) return null
  return { pause:`SMS${password}`, resume:`GPRS${password},${transport === 'tcp' ? '0,0' : '1,1'}` }
}

export function receivedCobanCandidate(d, {knownImei='', transport, now=Date.now()}={}) {
  const time=Date.parse(d?.ultimaIdentidad)
  return !!d && /^\d{15}$/.test(d.imei) && (!knownImei || knownImei === d.imei)
    && d.origenIdentidad === 'coban_imei_field' && d.protocolo === 'coban-gps103'
    && d.transporte === transport && d.reportando === true
    && Number.isFinite(time) && time <= now+1000 && now-time < 300000
}
