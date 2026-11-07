import test from 'node:test'
import assert from 'node:assert/strict'
import {build} from 'vite'
const bundle=await build({configFile:false,envFile:false,logLevel:'silent',define:{'import.meta.env.VITE_FOM_API':'"/synthetic"'},build:{ssr:'test/fixtures/ciclo-datos/segundo-factor-entry.js',write:false,minify:false}})
const api=await import(`data:text/javascript;base64,${Buffer.from(bundle.output.find(x=>x.type==='chunk'&&x.isEntry).code).toString('base64')}`)
const id='11111111-1111-4111-8111-111111111111',expires='2026-11-06T22:00:00.000Z'
test('MFA enrollment, activation and revocation require independent exact credential state',async()=>{
 const old=globalThis.fetch,calls=[];let active=false,revoked=false
 globalThis.fetch=async(url,o)=>{
  calls.push({url,o});const path=new URL(url,'http://synthetic').pathname
  let body
  if(o.method==='POST'){
   if(path.endsWith('/enrollment'))body={credentialId:id,secret:'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',algorithm:'SHA1',digits:6,period:30,expiresAt:expires}
   else if(path.endsWith('/revoke')){revoked=true;active=false;body={credentialId:id,revoked:true}}
   else{active=true;body={credentialId:id,expiresAt:expires}}
  }else body=path.includes('/credentials/')?{credentialId:id,state:revoked?'revoked':active?'active':'pending',revokedAt:revoked?expires:null}
   :{configured:true,state:active?'active':'not_enrolled',credentialId:active?id:null,proofExpiresAt:active?expires:null}
  return new Response(JSON.stringify(body),{status:200})
 }
 try{
  assert.equal((await api.iniciarSegundoFactor('synthetic password')).credentialId,id)
  await api.activarSegundoFactor(id,'123456');await api.verificarSegundoFactor('234567');await api.revocarSegundoFactor(id,'synthetic password','345678')
  assert.equal(calls.filter(c=>c.o.method==='POST').length,4);assert.equal(calls.filter(c=>c.o.method==='GET').length,5)
  for(const c of calls.filter(c=>c.o.method==='POST')){assert.equal(c.o.headers['idempotency-key'],undefined);assert.equal(c.o.credentials,'same-origin')}
  assert.match(calls[1].url,/credentials\//)
 }finally{globalThis.fetch=old}
})
test('MFA uncertain POST is never retried automatically and bad factor differs from expired session',async()=>{
 const old=globalThis.fetch,calls=[];globalThis.fetch=async(url,o)=>{calls.push({url,o});return new Response('{"code":"invalid_second_factor","message":"Not accepted"}',{status:401})}
 try{await assert.rejects(()=>api.verificarSegundoFactor('123456'),/segundo factor/);assert.equal(calls.length,1);assert.equal(calls[0].o.method,'POST')}finally{globalThis.fetch=old}
})
