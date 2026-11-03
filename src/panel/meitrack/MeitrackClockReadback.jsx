import {useEffect,useRef,useState} from 'react'
import {clockReadbackReceipt} from './clock-readback.js'
export function MeitrackClockReadback({imei,firmware,readback}) {
  const [raw,setRaw]=useState(''),[observedAt,setObservedAt]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const source=readback??raw,active=useRef(true),revision=useRef(0)
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
  useEffect(()=>{revision.current++;setObservedAt('');setMessage('')},[readback,imei,firmware])
  async function save(){
    const version=revision.current;setBusy(true);setMessage('')
    try{
      const receipt=await clockReadbackReceipt(source,imei,firmware,observedAt)
      if(!active.current||version!==revision.current)return
      if(!receipt){setMessage('La lectura debe ser DB4 TCP del mismo equipo, con zona GPRS 0 y fecha real de recepción. Otra zona requiere revisión; no cambies parámetros a ciegas.');return}
      const url=URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'}))
      const a=document.createElement('a');a.href=url;a.download='fom-meitrack-comprobante-hora.json';a.click();URL.revokeObjectURL(url)
      setMessage('Comprobante preparado para revisión técnica. Contiene huellas y metadatos; no guarda el SMS, la contraseña, el APN ni el IMEI. Todavía no acredita ubicación publicada.')
    }catch{if(active.current)setMessage('No se pudo preparar el comprobante. Conserva la respuesta original; no se ha enviado ni guardado una prueba en FOM.')}
    finally{if(active.current)setBusy(false)}
  }
  return <section className="gp-card" style={{padding:22,display:'flex',flexDirection:'column',gap:12}} aria-label="Validación de hora Meitrack">
    <h2 className="gp-st">Comprobar la hora de las posiciones</h2>
    <p>Utiliza la respuesta DB4 que ya recibiste al configurar este equipo. La revisión técnica la contrasta con las tramas reales y comprueba después la ubicación publicada.</p>
    {readback!==undefined?<p>Se utiliza la respuesta DB4 comprobada en el paso anterior; no necesitas pegarla otra vez.</p>:<label className="gp-f"><span>Respuesta DB4 del equipo</span><div className="gp-field"><textarea value={raw} disabled={busy} onChange={e=>{setRaw(e.target.value);setMessage('')}} maxLength={1024} autoComplete="off" spellCheck={false}/></div></label>}
    <label className="gp-f"><span>Fecha y hora en que recibiste esa respuesta</span><div className="gp-field"><input type="datetime-local" value={observedAt} disabled={busy} onInput={e=>{setObservedAt(e.currentTarget.value);setMessage('')}} onChange={e=>{setObservedAt(e.target.value);setMessage('')}}/></div></label>
    <span className="gp-hint">Zona de esta fecha: {Intl.DateTimeFormat().resolvedOptions().timeZone}. {observedAt&&Number.isFinite(new Date(observedAt).getTime())?`Equivalente UTC: ${new Date(observedAt).toISOString()}`:''}</span>
    <span className="gp-hint">Usa la fecha del SMS; no la fecha actual si es una lectura anterior. La respuesta completa permanece sólo en memoria de esta pantalla.</span>
    <button type="button" className="gp-btn2" disabled={!source||!observedAt||busy} onClick={()=>void save()}>{busy?'Preparando…':'Guardar comprobante para revisión'}</button>
    <button type="button" className="gp-btn3" disabled={busy} onClick={()=>{setRaw('');setObservedAt('');setMessage(readback!==undefined?'Fecha descartada. La lectura DB4 se conserva en el paso anterior.':'Lectura descartada de esta pantalla. El archivo descargado se conserva en tu dispositivo.')}}>Descartar lectura</button>
    {message&&<p role="status">{message}</p>}
  </section>
}
