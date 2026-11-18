import { useEffect, useMemo, useState } from 'react'
import { pedir } from '../datos/api'
import { apiAutodeteccion, nombreSenal, valorSenal } from '../datos/gpsAutodeteccion'
import { fechaHoraEquipo, horaGps, muestraTramaVigente, ubicacionTrama, motivoRevision } from '../datos/revisionTramaGps'
import './revision-trama-gps.css'

export function useRevisionTrama({id,imei,transport,habilitada=true}) {
 const api=useMemo(()=>apiAutodeteccion(pedir),[])
 const scope=JSON.stringify([id??null,imei??null,transport??null])
 const [state,setState]=useState({scope:'',snapshot:null,error:''})
 useEffect(()=>{
  if(!habilitada||(!id&&!imei))return
  let active=true,busy=false
  const leer=async()=>{
   if(busy)return
   busy=true
   try {
    const snapshot=await api.revisar({id,imei,transport})
    if(snapshot?.privatePosition!==true||snapshot.reviewVersion!=='gps.frame-review.v1')throw Error('El servidor todavía no ofrece una revisión válida de la trama.')
    if(active)setState({scope,snapshot,error:''})
   }catch(e){if(active)setState(previous=>({scope,snapshot:previous.scope===scope?previous.snapshot:null,error:e.message||'No se pudo revisar la lectura.'}))}
   finally{busy=false}
  }
  leer();const timer=window.setInterval(leer,5000)
  return()=>{active=false;window.clearInterval(timer)}
 },[scope,habilitada,api])
 return habilitada&&state.scope===scope ? {...state,imei,id,transport} : {scope,imei,id,transport,snapshot:null,error:''}
}

export default function RevisionTramaGps({revision,imei,ahora=Date.now(),registrado=false}) {
 const snapshot=revision?.snapshot,error=revision?.error
 const ready=!error&&muestraTramaVigente(snapshot,ahora)
 const [verSenales,setVerSenales]=useState(false)
 const [paginaSenales,setPaginaSenales]=useState(0)
 const signals=snapshot?.signals??[],pages=Math.max(1,Math.ceil(signals.length/4)),page=Math.min(paginaSenales,pages-1)
 const showingReadings=verSenales&&signals.length>0
 const facts=[['IMEI',imei||'Identidad de la ficha'],['Identidad en la trama',snapshot?.identityMatches?'Coincide con el equipo':'Sin muestra coincidente'],
  ['Fecha y hora del equipo',fechaHoraEquipo(snapshot?.deviceDateTime)],['Hora GPS reportada',horaGps(snapshot?.gpsClock)],
  ['Ubicación (latitud, longitud)',ubicacionTrama(snapshot?.position)],['Recepción · Venezuela',snapshot?.sample?.receivedAt?new Date(snapshot.sample.receivedAt).toLocaleString('es-VE',{timeZone:'America/Caracas'}):'Sin trama de posición']]
 return <section className="gp-frame-review" aria-label="Validación de la trama GPS">
  <div className={`gp-frame-state ${ready?'ready':'pending'}`} role="status"><i aria-hidden="true"/><div><b>{ready?registrado?'Trama interpretada · lectura válida':'Trama interpretada · lista para registrar':snapshot?'Trama pendiente de validación':'Interpretando la trama…'}</b><small>{snapshot?.sample?`Coban · ${snapshot.sample.fieldCount} campos · firmware sin identificar`:'Fecha, hora, identidad y ubicación antes del registro'}</small></div></div>
  {error&&<p className="gp-error" role="alert">{error} Las lecturas anteriores no habilitan el registro.</p>}
  {snapshot&&<>
   <dl className="gp-discovery-facts gp-frame-facts">{facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
   {!ready&&!error&&<p className="gp-aviso" title={snapshot.validation?.blockingReasons?.map(motivoRevision).join(' ')}>{snapshot.validation?.blockingReasons?.[0]?motivoRevision(snapshot.validation.blockingReasons[0]):'Esperando una posición reciente para registrar.'}</p>}
   <p className="gp-frame-note">La fecha y hora del equipo se muestran como llegaron. Su zona horaria sigue sin comprobar; la recepción sí tiene referencia del servidor.</p>
   <div className="gp-frame-signals"><button type="button" className="gp-btn2 chico" disabled={!signals.length} aria-expanded={showingReadings} onClick={()=>setVerSenales(v=>!v)}>{!signals.length?'Sin señales adicionales':showingReadings?'Ocultar lecturas':`Ver ${signals.length} señales recibidas`}</button><small>ACC, puerta y sensores se revisan en Funciones.</small></div>
   {showingReadings&&<><dl className="gp-discovery-facts gp-frame-readings">{signals.slice(page*4,(page+1)*4).map(s=><div key={s.key}><dt>{nombreSenal(s.key)}{s.freshness==='stale'?' · lectura anterior':''}</dt><dd>{valorSenal(s)}</dd></div>)}</dl>{pages>1&&<div className="gp-discovery-pagination"><button type="button" className="gp-btn2 chico" disabled={!page} onClick={()=>setPaginaSenales(page-1)}>Anterior</button><span>{page+1} / {pages}</span><button type="button" className="gp-btn2 chico" disabled={page+1>=pages} onClick={()=>setPaginaSenales(page+1)}>Siguiente</button></div>}</>}
  </>}
 </section>
}

export function RevisionTramaRegistrada({id,imei,transport,ahora}) {
 const revision=useRevisionTrama({id,imei,transport})
 return <RevisionTramaGps revision={revision} imei={imei} ahora={ahora} registrado/>
}
