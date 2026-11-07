import React from 'react'
import { createRoot } from 'react-dom/client'
import CatalogoFunciones from '../../../src/panel/modulos/CatalogoFunciones.jsx'
import '../../../src/styles/apariencia.css'
const id='11111111-1111-4111-8111-111111111111', records=new Map(), receipts=new Map()
let writes=0
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})
globalThis.fetch=async(url,options={})=>{
 const path=new URL(String(url),location.origin).pathname,method=options.method||'GET'
 const base='/fixture-api/api/v1/console/gps-managed-catalog'
 if(!path.startsWith(base))throw Error('Synthetic fixture refuses other network access')
 if(method==='GET'){
  if(path===base)return response({items:[...records.values()].map(a=>a.at(-1)),total:records.size,limit:25,offset:0})
  const parts=path.slice(base.length+1).split('/'),all=records.get(parts[0])
  return all?response({items:parts[1]==='history'?[...all].reverse():[all.at(-1)],total:all.length,limit:50,offset:0}):response({message:'Unavailable'},404)
 }
 if(!['POST','PUT'].includes(method)||options.headers['x-fom-csrf']!=='fom-browser-v1')return response({message:'Synthetic rejected'},403)
 const body=JSON.parse(options.body),token=options.headers['idempotency-key'],fingerprint=JSON.stringify({path,body})
 if(receipts.has(token)){const old=receipts.get(token);return old.fingerprint===fingerprint?response({...old.receipt,replayed:true}):response({message:'Conflict'},409)}
 const current=records.get(id)?.at(-1)
 if((current?.version||0)!==body.expectedVersion)return response({message:'Version conflict'},409)
 const version=body.expectedVersion+1
 const item={...body,id,version,signalId:body.category==='variable'?'22222222-2222-4222-8222-222222222222':null,definitionVersion:body.category==='variable'?version:null,recordedAt:new Date().toISOString()}
 records.set(id,[...(records.get(id)||[]),item]); writes++
 document.getElementById('stats').textContent=`Revisiones sintéticas guardadas: ${writes}`
 const receipt={entryId:id,version,replayed:false};receipts.set(token,{fingerprint,receipt})
 return response(receipt)
}
document.body.style.fontFamily='system-ui';document.body.style.padding='20px'
createRoot(document.getElementById('root')).render(<><p role="note">ENSAYO SINTÉTICO · sin base productiva ni hardware</p><p id="stats">Revisiones sintéticas guardadas: 0</p><CatalogoFunciones/></>)
