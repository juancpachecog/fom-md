import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cargando, Modal } from '../comp/ui'
import { entrarEmpresa } from '../auth'
import { claveIdempotente } from '../datos/api'
import repo from '../datos/repo'
import { dependenciasConfirmadas, dependenciasDeTransferencia, explicarAceptacion } from '../datos/transferenciasVehiculos'
import { useDatos } from '../useDatos'

export default function RevisionTransferenciaVehiculo({ transferencia, rotulo, origen, destino, empresaOrigen, alCerrar, alCompletar }) {
  const navegar = useNavigate()
  const enCurso = useRef(false)
  const intento = useRef(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const vista = useDatos(async () => {
    const actual = await repo.transferencias.vehiculo.detalle(transferencia.id)
    if (actual.estado !== 'pending' || !actual.liberadaEn) return { revision, actual }
    try {
      const conteos = await repo.transferencias.vehiculo.dependencias(actual)
      return { revision, actual, conteos }
    } catch (e) {
      if (e.estado === 403 || e.estado === 404) return { revision, actual, sinAcceso: true }
      throw e
    }
  }, [transferencia.id, revision])
  const datos = vista.estado === 'ok' && vista.datos?.revision === revision ? vista.datos : null
  const actual = datos?.actual
  const pendientes = dependenciasDeTransferencia(datos?.conteos)
  const tieneConteos = dependenciasConfirmadas(datos?.conteos)
  const siguePendiente = actual?.estado === 'pending' && actual.liberadaEn && !actual.aceptadaEn
  const permiteAceptar = siguePendiente && !pendientes.length && (tieneConteos || datos?.sinAcceso)

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
      <p className="pnl-entrega-unidad"><b>{rotulo}</b><span>{origen} → {destino}</span></p>
      {!datos && vista.estado !== 'error' && <Cargando filas={3} />}
      {vista.estado === 'error' && <p role="alert">No pudimos comprobar el estado de la solicitud. Actualiza la revisión.</p>}
      {actual?.estado === 'completed' && <p role="status">El servidor confirma que la transferencia se completó.</p>}
      {actual && ['rejected', 'cancelled'].includes(actual.estado) && <p role="status">La solicitud ya fue cerrada.</p>}
      {actual?.estado === 'pending' && !actual.liberadaEn && <p role="status">Falta que {origen} libere el vehículo.</p>}
      {siguePendiente && <>
        <p>Vehículo liberado en {origen}. Falta la aceptación de {destino}.</p>
        {pendientes.length > 0 && <div className="pnl-audit-detalle">
          <p role="status"><b>Aceptación bloqueada.</b> Hay operaciones activas en {origen}.</p>
          <ul className="pnl-entrega-pendientes">
            {pendientes.map(({ clave, texto, accion, vista }) => <li key={clave}>
              <span>{texto}</span>
              {empresaOrigen && <button type="button" className="pnl-btn sutil" disabled={ocupado} onClick={() => abrirExpediente(vista)}>{accion}</button>}
            </li>)}
          </ul>
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
        {(!actual || siguePendiente) && <button className="pnl-btn sutil" type="button" disabled={ocupado || vista.estado === 'cargando'} onClick={() => { setError(''); actualizar() }}>Actualizar revisión</button>}
        {permiteAceptar && <button className="pnl-btn primario" type="submit" disabled={ocupado}>{ocupado ? 'Comprobando…' : 'Aceptar en destino'}</button>}
      </div>
    </form>
  </Modal>
}
