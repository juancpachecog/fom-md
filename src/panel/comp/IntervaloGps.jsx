import { useState } from 'react'
import { INTERVALO_GPS_PREDETERMINADO, INTERVALOS_GPS, comandoIntervalo, esModeloCobanAscii } from '../datos/intervaloGps'
import { useConfirmar } from './Confirmar'

export function IntervaloGps({ modelo, clave, compatible: comprobado, integrado = false }) {
  const [segundos, setSegundos] = useState(INTERVALO_GPS_PREDETERMINADO)
  const [acepta, setAcepta] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const { confirmar, dialogo } = useConfirmar()
  const coban = esModeloCobanAscii(modelo)
  const comando = comandoIntervalo({ modelo, clave, segundos, compatible: coban ? acepta : comprobado })
  async function copiar() {
    if (!comando || !await confirmar({ titulo: 'Preparar cambio de frecuencia', texto: `Preparar el SMS para reportar cada ${segundos} segundos${coban ? ', en movimiento y detenido, sin modo de sueño' : ''}. Debes enviarlo desde tu teléfono y comprobar después la recepción.`, accion: 'Copiar SMS' })) return
    try { await navigator.clipboard.writeText(comando); setMensaje('SMS copiado. FOM no lo ha enviado ni ha comprobado el cambio en el equipo.') }
    catch { setMensaje('No se pudo copiar. No se ha enviado ningún SMS.') }
  }
  const vista = comandoIntervalo({ modelo, clave, segundos, compatible: true })
  if (integrado) return <div className="gp-cmd gp-intervalo" aria-label="Intervalo de reportes">
    <span className="n">06</span>
    <div className="tx">
      <div className="gp-intervalo-titulo"><b>Configurar frecuencia de reportes</b><label className="gp-intervalo-select"><span className="gp-sr">Intervalo de posiciones</span><select value={segundos} onChange={e => { setSegundos(Number(e.target.value)); setMensaje('') }}>{INTERVALOS_GPS.map(s => <option key={s} value={s}>{s} segundos{s === 30 ? ' · predeterminado' : ''}</option>)}</select></label></div>
      <code>{vista ? vista.replace(clave, '••••') : 'Escribe la clave SMS para preparar el comando.'}</code>
      <span className="gp-hint">Envía este SMS en la misma secuencia. Comprueba después los reportes recibidos.</span>
      {coban ? <label className="gp-intervalo-consent"><input type="checkbox" checked={acepta} onChange={e => { setAcepta(e.target.checked); setMensaje('') }} /> Confirmé que mi variante COBAN admite Sleep para reportar en movimiento y detenido.</label> : !comprobado && <span className="gp-hint">Requiere firmware compatible y A12 en la respuesta E04.</span>}
      {mensaje && <span className="gp-hint" role="status">{mensaje}</span>}
    </div>
    <button type="button" className="gp-btn2" disabled={!comando} onClick={copiar}>Copiar</button>{dialogo}
  </div>
  return <section className="gp-card" style={{ padding: 22 }} aria-label="Frecuencia de reportes">
    <h2 className="gp-st">Frecuencia de reportes</h2>
    <label className="gp-f">Intervalo de posiciones<select className="pnl-select" value={segundos} onChange={e => { setSegundos(Number(e.target.value)); setMensaje('') }}>{INTERVALOS_GPS.map(s => <option key={s} value={s}>{s} segundos{s === 30 ? ' (predeterminado)' : ''}</option>)}</select></label>
    {coban ? <label className="gp-f"><span><input type="checkbox" checked={acepta} onChange={e => { setAcepta(e.target.checked); setMensaje('') }} /> Confirmé que mi variante COBAN admite la estrategia Sleep para reportar en movimiento y detenido. Comprueba el resultado en Trama.</span></label> : <p className="gp-hint">Requiere T399L-V254 identificado y A12 anunciado en E04. Los modos de reposo pueden modificar los reportes estando detenido.</p>}
    <code>{comando ? comando.replace(clave, '••••') : 'Comprueba compatibilidad y escribe la clave SMS para preparar el comando.'}</code>
    <button type="button" className="gp-btn2" disabled={!comando} onClick={copiar}>Copiar cambio de intervalo</button>
    <p className="gp-hint">30 s es el valor propuesto. Copiar no modifica el GPS. El latido de conexión es independiente; comprueba posiciones nuevas después de enviar el SMS.</p>
    {mensaje && <p role="status">{mensaje}</p>}{dialogo}
  </section>
}
