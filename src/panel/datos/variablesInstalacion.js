import {pedir} from './api'
import {listarDefiniciones} from './catalogoFunciones'
const consultar=(url,options={})=>pedir(url,{...options,empresaContexto:null})
const uuid=id=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id||''))throw new Error('Registro inválido.');return id}
const base=id=>`/api/v1/console/gps-installations/${uuid(id)}/managed-variables`
export const leerVariablesInstalacion=id=>consultar(base(id))
export async function listarVariablesEmpresa(empresa){
 const items=[]
 for(let offset=0;offset<1000;offset+=25){
  const page=await listarDefiniciones({category:'variable',status:'all',offset},empresa)
  items.push(...page.items)
  if(offset+25>=page.total)return{items}
 }
 return{items}
}
export async function guardarVinculoVariable(assignment,entry,body,token){
 const receipt=await consultar(`${base(assignment)}/${uuid(entry)}`,{metodo:'POST',cuerpo:body,idempotente:true,idempotencia:token})
 const current=await leerVariablesInstalacion(assignment)
 const found=current.items.find(item=>item.entryId===entry&&item.instance===body.instance)
 if(receipt.assignmentId!==assignment||receipt.entryId!==entry||!found||found.version!==receipt.version)throw new Error('El vínculo no quedó verificado. Consulta el estado antes de otro cambio.')
 return current
}
export function fuenteCompatible(variable,source){
 const d=variable?.definition
 return !!d&&source.direction==='observation'&&d.kind===source.valueKind&&d.unit===source.unit
  &&(d.kind!=='numeric'||d.dimension===source.dimension)
}
export function cuerpoVinculo(form,variable){
 if(!variable||['instance','scale','offset'].some(k=>String(form[k]).trim()===''))throw new Error('Completa la variable, el sensor y la transformación.')
 const instance=Number(form.instance),scale=Number(form.scale),offset=Number(form.offset)
 if(!Number.isSafeInteger(instance)||instance<1||instance>variable.definition.maxInstances||!Number.isFinite(scale)||scale===0||!Number.isFinite(offset))throw new Error('Revisa la instancia y la transformación.')
 const selected=form.selected&&variable.status==='active'
 return{sourceFunctionId:form.sourceFunctionId,definitionVersion:selected?variable.definitionVersion:form.definitionVersion||variable.definitionVersion,
  instance,scale,offset,polarity:variable.definition.kind==='boolean'?form.polarity:'not_applicable',selected,
  expectedVersion:form.expectedVersion,reason:form.reason.trim()}
}
