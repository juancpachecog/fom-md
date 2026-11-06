import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDatos } from '../useDatos'
import { Cargando, ErrorCarga } from '../comp/ui'
import { leerFuncionesInstalacion, listarPerfilesFunciones, leerPerfilFunciones, guardarFuncionesInstalacion,
  historialFuncion, fuentesFuncion, nuevaFilaFuncion, nombreFuncion, valorFuncion } from '../datos/funcionesInstalacion'
import './catalogo-funciones.css'

export default function FuncionesInstalacion({ assignmentId, protocolFamily }) {
  const current = useDatos(() => leerFuncionesInstalacion(assignmentId), [assignmentId], 30000)
  const profiles = useDatos(listarPerfilesFunciones, [])
  const [profileKey, setProfileKey] = useState(''), [profile, setProfile] = useState(null), [rows, setRows] = useState(null)
  const [version, setVersion] = useState(0), [error, setError] = useState(''), [message, setMessage] = useState(''), [history, setHistory] = useState(null)
  const [busy, setBusy] = useState(false), lock = useRef(false), pending = useRef(null)
  useEffect(() => { setProfileKey(''); setProfile(null); setRows(null); setError(''); setHistory(null); pending.current = null }, [assignmentId])
  const edit = async (id, v) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const next = await leerPerfilFunciones(id, v)
      setProfile(next); setProfileKey(`${id}@${v}`); setVersion(current.datos.installationVersion)
      setRows(current.datos.profileId === id && current.datos.profileVersion === v
        ? current.datos.items.map(item => ({ selected: item.selected, mapping: { ...item.mapping } })) : [])
      pending.current = null
    } catch (e) { setError(e.message) } finally { lock.current = false; setBusy(false) }
  }
  const update = (index, fn) => { setRows(items => items.map((r, i) => i === index ? fn(r) : r)); pending.current = null }
  const save = async event => {
    event.preventDefault(); if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const body = { expectedVersion: version, profileId: profile.profileId, profileVersion: profile.profileVersion, functions: rows }
      const fingerprint = JSON.stringify(body)
      if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, token: crypto.randomUUID() }
      await guardarFuncionesInstalacion(assignmentId, body, pending.current.token)
      setRows(null); setProfile(null); pending.current = null; setMessage('Mapeo guardado y consultado aparte. Las pruebas de funciones permanecen pendientes.')
      await current.recargar()
    } catch (e) { setError(e.message || 'No se pudo guardar el mapeo.') } finally { lock.current = false; setBusy(false) }
  }
  const viewHistory = async item => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { setHistory({ name: nombreFuncion(item.semanticKey), data: await historialFuncion(assignmentId, item.functionId) }) }
    catch (e) { setError(e.message) } finally { lock.current = false; setBusy(false) }
  }
  if (current.estado === 'cargando' && !current.datos) return <Cargando/>
  if (current.error) return <ErrorCarga error={current.error} onReintentar={current.recargar}/>
  const compatible = (profiles.datos?.items ?? []).filter(p => !p.protocolFamily || p.protocolFamily === protocolFamily || p.profileId === current.datos?.profileId)
  return <section className="gp-card catalogo-funciones">
    <h2>Funciones de esta instalación</h2>
    <p>Contacto, motor en marcha y movimiento son señales diferentes. Seleccionar una función no envía comandos ni certifica su cableado.</p>
    <Link className="pnl-btn" to="/panel/admin/funciones">Administrar variables y etiquetas</Link>
    {error && <p role="alert" className="cf-error">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="cf-scroll"><table><thead><tr><th>Función</th><th>Último valor</th><th>Vigencia</th><th>Verificación</th><th>Estado</th><th>Historial</th></tr></thead>
      <tbody>{current.datos?.items.map(item => <tr key={item.functionId}><td>{nombreFuncion(item.semanticKey)} · {item.instance}</td><td>{valorFuncion(item.lastObservation)} {item.lastObservation && item.unit !== 'none' ? item.unit : ''}</td><td>{({ fresh: 'Reciente', stale: 'Vencida', unknown: 'Sin calificar', missing: 'Sin dato' })[item.freshness] || 'Sin dato'}</td><td>{({ pass: 'Prueba registrada', fail: 'Prueba fallida', pending: 'Pendiente', not_started: 'Sin prueba' })[item.verification] || 'Pendiente'}</td><td>{item.enabled ? 'Habilitada' : 'Sin habilitar'}</td><td><button className="pnl-btn" disabled={busy} onClick={() => viewHistory(item)}>Ver muestras</button></td></tr>)}</tbody></table></div>
    {!current.datos?.items.length && <p>Esta instalación aún no tiene un mapeo de funciones.</p>}
    {profiles.error ? <ErrorCarga error={profiles.error} onReintentar={profiles.recargar}/> : <div className="cf-toolbar"><label>Perfil de compatibilidad<select disabled={busy || !current.datos?.isCurrent} value={profileKey} onChange={e => { const [id, v] = e.target.value.split('@'); if (id) edit(id, Number(v)) }}><option value="">Seleccionar perfil…</option>{compatible.map(p => <option key={`${p.profileId}@${p.profileVersion}`} value={`${p.profileId}@${p.profileVersion}`}>{p.manufacturer} · {p.model} · v{p.profileVersion}</option>)}</select></label>
      {current.datos?.profileId && <button className="pnl-btn" disabled={busy || !current.datos.isCurrent} onClick={() => edit(current.datos.profileId, current.datos.profileVersion)}>Editar mapeo actual</button>}
    </div>}
    {profile && rows && <form className="cf-editor" onSubmit={save}>
      <h3>Mapeo de señales</h3><p>Guardar crea una versión nueva y deja sus verificaciones pendientes. El historial anterior se conserva.</p>
      <fieldset disabled={busy}><div className="cf-toolbar">{profile.functions.filter(fn => fn.direction === 'observation').map(fn => <button type="button" className="pnl-btn" key={fn.semanticKey} onClick={() => { try { const next = nuevaFilaFuncion(profile, fn, rows); setRows(items => [...items, next]); pending.current = null } catch (e) { setError(e.message) } }}>Añadir {nombreFuncion(fn.semanticKey)}</button>)}</div>
        {rows.map((row, index) => {
          const fn = profile.functions.find(f => f.semanticKey === row.mapping.semanticKey && f.definitionVersion === row.mapping.definitionVersion)
          if (!fn) return <p role="alert" key={index}>La definición ya no pertenece a este perfil. Recarga antes de guardar.</p>
          const choices = fuentesFuncion(profile, fn)
          const selected = choices.find(c => c.channel === row.mapping.channel && c.source === row.mapping.source && (c.source !== 'io' || c.resourceKey === row.mapping.resourceKey))
          return <div className="cf-editor" key={index}><h4>{nombreFuncion(fn.semanticKey)} · sensor {row.mapping.instance}</h4>
            <p>{fn.interpretationSupport === 'implemented' ? 'Interpretación disponible' : 'Interpretación pendiente'} · {fn.hardwareSupport === 'unsupported' ? 'Hardware sin soporte declarado' : 'Requiere verificación de la instalación'}</p>
            <div className="cf-grid"><label><span>Seleccionada</span><input type="checkbox" checked={row.selected} onChange={e => update(index, r => ({ ...r, selected: e.target.checked }))}/></label>
              <label>Entrada o canal<select required value={selected?.id || ''} onChange={e => { const next = choices.find(c => c.id === e.target.value); if (!next) return; const { id: _id, ...source } = next; update(index, r => { const { resourceKey: _r, mode: _m, ...mapping } = r.mapping; return { ...r, mapping: { ...mapping, ...source } } }) }}><option value="">Seleccionar fuente…</option>{choices.map(c => <option key={c.id} value={c.id}>{c.channel} · {c.source === 'native' ? 'Protocolo' : c.mode}</option>)}</select></label>
              {fn.valueKind === 'boolean' && <label>Polaridad<select value={row.mapping.polarity} onChange={e => update(index, r => ({ ...r, mapping: { ...r.mapping, polarity: e.target.value } }))}><option value="normal">Normal</option><option value="inverted">Invertida</option></select></label>}
              {fn.valueKind === 'numeric' && <><label>Multiplicador<input type="number" step="any" required value={row.mapping.scale} onChange={e => update(index, r => ({ ...r, mapping: { ...r.mapping, scale: Number(e.target.value) } }))}/></label><label>Desplazamiento<input type="number" step="any" required value={row.mapping.offset} onChange={e => update(index, r => ({ ...r, mapping: { ...r.mapping, offset: Number(e.target.value) } }))}/></label></>}
            </div><button type="button" className="pnl-btn" onClick={() => { setRows(items => items.filter((_, i) => i !== index)); pending.current = null }}>Quitar de esta configuración</button>
          </div>
        })}
        <button type="submit" className="pnl-btn pnl-btn--primario">Guardar mapeo y comprobar</button><button type="button" className="pnl-btn" onClick={() => { setRows(null); setProfile(null) }}>Cancelar</button>
      </fieldset>
    </form>}
    {history && <section className="cf-editor"><h3>Muestras de {history.name} — últimas 24 horas</h3><p>Hasta cincuenta muestras. Un dato histórico no acredita el estado actual.</p>{history.data.items.map(item => <p key={item.observationId}>{valorFuncion(item)} · {item.observedAt || item.receivedAt} · {item.quality}</p>)}{!history.data.items.length && <p>No hay muestras en esta ventana.</p>}</section>}
  </section>
}
