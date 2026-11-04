import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { alCambiar, CONECTADO_A_BD, CUENTAS_DEMO, iniciarSesion, sesionActual } from '../panel/auth'
import GloboCanvas from '../components/GloboCanvas'
import LogoFom from '../components/LogoFom'

// ============================================================
// INICIA SESIÓN, con el diseño del login de la app llevado a web:
// en escritorio se divide en dos, el mundo a la izquierda (globo de
// puntos, emblema brújula, FOM) y el formulario de vidrio a la
// derecha; en el teléfono se apila igual que en la app.
// Siempre oscuro: la escena no depende del tema del panel.
// ============================================================

/** Emblema: brújula de vidrio nocturno. El disco es oscuro, la flecha es la luz. */
function Emblema() {
  return <div className="lg-emblema"><LogoFom /></div>
}

const Ojo = ({ tachado }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tachado ? (
      <path d="M3 3l18 18M10.6 10.7a2.6 2.6 0 0 0 3.7 3.6M6.5 6.8C4.2 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.7 0 3.2-.5 4.5-1.2M17.9 14.6c1.9-1.6 3.6-4.6 3.6-4.6S18 3.5 12 3.5c-.8 0-1.5.1-2.2.3" />
    ) : (
      <>
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="3.2" />
      </>
    )}
  </svg>
)

export default function Entrar() {
  const navegar = useNavigate()
  const ubicacion = useLocation()
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [error, setError] = useState('')
  const [fase, setFase] = useState('lista') // lista | verificando | saliendo

  useEffect(() => {
    document.title = 'Inicia sesión — FOM'
    // Contra la base real la sesión se resuelve preguntando al servidor, así
    // que puede llegar después de pintar: hay que quedarse escuchando.
    const actual = sesionActual()
    if (actual?.perfil) navegar(actual.debeCambiarClave ? '/cambiar-clave-inicial' : '/panel', { replace: true })
    const baja = alCambiar((s) => {
      if (s?.perfil) navegar(s.debeCambiarClave ? '/cambiar-clave-inicial' : '/panel', { replace: true })
    })
    return () => {
      baja()
      document.title = 'FOM — Control total de tu flota'
    }
  }, [navegar])

  const enviar = async (e) => {
    e.preventDefault()
    if (fase !== 'lista') return
    setError('')
    setFase('verificando')
    // Sin spinner: el emblema flotando es el único indicador de espera.
    const r = await iniciarSesion({ usuario, clave, recordar: true })
    if (r.ok) {
      // El formulario se desvanece, la escena queda quieta y la vista
      // cambia detrás, sin bajón de luz.
      setFase('saliendo')
      setTimeout(
        () => navegar(r.debeCambiarClave ? '/cambiar-clave-inicial' : '/panel', { replace: true }),
        660,
      )
    } else {
      setFase('lista')
      setError(r.error)
    }
  }

  const usarDemo = (cuenta) => {
    setUsuario(cuenta.usuario)
    setClave(cuenta.clave)
    setError('')
  }

  return (
    <main className={`lg-escena${fase === 'saliendo' ? ' saliendo' : ''}`} id="contenido">
      {/* ---- El mundo ---- */}
      <section className="lg-arte">
        <GloboCanvas />
        <div className="lg-arte-centro">
          <Emblema />
          <p className="lg-tagline">Fleet Operations &amp; Maintenance</p>
        </div>
        <p className="lg-arte-pie">Gestión de flotas · multiempresa · en una sola app</p>
      </section>

      {/* ---- El formulario ---- */}
      <section className="lg-form">
        <div className="lg-form-caja">
          <div className="lg-tarjeta">
            <h1>Inicia sesión</h1>
            <p className="lg-sub">Bienvenido de vuelta a tu panel</p>
            {ubicacion.state?.aviso && (
              <div className="lg-ok" role="status">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.7 2.7L16 9.8" /></svg>
                <span>{ubicacion.state.aviso}</span>
              </div>
            )}

            <form onSubmit={enviar} noValidate>
              <label className="lg-campo">
                <span>Correo</span>
                <input
                  type="email"
                  name="usuario"
                  autoComplete="username"
                  placeholder="tucorreo@empresa.com"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  required
                />
              </label>

              <label className="lg-campo">
                <span>Contraseña</span>
                <div className="lg-clave">
                  <input
                    type={verClave ? 'text' : 'password'}
                    name="clave"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="lg-ojo"
                    onClick={() => setVerClave((v) => !v)}
                    aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    <Ojo tachado={!verClave} />
                  </button>
                </div>
              </label>

              {error && (
                <div className="lg-error" role="alert">
                  {error}
                </div>
              )}

              <button type="submit" className="lg-cta" disabled={fase !== 'lista'}>
                {fase === 'lista' ? 'Entrar' : 'Verificando'}
              </button>

              <Link to="/contacto" className="lg-olvido">
                ¿Olvidaste tu contraseña?
              </Link>
            </form>
          </div>

          <div className="lg-demos">
            {CONECTADO_A_BD && (
              <div className="lg-demo">
                <div>
                  <b>Conectado a la base real</b>
                  <span>Entra con tu cuenta de FOM</span>
                </div>
              </div>
            )}
            {CUENTAS_DEMO.map((c) => (
              <div className="lg-demo" key={c.usuario}>
                <div>
                  <b>{c.rol}</b>
                  <span>
                    {c.usuario} · {c.clave}
                  </span>
                </div>
                <button type="button" onClick={() => usarDemo(c)}>
                  Rellenar
                </button>
              </div>
            ))}
          </div>

          <Link to="/" className="lg-volver">
            Volver al sitio
          </Link>
        </div>
      </section>
    </main>
  )
}
