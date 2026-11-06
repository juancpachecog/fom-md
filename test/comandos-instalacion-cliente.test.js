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
