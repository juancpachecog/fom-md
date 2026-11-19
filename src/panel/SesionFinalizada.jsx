import { useState } from 'react'
import { Link } from 'react-router-dom'
import LogoFom from '../components/LogoFom'
import { reintentarSalida } from './auth'
import './sesion-finalizada.css'

export default function SesionFinalizada({ estado, comprobando = false }) {
  const [ocupado, setOcupado] = useState(false)
  const pendiente = estado?.pendiente
  const titulo = comprobando ? 'Comprobando la conexión' : estado?.motivo === 'inactividad'
    ? 'Tu sesión terminó por inactividad' : estado?.motivo === 'conexion'
      ? 'Se perdió la conexión' : 'Tu sesión finalizó'
  async function comprobarSalida() {
    if (ocupado) return
    setOcupado(true)
    try { await reintentarSalida() } finally { setOcupado(false) }
  }
  return <main className="pnl sesion-finalizada" data-tema="oscuro">
    <section className="sesion-finalizada-caja" aria-live="polite">
      <LogoFom />
      <h1>{titulo}</h1>
      {comprobando ? <p>Estamos verificando si puedes continuar. La información de la operación está oculta.</p> : <>
        <p>{estado?.motivo === 'inactividad' ? 'Pasaron 15 minutos sin actividad. Vuelve a iniciar sesión para continuar.' : 'La información de la operación está protegida. Vuelve a iniciar sesión para continuar.'}</p>
        {pendiente ? <><p role="status">Falta confirmar la salida en el servidor. Cuando vuelva la conexión, comprobaremos el cierre antes de permitir otro acceso.</p><button className="pnl-btn primario" disabled={ocupado} onClick={comprobarSalida}>{ocupado ? 'Comprobando…' : 'Reintentar salida'}</button></>
          : <Link className="pnl-btn primario" to="/entrar" replace>Volver a iniciar sesión</Link>}
      </>}
    </section>
  </main>
}
