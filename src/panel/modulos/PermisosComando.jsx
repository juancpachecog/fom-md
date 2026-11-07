import {useEffect,useState} from 'react'
import {useDatos} from '../useDatos'
import {ErrorCarga} from '../comp/ui'
import {guardarPermisoComando,leerDestinatariosComando,leerPermisosComando} from '../datos/comandosInstalacion'
export default function PermisosComando({assignmentId,actions,onChanged}){
 const [offset,setOffset]=useState(0),[history,setHistory]=useState(false),[editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const grants=useDatos(()=>leerPermisosComando(assignmentId,offset,history),[assignmentId,offset,history])
 useEffect(()=>{setEditing(null);setOffset(0);setError('');setMessage('')},[assignmentId])
 const save=async body=>{setBusy(true);setError('');setMessage('');try{await guardarPermisoComando(assignmentId,body,crypto.randomUUID());setEditing(null);setMessage('Revisión guardada y consultada aparte. El permiso conserva todos los requisitos del equipo y de la acción.');grants.recargar();onChanged?.()}catch(e){setError(`${e.message} Consulta los permisos antes de repetir.`)}finally{setBusy(false)}}
 return<section className="cf-editor" aria-label="Permisos de comandos"><h3>Permisos por usuario</h3><p>Cada permiso autoriza una acción e instancia en esta instalación, con vencimiento. Requiere además cualificación técnica, segundo factor y confirmación por solicitud.</p>
  {error&&<p role="alert" className="cf-error">{error}</p>}{message&&<p role="status">{message}</p>}
  {grants.error?<ErrorCarga error={grants.error} onReintentar={grants.recargar}/>:<>
   <label><input type="checkbox" checked={history} onChange={e=>{setHistory(e.target.checked);setOffset(0);setEditing(null)}}/>Mostrar revisiones conservadas</label>
   {grants.datos?.items.map(r=><section key={`${r.userId}:${r.commandKey}:${r.instance}:${r.version}`}><p>{r.userName} · {actions.find(a=>a.key===r.commandKey)?.name||r.commandKey} · Canal {r.instance} · Versión {r.version}</p><p>{history?(r.selected?'Permiso seleccionado en esta revisión':'Permiso retirado en esta revisión'):r.effective?'Permiso vigente':r.selected?'Permiso vencido':'Permiso retirado'} · {r.expiresAt||'Sin vigencia'} · {r.reason}</p>
    {!history&&grants.datos.canManage&&<button className="pnl-btn" disabled={busy} onClick={()=>setEditing(r)}>Cambiar o retirar permiso</button>}
   </section>)}
   {!grants.datos?.items.length&&<p>No hay permisos registrados en esta página.</p>}
   <button className="pnl-btn" disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Permisos anteriores</button><button className="pnl-btn" disabled={busy||!grants.datos||offset+50>=grants.datos.page.total} onClick={()=>setOffset(offset+50)}>Permisos siguientes</button>
   {grants.datos?.canManage&&<><button className="pnl-btn" disabled={busy} onClick={()=>setEditing({version:0,selected:true})}>Conceder permiso específico</button>
    {editing&&<Editor key={`${editing.userId||'new'}:${editing.commandKey}:${editing.instance}:${editing.version}`} assignmentId={assignmentId} initial={editing} actions={actions} busy={busy} save={save} cancel={()=>setEditing(null)}/>}</>}
  </>}
  <button className="pnl-btn" disabled={busy} onClick={grants.recargar}>Consultar permisos</button>
 </section>
}
function Editor({assignmentId,initial,actions,busy,save,cancel}){
 const [offset,setOffset]=useState(0),[user,setUser]=useState(initial.userId||''),[action,setAction]=useState(initial.commandKey||''),[instance,setInstance]=useState(initial.instance||1),[selected,setSelected]=useState(initial.selected),[minutes,setMinutes]=useState(60),[reason,setReason]=useState('')
 const recipients=useDatos(()=>leerDestinatariosComando(assignmentId,offset),[assignmentId,offset])
 const unique=actions.filter((a,i,list)=>list.findIndex(b=>b.key===a.key)===i)
 const submit=e=>{e.preventDefault();save({userId:user,commandKey:action,instance:Number(instance),selected,expiresAt:selected?new Date(Date.now()+Number(minutes)*60000).toISOString():null,expectedVersion:initial.version,reason:reason.trim()})}
 return<form onSubmit={submit}><fieldset disabled={busy}>
  {initial.version?<p>Usuario: {initial.userName} · {initial.commandKey} · Canal {initial.instance}</p>:<>
   {recipients.error?<ErrorCarga error={recipients.error} onReintentar={recipients.recargar}/>:<label>Gestor destinatario<select required value={user} onChange={e=>setUser(e.target.value)}><option value="">Selecciona un gestor activo</option>{recipients.datos?.items.map(u=><option key={u.userId} value={u.userId}>{u.userName} · {u.role}</option>)}</select></label>}
   <button className="pnl-btn" type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Destinatarios anteriores</button><button className="pnl-btn" type="button" disabled={!recipients.datos||offset+50>=recipients.datos.page.total} onClick={()=>setOffset(offset+50)}>Destinatarios siguientes</button>
   <label>Acción<select required value={action} onChange={e=>setAction(e.target.value)}><option value="">Selecciona una acción</option>{unique.map(a=><option key={a.key} value={a.key}>{a.name}</option>)}</select></label><label>Canal o instancia<input type="number" required min={1} max={32} value={instance} onChange={e=>setInstance(e.target.value)}/></label>
  </>}
  <label><input type="checkbox" checked={selected} onChange={e=>setSelected(e.target.checked)}/>Permiso seleccionado</label>
  {selected&&<label>Vigencia desde ahora, en minutos<input type="number" required min={1} max={43200} value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>}
  <label>Motivo de esta revisión<input required minLength={5} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label>
  <button className="pnl-btn" type="submit">Guardar revisión y comprobar</button><button className="pnl-btn" type="button" onClick={cancel}>Cancelar edición</button>
 </fieldset></form>
}
