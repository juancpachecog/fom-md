import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDatos } from '../useDatos'
import { Cargando, ErrorCarga } from '../comp/ui'
import { pedir } from '../datos/api'
import { apiAutodeteccion, valorSenal } from '../datos/gpsAutodeteccion'
import { leerFuncionesInstalacion, listarPerfilesFunciones, leerPerfilFunciones, guardarFuncionesInstalacion,
  historialFuncion, fuentesFuncion, nuevaFilaFuncion, nombreFuncion, nombreFuente, valorFuncion,
  familiaFunciones, perfilInicialFunciones, filasSugeridas } from '../datos/funcionesInstalacion'
import './catalogo-funciones.css'
import { useConfirmar } from '../comp/Confirmar'
import VariablesInstalacion from './VariablesInstalacion'
import PruebaFuncion from './PruebaFuncion'
import GuiaFunciones from './GuiaFunciones'

const discovery = apiAutodeteccion(pedir)
const profileKey = p => `${p.profileId}@${p.profileVersion}`
const rowKey = row => `${row.mapping.semanticKey}:${row.mapping.instance}`
const verificationLabel = { pass: 'Comprobada', fail: 'Prueba fallida', pending: 'Por comprobar', not_started: 'Sin prueba' }
const profileLabel = p => p.profileId === 'coban.ascii.extended19' ? 'Coban · Lectura extendida'
  : p.profileId === 'coban-gps103.observed' ? (p.profileVersion === 2 ? 'Coban · ACC y puerta' : 'Coban · Posición básica')
    : `${p.manufacturer} · ${p.model} · v${p.profileVersion}`

export default function FuncionesInstalacion({ assignmentId, protocolFamily, deviceId, preferencias }) {
  const family = familiaFunciones(protocolFamily)
  const { confirmar, dialogo } = useConfirmar()
  const current = useDatos(() => leerFuncionesInstalacion(assignmentId), [assignmentId], 30000)
  const profiles = useDatos(listarPerfilesFunciones, [])
  const observed = useDatos(() => deviceId ? discovery.detectar({ id: deviceId }) : Promise.resolve(null), [deviceId], deviceId ? 30000 : 0)
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [history, setHistory] = useState(null)
  const [testFunction, setTestFunction] = useState(null)
  const [advanced, setAdvanced] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [variableSource, setVariableSource] = useState(null)
  const [busy, setBusy] = useState(false)
  const initial = useRef(false)
  const lock = useRef(false)
  const pending = useRef(null)
  const data = current.datos
  const compatible = (profiles.datos?.items ?? []).filter(p => p.protocolFamily === family
    || p.profileId === data?.profileId || (!p.protocolFamily && family !== 'coban-gps103'))
  const recommended = data && perfilInicialFunciones(compatible, data, family, observed.error ? null : observed.datos?.profileSuggestion)

  async function edit(id, version) {
    if (lock.current || !data?.isCurrent) return
    lock.current = true
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const profile = await leerPerfilFunciones(id, version)
      const prior = data.items.filter(item => profile.functions.some(fn =>
        fn.semanticKey === item.mapping.semanticKey && fn.definitionVersion === item.mapping.definitionVersion
        && fuentesFuncion(profile, fn).some(source => source.channel === item.mapping.channel
          && source.source === item.mapping.source && source.resourceKey === item.mapping.resourceKey
          && source.mode === item.mapping.mode)))
        .map(item => ({ selected: item.selected, mapping: { ...item.mapping } }))
      const same = data.profileId === id && data.profileVersion === version
      const rows = same
        ? data.items.map(item => ({ selected: item.selected, mapping: { ...item.mapping } }))
        : [...prior, ...filasSugeridas(profile, prior)]
      setDraft({ profile, rows, version: data.installationVersion, removed: data.items.length - prior.length })
      pending.current = null
    } catch (e) {
      setError(e.message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    if (initial.current || !data?.isCurrent || data.profileId || !profiles.datos || (deviceId && observed.estado === 'cargando')) return
    if (!recommended || lock.current) return
    initial.current = true
    void edit(recommended.profileId, recommended.profileVersion)
  // Open the initial suggestion once. Background reads must never replace a draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, profiles.datos, observed.estado, observed.datos])

  function updateRows(fn) {
    setDraft(value => ({ ...value, rows: fn(value.rows) }))
    pending.current = null
  }
  const update = (index, fn) => updateRows(items => items.map((row, i) => i === index ? fn(row) : row))

  async function save(event) {
    event.preventDefault()
    if (lock.current || !draft || !data?.isCurrent) return
    lock.current = true
    setBusy(true)
    try {
      const body = { expectedVersion: draft.version, profileId: draft.profile.profileId,
        profileVersion: draft.profile.profileVersion, functions: draft.rows }
      if (!pending.current && data.installationVersion !== draft.version) {
        throw Error('La configuración cambió. Vuelve a abrir el mapeo para revisar la versión actual.')
      }
      if (!await confirmar({ titulo: 'Guardar mapeo',
        texto: draft.removed ? `El perfil nuevo deja fuera ${draft.removed} funciones de la configuración actual.` : 'Los sensores guardados quedan pendientes de comprobar.',
        accion: 'Guardar cambios' })) return
      setError('')
      setMessage('')
      const fingerprint = JSON.stringify(body)
      if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, token: crypto.randomUUID() }
      await guardarFuncionesInstalacion(assignmentId, body, pending.current.token)
      setDraft(null)
      setTestFunction(null)
      setHistory(null)
      pending.current = null
      setMessage('Mapeo guardado.')
      await current.recargar()
    } catch (e) {
      setError(e.message || 'No se pudo guardar el mapeo.')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  async function viewHistory(item) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      setHistory({ name: nombreFuncion(item.semanticKey), semanticKey: item.semanticKey, data: await historialFuncion(assignmentId, item.functionId) })
    } catch (e) {
      setError(e.message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  if (!data && current.estado === 'cargando') return <Cargando/>
  if (current.error) return <ErrorCarga error={current.error} onReintentar={current.recargar}/>
  if (!data) return null
  const profile = draft?.profile
  const suggestions = profile ? filasSugeridas(profile, draft.rows).filter(row =>
    !data.items.some(item => item.mapping.semanticKey === row.mapping.semanticKey)) : []
  const savedProfile = compatible.find(p => p.profileId === data.profileId && p.profileVersion === data.profileVersion)
  const signalFor = (mapping, item) => !observed.error && mapping.source === 'native' && mapping.polarity !== 'inverted' &&
    mapping.scale === 1 && mapping.offset === 0 && !item?.lastObservation
      ? observed.datos?.signals.find(s => s.key === mapping.semanticKey && s.channel === mapping.channel) : null
  const renderReading = (mapping, item) => {
    const signal = signalFor(mapping, item)
    const at = item?.lastObservation?.receivedAt ?? signal?.receivedAt
    const reading = item?.lastObservation ? valorFuncion(item.lastObservation, mapping.semanticKey) : signal ? valorSenal(signal) : 'Sin lectura'
    return <>{reading}{at && <small title={new Date(at).toLocaleString('es-VE')}>
      {item?.freshness === 'stale' || signal?.freshness === 'stale' ? 'Lectura anterior' : new Date(at).toLocaleTimeString('es-VE')}
    </small>}</>
  }
  const settings = observed.error ? null : observed.datos?.settings

  return <section className="gp-card catalogo-funciones cf-mapper">
    <div className="cf-map-head">
      <div><h2>Funciones y sensores</h2>{(profile || savedProfile) && <span className="gp-hint">{profileLabel(profile || savedProfile)}</span>}</div>
      {!draft && (data.profileId || recommended) && <button className="gp-btn2 chico" type="button" disabled={busy || !data.isCurrent}
        onClick={() => edit(data.profileId ?? recommended.profileId, data.profileVersion ?? recommended.profileVersion)}>
        {data.profileId ? 'Editar mapeo' : 'Configurar señales'}</button>}
    </div>
    {profiles.error && <ErrorCarga error={profiles.error} onReintentar={profiles.recargar}/>}
    {error && <p role="alert" className="cf-error">{error}</p>}
    {message && <p role="status" className="gp-aviso">{message}</p>}
    {!draft && !data.items.length && <p className="gp-hint">{busy || profiles.estado === 'cargando' ? 'Cargando compatibilidad…' : recommended ? 'Sin mapeos guardados' : 'Selecciona un perfil de lectura en Ajustes avanzados.'}</p>}

    {draft && <form onSubmit={save}>
      <fieldset className="cf-map-fieldset" disabled={busy || !data.isCurrent}>
        <div className="cf-map-list" role="group" aria-label="Mapeo de señales">
          <div className="cf-map-row cf-map-columns" aria-hidden="true"><span>Señal del GPS</span><span>Variable en FOM</span><span>Última lectura</span><span>Usar</span></div>
          {draft.rows.map((row, index) => {
            const mapping = row.mapping
            const fn = profile.functions.find(f => f.semanticKey === mapping.semanticKey && f.definitionVersion === mapping.definitionVersion)
            if (!fn) return <p role="alert" key={rowKey(row)}>La definición no está disponible en este perfil.</p>
            const choices = fuentesFuncion(profile, fn)
            const selected = choices.find(source => source.channel === mapping.channel && source.source === mapping.source
              && (source.source !== 'io' || (source.resourceKey === mapping.resourceKey && source.mode === mapping.mode)))
            const reading = profile.profileId === data.profileId && profile.profileVersion === data.profileVersion
              ? data.items.find(i => rowKey(i) === rowKey(row) && i.mapping.channel === mapping.channel
                && i.mapping.resourceKey === mapping.resourceKey && i.mapping.mode === mapping.mode
                && i.mapping.polarity === mapping.polarity && i.mapping.scale === mapping.scale && i.mapping.offset === mapping.offset) : null
            return <div className="cf-map-entry" key={rowKey(row)}>
              <div className="cf-map-row">
                {choices.length > 1 || !selected ? <select required aria-label={`Señal para ${nombreFuncion(fn.semanticKey)}`}
                  value={selected?.id ?? ''} onChange={e => {
                    const source = choices.find(c => c.id === e.target.value)
                    if (!source) return
                    const { id: _id, ...next } = source
                    const { resourceKey: _r, mode: _m, ...base } = mapping
                    update(index, value => ({ ...value, mapping: { ...base, ...next } }))
                  }}><option value="">Seleccionar señal…</option>{choices.map(c => <option key={c.id} value={c.id}>{nombreFuente(c.channel)}</option>)}</select>
                  : <strong>{nombreFuente(mapping.channel)}</strong>}
                <span>{nombreFuncion(fn.semanticKey)}{mapping.instance > 1 ? ` · ${mapping.instance}` : ''}</span>
                <span>{renderReading(mapping, reading)}</span>
                <label className="cf-map-toggle"><input type="checkbox" aria-label={`Usar ${nombreFuncion(fn.semanticKey)} ${mapping.instance}`}
                  checked={row.selected} onChange={e => update(index, value => ({ ...value, selected: e.target.checked }))}/></label>
              </div>
              <details className="cf-map-options"><summary>Ajustar {nombreFuncion(fn.semanticKey)}</summary>
                <div className="cf-grid">
                  {fn.valueKind === 'boolean' && <label>Polaridad<select value={mapping.polarity} onChange={e => update(index, r => ({ ...r, mapping: { ...r.mapping, polarity: e.target.value } }))}>
                    <option value="normal">Normal</option><option value="inverted">Invertida</option></select></label>}
                  {fn.valueKind === 'numeric' && <><label>Multiplicador<input type="number" step="any" required value={mapping.scale} onChange={e => update(index, r => ({ ...r, mapping: { ...r.mapping, scale: Number(e.target.value) } }))}/></label>
                    <label>Desplazamiento<input type="number" step="any" required value={mapping.offset} onChange={e => update(index, r => ({ ...r, mapping: { ...r.mapping, offset: Number(e.target.value) } }))}/></label></>}
                </div>
                <button className="gp-btn2 chico" type="button" onClick={() => updateRows(rows => rows.filter((_, i) => i !== index))}>Quitar mapeo</button>
              </details>
            </div>
          })}
        </div>
        <div className="cf-map-actions">
          <button type="submit" className="gp-btn chico" disabled={!draft.rows.some(r => r.selected) && !data.profileId}>Guardar mapeo</button>
          {!!suggestions.length && <button type="button" className="gp-btn2 chico" onClick={() => updateRows(rows => [...rows, ...suggestions])}>Añadir sugeridas</button>}
          <button type="button" className="gp-btn2 chico" onClick={() => { setDraft(null); pending.current = null; setError('') }}>Cancelar</button>
        </div>
      </fieldset>
    </form>}

    {!draft && !!data.items.length && <div className="cf-map-list">
      <div className="cf-map-row cf-map-columns" aria-hidden="true"><span>Señal del GPS</span><span>Variable en FOM</span><span>Última lectura</span><span>Estado</span></div>
      {data.items.map(item => <div className="cf-map-entry" key={item.functionId}>
        <div className="cf-map-row">
          <strong>{nombreFuente(item.mapping.channel)}</strong><span>{nombreFuncion(item.semanticKey)}{item.instance > 1 ? ` · ${item.instance}` : ''}</span>
          <span>{renderReading(item.mapping, item)}</span>
          <span>{item.selected ? verificationLabel[item.verification] ?? 'Por comprobar' : 'Sin usar'}{item.enabled && <small>Habilitada</small>}</span>
        </div>
        <details className="cf-map-options"><summary>Muestras y prueba de {nombreFuncion(item.semanticKey)}</summary>
          <div className="cf-map-actions">
            <button className="gp-btn2 chico" disabled={busy} onClick={() => viewHistory(item)}>Ver muestras</button>
            <button className="gp-btn2 chico" disabled={busy || !data.isCurrent || !item.selected} onClick={() => setTestFunction(item)}>Registrar prueba</button>
            <button className="gp-btn2 chico" disabled={busy || !data.isCurrent || !item.selected} onClick={() => {
              setVariableSource({ id: item.functionId }); setAdvanced(true)
            }}>Vincular variable propia</button>
          </div>
        </details>
      </div>)}
    </div>}

    {settings && <p className="gp-hint">Alarma armada · {settings.armed ? 'ON' : 'OFF'} · {new Date(settings.receivedAt).toLocaleString('es-VE')}</p>}
    {testFunction && <PruebaFuncion key={testFunction.functionId} assignmentId={assignmentId} fn={testFunction} onClose={() => setTestFunction(null)} onSaved={current.recargar}/>}
    {history && <section className="cf-editor"><h3>Muestras de {history.name}</h3>
      {history.data.items.map(item => <p key={item.observationId}>{valorFuncion(item, history.semanticKey)} · {item.observedAt || item.receivedAt} · {item.quality}</p>)}
      {!history.data.items.length && <p>Sin muestras en las últimas 24 horas.</p>}
      <button type="button" className="gp-btn2 chico" onClick={() => setHistory(null)}>Cerrar muestras</button>
    </section>}

    <details className="cf-map-options" open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
      <summary>Ajustes avanzados y variables propias</summary>
      {advanced && <>
        <div className="cf-toolbar">
          <label>Perfil de lectura<select disabled={busy || !data.isCurrent} value={profile ? profileKey(profile) : savedProfile ? profileKey(savedProfile) : ''}
            onChange={e => { const next = compatible.find(p => profileKey(p) === e.target.value); if (next) void edit(next.profileId, next.profileVersion) }}>
            <option value="">Seleccionar perfil…</option>{compatible.map(p => <option key={profileKey(p)} value={profileKey(p)}>{profileLabel(p)}</option>)}
          </select></label>
          {profile && <label>Añadir variable<select value="" disabled={busy} onChange={e => {
            const fn = profile.functions.find(f => f.semanticKey === e.target.value)
            if (!fn) return
            try { const row = nuevaFilaFuncion(profile, fn, draft.rows); updateRows(rows => [...rows, row]); setError('') }
            catch (e) { setError(e.message) }
          }}><option value="">Seleccionar variable…</option>
            {profile.functions.filter(fn => fn.direction === 'observation' && fn.interpretationSupport === 'implemented' && fuentesFuncion(profile, fn).length)
              .map(fn => <option key={fn.semanticKey} value={fn.semanticKey}>{nombreFuncion(fn.semanticKey)}</option>)}
          </select></label>}
          <Link className="gp-btn2 chico" to="/panel/funciones">Administrar variables</Link>
        </div>
        <VariablesInstalacion assignmentId={assignmentId} sources={data.items} initialSource={variableSource}/>
        <details className="cf-map-options" onToggle={event => setShowGuide(event.currentTarget.open)}>
          <summary>Guía de instalación</summary>
          {showGuide && <GuiaFunciones protocolFamily={family} assignmentId={assignmentId} current={data} profiles={compatible} onSaved={current.recargar}/>}
        </details>
        {preferencias}
      </>}
    </details>
    {dialogo}
  </section>
}
