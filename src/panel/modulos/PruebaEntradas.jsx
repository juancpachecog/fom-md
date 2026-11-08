import {useEffect,useRef,useState} from 'react'
import {leerEntradasEnVivo,muestraDiagnostico,candidatosEntradas,proponerMapeoEntradas,muestraPruebaGuiada} from '../datos/pruebaEntradas'
import {leerPerfilFunciones,guardarFuncionesInstalacion,muestrasPruebaFuncion,registrarPruebaFuncion,nombreFuncion} from '../datos/funcionesInstalacion'

export default function PruebaEntradas({assignmentId,current,profiles,onSaved}){
 const [running,setRunning]=useState(false),[snapshot,setSnapshot]=useState(null),[page,setPage]=useState(null)
 const [semantic,setSemantic]=useState('door.open'),[instance,setInstance]=useState(1),[profile,setProfile]=useState(null)
 const [profileKey,setProfileKey]=useState('')
 const [captured,setCaptured]=useState([]),[anchor,setAnchor]=useState(null),[candidate,setCandidate]=useState(null)
 const [mapped,setMapped]=useState(null),[expectedVersion,setExpectedVersion]=useState(current.installationVersion)
 const [confirmed,setConfirmed]=useState(false),[inspection,setInspection]=useState(false),[busy,setBusy]=useState(false)
 const [error,setError]=useState(''),[report,setReport]=useState(null),[message,setMessage]=useState('')
 const mounted=useRef(true),lock=useRef(false),pending=useRef(null),generation=useRef(0)
 const readQueue=useRef(Promise.resolve())
 const requestPreview=()=>{
  const gen=generation.current
  const next=readQueue.current.catch(()=>{}).then(()=>{
   if(!mounted.current||gen!==generation.current||document.hidden)throw Error('Observación detenida.')
   return leerEntradasEnVivo(assignmentId)
  })
  readQueue.current=next;return next
 }
 const reset=()=>{setCaptured([]);setAnchor(null);setCandidate(null);setConfirmed(false);setInspection(false);setReport(null);setError('');pending.current=null}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++}},[])
 useEffect(()=>{
  if(current.installationVersion!==expectedVersion){
   generation.current++;setRunning(false);setMapped(null);setSnapshot(null);setPage(null);reset();
   setExpectedVersion(current.installationVersion);setMessage('Cambió el mapeo. Inicia una secuencia nueva sobre la versión actual.')
  }
 },[current.installationVersion,expectedVersion])
 useEffect(()=>{
  const hide=()=>{if(document.hidden){generation.current++;setRunning(false);setAnchor(null);setCaptured([]);setSnapshot(null);setPage(null);setMessage('Observación pausada al ocultar la pantalla. Reanuda y repite la secuencia.')}}
  document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide)
 },[])
 useEffect(()=>{
  if(!running)return
  let disposed=false,timer;const gen=++generation.current
  const poll=async()=>{
   try{
    const next=await requestPreview()
    const samples=mapped?await muestrasPruebaFuncion(assignmentId,mapped.functionId):null
    if(disposed||gen!==generation.current||document.hidden)return
    if(next.assignmentId!==assignmentId)throw Error('La lectura no corresponde al montaje.')
    setSnapshot(next);setPage(samples);setError('')
    timer=setTimeout(poll,Math.max(3000,Math.min(10000,next.pollAfterMs||3000)))
   }catch(e){if(disposed||gen!==generation.current)return;setError(e.message);setSnapshot(null);setPage(null);setAnchor(null);setCaptured([]);setRunning(false)}
  }
  poll();return()=>{disposed=true;clearTimeout(timer);generation.current++}
 },[running,assignmentId,mapped?.functionId])
 useEffect(()=>{
  if(!running||!anchor||!snapshot||captured.length>=3)return
  const sample=mapped?muestraPruebaGuiada(page,anchor,snapshot.checkedAt,[false,true,false][captured.length],captured.map(s=>s.observationId))
   :muestraDiagnostico(snapshot,anchor,captured.map(s=>s.sampleKey))
  if(sample){setCaptured(items=>[...items,sample]);setAnchor(null)}
 },[snapshot,page,anchor,running,mapped,captured])
 const stop=()=>{generation.current++;setRunning(false);setSnapshot(null);setPage(null);setAnchor(null);setCaptured([]);setInspection(false);setMessage('Observación pausada. La siguiente prueba empieza desde el estado inicial.')}
 const start=()=>{reset();setSnapshot(null);setPage(null);setMessage('Esperando recepción natural. No se envían sondas ni comandos.');setRunning(true)}
 const changeTarget=(key,value)=>{stop();reset();setMapped(null);key==='function'?setSemantic(value):setInstance(Number(value))}
 const selectProfile=async key=>{
  stop();reset();setMapped(null);setProfile(null);setProfileKey(key);if(!key)return
  setBusy(true);const gen=++generation.current
  try{const [id,v]=key.split('@'),p=await leerPerfilFunciones(id,Number(v));if(mounted.current&&gen===generation.current)setProfile(p)}
  catch(e){if(mounted.current)setError(e.message)}finally{if(mounted.current)setBusy(false)}
 }
 const mark=async()=>{
  if(lock.current||!running||anchor)return;lock.current=true;setBusy(true);const gen=generation.current
  try{
   // Establish the boundary with server time AFTER the operator's physical action.
   const boundary=await requestPreview()
   if(!mounted.current||gen!==generation.current||document.hidden)return
   if(boundary.assignmentId!==assignmentId)throw Error('Montaje cambiado.')
   setSnapshot(boundary);setAnchor(boundary.checkedAt);setError('')
  }catch(e){if(mounted.current&&gen===generation.current){setError(e.message);stop()}}finally{lock.current=false;if(mounted.current)setBusy(false)}
 }
 const configure=async()=>{
  if(lock.current||!candidate||!confirmed||!profile)return;lock.current=true;setBusy(true);setError('')
  generation.current++;setRunning(false);setAnchor(null)
  try{
   const body=proponerMapeoEntradas(current,profile,semantic,instance,candidate),fingerprint=JSON.stringify({kind:'mapping',body})
   if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,token:crypto.randomUUID()}
   const saved=await guardarFuncionesInstalacion(assignmentId,body,pending.current.token)
   if(!mounted.current)return
   const fn=saved.items.find(i=>i.semanticKey===semantic&&i.instance===instance)
   if(!fn)throw Error('No se pudo resolver la función guardada. Consulta el montaje antes de repetir.')
   generation.current++;setRunning(false);setMapped(fn);setExpectedVersion(saved.installationVersion);setCaptured([]);setAnchor(null);setSnapshot(null);setPage(null);setInspection(false);pending.current=null
   setMessage('Mapeo guardado y consultado aparte. Inicia ahora una secuencia NUEVA para la prueba de esta versión.');await onSaved()
  }catch(e){if(mounted.current)setError(e.message)}finally{lock.current=false;if(mounted.current)setBusy(false)}
 }
 const saveTest=async(result)=>{
  if(lock.current||!mapped||result==='pass'&&(!inspection||captured.length!==3))return
  lock.current=true;setBusy(true);setError('')
  try{
   const body={result,inspectionAttested:inspection,guidedSequence:true,reasonCode:result==='pass'?null:'test_interrupted',observationIds:result==='pass'?captured.map(s=>s.observationId):[]}
   const fingerprint=JSON.stringify({kind:'test',id:mapped.functionId,body})
   if(pending.current?.fingerprint!==fingerprint)pending.current={fingerprint,token:crypto.randomUUID()}
   const saved=await registrarPruebaFuncion(assignmentId,mapped.functionId,body,pending.current.token)
   if(!mounted.current)return
   setReport(saved);generation.current++;setRunning(false);setAnchor(null);pending.current=null;await onSaved()
  }catch(e){if(mounted.current)setError(e.message)}finally{lock.current=false;if(mounted.current)setBusy(false)}
 }
 const candidates=candidatosEntradas(captured)
 const inactive=semantic==='door.open'?'cerrada':'sin contacto',active=semantic==='door.open'?'abierta':'con contacto, sin arrancar'
 const phase=[inactive,active,inactive][captured.length]
 const latest=snapshot?.samples?.[0]
 return <section className="cf-editor" aria-label="Identificación y prueba de entradas en vivo">
  <h3>Identificar y probar entradas en vivo</h3>
  <p>Recepción natural, actualización cada tres segundos mientras esta pantalla está visible. El reporte del GPS puede tardar más. Este diagnóstico no mide tensión ni determina la polaridad eléctrica del cable.</p>
  {message&&<p role="status">{message}</p>}{error&&<p className="cf-error" role="alert">{error}</p>}
  <fieldset disabled={busy||!!report}><div className="cf-grid">
   <label>Función que vas a comprobar<select value={semantic} disabled={running||!!mapped} onChange={e=>changeTarget('function',e.target.value)}><option value="door.open">Puerta abierta</option><option value="ignition.acc">Contacto (ACC)</option></select></label>
   <label>Sensor o puerta<input type="number" min="1" max="32" value={instance} disabled={running||!!mapped} onChange={e=>changeTarget('instance',e.target.value)}/></label>
   {!mapped&&<label>Perfil revisado<select value={profileKey} disabled={running} onChange={e=>selectProfile(e.target.value)}><option value="">Seleccionar…</option>{profiles.map(p=><option key={`${p.profileId}@${p.profileVersion}`} value={`${p.profileId}@${p.profileVersion}`}>{p.manufacturer} · {p.model} · v{p.profileVersion}</option>)}</select></label>}
  </div>
  {!running?<button type="button" className="pnl-btn primario" disabled={!current.isCurrent||!profile} onClick={start}>{mapped?'Iniciar prueba del mapeo guardado':'Iniciar identificación'}</button>:<button type="button" className="pnl-btn" onClick={stop}>Pausar observación</button>}
  {snapshot&&<div className="cf-scroll"><table><caption>Entradas del último registro decodificado · consulta {snapshot.checkedAt}</caption><thead><tr><th>Canal</th><th>Valor recibido</th><th>Calidad y tiempo</th></tr></thead><tbody>
   {latest?.channels.map(c=><tr key={c.channel}><td>{c.channel}</td><td>{c.quality==='valid'?(c.value?'Activa (true)':'Inactiva (false)'):'Sin valor válido'}</td><td>{({valid:'Válida',missing:'Sin dato',contradictory:'Contradictoria'})[c.quality]} · {latest.freshness==='fresh'?'Recepción reciente':'Vencida'} · {latest.timeQualified?'Hora calificada':'Hora del evento sin calificar'}</td></tr>)}
  </tbody></table><p>Recepción: {latest?.receivedAt||'Sin registro compatible reciente'} · Evento: {latest?.observedAt||'No calificado'}. Estos datos no acreditan por sí solos el estado físico.</p></div>}
  {running&&captured.length<3&&<section className="cf-editor"><h4>{mapped?'Prueba del mapeo actual':'Identificación de canal'} · paso {captured.length+1} de 3</h4>
   <p>Deja la función {phase}. Mantén ese estado mientras esperamos una muestra nueva posterior a tu confirmación.</p>
   <button type="button" className="pnl-btn" disabled={!!anchor||!snapshot} onClick={mark}>Ya está {phase}</button>
   {anchor&&<p role="status">Esperando una muestra nueva después de {anchor}{mapped?', elegible, con hora calificada y valor esperado':''}. No uses un dato anterior.</p>}
  </section>}
  {captured.length>0&&<ol aria-label="Estados capturados">{captured.map((s,i)=><li key={s.sampleKey||s.observationId}>{i+1}. {[inactive,active,inactive][i]} · recepción {s.receivedAt}</li>)}</ol>}
  {!mapped&&captured.length===3&&<section className="cf-editor"><h4>Confirmar canal y transformación</h4>
   <p>{candidates.length===0?'No hay un canal con cambio de ida y vuelta consistente. Revisa la señal y repite.':candidates.length>1?'Varios canales cambiaron. La coincidencia no identifica automáticamente el cable: confirma cuál corresponde al circuito.':'Hay un canal candidato; confirma que corresponde al circuito instalado.'}</p>
   <label>Canal candidato<select value={candidate?.channel||''} onChange={e=>{setCandidate(candidates.find(c=>c.channel===e.target.value)||null);setConfirmed(false);pending.current=null}}><option value="">Seleccionar…</option>{candidates.map(c=><option key={c.channel} value={c.channel}>{c.channel} · sugerencia {c.polarity==='normal'?'Normal':'Invertida'}</option>)}</select></label>
   {candidate&&<p>Transformación propuesta: {candidate.polarity==='normal'?'Normal':'Invertida'}. Se basa en los booleanos recibidos, no en positivo/negativo eléctrico.</p>}
   <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo el canal del circuito y la transformación observada</label>
   <p>Se conservarán las demás funciones compatibles. Una entrada ocupada o un perfil incompatible impide guardar; no se retirarán funciones silenciosamente.</p>
   <button type="button" className="pnl-btn primario" disabled={!candidate||!confirmed} onClick={configure}>Guardar mapeo y continuar con muestras nuevas</button>
  </section>}
  {mapped&&!report&&<section className="cf-editor"><h4>Guardar prueba de {nombreFuncion(semantic)} · {mapped.functionId}</h4>
   <p>Solo se admite la secuencia nueva de tres muestras elegibles del mapeo actual. Las muestras de identificación anteriores no se reutilizan. Sin hora calificada o sin ambos estados, la prueba sigue pendiente.</p>
   <label><input type="checkbox" disabled={captured.length!==3} checked={inspection} onChange={e=>{setInspection(e.target.checked);pending.current=null}}/>Confirmo que inspeccioné físicamente esta función y estos tres estados</label>
   <button type="button" className="pnl-btn primario" disabled={captured.length!==3||!inspection} onClick={()=>saveTest('pass')}>Guardar prueba y comprobar</button>
   <button type="button" className="pnl-btn" onClick={()=>saveTest('fail')}>Registrar prueba interrumpida</button>
  </section>}
  </fieldset>
  {report&&<p role="status">Prueba {report.result==='pass'?'conforme':'no conforme'} guardada y consultada aparte · {report.recordedAt}. No habilita comandos.</p>}
  {report&&<button type="button" className="pnl-btn" onClick={()=>{reset();setMapped(null);setRunning(false);setSnapshot(null);setPage(null)}}>Comprobar otra función</button>}
 </section>
}
