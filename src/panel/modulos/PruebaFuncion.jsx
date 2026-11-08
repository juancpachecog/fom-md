import {useRef,useState} from 'react'
import {useDatos} from '../useDatos'
import {Cargando,ErrorCarga} from '../comp/ui'
import {muestrasPruebaFuncion,cuerpoPruebaFuncion,registrarPruebaFuncion,nombreFuncion,valorFuncion} from '../datos/funcionesInstalacion'
const reasons=[['no_signal','No llegó señal'],['unexpected_value','Valor inesperado'],['wiring_unconfirmed','Cableado sin confirmar'],['interpretation_missing','Interpretación pendiente'],['test_interrupted','Prueba interrumpida']]
export default function PruebaFuncion({assignmentId,fn,onClose,onSaved}){
 const data=useDatos(()=>muestrasPruebaFuncion(assignmentId,fn.functionId),[assignmentId,fn.functionId])
 const [form,setForm]=useState({result:'',inspectionAttested:false,reasonCode:'',observationIds:[]})
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[report,setReport]=useState(null)
 const lock=useRef(false),pending=useRef(null)
 const change=(key,value)=>{setForm(f=>({...f,[key]:value}));pending.current=null}
 const save=async e=>{
  e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('')
  try{
   const body=cuerpoPruebaFuncion(form,data.datos?.items||[]),fingerprint=JSON.stringify(body)
   if(!pending.current||pending.current.fingerprint!==fingerprint)pending.current={fingerprint,token:crypto.randomUUID()}
   const saved=await registrarPruebaFuncion(assignmentId,fn.functionId,body,pending.current.token)
   setReport(saved);pending.current=null;await onSaved()
  }catch(e){setError(e.message)}finally{lock.current=false;setBusy(false)}
 }
 return<section className="cf-editor" aria-label="Registro de prueba de función"><h3>Prueba de {nombreFuncion(fn.semanticKey)} · sensor {fn.instance}</h3>
  <p>Registra únicamente lo que inspeccionaste en esta instalación. El servidor comprueba la versión y la vigencia de las muestras. Este registro no transmite comandos ni habilita salidas.</p>
  {error&&<p role="alert" className="cf-error">{error}</p>}
  {report?<p role="status">Prueba {report.result==='pass'?'conforme':'no conforme'} registrada y consultada aparte · {report.recordedAt}. Fuente: declaración del gestor. La habilitación se evalúa por separado.</p>:data.error?<ErrorCarga error={data.error} onReintentar={data.recargar}/>:data.estado==='cargando'?<Cargando filas={2}/>:<form onSubmit={save}><fieldset disabled={busy}>
   <p>Muestras de los últimos quince minutos. Las no elegibles se muestran sin permitir seleccionarlas.</p>
   <button className="pnl-btn" type="button" disabled={busy} onClick={data.recargar}>Actualizar muestras de la prueba</button>
   {!data.datos?.items.length&&<p>No hay muestras en esta ventana. Puedes registrar el motivo de una prueba no conforme.</p>}
   {data.datos?.items.map(s=><label className="cf-toolbar" key={s.observationId}><input type="checkbox" disabled={s.commissioningEligible!==true||!form.observationIds.includes(s.observationId)&&form.observationIds.length>=8}
    checked={form.observationIds.includes(s.observationId)} onChange={e=>change('observationIds',e.target.checked?[...form.observationIds,s.observationId]:form.observationIds.filter(id=>id!==s.observationId))}/>
    {valorFuncion(s,fn.semanticKey)} · evento {s.observedAt||'Sin hora calificada'} · recepción {s.receivedAt} · {s.quality}{s.commissioningEligible!==true?' · No elegible':''}</label>)}
   <div className="cf-grid"><label>Resultado<select required value={form.result} onChange={e=>change('result',e.target.value)}><option value="">Seleccionar…</option><option value="pass">Conforme a lo inspeccionado</option><option value="fail">No conforme</option></select></label>
    {form.result==='fail'&&<label>Motivo del resultado<select required value={form.reasonCode} onChange={e=>change('reasonCode',e.target.value)}><option value="">Seleccionar…</option>{reasons.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>}
    <label><input type="checkbox" checked={form.inspectionAttested} onChange={e=>change('inspectionAttested',e.target.checked)}/>Confirmo que realicé la inspección de esta función y este montaje</label>
   </div><button className="pnl-btn" type="submit">Registrar prueba y comprobar</button>
  </fieldset></form>}
  <button className="pnl-btn" disabled={busy} onClick={onClose}>Cerrar prueba</button>
 </section>
}
