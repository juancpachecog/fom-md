import React from 'react'
import {createRoot} from 'react-dom/client'
import ComandosInstalacion from '../../../src/panel/modulos/ComandosInstalacion.jsx'
const assignmentId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222',requestId='33333333-3333-4333-8333-333333333333'
const actions=[{key:'device.status.read',name:'Consultar estado del equipo',physical:false},{key:'starter.inhibit',name:'Inhibir próximo arranque',physical:true}]
let requests=[],grants=[],grantHistory=[]
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})
const page=items=>({assignmentId,items,page:{offset:0,limit:50,total:items.length}})
globalThis.fetch=async(url,options={})=>{
 const u=new URL(String(url),location.origin),p=u.pathname
 if(!p.startsWith('/fixture-api/api/v1/console/'))throw Error('Synthetic fixture rejects other network access')
 if(p.endsWith('/command-mfa'))return json({configured:false,state:'not_enrolled',credentialId:null,proofExpiresAt:null})
 const root=`/fixture-api/api/v1/console/gps-installations/${assignmentId}/commands`
 if(!p.startsWith(root))throw Error('Synthetic fixture rejects other scope')
 if(p.endsWith('/grants/recipients'))return json(page([{userId,userName:'Gestor sintético',role:'supervisor'}]))
 if(p.endsWith('/grants/history'))return json({...page(grantHistory),canManage:true,history:true})
 if(p.endsWith('/grants')){
  if(options.method==='POST'){const body=JSON.parse(options.body),row={...body,userName:'Gestor sintético',version:body.expectedVersion+1,effective:body.selected,recordedAt:new Date().toISOString()};grants=[row];grantHistory.unshift(row);return json({version:row.version})}
  return json({...page(grants),canManage:true,history:false})
 }
 if(p.endsWith('/requests')){
  if(options.method==='POST'){const body=JSON.parse(options.body);requests=[{...body,requestId,assignmentId,vehicleLabel:'UNIDAD SINTÉTICA',requesterUserId:userId,installationVersion:1,state:'requested',version:1,attempts:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString(),confirmationPhrase:'CONFIRMAR 33333333',canConfirm:true,protocolReceipts:[],events:[{version:1,toState:'requested',recordedAt:new Date().toISOString()}]}];return json(requests[0])}
  return json(page(requests))
 }
 if(p.includes(`/requests/${requestId}`)){
  const r=requests[0]
  if(p.endsWith('/confirm')){r.state='uncertain';r.version=4;r.attempts=1;r.canConfirm=false;r.events.push(...['validated','dispatching','uncertain'].map((toState,i)=>({version:i+2,toState,recordedAt:new Date().toISOString()})));return json({...r,state:'validated',version:2})}
  if(p.endsWith('/cancel')){r.state='cancelled';r.version++;r.canConfirm=false;return json(r)}
  return json(r)
 }
 return json({assignmentId,contractVersion:2,installationVersion:1,readOnly:false,items:actions.map(c=>({...c,instance:1,requestAllowed:!c.physical,dispatchAllowed:false,hardwareSupport:c.physical?'unknown':'verified',blockers:c.physical?['circuit_unverified','engine_stopped_not_proven']:[]}))})
}
document.body.style.fontFamily='system-ui';document.body.style.padding='20px'
createRoot(document.getElementById('root')).render(<><p>ENSAYO SINTÉTICO · datos y transporte simulados · sin base ni hardware productivos</p><ComandosInstalacion assignmentId={assignmentId}/></>)
