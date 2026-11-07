import {pedir} from './api'
const BASE='/api/v1/console/command-mfa'
const uuid=id=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id||''))throw new Error('Credencial inválida.');return id}
async function consultar(path='',options={}){
 try{return await pedir(`${BASE}${path}`,{...options,empresaContexto:null})}
 catch(e){
  if(e.codigo==='invalid_second_factor')e.message='No se pudo verificar el segundo factor. Revisa la contraseña o el código vigente.'
  if(e.codigo==='second_factor_locked')e.message='El segundo factor quedó bloqueado durante quince minutos por intentos fallidos.'
  throw e
 }
}
export const estadoSegundoFactor=()=>consultar()
const estadoIndependiente=()=>consultar('',{señal:new AbortController().signal})
export async function iniciarSegundoFactor(password){
 const enrollment=await consultar('/enrollment',{metodo:'POST',cuerpo:{password}})
 uuid(enrollment.credentialId)
 if(!/^[A-Z2-7]{32}$/u.test(enrollment.secret)||enrollment.algorithm!=='SHA1'||enrollment.digits!==6||enrollment.period!==30||!Number.isFinite(Date.parse(enrollment.expiresAt)))throw new Error('La inscripción recibida no es compatible. Consulta el estado antes de repetirla.')
 const state=await consultar(`/credentials/${enrollment.credentialId}`,{señal:new AbortController().signal})
 if(state.credentialId!==enrollment.credentialId||state.state!=='pending')throw new Error('La inscripción pendiente no quedó comprobada. Consulta el estado antes de repetirla.')
 return enrollment
}
async function proof(path,body){
 const receipt=await consultar(path,{metodo:'POST',cuerpo:body})
 const state=await estadoIndependiente()
 if(state.state!=='active'||state.credentialId!==receipt.credentialId||!state.proofExpiresAt||
  !Number.isFinite(Date.parse(receipt.expiresAt))||Date.parse(state.proofExpiresAt)<Date.parse(receipt.expiresAt))throw new Error('La prueba de sesión no quedó comprobada. Consulta el estado antes de repetir el código.')
 return state
}
export const activarSegundoFactor=(credentialId,code)=>proof('/activate',{credentialId:uuid(credentialId),code})
export const verificarSegundoFactor=code=>proof('/verify',{code})
export async function revocarSegundoFactor(credentialId,password,code){
 uuid(credentialId)
 const receipt=await consultar('/revoke',{metodo:'POST',cuerpo:{password,code}})
 const state=await consultar(`/credentials/${credentialId}`)
 if(receipt.credentialId!==credentialId||receipt.revoked!==true||state.credentialId!==credentialId||state.state!=='revoked'||!state.revokedAt)throw new Error('La revocación no quedó comprobada. Consulta el estado antes de repetir el código.')
 return estadoIndependiente()
}
