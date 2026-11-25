import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cargando, Modal } from '../comp/ui'
import { entrarEmpresa } from '../auth'
import { claveIdempotente } from '../datos/api'
import repo from '../datos/repo'
import { dependenciasConfirmadas, dependenciasDeTransferencia, explicarAceptacion } from '../datos/transferenciasVehiculos'
import { useDatos } from '../useDatos'
import OpcionesEntregaVehiculo, { ResumenSeleccionEntrega } from './OpcionesEntregaVehiculo'

const sinSeleccion = { categories: [], gps: null, driver: null, orders: null }

export default function RevisionTransferenciaVehiculo({ transferencia, rotulo, origen, destino, empresaOrigen, mostrarInventario, alCerrar, alCompletar }) {
  const navegar = useNavigate()
  const enCurso = useRef(false)
  const intento = useRef(null)
  const intentoSeleccion = useRef(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [borrador, setBorrador] = useState(null)
  const vista = useDatos(async () => {
    const actual = await repo.transferencias.vehiculo.detalle(transferencia.id)
    if (actual.estado !== 'pending' || !actual.liberadaEn) return { revision, actual }
    const plan = await repo.transferencias.vehiculo.planEntrega(actual)
    if (mostrarInventario) {
      const resumen = await repo.transferencias.vehiculo.inventarioEntrega(actual)
      if (resumen?.transferId !== actual.id || resumen.transferVersion !== actual.version || !resumen.originReleased) {
        throw Error('La solicitud cambió durante la consulta.')
      }
      const { inventory: inventario, operations } = resumen
      const conteos = {
        gpsInstallations: operations.gpsInstallations,
        driverAssignments: operations.driverAssignments,
        driverSessions: operations.driverSessions,
        workOrders: inventario.openWorkOrders,
        emergencies: operations.unresolvedEmergencies,
      }
      return { revision, actual, conteos, inventario, operaciones: operations, plan,
        operationalSnapshot: resumen.operationalSnapshot, placa: resumen.plate }
    }
    try {
      const conteos = await repo.transferencias.vehiculo.dependencias(actual)
      return { revision, actual, conteos, plan }
    } catch (e) {
      if (e.estado === 403 || e.estado === 404) return { revision, actual, plan, sinAcceso: true }
      throw e
    }
  }, [transferencia.id, revision, mostrarInventario])
  const datos = vista.estado === 'ok' && vista.datos?.revision === revision ? vista.datos : null
  const actual = datos?.actual
  const pendientes = dependenciasDeTransferencia(datos?.conteos)
  const operaciones = datos?.operaciones
  const opciones = borrador?.opciones ?? datos?.plan ?? sinSeleccion
  const revisionGuardada = datos?.plan?.revision ?? 0
  const tieneConteos = dependenciasConfirmadas(datos?.conteos)
  const siguePendiente = actual?.estado === 'pending' && actual.liberadaEn && !actual.aceptadaEn
  const bloqueosOperativos = pendientes.filter(item => ['driverSessions', 'emergencies'].includes(item.clave))
  const bloqueosMantenimiento = datos?.inventario?.openOrdersLinkedToMaintenance > 0
  const borradorVigente = borrador?.version === actual?.version && borrador?.revision === revisionGuardada
    && borrador?.snapshot === datos?.operationalSnapshot
  const gps = operaciones?.gpsInstallations ? opciones.gps : null
  const driver = operaciones?.driverAssignments ? opciones.driver : null
  const orders = datos?.inventario?.openWorkOrders ? opciones.orders : null
  const opcionesValidas = (!operaciones?.gpsInstallations || gps) && (!operaciones?.driverAssignments || driver)
    && (!datos?.inventario?.openWorkOrders || orders)
    && (gps !== 'continue' || operaciones.gpsInstallationsWithRecentQualifiedPosition === operaciones.gpsInstallations)
    && (driver !== 'continue_principal' || operaciones.principalDriverEligible)
    && !opciones.categories.length
  const permiteGuardar = siguePendiente && borrador && borradorVigente && operaciones && opcionesValidas
  const plan = datos?.plan
  const coincideConPlan = plan && (!operaciones || (opcionesValidas && gps === plan.gps && driver === plan.driver && orders === plan.orders))
  const puedeAplicarPlan = coincideConPlan && plan.transferVersion === actual?.version && plan.operationalReviewCurrent
    && !plan.categories.length && !bloqueosOperativos.length && !bloqueosMantenimiento
  const permiteAceptar = siguePendiente && !borrador && (plan
    ? puedeAplicarPlan
    : !pendientes.length && (tieneConteos || datos?.sinAcceso))

  const actualizar = () => setRevision(valor => valor + 1)
  const cerrar = () => { if (!enCurso.current) alCerrar() }

  function editarOpciones(cambios) {
    setBorrador(previo => ({
      version: previo?.version ?? actual.version,
      revision: previo?.revision ?? revisionGuardada,
      snapshot: previo?.snapshot ?? datos.operationalSnapshot,
      opciones: { ...(previo?.opciones ?? datos.plan ?? sinSeleccion), ...cambios },
    }))
  }

  async function guardarOpciones() {
    if (!permiteGuardar || enCurso.current) return
    enCurso.current = true
    setOcupado(true)
    setError('')
    const payload = {
      expectedVersion: borrador.version, expectedPlanRevision: borrador.revision,
      expectedOperationalSnapshot: borrador.snapshot,
      categories: [...opciones.categories].sort(), gps, driver, orders,
    }
    const huella = JSON.stringify(payload)
    if (intentoSeleccion.current?.huella !== huella) intentoSeleccion.current = { huella, clave: claveIdempotente() }
    try {
      const respuesta = await repo.transferencias.vehiculo.guardarPlanEntrega(actual, payload, intentoSeleccion.current.clave)
      if (respuesta?.plan?.revision !== borrador.revision + 1) throw Error('La selección guardada requiere verificación.')
      setBorrador(null)
      intentoSeleccion.current = null
    } catch (e) {
      setError(e.estado >= 400 && e.estado < 500 ? e.message : 'La respuesta no confirmó la selección. Se está consultando el registro guardado.')
    } finally {
      actualizar()
      enCurso.current = false
      setOcupado(false)
    }
  }

  async function abrirExpediente(vistaOrigen) {
    if (!empresaOrigen || enCurso.current) return
    enCurso.current = true
    setOcupado(true)
    setError('')
    try {
      await entrarEmpresa(empresaOrigen)
      const parametros = new URLSearchParams({ vista: vistaOrigen, transferencia: transferencia.id })
      navegar(`/panel/flota/${encodeURIComponent(transferencia.vehiculoId)}?${parametros}`)
    } catch (e) {
      setError(e?.message || 'No se pudo abrir el expediente en origen.')
    } finally {
      enCurso.current = false
      setOcupado(false)
    }
  }

  async function confirmar(e) {
    e.preventDefault()
    if (!permiteAceptar || enCurso.current) return
    enCurso.current = true
    setOcupado(true)
    setError('')
    if (intento.current?.version !== actual.version || intento.current?.planRevision !== plan?.revision) {
      intento.current = { version: actual.version, planRevision: plan?.revision, clave: claveIdempotente() }
    }
    try {
      const resultado = await repo.transferencias.vehiculo.decidir(actual, 'destination-acceptance', undefined, intento.current.clave, plan?.revision)
      if (resultado.estado !== 'completed') throw Error('La entrega todavía no figura como completada.')
      alCompletar()
    } catch (e) {
      setError(e.estado >= 400 && e.estado < 500
        ? (e.estado === 409 && plan ? e.message : explicarAceptacion(e))
        : 'La respuesta no confirmó la entrega. Consultando el estado de esta misma solicitud.')
      actualizar()
    } finally {
      enCurso.current = false
      setOcupado(false)
    }
  }

  return <Modal titulo="Revisar entrega del vehículo" abierto alCerrar={cerrar} ancho={580}>
    <form onSubmit={confirmar}>
      <p className="pnl-entrega-unidad"><b>{rotulo || datos?.placa?.toUpperCase()}</b><span>{origen} → {destino}</span></p>
      {!datos && vista.estado !== 'error' && <Cargando filas={3} />}
      {vista.estado === 'error' && <p role="alert">No pudimos comprobar el estado de la solicitud. Actualiza la revisión.</p>}
      {actual?.estado === 'completed' && <p role="status">El servidor confirma que la transferencia se completó.</p>}
      {actual && ['rejected', 'cancelled'].includes(actual.estado) && <p role="status">La solicitud ya fue cerrada.</p>}
      {actual?.estado === 'pending' && !actual.liberadaEn && <p role="status">Falta que {origen} libere el vehículo.</p>}
      {siguePendiente && <>
        <p>Vehículo liberado en {origen}. Falta la aceptación de {destino}.</p>
        <ResumenSeleccionEntrega plan={datos.plan} />
        {datos.inventario && <OpcionesEntregaVehiculo inventario={datos.inventario} operaciones={operaciones}
          opciones={opciones} onChange={editarOpciones} ocupado={ocupado} />}
        {borrador && !borradorVigente && <p role="status">La selección guardada cambió. Descarta los cambios locales para revisar la versión actual.</p>}
        {plan && !plan.operationalReviewCurrent && <p role="status">Cambiaron los vínculos o las órdenes. Revisa y vuelve a guardar la selección.</p>}
        {puedeAplicarPlan && <p role="status">La selección está lista. Al aceptar se aplicarán juntas las opciones guardadas.</p>}
        {(!operaciones ? pendientes.length > 0 : bloqueosOperativos.length > 0 || bloqueosMantenimiento) && <div className="pnl-audit-detalle">
          <p role="status"><b>Aceptación bloqueada.</b> Hay operaciones activas en {origen}.</p>
          <ul className="pnl-entrega-pendientes">
            {(operaciones ? bloqueosOperativos : pendientes).map(({ clave, texto, accion, vista }) => <li key={clave}>
              <span>{texto}</span>
              {empresaOrigen && (!operaciones || !['gpsInstallations', 'driverAssignments'].includes(clave)) && <button type="button" className="pnl-btn sutil" disabled={ocupado} onClick={() => abrirExpediente(vista)}>{accion}</button>}
            </li>)}
          </ul>
          {bloqueosMantenimiento && <p>Revisa las órdenes abiertas vinculadas a un plan de mantenimiento.</p>}
          <p>Actualiza la revisión para volver a consultar estos pendientes.</p>
        </div>}
        {tieneConteos && !pendientes.length && <p role="status">La consulta del origen no encontró operaciones activas. El servidor realizará la validación final al aceptar.</p>}
        {datos.sinAcceso && <p role="status">La revisión no pudo consultar el expediente del origen. El servidor comprobará los requisitos al aceptar.</p>}
        {!tieneConteos && !datos.sinAcceso && !pendientes.length && <p role="status">La consulta de pendientes quedó incompleta. Actualiza la revisión.</p>}
        <p>La aceptación cambia la custodia. Los registros anteriores conservan su empresa de origen.</p>
      </>}
      {error && actual?.estado !== 'completed' && <p className="pnl-campo-error" role="alert">{error}</p>}
      <div className="pnl-entrega-acciones">
        <button className="pnl-btn sutil" type="button" disabled={ocupado} onClick={actual?.estado === 'completed' ? alCompletar : cerrar}>Volver</button>
        {borrador && <button className="pnl-btn sutil" type="button" disabled={ocupado} onClick={() => { setBorrador(null); setError('') }}>Descartar edición</button>}
        {(!actual || siguePendiente) && <button className="pnl-btn sutil" type="button" disabled={ocupado || vista.estado === 'cargando'} onClick={() => { setError(''); actualizar() }}>Actualizar revisión</button>}
        {siguePendiente && borrador && <button className="pnl-btn primario" type="button" disabled={!permiteGuardar || ocupado} onClick={guardarOpciones}>Guardar selección</button>}
        {siguePendiente && operaciones && plan && !plan.operationalReviewCurrent && !borrador && <button className="pnl-btn sutil" type="button" disabled={ocupado} onClick={() => editarOpciones({})}>Revisar selección</button>}
        {permiteAceptar && <button className="pnl-btn primario" type="submit" disabled={ocupado}>{ocupado ? 'Comprobando…' : 'Aceptar en destino'}</button>}
      </div>
    </form>
  </Modal>
}
