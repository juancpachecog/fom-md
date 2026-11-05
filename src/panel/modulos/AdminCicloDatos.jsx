import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { Cabecera, Cargando, ErrorCarga } from '../comp/ui'
import { useConfirmar } from '../comp/Confirmar'
import { textoDeError } from '../datos/responsableEmpresa'
import { candidatosCiclo, claveCiclo, crearConjuntoPrueba, estadoCiclo, guardarRetencionVerificada, leerCiclo, leerReciboLimpieza, limpiarPruebas, marcarPrueba,
  retirarRegistro, revisarLimpieza, revisarRetirada, TIPOS_CICLO, versionActual } from '../datos/cicloDatos'
import ExpiracionTelemetria from './ExpiracionTelemetria'
import './ciclo-datos.css'

export default function AdminCicloDatos() {
  const [params] = useSearchParams()
  const [empresaId, setEmpresaId] = useState(params.get('empresa') || '')
  const [tipo, setTipo] = useState('all'), [q, setQ] = useState(''), [offset, setOffset] = useState(0)
  const [seleccion, setSeleccion] = useState([]), [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false), [aviso, setAviso] = useState(''), [exito, setExito] = useState('')
  const [conjuntoId, setConjuntoId] = useState(''), [plan, setPlan] = useState(null)
  const [recibo, setRecibo] = useState(null), [planPendiente, setPlanPendiente] = useState('')
  const [confirmarPruebas, setConfirmarPruebas] = useState(false), [frase, setFrase] = useState('')
  const [meses, setMeses] = useState(6)
  const [expirando, setExpirando] = useState(false)
  const llaves = useRef(new Map())
  const ocupacion = useRef(false)
  const { confirmar, dialogo } = useConfirmar()
  const empresas = useDatos(() => repo.admin.empresas.listar({}), [])
  const historicos = useDatos(() => leerCiclo('global'), [])
  const ciclo = useDatos(() => empresaId ? leerCiclo(empresaId) : Promise.resolve(null), [empresaId])
  const candidatos = useDatos(() => empresaId ? candidatosCiclo(empresaId, { tipo, q, offset }) : Promise.resolve({ items: [], total: 0 }), [empresaId, tipo, q, offset])
  const lista = candidatos.datos?.items ?? []
  const conjuntos = ciclo.datos?.testSets ?? []
  const conjunto = conjuntos.find(s => s.id === conjuntoId)
  const enTrabajo = ['queued', 'running'].includes(recibo?.status)
  const accionesBloqueadas = enTrabajo || expirando
  const empresa = empresas.datos?.find(e => e.id === empresaId)
  const ambitosHistoricos = (historicos.datos?.historicalScopes ?? []).filter(h => !(empresas.datos ?? []).some(e => e.id === h.id))
  const soloHistorico = ciclo.datos?.historicalOnly === true
  const nombreAmbito = empresaId === 'global' ? 'inventario global y usuarios sin empresa' : empresa?.nombre
  const familiasRetencion = ['raw_ingress', 'canonical_telemetry']
  const inicialCompleta = familiasRetencion.every(family => versionActual(ciclo.datos?.policies, family))
  const motivoValido = motivo.trim().length >= 2 && motivo.trim().length <= 500
  const elegidos = useMemo(() => new Set(seleccion.map(claveCiclo)), [seleccion])

  useEffect(() => { setSeleccion([]); setConjuntoId(''); setPlan(null); setFrase(''); setOffset(0); setAviso(''); setExito(''); setConfirmarPruebas(false); setRecibo(null); setPlanPendiente(''); setMeses(6) }, [empresaId])
  useEffect(() => { setOffset(0) }, [tipo, q])
  useEffect(() => { setPlan(null); setFrase(''); setRecibo(null); setPlanPendiente('') }, [conjuntoId])
  useEffect(() => {
    const anterior = conjunto?.cleanupPlanId
    if (!anterior) return
    let vigente = true
    setPlanPendiente(anterior)
    leerReciboLimpieza(anterior).then(valor => { if (vigente) setRecibo(valor) })
      .catch(error => { if (vigente) setAviso(textoDeError(error)) })
    return () => { vigente = false }
  }, [conjuntoId, conjunto?.cleanupPlanId])
  useEffect(() => {
    if (!planPendiente || !['queued', 'running'].includes(recibo?.status)) return
    let vigente = true, temporizador, fallos = 0
    const limite = Date.now() + 5 * 60_000
    const programar = () => { if (vigente) temporizador = setTimeout(consultar, 2_000) }
    const consultar = async () => {
      if (!vigente) return
      if (Date.now() >= limite) { setAviso('El trabajo puede continuar en el servidor. Puedes comprobar su resultado cuando quieras.'); return }
      if (document.visibilityState === 'hidden') { programar(); return }
      try {
        const valor = await leerReciboLimpieza(planPendiente)
        if (!vigente) return
        fallos = 0; setRecibo(valor)
        if (valor.status === 'verified' && valor.remaining === 0) {
          setPlan(null); setFrase(''); setExito('Limpieza verificada mediante una consulta independiente.')
          await Promise.all([ciclo.recargar(), candidatos.recargar(), empresas.recargar(), historicos.recargar()])
        } else if (valor.status === 'blocked') setAviso(falloTrabajo(valor.failureCode))
        else if (valor.status === 'changed') setAviso('El estado actual cambió. Revisa el comprobante antes de otra acción.')
        else if (['queued', 'running'].includes(valor.status)) programar()
      } catch (error) {
        if (!vigente) return
        setAviso('No se pudo consultar el avance; el trabajo puede continuar. Usa Comprobar resultado.')
        if (++fallos < 3 && ![401, 403].includes(error.estado)) programar()
      }
    }
    programar()
    return () => { vigente = false; clearTimeout(temporizador) }
  }, [empresaId, conjuntoId, planPendiente, recibo?.status])
  const llave = (command) => {
    if (!llaves.current.has(command)) llaves.current.set(command, crypto.randomUUID())
    return llaves.current.get(command)
  }
  const hacer = async (fn, mensaje) => {
    if (ocupacion.current) return
    ocupacion.current = true
    setOcupado(true); setAviso(''); setExito('')
    try { const resultado = await fn(); if (resultado === false) return; setExito(typeof resultado === 'string' ? resultado : mensaje); await Promise.all([ciclo.recargar(), candidatos.recargar(), empresas.recargar(), historicos.recargar()]) }
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
    const existentes = conjuntos.find(s => s.id === conjuntoId)?.entities ?? []
    const total = new Set([...existentes.map(e => `${e.type}:${e.id}`), ...seleccion.map(claveCiclo)]).size
    if (total > 100) throw new Error('Cada conjunto admite hasta 100 registros. Divide la limpieza en conjuntos más pequeños.')
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
    if (!Number.isFinite(Date.parse(plan.expiresAt))) throw new Error('No se pudo validar el plan. Revisa nuevamente su impacto.')
    setPlanPendiente(plan.planId)
    let fallo
    try { await limpiarPruebas(conjuntoId, { planId: plan.planId, confirmation: frase }, llave(`cleanup:${plan.planId}`)) }
    catch (error) { fallo = error }
    // Si se pierde la respuesta, consultar antes de ofrecer otro intento.
    // El recibo se obtiene mediante una lectura independiente del POST.
    let comprobado
    try { comprobado = await leerReciboLimpieza(plan.planId) }
    catch (error) { throw fallo || error }
    setRecibo(comprobado)
    if (['queued', 'running'].includes(comprobado.status)) {
      setFrase('')
      return 'Solicitud guardada. El servidor ejecutará el trabajo y conservará su resultado aunque salgas de esta pantalla.'
    }
    if (comprobado.status === 'blocked') throw new Error(falloTrabajo(comprobado.failureCode))
    if (comprobado.status !== 'verified' || comprobado.remaining !== 0) throw new Error('El estado actual no acredita la limpieza completa. Revisa el comprobante.')
    setPlan(null); setFrase('')
  }, 'Limpieza verificada mediante una consulta independiente.')
  const comprobar = () => hacer(async () => {
    const comprobado = await leerReciboLimpieza(planPendiente)
    setRecibo(comprobado)
    if (['queued', 'running'].includes(comprobado.status)) return 'La solicitud sigue en cola o en ejecución; todavía no se acredita la limpieza.'
    if (comprobado.status === 'blocked') throw new Error(falloTrabajo(comprobado.failureCode))
    if (comprobado.status !== 'verified' || comprobado.remaining !== 0) throw new Error('El estado actual cambió; el comprobante muestra registros presentes.')
  }, 'El comprobante confirma que los registros del plan ya no están en la base activa.')
  const guardarPolitica = () => hacer(async () => {
    if (!motivoValido) throw new Error('Escribe el motivo de la política.')
    const cambios = familiasRetencion.map(family => {
      const actual = versionActual(ciclo.datos?.policies, family)
      return { family, calendarMonths: Number(meses), expectedVersion: actual?.version ?? 0, reason: motivo.trim(),
        sinCambios: !!actual && actual.calendarMonths === Number(meses) && actual.reason === motivo.trim() }
    })
    if (!await confirmar({ titulo: 'Guardar retención', texto: `Se registrarán ${meses} meses para la telemetría de ${nombreAmbito}. La política no elimina registros al guardar.`, accion: 'Guardar política', peligro: cambios.some(c => c.calendarMonths < (versionActual(ciclo.datos?.policies, c.family)?.calendarMonths ?? 6)) })) return false
    try { await guardarRetencionVerificada(empresaId, cambios) }
    catch (error) {
      await Promise.all([ciclo.recargar(), historicos.recargar()])
      throw error
    }
    setPlan(null)
  }, 'Políticas verificadas mediante una consulta independiente. Guardar no ejecuta una limpieza.')

  return <div className="pnl-modulo ciclo-datos">
    <Cabecera titulo="Retirada y limpieza de datos" bajada="Retira registros del uso y elimina pruebas acreditadas tras revisar su impacto." />
    {aviso && <p role="alert" className="ciclo-error">{aviso}</p>}
    {exito && <p role="status">{exito}</p>}
    {empresas.estado === 'error' && <ErrorCarga error={empresas.error} onReintentar={empresas.recargar} />}
    {historicos.estado === 'error' && <ErrorCarga error={historicos.error} onReintentar={historicos.recargar} />}
    <label className="ciclo-campo">Ámbito
      <select value={empresaId} disabled={ocupado || expirando} onChange={e => setEmpresaId(e.target.value)}><option value="">Selecciona el ámbito</option>
        <option value="global">Inventario global y usuarios sin empresa</option>
        {(empresas.datos ?? []).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        {ambitosHistoricos.map(h => <option key={h.id} value={h.id}>Empresa eliminada · {h.reason.slice(0, 80)}</option>)}</select></label>
    {empresaId && <>
      {soloHistorico && <p role="status">La empresa fue eliminada. Puedes consultar sus conjuntos y comprobantes sin volver a crearla.</p>}
      <label className="ciclo-campo">Motivo de la operación<textarea value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500} disabled={ocupado} placeholder="Describe la retirada o la procedencia de estas pruebas." /></label>
      <section className="ciclo-seccion"><h2>Registros del ámbito</h2><p>Retirar conserva el historial. Marcar una prueba no la elimina.</p>
        <div className="ciclo-filtros"><label>Tipo<select value={tipo} disabled={ocupado} onChange={e => setTipo(e.target.value)}><option value="all">Todos</option>{Object.entries(TIPOS_CICLO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Buscar<input value={q} maxLength={100} disabled={ocupado} onChange={e => setQ(e.target.value)} /></label></div>
        {candidatos.estado === 'error' ? <ErrorCarga error={candidatos.error} onReintentar={candidatos.recargar} /> : candidatos.estado === 'cargando' ? <Cargando /> : <>
          <div className="ciclo-tabla"><table><thead><tr><th>Prueba</th><th>Tipo</th><th>Registro</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{lista.map(item => <tr key={claveCiclo(item)}>
            <td><input type="checkbox" aria-label={`Marcar ${item.label} como prueba`} disabled={ocupado || accionesBloqueadas} checked={elegidos.has(claveCiclo(item))} onChange={() => elegir(item)} /></td>
            <td>{TIPOS_CICLO[item.type]}</td><td>{item.label}</td><td>{estadoCiclo(item.status)}</td><td><button type="button" className="pnl-btn sutil" disabled={ocupado || accionesBloqueadas || !motivoValido || ['archived','revoked','disabled'].includes(item.status)} onClick={() => retirar(item)}>Retirar</button></td></tr>)}</tbody></table></div>
          {!lista.length && <p>No hay registros que coincidan.</p>}<div className="ciclo-filtros"><button className="pnl-btn sutil" disabled={ocupado || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Anterior</button><span>{candidatos.datos?.total ?? 0} registros</span><button className="pnl-btn sutil" disabled={ocupado || offset + lista.length >= (candidatos.datos?.total ?? 0)} onClick={() => setOffset(offset + 50)}>Siguiente</button></div>
        </>}
        <label className="ciclo-check"><input type="checkbox" checked={confirmarPruebas} disabled={ocupado} onChange={e => setConfirmarPruebas(e.target.checked)} />Confirmo que los {seleccion.length} registros seleccionados y sus datos exclusivos son pruebas desechables. No contienen operación real que deba conservarse.</label>
        <button type="button" className="pnl-btn" disabled={ocupado || accionesBloqueadas || ciclo.estado !== 'ok' || !seleccion.length || !motivoValido || !confirmarPruebas} onClick={acreditar}>{conjuntoId ? 'Agregar pruebas al conjunto seleccionado' : 'Acreditar conjunto de pruebas'}</button>
      </section>
      <section className="ciclo-seccion"><h2>Eliminar pruebas</h2><p>El impacto incluye el expediente exclusivo de los registros acreditados. Las relaciones compartidas y los datos sin procedencia demostrada bloquean la limpieza. Cada plan vence en 15 minutos.</p>
        {ciclo.estado === 'error' ? <ErrorCarga error={ciclo.error} onReintentar={ciclo.recargar} /> : <><label className="ciclo-campo">Conjunto<select value={conjuntoId} disabled={ocupado} onChange={e => setConjuntoId(e.target.value)}><option value="">Selecciona un conjunto</option>{conjuntos.map(s => <option key={s.id} value={s.id}>{s.reason} · {s.entities.length} acreditados{s.cleanupStatus ? ` · ${estadoTrabajo(s.cleanupStatus)}` : ''}</option>)}</select></label>
          <button className="pnl-btn" disabled={ocupado || accionesBloqueadas || soloHistorico || !conjuntoId} onClick={revisar}>Revisar impacto</button></>}
        {plan && <div className="ciclo-plan"><p>{plan.message}</p>{(plan.counts ?? []).map(c => <p key={c.family}>{familia(c.family)}: {c.count}</p>)}{(plan.blockers ?? []).map((b, i) => <p key={i} role="alert">{familia(b.family)}: {b.reason || b.message || 'Revisa las dependencias del conjunto.'} ({b.count >= 501 ? '501 o más' : b.count})</p>)}
          {plan.executionEnabled === false && <p role="alert">La eliminación aún no está habilitada para este entorno.</p>}
          {plan.canDelete && !accionesBloqueadas && <><p>Se eliminarán de la base activa. Una copia privada permite recuperación durante {plan.recoveryDays} días.</p><label className="ciclo-campo">Escribe ELIMINAR PRUEBAS<input value={frase} disabled={ocupado} onChange={e => setFrase(e.target.value)} autoComplete="off" /></label><button className="pnl-btn peligro" disabled={ocupado || frase !== 'ELIMINAR PRUEBAS'} onClick={limpiar}>Eliminar las pruebas del plan</button></>}
        </div>}
        {planPendiente && <button className="pnl-btn sutil" disabled={ocupado} onClick={comprobar}>Comprobar resultado de la limpieza</button>}
        {recibo && <div className="ciclo-plan" aria-label="Comprobante de limpieza"><p>{estadoTrabajo(recibo.status)}</p>
          {enTrabajo ? <p>El trabajo sigue en el servidor. El resultado se comprueba aparte al terminar.</p> : recibo.status === 'blocked' ? <p role="alert">{falloTrabajo(recibo.failureCode)}</p> : <>
            <p>Completada: {recibo.completedAt ? new Date(recibo.completedAt).toLocaleString('es-VE') : 'Pendiente de comprobar'} · Registros presentes: {recibo.remaining ?? 'Pendiente'}</p>
            {(recibo.counts ?? []).map(c => <p key={c.family}>{familia(c.family)}: {c.count}</p>)}
            <p>{recibo.recoveryAvailable ? 'Copia privada de recuperación disponible dentro de su plazo.' : 'La ventana de recuperación ya terminó.'}</p></>}</div>}
      </section>
      <section className="ciclo-seccion"><h2>Retención de telemetría</h2><p>Inicialmente seis meses. Aumentar el plazo no recupera datos ya expirados. Los pagos, documentos y la auditoría tienen reglas propias.</p>
        {familiasRetencion.map(family => { const actual = versionActual(ciclo.datos?.policies, family); return <p key={family}>{family === 'raw_ingress' ? 'Ingreso crudo' : 'Telemetría canónica'}: {actual ? `${actual.calendarMonths} meses · versión ${actual.version}` : 'sin política registrada'}.</p> })}
        <label className="ciclo-campo">Meses<select value={meses} disabled={ocupado} onChange={e => setMeses(Number(e.target.value))}><option value={6}>6 meses</option>{inicialCompleta && <option value={3}>3 meses</option>}</select></label>
        <button type="button" className="pnl-btn" disabled={ocupado || accionesBloqueadas || soloHistorico || !motivoValido || ciclo.estado !== 'ok'} onClick={guardarPolitica}>Guardar política</button>
      </section>
      <ExpiracionTelemetria confirmar={confirmar} key={empresaId} empresaId={empresaId} deshabilitado={soloHistorico || ciclo.estado !== 'ok' || ['queued', 'running'].includes(recibo?.status)} ocupado={ocupado} hacer={hacer} familia={familia} avisar={setAviso} informar={setExito} alTrabajar={setExpirando} politicaVersion={familiasRetencion.map(f => versionActual(ciclo.datos?.policies, f)?.version ?? 0).join(':')} />
    </>}
    {dialogo}
  </div>
}

function familia(nombre) {
  return ({ tenants: 'Empresas', vehicles: 'Vehículos', users: 'Usuarios', gps_devices: 'GPS',
    tenant: 'Empresa', vehicle: 'Vehículo', user: 'Usuario', gps_device: 'GPS',
    gps_raw_messages: 'Recepciones GPS', gps_raw_message_attempts: 'Intentos de interpretación GPS',
    gps_message_frames: 'Tramas GPS', gps_message_frame_segments: 'Segmentos de tramas GPS',
    gps_positions: 'Posiciones GPS', gps_device_tenant_history: 'Historial empresarial del GPS',
    gps_ingress_frame_receipts: 'Comprobantes de recepción GPS', gps_ingress_frame_receipt_segments: 'Segmentos de recepción GPS',
    gps_ingress_decode_receipts: 'Resultados de interpretación GPS', gps_ingress_record_decodes: 'Registros GPS interpretados',
    gps_ingress_attribution_runs: 'Atribuciones de recepción GPS', gps_ingress_record_attributions: 'Registros GPS atribuidos',
    reserva_operacional: 'Reservas operacionales',
    auth_sessions: 'Sesiones de acceso', auth_one_time_tokens: 'Tokens de un solo uso',
    user_password_credentials: 'Credenciales de acceso', user_profiles: 'Perfiles personales',
    user_credentials: 'Cualificaciones personales', tenant_memberships: 'Membresías',
    user_map_preferences: 'Preferencias del mapa', identity_email_change_requests: 'Solicitudes de cambio de correo',
    areas: 'Áreas', tenant_map_settings: 'Configuración del mapa', map_provider_profiles: 'Perfiles del proveedor de mapas',
    map_provider_assignments: 'Asignaciones del proveedor de mapas', tenant_document_settings: 'Configuración documental',
    document_types: 'Tipos de documento', documents: 'Documentos', document_files: 'Archivos documentales',
    inspection_templates: 'Plantillas de inspección', inspection_template_items: 'Puntos de inspección',
    inspections: 'Inspecciones', inspection_answers: 'Respuestas de inspección', inspection_evidence: 'Evidencias de inspección',
    inspection_finding_events: 'Seguimiento de hallazgos', inspection_schedules: 'Inspecciones programadas',
    inspection_submission_attempts: 'Intentos de envío de inspecciones', maintenance_service_plans: 'Planes de mantenimiento',
    maintenance_plan_vehicles: 'Asignaciones a planes', maintenance_actions: 'Acciones de mantenimiento',
    maintenance_action_attachments: 'Adjuntos de mantenimiento', work_orders: 'Órdenes de trabajo',
    work_order_assignments: 'Asignaciones de trabajo', work_order_attachments: 'Adjuntos de órdenes',
    work_order_events: 'Eventos de órdenes', work_order_execution_events: 'Eventos de ejecución',
    emergency_reports: 'Emergencias', emergency_reporter_location_events: 'Ubicaciones de emergencias',
    fleet_expenses: 'Gastos de flota', service_payments: 'Pagos del servicio', service_payment_receipts: 'Recibos de pago',
    alert_rules: 'Reglas de alerta', alert_rule_vehicles: 'Unidades de las reglas',
    alert_rule_vehicle_states: 'Estados de las reglas', alert_events: 'Eventos de alerta',
    alert_evaluation_jobs: 'Evaluaciones de alerta', notifications: 'Notificaciones',
    notification_receipts: 'Recibos de notificación', push_registrations: 'Registros de notificación push',
    push_delivery_intents: 'Entregas push', push_delivery_attempts: 'Intentos de entrega push',
    user_alerts: 'Avisos personales', user_alert_attachments: 'Adjuntos de avisos',
    driver_notices: 'Avisos del conductor', driver_notice_attachment_refs: 'Adjuntos del conductor',
    driver_behavior_events: 'Eventos de conducción', vehicle_driver_assignments: 'Asignaciones de conductor',
    vehicle_driver_sessions: 'Sesiones de conducción', vehicle_live_state: 'Estado de las unidades',
    vehicle_daily_metrics: 'Métricas diarias', vehicle_odometer_readings: 'Lecturas de odómetro',
    mobile_mutation_receipts: 'Recibos de operaciones', audit_log: 'Auditoría',
    storage_objects: 'Objetos de almacenamiento', external_references: 'Referencias externas',
    esquema: 'Esquema y controles', dependencias: 'Dependencias', conjunto: 'Conjunto' })[nombre] || 'Referencias asociadas'
}

function estadoTrabajo(estado) {
  return ({ queued: 'En cola', running: 'En ejecución', completed: 'Solicitud completada',
    verified: 'Limpieza verificada', changed: 'El estado actual ha cambiado', blocked: 'Trabajo bloqueado' })[estado] || 'Pendiente de comprobar'
}

function falloTrabajo(codigo) {
  return ({ plan_changed: 'El plan venció o cambió. Revisa nuevamente el impacto.',
    scope_unavailable: 'La autorización o el ámbito ya no permiten continuar.',
    policy_blocked: 'Una dependencia o la política impide la limpieza.' })[codigo] || 'El servidor detuvo la operación. Revisa el resultado antes de iniciar otra solicitud.'
}
