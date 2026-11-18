import { useRef, useState } from 'react'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useConfirmar } from '../comp/Confirmar'
import { Cargando, ErrorCarga, Tarjeta } from '../comp/ui'
import { desasignarUnidad } from '../datos/desasignarUnidad'

export default function AsignacionesUnidad({ unidad, alCambiar }) {
  const datos = useDatos(() => repo.vehiculos.asignacionesOperativas(unidad.id), [unidad.id])
  const { confirmar, dialogo } = useConfirmar()
  const bloqueo = useRef(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [incierto, setIncierto] = useState(false)
  async function actualizar() { setMensaje(''); setError(''); setIncierto(false); await datos.recargar() }
  async function quitar(relacion) {
    if (bloqueo.current || incierto) return
    bloqueo.current = true; setOcupado(true); setError(''); setMensaje('')
    try {
      const motivo = await confirmar({ titulo: relacion.tipo === 'gps' ? 'Desasignar GPS' : 'Desasignar conductor',
        texto: `${relacion.nombre} dejará de estar asignado a ${unidad.alias || unidad.placa}. ${relacion.tipo === 'gps' ? 'El equipo volverá al inventario; esta acción no apaga el GPS ni envía comandos.' : 'La cuenta del usuario permanece disponible.'} Se conserva el historial y la telemetría.`,
        accion: 'Desasignar', peligro: true, campo: { etiqueta: 'Motivo', obligatorio: true } })
      if (!motivo) return
      await desasignarUnidad(unidad.id, relacion, motivo, {
        leer: id => repo.vehiculos.asignacionesOperativas(id),
        quitarGps: (id, motivo) => repo.admin.gps.desmontar(id, motivo),
        quitarConductor: (id, motivo) => repo.vehiculos.revocarAsignacion(id, motivo),
      })
      await datos.recargar()
      await alCambiar?.()
      setMensaje('Asignación terminada y comprobada. El historial se conserva.')
    } catch (e) { setError(e.message); setIncierto(true) }
    finally { bloqueo.current = false; setOcupado(false) }
  }
  return <Tarjeta titulo="Asignaciones de la unidad" accion={<button type="button" className="pnl-btn sutil" disabled={ocupado} onClick={actualizar}>Actualizar</button>}>
    <p className="eu-nota">Desasigna cada relación antes de archivar. El GPS vuelve al inventario y el usuario conserva su cuenta.</p>
    {datos.estado === 'cargando' && <Cargando filas={2} />}
    {datos.estado === 'error' && <ErrorCarga error={datos.error} onReintentar={actualizar} />}
    {datos.estado === 'ok' && <div className="eu-desasignaciones">
      {datos.datos.gps.map(g => <div className="eu-desasignacion" key={`gps-${g.id}`}><div><b>GPS · {g.nombre}</b><span>Instalación vigente</span></div><button type="button" className="pnl-btn sutil" disabled={ocupado || incierto || !g.id} onClick={() => quitar({ ...g, tipo: 'gps' })}>Desasignar GPS</button></div>)}
      {!datos.datos.gps.length && <p className="eu-nota">Sin GPS instalado.</p>}
      {datos.datos.conductores.map(c => <div className="eu-desasignacion" key={`conductor-${c.id}`}><div><b>{c.nombre}</b><span>Conductor {c.rol === 'principal' ? 'principal' : 'secundario'}</span></div><button type="button" className="pnl-btn sutil" disabled={ocupado || incierto || !c.id} onClick={() => quitar({ ...c, tipo: 'conductor' })}>Desasignar conductor</button></div>)}
      {!datos.datos.conductores.length && <p className="eu-nota">Sin conductores asignados.</p>}
    </div>}
    {mensaje && <p className="eu-nota" role="status">{mensaje}</p>}
    {error && <p className="pnl-error" role="alert">{error} Comprueba el estado con Actualizar antes de intentarlo otra vez.</p>}
    {dialogo}
  </Tarjeta>
}
