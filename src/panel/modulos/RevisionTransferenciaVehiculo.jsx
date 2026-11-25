import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cargando, Modal } from '../comp/ui'
import { entrarEmpresa } from '../auth'
import { claveIdempotente } from '../datos/api'
import repo from '../datos/repo'
import { dependenciasConfirmadas, dependenciasDeTransferencia, explicarAceptacion } from '../datos/transferenciasVehiculos'
import { useDatos } from '../useDatos'
import OpcionesEntregaVehiculo, { haySeleccionEntrega, ResumenSeleccionEntrega } from './OpcionesEntregaVehiculo'

const sinSeleccion = { categories: [], gps: null, driver: null }

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
      return { revision, actual, conteos, inventario, operaciones: operations, plan, placa: resumen.plate }
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
  const necesitaEntregaCoordinada = haySeleccionEntrega(datos?.plan)
  const borradorVigente = borrador?.version === actual?.version && borrador?.revision === revisionGuardada
  const gps = operaciones?.gpsInstallations ? opciones.gps : null
  const driver = operaciones?.driverAssignments ? opciones.driver : null
  const opcionesValidas = (!operaciones?.gpsInstallations || gps) && (!operaciones?.driverAssignments || driver)
    && (gps !== 'continue' || operaciones.gpsInstallationsWithRecentQualifiedPosition === operaciones.gpsInstallations)
    && (driver !== 'continue_principal' || operaciones.principalDriverEligible)
    && opciones.categories.every(category => datos?.inventario?.[category])
  const permiteGuardar = siguePendiente && borrador && borradorVigente && operaciones && opcionesValidas
  const permiteAceptar = siguePendiente && !pendientes.length && !borrador && !necesitaEntregaCoordinada && (tieneConteos || datos?.sinAcceso)

  const actualizar = () => setRevision(valor => valor + 1)
  const cerrar = () => { if (!enCurso.current) alCerrar() }

  function editarOpciones(cambios) {
    setBorrador(previo => ({
      version: previo?.version ?? actual.version,
      revision: previo?.revision ?? revisionGuardada,
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
      categories: [...opciones.categories].sort(), gps, driver,
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
    if (intento.current?.version !== actual.version) {
      intento.current = { version: actual.version, clave: claveIdempotente() }
    }
    try {
      const resultado = await repo.transferencias.vehiculo.decidir(actual, 'destination-acceptance', undefined, intento.current.clave)
      if (resultado.estado !== 'completed') throw Error('La entrega todavía no figura como completada.')
      alCompletar()
    } catch (e) {
      setError(e.estado >= 400 && e.estado < 500
        ? explicarAceptacion(e)
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
        {necesitaEntregaCoordinada && <p role="status">Selección registrada. La aceptación con estos vínculos y registros está pendiente de habilitación.</p>}
        {pendientes.length > 0 && <div className="pnl-audit-detalle">
          <p role="status"><b>Aceptación bloqueada.</b> Hay operaciones activas en {origen}.</p>
          <ul className="pnl-entrega-pendientes">
            {pendientes.map(({ clave, texto, accion, vista }) => <li key={clave}>
              <span>{texto}</span>
              {empresaOrigen && (!operaciones || !['gpsInstallations', 'driverAssignments'].includes(clave)) && <button type="button" className="pnl-btn sutil" disabled={ocupado} onClick={() => abrirExpediente(vista)}>{accion}</button>}
            </li>)}
          </ul>
          <p>{operaciones
            ? 'La selección de GPS y conductor se registra aquí. Las órdenes, jornadas y emergencias abiertas siguen sus propios requisitos de entrega.'
            : 'Actualiza la revisión para volver a consultar estos pendientes.'}</p>
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
        {permiteAceptar && <button className="pnl-btn primario" type="submit" disabled={ocupado}>{ocupado ? 'Comprobando…' : 'Aceptar en destino'}</button>}
      </div>
    </form>
  </Modal>
}
