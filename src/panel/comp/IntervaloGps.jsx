import { useState } from 'react'
import { INTERVALO_GPS_PREDETERMINADO, INTERVALOS_GPS, comandoIntervalo } from '../datos/intervaloGps'
import { useConfirmar } from './Confirmar'

export function IntervaloGps({ modelo, clave, compatible: comprobado }) {
  const [segundos, setSegundos] = useState(INTERVALO_GPS_PREDETERMINADO)
  const [acepta, setAcepta] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const { confirmar, dialogo } = useConfirmar()
  const coban = modelo === 'GPS-403'
  const comando = comandoIntervalo({ modelo, clave, segundos, compatible: coban ? acepta : comprobado })
  async function copiar() {
    if (!comando || !await confirmar({ titulo: 'Preparar cambio de frecuencia', texto: `Preparar el SMS para reportar cada ${segundos} segundos${coban ? ', en movimiento y detenido, sin modo de sueño' : ''}. Debes enviarlo desde tu teléfono y comprobar después la recepción.`, accion: 'Copiar SMS' })) return
    try { await navigator.clipboard.writeText(comando); setMensaje('SMS copiado. FOM no lo ha enviado ni ha comprobado el cambio en el equipo.') }
    catch { setMensaje('No se pudo copiar. No se ha enviado ningún SMS.') }
  }
  return <section className="gp-card" style={{ padding: 22 }} aria-label="Frecuencia de reportes">
    <h2 className="gp-st">Frecuencia de reportes</h2>
    <label className="gp-f">Intervalo de posiciones<select className="pnl-select" value={segundos} onChange={e => { setSegundos(Number(e.target.value)); setMensaje('') }}>{INTERVALOS_GPS.map(s => <option key={s} value={s}>{s} segundos{s === 30 ? ' (predeterminado)' : ''}</option>)}</select></label>
    {coban ? <label className="gp-f"><span><input type="checkbox" checked={acepta} onChange={e => { setAcepta(e.target.checked); setMensaje('') }} /> Confirmé compatibilidad con la estrategia Sleep del GPS-403. Reportará en movimiento y detenido, sin modo de sueño.</span></label> : <p className="gp-hint">Requiere T399L-V254 identificado y A12 anunciado en E04. Los modos de reposo pueden modificar los reportes estando detenido.</p>}
    <code>{comando ? comando.replace(clave, '••••') : 'Comprueba compatibilidad y escribe la clave SMS para preparar el comando.'}</code>
    <button type="button" className="gp-btn2" disabled={!comando} onClick={copiar}>Copiar cambio de intervalo</button>
    <p className="gp-hint">30 s es el valor propuesto. Copiar no modifica el GPS. El latido de conexión es independiente; comprueba posiciones nuevas después de enviar el SMS.</p>
    {mensaje && <p role="status">{mensaje}</p>}{dialogo}
  </section>
}
