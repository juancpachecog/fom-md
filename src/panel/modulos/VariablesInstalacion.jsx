import {useRef,useState} from 'react'
import {useDatos} from '../useDatos'
import {Cargando,ErrorCarga} from '../comp/ui'
import {leerVariablesInstalacion,listarVariablesEmpresa,guardarVinculoVariable,historialVinculoVariable,fuenteCompatible,cuerpoVinculo} from '../datos/variablesInstalacion'
import {nombreFuncion} from '../datos/funcionesInstalacion'

export default function VariablesInstalacion({assignmentId,sources}){
 const sourceVersions=sources.map(s=>s.functionId).join(',')
 const data=useDatos(()=>leerVariablesInstalacion(assignmentId),[assignmentId,sourceVersions],30000)
 const catalog=useDatos(()=>data.datos?.tenantId?listarVariablesEmpresa(data.datos.tenantId):Promise.resolve(null),[data.datos?.tenantId])
 const [form,setForm]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const lock=useRef(false),pending=useRef(null)
 const [history,setHistory]=useState(null),[historyBusy,setHistoryBusy]=useState(false)
 const historyLock=useRef(false)
 const loadHistory=async(item,append=false)=>{
  if(historyLock.current)return
  historyLock.current=true;setHistoryBusy(true);setError('')
  try{
   const page=await historialVinculoVariable(assignmentId,item.entryId,item.instance,append?history.nextBeforeVersion:undefined)
   setHistory(previous=>({...page,name:item.name,items:append?[...previous.items,...page.items]:page.items}))
  }catch(e){setError(e.message)}finally{historyLock.current=false;setHistoryBusy(false)}
 }
 const variable=catalog.datos?.items.find(item=>item.id===form?.entryId)
 const change=(key,value)=>{setForm(f=>({...f,[key]:value}));pending.current=null}
 const edit=item=>{setForm(item?{entryId:item.entryId,...item.mapping,instance:String(item.instance),scale:String(item.mapping.scale),offset:String(item.mapping.offset),reason:''}
  :{entryId:'',sourceFunctionId:'',definitionVersion:1,instance:'1',scale:'1',offset:'0',polarity:'normal',selected:true,expectedVersion:0,reason:''});pending.current=null;setError('');setMessage('')}
 const save=async event=>{
  event.preventDefault();if(lock.current)return
  lock.current=true;setBusy(true);setError('');setMessage('')
  try{
   const body=cuerpoVinculo(form,variable),fingerprint=JSON.stringify({entry:form.entryId,body})
   if(!pending.current||pending.current.fingerprint!==fingerprint)pending.current={fingerprint,token:crypto.randomUUID()}
   await guardarVinculoVariable(assignmentId,form.entryId,body,pending.current.token)
   setForm(null);pending.current=null;setMessage('Vínculo guardado y consultado aparte. La verificación física sigue pendiente.');await data.recargar()
  }catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}
 }
 if(data.estado==='cargando'&&!data.datos)return<Cargando filas={2}/>
 if(data.error)return<ErrorCarga error={data.error} onReintentar={data.recargar}/>
 const options=variable?sources.filter(s=>fuenteCompatible(variable,s)):[]
 return<section className="cf-editor"><h3>Variables propias de esta instalación</h3>
  <p>Vincula una variable de la empresa con una señal de este montaje. Cada lectura conserva su origen; los valores anteriores al vínculo no se reinterpretan.</p>
  {error&&<p className="cf-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  {catalog.error?<ErrorCarga error={catalog.error} onReintentar={catalog.recargar}/>:<button className="pnl-btn" disabled={busy||!catalog.datos?.items.length} onClick={()=>edit(null)}>Vincular variable</button>}
  {catalog.datos&&!catalog.datos.items.length&&<p>Crea primero una variable en el catálogo de esta empresa.</p>}
  <div className="cf-scroll"><table><thead><tr><th>Variable</th><th>Fuente</th><th>Lectura derivada</th><th>Vigencia</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
   {data.datos?.items.map(item=><tr key={`${item.entryId}:${item.instance}`}><td>{item.name} · {item.instance}</td><td>{item.sourceFunctionId}{!item.sourceMappingCurrent&&' · mapeo anterior'}</td>
    <td>{item.projection.observation.status==='valid'?typeof item.projection.observation.value==='boolean'?(item.projection.observation.value?'Sí':'No'):String(item.projection.observation.value):'Sin valor válido'}</td>
    <td>{({fresh:'Reciente',stale:'Vencida',unknown:'Sin calificar',missing:'Sin dato'})[item.projection.freshness]||'Sin calificar'}</td><td>{item.status==='retired'||!item.mapping.selected?'Retirada de uso':'Pendiente de verificación'}</td>
    <td><button className="pnl-btn" disabled={busy} onClick={()=>edit(item)}>Editar vínculo</button><button className="pnl-btn" disabled={historyBusy} onClick={()=>loadHistory(item)}>Historial del vínculo</button></td></tr>)}
  </tbody></table></div>
  {history&&<section aria-label="Historial del vínculo"><h4>{history.name} · revisiones conservadas</h4>
   <div className="cf-scroll"><table><thead><tr><th>Versión</th><th>Vigencia desde</th><th>Fuente</th><th>Uso</th><th>Transformación</th><th>Motivo</th></tr></thead><tbody>
    {history.items.map(r=><tr key={r.version}><td>{r.version}</td><td>{r.effectiveFrom}</td><td>{r.sourceFunctionId}</td><td>{r.selected?'Seleccionado':'Retirado'}</td><td>{r.polarity} · ×{r.scale} +{r.offset}</td><td>{r.reason}</td></tr>)}
   </tbody></table></div>
   {history.nextBeforeVersion&&<button className="pnl-btn" disabled={historyBusy} onClick={()=>loadHistory(history,true)}>Cargar revisiones anteriores</button>}
   <button className="pnl-btn" disabled={historyBusy} onClick={()=>setHistory(null)}>Cerrar historial</button>
  </section>}
  {form&&<form onSubmit={save}><fieldset disabled={busy}><div className="cf-grid">
   <label>Variable<select required disabled={form.expectedVersion>0} value={form.entryId} onChange={e=>{const v=catalog.datos.items.find(v=>v.id===e.target.value);setForm(f=>({...f,entryId:e.target.value,sourceFunctionId:'',definitionVersion:v?.definitionVersion||1,selected:v?.status==='active'}));pending.current=null}}><option value="">Seleccionar…</option>{catalog.datos?.items.map(v=><option key={v.id} value={v.id}>{v.name}{v.status==='retired'?' · retirada':''}</option>)}</select></label>
   <label>Fuente recibida<select required value={form.sourceFunctionId} onChange={e=>change('sourceFunctionId',e.target.value)}><option value="">Seleccionar…</option>{options.map(s=><option key={s.functionId} value={s.functionId}>{nombreFuncion(s.semanticKey)} · {s.instance}</option>)}
    {form.sourceFunctionId&&!options.some(s=>s.functionId===form.sourceFunctionId)&&<option value={form.sourceFunctionId}>{form.sourceFunctionId} · fuente anterior conservada</option>}</select></label>
   <label>Sensor<input type="number" required min="1" max={variable?.definition.maxInstances||32} disabled={form.expectedVersion>0} value={form.instance} onChange={e=>change('instance',e.target.value)}/></label>
   {variable?.definition.kind==='boolean'?<label>Polaridad<select value={form.polarity} onChange={e=>change('polarity',e.target.value)}><option value="normal">Normal</option><option value="inverted">Invertida</option></select></label>:variable?.definition.kind==='numeric'?<>
    <label>Multiplicador<input type="number" step="any" required value={form.scale} onChange={e=>change('scale',e.target.value)}/></label><label>Desplazamiento<input type="number" step="any" required value={form.offset} onChange={e=>change('offset',e.target.value)}/></label></>:null}
   <label>Usar vínculo<input type="checkbox" checked={form.selected&&variable?.status==='active'} disabled={variable?.status==='retired'} onChange={e=>change('selected',e.target.checked)}/></label>
   <label>Motivo<textarea required minLength={5} maxLength={300} value={form.reason} onChange={e=>change('reason',e.target.value)}/></label>
  </div><p>Desmarcar «Usar vínculo» lo retira conservando su historia. Ningún cambio habilita hardware.</p><button className="pnl-btn" type="submit">Guardar vínculo y comprobar</button><button className="pnl-btn" type="button" onClick={()=>setForm(null)}>Cancelar</button></fieldset></form>}
 </section>
}
