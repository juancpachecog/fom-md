import {useState} from 'react'
import {clockReadbackReceipt} from './clock-readback.js'
export function MeitrackClockReadback({imei,firmware}) {
  const [raw,setRaw]=useState(''),[observedAt,setObservedAt]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  async function save(){
    setBusy(true);setMessage('')
    try{
      const receipt=await clockReadbackReceipt(raw,imei,firmware,observedAt)
      if(!receipt){setMessage('La lectura debe ser DB4 TCP del mismo equipo, con zona GPRS 0 y fecha real de recepción. Otra zona requiere revisión; no cambies parámetros a ciegas.');return}
      const url=URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'}))
      const a=document.createElement('a');a.href=url;a.download='fom-meitrack-comprobante-hora.json';a.click();URL.revokeObjectURL(url)
      setMessage('Comprobante preparado para revisión técnica. Contiene huellas y metadatos; no guarda el SMS, la contraseña, el APN ni el IMEI. Todavía no acredita ubicación publicada.')
    }catch{setMessage('No se pudo preparar el comprobante. Conserva la respuesta original; no se ha enviado ni guardado una prueba en FOM.')}
    finally{setBusy(false)}
  }
  return <section className="gp-card" style={{padding:22,display:'flex',flexDirection:'column',gap:12}} aria-label="Validación de hora Meitrack">
    <h2 className="gp-st">Comprobar la hora de las posiciones</h2>
    <p>Utiliza la respuesta DB4 que ya recibiste al configurar este equipo. La revisión técnica la contrasta con las tramas reales y comprueba después la ubicación publicada.</p>
    <label className="gp-f"><span>Respuesta DB4 del equipo</span><div className="gp-field"><textarea value={raw} onChange={e=>{setRaw(e.target.value);setMessage('')}} maxLength={1024} autoComplete="off" spellCheck={false}/></div></label>
    <label className="gp-f"><span>Fecha y hora en que recibiste esa respuesta</span><div className="gp-field"><input type="datetime-local" value={observedAt} onInput={e=>{setObservedAt(e.currentTarget.value);setMessage('')}} onChange={e=>{setObservedAt(e.target.value);setMessage('')}}/></div></label>
    <span className="gp-hint">Zona de esta fecha: {Intl.DateTimeFormat().resolvedOptions().timeZone}. {observedAt&&Number.isFinite(new Date(observedAt).getTime())?`Equivalente UTC: ${new Date(observedAt).toISOString()}`:''}</span>
    <span className="gp-hint">Usa la fecha del SMS; no la fecha actual si es una lectura anterior. La respuesta completa permanece sólo en memoria de esta pantalla.</span>
    <button type="button" className="gp-btn2" disabled={!raw||!observedAt||busy} onClick={()=>void save()}>{busy?'Preparando…':'Guardar comprobante para revisión'}</button>
    <button type="button" className="gp-btn3" onClick={()=>{setRaw('');setObservedAt('');setMessage('Lectura descartada de esta pantalla. El archivo descargado se conserva en tu dispositivo.')}}>Descartar lectura</button>
    {message&&<p role="status">{message}</p>}
  </section>
}
