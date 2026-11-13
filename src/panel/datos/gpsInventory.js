import { cambiosGps } from './metadatosGps.js'
export function canArchiveGps(g) {
  return !!g?.id && !g.vehiculoId && !g.instalacionId && ['inventory','inactive','maintenance','lost'].includes(g.estado)
}
export function gpsEditChanges(datos, inicial) {
  const changes = cambiosGps(datos, inicial)
  for (const [key, target] of [['estado','status'],['fabricante','manufacturer'],['serie','serialNumber']]) {
    if (String(datos[key] ?? '').trim() !== String(inicial[key] ?? '').trim()) changes[target] = String(datos[key] ?? '').trim() || null
  }
  return changes
}
export function samePhoneRecords(rows, phone) {
  const normalize = v => String(v ?? '').replace(/\D/g,'').replace(/^(?:0058|58)/,'').replace(/^0/,'')
  const line = normalize(phone)
  return line.length === 10 ? rows.filter(g => g.estado !== 'archived' && normalize(g.linea || g.simPhone) === line) : []
}
