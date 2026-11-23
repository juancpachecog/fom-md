import { useState } from 'react'
import { Cargando, ErrorCarga, Modal, Tag } from '../comp/ui'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'

const CATEGORIAS = [
  ['documents', 'Documentos'],
  ['inspections', 'Inspecciones'],
  ['workOrders', 'Órdenes de trabajo'],
  ['maintenancePlans', 'Planes de mantenimiento'],
  ['expenses', 'Gastos del vehículo'],
  ['hasPositionHistory', 'Recorridos'],
]

export default function ModalEntregaVehiculo({ transferencia, origen, destino, alCerrar, alCompletar }) {
  const [marcadas, setMarcadas] = useState([])
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const vista = useDatos(() => repo.transferencias.vehiculo.inventarioEntrega(transferencia), [transferencia.id])
  const datos = vista.estado === 'ok' && vista.datos?.transferId === transferencia.id ? vista.datos : null
  const cierre = () => { if (!ocupado) alCerrar() }
  const impedimentos = datos ? [
    [datos.operations.gpsInstallations, 'GPS instalado'],
    [datos.operations.driverAssignments, 'Asignación de conductor activa'],
    [datos.operations.driverSessions, 'Sesión de conducción activa'],
    [datos.operations.unresolvedEmergencies, 'Emergencia sin resolver'],
    [datos.inventory.openWorkOrders, 'Órdenes de trabajo abiertas'],
  ].filter(([cantidad]) => cantidad > 0) : []
  const puedeConfirmar = datos?.originReleased && !impedimentos.length && !marcadas.length

  async function confirmar(evento) {
    evento.preventDefault()
    if (!puedeConfirmar || ocupado) return
    setOcupado(true)
    setError('')
    try {
      await repo.transferencias.vehiculo.decidir({ ...transferencia, version: datos.transferVersion }, 'destination-acceptance')
      alCompletar()
    } catch (e) {
      setError(e?.message || 'La transferencia sigue pendiente.')
      vista.recargar()
    } finally {
      setOcupado(false)
    }
  }

  return <Modal titulo="Entrega del vehículo" abierto alCerrar={cierre} ancho={560}>
    <form onSubmit={confirmar}>
      <p className="pnl-entrega-unidad">
        {datos?.plate && <b>{datos.plate.toUpperCase()}</b>}
        <span>{origen} → {destino}</span>
      </p>
      {vista.estado === 'cargando' && <Cargando filas={3} />}
      {vista.estado === 'error' && <ErrorCarga onReintentar={vista.recargar} error={vista.error} />}
      {datos && <>
        <h3>Información para entregar</h3>
        <div className="pnl-filas pnl-entrega-opciones">
          {CATEGORIAS.map(([clave, nombre]) => {
            const cantidad = datos.inventory[clave]
            return <label className="pnl-fila" key={clave}>
              <input type="checkbox" checked={marcadas.includes(clave)} disabled={!cantidad || ocupado}
                onChange={e => {
                  const marcar = e.target.checked
                  setMarcadas(actual => marcar ? [...actual, clave] : actual.filter(v => v !== clave))
                }} />
              <span className="pnl-fila-txt">{nombre}</span>
              <Tag color="gris">{typeof cantidad === 'boolean' ? cantidad ? 'Disponible' : 'Sin registros' : cantidad}</Tag>
            </label>
          })}
        </div>
        <p role="status">{marcadas.length
          ? 'La entrega de registros seleccionados aún no está habilitada. La solicitud sigue pendiente.'
          : `Todos los registros quedan en ${origen}. El vehículo pasa a ${destino} sin conductor.`}</p>
        {!!impedimentos.length && <div className="pnl-audit-detalle">
          <b>Pendientes para completar la entrega</b>
          <ul className="pnl-entrega-pendientes">{impedimentos.map(([cantidad, nombre]) => <li key={nombre}>{nombre} · {cantidad}</li>)}</ul>
        </div>}
        {!datos.originReleased && <p role="status">Falta la liberación en {origen}.</p>}
      </>}
      {error && <p className="pnl-campo-error" role="alert">{error}</p>}
      <div className="pnl-entrega-acciones">
        <button className="pnl-btn sutil" type="button" disabled={ocupado} onClick={cierre}>Volver</button>
        <button className="pnl-btn primario" type="submit" disabled={!puedeConfirmar || ocupado}>{ocupado ? 'Confirmando…' : 'Transferir vehículo'}</button>
      </div>
    </form>
  </Modal>
}
