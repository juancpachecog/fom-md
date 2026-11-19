import { useEffect, useRef, useState } from 'react'
import { Campo, Modal, Tag } from '../comp/ui'
import './empresas.css'
import { eliminacionEmpresas as api } from '../datos/eliminacionEmpresas'
import { AVISO_ELIMINACION_EMPRESA, AVISO_IMAGENES_PENDIENTES, eliminacionComprobada, estadoEliminacionEmpresa, puedeConfirmarEliminacion,
  problemaEliminacionEmpresa, resumenEliminacionEmpresa, validarSolicitudEmpresa } from '../datos/eliminacionEmpresasContrato'

/** Request state stays in memory. The pending-request list allows resuming a
 * long process without storing company names or typed confirmations locally. */
export default function EliminarEmpresa({ empresa, solicitudInicial, alCerrar, alComprobar }) {
  const [solicitud, setSolicitud] = useState(solicitudInicial || null)
  const [nombre, setNombre] = useState(''), [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false), [fiable, setFiable] = useState(false)
  const montado = useRef(true), version = useRef(0), actual = useRef(solicitudInicial || null)
  const enAccion = useRef(false), clave = useRef(crypto.randomUUID()), notificada = useRef('')

  const aplicar = dato => {
    validarSolicitudEmpresa(dato, empresa.id)
    actual.current = dato; setSolicitud(dato); setFiable(true); setError('')
    const hito = `${dato.requestId}:${dato.liveDeleted}:${eliminacionComprobada(dato, empresa.id)}`
    if (dato.liveDeleted && notificada.current !== hito) {
      notificada.current = hito
      alComprobar?.(dato)
    }
  }
  useEffect(() => {
    montado.current = true
    let timer, leyendo = false, cancelado = false
    ++version.current
    const siguiente = () => {
      if (!cancelado && actual.current?.status !== 'cancelled' && !eliminacionComprobada(actual.current, empresa.id)) timer = setTimeout(cargar, 3000)
    }
    async function cargar() {
      if (cancelado) return
      if (leyendo || enAccion.current) { siguiente(); return }
      leyendo = true
      const lectura = version.current
      try {
        const id = actual.current?.requestId
        const r = id ? await api.leer(id) : await api.preparar(empresa.id, clave.current)
        if (!cancelado && montado.current && version.current === lectura) aplicar(r)
      } catch (e) {
        if (!cancelado && montado.current && version.current === lectura) { setFiable(false); setError(e.message) }
      } finally {
        leyendo = false
        siguiente()
      }
    }
    cargar()
    return () => { cancelado = true; montado.current = false; clearTimeout(timer); version.current++ }
  }, [empresa.id, solicitud?.requestId])

  async function consultar() {
    if (enAccion.current || !actual.current?.requestId) return
    const lectura = ++version.current
    setOcupado(true); enAccion.current = true; setFiable(false)
    try { const r = await api.leer(actual.current.requestId); if (montado.current && version.current === lectura) aplicar(r) }
    catch (e) { if (montado.current) setError(e.message) }
    finally { if (montado.current) setOcupado(false); enAccion.current = false }
  }

  async function confirmar(e) {
    e.preventDefault()
    if (enAccion.current || !fiable || !puedeConfirmarEliminacion(actual.current, empresa.id, nombre)) return
    const id = actual.current.requestId, plan = actual.current.planSha256
    const lectura = ++version.current
    setOcupado(true); enAccion.current = true; setFiable(false); setError('')
    let fallo = ''
    try {
      try { await api.confirmar(empresa.id, id, plan, nombre) } catch (e) { fallo = e.message }
      // A separate GET resolves a lost response; never create another request.
      const r = await api.leer(id)
      if (montado.current && version.current === lectura) {
        aplicar(r)
        if (fallo && r.status === 'ready') setError(fallo)
        setNombre('')
      }
    } catch {
      if (montado.current) setError('No se pudo comprobar el resultado. Consulta el estado antes de repetir la confirmación.')
    } finally { if (montado.current) setOcupado(false); enAccion.current = false }
  }

  async function cerrar() {
    if (enAccion.current) return
    if (!actual.current || !['reviewing', 'ready', 'blocked'].includes(actual.current.status) || actual.current.confirmedAt) { alCerrar(); return }
    const lectura = ++version.current
    setOcupado(true); enAccion.current = true; setFiable(false)
    try {
      try { await api.cancelar(empresa.id, actual.current.requestId) } catch { /* The read decides. */ }
      const r = await api.leer(actual.current.requestId)
      if (montado.current && version.current === lectura) {
        aplicar(r)
        if (r.status === 'cancelled') alCerrar()
        else setError('La revisión no quedó cancelada. Consulta su estado; no se repetirá la eliminación.')
      }
    } catch { if (montado.current) setError('No se pudo comprobar la cancelación. Consulta el estado antes de repetir.') }
    finally { if (montado.current) setOcupado(false); enAccion.current = false }
  }

  async function revisarOtraVez() {
    if (enAccion.current || actual.current?.confirmedAt) return
    const lectura = ++version.current
    setOcupado(true); enAccion.current = true; setFiable(false); setError('')
    try {
      if (actual.current?.requestId) {
        try { await api.cancelar(empresa.id, actual.current.requestId) } catch { /* Check the same request. */ }
        const r = await api.leer(actual.current.requestId)
        if (r.status !== 'cancelled') { if (montado.current && version.current === lectura) aplicar(r); return }
      }
      clave.current = crypto.randomUUID()
      const r = await api.preparar(empresa.id, clave.current)
      if (montado.current && version.current === lectura) { aplicar(r); setNombre('') }
    } catch (e) { if (montado.current) setError(e.message) }
    finally { if (montado.current) setOcupado(false); enAccion.current = false }
  }

  const final = fiable && eliminacionComprobada(solicitud, empresa.id)
  const revisando = !solicitud || solicitud.status === 'reviewing'
  const lista = solicitud?.status === 'ready'
  const enCurso = ['queued', 'deleting_live', 'sanitizing_backups'].includes(solicitud?.status)
  const empresaNombre = final ? 'Empresa eliminada' : solicitud?.companyName || empresa.nombre || 'Empresa seleccionada'
  return <Modal abierto titulo="Eliminar empresa" alCerrar={cerrar} ancho={560}>
    <div className="emp-eliminacion">
      <p className="emp-eliminacion-nombre">{empresaNombre}</p>
      {!final && <div className="emp-eliminacion-aviso"><p>{AVISO_ELIMINACION_EMPRESA}</p><p>{AVISO_IMAGENES_PENDIENTES}</p></div>}
      <Tag color={final ? 'verde' : solicitud?.status === 'blocked' ? 'rojo' : 'azul'}>{final ? 'Eliminación comprobada' : estadoEliminacionEmpresa(solicitud?.status || 'reviewing')}</Tag>
      {revisando && <p role="status">Comprobando los datos de la empresa y las copias que puedan contenerlos. Esta revisión todavía no elimina datos.</p>}
      {lista && <>
        <p>La información de otras empresas se conserva.</p>
        <dl className="emp-eliminacion-resumen">{resumenEliminacionEmpresa(solicitud).map(([label, cantidad]) => <div key={label}><dt>{label}</dt><dd>{cantidad.toLocaleString('es-VE')}</dd></div>)}</dl>
        <p>{Number.isSafeInteger(solicitud.copiesTotal) ? `${solicitud.copiesTotal.toLocaleString('es-VE')} copias por comprobar.` : 'Inventario de copias pendiente de comprobar.'}</p>
        <form onSubmit={confirmar}>
          <Campo etiqueta="Escribe el nombre completo de la empresa para confirmar"><input className="pnl-input" value={nombre} onChange={e => setNombre(e.target.value)} maxLength={160} autoComplete="off" disabled={ocupado} /></Campo>
          <div className="emp-form-acciones"><button type="button" className="pnl-btn" disabled={ocupado} onClick={cerrar}>Cancelar</button><button type="submit" className="pnl-btn primario peligro" disabled={ocupado || !fiable || !puedeConfirmarEliminacion(solicitud, empresa.id, nombre)}>{ocupado ? 'Comprobando…' : 'Eliminar empresa'}</button></div>
        </form>
      </>}
      {enCurso && <p role="status">{solicitud.liveDeleted ? 'La empresa ya no está en la operación. Falta comprobar que no queden sus datos en los respaldos.' : 'Se está procesando la eliminación. Todavía no se ha comprobado el resultado completo.'} Copias comprobadas: {solicitud.copiesVerified || 0} de {solicitud.copiesTotal || 0}.</p>}
      {solicitud?.failureCode && <p role="alert">{problemaEliminacionEmpresa(solicitud.failureCode)}</p>}
      {solicitud && !solicitud.confirmedAt && !solicitud.canConfirm && ['ready', 'blocked', 'cancelled'].includes(solicitud.status) && <button type="button" className="pnl-btn" disabled={ocupado} onClick={revisarOtraVez}>Revisar de nuevo</button>}
      {final && <p role="status">La empresa y sus datos se eliminaron de la aplicación y de los respaldos comprobados.</p>}
      {error && <p className="emp-error" role="alert">{error}</p>}
      {!lista && <div className="emp-form-acciones"><button type="button" className="pnl-btn" disabled={ocupado} onClick={cerrar}>{enCurso || final ? 'Cerrar' : 'Cancelar'}</button>{solicitud && !final && <button type="button" className="pnl-btn" disabled={ocupado} onClick={consultar}>Consultar estado</button>}</div>}
    </div>
  </Modal>
}
