import { useEffect, useState } from 'react'
import { ErrorCarga } from '../comp/ui'
import { useDatos } from '../useDatos'
import { expirarTelemetria, historialExpiracion, leerReciboLimpieza, revisarExpiracion } from '../datos/cicloDatos'

const trabajando = recibo => ['queued', 'running'].includes(recibo?.status)
const fecha = valor => Number.isFinite(Date.parse(valor)) ? new Date(valor).toLocaleString('es-VE') : 'No disponible'

export default function ExpiracionTelemetria({ empresaId, deshabilitado, ocupado, hacer, familia, avisar, informar, alTrabajar, politicaVersion }) {
  const [tipo, setTipo] = useState('raw_ingress'), [cursor, setCursor] = useState('0')
  const [plan, setPlan] = useState(null), [frase, setFrase] = useState('')
  const [pendiente, setPendiente] = useState(''), [recibo, setRecibo] = useState(null)
  const historial = useDatos(() => historialExpiracion(empresaId), [empresaId])
  const enTrabajo = trabajando(recibo)
  useEffect(() => { setPlan(null); setFrase(''); setCursor('0') }, [tipo, politicaVersion])
  useEffect(() => { alTrabajar(enTrabajo); return () => alTrabajar(false) }, [enTrabajo, alTrabajar])

  const observar = valor => {
    setRecibo(valor)
    if (valor.status === 'verified' && valor.remaining === 0) {
      setPlan(null); setFrase(''); informar('Expiración verificada mediante una consulta independiente.'); historial.recargar()
    } else if (valor.status === 'blocked') avisar('El servidor conservó el grupo: cambió el plan, la autorización o una dependencia. Revisa un plan nuevo.')
    else if (valor.status === 'changed') avisar('El estado actual no acredita la ausencia completa del grupo. Revisa el comprobante.')
  }
  useEffect(() => {
    if (!pendiente || !enTrabajo) return
    let vigente = true, timer, errores = 0
    const limite = Date.now() + 5 * 60_000
    const consultar = async () => {
      if (!vigente) return
      if (Date.now() >= limite) { avisar('El trabajo puede continuar en el servidor. Usa Comprobar expiración.'); return }
      if (document.visibilityState === 'hidden') { timer = setTimeout(consultar, 2_000); return }
      try {
        const valor = await leerReciboLimpieza(pendiente)
        if (!vigente) return
        errores = 0; observar(valor)
        if (trabajando(valor)) timer = setTimeout(consultar, 2_000)
      } catch (error) {
        if (!vigente) return
        avisar('No se pudo consultar la expiración. El trabajo puede continuar; comprueba su resultado antes de otra solicitud.')
        if (++errores < 3 && ![401, 403].includes(error.estado)) timer = setTimeout(consultar, 2_000)
      }
    }
    timer = setTimeout(consultar, 2_000)
    return () => { vigente = false; clearTimeout(timer) }
  }, [pendiente, enTrabajo])

  const revisar = () => hacer(async () => {
    setPlan(null); setFrase('')
    setPlan(await revisarExpiracion(empresaId, tipo, cursor))
  }, 'Impacto de la retención consultado. No se ha eliminado ningún registro.')
  const ejecutar = () => hacer(async () => {
    if (!plan?.canDelete || frase !== 'EXPIRAR TELEMETRIA' || !Number.isFinite(Date.parse(plan.expiresAt)) || Date.parse(plan.expiresAt) <= Date.now()) {
      throw new Error('Revisa un plan vigente y escribe la confirmación completa.')
    }
    setPendiente(plan.planId)
    let fallo
    try { await expirarTelemetria(empresaId, { planId: plan.planId, confirmation: frase }) }
    catch (error) { fallo = error }
    let valor
    try { valor = await leerReciboLimpieza(plan.planId) }
    catch (error) { throw fallo || error }
    observar(valor); setFrase(''); await historial.recargar()
    if (trabajando(valor)) return 'Solicitud de expiración guardada. Su resultado se comprobará aparte.'
    if (valor.status !== 'verified' || valor.remaining !== 0) throw new Error('La expiración no quedó verificada. Consulta el resultado antes de otra solicitud.')
  }, 'Expiración verificada mediante una consulta independiente.')
  const comprobar = id => hacer(async () => {
    setPendiente(id)
    const valor = await leerReciboLimpieza(id); observar(valor)
    if (trabajando(valor)) return 'La expiración sigue en cola o en ejecución.'
    if (valor.status !== 'verified' || valor.remaining !== 0) return 'Consulta el estado y las dependencias antes de preparar otra solicitud.'
  }, 'Expiración verificada mediante una consulta independiente.')

  return <section className="ciclo-seccion" aria-label="Expiración de telemetría">
    <h2>Aplicar retención a datos vencidos</h2>
    <p>Revisa cada grupo completo antes de eliminarlo. El corte usa la antigüedad registrada por el servidor. Las referencias vigentes y las reservas de conservación protegen sus datos.</p>
    <label className="ciclo-campo">Familia de telemetría<select value={tipo} disabled={ocupado || enTrabajo} onChange={e => setTipo(e.target.value)}>
      <option value="raw_ingress">Ingreso crudo</option><option value="canonical_telemetry">Telemetría canónica</option>
    </select></label>
    <button className="pnl-btn" disabled={ocupado || deshabilitado || enTrabajo} onClick={revisar}>Revisar datos vencidos</button>
    {plan && <div className="ciclo-plan">
      <p>Política: {plan.policy?.calendarMonths} meses · versión {plan.policy?.version}. Datos anteriores a {fecha(plan.policy?.cutoffExclusive)} (hora local).</p>
      <p>Consulta: {fecha(plan.asOf)}. Plan válido hasta {fecha(plan.expiresAt)}.</p>
      {(plan.counts ?? []).map(c => <p key={c.family}>{familia(c.family)}: {c.count}</p>)}
      {(plan.blockers ?? []).map((b, i) => <p role="alert" key={i}>{familia(b.family)}: {b.reason || 'Resuelve las dependencias antes de continuar.'}</p>)}
      {plan.executionEnabled === false && <p role="alert">La expiración aún no está habilitada en este entorno.</p>}
      {plan.canDelete && <><p>Se eliminará el grupo de la base activa. Copia privada de recuperación durante {plan.recoveryDays} días.</p>
        <label className="ciclo-campo">Escribe EXPIRAR TELEMETRIA<input value={frase} autoComplete="off" disabled={ocupado || enTrabajo} onChange={e => setFrase(e.target.value)} /></label>
        <button className="pnl-btn peligro" disabled={ocupado || deshabilitado || enTrabajo || frase !== 'EXPIRAR TELEMETRIA'} onClick={ejecutar}>Expirar el grupo del plan</button></>}
      {plan.nextCursor && <button className="pnl-btn sutil" disabled={ocupado || enTrabajo} onClick={() => { setCursor(plan.nextCursor); setPlan(null); setFrase('') }}>Continuar con otro grupo</button>}
    </div>}
    {pendiente && <button className="pnl-btn sutil" disabled={ocupado} onClick={() => comprobar(pendiente)}>Comprobar expiración</button>}
    {recibo && <div className="ciclo-plan" aria-label="Comprobante de expiración">
      <p>{enTrabajo ? 'En cola o ejecución' : recibo.status === 'verified' && recibo.remaining === 0 ? 'Expiración verificada' : 'Expiración pendiente de resolver'}</p>
      <p>Registros presentes: {recibo.remaining ?? 'Pendiente de comprobar'} · Completada: {recibo.completedAt ? fecha(recibo.completedAt) : 'Pendiente'}.</p>
      {(recibo.counts ?? []).map(c => <p key={c.family}>{familia(c.family)}: {c.count}</p>)}
    </div>}
    <h3>Solicitudes recientes</h3>
    {historial.estado === 'error' ? <ErrorCarga error={historial.error} onReintentar={historial.recargar} /> : <>
      {(historial.datos?.items ?? []).filter(item => item.status !== 'planned').map(item => <p key={item.planId}>
        {item.family === 'raw_ingress' ? 'Ingreso crudo' : 'Telemetría canónica'} · {fecha(item.createdAt)}
        {' '}<button className="pnl-btn sutil" disabled={ocupado || enTrabajo} onClick={() => comprobar(item.planId)}>Consultar solicitud</button>
      </p>)}
      {historial.estado === 'ok' && !(historial.datos?.items ?? []).some(item => item.status !== 'planned') && <p>No hay solicitudes de expiración en este ámbito.</p>}
    </>}
  </section>
}
