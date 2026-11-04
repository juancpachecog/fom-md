import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { Cabecera, Cargando, ErrorCarga } from '../comp/ui'
import { useConfirmar } from '../comp/Confirmar'
import { textoDeError } from '../datos/responsableEmpresa'
import { candidatosCiclo, claveCiclo, crearConjuntoPrueba, estadoCiclo, leerCiclo, limpiarPruebas, marcarPrueba,
  registrarRetencion, retirarRegistro, revisarLimpieza, revisarRetirada, TIPOS_CICLO, versionActual } from '../datos/cicloDatos'
import './ciclo-datos.css'

export default function AdminCicloDatos() {
  const [params] = useSearchParams()
  const [empresaId, setEmpresaId] = useState(params.get('empresa') || '')
  const [tipo, setTipo] = useState('all'), [q, setQ] = useState(''), [offset, setOffset] = useState(0)
  const [seleccion, setSeleccion] = useState([]), [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false), [aviso, setAviso] = useState(''), [exito, setExito] = useState('')
  const [conjuntoId, setConjuntoId] = useState(''), [plan, setPlan] = useState(null)
  const [confirmarPruebas, setConfirmarPruebas] = useState(false), [frase, setFrase] = useState('')
  const [meses, setMeses] = useState(6)
  const llaves = useRef(new Map())
  const ocupacion = useRef(false)
  const { confirmar, dialogo } = useConfirmar()
  const empresas = useDatos(() => repo.admin.empresas.listar({}), [])
  const ciclo = useDatos(() => empresaId ? leerCiclo(empresaId) : Promise.resolve(null), [empresaId])
  const candidatos = useDatos(() => empresaId ? candidatosCiclo(empresaId, { tipo, q, offset }) : Promise.resolve({ items: [], total: 0 }), [empresaId, tipo, q, offset])
  const lista = candidatos.datos?.items ?? []
  const conjuntos = ciclo.datos?.testSets ?? []
  const empresa = empresas.datos?.find(e => e.id === empresaId)
  const politica = versionActual(ciclo.datos?.policies, 'canonical_telemetry')
  const motivoValido = motivo.trim().length >= 2 && motivo.trim().length <= 500
  const elegidos = useMemo(() => new Set(seleccion.map(claveCiclo)), [seleccion])

  useEffect(() => { setSeleccion([]); setConjuntoId(''); setPlan(null); setFrase(''); setOffset(0); setAviso(''); setExito(''); setConfirmarPruebas(false) }, [empresaId])
  useEffect(() => { setOffset(0) }, [tipo, q])
  useEffect(() => { setPlan(null); setFrase('') }, [conjuntoId])
  const llave = (command) => {
    if (!llaves.current.has(command)) llaves.current.set(command, crypto.randomUUID())
    return llaves.current.get(command)
  }
  const hacer = async (fn, mensaje) => {
    if (ocupacion.current) return
    ocupacion.current = true
    setOcupado(true); setAviso(''); setExito('')
    try { const resultado = await fn(); if (resultado === false) return; setExito(mensaje); await Promise.all([ciclo.recargar(), candidatos.recargar()]) }
    catch (error) { setAviso(textoDeError(error)) }
    finally { ocupacion.current = false; setOcupado(false) }
  }
  const elegir = item => setSeleccion(actual => elegidos.has(claveCiclo(item)) ? actual.filter(x => claveCiclo(x) !== claveCiclo(item)) : [...actual, item])
  const retirar = async (item) => {
    if (!motivoValido || ocupado) return
    await hacer(async () => {
      const previo = await revisarRetirada(empresaId, item)
      if (!previo.canRetire) throw new Error(previo.message || 'Resuelve las dependencias indicadas antes de retirar este registro.')
      if (!await confirmar({ titulo: `Retirar ${TIPOS_CICLO[item.type].toLowerCase()}`,
        texto: `${item.label} dejará de estar en uso. Su historial se conservará hasta el vencimiento correspondiente. ${previo.message || ''}`,
        accion: 'Retirar del uso', peligro: true })) return false
      await retirarRegistro(empresaId, item, motivo.trim(), llave(`retire:${empresaId}:${claveCiclo(item)}:${item.status}:${motivo.trim()}`))
      setPlan(null)
    }, 'Solicitud de retirada procesada. El historial se conserva.')
  }
  const acreditar = () => hacer(async () => {
    if (!confirmarPruebas || !seleccion.length || !motivoValido) throw new Error('Selecciona registros, acredita que son pruebas y escribe el motivo.')
    const command = JSON.stringify([empresaId, seleccion.map(claveCiclo).sort(), motivo.trim()])
    const creado = conjuntoId ? { id: conjuntoId } : await crearConjuntoPrueba(empresaId, motivo.trim(), llave(`set:${command}`))
    setConjuntoId(creado.id)
    // Si una marca falla, las anteriores se conservan y el reintento usa el mismo conjunto.
    for (const item of seleccion) await marcarPrueba(creado.id, item, motivo.trim())
    setSeleccion([])
    setPlan(null)
  }, 'Procedencia registrada. Revisa el impacto antes de eliminar.')
  const revisar = () => hacer(async () => { setPlan(await revisarLimpieza(conjuntoId)) }, 'Impacto consultado; todavía no se ha eliminado nada.')
  const limpiar = () => hacer(async () => {
    if (!plan?.canDelete || frase !== 'ELIMINAR PRUEBAS') throw new Error('Revisa el plan y escribe la confirmación completa.')
    await limpiarPruebas(conjuntoId, { planId: plan.planId, confirmation: frase }, llave(`cleanup:${plan.planId}`))
    setPlan(null); setFrase('')
  }, 'Limpieza completada. Consulta el recibo y los registros restantes.')
  const guardarPolitica = () => hacer(async () => {
    if (!motivoValido) throw new Error('Escribe el motivo de la política.')
    const cambios = ['raw_ingress', 'canonical_telemetry'].map(family => ({ family, calendarMonths: Number(meses),
      expectedVersion: versionActual(ciclo.datos?.policies, family)?.version ?? 0, reason: motivo.trim() }))
    if (!await confirmar({ titulo: 'Guardar retención', texto: `Se registrarán ${meses} meses para la telemetría de ${empresa?.nombre}. La política no elimina registros al guardar.`, accion: 'Guardar política', peligro: Number(meses) < (politica?.calendarMonths ?? 6) })) return false
    for (const cambio of cambios) await registrarRetencion(empresaId, cambio)
    setPlan(null)
  }, 'Política registrada. Guardar no ejecuta una limpieza.')

  return <div className="pnl-modulo ciclo-datos">
    <Cabecera titulo="Retirada y limpieza de datos" bajada="Retira registros del uso y elimina pruebas acreditadas tras revisar su impacto." />
    {aviso && <p role="alert" className="ciclo-error">{aviso}</p>}
    {exito && <p role="status">{exito}</p>}
    {empresas.estado === 'error' ? <ErrorCarga error={empresas.error} onReintentar={empresas.recargar} /> : <label className="ciclo-campo">Empresa
      <select value={empresaId} disabled={ocupado} onChange={e => setEmpresaId(e.target.value)}><option value="">Selecciona una empresa</option>
        {(empresas.datos ?? []).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}</select></label>}
    {empresaId && <>
      <label className="ciclo-campo">Motivo de la operación<textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500} disabled={ocupado} placeholder="Describe la retirada o la procedencia de estas pruebas." /></label>
      <section className="ciclo-seccion"><h2>Registros de la empresa</h2><p>Retirar conserva el historial. Marcar una prueba no la elimina.</p>
        <div className="ciclo-filtros"><label>Tipo<select value={tipo} disabled={ocupado} onChange={e => setTipo(e.target.value)}><option value="all">Todos</option>{Object.entries(TIPOS_CICLO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Buscar<input value={q} maxLength={100} disabled={ocupado} onChange={e => setQ(e.target.value)} /></label></div>
        {candidatos.estado === 'error' ? <ErrorCarga error={candidatos.error} onReintentar={candidatos.recargar} /> : candidatos.estado === 'cargando' ? <Cargando /> : <>
          <div className="ciclo-tabla"><table><thead><tr><th>Prueba</th><th>Tipo</th><th>Registro</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{lista.map(item => <tr key={claveCiclo(item)}>
            <td><input type="checkbox" aria-label={`Marcar ${item.label} como prueba`} disabled={ocupado} checked={elegidos.has(claveCiclo(item))} onChange={() => elegir(item)} /></td>
            <td>{TIPOS_CICLO[item.type]}</td><td>{item.label}</td><td>{estadoCiclo(item.status)}</td><td><button type="button" className="pnl-btn sutil" disabled={ocupado || !motivoValido || ['archived','revoked'].includes(item.status)} onClick={() => retirar(item)}>Retirar</button></td></tr>)}</tbody></table></div>
          {!lista.length && <p>No hay registros que coincidan.</p>}<div className="ciclo-filtros"><button className="pnl-btn sutil" disabled={ocupado || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Anterior</button><span>{candidatos.datos?.total ?? 0} registros</span><button className="pnl-btn sutil" disabled={ocupado || offset + lista.length >= (candidatos.datos?.total ?? 0)} onClick={() => setOffset(offset + 50)}>Siguiente</button></div>
        </>}
        <label className="ciclo-check"><input type="checkbox" checked={confirmarPruebas} disabled={ocupado} onChange={e => setConfirmarPruebas(e.target.checked)} />Confirmo que los {seleccion.length} registros seleccionados son pruebas desechables. No contienen operación real que deba conservarse.</label>
        <button type="button" className="pnl-btn" disabled={ocupado || ciclo.estado !== 'ok' || !seleccion.length || !motivoValido || !confirmarPruebas} onClick={acreditar}>{conjuntoId ? 'Agregar pruebas al conjunto seleccionado' : 'Acreditar conjunto de pruebas'}</button>
      </section>
      <section className="ciclo-seccion"><h2>Limpieza definitiva de pruebas</h2><p>Las relaciones compartidas y los datos sin procedencia demostrada pueden bloquear la limpieza.</p>
        {ciclo.estado === 'error' ? <ErrorCarga error={ciclo.error} onReintentar={ciclo.recargar} /> : <><label className="ciclo-campo">Conjunto<select value={conjuntoId} disabled={ocupado} onChange={e => setConjuntoId(e.target.value)}><option value="">Selecciona un conjunto</option>{conjuntos.map(s => <option key={s.id} value={s.id}>{s.reason} · {s.entities.length} registros</option>)}</select></label>
          <button className="pnl-btn" disabled={ocupado || !conjuntoId} onClick={revisar}>Revisar impacto</button></>}
        {plan && <div className="ciclo-plan"><p>{plan.message}</p>{(plan.counts ?? []).map(c => <p key={c.family}>{c.label || c.family}: {c.count}</p>)}{(plan.blockers ?? []).map((b, i) => <p key={i} role="alert">{b.message || b}</p>)}
          {plan.canDelete && <><label className="ciclo-campo">Escribe ELIMINAR PRUEBAS<input value={frase} disabled={ocupado} onChange={e => setFrase(e.target.value)} autoComplete="off" /></label><button className="pnl-btn peligro" disabled={ocupado || frase !== 'ELIMINAR PRUEBAS'} onClick={limpiar}>Eliminar definitivamente las pruebas del plan</button></>}
        </div>}
      </section>
      <section className="ciclo-seccion"><h2>Retención de telemetría</h2><p>Inicialmente seis meses. Aumentar el plazo no recupera datos ya expirados. Los pagos, documentos y la auditoría tienen reglas propias.</p>
        <p>{politica ? `Última política registrada: ${politica.calendarMonths} meses.` : 'Todavía no hay una política registrada para esta empresa.'}</p>
        <label className="ciclo-campo">Meses<select value={meses} disabled={ocupado} onChange={e => setMeses(Number(e.target.value))}><option value={6}>6 meses</option>{politica && <option value={3}>3 meses</option>}</select></label>
        <button type="button" className="pnl-btn" disabled={ocupado || !motivoValido || ciclo.estado !== 'ok'} onClick={guardarPolitica}>Guardar política</button>
      </section>
    </>}
    {dialogo}
  </div>
}
