import { useEffect, useState } from 'react'
import { MIN_CLAVE, REGLAS_CLAVE, validarClave } from '../lib/clave'
import { Navigate, useNavigate } from 'react-router-dom'
import { completarCambioInicial } from '../panel/auth'
import { useSesion } from '../panel/useSesion'
import { SiteBrand } from '../components/SiteChrome'
import { PreviewMap } from '../components/ProductPreview'
import { Icono } from '../panel/Iconos'

function CampoClave({ titulo, valor, cambiar, nueva = false }) {
  const [visible, setVisible] = useState(false)
  return <label className="password-field"><span>{titulo}</span><div><input type={visible ? 'text' : 'password'} value={valor} onChange={e => cambiar(e.target.value)} autoComplete={nueva ? 'new-password' : 'current-password'} minLength={nueva ? MIN_CLAVE : undefined} required /><button type="button" aria-label={`${visible ? 'Ocultar' : 'Mostrar'} ${titulo.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(v => !v)}><Icono nombre="ver" tam={20} /></button></div></label>
}

export default function CambiarClaveInicial() {
  const navegar = useNavigate()
  const sesion = useSesion()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    document.title = 'Cambia tu contraseña — FOM'
    return () => { document.title = 'FOM — Control total de tu flota' }
  }, [])

  if (sesion === undefined) {
    return <div className="pnl-cargando-sesion" role="status">Comprobando tu sesión…</div>
  }
  if (!sesion) return <Navigate to="/entrar" replace />
  if (!sesion.debeCambiarClave) return <Navigate to="/panel" replace />

  const enviar = async (e) => {
    e.preventDefault()
    setError('')
    const problema = validarClave(nueva, sesion?.email)
    if (problema) {
      setError(problema)
      return
    }
    if (nueva !== repetida) {
      setError('Las contraseñas nuevas no coinciden.')
      return
    }
    if (actual === nueva) {
      setError('La nueva contraseña debe ser diferente de la temporal.')
      return
    }
    setGuardando(true)
    const resultado = await completarCambioInicial({ claveActual: actual, claveNueva: nueva })
    if (resultado.ok) {
      navegar('/entrar', {
        replace: true,
        state: { aviso: 'Listo, tu contraseña quedó cambiada. Entra con la nueva.' },
      })
    }
    else {
      setError(resultado.error)
      setGuardando(false)
    }
  }

  return (
    <main className="fom-password" id="contenido">
      <header className="password-header"><SiteBrand /></header>
      <section className="password-art">
        <div aria-hidden="true" inert=""><PreviewMap alto="100%" /></div>
        <div className="password-brand">
          <SiteBrand />
          <p>Protege tu cuenta<br />antes de continuar.</p>
        </div>
      </section>
      <section className="password-form">
        <div className="password-card">
          <div>
            <span className="site-icon"><Icono nombre="escudo" tam={30} /></span>
            <h1>Cambia tu contraseña</h1>
            <p>La clave temporal solo sirve para este primer ingreso.</p>
            <form onSubmit={enviar} noValidate>
              <CampoClave titulo="Contraseña temporal" valor={actual} cambiar={setActual} />
              <CampoClave titulo="Nueva contraseña" valor={nueva} cambiar={setNueva} nueva />
              <CampoClave titulo="Repite la nueva contraseña" valor={repetida} cambiar={setRepetida} nueva />
              <p className="password-help">{REGLAS_CLAVE}</p>
              {error && <div className="password-error" role="alert">{error}</div>}
              <button type="submit" className="site-button primary" disabled={guardando}>
                {guardando ? 'Guardando…' : 'Cambiar y volver a entrar'}
              </button>
            </form>
          </div>
        </div>
      </section>
    </main>
  )
}
