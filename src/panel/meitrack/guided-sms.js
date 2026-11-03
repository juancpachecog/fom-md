import { parseT399CommandList } from './commands.js'

function cells(raw, command, imei = null) {
  if (typeof raw !== 'string' || raw.length > 2048 || /[\x00-\x1f\x7f]/.test(raw.trim())) return null
  const value = raw.trim().split(',')
  return /^[0-9]{15}$/.test(value[0]) && value[1] === command && (!imei || value[0] === imei) ? value : null
}

// E91: IMEI,E91,Version,SN. The serial stays only in the local response input.
export function readIdentitySms(raw, knownImei = '') {
  const value = cells(raw, 'E91', knownImei)
  if (!value || value.length !== 4 || !/^[A-Za-z0-9._-]{1,100}$/.test(value[2]) || !/^[A-Za-z0-9._-]{1,128}$/.test(value[3])) return null
  return { imei: value[0], firmware: value[2], supported: value[2] === 'T399L-V254' }
}

export function readCommandsSms(raw, imei) {
  if (!/^[0-9]{15}$/.test(imei ?? '')) return null
  const value = cells(raw, 'E04', imei)
  // Also accept the strict code-only list supported by the previous screen.
  // A mismatching full response cannot pass that three-character-code parser.
  const list = value && value.length >= 3 ? parseT399CommandList(value.slice(2).join(',')) : parseT399CommandList(raw)
  return list && ['A21', 'DB4', 'DA6'].every(code => list.includes(code)) ? list : null
}

export function readPendingSms(raw, imei) {
  if (!/^[0-9]{15}$/.test(imei ?? '')) return null
  const value = cells(raw, 'DA6', imei)
  if (!value || value.length < 4 || value.length > 20) return null
  const connection = value.filter(v => v.startsWith('Disconnect:'))
  const pending = value.filter(v => v.startsWith('GPRS/SMS:'))
  if (connection.length !== 1 || pending.length !== 1 || !/^Disconnect:(CLOSE|TCP|UDP)$/.test(connection[0])) return null
  const match = /^GPRS\/SMS:([0-9]{1,9})\/([0-9]{1,9})$/.exec(pending[0])
  if (!match) return null
  return { closed: connection[0] === 'Disconnect:CLOSE', gprs: Number(match[1]), sms: Number(match[2]) }
}

export function readConnectionOk(raw, imei) {
  if (!/^[0-9]{15}$/.test(imei ?? '')) return false
  const value = cells(raw, 'A21', imei)
  return !!value && value.length === 3 && value[2] === 'OK'
}
