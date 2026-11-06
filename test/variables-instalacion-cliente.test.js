import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'vite'
const bundle=await build({configFile:false,envFile:false,logLevel:'silent',define:{'import.meta.env.VITE_FOM_API':'"/synthetic"'},build:{ssr:'test/fixtures/ciclo-datos/variables-entry.js',write:false,minify:false}})
const api=await import(`data:text/javascript;base64,${Buffer.from(bundle.output.find(x=>x.type==='chunk'&&x.isEntry).code).toString('base64')}`)
const id='11111111-1111-4111-8111-111111111111',entry='22222222-2222-4222-8222-222222222222',token='33333333-3333-4333-8333-333333333333'
test('vinculación respeta tipo/unidad y retiro de definición sin habilitar',()=>{
 const v={status:'active',definitionVersion:3,definition:{kind:'boolean',unit:'none',maxInstances:2}}
 const f={sourceFunctionId:'2-1',instance:'1',scale:'1',offset:'0',selected:true,polarity:'normal',definitionVersion:1,expectedVersion:0,reason:'Validación sintética'}
 assert.equal(api.fuenteCompatible(v,{direction:'observation',valueKind:'boolean',unit:'none'}),true)
 assert.equal(api.fuenteCompatible(v,{direction:'command',valueKind:'boolean',unit:'none'}),false)
 assert.equal(api.cuerpoVinculo(f,v).definitionVersion,3)
 const retired=api.cuerpoVinculo(f,{...v,status:'retired'})
 assert.equal(retired.selected,false);assert.equal(retired.definitionVersion,1)
 assert.throws(()=>api.cuerpoVinculo({...f,offset:''},v),/Completa/)
})
test('POST de vínculo exige recibo y readback; no crea observaciones ni comandos',async()=>{
 const old=globalThis.fetch,calls=[]
 globalThis.fetch=async(url,o)=>{calls.push({url,o});return new Response(JSON.stringify(o.method==='POST'?{assignmentId:id,entryId:entry,version:1}
  :{assignmentId:id,items:[{entryId:entry,instance:1,version:1}]}),{status:200})}
 try{await api.guardarVinculoVariable(id,entry,{instance:1},token);assert.equal(calls.length,2);assert.equal(calls[0].o.headers['idempotency-key'],token);assert.equal(calls[1].o.method,'GET');assert.match(calls[0].url,/managed-variables/)}finally{globalThis.fetch=old}
})
test('historial usa cursor de versión y nunca recibe tenant del formulario',async()=>{
 const old=globalThis.fetch,calls=[]
 globalThis.fetch=async(url,o)=>{calls.push({url,o});return new Response(JSON.stringify({items:[],nextBeforeVersion:null}),{status:200})}
 try{
  await api.historialVinculoVariable(id,entry,1,20)
  assert.match(calls[0].url,/\/1\/history\?beforeVersion=20$/);assert.equal(calls[0].o.method,'GET')
  assert.throws(()=>api.historialVinculoVariable(id,entry,0),/inválida/)
  assert.throws(()=>api.historialVinculoVariable(id,entry,1,0),/inválida/)
  assert.equal(calls.length,1)
 }finally{globalThis.fetch=old}
})
