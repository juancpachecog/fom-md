import React from 'react'
import {createRoot} from 'react-dom/client'
import {BrowserRouter} from 'react-router-dom'
import EtiquetasVehiculo from '../../../src/panel/modulos/EtiquetasVehiculo.jsx'
const vehicle='11111111-1111-4111-8111-111111111111',entry='22222222-2222-4222-8222-222222222222'
let items=[],history=[]
const tag={id:entry,key:'ruta_norte',category:'tag',name:'Ruta norte sintética',description:'Ensayo',status:'active',version:1,definition:null}
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})
globalThis.fetch=async(url,options={})=>{
 const u=new URL(String(url),location.origin)
 if(!u.pathname.startsWith('/fixture-api/api/v1/console/'))throw Error('Synthetic fixture rejects other network access')
 if(u.pathname.endsWith('/gps-managed-catalog'))return response({items:[tag],total:1,limit:25,offset:0})
 if(u.pathname.endsWith('/managed-tags'))return response({vehicleId:vehicle,tenantId:vehicle,items,nextBeforeVersion:null})
 if(u.pathname.endsWith('/history'))return response({vehicleId:vehicle,tenantId:vehicle,items:history,nextBeforeVersion:null})
 if(u.pathname.endsWith('/managed-tags/'+entry)&&options.method==='POST'){
  const body=JSON.parse(options.body)
  if(body.expectedVersion!==(items[0]?.version||0))return response({message:'Version conflict'},409)
  const row={entryId:entry,key:tag.key,name:tag.name,status:'active',version:body.expectedVersion+1,selected:body.selected,requestedSelection:body.selected,reason:body.reason,effectiveFrom:new Date().toISOString()}
  items=[row];history.unshift(row);return response({vehicleId:vehicle,entryId:entry,version:row.version,replayed:false})
 }
 throw Error('Unrecognized synthetic request')
}
document.body.style.fontFamily='system-ui';document.body.style.padding='20px'
createRoot(document.getElementById('root')).render(<BrowserRouter><p>ENSAYO SINTÉTICO · sin hardware ni base productiva</p><EtiquetasVehiculo vehicleId={vehicle}/></BrowserRouter>)
