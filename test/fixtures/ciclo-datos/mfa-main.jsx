import React from 'react'
import {createRoot} from 'react-dom/client'
import SegundoFactorComandos from '../../../src/panel/modulos/SegundoFactorComandos.jsx'
const id='11111111-1111-4111-8111-111111111111'
let state={configured:true,state:'not_enrolled',credentialId:null,proofExpiresAt:null},revokedAt=null
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
globalThis.fetch=async(url,options={})=>{
 const u=new URL(String(url),location.origin)
 if(!u.pathname.startsWith('/fixture-api/api/v1/console/command-mfa'))throw Error('Synthetic fixture rejects other network access')
 if(options.method==='POST'){
  const body=JSON.parse(options.body)
  if(u.pathname.endsWith('/enrollment')){state={...state,state:'pending',credentialId:id};return response({credentialId:id,secret:'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',algorithm:'SHA1',digits:6,period:30,expiresAt:new Date(Date.now()+600000).toISOString()})}
  if(body.code==='000000')return response({code:'invalid_second_factor',message:'Synthetic invalid code'},401)
  if(u.pathname.endsWith('/revoke')){revokedAt=new Date().toISOString();state={configured:true,state:'not_enrolled',credentialId:null,proofExpiresAt:null};return response({credentialId:id,revoked:true})}
  state={configured:true,state:'active',credentialId:id,proofExpiresAt:new Date(Date.now()+300000).toISOString()};return response({credentialId:id,verifiedAt:new Date().toISOString(),expiresAt:state.proofExpiresAt})
 }
 if(u.pathname.includes('/credentials/'))return response({credentialId:id,state:revokedAt?'revoked':state.state,revokedAt})
 return response(state)
}
document.body.style.fontFamily='system-ui';document.body.style.padding='20px'
createRoot(document.getElementById('root')).render(<><p>ENSAYO SINTÉTICO · contraseña, semilla y códigos de prueba; sin identidad ni base productiva</p><SegundoFactorComandos onChanged={async()=>{}}/></>)
