const p=v=>String(v).padStart(2,'0')
export const fechaHoraEquipo=value=>value ? `${p(value.day)}/${p(value.month)}/${value.year} ${p(value.hour)}:${p(value.minute)}:${p(value.second)}` : 'Sin fecha y hora válidas'
export const horaGps=value=>value ? `${p(value.hour)}:${p(value.minute)}:${p(value.second)}` : 'Sin hora GPS válida'
export const ubicacionTrama=value=>value?.valid && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
  ? `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}` : 'Sin ubicación válida'
export function muestraTramaVigente(snapshot,ahora=Date.now()) {
 const received=Date.parse(snapshot?.sample?.receivedAt),age=ahora-received
 return snapshot?.privatePosition===true && snapshot.validation?.canRegister===true
  && /^[a-f0-9]{64}$/.test(snapshot.sample?.key??'') && snapshot.sample.freshness==='fresh'
  && Number.isFinite(age) && age>=-1000 && age<=300000
}
const motivos={no_position_frame:'Esperando una trama de posición; la comunicación sola no confirma ubicación.',
  sample_not_available:'La muestra revisada ya no está disponible. Espera una nueva lectura.',
  unrecognized_position_frame:'La variante de esta trama todavía necesita interpretación.',no_valid_fix:'El equipo no envió una ubicación GPS válida.',
  invalid_device_datetime:'Falta una fecha y hora válidas en la trama.',invalid_gps_clock:'Falta una hora GPS válida.',
  position_sample_stale:'La última trama de posición tiene más de cinco minutos.',
  device_datetime_outside_timezone_window:'La fecha y hora del equipo están fuera del margen de zona horaria. Revisa su reloj.'}
export const motivoRevision=key=>motivos[key]??'La trama requiere revisión antes de registrar.'
