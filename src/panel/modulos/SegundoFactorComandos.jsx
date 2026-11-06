import {useEffect,useRef,useState} from 'react'
import {useDatos} from '../useDatos'
import {Cargando,ErrorCarga} from '../comp/ui'
import {estadoSegundoFactor,iniciarSegundoFactor,activarSegundoFactor,verificarSegundoFactor,revocarSegundoFactor} from '../datos/segundoFactorComandos'
export default function SegundoFactorComandos({onChanged}){
 const data=useDatos(estadoSegundoFactor,[],30000)
 const [password,setPassword]=useState(''),[code,setCode]=useState(''),[enrollment,setEnrollment]=useState(null),[revoking,setRevoking]=useState(false)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),lock=useRef(false)
 useEffect(()=>{
  const state=data.datos
  if(enrollment&&state&&(state.state==='active'||state.state==='expired'&&state.credentialId===enrollment.credentialId||state.credentialId&&state.credentialId!==enrollment.credentialId)){setEnrollment(null);setCode('')}
 },[data.datos,enrollment])
 const perform=async(action)=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('')
  try{await action();await data.recargar();await onChanged()}
  catch(e){setError(`${e.message}${e.estado>=400&&e.estado<500?'':' Consulta el estado antes de repetir una operación con resultado desconocido.'}`);await data.recargar()}
  finally{setPassword('');setCode('');lock.current=false;setBusy(false)}
 }
 const begin=e=>{e.preventDefault();const value=password;setPassword('');perform(async()=>{setEnrollment(await iniciarSegundoFactor(value));setMessage('Inscripción iniciada. Confirma el código de tu aplicación autenticadora.')})}
 const activate=e=>{e.preventDefault();const value=code;setCode('');perform(async()=>{await activarSegundoFactor(enrollment.credentialId,value);setEnrollment(null);setMessage('Segundo factor activado y prueba de sesión consultada aparte.')})}
 const verify=e=>{e.preventDefault();const value=code;setCode('');perform(async()=>{await verificarSegundoFactor(value);setMessage('Prueba de sesión consultada aparte. Los demás requisitos del comando siguen aplicando.')})}
 const revoke=e=>{e.preventDefault();const p=password,c=code;setPassword('');setCode('');perform(async()=>{await revocarSegundoFactor(data.datos.credentialId,p,c);setRevoking(false);setEnrollment(null);setMessage('Segundo factor revocado y estado consultado aparte.')})}
 const passwordField=<label>Contraseña vigente<input type="password" required autoComplete="current-password" maxLength={256} value={password} onChange={e=>setPassword(e.target.value)}/></label>
 const codeField=<label>Código del autenticador<input type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" minLength={6} maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/></label>
 if(data.estado==='cargando'&&!data.datos)return<Cargando filas={2}/>
 if(data.error)return<ErrorCarga error={data.error} onReintentar={data.recargar}/>
 const state=data.datos
 return<section className="cf-editor" aria-label="Segundo factor para comandos"><h3>Segundo factor de tu cuenta</h3>
  <p>La prueba de identidad dura cinco minutos y pertenece a esta sesión. Cada comando requiere además permiso, confirmación y una instalación habilitada.</p>
  {error&&<p role="alert" className="cf-error">{error}</p>}{message&&<p role="status">{message}</p>}
  {!state?.configured?<p>El segundo factor requiere configuración en este ambiente.</p>:state.state==='active'?<>
   <p>{state.proofExpiresAt?`Prueba de sesión vigente hasta ${state.proofExpiresAt}`:'Segundo factor inscrito. Falta una prueba reciente en esta sesión.'}</p>
   {!revoking?<><form onSubmit={verify}><fieldset disabled={busy}>{codeField}<button className="pnl-btn" type="submit">Verificar segundo factor y comprobar</button></fieldset></form>
    <button className="pnl-btn" disabled={busy} onClick={()=>{setRevoking(true);setCode('');setError('')}}>Retirar segundo factor de mi cuenta</button></>:<form onSubmit={revoke}><fieldset disabled={busy}><p>Retirar el factor invalida sus pruebas de sesión y requiere volver a inscribirse para autorizar comandos.</p>{passwordField}{codeField}<button className="pnl-btn" type="submit">Confirmar retirada del segundo factor</button><button className="pnl-btn" type="button" onClick={()=>{setRevoking(false);setCode('');setPassword('')}}>Cancelar retirada</button></fieldset></form>}
  </>:enrollment?<form onSubmit={activate}><fieldset disabled={busy}><p>Clave para añadir manualmente en tu aplicación autenticadora:</p><code aria-label="Clave de inscripción del autenticador">{enrollment.secret}</code><p>Código de seis dígitos, actualizado cada treinta segundos. Confirma antes de {enrollment.expiresAt}.</p>{codeField}
   <button className="pnl-btn" type="submit">Confirmar inscripción y comprobar</button><button className="pnl-btn" type="button" onClick={()=>{setEnrollment(null);setCode('')}}>Ocultar clave de inscripción</button></fieldset></form>:<form onSubmit={begin}><fieldset disabled={busy}>
   <p>{state.state==='pending'?'Hay una inscripción pendiente. Reautentícate en esta sesión para continuar.':state.state==='expired'?'La inscripción anterior venció. Puedes iniciar una nueva.':'Inscribe tu aplicación autenticadora para verificar el segundo factor.'}</p>{passwordField}<button className="pnl-btn" type="submit">{state.state==='pending'?'Continuar inscripción':'Iniciar inscripción del segundo factor'}</button>
  </fieldset></form>}
  <button className="pnl-btn" disabled={busy} onClick={data.recargar}>Consultar estado del segundo factor</button>
 </section>
}
