import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'vite'
const bundle=await build({configFile:false,envFile:false,logLevel:'silent',define:{'import.meta.env.VITE_FOM_API':'"/synthetic"'},build:{ssr:'test/fixtures/ciclo-datos/etiquetas-entry.js',write:false,minify:false}})
const api=await import(`data:text/javascript;base64,${Buffer.from(bundle.output.find(x=>x.type==='chunk'&&x.isEntry).code).toString('base64')}`)
const id='11111111-1111-4111-8111-111111111111',entry='22222222-2222-4222-8222-222222222222',token='33333333-3333-4333-8333-333333333333'
test('asignar y retirar etiqueta requiere recibo exacto más readback; no transmite al GPS',async()=>{
 const old=globalThis.fetch,calls=[];let selected=true,mismatch=false
 globalThis.fetch=async(url,o)=>{calls.push({url,o});return new Response(JSON.stringify(o.method==='POST'?{vehicleId:id,entryId:entry,version:2}
  :{vehicleId:id,items:[{entryId:entry,version:2,requestedSelection:mismatch?!selected:selected}]}),{status:200})}
 try{
  for(const value of [true,false]){selected=value;await api.guardarEtiquetaVehiculo(id,entry,{selected,expectedVersion:1,reason:'Cambio sintético'},token)}
  assert.equal(calls.length,4);assert.equal(calls[0].o.headers['idempotency-key'],token);assert.equal(calls[1].o.method,'GET');assert.match(calls[0].url,/\/vehicles\/.*\/managed-tags\//)
  mismatch=true;await assert.rejects(()=>api.guardarEtiquetaVehiculo(id,entry,{selected:false},token),/no quedó comprobada/)
  assert.throws(()=>api.historialEtiquetaVehiculo(id,entry,0),/inválida/)
 }finally{globalThis.fetch=old}
})
test('historial de etiqueta pagina por versión sin enviar tenant ni scripts',async()=>{
 const old=globalThis.fetch,calls=[];globalThis.fetch=async(url,o)=>{calls.push({url,o});return new Response('{"items":[],"nextBeforeVersion":null}',{status:200})}
 try{await api.historialEtiquetaVehiculo(id,entry,50);assert.match(calls[0].url,/\/history\?beforeVersion=50$/);assert.equal(calls[0].o.method,'GET');assert.equal(calls[0].o.body,undefined)}finally{globalThis.fetch=old}
})
