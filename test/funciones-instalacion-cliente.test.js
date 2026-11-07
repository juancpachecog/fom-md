import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'vite'
const bundle=await build({configFile:false,envFile:false,logLevel:'silent',define:{'import.meta.env.VITE_FOM_API':'"/synthetic"'},
 build:{ssr:'test/fixtures/ciclo-datos/funciones-entry.js',write:false,minify:false}})
const code=bundle.output.find(x=>x.type==='chunk'&&x.isEntry).code
const api=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const assignment='11111111-1111-4111-8111-111111111111',key='22222222-2222-4222-8222-222222222222'
const fn={semanticKey:'door.open',definitionVersion:1,valueKind:'boolean',unit:'none',maxInstances:2,direction:'observation',requirements:[]}
const profile={profileId:'synthetic',profileVersion:1,nativeChannels:[],resources:[{key:'d1',channel:'digital.1',kind:'digital',modes:['digital_input']},{key:'d2',channel:'digital.2',kind:'digital',modes:['digital_input']},{key:'a1',channel:'analog.1',kind:'analog',modes:['analog_input']}],functions:[fn]}
test('mapeo ofrece fuentes declaradas compatibles, respeta instancias y no convierte ACC en motor',()=>{
 assert.equal(api.fuentesFuncion(profile,fn).length,2)
 assert.equal(api.nombreFuncion('ignition.acc'),'Contacto (ACC)')
 const first=api.nuevaFilaFuncion(profile,fn,[]),second=api.nuevaFilaFuncion(profile,fn,[first])
 assert.equal(first.mapping.instance,1);assert.equal(second.mapping.instance,2)
 assert.notEqual(first.mapping.resourceKey,second.mapping.resourceKey)
 assert.equal(first.mapping.mode,'digital_input');assert.equal(first.mapping.polarity,'normal')
 assert.throws(()=>api.nuevaFilaFuncion(profile,fn,[first,second]),/máximo/)
 assert.throws(()=>api.nuevaFilaFuncion(profile,{...fn,direction:'command'},[]),/lectura/)
 assert.equal(api.valorFuncion({quality:'valid',valueKind:'numeric',numericValue:0}),'0')
 assert.equal(api.valorFuncion({quality:'valid',valueKind:'boolean',booleanValue:false}),'No')
 assert.equal(api.valorFuncion({quality:'invalid',valueKind:'numeric',numericValue:0}),'Sin valor válido')
})
test('configurar no certifica: PUT explícito, llave estable y lectura independiente de versión',async()=>{
 const old=globalThis.fetch,calls=[]
 const body={expectedVersion:0,profileId:'synthetic',profileVersion:1,functions:[]}
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(options.method==='PUT'?{assignmentId:assignment,version:1}
 :{assignmentId:assignment,installationVersion:1,profileId:'synthetic',profileVersion:1,items:[]}),{status:200})}
 try {await api.guardarFuncionesInstalacion(assignment,body,key);assert.equal(calls.length,2);assert.equal(calls[0].options.method,'PUT');assert.equal(calls[1].options.method,'GET');assert.equal(calls[0].options.headers['idempotency-key'],key)}
 finally {globalThis.fetch=old}
})
test('prueba exige inspección explícita y muestras elegibles; ausencia permite registrar fallo',()=>{
 const samples=[{observationId:key,commissioningEligible:true},{observationId:assignment,commissioningEligible:false}]
 const form={result:'pass',inspectionAttested:true,observationIds:[key],reasonCode:''}
 assert.deepEqual(api.cuerpoPruebaFuncion(form,samples),{result:'pass',inspectionAttested:true,observationIds:[key],reasonCode:null})
 assert.throws(()=>api.cuerpoPruebaFuncion({...form,inspectionAttested:false},samples),/confirmar/)
 assert.throws(()=>api.cuerpoPruebaFuncion({...form,observationIds:[assignment]},samples),/elegibles/)
 assert.throws(()=>api.cuerpoPruebaFuncion({...form,observationIds:[]},samples),/seleccionar/)
 assert.equal(api.cuerpoPruebaFuncion({result:'fail',inspectionAttested:false,observationIds:[],reasonCode:'no_signal'},[]).result,'fail')
})
test('resultado de prueba sólo se acepta tras consulta exacta y no habilita ni envía comandos',async()=>{
 const old=globalThis.fetch,calls=[],body={result:'pass',inspectionAttested:true,reasonCode:null,observationIds:[key]};let bad=false
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(options.method==='POST'?{reportId:key}
  :{reportId:key,assignmentId:assignment,functionId:'1-1',...body,inspectionAttested:!bad}),{status:200})}
 try{
  await api.registrarPruebaFuncion(assignment,'1-1',body,key)
  assert.equal(calls.length,2);assert.equal(calls[0].options.method,'POST');assert.equal(calls[1].options.method,'GET');assert.match(calls[1].url,/test-reports\//)
  bad=true;await assert.rejects(()=>api.registrarPruebaFuncion(assignment,'1-1',body,key),/no quedó verificada/)
 }finally{globalThis.fetch=old}
})
