import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { Cargando, ErrorCarga } from '../comp/ui'
import { Cabeza, IcoGps, Pastilla, RAIZ_GPS, useAhora } from '../comp/GpsPiezas'
import {
  PUERTO_RECEPTOR, armarComandos, comprobacionesPrueba, coordenadasTexto, haceCuanto, huellaCorta,
  lecturaTrama, nombreEquipo, nombreProtocolo,
} from '../datos/gps'
import { esEquipoMeitrack } from '../datos/gpsMeitrack'
import * as f from '../datos/formato'
import { ComandosMeitrackFicha } from './AdminGpsMeitrack'
import './admin-gps.css'
import { locationStatus } from '../meitrack/location-status.js'
import { MeitrackClockReadback } from '../meitrack/MeitrackClockReadback.jsx'

// ============================================================
// PROBAR SEÑAL (T-95, tablero GW3)
// A la izquierda los cinco comandos SMS para copiar (la clave solo vive en
// memoria y en pantalla se ve como puntos); a la derecha la prueba: mira las
// tramas del equipo cada 10 s y la da por buena con una trama del mismo
// IMEI en los últimos 5 minutos.
// El servidor abre la prueba (POST gps-devices/:id/commissioning) solo con
// el equipo ya instalado; sin instalar, la señal se ve igual pero «Activar»
// espera a la instalación.
// ============================================================

// IP del receptor para el comando «adminip»: sale de la configuración del sitio (no es un secreto,
// pero tampoco se escribe en el código). Sin ella el comando muestra «[IP del receptor]».
const IP_RECEPTOR = import.meta.env?.VITE_GPS_RECEPTOR || ''
const esMeitrack = (equipo) => equipo?.protocolo === 'meitrack-t399' || equipo?.fabricante?.toLowerCase() === 'meitrack' || equipo?.modelo === 'T399L'

/** Tarjeta de los comandos SMS: los cinco del Coban o, si el equipo es un Meitrack, los suyos (T-213). */
export function ComandosSms(props) {
  return esEquipoMeitrack(props.equipo) ? <ComandosMeitrackFicha equipo={props.equipo} /> : <ComandosSmsCoban {...props} />
}

function ComandosSmsCoban({ equipo, clave, alCambiarClave }) {
  const [copiado, setCopiado] = useState(null)
  const [fallo, setFallo] = useState('')
  if (esMeitrack(equipo)) {
    return <section className="gp-card" style={{ padding: 22 }} role="status"><h2 className="gp-st">Recepción Meitrack</h2><p>Comprueba aquí los mensajes del equipo ya registrado. Si está reportando, no hace falta repetir los SMS de configuración.</p><span className="gp-hint">La señal recibida acredita conectividad e identidad. La hora, posición y funciones del vehículo requieren su propia comprobación.</span></section>
  }
  const comandos = armarComandos({ clave, apn: equipo.apn ?? '', ip: IP_RECEPTOR, puerto: PUERTO_RECEPTOR, transporte: equipo.transport ?? 'tcp' })
  const linea = equipo.linea || equipo.simPhone
  const copiar = async (c) => {
    if (c.falta || !c.texto) return
    setFallo('')
    try {
      await navigator.clipboard.writeText(c.texto)
      setCopiado(c.n)
      setTimeout(() => setCopiado((x) => (x === c.n ? null : x)), 2000)
    } catch {
      setFallo('El navegador no dejó copiar. Escribe el comando a mano en el SMS, con tu clave en lugar de los puntos.')
    }
  }
  return (
    <section className="gp-card" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '22px 24px 10px' }} aria-labelledby="gp-cmd-t">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 6, flexWrap: 'wrap' }}>
        <div className="gp-titulo">
          <p className="gp-k">{alCambiarClave ? 'Comandos SMS' : 'Paso 3 de 3'}</p>
          <h2 className="gp-st" id="gp-cmd-t">Configura el equipo</h2>
          <span className="gp-lbl">
            {linea ? `Manda cada comando por SMS a ${linea}${equipo.carrier ? ` (${equipo.carrier})` : ''}, en orden.` : 'Manda cada comando por SMS a la línea del equipo, en orden.'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Pastilla tono="info">{nombreEquipo(equipo)}</Pastilla>
          <Pastilla tono="info">{String(equipo.transport ?? 'tcp').toUpperCase()} · puerto {PUERTO_RECEPTOR}</Pastilla>
        </div>
      </div>
      {alCambiarClave && (
        <div className="gp-f" style={{ marginBottom: 8 }}>
          <label htmlFor="gp-clave-p">Clave SMS del equipo</label>
          <div className="gp-field"><input id="gp-clave-p" type="password" autoComplete="new-password" placeholder="De fábrica: 123456" value={clave} onChange={(e) => alCambiarClave(e.target.value)} /></div>
          <span className="gp-hint">Solo arma los comandos. No se guarda ni se envía al servidor.</span>
        </div>
      )}
      {comandos.map((c) => (
        <div className="gp-cmd" key={c.n}>
          <span className="n">{c.n}</span>
          <div className="tx">
            <b>{c.titulo}</b>
            <code>{c.visible}</code>
            <span className="gp-hint">{c.respuesta}</span>
          </div>
          <button type="button" className="gp-btn2" disabled={!!c.falta} title={c.falta || undefined} aria-label={`Copiar comando ${Number(c.n)}`} onClick={() => copiar(c)}>
            <IcoGps nombre={copiado === c.n ? 'check' : 'copiar'} />{copiado === c.n ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      ))}
      {fallo && <p className="gp-error" role="alert">{fallo}</p>}
      {comandos.some(c => c.falta) && <span className="gp-hint" role="status" style={{ paddingTop: 6 }}>El receptor no está configurado en el sitio. El comando 02 está bloqueado hasta corregir la configuración.</span>}
      <span className="gp-hint" style={{ padding: '10px 0 6px', borderTop: '1px solid var(--e-borde, #262e39)' }}>Los puntos son la clave SMS: se pone al copiar y no se guarda.</span>
    </section>
  )
}

/** La tarjeta «Prueba de señal». `alActivar` recibe el resultado aprobado. */
export function PruebaSenal({ equipo, alTerminar }) {
  const sesion = useSesion()
  const ahora = useAhora(5_000)
  const instalado = Boolean(equipo.vehiculoId)
  const neutral = esMeitrack(equipo)
  const [prueba, setPrueba] = useState({ estado: neutral ? 'recepcion' : instalado ? 'abriendo' : 'sin-instalar', sesionId: null, error: '' })
  const [resultado, setResultado] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const abierta = useRef(false)

  // Abre la prueba una sola vez por pantalla (el servidor retoma la vigente si ya había una).
  useEffect(() => {
    if (neutral || !instalado || abierta.current) return
    abierta.current = true
    repo.admin.gps.iniciarPrueba(equipo.id)
      .then((r) => setPrueba({ estado: 'abierta', sesionId: r.sesionId, error: '' }))
      .catch((e) => setPrueba({ estado: 'error', sesionId: null, error: e.message }))
  }, [equipo.id, instalado, neutral])

  const tele = useDatos(() => repo.admin.gps.telemetria(equipo.id, { limite: 20 }), [equipo.id], resultado ? 0 : 10_000)
  const ultima = tele.datos?.mensajes?.[0] ?? null
  const posicion = useDatos(
    () => (ultima ? repo.admin.gps.ultimaPosicion(equipo.id).catch(() => null) : Promise.resolve(null)),
    [equipo.id, ultima?.id],
  )
  const checks = comprobacionesPrueba({ telemetria: tele.datos, imei: equipo.imei, huella: resultado?.huella, ahora })
  const reciente = checks[0].ok

  const completar = async (aprobada) => {
    if (neutral) return
    setOcupado(true)
    setError('')
    try {
      const r = await repo.admin.gps.completarPrueba(prueba.sesionId, aprobada ? { aprobada: true } : { aprobada: false, motivo: 'manual_failure', notas: 'Marcada como fallida desde el panel' }, sesion?.perfil)
      setResultado({ ...r, aprobada })
      alTerminar?.(r)
    } catch (e) {
      setError(e.message)
    } finally {
      setOcupado(false)
    }
  }

  const pos = posicion.datos
  const lectura = ultima ? lecturaTrama(ultima.diagnostico, pos && Math.abs(new Date(pos.recibido) - new Date(ultima.recibido)) < 1000 ? pos : null) : ''

  return (
    <section className="gp-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 22 }} aria-labelledby="gp-prueba-t">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span className={`gp-radar${reciente ? ' ok' : ' espera'}`}><IcoGps nombre="senal" /></span>
        <div className="gp-titulo" style={{ gap: 4 }}>
          {reciente
            ? <Pastilla tono="ok" punto sola>Señal recibida · {haceCuanto(ultima.recibido, ahora)}</Pastilla>
            : <Pastilla tono="info" punto sola>{ultima ? `Última señal · ${haceCuanto(ultima.recibido, ahora)}` : 'Esperando la primera señal'}</Pastilla>}
          <h2 className="gp-st" id="gp-prueba-t">Prueba de señal</h2>
          <span className="gp-hint">IMEI {equipo.imei}</span>
        </div>
      </div>

      {tele.estado === 'error' && <div className="gp-aviso error" role="alert">{tele.error?.message}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-live="polite">
        {checks.map((c) => (
          <div key={c.clave} className={`gp-chk${c.ok ? '' : ' no'}`}>
            <span className="c">{c.ok && <IcoGps nombre="check" />}</span>
            {c.texto}<span className="gp-sr">{c.ok ? ': sí' : ': todavía no'}</span>
          </div>
        ))}
      </div>

      {ultima && (
        <div className="gp-evidencia">
          <b>{f.fecha(ultima.recibido)} · {new Date(ultima.recibido).toLocaleTimeString('es-VE', { hour12: false })} · {ultima.via} · {ultima.bytes} bytes</b>
          <span className="gp-lbl">{lectura}{pos?.valida && Number.isFinite(pos.lat) ? ` · ${coordenadasTexto(pos.lat, pos.lng)}` : ''}</span>
          {(resultado?.huella || ultima.huella) && <span className="gp-hint gp-mono">SHA-256 {huellaCorta(resultado?.huella || ultima.huella)}</span>}
        </div>
      )}

      {!neutral && resultado?.aprobada && (
        <div className="gp-aviso" role="status"><IcoGps nombre="check" />GPS activo: la prueba quedó aprobada con su trama y su huella.</div>
      )}
      {!neutral && resultado && !resultado.aprobada && (
        <div className="gp-aviso mute" role="status">Prueba marcada como fallida. El equipo queda en el inventario con su historial.</div>
      )}
      {error && <div className="gp-aviso error" role="alert">{error}</div>}
      {neutral && <div className="gp-aviso info" role="status"><div><b>{locationStatus(tele.datos?.ubicacion).title}</b><p>{locationStatus(tele.datos?.ubicacion).detail}</p><span className="gp-hint">La recepción, la ubicación publicada y las funciones físicas son comprobaciones distintas.</span></div></div>}

      {!neutral && !resultado && prueba.estado === 'sin-instalar' && (
        <>
          <div className="gp-aviso info">
            Para activarlo, instálalo en una unidad: el servidor registra la prueba con el equipo ya montado. La señal se sigue viendo aquí mientras tanto.
          </div>
          <Link className="gp-btn ancho" to={`${RAIZ_GPS}/${equipo.id}/instalar`}><IcoGps nombre="enlace" />Instalar en una unidad</Link>
        </>
      )}
      {!neutral && !resultado && prueba.estado === 'abriendo' && <span className="gp-hint">Abriendo la prueba…</span>}
      {!neutral && !resultado && prueba.estado === 'error' && <div className="gp-aviso error" role="alert">{prueba.error}</div>}
      {!neutral && !resultado && prueba.estado === 'abierta' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="button" className="gp-btn ancho" disabled={!reciente || ocupado} onClick={() => completar(true)}>
            <IcoGps nombre="check" />{ocupado ? 'Guardando…' : 'Activar GPS'}
          </button>
          <button type="button" className="gp-btn3 ancho" disabled={ocupado} onClick={() => completar(false)}>Marcar prueba fallida</button>
        </div>
      )}

      <span className="gp-hint">{neutral ? 'La comprobación se actualiza con las tramas del mismo IMEI. Los mensajes anteriores permanecen visibles aunque la señal deje de ser reciente.' : 'Solo se activa con una señal del mismo IMEI en los últimos 5 minutos. Si falla, el equipo queda en el inventario con su historial.'}</span>

      <div style={{ borderTop: '1px solid var(--e-borde, #262e39)', paddingTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {instalado ? (
          <>
            <span className="gp-lbl">{resultado ? 'Listo' : 'Instalado en'} {equipo.vehiculoNombre}</span>
            <Link className="gp-enlace" to={`${RAIZ_GPS}/${equipo.id}`}>Ver el equipo →</Link>
          </>
        ) : (
          <>
            <span className="gp-lbl">Después de registrarlo</span>
            <Link className="gp-enlace" to={`${RAIZ_GPS}/${equipo.id}/instalar`}>Instalar en una unidad →</Link>
          </>
        )}
      </div>
    </section>
  )
}

/** /panel/admin/gps/:id/probar — repetir la prueba de un equipo ya registrado. */
export function ProbarGps() {
  const { id } = useParams()
  const navegar = useNavigate()
  const [clave, setClave] = useState('')
  const { datos: g, estado, error, recargar } = useDatos(() => repo.admin.gps.obtener(id), [id])
  return (
    <div className="gp">
      <Cabeza
        ruta={[['Hardware y telemetría'], ['Equipos GPS', RAIZ_GPS], [g?.vehiculoNombre?.split(' · ')[0] || g?.imei || 'Equipo', `${RAIZ_GPS}/${id}`], ['Probar señal']]}
        titulo="Probar señal"
        bajada={g ? `${nombreEquipo(g)} · ${nombreProtocolo(g.protocolo)}. ${esMeitrack(g) ? 'Comprueba los mensajes recibidos del equipo.' : 'Envía los comandos si hace falta y espera su señal.'}` : 'Consulta la recepción del equipo.'}
        acciones={<button type="button" className="gp-btn2" onClick={() => navegar(`${RAIZ_GPS}/${id}`)}>Volver al equipo</button>}
      />
      {estado === 'cargando' && <section className="gp-card"><Cargando filas={4} /></section>}
      {estado === 'error' && <section className="gp-card"><ErrorCarga onReintentar={recargar} error={error} /></section>}
      {estado === 'ok' && g && (
        <div className="gp-grid l400">
          <div style={{display:'flex',flexDirection:'column',gap:16}}><ComandosSms equipo={g} clave={clave} alCambiarClave={setClave} />
            {esMeitrack(g)&&<MeitrackClockReadback key={g.imei+g.firmwareVersion} imei={g.imei} firmware={g.firmwareVersion}/>}</div>
          <PruebaSenal equipo={g} />
        </div>
      )}
    </div>
  )
}
