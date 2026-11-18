import {test} from 'node:test'
import assert from 'node:assert/strict'
import {apiAutodeteccion,propuestaDesdePerfil,valorSenal} from '../src/panel/datos/gpsAutodeteccion.js'
const id='00000000-0000-4000-8000-000000000001',assignment='00000000-0000-4000-8000-000000000002'
const body={profileId:'coban.ascii.extended19',profileVersion:1,expectedVersion:0,choices:[{semanticKey:'ignition.acc',definitionVersion:1,instance:1,selected:false}],reason:'Selección revisada'}
test('save is confirmed by independent data with exact identity, revision and selections, including false',async()=>{
 const calls=[],current={deviceId:id,revision:1,...body};delete current.expectedVersion;delete current.reason
 const api=apiAutodeteccion(async(p,o)=>{calls.push({p,o});return o.metodo==='PUT'?{revision:1}:current})
 assert.deepEqual(await api.guardar(id,body,'stable-token'),current)
 assert.equal(calls.length,2);assert.equal(calls[0].o.idempotencia,'stable-token');assert.equal(calls[0].o.empresaContexto,null)
 for(const change of [{deviceId:assignment},{revision:2},{profileId:'wrong.profile'},{choices:[{...body.choices[0],selected:true}]}]){
  const bad=apiAutodeteccion(async(_p,o)=>o.metodo==='PUT'?{revision:1}:{...current,...change})
  await assert.rejects(bad.guardar(id,body,'stable-token'),/confirmación/)
 }
})
test('installation readback rejects missing or another installation and never creates a vehicle or GPS',async()=>{
 const calls=[],api=apiAutodeteccion(async(p,o)=>{calls.push({p,o});return o.metodo==='POST'?{assignmentId:assignment,version:1}:{assignmentId:assignment,installationVersion:1}})
 await api.aplicar(id,{assignmentId:assignment,preferenceRevision:1,expectedInstallationVersion:0},'stable-token')
 assert.equal(calls.length,2);assert.ok(calls.every(c=>!/registration|vehicle/.test(c.p)))
 await assert.rejects(api.aplicar('wrong',{assignmentId:assignment},'x'),/inválido/)
})
test('drafts preserve explicit selections and never infer command support, hardware validation or missing readings',()=>{
 const fn={semanticKey:'ignition.acc',definitionVersion:1,direction:'observation',interpretationSupport:'implemented'}
 const profile={profileId:body.profileId,profileVersion:1,functions:[fn,{...fn,semanticKey:'relay.cut',direction:'command'},{...fn,semanticKey:'unknown.sensor',interpretationSupport:'unknown'}],nativeChannels:[fn,{semanticKey:'relay.cut',definitionVersion:1}]}
 assert.equal(propuestaDesdePerfil(profile).choices[0].selected,false)
 assert.equal(propuestaDesdePerfil(profile,{...body,choices:[{...body.choices[0],selected:true}]}).choices[0].selected,true)
 assert.equal(propuestaDesdePerfil(profile).choices.length,1)
 assert.equal(valorSenal({key:'ignition.acc',value:false,quality:'valid'}),'OFF')
 assert.equal(valorSenal({key:'battery.level',value:0,quality:'valid',unit:'percent'}),'0 %')
 assert.equal(valorSenal({key:'door.open',value:null,quality:'valid'}),'Sin lectura válida')
 assert.equal(valorSenal({key:'door.open',value:true,quality:'contradictory'}),'Sin lectura válida')
})
import { funcionesTrasInstalar } from '../src/panel/datos/gpsAutodeteccion.js'
test('post-installation confirmation applies preferences once; a later failure never repeats vehicle/GPS creation',async()=>{
 const calls=[],api={leer:async()=>({revision:3,choices:[{selected:true}]}),aplicar:async(...args)=>{calls.push(args)}}
 const obtener=async()=>({instalacionId:assignment}),confirmar=async()=>true
 assert.match(await funcionesTrasInstalar(id,{api,obtener,confirmar,token:'stable-token'}),/Funciones aplicadas/)
 assert.equal(calls.length,1);assert.equal(calls[0][1].preferenceRevision,3);assert.equal(calls[0][1].assignmentId,assignment);assert.equal(calls[0][2],'stable-token')
 calls.length=0
 assert.match(await funcionesTrasInstalar(id,{api,obtener,confirmar:async()=>false,token:'x'}),/guardada/);assert.equal(calls.length,0)
 api.aplicar=async()=>{throw Error('Sin comunicación con la API')}
 assert.match(await funcionesTrasInstalar(id,{api,obtener,confirmar,token:'x'}),/ya están asociados/)
})
