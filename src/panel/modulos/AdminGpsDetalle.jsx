import { useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { pestanaEquipo } from '../hardware-navegacion'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { Cargando, ErrorCarga, Modal, Vacio } from '../comp/ui'
import { Cabeza, IcoGps, Pastilla, RAIZ_GPS, useAhora } from '../comp/GpsPiezas'
import { CAMPOS_GPS, cambiosGps } from '../datos/metadatosGps'
import { canArchiveGps, gpsEditChanges } from '../datos/gpsInventory.js'
import {
  ESTADOS_SIM, PUNTOS_CLAVE, calidadRecepcion, coordenadasTexto, estadoEquipo,
  haceCuanto, intervaloTexto, lecturaTrama, nombreEquipo, nombreProtocolo, senalDe, unirTramasConPosiciones,
} from '../datos/gps'
import { esEquipoMeitrack, puertoDelEquipo } from '../datos/gpsMeitrack'
import { masNuevoPrimero } from '../datos/orden'
import * as f from '../datos/formato'
import './admin-gps.css'
import { locationStatus } from '../meitrack/location-status.js'
import FuncionesInstalacion from './FuncionesInstalacion'
import ComandosInstalacion from './ComandosInstalacion'

// ============================================================
// DETALLE Y DIAGNÓSTICO DEL EQUIPO (T-95, tablero GW5)
// Diagnóstico: si no hay señal, tres cosas que revisar; la calidad de
// recepción medida sobre las últimas tramas, y las tramas tal como llegaron.
// Datos del equipo: corregir línea, SIM, firmware y estado (el IMEI no se
// corrige). Historial: posiciones recientes y lo que se hizo con el equipo.
// Lecturas: GET gps-devices/:id, /telemetry, /position/latest, /positions,
// /capabilities. Escrituras: PATCH gps-devices/:id y PATCH gps-installations/:id/remove.
// ============================================================

const ESTADOS_EDITABLES = [['inventory', 'En inventario'], ['active', 'Activo'], ['inactive', 'Inactivo']]
const NOMBRE_SIM = Object.fromEntries(ESTADOS_SIM)

export default function AdminGpsDetalle() {
  const { id } = useParams()
  const navegar = useNavigate()
  const { state } = useLocation()
  const ahora = useAhora()
  const [params, setParams] = useSearchParams()
  const pestana = pestanaEquipo(params.toString())
  const setPestana = value => setParams(previous => { const next = new URLSearchParams(previous); next.set('vista', value); return next }, { replace: true })
  const [desmontando, setDesmontando] = useState(false)
  const [archivando, setArchivando] = useState(false)
  const sesion = useSesion()
  const [aviso, setAviso] = useState(state?.aviso ?? '')

  const equipo = useDatos(() => repo.admin.gps.obtener(id), [id], 30_000)
  const tele = useDatos(() => repo.admin.gps.telemetria(id, { limite: 50 }), [id], 30_000)
  const posiciones = useDatos(() => repo.admin.gps.posiciones(id, { limite: 50 }).catch(() => []), [id], 30_000)
  const ultimaPos = useDatos(() => repo.admin.gps.ultimaPosicion(id).catch(() => null), [id], 30_000)
  const capacidades = useDatos(() => repo.admin.gps.capacidades(id).catch(() => null), [id])

  const g = equipo.datos
  if (equipo.estado !== 'ok' || !g) {
    return (
      <div className="gp">
        <Cabeza ruta={[['Hardware y telemetría'], ['Equipos GPS', RAIZ_GPS], ['Equipo']]} titulo="Equipo GPS" />
        <section className="gp-card">
          {equipo.estado === 'cargando' && <Cargando filas={5} />}
          {equipo.estado === 'error' && <ErrorCarga onReintentar={equipo.recargar} error={equipo.error} />}
          {equipo.estado === 'ok' && !g && <Vacio icono="pin" titulo="Ese equipo no está en el inventario" texto="Vuelve al inventario y elige otro." />}
        </section>
      </div>
    )
  }

  const alias = g.vehiculoNombre ? g.vehiculoNombre.split(' · ')[0] : null
  const placa = g.vehiculoPlaca ?? (g.vehiculoNombre?.split(' · ')[1] || null)
  const subtitulo = [placa, g.empresaNombre && g.empresaNombre !== '—' && g.empresaNombre !== 'Sin asociar' ? g.empresaNombre : null].filter(Boolean)

  return (
    <div className="gp">
      <Cabeza
        ruta={[['Hardware y telemetría'], ['Equipos GPS', RAIZ_GPS], [alias ?? g.imei]]}
        titulo={`${nombreEquipo(g)} · ${alias ?? 'En inventario'}`}
        bajada={<><span className="gp-mono">IMEI {g.imei}</span>{subtitulo.length > 0 && ` · ${subtitulo.join(' · ')}`}</>}
        acciones={(
          <>
            <button type="button" className="gp-btn2" onClick={() => setPestana('datos')}><IcoGps nombre="editar" />Editar</button>
            {sesion?.perfil?.rol === 'admin_fom' && canArchiveGps(g) && <button type="button" className="gp-btn3" onClick={() => setArchivando(true)}>Retirar del inventario</button>}
            {g.vehiculoId
              ? <button type="button" className="gp-btn2" onClick={() => setDesmontando(true)}>Desmontar</button>
              : <button type="button" className="gp-btn2" onClick={() => navegar(`${RAIZ_GPS}/${g.id}/instalar`)}><IcoGps nombre="enlace" />Instalar en una unidad</button>}
            <button type="button" className="gp-btn" onClick={() => navegar(`${RAIZ_GPS}/${g.id}/probar`)}><IcoGps nombre="senal" />Probar señal</button>
          </>
        )}
      />

      <div className="gp-tabs" role="tablist" aria-label="Partes del equipo">
        {[['diagnostico', 'Diagnóstico'], ['datos', 'Datos del equipo'], ['funciones', 'Funciones y sensores'], ['comandos', 'Comandos'], ['historial', 'Historial']].map(([clave, texto]) => (
          <button key={clave} type="button" role="tab" id={`gp-tab-${clave}`} aria-controls={`gp-panel-${clave}`} aria-selected={pestana === clave} className="gp-tab" onClick={() => setPestana(clave)}>{texto}</button>
        ))}
      </div>

      {aviso && <div className="gp-aviso" role="status"><IcoGps nombre="check" />{aviso}</div>}

      <div role="tabpanel" id={`gp-panel-${pestana}`} aria-labelledby={`gp-tab-${pestana}`} className="gp-pila">
        {pestana === 'diagnostico' && (
          <Diagnostico g={g} tele={tele} posiciones={posiciones.datos ?? []} ultimaPos={ultimaPos.datos} capacidades={capacidades.datos} ahora={ahora} />
        )}
        {pestana === 'datos' && (
          <DatosEditables g={g} alGuardar={async () => { setAviso('Datos del equipo guardados.'); await equipo.recargar(); setPestana('diagnostico') }} />
        )}
        {pestana === 'historial' && <Historial g={g} posiciones={posiciones} />}
        {pestana === 'funciones' && (g.instalacionId ? <FuncionesInstalacion assignmentId={g.instalacionId} protocolFamily={g.protocolo}/> : <p>Instala el equipo en un vehículo para configurar sus funciones.</p>)}
        {pestana === 'comandos' && (g.instalacionId ? <ComandosInstalacion key={g.instalacionId} assignmentId={g.instalacionId}/> : <p>Instala el equipo en un vehículo para consultar sus comandos.</p>)}
      </div>

      <VentanaDesmontar
        g={g}
        abierta={desmontando}
        alCerrar={() => setDesmontando(false)}
        alTerminar={() => navegar(RAIZ_GPS, { state: { aviso: `Equipo desmontado de ${alias ?? 'la unidad'}: vuelve al inventario con su historial.` } })}
      />
      <VentanaArchivar g={g} abierta={archivando} alCerrar={() => setArchivando(false)}
        alTerminar={() => navegar(RAIZ_GPS, { state: { aviso: 'Equipo archivado: salió del inventario conservando su historial.' } })} />
    </div>
  )
}

/** «hoy a las 07:30» / «20 oct, 7:30 a. m.». */
function cuandoFue(iso, ahora) {
  const d = new Date(iso)
  if (new Date(ahora).toDateString() === d.toDateString()) {
    return `hoy a las ${d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false })}`
  }
  return `el ${f.fechaHora(iso)}`
}

function Diagnostico({ g, tele, posiciones, ultimaPos, capacidades, ahora }) {
  const ubicacion=locationStatus(tele.datos?.ubicacion)
  const senal = senalDe(g, ahora)
  const meitrack = esEquipoMeitrack(g)
  const puerto = puertoDelEquipo(g)
  const est = estadoEquipo(g.estado)
  const mensajes = tele.datos?.mensajes ?? []
  const calidad = calidadRecepcion(mensajes)
  const tramas = unirTramasConPosiciones(mensajes.slice(0, 8), posiciones)
  const conHuella = tramas.some((m) => m.huella)
  const linea = g.linea ? `${g.linea}${g.carrier ? ` (${g.carrier})` : ''}` : null
  const tonoCard = senal.clave === 'con' ? 'ok' : senal.clave === 'sin' ? 'bad' : 'mute'
  const colorCalidad = calidad.tono === 'ok' ? 'var(--e-exito, #3dd68c)' : calidad.tono === 'warn' ? 'var(--e-aviso, #f5c242)' : 'var(--e-peligro, #ff6369)'

  return (
    <>
      {meitrack&&<section className="gp-card gp-col" role="status"><h2 className="gp-st">{ubicacion.title}</h2><p>{ubicacion.detail}</p></section>}
      <div className="gp-grid l400">
        <div className="gp-pila">
          <section className={`gp-card gp-diag ${tonoCard}`} aria-live="polite">
            <span className="gp-diag-ico"><IcoGps nombre="senal" /></span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <h2 className="gp-st">{senal.texto}</h2>
                <Pastilla tono={est.tono}>{est.texto}</Pastilla>
              </div>
              {senal.clave === 'con' && (
                <span className="gp-lbl">Última trama {cuandoFue(g.ultimaConexion, ahora)}. Reporta con normalidad: para FOM hay señal si llegó algo del mismo IMEI en los últimos 5 minutos.</span>
              )}
              {senal.clave !== 'con' && (
                <>
                  <span className="gp-lbl">
                    {g.ultimaConexion ? `Última trama ${cuandoFue(g.ultimaConexion, ahora)}. ` : 'Todavía no ha llegado ninguna trama de este IMEI. '}
                    Para FOM hay señal si llegó algo del mismo IMEI en los últimos 5 minutos.
                  </span>
                  <ol>
                    {g.vehiculoId
                      ? <li>¿La unidad está apagada o sin batería? El equipo se alimenta de ella.</li>
                      : <li>¿El equipo está conectado a corriente? Sin instalar, necesita su fuente para transmitir.</li>}
                    <li>{linea ? `Revisa saldo y datos de la línea ${linea}.` : 'Registra la línea SIM del equipo en «Datos del equipo» y revisa que tenga saldo y datos.'}</li>
                    {meitrack?<li>Conserva la lectura DB4 y comprueba la recepción en «Probar señal». Si ya estaba configurado, revisa la causa antes de repetir los SMS de configuración.</li>:<li>Envía <span className="gp-mono cmdx">check{PUNTOS_CLAVE}</span> por SMS: debe decir GPRS ON y PORT {puerto}.</li>}
                  </ol>
                </>
              )}
            </div>
          </section>

          <section className="gp-card gp-col" style={{ gap: 14 }} aria-labelledby="gp-calidad">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div className="gp-titulo">
                <h2 className="gp-st" id="gp-calidad">{senal.clave === 'sin' ? 'Calidad de recepción antes del corte' : 'Calidad de recepción'}</h2>
                <span className="gp-hint">{calidad.muestras ? `Sobre las últimas ${calidad.muestras} tramas` : 'Sin tramas para medir'}</span>
              </div>
              {calidad.porcentaje !== null && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="gp-num" style={{ color: colorCalidad }}>{calidad.porcentaje}%</span>
                  <Pastilla tono={calidad.tono}>{calidad.etiqueta}</Pastilla>
                </div>
              )}
            </div>
            {tele.estado === 'cargando' && <Cargando filas={2} />}
            {tele.estado === 'error' && <ErrorCarga onReintentar={tele.recargar} error={tele.error} compacto />}
            {tele.estado === 'ok' && calidad.porcentaje === null && (
              <span className="gp-lbl">Hacen falta al menos dos tramas para medir la recepción.</span>
            )}
            {tele.estado === 'ok' && calidad.porcentaje !== null && (
              <>
                <div className="gp-barra" role="img" aria-label={`Calidad ${calidad.porcentaje}%`}><span style={{ width: `${calidad.porcentaje}%`, background: colorCalidad }} /></div>
                <div className="gp-cifras">
                  <div className="gp-kcell"><span className="gp-lbl">Muestras</span><span className="gp-med">{calidad.muestras}</span></div>
                  <div className="gp-kcell"><span className="gp-lbl">Mensajes por hora</span><span className="gp-med">{calidad.mensajesPorHora}</span></div>
                  <div className="gp-kcell"><span className="gp-lbl">Cada cuánto</span><span className="gp-med">{intervaloTexto(calidad.intervaloS)}</span></div>
                  <div className="gp-kcell"><span className="gp-lbl">IMEI coincide</span><span className="gp-med">{calidad.imeiCoincidePct}%</span></div>
                </div>
              </>
            )}
          </section>
        </div>

        <section className="gp-card gp-col" style={{ gap: 8 }} aria-labelledby="gp-datos">
          <h2 className="gp-st" id="gp-datos">Datos del equipo</h2>
          <dl className="gp-kv">
            <div><dt>Protocolo</dt><dd>{nombreProtocolo(g.protocolo)}{g.transport ? ` · ${String(g.transport).toUpperCase()}` : ''}</dd></div>
            {meitrack && <div><dt>Receptor FOM</dt><dd>TCP · puerto {puerto}</dd></div>}
            <div><dt>Serie · firmware</dt><dd>{[g.serie, g.firmwareVersion].filter(Boolean).join(' · ') || 'Sin registrar'}</dd></div>
            <div><dt>Línea SIM</dt><dd>{g.linea ? `${g.linea}${g.carrier ? ` · ${g.carrier}` : ''}` : 'Sin línea'}</dd></div>
            <div><dt>ICCID</dt><dd className="gp-mono">{g.iccid || 'Sin registrar'}</dd></div>
            <div><dt>APN</dt><dd>{g.apn || 'Sin registrar'}</dd></div>
            <div><dt>Estado de la SIM</dt><dd>{NOMBRE_SIM[g.simStatus] ?? 'Sin registrar'}</dd></div>
            {g.vehiculoId
              ? <div><dt>Instalado</dt><dd>{[g.instaladoEn ? f.fecha(g.instaladoEn) : null, g.ubicacionInstalacion].filter(Boolean).join(' · ') || 'Sí'}</dd></div>
              : <div><dt>Guardado en</dt><dd>{g.ubicacion || 'Sin registrar'}</dd></div>}
            {g.tecnico && <div><dt>Técnico</dt><dd>{g.tecnico}</dd></div>}
            {capacidades && capacidades.panico !== null && (
              <div><dt>Botón de pánico</dt><dd>{capacidades.panico ? 'Sí' : 'No'}</dd></div>
            )}
            {ultimaPos?.valida && (
              <div><dt>Última posición</dt><dd>{coordenadasTexto(ultimaPos.lat, ultimaPos.lng)}</dd></div>
            )}
          </dl>
        </section>
      </div>

      <section className="gp-card" style={{ padding: '16px 8px 4px', display: 'flex', flexDirection: 'column', gap: 6 }} aria-labelledby="gp-tramas">
        <div style={{ padding: '0 12px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="gp-st" id="gp-tramas">Últimas tramas</h2>
          <span className="gp-hint">{conHuella ? 'Se guarda lo que llegó tal cual; la huella SHA-256 se calcula sobre esos bytes.' : 'Se guarda lo que llegó tal cual.'}</span>
        </div>
        {tele.estado === 'ok' && tramas.length === 0 && (
          <div style={{ padding: '0 12px 14px' }}><span className="gp-lbl">Todavía no llega ninguna trama de este IMEI.</span></div>
        )}
        {tramas.length > 0 && (
          <div className="gp-tabla-caja">
            <table className="gp-tbl">
              <thead><tr><th>Hora</th><th>Vía</th><th>Tamaño</th><th>IMEI</th><th>Lectura</th>{conHuella && <th>Huella</th>}</tr></thead>
              <tbody>
                {tramas.map((m) => (
                  <tr key={m.id}>
                    <td className="gp-mono" style={{ color: 'var(--e-texto, #f3f5f8)' }}>
                      {new Date(m.recibido).toLocaleTimeString('es-VE', { hour12: false })}
                      {new Date(m.recibido).toDateString() !== new Date(ahora).toDateString() && <span className="gp-hint"> · {f.fechaCorta(m.recibido)}</span>}
                    </td>
                    <td>{m.via || '—'}</td>
                    <td className="gp-mono">{m.bytes ?? '—'} B</td>
                    <td>{m.imeiCoincide === false ? <Pastilla tono="bad">No coincide</Pastilla> : <Pastilla tono="ok">Coincide</Pastilla>}</td>
                    <td style={{ color: 'var(--e-texto, #f3f5f8)' }}>{lecturaTrama(m.diagnostico, m.posicion)}</td>
                    {conHuella && <td className="gp-mono gp-hint">{m.huella ? `…${m.huella.slice(-4)}` : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function DatosEditables({ g, alGuardar }) {
  const inicial = {
    estado: g.estado, fabricante: g.fabricante ?? '', serie: g.serie ?? '',
    ...Object.fromEntries(CAMPOS_GPS.map((c) => [c.clave, g[c.clave] ?? (c.clave === 'simPhone' ? g.linea ?? '' : '')])),
  }
  const [datos, setDatos] = useState(inicial)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const poner = (k, v) => setDatos((d) => ({ ...d, [k]: v }))

  const guardar = async () => {
    setGuardando(true)
    setError('')
    try {
      const cambios = gpsEditChanges(datos, inicial)
      if (!Object.keys(cambios).length) { setGuardando(false); return }
      const metadatos = cambiosGps(datos, inicial)
      await repo.admin.gps.set(g.id, {
        estado: datos.estado !== inicial.estado ? datos.estado : undefined,
        fabricante: datos.fabricante.trim() !== inicial.fabricante ? datos.fabricante.trim() || null : undefined,
        serie: datos.serie.trim() !== inicial.serie ? datos.serie.trim() || null : undefined,
        metadatos,
      })
      await alGuardar()
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="gp-card" style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '22px 24px' }} aria-labelledby="gp-editar">
      <div className="gp-titulo">
        <h2 className="gp-st" id="gp-editar">Datos del equipo</h2>
        <span className="gp-lbl">Corrige la línea, la SIM, el firmware o el estado. El IMEI no se corrige: si está mal, el aparato es otro y hay que registrarlo aparte.</span>
      </div>
      <div className="gp-campos">
        <div className="gp-f">
          <label htmlFor="e-imei">IMEI</label>
          <div className="gp-field ro"><input id="e-imei" className="gp-mono" value={g.imei} readOnly /></div>
        </div>
        <div className="gp-f">
          <label htmlFor="e-estado">Estado del equipo</label>
          <div className="gp-field">
            <select id="e-estado" value={datos.estado} onChange={(e) => poner('estado', e.target.value)} disabled={guardando}>
              {!ESTADOS_EDITABLES.some(([v]) => v === datos.estado) && <option value={datos.estado}>{estadoEquipo(datos.estado).texto}</option>}
              {ESTADOS_EDITABLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <IcoGps nombre="abajo" />
          </div>
          <span className="gp-hint">Solo un equipo «En inventario» se puede instalar.</span>
        </div>
        <div className="gp-f">
          <label htmlFor="e-fab">Marca</label>
          <div className="gp-field"><input id="e-fab" maxLength={80} value={datos.fabricante} onChange={(e) => poner('fabricante', e.target.value)} disabled={guardando} /></div>
        </div>
        <div className="gp-f">
          <label htmlFor="e-serie">Número de serie</label>
          <div className="gp-field"><input id="e-serie" maxLength={100} placeholder="Opcional" value={datos.serie} onChange={(e) => poner('serie', e.target.value)} disabled={guardando} /></div>
        </div>
        {CAMPOS_GPS.map((c) => (
          <div className="gp-f" key={c.clave}>
            <label htmlFor={`e-${c.clave}`}>{c.etiqueta}</label>
            <div className="gp-field">
              {c.opciones ? (
                <>
                  <select id={`e-${c.clave}`} value={datos[c.clave] ?? ''} onChange={(e) => poner(c.clave, e.target.value)} disabled={guardando}>
                    {!datos[c.clave] && <option value="">Sin registrar</option>}
                    {c.opciones.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                  <IcoGps nombre="abajo" />
                </>
              ) : (
                <input id={`e-${c.clave}`} type={c.tipo ?? 'text'} maxLength={c.max} className={c.clave === 'iccid' ? 'gp-mono' : undefined} value={datos[c.clave] ?? ''} onChange={(e) => poner(c.clave, e.target.value)} disabled={guardando} />
              )}
            </div>
          </div>
        ))}
      </div>
      {error && <div className="gp-aviso error" role="alert">{error}</div>}
      <div className="gp-pie">
        <button type="button" className="gp-btn" onClick={guardar} disabled={guardando || JSON.stringify(datos) === JSON.stringify(inicial)}><IcoGps nombre="check" />{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </section>
  )
}

function Historial({ g, posiciones }) {
  // Lo que se hizo con el equipo, de la bitácora, lo más nuevo arriba.
  const bitacora = useDatos(
    () => repo.admin.auditoria.listar({ q: g.imei }).then((l) => masNuevoPrimero(l, 'fecha').slice(0, 12)).catch(() => []),
    [g.imei],
  )
  const lista = masNuevoPrimero(posiciones.datos ?? [], 'recibido').slice(0, 12)
  return (
    <div className="gp-grid l400">
      <section className="gp-card" style={{ padding: '16px 8px 4px', display: 'flex', flexDirection: 'column', gap: 6 }} aria-labelledby="gp-pos">
        <div style={{ padding: '0 12px' }}><h2 className="gp-st" id="gp-pos">Posiciones recientes</h2></div>
        {posiciones.estado === 'cargando' && <Cargando filas={3} />}
        {posiciones.estado === 'ok' && lista.length === 0 && <div style={{ padding: '0 12px 14px' }}><span className="gp-lbl">Sin posiciones guardadas de este equipo.</span></div>}
        {lista.length > 0 && (
          <div className="gp-tabla-caja">
            <table className="gp-tbl">
              <thead><tr><th>Hora</th><th>Posición</th><th>Velocidad</th><th>Motor</th></tr></thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.id}>
                    <td className="gp-mono" style={{ color: 'var(--e-texto, #f3f5f8)' }}>{f.fechaHora(p.hora || p.recibido)}</td>
                    <td>{p.valida ? coordenadasTexto(p.lat, p.lng) : 'Sin fijar'}</td>
                    <td className="gp-mono">{Number.isFinite(p.velocidad) ? `${Math.round(p.velocidad)} km/h` : '—'}</td>
                    <td>{p.encendido === null || p.encendido === undefined ? '—' : p.encendido ? 'Encendido' : 'Apagado'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="gp-card gp-col" aria-labelledby="gp-bit">
        <h2 className="gp-st" id="gp-bit">Qué se ha hecho con el equipo</h2>
        {bitacora.estado === 'cargando' && <Cargando filas={2} />}
        {bitacora.estado === 'ok' && bitacora.datos.length === 0 && <span className="gp-lbl">Todavía no hay movimientos registrados.</span>}
        {bitacora.estado === 'ok' && bitacora.datos.length > 0 && (
          <dl className="gp-kv">
            {bitacora.datos.map((a) => (
              <div key={a.id} style={{ alignItems: 'flex-start', padding: '8px 0', flexDirection: 'column', gap: 2 }}>
                <dt style={{ color: 'var(--e-texto, #f3f5f8)', fontWeight: 600 }}>{a.detalle || a.tipo}</dt>
                <dd style={{ fontWeight: 400, color: 'var(--e-texto-3, #8c97a7)', textAlign: 'left', fontSize: 12 }}>{a.actorNombre} · {f.fechaHora(a.fecha)}</dd>
              </div>
            ))}
          </dl>
        )}
        {g.ultimaConexion && <span className="gp-hint">Última trama {haceCuanto(g.ultimaConexion)}.</span>}
      </section>
    </div>
  )
}

export function VentanaArchivar({ g, abierta, alCerrar, alTerminar }) {
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const archivar = async () => {
    if (inFlight.current || !canArchiveGps(g) || !motivo.trim()) return
    inFlight.current = true; setGuardando(true); setError('')
    try { await repo.admin.gps.archivar(g.id, motivo.trim()); alTerminar() }
    catch (e) { setError(e.message) }
    finally { inFlight.current = false; setGuardando(false) }
  }
  return <Modal titulo="Retirar equipo del inventario" abierto={abierta} alCerrar={guardando ? () => {} : alCerrar} ancho={460}>
    <div className="gp gp-ventana">
      <p>El equipo {nombreEquipo(g)} dejará de aparecer en el inventario. Se conservan su identidad, instalaciones anteriores y mensajes recibidos. Un equipo instalado debe desmontarse primero.</p>
      <div className="gp-f"><label htmlFor="a-motivo">Motivo del retiro</label><div className="gp-field"><input id="a-motivo" maxLength={500} value={motivo} onChange={e => setMotivo(e.target.value)} disabled={guardando}/></div></div>
      {error && <p className="gp-error" role="alert">{error}</p>}
      <div className="gp-pie"><button type="button" className="gp-btn2" onClick={alCerrar} disabled={guardando}>Cancelar</button><button type="button" className="gp-btn3" onClick={archivar} disabled={guardando || !motivo.trim() || !canArchiveGps(g)}>{guardando ? 'Comprobando retiro…' : 'Archivar equipo'}</button></div>
    </div>
  </Modal>
}

function VentanaDesmontar({ g, abierta, alCerrar, alTerminar }) {
  const sesion = useSesion()
  const [notas, setNotas] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const desmontar = async () => {
    if (!g.instalacionId) { setError('No encontramos la instalación abierta de este equipo. Recarga la página y vuelve a intentarlo.'); return }
    setGuardando(true)
    setError('')
    try {
      await repo.admin.gps.desmontar(g.instalacionId, notas.trim(), ubicacion, sesion?.perfil)
      alTerminar()
    } catch (e) {
      setError(e.message)
      setGuardando(false)
    }
  }
  return (
    <Modal titulo={`Desmontar de ${g.vehiculoNombre ?? 'la unidad'}`} abierto={abierta} alCerrar={alCerrar} ancho={460}>
      <div className="gp gp-ventana">
        <span className="gp-lbl">La unidad queda sin GPS y el equipo vuelve al inventario con todo su historial.</span>
        <div className="gp-f">
          <label htmlFor="d-notas">Por qué se retira</label>
          <div className="gp-field"><input id="d-notas" maxLength={500} placeholder="Opcional" value={notas} onChange={(e) => setNotas(e.target.value)} disabled={guardando} /></div>
        </div>
        <div className="gp-f">
          <label htmlFor="d-ubi">Dónde queda guardado</label>
          <div className="gp-field"><input id="d-ubi" maxLength={160} placeholder="Gaveta 2 · Maracaibo" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} disabled={guardando} /></div>
        </div>
        {error && <div className="gp-aviso error" role="alert">{error}</div>}
        <div className="gp-pie">
          <button type="button" className="gp-btn2" onClick={alCerrar} disabled={guardando}>Cancelar</button>
          <button type="button" className="gp-btn3" onClick={desmontar} disabled={guardando}>{guardando ? 'Desmontando…' : 'Desmontar'}</button>
        </div>
      </div>
    </Modal>
  )
}

