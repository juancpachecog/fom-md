import { useEffect, useRef, useState } from 'react'
import { pedir } from '../datos/api'
import { apiAutodeteccion, nombreSenal, valorSenal, propuestaDesdePerfil } from '../datos/gpsAutodeteccion'
import { leerPerfilFunciones } from '../datos/funcionesInstalacion'
import { haceCuanto } from '../datos/gps'
import { useConfirmar } from './Confirmar'
import './funciones-detectadas.css'
const api = apiAutodeteccion(pedir)
const fecha = value => value ? new Date(value).toLocaleString('es-VE') : 'Sin lectura'
const variantes = { 'coban.ascii.extended19.v1':'Coban · ASCII extendido', 'coban.ascii.position13.v3':'Coban · Posición básica', 'coban.ascii.state20.v4':'Coban · Posición y entradas', 'coban.ascii.heartbeat':'Conexión periódica', 'coban.ascii.login':'Inicio de conexión', 'coban.ascii.status2023.prefix':'Estado del equipo', 'coban.ascii.unrecognized':'Variante pendiente de interpretar' }

export default function FuncionesDetectadas({ id, imei, draft, alCambiar, editar = true, assignmentId, alAplicar }) {
  const [snapshot, setSnapshot] = useState(null), [profile, setProfile] = useState(null), [saved, setSaved] = useState(null)
  const [loadError,setLoadError] = useState('')
  const [error, setError] = useState(''), [mensaje, setMensaje] = useState(''), [busy, setBusy] = useState(false), [pagina, setPagina] = useState(0)
  const [local, setLocal] = useState(null), [profiles,setProfiles] = useState([])
  const { confirmar, dialogo } = useConfirmar()
  const pending = useRef(null), lock = useRef(false), current = draft ?? local
  const cambiar = value => { pending.current = null; alCambiar ? alCambiar(value) : setLocal(value) }
  useEffect(() => {
    let alive = true, loading = false
    const load = async () => {
      if (loading) return; loading = true
      try { const data = await api.detectar({ id, imei }); if (alive) { setSnapshot(data); setLoadError('') } }
      catch (e) { if (alive) setLoadError(e.message) } finally { loading = false }
    }
    load(); const timer = setInterval(load, 15000)
    return () => { alive = false; clearInterval(timer) }
  }, [id, imei])
  useEffect(() => { if (!id || !editar) return; let alive = true
    api.leer(id).then(data => { if (alive) { setSaved(data); if (data.revision) setLocal({profileId:data.profileId,profileVersion:data.profileVersion,choices:data.choices}) } }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [id, editar])
  useEffect(() => {if(!editar)return;let alive=true
    pedir('/api/v1/console/gps-capability-catalog?manufacturer=Coban&limit=50&offset=0',{empresaContexto:null}).then(data=>{if(alive)setProfiles(data.items.filter(p=>p.protocolFamily==='coban-gps103'))}).catch(()=>{})
    return()=>{alive=false}
  },[editar])
  const elegirPerfil = async event => {const selected=profiles.find(p=>p.profileId+'@'+p.profileVersion===event.target.value);if(!selected)return
    try{const p=await leerPerfilFunciones(selected.profileId,selected.profileVersion);setProfile(p);cambiar(propuestaDesdePerfil(p));setPagina(0)}catch(e){setError(e.message)}
  }
  const desiredId = current?.profileId || saved?.profileId || snapshot?.profileSuggestion?.profileId
  const desiredVersion = current?.profileVersion || saved?.profileVersion || snapshot?.profileSuggestion?.profileVersion
  useEffect(() => { setProfile(null); if (!desiredId || !desiredVersion) return; let alive = true
    leerPerfilFunciones(desiredId, desiredVersion).then(data => { if (alive) setProfile(data) }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [desiredId, desiredVersion])
  const selection = profile ? propuestaDesdePerfil(profile,current) : current
  const choices = selection?.choices ?? []
  const savedSelection = profile && saved ? propuestaDesdePerfil(profile,saved) : null
  const cambiosSinGuardar = !!savedSelection && (saved.profileId !== selection.profileId || saved.profileVersion !== selection.profileVersion || JSON.stringify(selection) !== JSON.stringify(savedSelection))
  const signals = snapshot?.signals ?? [], paginas = Math.max(1, Math.ceil(choices.length / 4)), actual = Math.min(pagina, paginas - 1)
  const save = async () => {
    if (lock.current || !selection || !saved) return
    if (!await confirmar({ titulo:'Guardar funciones del GPS', texto:'Se guardará tu selección para este equipo. Las comprobaciones de cableado y sensores se realizan en la instalación.', accion:'Guardar selección' })) return
    lock.current = true; setBusy(true); setError(''); setMensaje('')
    try {
      const body = {...selection,expectedVersion:saved.revision,reason:'Selección de funciones revisada por el operador'}
      const fingerprint = JSON.stringify(body)
      if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = {fingerprint,token:crypto.randomUUID()}
      const result = await api.guardar(id,body,pending.current.token)
      setSaved(result); pending.current = null; setMensaje('Selección guardada y consultada aparte.')
    } catch (e) { setError(e.message) } finally { lock.current = false; setBusy(false) }
  }
  const apply = async () => {
    if (lock.current || !saved?.revision || !assignmentId) return
    if (!await confirmar({titulo:'Usar funciones en esta instalación',texto:'Se aplicará la selección guardada a este montaje nuevo. Los sensores quedarán pendientes de comprobar. Si ya existe una configuración, revísala en su editor.',accion:'Aplicar selección'})) return
    lock.current = true; setBusy(true); setError(''); setMensaje('')
    try {
      const body = {assignmentId,preferenceRevision:saved.revision,expectedInstallationVersion:0}, fingerprint = JSON.stringify(body)
      if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = {fingerprint,token:crypto.randomUUID()}
      await api.aplicar(id,body,pending.current.token); pending.current = null; setMensaje('Funciones aplicadas. Completa las pruebas en el editor de la instalación.'); alAplicar?.()
    } catch(e) { setError(e.message) } finally {lock.current=false;setBusy(false)}
  }
  return <section className="gp-auto" aria-label="Funciones detectadas del GPS">
    {error && <p className="gp-error" role="alert">{error}</p>}
    {loadError && <p className="gp-error" role="alert">{loadError} {snapshot && 'Las lecturas anteriores no confirman el estado actual.'}</p>}
    {!snapshot && !loadError && <p className="gp-hint" role="status">Analizando las tramas recibidas…</p>}
    {snapshot && <>
      <div className="gp-auto-status"><span><i className={snapshot.communicationFresh && !loadError ? 'live' : ''} />Comunicación <b>{haceCuanto(snapshot.lastCommunicationAt)}</b></span><span><i className={snapshot.positionFresh && !loadError ? 'live' : ''} />Posición recibida <b>{haceCuanto(snapshot.lastPositionAt)}</b></span></div>
      <p className="gp-hint">{snapshot.variants.filter(v => /extended19|position13|state20|unrecognized/.test(v.id)).map(v => variantes[v.id] || 'Variante pendiente').join(' · ') || 'Aún sin tramas de posición reconocidas'} · Firmware sin identificar</p>
      {snapshot.settings && <div className="gp-auto-settings"><span>Alarma armada: <b>{snapshot.settings.armed ? 'ON' : 'OFF'}</b></span><span>Intervalo: <b>{snapshot.settings.motionIntervalSeconds}s / {snapshot.settings.stationaryIntervalSeconds}s</b></span><small>Reportado {haceCuanto(snapshot.settings.receivedAt)}{snapshot.settings.freshness === 'stale' ? ' · lectura antigua' : ''}</small></div>}
      {snapshot.warnings.includes('position_reporting_disabled') && <p className="gp-aviso">El último estado recibido indicaba reportes de posición desactivados. Revisa la configuración del equipo.</p>}
    </>}
    {editar && profiles.length > 1 && <label className="gp-auto-profile"><span>Tipo de lectura</span><select value={desiredId ? desiredId+'@'+desiredVersion : ''} onChange={elegirPerfil} disabled={busy}><option value="">Revisar perfil…</option>{profiles.map(p=><option key={p.profileId+'@'+p.profileVersion} value={p.profileId+'@'+p.profileVersion}>{p.profileId==='coban.ascii.extended19'?'ASCII extendido':p.profileVersion===2?'Posición y entradas':'Posición básica'}</option>)}</select></label>}
    {selection && <>
      <div className="gp-auto-heading"><b>Funciones del dispositivo</b>{editar && <button type="button" className="gp-btn2 chico" disabled={busy || !!loadError} onClick={() => cambiar({...selection,choices:choices.map(c => ({...c,selected:signals.some(s => s.key === c.semanticKey && s.quality === 'valid' && s.freshness === 'fresh' && s.interpretation === 'implemented')}))})}>Seleccionar observadas</button>}</div>
      <div className="gp-auto-functions">{choices.slice(actual*4,(actual+1)*4).map((choice,index) => {const signal = signals.find(s => s.key === choice.semanticKey);return <label className="gp-auto-function" key={choice.semanticKey}>
        {editar && <input type="checkbox" checked={choice.selected} disabled={busy} onChange={e => cambiar({...selection,choices:choices.map((c,i) => i === actual*4+index ? {...c,selected:e.target.checked} : c)})} />}
        <span><b>{nombreSenal(choice.semanticKey)}</b><small>{signal ? signal.quality === 'contradictory' ? 'Lectura contradictoria' : loadError || signal.freshness === 'stale' ? 'Observada · lectura anterior' : 'Observada' : 'Compatible · sin muestra'} · Comprobación pendiente</small></span><span className="gp-auto-value" title={signal ? fecha(signal.receivedAt) : undefined}>{signal ? valorSenal(signal) : 'Sin lectura'}{signal && <small>{haceCuanto(signal.receivedAt)}</small>}</span>
      </label>})}</div>
      {paginas > 1 && <div className="gp-discovery-pagination"><button type="button" className="gp-btn2 chico" disabled={!actual} onClick={() => setPagina(actual-1)}>Anterior</button><span>{actual+1} / {paginas}</span><button type="button" className="gp-btn2 chico" disabled={actual+1>=paginas} onClick={() => setPagina(actual+1)}>Siguiente</button></div>}
      <p className="gp-hint">{choices.filter(c => c.selected).length} seleccionadas · ACC no confirma que el motor esté girando. Los valores describen lo que reportó el equipo.</p>
    </>}
    {(signals.some(s => s.interpretation === 'unit_pending') || snapshot?.settings) && <details className="gp-auto-more"><summary>Más lecturas y estado</summary>
      {signals.filter(s => s.interpretation === 'unit_pending').map(s => <p className="gp-hint" key={s.key}>{nombreSenal(s.key)}: {valorSenal(s)}</p>)}
      {snapshot?.settings && <dl className="gp-discovery-facts">{[
        ['Modo de sueño',({0:'En línea',1:'Inteligente',2:'Ahorro'})[snapshot.settings.sleepMode] ?? 'Sin lectura'],
        ['Alarma de vibración',typeof snapshot.settings.shockAlarmEnabled === 'boolean' ? snapshot.settings.shockAlarmEnabled ? 'ON' : 'OFF' : 'Sin lectura'],
        ['Alarma de batería baja',typeof snapshot.settings.lowBatteryAlarmEnabled === 'boolean' ? snapshot.settings.lowBatteryAlarmEnabled ? 'ON' : 'OFF' : 'Sin lectura'],
        ['Zona horaria reportada',typeof snapshot.settings.timezoneOffsetHours === 'number' ? 'UTC'+(snapshot.settings.timezoneOffsetHours>=0?'+':'')+snapshot.settings.timezoneOffsetHours : 'Sin lectura'],
      ].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
    </details>}
    {snapshot && !selection && <p className="gp-hint">Todavía no hay un perfil inequívoco de funciones para estas tramas. Puedes registrar el equipo y revisarlo desde su ficha.</p>}
    {id && editar && <div className="gp-auto-actions"><button type="button" className="gp-btn chico" disabled={busy || !selection || !saved} onClick={save}>{busy ? 'Comprobando…' : 'Guardar selección'}</button>{assignmentId && saved?.revision > 0 && <button type="button" className="gp-btn2 chico" disabled={busy || cambiosSinGuardar} onClick={apply}>Usar en esta instalación</button>}</div>}
    {id && cambiosSinGuardar && <p className="gp-hint">Guarda los cambios antes de aplicarlos a la instalación.</p>}
    {mensaje && <p className="gp-aviso" role="status">{mensaje}</p>}{dialogo}
  </section>
}
