import {useEffect,useRef,useState} from 'react'
import {useDatos} from '../useDatos'
import {ErrorCarga} from '../comp/ui'
import {leerSolicitudesComando,leerSolicitudComando,crearSolicitudComando,confirmarSolicitudComando,cancelarSolicitudComando} from '../datos/comandosInstalacion'
const STATES={requested:'Pendiente de confirmación',validated:'Confirmada, pendiente de envío',dispatching:'Intento reservado',sent:'Enviada',responded:'Respuesta del equipo; efecto sin comprobar',verified:'Efecto comprobado',failed:'No ejecutada o efecto no aplicado según evidencia',expired:'Vencida antes del intento',cancelled:'Cancelada antes del intento',uncertain:'Resultado incierto; sin reintento automático'}
export default function SolicitudesComando({assignmentId,availability,onChanged}){
 const [offset,setOffset]=useState(0),[selected,setSelected]=useState(null),[action,setAction]=useState(''),[reason,setReason]=useState(''),[phrase,setPhrase]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const intention=useRef(null),history=useDatos(()=>leerSolicitudesComando(assignmentId,offset),[assignmentId,offset],5000)
 const actions=availability.items.filter(c=>c.requestAllowed),current=actions.find(c=>`${c.key}:${c.instance}`===action)
 useEffect(()=>{setSelected(null);setPhrase('');setAction('');setReason('');setOffset(0);intention.current=null},[assignmentId])
 const perform=async fn=>{setBusy(true);setError('');try{await fn();history.recargar();onChanged?.()}catch(e){setError(`${e.message} Consulta el historial antes de iniciar otra solicitud.`)}finally{setBusy(false)}}
 const detail=id=>perform(async()=>{setSelected(await leerSolicitudComando(assignmentId,id));setPhrase('')})
 const create=e=>{e.preventDefault();if(!current)return;perform(async()=>{
  const body={commandKey:current.key,instance:current.instance,expectedInstallationVersion:availability.installationVersion,reason:reason.trim(),expiresInSeconds:120}
  const text=JSON.stringify(body);if(intention.current&&intention.current.text!==text)throw new Error('Consulta primero la intención anterior o espera su vencimiento.')
  intention.current??={text,key:crypto.randomUUID()};const saved=await crearSolicitudComando(assignmentId,body,intention.current.key);setSelected(saved);setPhrase('');intention.current=null
 })}
 const confirm=e=>{e.preventDefault();perform(async()=>{setSelected(await confirmarSolicitudComando(assignmentId,selected.requestId,{expectedVersion:selected.version,confirmationPhrase:phrase}));setPhrase('')})}
 const cancel=e=>{e.preventDefault();perform(async()=>{setSelected(await cancelarSolicitudComando(assignmentId,selected.requestId,{expectedVersion:selected.version,reason:reason.trim()}));setPhrase('')})}
 return<section className="cf-editor" aria-label="Solicitudes de comandos"><h3>Solicitudes e historial</h3>
  <p>Crear una solicitud deja una intención pendiente. Confirmarla puede iniciar un único intento si todos los requisitos siguen vigentes. Una respuesta del equipo y el efecto físico se muestran por separado.</p>
  {availability.items.some(c=>c.deliveryPolicy==='bounded_read_queue')&&<p>Las consultas de estado compatibles pueden esperar conexión hasta su vencimiento. Los permisos y la confirmación deben seguir vigentes al enviarlas. Las actuaciones requieren conexión inmediata.</p>}
  {error&&<p role="alert" className="cf-error">{error}</p>}
  {actions.length>0&&<form onSubmit={create}><fieldset disabled={busy}><label>Acción disponible<select required value={action} onChange={e=>setAction(e.target.value)}><option value="">Selecciona una acción</option>{actions.map(c=><option key={`${c.key}:${c.instance}`} value={`${c.key}:${c.instance}`}>{c.name} · Canal {c.instance}</option>)}</select></label>
   {current?.deliveryPolicy==='bounded_read_queue'&&<p>Esta consulta puede quedar pendiente de conexión; esperar no significa que haya sido enviada.</p>}
   <label>Motivo<input required minLength={5} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="pnl-btn" disabled={!current} type="submit">Crear solicitud pendiente</button></fieldset></form>}
  {history.error?<ErrorCarga error={history.error} onReintentar={history.recargar}/>:<>
   {history.datos?.items.map(r=><p key={r.requestId}><button className="pnl-btn" disabled={busy} onClick={()=>detail(r.requestId)}>{r.commandKey} · Canal {r.instance} · {STATES[r.state]||r.state}</button> · {r.createdAt}</p>)}
   {!history.datos?.items.length&&<p>No hay solicitudes registradas.</p>}
   <button className="pnl-btn" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Anteriores</button><button className="pnl-btn" disabled={busy||!history.datos||offset+50>=history.datos.page.total} onClick={()=>setOffset(offset+50)}>Siguientes</button>
  </>}
  <button className="pnl-btn" disabled={busy} onClick={()=>{history.recargar();if(selected)detail(selected.requestId)}}>Consultar solicitudes</button>
  {selected&&<section aria-label="Detalle de solicitud"><h4>{STATES[selected.state]||selected.state}</h4><p>Vehículo: {selected.vehicleLabel||'Consulta la ficha de esta instalación'} · Acción: {selected.commandKey} · Canal {selected.instance}</p><p>Motivo: {selected.reason}</p><p>Vence: {selected.expiresAt} · Intentos: {selected.attempts}/1 · Versión {selected.version}</p>
   <ol>{selected.events.map(e=><li key={e.version}>{e.recordedAt}: {STATES[e.toState]||e.toState}</li>)}</ol>
   {selected.protocolReceipts?.map((r,i)=><p key={i}>Respuesta de protocolo: {r.accepted?'Aceptada por el equipo':'Rechazada por el equipo'} · {r.recordedAt}. El efecto requiere evidencia independiente.</p>)}
   {selected.canConfirm&&<form onSubmit={confirm}><fieldset disabled={busy}><p>Comprueba el vehículo y la acción. Escribe <strong>{selected.confirmationPhrase}</strong> para confirmar esta solicitud.</p><label>Confirmación específica<input required autoComplete="off" value={phrase} onChange={e=>setPhrase(e.target.value)}/></label><button className="pnl-btn" disabled={phrase!==selected.confirmationPhrase} type="submit">Confirmar esta solicitud</button></fieldset></form>}
   {['requested','validated'].includes(selected.state)&&<form onSubmit={cancel}><fieldset disabled={busy}><label>Motivo de cancelación<input required minLength={5} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="pnl-btn" type="submit">Cancelar antes del intento</button></fieldset></form>}
  </section>}
 </section>
}
