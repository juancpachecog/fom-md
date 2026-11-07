import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'vite'
const bundle=await build({configFile:false,envFile:false,logLevel:'silent',define:{'import.meta.env.VITE_FOM_API':'"/synthetic"'},build:{ssr:'test/fixtures/ciclo-datos/comandos-entry.js',write:false,minify:false}})
const api=await import(`data:text/javascript;base64,${Buffer.from(bundle.output.find(x=>x.type==='chunk'&&x.isEntry).code).toString('base64')}`)
test('panel de comandos consulta bloqueos y rechaza habilitación no esperada; nunca envía',async()=>{
 const id='11111111-1111-4111-8111-111111111111',old=globalThis.fetch,calls=[];let ready=false
 globalThis.fetch=async(url,o)=>{calls.push({url,o});return new Response(JSON.stringify({assignmentId:id,readOnly:true,items:[{key:'starter.inhibit',requestAllowed:ready,dispatchAllowed:false,blockers:['transmitter_not_implemented']}]}),{status:200})}
 try{
  const page=await api.leerComandosInstalacion(id);assert.equal(page.items[0].requestAllowed,false);assert.equal(calls[0].o.method,'GET');assert.equal(calls[0].o.body,undefined)
  ready=true;await assert.rejects(()=>api.leerComandosInstalacion(id),/no es compatible/)
  assert.equal(api.motivoBloqueoComando('transmitter_not_implemented'),'Falta adaptador de transmisión revisado')
  assert.equal(api.motivoBloqueoComando('unknown'),'Requisito pendiente de validación')
 }finally{globalThis.fetch=old}
})
test('contrato v2 permite solicitud sólo con elegibilidad explícita y consulta independiente después de cada escritura',async()=>{
 const id='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222',key='33333333-3333-4333-8333-333333333333',old=globalThis.fetch,calls=[]
 let state='requested',version=1
 globalThis.fetch=async(url,o)=>{
  calls.push({url,o});const path=String(url)
  if(path.endsWith('/commands'))return new Response(JSON.stringify({assignmentId:id,contractVersion:2,readOnly:false,items:[{key:'device.status.read',instance:1,requestAllowed:true,dispatchAllowed:false,blockers:[]}]}),{status:200})
  if(o.method==='POST'&&path.endsWith('/confirm')){state='validated';version=2}
  return new Response(JSON.stringify({assignmentId:id,requestId,commandKey:'device.status.read',instance:1,state,version,events:[],canConfirm:state==='requested'}),{status:200})
 }
 try{
  assert.equal((await api.leerComandosInstalacion(id)).items[0].requestAllowed,true)
  const created=await api.crearSolicitudComando(id,{commandKey:'device.status.read',instance:1,expectedInstallationVersion:1,expiresInSeconds:60,reason:'Consulta sintética'},key)
  assert.equal(created.requestId,requestId);assert.equal(calls.at(-2).o.headers['idempotency-key'],key);assert.equal(calls.at(-1).o.method,'GET');assert.ok(calls.at(-1).o.signal)
  assert.equal((await api.confirmarSolicitudComando(id,requestId,{expectedVersion:1,confirmationPhrase:'CONFIRMAR 22222222'})).state,'validated')
  assert.equal(calls.at(-1).o.method,'GET');assert.equal(calls.filter(c=>c.o.method==='POST').length,2)
 }finally{globalThis.fetch=old}
})
test('recibo sin readback no acredita la solicitud y no dispara reintento automático',async()=>{
 const id='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222',old=globalThis.fetch;let posts=0
 globalThis.fetch=async(url,o)=>{if(o.method==='POST'){posts++;return new Response(JSON.stringify({requestId,version:1,commandKey:'device.status.read',instance:1}),{status:200})}return new Response(JSON.stringify({message:'No disponible'}),{status:503})}
 try{await assert.rejects(()=>api.crearSolicitudComando(id,{},'33333333-3333-4333-8333-333333333333'));assert.equal(posts,1)}finally{globalThis.fetch=old}
})

test('política de espera opcional sólo admite consultas explícitas y preserva servidores anteriores',async()=>{
 const id='11111111-1111-4111-8111-111111111111',old=globalThis.fetch
 let item={key:'device.status.read',physical:false,instance:1,requestAllowed:true,dispatchAllowed:false,blockers:[],deliveryPolicy:'bounded_read_queue'}
 globalThis.fetch=async()=>new Response(JSON.stringify({assignmentId:id,contractVersion:2,readOnly:false,items:[item]}),{status:200})
 try{
  assert.equal((await api.leerComandosInstalacion(id)).items[0].deliveryPolicy,'bounded_read_queue')
  for(const delta of [{key:'starter.inhibit'},{physical:true},{deliveryPolicy:'retry_forever'}]){
   const original=item;item={...original,...delta};await assert.rejects(()=>api.leerComandosInstalacion(id),/no es compatible/);item=original
  }
  delete item.deliveryPolicy;assert.equal((await api.leerComandosInstalacion(id)).items[0].requestAllowed,true)
 }finally{globalThis.fetch=old}
})
