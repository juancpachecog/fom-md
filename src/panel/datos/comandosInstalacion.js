import {pedir} from './api'
export async function leerComandosInstalacion(id){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id||''))throw new Error('Instalación inválida.')
 const data=await pedir(`/api/v1/console/gps-installations/${id}/commands`,{empresaContexto:null})
 if(data.assignmentId!==id||data.readOnly!==true||!Array.isArray(data.items)||data.items.some(item=>item.requestAllowed!==false||item.dispatchAllowed!==false||!Array.isArray(item.blockers)))throw new Error('El contrato de comandos no es compatible con esta pantalla. Recarga antes de operar.')
 return data
}
const REASONS={assignment_changed:'La instalación ya no está vigente',hardware_unsupported:'El hardware declara esta acción sin soporte',hardware_unverified:'Soporte del equipo sin verificar',
 transmitter_not_implemented:'Falta adaptador de transmisión revisado',command_permission_not_configured:'Falta permiso específico para esta acción',recent_mfa_required:'Requiere autenticación reforzada reciente',
 specific_confirmation_required:'Requiere confirmación específica de la acción',circuit_unverified:'Circuito o actuador sin verificar',restoration_unverified:'Restauración física sin verificar',
 operational_contract_required:'Requiere contrato operacional de esta acción',stationary_not_proven:'No se acreditó ausencia de movimiento',engine_stopped_not_proven:'No se acreditó motor parado',device_offline:'Equipo desconectado'}
export const motivoBloqueoComando=reason=>REASONS[reason]||'Requisito pendiente de validación'
