import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cargando, Modal, Tag } from '../comp/ui'
import { entrarEmpresa } from '../auth'
import { claveIdempotente } from '../datos/api'
import repo from '../datos/repo'
import { dependenciasConfirmadas, dependenciasDeTransferencia, explicarAceptacion } from '../datos/transferenciasVehiculos'
import { useDatos } from '../useDatos'

const categorias = [
  ['documents', 'Documentos'],
  ['inspections', 'Inspecciones'],
  ['workOrders', 'Órdenes de trabajo'],
  ['maintenancePlans', 'Planes de mantenimiento'],
  ['expenses', 'Gastos del vehículo'],
  ['hasPositionHistory', 'Recorridos'],
]

export default function RevisionTransferenciaVehiculo({ transferencia, rotulo, origen, destino, empresaOrigen, mostrarInventario, alCerrar, alCompletar }) {
  const navegar = useNavigate()
  const enCurso = useRef(false)
  const intento = useRef(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [seleccion, setSeleccion] = useState([])
  const vista = useDatos(async () => {
    const actual = await repo.transferencias.vehiculo.detalle(transferencia.id)
    if (actual.estado !== 'pending' || !actual.liberadaEn) return { revision, actual }
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
      return { revision, actual, conteos, inventario, placa: resumen.plate }
    }
    try {
      const conteos = await repo.transferencias.vehiculo.dependencias(actual)
      return { revision, actual, conteos }
    } catch (e) {
      if (e.estado === 403 || e.estado === 404) return { revision, actual, sinAcceso: true }
      throw e
    }
  }, [transferencia.id, revision, mostrarInventario])
  const datos = vista.estado === 'ok' && vista.datos?.revision === revision ? vista.datos : null
  const actual = datos?.actual
  const pendientes = dependenciasDeTransferencia(datos?.conteos)
  const tieneConteos = dependenciasConfirmadas(datos?.conteos)
  const siguePendiente = actual?.estado === 'pending' && actual.liberadaEn && !actual.aceptadaEn
  const permiteAceptar = siguePendiente && !pendientes.length && !seleccion.length && (tieneConteos || datos?.sinAcceso)

  const actualizar = () => setRevision(valor => valor + 1)
  const cerrar = () => { if (!enCurso.current) alCerrar() }

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
        {datos.inventario && <fieldset className="pnl-entrega-categorias">
          <legend>Información para entregar</legend>
          <div className="pnl-filas pnl-entrega-opciones">
            {categorias.map(([clave, nombre]) => {
              const cantidad = datos.inventario[clave]
              const marcada = seleccion.includes(clave)
              return <label className="pnl-fila" key={clave}>
                <input type="checkbox" checked={marcada} disabled={ocupado || (!cantidad && !marcada)} onChange={e => {
                  const activa = e.target.checked
                  setSeleccion(previa => activa ? [...previa, clave] : previa.filter(item => item !== clave))
                }} />
                <span className="pnl-fila-txt">{nombre}</span>
                <Tag color="gris">{typeof cantidad === 'boolean' ? cantidad ? 'Disponible' : 'Sin registros' : cantidad}</Tag>
              </label>
            })}
          </div>
          <p role="status">{seleccion.length
            ? 'La entrega de las categorías seleccionadas aún está pendiente de habilitación.'
            : `Con la selección vacía, los registros históricos quedan en ${origen} y el vehículo llega a ${destino} sin conductor.`}</p>
        </fieldset>}
        {pendientes.length > 0 && <div className="pnl-audit-detalle">
          <b>Pendientes en {origen}</b>
          <ul className="pnl-entrega-pendientes">
            {pendientes.map(({ clave, texto, accion, vista }) => <li key={clave}>
              <span>{texto}</span>
              {empresaOrigen && <button type="button" className="pnl-btn sutil" disabled={ocupado} onClick={() => abrirExpediente(vista)}>{accion}</button>}
            </li>)}
          </ul>
          <p>Revisa cada operación en origen y vuelve a esta solicitud para actualizar su estado.</p>
        </div>}
        {tieneConteos && !pendientes.length && <p role="status">La consulta del origen no encontró operaciones activas. El servidor realizará la validación final al aceptar.</p>}
        {datos.sinAcceso && <p role="status">La revisión no pudo consultar el expediente del origen. El servidor comprobará los requisitos al aceptar.</p>}
        {!tieneConteos && !datos.sinAcceso && !pendientes.length && <p role="status">La consulta de pendientes quedó incompleta. Actualiza la revisión.</p>}
        <p>La aceptación cambia la custodia. Los registros anteriores conservan su empresa de origen.</p>
      </>}
      {error && actual?.estado !== 'completed' && <p className="pnl-campo-error" role="alert">{error}</p>}
      <div className="pnl-entrega-acciones">
        <button className="pnl-btn sutil" type="button" disabled={ocupado} onClick={actual?.estado === 'completed' ? alCompletar : cerrar}>Volver</button>
        {(!actual || siguePendiente) && <button className="pnl-btn sutil" type="button" disabled={ocupado || vista.estado === 'cargando'} onClick={() => { setError(''); actualizar() }}>Actualizar revisión</button>}
        {siguePendiente && <button className="pnl-btn primario" type="submit" disabled={!permiteAceptar || ocupado}>{ocupado ? 'Comprobando…' : 'Aceptar en destino'}</button>}
      </div>
    </form>
  </Modal>
}
