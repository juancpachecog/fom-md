import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import GuiaFunciones from '../../src/panel/modulos/GuiaFunciones'
import '../../src/styles/panel.css'
import '../../src/panel/modulos/catalogo-funciones.css'
import {aplicarTema} from '../../src/panel/tema'
aplicarTema('oscuro')
const assignment='11111111-1111-4111-8111-111111111111'
const profile={profileId:'synthetic.wizard',profileVersion:2,manufacturer:'SINTÉTICO',model:'Entradas de ensayo',protocolFamily:'meitrack-t399',nativeChannels:[],resources:[1,2].map(i=>({key:`in${i}`,channel:`device.input${i}_active`,kind:'digital',modes:['digital_input']})),functions:['door.open','ignition.acc'].map(semanticKey=>({semanticKey,definitionVersion:1,valueKind:'boolean',unit:'none',maxInstances:2,direction:'observation',interpretationSupport:'implemented',hardwareSupport:'unknown',requirements:[]}))}
let current={assignmentId:assignment,isCurrent:true,installationVersion:0,profileId:null,profileVersion:null,items:[]},door=false,qualified=true,fail=false,preview=[],observations=[],report=null,writes=0,reads=0
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}})
setInterval(()=>{
 const now=new Date().toISOString(),key=crypto.randomUUID()
 preview=[{sampleKey:key,receivedAt:now,observedAt:qualified?now:null,timeQualified:qualified,freshness:'fresh',channels:[{channel:'device.input1_active',value:door,quality:'valid'},{channel:'device.input2_active',value:false,quality:'valid'}]}]
 if(current.items.length){const fn=current.items[0];observations.unshift({observationId:key,commissioningEligible:qualified,timeEvidenceCurrent:qualified,historicalOnly:false,quality:'valid',valueKind:'boolean',booleanValue:fn.mapping.polarity==='inverted'?!door:door,receivedAt:now,observedAt:qualified?now:null});observations=observations.slice(0,100)}
},1000)
globalThis.fetch=async(url,options={})=>{
 const path=new URL(String(url),location.origin).pathname,method=options.method||'GET'
 if(!path.startsWith('/fixture-api/api/v1/console/'))throw Error('Synthetic fixture rejects outside API access')
 if(path.endsWith('/functions/live-inputs/observations')){reads++;if(fail)throw Error('Lectura sintética fallida');return response({assignmentId:assignment,checkedAt:new Date().toISOString(),pollAfterMs:3000,diagnosticOnly:true,samples:preview})}
 if(path.endsWith('/gps-capability-catalog/synthetic.wizard/versions/2'))return response(profile)
 if(path.endsWith('/functions')&&method==='PUT'){
  const body=JSON.parse(options.body);if(body.expectedVersion!==current.installationVersion)return response({message:'Version conflict'},409)
  writes++;current={...current,installationVersion:current.installationVersion+1,profileId:body.profileId,profileVersion:body.profileVersion,items:body.functions.map((f,i)=>({...profile.functions.find(fn=>fn.semanticKey===f.mapping.semanticKey),...f,functionId:`${current.installationVersion+1}-${i+1}`,instance:f.mapping.instance,installationVersion:current.installationVersion+1}))};observations=[]
  return response({assignmentId:assignment,version:current.installationVersion})
 }
 if(path.endsWith('/functions'))return response(current)
 if(path.endsWith('/observations'))return response({items:observations})
 if(path.endsWith('/test-reports')&&method==='POST'){
  const body=JSON.parse(options.body);writes++;report={...body,reportId:'22222222-2222-4222-8222-222222222222',assignmentId:assignment,functionId:current.items[0].functionId,recordedAt:new Date().toISOString()};return response({reportId:report.reportId})
 }
 if(path.endsWith('/test-reports/22222222-2222-4222-8222-222222222222'))return response(report)
 throw Error('Unknown synthetic request')
}
function Fixture(){
 const [data,setData]=useState(current),[tick,setTick]=useState(0)
 React.useEffect(()=>{const t=setInterval(()=>setTick(v=>v+1),500);return()=>clearInterval(t)},[])
 return <main className="pnl catalogo-funciones" style={{padding:24,minHeight:'100vh'}}><p>ENSAYO SINTÉTICO · sin hardware ni API productiva</p>
  <div className="cf-toolbar"><button className="pnl-btn" onClick={()=>{door=false;setTick(tick+1)}}>Simular puerta cerrada</button><button className="pnl-btn" onClick={()=>{door=true;setTick(tick+1)}}>Simular puerta abierta</button><button className="pnl-btn" onClick={()=>{qualified=!qualified;setTick(tick+1)}}>Alternar hora calificada</button><button className="pnl-btn" onClick={()=>{fail=!fail;setTick(tick+1)}}>Alternar fallo de lectura</button></div>
  <p>Estado sintético: {door?'abierta':'cerrada'} · Hora: {qualified?'calificada':'desconocida'} · Transporte: {fail?'fallido':'normal'} · Escrituras sintéticas: {writes} · Consultas: {reads}</p>
  <GuiaFunciones protocolFamily="meitrack-t399" assignmentId={assignment} current={data} profiles={[profile]} onSaved={async()=>setData({...current})}/>
 </main>
}
createRoot(document.getElementById('root')).render(<Fixture/> )
