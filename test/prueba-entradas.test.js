import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'vite'
const bundle=await build({configFile:false,envFile:false,logLevel:'silent',define:{'import.meta.env.VITE_FOM_API':'"/synthetic"'},build:{ssr:'test/fixtures/prueba-entradas-entry.js',write:false,minify:false}})
const code=bundle.output.find(x=>x.type==='chunk'&&x.isEntry).code
const api=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const date=n=>new Date(Date.UTC(2026,10,8,20,0,n)).toISOString()
const sample=(i,value)=>({sampleKey:String(i),receivedAt:date(i),freshness:'fresh',channels:[{channel:'device.input1_active',value,quality:'valid'},{channel:'device.input2_active',value:false,quality:'valid'}]})
test('diagnóstico exige recepción nueva después de la marca del servidor, sin repetir ni aceptar vencidas',()=>{
 const s=sample(2,false),snapshot={diagnosticOnly:true,checkedAt:date(3),samples:[s]}
 assert.equal(api.muestraDiagnostico(snapshot,date(1)),s)
 assert.equal(api.muestraDiagnostico(snapshot,date(2)),null)
 assert.equal(api.muestraDiagnostico(snapshot,date(1),['2']),null)
 assert.equal(api.muestraDiagnostico({...snapshot,samples:[{...s,freshness:'stale'}]},date(1)),null)
 assert.equal(api.muestraDiagnostico({...snapshot,checkedAt:date(1)},date(0)),null)
})
test('comparación determina la transformación booleana, conserva ambigüedad y rechaza ausencia/contradicción/replay',()=>{
 const a=[sample(1,false),sample(2,true),sample(3,false)]
 assert.deepEqual(api.candidatosEntradas(a),[{channel:'device.input1_active',polarity:'normal'}])
 assert.equal(api.candidatosEntradas([sample(1,true),sample(2,false),sample(3,true)])[0].polarity,'inverted')
 assert.deepEqual(api.candidatosEntradas([a[0],a[1],a[0]]),[])
 assert.deepEqual(api.candidatosEntradas([a[2],a[1],a[0]]),[])
 const bad=structuredClone(a);bad[1].channels[0].quality='contradictory';assert.deepEqual(api.candidatosEntradas(bad),[])
 const ambiguous=a.map(s=>({...s,channels:[s.channels[0],{...s.channels[0],channel:'device.acc_reported'}]}))
 assert.equal(api.candidatosEntradas(ambiguous).length,2)
})
test('propuesta conserva funciones ajenas y no reemplaza un recurso ocupado ni omite una función incompatible',()=>{
 const fn={semanticKey:'door.open',definitionVersion:1,valueKind:'boolean',unit:'none',maxInstances:2,direction:'observation',interpretationSupport:'implemented',requirements:[]}
 const profile={profileId:'synthetic.wizard',profileVersion:2,functions:[fn,{...fn,semanticKey:'input.digital.active'}],nativeChannels:[],resources:[{key:'in1',channel:'device.input1_active',kind:'digital',modes:['digital_input']},{key:'in2',channel:'device.input2_active',kind:'digital',modes:['digital_input']}]}
 const current={isCurrent:true,installationVersion:2,items:[]},candidate={channel:'device.input1_active',polarity:'inverted'}
 const body=api.proponerMapeoEntradas(current,profile,'door.open',1,candidate)
 assert.equal(body.expectedVersion,2);assert.equal(body.functions[0].mapping.polarity,'inverted')
 const occupied={semanticKey:'input.digital.active',instance:1,selected:true,mapping:{...body.functions[0].mapping,semanticKey:'input.digital.active'}}
 assert.throws(()=>api.proponerMapeoEntradas({...current,items:[occupied]},profile,'door.open',1,candidate),/asignada/)
 assert.throws(()=>api.proponerMapeoEntradas({...current,items:[{...occupied,mapping:{...occupied.mapping,channel:'unknown'}}]},profile,'door.open',1,candidate),/conserva/)
 const other={...occupied,mapping:{...occupied.mapping,resourceKey:'in2',channel:'device.input2_active'}}
 assert.equal(api.proponerMapeoEntradas({...current,items:[other]},profile,'door.open',1,candidate).functions.length,2)
})
test('evidencia del mapeo exige IDs elegibles y hora posterior a la fase, con valor esperado',()=>{
 const s={observationId:'one',commissioningEligible:true,quality:'valid',valueKind:'boolean',booleanValue:false,timeEvidenceCurrent:true,historicalOnly:false,receivedAt:date(3),observedAt:date(2)}
 assert.equal(api.muestraPruebaGuiada({items:[s]},date(1),date(4),false),s)
 for(const patch of [{commissioningEligible:false},{timeEvidenceCurrent:false},{historicalOnly:true},{observedAt:null},{observedAt:date(1)},{booleanValue:true},{quality:'contradictory'}])assert.equal(api.muestraPruebaGuiada({items:[{...s,...patch}]},date(1),date(4),false),null)
 assert.equal(api.muestraPruebaGuiada({items:[s]},date(1),date(4),false,['one']),null)
})
