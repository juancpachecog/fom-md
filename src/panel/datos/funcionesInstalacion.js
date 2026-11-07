import { pedir } from './api'

const BASE = '/api/v1/console'
const consultar = (url, options = {}) => pedir(url, { ...options, empresaContexto: null })
const uuid = id => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id || '')) throw new Error('Instalación inválida.')
  return id
}
export const leerFuncionesInstalacion = id => consultar(`${BASE}/gps-installations/${uuid(id)}/functions`)
export const listarPerfilesFunciones = () => consultar(`${BASE}/gps-capability-catalog?limit=50&offset=0`)
export const leerPerfilFunciones = (id, version) => {
  if (!/^[a-z][a-z0-9_.-]{0,79}$/u.test(id) || !Number.isSafeInteger(version) || version < 1) throw new Error('Perfil inválido.')
  return consultar(`${BASE}/gps-capability-catalog/${id}/versions/${version}`)
}
export async function guardarFuncionesInstalacion(id, body, token) {
  const path = `${BASE}/gps-installations/${uuid(id)}/functions`
  const receipt = await consultar(path, { metodo: 'PUT', cuerpo: body, idempotente: true, idempotencia: token })
  const current = await leerFuncionesInstalacion(id)
  if (receipt.assignmentId !== id || current.assignmentId !== id || current.installationVersion !== receipt.version
    || current.profileId !== body.profileId || current.profileVersion !== body.profileVersion) {
    throw new Error('No se pudo verificar la nueva configuración. Consulta el estado antes de realizar otro cambio.')
  }
  return current
}
export const historialFuncion = (id, functionId, now = new Date()) => {
  if (!/^[1-9][0-9]{0,9}-[1-9][0-9]?$/u.test(functionId)) throw new Error('Función inválida.')
  const query = new URLSearchParams({ from: new Date(now.getTime() - 86400000).toISOString(), to: now.toISOString(), limit: '50', offset: '0' })
  return consultar(`${BASE}/gps-installations/${uuid(id)}/functions/${functionId}/observations?${query}`)
}
export function muestrasPruebaFuncion(id,functionId,now=new Date()){
  if(!/^[1-9][0-9]{0,9}-[1-9][0-9]?$/u.test(functionId))throw new Error('Función inválida.')
  const query=new URLSearchParams({from:new Date(now.getTime()-900000).toISOString(),to:now.toISOString(),limit:'100',offset:'0'})
  return consultar(`${BASE}/gps-installations/${uuid(id)}/functions/${functionId}/observations?${query}`)
}
export function cuerpoPruebaFuncion(form,samples){
  const ids=[...form.observationIds].sort()
  if(!['pass','fail'].includes(form.result)||ids.length>8||new Set(ids).size!==ids.length||
    ids.some(id=>!samples.some(s=>s.observationId===id&&s.commissioningEligible===true)))throw new Error('Selecciona únicamente muestras elegibles de esta prueba (máximo ocho).')
  if(form.result==='pass'&&(!form.inspectionAttested||!ids.length))throw new Error('Para registrar resultado conforme debes confirmar la inspección y seleccionar muestras elegibles.')
  if(form.result==='fail'&&!['no_signal','unexpected_value','wiring_unconfirmed','interpretation_missing','test_interrupted'].includes(form.reasonCode))throw new Error('Indica el motivo del resultado no conforme.')
  return{result:form.result,inspectionAttested:form.inspectionAttested===true,reasonCode:form.result==='pass'?null:form.reasonCode,observationIds:ids}
}
export async function registrarPruebaFuncion(id,functionId,body,token){
  if(!/^[1-9][0-9]{0,9}-[1-9][0-9]?$/u.test(functionId))throw new Error('Función inválida.')
  const path=`${BASE}/gps-installations/${uuid(id)}/functions/${functionId}/test-reports`
  const receipt=await consultar(path,{metodo:'POST',cuerpo:body,idempotente:true,idempotencia:token})
  const report=await consultar(`${path}/${uuid(receipt.reportId)}`)
  if(report.reportId!==receipt.reportId||report.assignmentId!==id||report.functionId!==functionId||report.result!==body.result||
    report.inspectionAttested!==body.inspectionAttested||report.reasonCode!==body.reasonCode||
    JSON.stringify([...report.observationIds].sort())!==JSON.stringify([...body.observationIds].sort()))throw new Error('La prueba no quedó verificada. Consulta su resultado antes de repetirla.')
  return report
}
export const nombreFuncion = key => ({ 'navigation.speed': 'Velocidad GPS', 'navigation.heading': 'Rumbo GPS',
  'ignition.acc': 'Contacto (ACC)', 'door.open': 'Puerta abierta', 'input.digital.active': 'Entrada digital activa',
  'input.voltage': 'Voltaje de entrada' })[key] || key

export function fuentesFuncion(profile, fn) {
  const native = profile.nativeChannels.filter(n => n.semanticKey === fn.semanticKey && n.definitionVersion === fn.definitionVersion)
    .map(n => ({ id: `native:${n.channel}`, source: 'native', channel: n.channel }))
  const io = profile.resources.filter(r => r.kind === 'serial' || (fn.valueKind === 'boolean' ? r.kind === 'digital' : fn.valueKind === 'numeric' && r.kind === 'analog'))
    .flatMap(r => r.modes.filter(mode => mode !== 'digital_output' && fn.requirements.filter(q => q.kind === 'io')
      .every(q => q.resourceKey === r.key && q.mode === mode)).map(mode => ({ id: `io:${r.key}:${mode}`, source: 'io', channel: r.channel, resourceKey: r.key, mode })))
  return [...(fn.requirements.some(q => q.kind === 'io') ? [] : native), ...io]
}
export function nuevaFilaFuncion(profile, fn, rows) {
  const used = new Set(rows.filter(r => r.mapping.semanticKey === fn.semanticKey).map(r => r.mapping.instance))
  let instance = 1
  while (used.has(instance)) instance++
  if (instance > fn.maxInstances || rows.length >= 32) throw new Error('Se alcanzó el máximo de sensores de esta función o instalación.')
  const usedResources=new Set(rows.filter(r=>r.mapping.source==='io').map(r=>r.mapping.resourceKey))
  const usedGroups=new Set(profile.resources.filter(r=>usedResources.has(r.key)&&r.exclusionGroup).map(r=>r.exclusionGroup))
  const source = fuentesFuncion(profile, fn).find(c=>c.source==='native'||(!usedResources.has(c.resourceKey)
    && !usedGroups.has(profile.resources.find(r=>r.key===c.resourceKey)?.exclusionGroup)))
  if (!source || fn.direction !== 'observation') throw new Error('El perfil no declara una fuente de lectura compatible.')
  const { id: _id, ...mapping } = source
  return { selected: true, mapping: { semanticKey: fn.semanticKey, definitionVersion: fn.definitionVersion, instance,
    ...mapping, inputUnit: fn.unit, polarity: fn.valueKind === 'boolean' ? 'normal' : 'not_applicable', scale: 1, offset: 0 } }
}
export function valorFuncion(observation) {
  if (!observation || observation.quality !== 'valid') return 'Sin valor válido'
  if (observation.valueKind === 'boolean') return observation.booleanValue === true ? 'Sí' : observation.booleanValue === false ? 'No' : 'Sin dato'
  if (observation.valueKind === 'numeric') return observation.numericValue === null ? 'Sin dato' : String(observation.numericValue)
  return observation.enumValue ?? 'Sin dato'
}
