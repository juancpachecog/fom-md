import { useEffect, useState } from 'react'
import { pedir } from '../datos/api'
import { t399ReadOnlyQuery } from './commands.js'
import { readIdentitySms, readCommandsSms, readPendingSms, readConnectionOk } from './guided-sms.js'
import { receiverAvailable, connectionSms, connectionReadback } from './operational-setup.js'
import { parseSetupCapture } from './meitrack-setup.js'
import { MeitrackClockReadback } from './MeitrackClockReadback.jsx'

const request = (path, body, signal) => pedir(`/api/v1/console/meitrack-setup/${path}`, { metodo:'POST', cuerpo:body, señal:signal, empresaContexto:null })
export function MeitrackInstallationSetup({ password, apn, knownImei='', onIdentityChange, onCapture, onLockChange, onSelect, selected=false, canRegister=false, onRegister, registered=false, registering=false, registrationError='', soloPrueba=false }) {
  const [identityText,setIdentityText]=useState(''), [commandsText,setCommandsText]=useState(''), [pendingText,setPendingText]=useState('')
  const [okText,setOkText]=useState(''), [readback,setReadback]=useState(''), [sent,setSent]=useState(false), [noAuth,setNoAuth]=useState(false)
  const [availability,setAvailability]=useState(null), [capture,setCapture]=useState(null), [search,setSearch]=useState(0), [looking,setLooking]=useState(false)
  const [message,setMessage]=useState('')
  const identity=readIdentitySms(identityText,knownImei), imei=identity?.supported ? identity.imei : '', firmware=identity?.firmware
  const announced=readCommandsSms(commandsText,imei), pending=readPendingSms(pendingText,imei)
  const acknowledged=readConnectionOk(okText,imei), configured=connectionReadback(readback,imei,firmware,apn)
  const receiver=availability && performance.now()-availability.at<10000 ? availability.receiver : null
  const command=connectionSms(password,apn,receiver,!!announced,pending,noAuth)
  const [clock,setClock]=useState(0)
  useEffect(()=>{const timer=setInterval(()=>setClock(performance.now()),1000);return()=>clearInterval(timer)},[])
  useEffect(()=>{ if(identity?.supported) onIdentityChange(identity) },[imei,firmware])
  useEffect(()=>{onLockChange?.(sent || registered)},[sent,registered,onLockChange])
  const eligible=!!receiver && configured && capture?.received === true && capture.reference === receiver.reference
  useEffect(()=>{onCapture(eligible)},[eligible,onCapture,clock])
  useEffect(()=>{
    if (!imei || !identity?.supported) return
    let stopped=false,timer,active
    async function update(){
      const controller=new AbortController();active=controller
      const timeout=setTimeout(()=>controller.abort(),5000)
      try {
        const r=receiverAvailable(await request('availability',{imei,firmware},controller.signal))
        if(stopped)return
        setAvailability(r ? {receiver:r,at:performance.now()} : null)
        if(configured && search && r){
          setLooking(true)
          const found=parseSetupCapture(await request('discovery',{imei,firmware},controller.signal),r.reference)
          if(!stopped)setCapture(found)
        } else setCapture(null)
      }catch{if(!stopped){setAvailability(null);setCapture(null)}}
      finally{clearTimeout(timeout);if(!stopped){setLooking(false);timer=setTimeout(update,5000)}}
    }
    void update()
    return()=>{stopped=true;active?.abort();clearTimeout(timer)}
  },[imei,firmware,configured,search])
  async function copy(text){
    if(!text)return
    try{await navigator.clipboard.writeText(text);setMessage('SMS copiado. Envíalo desde tu teléfono; FOM no lo ha enviado.')}
    catch{setMessage('No se pudo copiar. No se ha enviado ningún SMS.')}
  }
  function card(n,title,sms,hint,field){return <div className="gp-cmd"><span className="n">{n}</span><div className="tx"><b>{title}</b><code>{sms ? sms.replace(password,'••••') : n === '04' && configured ? 'La configuración para FOM ya está comprobada. No hace falta repetir A21.' : n === '04' && sent ? 'Configuración marcada como enviada. No repetir.' : 'Completa la comprobación anterior.'}</code><span className="gp-hint">{hint}</span>{field}</div><button type="button" className="gp-btn2" disabled={!sms} onClick={()=>void copy(sms)}>Copiar</button></div>}
  function response(label,value,setValue,disabled=false){return <label className="gp-f"><span>{label}</span><div className="gp-field"><textarea value={value} maxLength={2048} autoComplete="off" spellCheck={false} disabled={disabled} onChange={e=>setValue(e.target.value)} /></div></label>}
  return <>
    <section className="gp-card gp-meitrack-sms" style={{display:'flex',flexDirection:'column',gap:12,padding:'22px 24px'}} aria-label="Comandos SMS Meitrack">
      <div className="gp-titulo"><p className="gp-k">Paso 3 de 3 · Comandos SMS</p><h2 className="gp-st">Configura el equipo</h2><span className="gp-lbl">Envía los mensajes en orden a la línea del GPS y pega cada respuesta. No se registra ningún equipo al copiar o avanzar.</span></div>
      {card('01','Identificar el GPS',t399ReadOnlyQuery(password,'E91'),'Lee IMEI y versión; no necesitas conocerlos de antemano.',response('Respuesta E91',identityText,setIdentityText,sent))}
      {identity && <p role="status">IMEI: {identity.imei} · Versión: {identity.firmware}</p>}
      {identityText && !identity && <p role="alert">La respuesta no es válida o no coincide con el IMEI conocido.</p>}
      {identity && !identity.supported && <p role="alert">Esta versión requiere comprobar compatibilidad antes de configurar.</p>}
      {card('02','Comprobar compatibilidad',imei ? t399ReadOnlyQuery(password,'E04') : null,'Pega la respuesta o la lista de comandos que ya conservas.',response('Respuesta E04',commandsText,setCommandsText,sent))}
      {commandsText && !announced && <p role="alert">Debe anunciar A21, DB4 y DA6 del mismo equipo.</p>}
      {card('03','Consultar conexión y pendientes',announced ? t399ReadOnlyQuery(password,'DA6',announced) : null,'Consulta el estado; no guarda una configuración anterior ni borra datos.',response('Respuesta DA6',pendingText,setPendingText,sent))}
      {pending && <p role="status">Pendientes GPRS: {pending.gprs} · SMS: {pending.sms}. {pending.gprs || pending.sms ? 'No cambies el destino mientras haya mensajes pendientes; no borres la memoria.' : 'Sin pendientes visibles en estos contadores.'}</p>}
      <label className="gp-f"><span><input type="checkbox" checked={noAuth} disabled={sent} onChange={e=>setNoAuth(e.target.checked)} /> Mi APN no utiliza usuario ni contraseña.</span></label>
      {card('04','Configurar APN y servidor FOM',sent || registered || configured ? null : command,'Este SMS configura APN, servidor y puerto juntos. Envíalo una sola vez; ante silencio o error, conserva la respuesta.',<>
        <button type="button" className="gp-btn2" disabled={!command || sent || registered} onClick={()=>setSent(true)}>Ya envié la configuración</button>
        {response('Respuesta A21',okText,text=>{setOkText(text);if(readConnectionOk(text,imei))setSent(true)})}
      </>)}
      {imei && !receiver && <p role="status">El servicio de recepción no está disponible ahora. El mensaje de configuración permanece bloqueado; puedes seguir consultando la identidad.</p>}
      {okText && !acknowledged && <p role="alert">No se reconoció A21 OK del mismo equipo. No repitas el SMS automáticamente.</p>}
      {card('05','Comprobar configuración',announced && pending ? t399ReadOnlyQuery(password,'DB4',announced) : null,'Comprueba que el GPS guardó TCP, APN, servidor y puerto correctos. Si ya estaba configurado para FOM, consulta DB4 sin reenviar A21. El OK no prueba recepción.',response('Respuesta DB4',readback,setReadback))}
      {readback && !configured && <p role="alert">La lectura no confirma el destino FOM y APN esperados. No repitas A21 sin revisar la respuesta.</p>}
      {message && <p role="status">{message}</p>}
      <span className="gp-hint">La clave y las respuestas completas permanecen sólo en memoria. Descartar no deshace los SMS enviados. No se activa ni se instala el GPS al registrarlo.</span>
    </section>
    {configured&&<MeitrackClockReadback key={imei+firmware} imei={imei} firmware={firmware} readback={readback}/>}
    <section className="gp-card gp-col" aria-label="Detectados sin registrar Meitrack">
      <h2 className="gp-st">Detectados sin registrar · confirmar al final</h2>
      <p>{soloPrueba ? 'Comprueba la configuración y busca la recepción coincidente sin registrar el equipo.' : 'Después de configurar, busca si el GPS ya está reportando. Compara su IMEI y selecciona la señal coincidente para registrarlo.'}</p>
      <button type="button" className="gp-btn2" disabled={!configured || looking || registered} onClick={()=>setSearch(n=>n+1)}>{looking ? 'Buscando…' : search ? 'Actualizar lista' : 'Buscar GPS reportando'}</button>
      {!configured && <p>Primero comprueba la configuración con DB4.</p>}
      {search > 0 && !eligible && <p role="status">{receiver ? 'Todavía no hay recepción reciente comprobada de este GPS. La búsqueda se actualiza automáticamente.' : 'El servicio no está disponible. Conserva la pantalla y vuelve a consultar.'}</p>}
      {eligible && !registered && <div className="gp-cmd"><div className="tx"><b>Detectado: {imei}</b><span className="gp-hint">Meitrack T399L · TCP · recepción reciente coincidente</span></div><button type="button" className="gp-btn2" onClick={onSelect}>{selected ? 'Coincidencia seleccionada' : 'Seleccionar este dispositivo'}</button></div>}
      {registrationError && <p role="alert">{registrationError}</p>}
      {!soloPrueba && (registered ? <p role="status">Registro comprobado en inventario. La instalación y activación son pasos separados.</p> : <button type="button" className="gp-btn" disabled={!eligible || !selected || !canRegister || registering} onClick={onRegister}>{registering ? 'Comprobando registro…' : 'Registrar sin activar'}</button>)}
    </section>
  </>
}
