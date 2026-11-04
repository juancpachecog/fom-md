import { puertoDelEquipo } from '../datos/gpsMeitrack'

// El alta conserva el asistente vigente de AdminGpsNuevo. Un equipo ya registrado
// se diagnostica sin volver a proponer la configuración inicial por SMS.
export function ComandosMeitrackFicha({ equipo }) {
  return <section className="gp-card" style={{ padding: 22 }} role="status">
    <h2 className="gp-st">Recepción Meitrack</h2>
    <p>Comprueba aquí los mensajes del equipo ya registrado. Si está reportando, no hace falta repetir los SMS de configuración.</p>
    <p>TCP · puerto {puertoDelEquipo(equipo)}. Conserva la respuesta DB4 original para comprobar la hora de sus posiciones.</p>
    <span className="gp-hint">La señal recibida acredita recepción del equipo. La hora, posición y funciones del vehículo requieren su propia comprobación.</span>
  </section>
}
