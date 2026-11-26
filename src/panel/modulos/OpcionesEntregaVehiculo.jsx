import { Campo, Tag } from '../comp/ui'

const categorias = [
  ['documents', 'Documentos'],
  ['inspections', 'Inspecciones'],
  ['workOrders', 'Órdenes de trabajo'],
  ['maintenancePlans', 'Planes de mantenimiento'],
  ['expenses', 'Gastos del vehículo'],
  ['hasPositionHistory', 'Recorridos'],
]

export const nombresGpsEntrega = { continue: 'Mantener el GPS en el vehículo', leave: 'Entregar el vehículo sin el GPS actual' }
export const nombresConductorEntrega = { continue_principal: 'Mantener al conductor principal', unassign: 'Entregar sin conductor asignado' }
const nombresOrdenesEntrega = { continue: 'Continuar las órdenes en destino', leave: 'Conservar las órdenes en origen' }

export function ResumenSeleccionEntrega({ plan }) {
  if (!plan) return null
  const nombres = [nombresGpsEntrega[plan.gps], nombresConductorEntrega[plan.driver],
    nombresOrdenesEntrega[plan.orders],
    ...categorias.filter(([clave]) => plan.categories.includes(clave)).map(([, nombre]) => nombre)].filter(Boolean)
  return <div className="pnl-audit-detalle">
    <b>Selección guardada en origen</b>
    {nombres.length > 0 ? <ul>{nombres.map(nombre => <li key={nombre}>{nombre}</li>)}</ul> : <p>Solo custodia del vehículo.</p>}
  </div>
}

export default function OpcionesEntregaVehiculo({ inventario, operaciones, opciones, onChange, ocupado }) {
  const gpsListo = operaciones.gpsInstallationsWithRecentQualifiedPosition === operaciones.gpsInstallations
  return <>
    <fieldset className="pnl-entrega-categorias" disabled={ocupado}>
      <legend>GPS y conductor</legend>
      {operaciones.gpsInstallations > 0 && <Campo etiqueta="GPS instalado" ayuda={gpsListo
        ? 'El equipo continúa en destino únicamente con un corte de seguimiento verificado.'
        : 'El GPS necesita una hora de evento verificada para continuar en destino.'}>
        <select className="pnl-input" value={opciones.gps ?? ''} onChange={e => onChange({ gps: e.target.value || null })}>
          <option value="">Elige qué hacer con el equipo</option>
          <option value="continue" disabled={!gpsListo}>{nombresGpsEntrega.continue}</option>
          <option value="leave">{nombresGpsEntrega.leave}</option>
        </select>
      </Campo>}
      {opciones.gps === 'leave' && operaciones.gpsInstallations > 0 && <p>Al aceptar, FOM desvinculará el equipo en el sistema. El GPS volverá al inventario y dejará de reportar para este vehículo.</p>}
      {operaciones.driverAssignments > 0 && <Campo etiqueta="Conductor asignado" ayuda={operaciones.principalDriverEligible
        ? 'La cuenta y sus permisos se gestionan en cada empresa.'
        : 'El conductor principal requiere una membresía activa en destino.'}>
        <select className="pnl-input" value={opciones.driver ?? ''} onChange={e => onChange({ driver: e.target.value || null })}>
          <option value="">Elige la asignación en destino</option>
          <option value="continue_principal" disabled={!operaciones.principalDriverEligible}>{nombresConductorEntrega.continue_principal}</option>
          <option value="unassign">{nombresConductorEntrega.unassign}</option>
        </select>
      </Campo>}
      {!operaciones.gpsInstallations && !operaciones.driverAssignments && <p>El vehículo está sin GPS ni conductor asignado.</p>}
    </fieldset>

    {inventario.openWorkOrders > 0 && <fieldset className="pnl-entrega-categorias" disabled={ocupado}>
      <legend>Órdenes de trabajo abiertas</legend>
      <Campo etiqueta={`${inventario.openWorkOrders} pendientes en origen`}>
        <select className="pnl-input" value={opciones.orders ?? ''} onChange={e => onChange({ orders: e.target.value || null })}>
          <option value="">Elige qué hacer con las órdenes</option>
          <option value="continue">{nombresOrdenesEntrega.continue}</option>
          <option value="leave">{nombresOrdenesEntrega.leave}</option>
        </select>
      </Campo>
      {opciones.orders && <p>Al aceptar, las órdenes pendientes se cancelarán en origen y conservarán su historial.
        {opciones.orders === 'continue' && ' En destino se abrirá una continuación por cada orden para revisar y asignar.'}</p>}
      {inventario.openOrdersLinkedToMaintenance > 0 && <p role="status">Hay órdenes vinculadas a mantenimiento que requieren revisión antes de transferir.</p>}
    </fieldset>}

    {opciones.categories.length > 0 && <fieldset className="pnl-entrega-categorias" disabled={ocupado}>
      <legend>Historial seleccionado en una revisión anterior</legend>
      <div className="pnl-filas pnl-entrega-opciones">
        {categorias.filter(([clave]) => opciones.categories.includes(clave)).map(([clave, nombre]) => {
          const cantidad = inventario[clave]
          const marcada = opciones.categories.includes(clave)
          return <label className="pnl-fila" key={clave}>
            <input type="checkbox" checked={marcada} onChange={() => onChange({ categories: opciones.categories.filter(item => item !== clave) })} />
            <span className="pnl-fila-txt">{nombre}</span>
            <Tag color="gris">{typeof cantidad === 'boolean' ? cantidad ? 'Disponible' : 'Sin registros' : cantidad}</Tag>
          </label>
        })}
      </div>
      <p>La consulta de estos registros en destino aún no está habilitada.</p>
    </fieldset>}
  </>
}
