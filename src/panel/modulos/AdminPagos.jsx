import { useState } from 'react'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import {
  Cabecera, Campo, Cargando, Chips, Datos, ErrorCarga, Kpi, Modal, Tag, Tarjeta, Vacio,
} from '../comp/ui'
import * as f from '../datos/formato'
import { masNuevoPrimero } from '../datos/orden'
import { color, etiqueta } from '../datos/catalogos'
import { Icono } from '../Iconos'
import { useConfirmar } from '../comp/Confirmar'

// ============================================================
// PAGOS DEL SERVICIO (solo Administrador FOM)
// La facturación de FOM a cada empresa: lo vencido arriba, y el registro
// de cada cuota con su estado.
// ============================================================

function cargar(empresaId, estadoPago) {
  return Promise.all([
    repo.admin.pagos.listar({}),
    repo.admin.empresas.listar({}),
  ]).then(([todos, empresas]) => ({
    todos,
    // La cuota más nueva arriba, por su período («2026-08»); sin período, por cuándo se registró.
    lista: masNuevoPrimero(todos.filter(p => (!empresaId || p.empresaId === empresaId) && (!estadoPago || p.estado === estadoPago)), (p) => (p.periodo ? `${p.periodo}-01` : p.creadaEn)),
    empresas: empresas.filter((e) => !e.respaldo),
  }))
}

export default function AdminPagos() {
  const sesion = useSesion()
  const actor = sesion?.perfil
  const [empresaId, setEmpresaId] = useState('')
  const [estadoPago, setEstadoPago] = useState('')
  const [registrando, setRegistrando] = useState(false)
  const [aviso, setAviso] = useState('')
  const { confirmar, dialogo } = useConfirmar()

  const { datos, estado, error, recargar } = useDatos(() => cargar(empresaId, estadoPago), [empresaId, estadoPago])

  const cambiarEstado = async (p, nuevo) => {
    const pagado = nuevo === 'pagado'
    // Al marcar pagada se pide la referencia en el mismo diálogo (antes un prompt aparte).
    const respuesta = await confirmar({
      titulo: pagado ? 'Marcar cuota pagada' : 'Marcar cuota vencida',
      texto: pagado
        ? `¿Marcar pagada la cuota ${p.periodo} de ${p.empresaNombre}?`
        : `¿Marcar vencida la cuota ${p.periodo} de ${p.empresaNombre}?`,
      accion: pagado ? 'Marcar pagada' : 'Marcar vencida',
      peligro: !pagado,
      campo: pagado ? { etiqueta: 'Referencia del abono recibido (no realiza un cobro bancario):', obligatorio: true } : undefined,
    })
    if (!respuesta) return
    const referencia = pagado ? respuesta : undefined
    setAviso('')
    repo.admin.pagos.actualizarEstado(p.id, nuevo, actor, { ...p, referencia }).then(recargar).catch((e) => setAviso(e.message))
  }

  return (
    <>
      {dialogo}
      <Cabecera
        titulo="Facturación"
        bajada="Registro administrativo de cuotas y pagos informados. Esta web no procesa cobros ni mueve dinero."
      >
        <button type="button" className="pnl-btn primario" onClick={() => setRegistrando(true)}>
          <Icono nombre="mas" tam={16} />
          Registrar cuota
        </button>
      </Cabecera>

      <div className="pnl-cuerpo">
        {estado === 'cargando' && <Cargando filas={6} />}
        {estado === 'error' && <ErrorCarga onReintentar={recargar} error={error} />}
        {estado === 'ok' && (
          <Contenido
            datos={datos}
            empresaId={empresaId}
            setEmpresaId={setEmpresaId}
            estadoPago={estadoPago}
            setEstadoPago={setEstadoPago}
            aviso={aviso}
            cambiarEstado={cambiarEstado}
          />
        )}
      </div>

      {estado === 'ok' && (
        <ModalRegistrar
          abierto={registrando}
          empresas={datos.empresas}
          alCerrar={() => setRegistrando(false)}
          alGuardar={recargar}
          actor={actor}
        />
      )}
    </>
  )
}

function Contenido({ datos, empresaId, setEmpresaId, estadoPago, setEstadoPago, aviso, cambiarEstado }) {
  const { todos, lista, empresas } = datos
  const [seleccionId, setSeleccionId] = useState(null)
  const seleccion = lista.find(p => p.id === seleccionId) ?? lista[0]

  const suma = (e) => todos.filter((p) => p.estado === e && p.moneda === 'USD').reduce((a, p) => a + (e === 'pagado' ? p.monto : p.saldo ?? p.monto), 0)
  const cuenta = (e) => (e ? todos.filter((p) => p.estado === e).length : todos.length)

  return (
    <>
      <div className="pnl-grid k4">
        <Kpi titulo="Vencido (USD)" valor={f.moneda(suma('vencido'))} icono="alerta" tono={suma('vencido') > 0 ? 'malo' : 'ok'} nota={f.cantidad(cuenta('vencido'), 'cuota vencida', 'cuotas vencidas')} />
        <Kpi titulo="Pendiente (USD)" valor={f.moneda(suma('pendiente'))} icono="reloj" tono={suma('pendiente') > 0 ? 'aviso' : 'ok'} nota={`${cuenta('pendiente')} por cobrar`} />
        <Kpi titulo="Cobrado (USD)" valor={f.moneda(suma('pagado'))} icono="check" tono="ok" nota={f.cantidad(cuenta('pagado'), 'cuota pagada', 'cuotas pagadas')} />
        <Kpi titulo="Cuotas registradas" valor={todos.length} icono="costos" nota="En todo el sistema" />
      </div>

      {aviso && <p className="pnl-campo-error" role="alert">{aviso}</p>}

      <div className="pnl-admin-dividido"><Tarjeta
        titulo="Registro de cuotas"
        accion={
          <select
            className="pnl-input"
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            aria-label="Filtrar por empresa"
          >
            <option value="">Todas las empresas</option>
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
        }
        sinCuerpo
      >
        <div className="pnl-card-cuerpo">
          <Chips
            opciones={[
              { v: '', t: 'Todas', n: cuenta('') },
              { v: 'vencido', t: 'Vencidas', n: cuenta('vencido') },
              { v: 'pendiente', t: 'Pendientes', n: cuenta('pendiente') },
              { v: 'pagado', t: 'Pagadas', n: cuenta('pagado') },
            ]}
            valor={estadoPago}
            alCambiar={setEstadoPago}
          />
        </div>

        {lista.length === 0 ? (
          <div className="pnl-card-cuerpo">
            <Vacio icono="costos" titulo="Sin cuotas que mostrar" texto="Prueba con otro filtro o registra la primera cuota." />
          </div>
        ) : (
          <div className="pnl-tabla-wrap">
            <table className="pnl-tabla">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Período</th>
                  <th className="num">Monto</th>
                  <th>Estado</th>
                  <th>Pagado el</th>
                  <th>Nota</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.id} className={seleccion?.id === p.id ? 'seleccionada' : ''}>
                    <td><button className="pnl-table-action" onClick={() => setSeleccionId(p.id)} aria-pressed={seleccion?.id === p.id}>{p.empresaNombre}</button></td>
                    <td>{p.periodo}</td>
                    <td className="num"><b>{f.moneda(p.monto)}</b> {p.moneda}</td>
                    <td>
                      <Tag color={color('pago_estado', p.estado)}>{etiqueta('pago_estado', p.estado)}</Tag>
                    </td>
                    <td>{p.pagadoEn ? f.fecha(p.pagadoEn) : '—'}</td>
                    <td>{p.nota || '—'}</td>
                    <td className="num">
                      <div className="pnl-chips">
                        {['pendiente', 'vencido'].includes(p.estado) && (
                          <button type="button" className="pnl-btn sutil" onClick={() => cambiarEstado(p, 'pagado')}>
                            <Icono nombre="check" tam={14} />
                            Pagada
                          </button>
                        )}
                        {p.estado === 'pendiente' && (
                          <button type="button" className="pnl-btn sutil" onClick={() => cambiarEstado(p, 'vencido')}>
                            Vencida
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta><aside className="pnl-admin-detalle"><Tarjeta titulo="Detalle de la cuota">
        {seleccion ? <><h3>{seleccion.empresaNombre}</h3><Tag color={color('pago_estado',seleccion.estado)}>{etiqueta('pago_estado',seleccion.estado)}</Tag>
        <Datos items={[{etiqueta:'Período',valor:seleccion.periodo},{etiqueta:'Monto',valor:f.moneda(seleccion.monto)},{etiqueta:'Moneda',valor:seleccion.moneda},{etiqueta:'Pagado el',valor:seleccion.pagadoEn ? f.fecha(seleccion.pagadoEn) : 'Pendiente'},{etiqueta:'Nota',valor:seleccion.nota || '—'}]} />
        <div className="pnl-chips">{['pendiente', 'vencido'].includes(seleccion.estado) && <button className="pnl-btn primario" onClick={()=>cambiarEstado(seleccion,'pagado')}>Marcar pagada</button>}{seleccion.estado === 'pendiente' && <button className="pnl-btn" onClick={()=>cambiarEstado(seleccion,'vencido')}>Marcar vencida</button>}</div></> : <Vacio icono="costos" titulo="Sin cuota seleccionada" texto="Aquí verás su período, monto y estado." />}
      </Tarjeta></aside></div>
    </>
  )
}

function ModalRegistrar({ abierto, empresas, alCerrar, alGuardar, actor }) {
  const [empresaId, setEmpresaId] = useState('')
  const [periodo, setPeriodo] = useState('')
  const [monto, setMonto] = useState('')
  const [venceEn, setVenceEn] = useState('')
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cerrar = () => {
    setEmpresaId(''); setPeriodo(''); setMonto(''); setNota(''); setError('')
    alCerrar()
  }

  const confirmar = async () => {
    setGuardando(true)
    setError('')
    try {
      await repo.admin.pagos.registrar({ empresaId, monto: Number(monto), periodo, venceEn, nota }, actor)
      await alGuardar()
      cerrar()
    } catch (e) {
      setError(e.message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal titulo="Registrar cuota" abierto={abierto} alCerrar={cerrar} ancho={480}>
      <Campo etiqueta="Empresa" error={error}>
        <select className="pnl-input" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
          <option value="">Selecciona el empresa…</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.nombre}</option>
          ))}
        </select>
      </Campo>
      <Campo etiqueta="Período" ayuda="La cuota mensual del servicio.">
        <input type="month" className="pnl-input" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
      </Campo>
      <Campo etiqueta="Monto (USD)">
        <input type="number" min="1" className="pnl-input" value={monto} onChange={(e) => setMonto(e.target.value)} placeholder="780" />
      </Campo>
      <Campo etiqueta="Fecha de vencimiento"><input aria-label="Fecha de vencimiento" type="date" className="pnl-input" value={venceEn} onChange={e => setVenceEn(e.target.value)} /></Campo>
      <Campo etiqueta="Nota (opcional)">
        <input type="text" className="pnl-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Transferencia, referencia…" />
      </Campo>

      <div className="pnl-chips">
        <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={guardando}>
          <Icono nombre="check" tam={16} />
          {guardando ? 'Registrando…' : 'Registrar'}
        </button>
        <button type="button" className="pnl-btn sutil" onClick={cerrar} disabled={guardando}>
          Cancelar
        </button>
      </div>
    </Modal>
  )
}
