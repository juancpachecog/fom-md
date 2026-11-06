import {pedir} from './api'
const uuid=id=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id||''))throw new Error('Identificador inválido.');return id}
const base=id=>`/api/v1/console/gps-installations/${uuid(id)}/commands`
const consultar=(id,path='',options={})=>pedir(`${base(id)}${path}`,{...options,empresaContexto:null})
const independiente=()=>({señal:new AbortController().signal})
export async function leerComandosInstalacion(id){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id||''))throw new Error('Instalación inválida.')
 const data=await pedir(`/api/v1/console/gps-installations/${id}/commands`,{empresaContexto:null})
 const nuevo=data.contractVersion===2
 if(data.assignmentId!==id||typeof data.readOnly!=='boolean'||!Array.isArray(data.items)||data.items.some(item=>
  typeof item.requestAllowed!=='boolean'||item.dispatchAllowed!==false||!Array.isArray(item.blockers)||
  (nuevo?(!Number.isInteger(item.instance)||item.instance<1||item.instance>32||item.requestAllowed&&item.blockers.length>0):item.requestAllowed!==false))||(!nuevo&&data.readOnly!==true))throw new Error('El contrato de comandos no es compatible con esta pantalla. Recarga antes de operar.')
 return data
}
export async function leerSolicitudesComando(id,offset=0){
 const data=await consultar(id,`/requests?offset=${offset}`,independiente())
 if(data.assignmentId!==id||!Array.isArray(data.items)||!data.page)throw new Error('Historial de comandos incompatible.')
 return data
}
export async function leerSolicitudComando(id,requestId){
 const data=await consultar(id,`/requests/${uuid(requestId)}`,independiente())
 if(data.requestId!==requestId||data.assignmentId!==id||!Number.isInteger(data.version)||!Array.isArray(data.events))throw new Error('Solicitud de comando incompatible.')
 return data
}
async function mutarSolicitud(id,path,body,key){
 const receipt=await consultar(id,path,{metodo:'POST',cuerpo:body,...(key?{idempotente:true,idempotencia:uuid(key)}:{})})
 const current=await leerSolicitudComando(id,receipt.requestId)
 if(current.version<receipt.version||current.commandKey!==receipt.commandKey||current.instance!==receipt.instance)throw new Error('No se pudo comprobar la solicitud. Consulta el historial antes de repetir.')
 return current
}
export const crearSolicitudComando=(id,body,key)=>mutarSolicitud(id,'/requests',body,key)
export const confirmarSolicitudComando=(id,requestId,body)=>mutarSolicitud(id,`/requests/${uuid(requestId)}/confirm`,body)
export const cancelarSolicitudComando=(id,requestId,body)=>mutarSolicitud(id,`/requests/${uuid(requestId)}/cancel`,body)
export async function leerPermisosComando(id,offset=0,history=false){
 const data=await consultar(id,`/grants${history?'/history':''}?offset=${offset}`,independiente())
 if(data.assignmentId!==id||!Array.isArray(data.items)||typeof data.canManage!=='boolean')throw new Error('Permisos de comandos incompatibles.')
 return data
}
export const leerDestinatariosComando=(id,offset=0)=>consultar(id,`/grants/recipients?offset=${offset}`)
export async function guardarPermisoComando(id,body,key){
 const receipt=await consultar(id,'/grants',{metodo:'POST',cuerpo:body,idempotente:true,idempotencia:uuid(key)})
 // Find the exact retained revision even when the current list spans several pages.
 let offset=0
 while(offset<=10000){
  const history=await leerPermisosComando(id,offset,true)
  const row=history.items.find(r=>r.userId===body.userId&&r.commandKey===body.commandKey&&r.instance===body.instance&&r.version===receipt.version)
  if(row){if(row.selected!==body.selected||row.reason!==body.reason.trim()||(body.selected&&Date.parse(row.expiresAt)!==Date.parse(body.expiresAt)))throw new Error('El permiso consultado no coincide.');return row}
  offset+=history.page.limit;if(offset>=history.page.total)break
 }
 throw new Error('El permiso no quedó comprobado. Consulta su historial antes de repetir.')
}
const REASONS={assignment_changed:'La instalación ya no está vigente',hardware_unsupported:'El hardware declara esta acción sin soporte',hardware_unverified:'Soporte del equipo sin verificar',
 transmitter_not_implemented:'Falta adaptador de transmisión revisado',command_permission_not_configured:'Falta permiso específico para esta acción',recent_mfa_required:'Requiere autenticación reforzada reciente',
 specific_confirmation_required:'Requiere confirmación específica de la acción',circuit_unverified:'Circuito o actuador sin verificar',restoration_unverified:'Restauración física sin verificar',
 operational_contract_required:'Requiere contrato operacional de esta acción',stationary_not_proven:'No se acreditó ausencia de movimiento',engine_stopped_not_proven:'No se acreditó motor parado',device_offline:'Equipo desconectado',
 execution_disabled:'La ejecución está desactivada en este ambiente',qualification_ambiguous:'Hay más de una cualificación vigente; requiere revisión',qualification_changed:'La cualificación cambió',permission_changed:'El permiso cambió',action_permission_missing:'Falta permiso explícito vigente',request_expired_or_unbounded:'La solicitud venció o su duración no es válida'}
export const motivoBloqueoComando=reason=>REASONS[reason]||'Requisito pendiente de validación'
