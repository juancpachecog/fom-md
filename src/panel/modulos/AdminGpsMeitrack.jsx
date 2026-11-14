import { puertoDelEquipo } from '../datos/gpsMeitrack'
import { useState } from 'react'
import { IntervaloGps } from '../comp/IntervaloGps'
import { readIdentitySms, readCommandsSms } from '../meitrack/guided-sms'

// El alta conserva el asistente vigente de AdminGpsNuevo. Un equipo ya registrado
// se diagnostica sin volver a proponer la configuración inicial por SMS.
export function ComandosMeitrackFicha({ equipo }) {
  const [clave, setClave] = useState(''), [e91, setE91] = useState(''), [e04, setE04] = useState('')
  const identidad = readIdentitySms(e91, equipo.imei)
  const comandos = identidad?.supported ? readCommandsSms(e04, identidad.imei) : null
  return <><section className="gp-card" style={{ padding: 22 }}>
    <h2 className="gp-st">Recepción Meitrack</h2>
    <p>Comprueba aquí los mensajes del equipo ya registrado. Si está reportando, no hace falta repetir los SMS de configuración.</p>
    <p>TCP · puerto {puertoDelEquipo(equipo)}. Conserva la respuesta DB4 original para comprobar la hora de sus posiciones.</p>
    <span className="gp-hint">La señal recibida acredita recepción del equipo. La hora, posición y funciones del vehículo requieren su propia comprobación.</span>
    <details><summary>Cambiar frecuencia de reportes</summary>
      <p>Consulta E91 y E04 por SMS con tu clave del equipo. Pega las respuestas para comprobar la compatibilidad; permanecen solo en memoria.</p>
      <label className="gp-f">Clave SMS<input className="pnl-input" type="password" autoComplete="new-password" value={clave} onChange={e => setClave(e.target.value)} /></label>
      <code>••••,E91</code><label className="gp-f">Respuesta E91<textarea className="pnl-input" autoComplete="off" maxLength={2048} value={e91} onChange={e => setE91(e.target.value)} /></label>
      <code>••••,E04</code><label className="gp-f">Respuesta E04<textarea className="pnl-input" autoComplete="off" maxLength={2048} value={e04} onChange={e => setE04(e.target.value)} /></label>
      <IntervaloGps modelo="T399L" clave={clave} compatible={identidad?.supported && comandos?.includes('A12')} />
    </details>
  </section></>
}
