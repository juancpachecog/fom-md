import {pedir} from './api'
import {fuentesFuncion,nuevaFilaFuncion} from './funcionesInstalacion'

export function leerEntradasEnVivo(id){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id||''))throw Error('Instalación inválida.')
 return pedir(`/api/v1/console/gps-installations/${id}/functions/live-inputs/observations`,{empresaContexto:null})
}
const instant=value=>typeof value==='string'?Date.parse(value):NaN
export function muestraDiagnostico(snapshot,after,used=[]){
 if(snapshot?.diagnosticOnly!==true||!Number.isFinite(instant(after)))return null
 const checked=instant(snapshot.checkedAt)
 return snapshot.samples.find(s=>s.freshness==='fresh'&&typeof s.sampleKey==='string'&&!used.includes(s.sampleKey)
  &&instant(s.receivedAt)>instant(after)&&instant(s.receivedAt)<=checked&&checked-instant(s.receivedAt)<=60000)||null
}
export function candidatosEntradas(samples){
 if(samples.length!==3||new Set(samples.map(s=>s.sampleKey)).size!==3)return []
 if(!samples.every((s,i)=>i===0||instant(s.receivedAt)>instant(samples[i-1].receivedAt)))return []
 return samples[0].channels.flatMap(first=>{
  const values=samples.map(s=>s.channels.find(c=>c.channel===first.channel))
  if(values.some(c=>!c||c.quality!=='valid'||typeof c.value!=='boolean'))return []
  if(values[0].value!==values[2].value||values[0].value===values[1].value)return []
  return [{channel:first.channel,polarity:values[0].value?'inverted':'normal'}]
 })
}
export function proponerMapeoEntradas(current,profile,semantic,instance,candidate){
 if(!current?.isCurrent||!Number.isSafeInteger(instance)||instance<1)throw Error('Montaje o sensor no disponible.')
 const fn=profile.functions.find(f=>f.semanticKey===semantic&&f.valueKind==='boolean'&&f.direction==='observation'&&f.interpretationSupport==='implemented')
 if(!fn||!['door.open','ignition.acc'].includes(semantic))throw Error('Función sin interpretación compatible.')
 const source=fuentesFuncion(profile,fn).find(c=>c.channel===candidate.channel)
 if(!source||!['normal','inverted'].includes(candidate.polarity))throw Error('Canal o transformación incompatible con el perfil.')
 const rows=current.items.filter(i=>i.semanticKey!==semantic||i.instance!==instance).map(i=>({selected:i.selected,mapping:{...i.mapping}}))
 for(const row of rows){
  const f=profile.functions.find(f=>f.semanticKey===row.mapping.semanticKey&&f.definitionVersion===row.mapping.definitionVersion)
  if(!f||!fuentesFuncion(profile,f).some(c=>c.channel===row.mapping.channel&&c.source===row.mapping.source
    &&(c.source!=='io'||c.resourceKey===row.mapping.resourceKey&&c.mode===row.mapping.mode)))throw Error('El perfil no conserva todas las funciones actuales. No se guardará una configuración incompleta.')
 }
 if(source.source==='io'&&rows.some(r=>r.mapping.source==='io'&&r.mapping.resourceKey===source.resourceKey))throw Error('La entrada ya está asignada a otra función. Revisa el montaje antes de cambiarla.')
 const next=nuevaFilaFuncion(profile,fn,rows),{id:_,...mapping}=source
 if(instance>fn.maxInstances)throw Error('Sensor fuera del límite del perfil.')
 rows.push({selected:true,mapping:{...next.mapping,...mapping,instance,polarity:candidate.polarity}})
 return {expectedVersion:current.installationVersion,profileId:profile.profileId,profileVersion:profile.profileVersion,functions:rows}
}
export function muestraPruebaGuiada(page,after,checkedAt,expected,used=[]){
 const start=instant(after),checked=instant(checkedAt)
 if(!Number.isFinite(start)||!Number.isFinite(checked))return null
 return page?.items?.find(s=>s.commissioningEligible===true&&s.quality==='valid'&&s.valueKind==='boolean'
  &&s.booleanValue===expected&&s.timeEvidenceCurrent===true&&!s.historicalOnly&&!used.includes(s.observationId)
  &&instant(s.receivedAt)>start&&instant(s.observedAt)>start&&instant(s.receivedAt)<=checked&&instant(s.observedAt)<=checked)||null
}
