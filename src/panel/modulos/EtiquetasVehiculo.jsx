import {useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {useDatos} from '../useDatos'
import {Cargando,ErrorCarga} from '../comp/ui'
import {leerEtiquetasVehiculo,catalogoEtiquetasEmpresa,guardarEtiquetaVehiculo,historialEtiquetaVehiculo} from '../datos/etiquetasVehiculo'
import './catalogo-funciones.css'
export default function EtiquetasVehiculo({vehicleId}){
 const data=useDatos(()=>leerEtiquetasVehiculo(vehicleId),[vehicleId])
 const catalog=useDatos(()=>data.datos?.tenantId?catalogoEtiquetasEmpresa(data.datos.tenantId):Promise.resolve(null),[data.datos?.tenantId])
 const [form,setForm]=useState(null),[history,setHistory]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const lock=useRef(false),pending=useRef(null)
 const open=item=>{setForm({entryId:item?.entryId||'',expectedVersion:item?.version||0,selected:item?!item.requestedSelection:true,reason:''});pending.current=null;setError('');setMessage('')}
 const change=(key,value)=>{setForm(f=>({...f,[key]:value}));pending.current=null}
 const save=async e=>{
  e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('')
  try{
   const body={selected:form.selected,expectedVersion:form.expectedVersion,reason:form.reason.trim()},fingerprint=JSON.stringify({entry:form.entryId,body})
   if(!pending.current||pending.current.fingerprint!==fingerprint)pending.current={fingerprint,token:crypto.randomUUID()}
   await guardarEtiquetaVehiculo(vehicleId,form.entryId,body,pending.current.token)
   setForm(null);pending.current=null;setMessage('Etiqueta guardada y consultada aparte.');await data.recargar()
  }catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}
 }
 const loadHistory=async(item,append=false)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('')
  try{const page=await historialEtiquetaVehiculo(vehicleId,item.entryId,append?history.nextBeforeVersion:undefined);setHistory(previous=>({...page,entryId:item.entryId,name:item.name,items:append?[...previous.items,...page.items]:page.items}))}
  catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}
 }
 if(data.estado==='cargando'&&!data.datos)return<Cargando filas={2}/>
 if(data.error)return<ErrorCarga error={data.error} onReintentar={data.recargar}/>
 const available=catalog.datos?.items.filter(t=>t.status==='active'&&!data.datos?.items.some(r=>r.entryId===t.id))||[]
 return<section className="cf-editor"><h3>Etiquetas del vehículo</h3><p>Organizan la flota. No representan sensores, certificaciones ni permisos de actuación.</p>
  <Link to="/panel/funciones">Administrar variables y etiquetas</Link>
  {error&&<p className="cf-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {catalog.error?<ErrorCarga error={catalog.error} onReintentar={catalog.recargar}/>:<button className="pnl-btn" disabled={busy||!available.length} onClick={()=>open(null)}>Asignar etiqueta</button>}
  {catalog.datos&&!available.length&&<p>No quedan etiquetas nuevas para asignar. Puedes crear otra en el catálogo.</p>}
  <div className="cf-scroll"><table><thead><tr><th>Etiqueta</th><th>Estado</th><th>Versión</th><th>Acciones</th></tr></thead><tbody>
   {data.datos?.items.map(item=><tr key={item.entryId}><td>{item.name}</td><td>{item.status==='retired'?'Retirada del catálogo':item.selected?'Asignada':'Retirada del vehículo'}</td><td>{item.version}</td><td>
    <button className="pnl-btn" disabled={busy||item.status==='retired'&&!item.requestedSelection} onClick={()=>open(item)}>{item.requestedSelection?'Retirar etiqueta':'Volver a asignar'}</button>
    <button className="pnl-btn" disabled={busy} onClick={()=>loadHistory(item)}>Historial de etiqueta</button></td></tr>)}
  </tbody></table></div>
  {form&&<form onSubmit={save}><fieldset disabled={busy}><div className="cf-grid">
   <label>Etiqueta<select required disabled={form.expectedVersion>0} value={form.entryId} onChange={e=>change('entryId',e.target.value)}><option value="">Seleccionar…</option>
    {form.expectedVersion>0?<option value={form.entryId}>{data.datos.items.find(t=>t.entryId===form.entryId)?.name}</option>:available.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
   <label>Motivo<textarea required minLength={5} maxLength={300} value={form.reason} onChange={e=>change('reason',e.target.value)}/></label>
   </div><p>{form.selected?'Asignar al vehículo':'Retirar del uso conservando las revisiones anteriores'}</p><button className="pnl-btn" type="submit">Guardar etiqueta y comprobar</button><button className="pnl-btn" type="button" onClick={()=>setForm(null)}>Cancelar</button></fieldset></form>}
  {history&&<section aria-label="Historial de etiqueta"><h4>{history.name} · revisiones conservadas</h4><table><thead><tr><th>Versión</th><th>Fecha</th><th>Solicitud</th><th>Motivo</th></tr></thead><tbody>
   {history.items.map(r=><tr key={r.version}><td>{r.version}</td><td>{r.effectiveFrom}</td><td>{r.requestedSelection?'Asignar':'Retirar'}</td><td>{r.reason}</td></tr>)}
  </tbody></table>{history.nextBeforeVersion&&<button className="pnl-btn" disabled={busy} onClick={()=>loadHistory(history,true)}>Cargar revisiones anteriores</button>}<button className="pnl-btn" disabled={busy} onClick={()=>setHistory(null)}>Cerrar historial de etiqueta</button></section>}
 </section>
}
