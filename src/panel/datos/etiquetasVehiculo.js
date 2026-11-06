import {pedir} from './api'
import {listarDefiniciones} from './catalogoFunciones'
const uuid=id=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id||''))throw new Error('Registro inválido.');return id}
const base=id=>`/api/v1/console/vehicles/${uuid(id)}/managed-tags`
const consultar=(url,options={})=>pedir(url,{...options,empresaContexto:null})
export const leerEtiquetasVehiculo=id=>consultar(base(id))
export async function catalogoEtiquetasEmpresa(tenant){
 const items=[]
 for(let offset=0;offset<1000;offset+=25){const page=await listarDefiniciones({category:'tag',status:'all',offset},tenant);items.push(...page.items);if(offset+25>=page.total)break}
 return{items}
}
export async function guardarEtiquetaVehiculo(vehicle,entry,body,token){
 const receipt=await consultar(`${base(vehicle)}/${uuid(entry)}`,{metodo:'POST',cuerpo:body,idempotente:true,idempotencia:token})
 const state=await leerEtiquetasVehiculo(vehicle),item=state.items.find(r=>r.entryId===entry)
 if(receipt.vehicleId!==vehicle||receipt.entryId!==entry||!item||item.version!==receipt.version||item.requestedSelection!==body.selected)throw new Error('La etiqueta no quedó comprobada. Consulta el estado antes de otro cambio.')
 return state
}
export function historialEtiquetaVehiculo(vehicle,entry,beforeVersion){
 if(beforeVersion!==undefined&&(!Number.isSafeInteger(beforeVersion)||beforeVersion<1||beforeVersion>2147483647))throw new Error('Página inválida.')
 return consultar(`${base(vehicle)}/${uuid(entry)}/history${beforeVersion===undefined?'':`?beforeVersion=${beforeVersion}`}`)
}
