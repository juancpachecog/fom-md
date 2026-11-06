import { useRef, useState } from 'react'
import { useDatos } from '../useDatos'
import { Cabecera, Cargando, ErrorCarga } from '../comp/ui'
import { listarDefiniciones, leerDefinicion, historiaDefinicion, guardarDefinicion,
  cuerpoDefinicion, formularioDefinicion, UNIDADES_FUNCIONES } from '../datos/catalogoFunciones'
import './catalogo-funciones.css'

export default function CatalogoFunciones() {
  const [category, setCategory] = useState('all'), [status, setStatus] = useState('all'), [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState(null), [form, setForm] = useState(null), [history, setHistory] = useState(null)
  const [error, setError] = useState(''), [success, setSuccess] = useState(''), [busy, setBusy] = useState(false)
  const lock = useRef(false), pending = useRef(null)
  const data = useDatos(() => listarDefiniciones({ category, status, offset }), [category, status, offset])
  const open = item => { setSelected(item); setForm(formularioDefinicion(item)); setHistory(null); setError(''); setSuccess(''); pending.current = null }
  const change = (key, value) => { setForm(f => ({ ...f, [key]: value })); pending.current = null }
  const save = async event => {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setSuccess('')
    try {
      const body = cuerpoDefinicion(form, selected), fingerprint = JSON.stringify({ id: selected?.id, body })
      if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, token: crypto.randomUUID() }
      const item = await guardarDefinicion(selected?.id, body, pending.current.token)
      setSelected(item); setForm(formularioDefinicion(item)); pending.current = null
      setSuccess('Cambio guardado y comprobado.'); await data.recargar()
    } catch (e) { setError(e.message || 'No se pudo guardar. Comprueba el estado antes de reintentar.') }
    finally { lock.current = false; setBusy(false) }
  }
  const showHistory = async item => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { setHistory({ name: item.name, items: (await historiaDefinicion(item.id)).items }); setForm(null) }
    catch (e) { setError(e.message) } finally { lock.current = false; setBusy(false) }
  }
  const verify = async () => {
    if (!selected || lock.current) return
    lock.current = true; setBusy(true)
    try { open((await leerDefinicion(selected.id)).items[0]); setSuccess('Revisión actual consultada.') }
    catch (e) { setError(e.message) } finally { lock.current = false; setBusy(false) }
  }
  return <div className="pnl-modulo catalogo-funciones">
    <Cabecera titulo="Variables y etiquetas" bajada="Definiciones de la empresa activa para equipos de distintas marcas." />
    <p>Las variables describen señales recibidas. Las etiquetas sirven para organizar. Una definición nueva necesita un mapeo compatible para recibir valores.</p>
    <div className="cf-toolbar">
      <label>Mostrar<select value={category} onChange={e => { setCategory(e.target.value); setOffset(0) }}><option value="all">Variables y etiquetas</option><option value="variable">Variables</option><option value="tag">Etiquetas</option></select></label>
      <label>Estado<select value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}><option value="all">Todos</option><option value="active">Activas</option><option value="retired">Retiradas</option></select></label>
      <button className="pnl-btn pnl-btn--primario" disabled={busy} onClick={() => open(null)}>Crear definición</button>
      <button className="pnl-btn" disabled={busy} onClick={data.recargar}>Actualizar</button>
    </div>
    {error && <p role="alert" className="cf-error">{error}</p>}{success && <p role="status">{success}</p>}
    {data.estado === 'cargando' && <Cargando />}
    {data.error && <ErrorCarga error={data.error} onReintentar={data.recargar} />}
    {data.datos && <><div className="cf-scroll"><table><thead><tr><th>Nombre</th><th>Clave</th><th>Tipo</th><th>Estado</th><th>Revisión</th><th>Acciones</th></tr></thead>
      <tbody>{data.datos.items.map(item => <tr key={item.id}><td>{item.name}</td><td>{item.key}</td><td>{item.category === 'tag' ? 'Etiqueta' : ({ boolean: 'Sí / no', numeric: 'Número', enum: 'Opciones' })[item.definition?.kind]}</td><td>{item.status === 'active' ? 'Activa' : 'Retirada'}</td><td>{item.version}</td><td><button className="pnl-btn" disabled={busy} onClick={() => open(item)}>Editar</button><button className="pnl-btn" disabled={busy} onClick={() => showHistory(item)}>Historial</button></td></tr>)}</tbody></table></div>
      {!data.datos.items.length && <p>No hay definiciones con estos filtros.</p>}
      <div className="cf-toolbar"><button className="pnl-btn" disabled={offset === 0 || busy} onClick={() => setOffset(n => Math.max(0, n - 25))}>Anterior</button><span>{data.datos.total} definiciones</span><button className="pnl-btn" disabled={offset + 25 >= data.datos.total || busy} onClick={() => setOffset(n => n + 25)}>Siguiente</button></div></>}
    {form && <form className="cf-editor" onSubmit={save}>
      <h2>{selected ? `Editar ${selected.name}` : 'Nueva definición'}</h2>
      <fieldset disabled={busy}><div className="cf-grid">
        <label>Clase<select value={form.category} disabled={!!selected} onChange={e => change('category', e.target.value)}><option value="variable">Variable observada</option><option value="tag">Etiqueta administrativa</option></select></label>
        <label>Clave estable<input required maxLength={40} value={form.key} disabled={!!selected} onChange={e => change('key', e.target.value)} placeholder="puerta.carga" /></label>
        <label>Nombre<input required maxLength={100} value={form.name} onChange={e => change('name', e.target.value)} /></label>
        <label>Descripción<textarea maxLength={500} value={form.description} onChange={e => change('description', e.target.value)} /></label>
        {form.category === 'variable' && <>
          <label>Tipo de valor<select disabled={!!selected} value={form.kind} onChange={e => change('kind', e.target.value)}><option value="boolean">Sí / no</option><option value="numeric">Número</option><option value="enum">Lista de opciones</option></select></label>
          <label>Máximo de sensores<input type="number" required min="1" max="32" value={form.maxInstances} onChange={e => change('maxInstances', e.target.value)} /></label>
          {form.kind === 'numeric' && <><label>Unidad<select disabled={!!selected} value={form.unit} onChange={e => change('unit', e.target.value)}>{UNIDADES_FUNCIONES.map(([code, , label]) => <option key={code} value={code}>{label}</option>)}</select></label>
            <label>Mínimo<input type="number" step="any" required value={form.min} onChange={e => change('min', e.target.value)} /></label><label>Máximo<input type="number" step="any" required value={form.max} onChange={e => change('max', e.target.value)} /></label>
            <label>Decimales<input type="number" required min="0" max="9" value={form.precision} onChange={e => change('precision', e.target.value)} /></label></>}
          {form.kind === 'enum' && <label>Opciones separadas por comas<input required value={form.values} onChange={e => change('values', e.target.value)} placeholder="abierta, cerrada, desconocida" /></label>}
        </>}
        {selected && <label>Disponibilidad<select value={form.status} onChange={e => change('status', e.target.value)}><option value="active">Activa</option><option value="retired">Retirada</option></select></label>}
        <label>Motivo del cambio<textarea required minLength={5} maxLength={300} value={form.reason} onChange={e => change('reason', e.target.value)} /></label>
      </div>
      {form.status === 'retired' && <p>Se retirará de las opciones nuevas. Su historial y las referencias existentes se conservan.</p>}
      <button className="pnl-btn pnl-btn--primario" type="submit">{busy ? 'Guardando…' : 'Guardar y comprobar'}</button>
      <button className="pnl-btn" type="button" onClick={() => setForm(null)}>Cancelar</button>
      {selected && <button className="pnl-btn" type="button" onClick={verify}>Comprobar estado actual</button>}
      </fieldset>
    </form>}
    {history && <section className="cf-editor"><h2>Historial de {history.name}</h2><p>Se muestran hasta cincuenta revisiones, de la más reciente a la anterior.</p>
      {history.items.map(item => <article key={item.version}><h3>Revisión {item.version}: {item.name}</h3><p>{item.status === 'active' ? 'Activa' : 'Retirada'} · {new Date(item.recordedAt).toLocaleString()}</p><p>{item.reason}</p></article>)}
    </section>}
  </div>
}
