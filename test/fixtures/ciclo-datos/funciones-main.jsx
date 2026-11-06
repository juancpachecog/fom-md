import React from 'react'
import {createRoot} from 'react-dom/client'
import {BrowserRouter} from 'react-router-dom'
import FuncionesInstalacion from '../../../src/panel/modulos/FuncionesInstalacion.jsx'
const assignment='11111111-1111-4111-8111-111111111111'
const profile={profileId:'synthetic',profileVersion:1,manufacturer:'SINTÉTICO',model:'Ensayo',protocolFamily:'synthetic',
 nativeChannels:[{channel:'device.acc_reported',semanticKey:'ignition.acc',definitionVersion:1}],resources:[],
 functions:[{semanticKey:'ignition.acc',definitionVersion:1,valueKind:'boolean',unit:'none',maxInstances:1,direction:'observation',hardwareSupport:'unknown',interpretationSupport:'implemented',requirements:[]}]}
let state={assignmentId:assignment,isCurrent:true,installationVersion:0,profileId:null,profileVersion:null,items:[]}
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
globalThis.fetch=async(url,options={})=>{
 const u=new URL(String(url),location.origin),method=options.method||'GET'
 if(!u.pathname.startsWith('/fixture-api/api/v1/console/'))throw Error('Synthetic fixture rejects other network access')
 if(u.pathname.endsWith('/gps-capability-catalog'))return response({items:[profile],page:{limit:50,offset:0,count:1,total:1}})
 if(u.pathname.endsWith('/versions/1'))return response(profile)
 if(u.pathname.endsWith('/observations'))return response({items:[],page:{limit:50,offset:0,count:0,total:0}})
 if(u.pathname.endsWith('/functions')){
  if(method==='GET')return response(state)
  const body=JSON.parse(options.body)
  if(body.expectedVersion!==state.installationVersion)return response({message:'Version conflict'},409)
  state={...state,installationVersion:state.installationVersion+1,profileId:body.profileId,profileVersion:body.profileVersion,
   items:body.functions.map((f,i)=>({...profile.functions[0],...f,functionId:`${state.installationVersion+1}-${i+1}`,instance:f.mapping.instance,
    enabled:false,verification:'pending',freshness:'unknown',lastObservation:{quality:'valid',valueKind:'boolean',booleanValue:false,receivedAt:new Date().toISOString()}}))}
  return response({assignmentId:assignment,version:state.installationVersion,effectiveFrom:new Date().toISOString()})
 }
 throw Error('Unrecognized synthetic request')
}
document.body.style.fontFamily='system-ui';document.body.style.padding='20px'
createRoot(document.getElementById('root')).render(<BrowserRouter><p>ENSAYO SINTÉTICO · sin hardware ni base productiva</p><FuncionesInstalacion assignmentId={assignment} protocolFamily="synthetic"/></BrowserRouter>)
