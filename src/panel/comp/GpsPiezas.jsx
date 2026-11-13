import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { haceCuanto } from '../datos/gps'
import DetalleDetectado from './DetalleDetectado'
import '../modulos/admin-gps.css'

// ============================================================
// Piezas del Inventario GPS (T-95): íconos, pastillas, cabecera,
// «Detectados sin registrar» y el receptor. Trazos copiados de los
// tableros GW1..GW5 del diseño.
// ============================================================

/** Raíz de las pantallas de GPS. En la dirección va solo el id del equipo. */
export const RAIZ_GPS = '/panel/admin/gps'

/** La hora de ahora renovada cada `cada` ms: «hace 40 s» avanza solo con la pantalla abierta. */
export function useAhora(cada = 10_000) {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), cada)
    return () => clearInterval(id)
  }, [cada])
  return ahora
}

const TRAZOS = {
  senal: <><path d="M4.5 10.5a10.5 10.5 0 0 1 15 0M7.5 13.8a6 6 0 0 1 9 0" /><path d="M12 17.5v.3" /></>,
  mas: <path d="M12 5v14M5 12h14" />,
  editar: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  copiar: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V5.5a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  siguiente: <path d="m9 5 7 7-7 7" />,
  anterior: <path d="m15 5-7 7 7 7" />,
  abajo: <path d="m6 9 6 6 6-6" />,
  sync: <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4" />,
  enlace: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  reloj: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  empresa: <path d="M4 21V5l8-2v18M12 8h8v13M3 21h18M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01" />,
  buscar: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  camion: <><path d="M3 6h11v10H3z" /><path d="M14 9h4l3 3v4h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  gps: <><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="2.5" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></>,
  mensaje: <path d="M4 5h16v11H8l-4 4z" />,
}

export function IcoGps({ nombre, tam }) {
  const estilo = tam ? { width: tam, height: tam } : undefined
  return <svg className="gp-ico" viewBox="0 0 24 24" aria-hidden="true" style={estilo}>{TRAZOS[nombre]}</svg>
}

/** Pastilla de estado: tono ok | warn | bad | info | mute; `punto` pinta el puntito. */
export function Pastilla({ tono = 'mute', punto = false, sola = false, children }) {
  return <span className={`gp-tag ${tono}${sola ? ' sola' : ''}`}>{punto && <i />}{children}</span>
}

/** Ruta, título, bajada y botones, como arriba de cada tablero. */
export function Cabeza({ ruta = [], titulo, bajada, acciones }) {
  return (
    <div className="gp-cab">
      <nav className="gp-ruta" aria-label="Ruta">
        {ruta.map(([texto, a], i) => (
          <span key={`${texto}-${i}`}>
            {i > 0 && ' › '}
            {a ? <Link to={a}>{texto}</Link> : texto}
          </span>
        ))}
      </nav>
      <div className="gp-cab-fila">
        <div>
          <h1>{titulo}</h1>
          {bajada && <p>{bajada}</p>}
        </div>
        {acciones && <div className="gp-acciones">{acciones}</div>}
      </div>
    </div>
  )
}

/** Un IMEI detectado: «Reportando ahora» o «Visto hace 25 min». */
export function Detectado({ d, ahora, elegido = false, detallado = false, children }) {
  const [detalle, setDetalle] = useState(false)
  return (
    <div className={`gp-det${elegido ? ' sel' : ''}`}>
      <span className="gp-ibox"><IcoGps nombre="senal" /></span>
      <div>
        {detallado && <EstadoDetectado d={d} ahora={ahora} />}
        <span className="gp-mono imei">{d.imei}</span>
        <span className="gp-hint">
          {String(d.transporte ?? '').toUpperCase()} · {d.mensajes} {d.mensajes === 1 ? 'mensaje' : 'mensajes'}
          {detallado && d.bytesUltimo ? ` · último de ${d.bytesUltimo} B` : ''}
        </span>
        {detallado && d.primeraVez && (
          <span className="gp-hint">Primera vez {haceCuanto(d.primeraVez, ahora)} · última {haceCuanto(d.ultimaVez, ahora)}</span>
        )}
        {!detallado && <EstadoDetectado d={d} ahora={ahora} />}
        {children}
          <button type="button" className="gp-btn2 chico" onClick={() => setDetalle(true)}>Ver comunicación</button>
        {detalle && <DetalleDetectado inicial={d} alCerrar={() => setDetalle(false)} />}
      </div>
    </div>
  )
}

function EstadoDetectado({ d, ahora }) {
  return d.reportando
    ? <Pastilla tono="ok" punto sola>Reportando ahora</Pastilla>
    : <Pastilla tono="mute" punto sola>Visto {haceCuanto(d.ultimaVez, ahora)}</Pastilla>
}

/** Tarjeta «Receptor FOM». Si el servidor no publica su estado, se dice y no se inventa. */
export function ReceptorTarjeta({ ahora }) {
  const r = useDatos(() => repo.admin.gps.receptor(), [], 30_000)
  return (
    <section className="gp-card gp-col" aria-labelledby="gp-receptor">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2 className="gp-st" id="gp-receptor">Receptor FOM</h2>
        {r.estado === 'ok' && (r.datos?.activo
          ? <Pastilla tono="ok" punto>Activo</Pastilla>
          : <Pastilla tono="bad" punto>Caído</Pastilla>)}
      </div>
      {r.estado === 'cargando' && <span className="gp-hint">Consultando…</span>}
      {r.estado === 'error' && <span className="gp-hint">Disponible cuando el servidor lo publique.</span>}
      {r.estado === 'ok' && r.datos && (
        <>
          <dl className="gp-kv">
            <div><dt>TCP · puerto {r.datos.puerto}</dt><dd>{r.datos.tcp ? 'Escuchando' : 'Cerrado'}</dd></div>
            <div><dt>UDP · puerto {r.datos.puerto}</dt><dd>{r.datos.udp ? 'Escuchando' : 'Cerrado'}</dd></div>
            <div><dt>Último mensaje</dt><dd>{haceCuanto(r.datos.ultimoMensaje, ahora)}</dd></div>
            <div><dt>Mensajes recientes</dt><dd>{Number(r.datos.mensajesRecientes ?? 0).toLocaleString('es-VE')}</dd></div>
            <div><dt>Fallos al guardar</dt><dd>{r.datos.fallosAlGuardar ?? 0}</dd></div>
          </dl>
          <span className="gp-hint">Se actualiza cada 30 segundos.</span>
        </>
      )}
    </section>
  )
}

/** Pie del menú lateral del administrador FOM. Sin datos del servidor, no se pinta. */
export function ReceptorMenu() {
  const r = useDatos(() => repo.admin.gps.receptor(), [], 30_000)
  if (r.estado !== 'ok' || !r.datos) return null
  const activo = r.datos.activo
  return (
    <div className="gp-rx" role="status" aria-label={activo ? 'Receptor FOM activo' : 'Receptor FOM caído'}>
      <span className="p" style={activo ? undefined : { background: 'var(--e-peligro, #ff6369)', boxShadow: 'none' }} />
      <div>
        <b>{activo ? 'Receptor activo' : 'Receptor caído'}</b>
        <span className="gp-hint">TCP y UDP · puerto {r.datos.puerto}</span>
      </div>
    </div>
  )
}
