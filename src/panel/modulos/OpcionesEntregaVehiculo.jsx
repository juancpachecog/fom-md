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

export function haySeleccionEntrega(plan) {
  return Boolean(plan?.gps || plan?.driver || plan?.categories.length)
}

export function ResumenSeleccionEntrega({ plan }) {
  if (!plan) return null
  const nombres = [nombresGpsEntrega[plan.gps], nombresConductorEntrega[plan.driver],
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
      {opciones.gps === 'leave' && operaciones.gpsInstallations > 0 && <p>Al completar, el seguimiento de este equipo dejaría de estar vinculado al vehículo.</p>}
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

    <fieldset className="pnl-entrega-categorias" disabled={ocupado}>
      <legend>Información del expediente para entregar</legend>
      <div className="pnl-filas pnl-entrega-opciones">
        {categorias.map(([clave, nombre]) => {
          const cantidad = inventario[clave]
          const marcada = opciones.categories.includes(clave)
          return <label className="pnl-fila" key={clave}>
            <input type="checkbox" checked={marcada} disabled={!cantidad && !marcada} onChange={e => onChange({ categories: e.target.checked
              ? [...opciones.categories, clave] : opciones.categories.filter(item => item !== clave) })} />
            <span className="pnl-fila-txt">{nombre}</span>
            <Tag color="gris">{typeof cantidad === 'boolean' ? cantidad ? 'Disponible' : 'Sin registros' : cantidad}</Tag>
          </label>
        })}
      </div>
      <p>Marca lo que debe quedar disponible en destino. El historial conserva su procedencia.</p>
    </fieldset>
  </>
}
