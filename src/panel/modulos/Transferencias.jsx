import { useEffect, useState } from 'react'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { Cabecera, Campo, Cargando, Chips, ErrorCarga, Modal, Pestanas, Tag, Tarjeta, Vacio } from '../comp/ui'
import * as f from '../datos/formato'
import { esAdminFom } from '../roles'
import { Icono } from '../Iconos'

// ============================================================
// TRANSFERENCIAS ENTRE ENTES (doble control)
// ------------------------------------------------------------
// Mover una persona o un vehículo de una empresa a otra no es editar un
// campo: el empresa de origen la libera y el de destino la acepta, y hasta
// que no pasan las dos cosas no se completa. Cualquiera de los dos puede
// rechazarla y quien la abrió puede cancelarla. Cada decisión viaja con la
// versión que se vio, para que dos personas no se pisen.
// ============================================================

const ESTADO = { pending: ['En curso', 'ambar'], completed: ['Completada', 'verde'], rejected: ['Rechazada', 'rojo'], cancelled: ['Cancelada', 'gris'] }
const ROLES_DESTINO = [['conductor', 'Conductor'], ['usuario', 'Usuario']]
const PIE = { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }

function paso(t) {
  if (t.estado !== 'pending') return null
  if (!t.liberadaEn) return { clave: 'origin-release', texto: 'Liberar en origen' }
  if (!t.aceptadaEn) return { clave: 'destination-acceptance', texto: 'Aceptar en destino' }
  return null
}

/**
 * El servidor responde 403 («Transfer not authorized») cuando la base niega la operación. Con el
 * administrador FOM pasa en producción porque ahí todavía corre una regla vieja: solo deja mover
 * personas o vehículos de una empresa donde el administrador tenga membresía propia. El arreglo
 * (fom-core #632, Issue #631) ya está en el código de Juan pero no se ha publicado.
 */
const explicar = (mensaje) =>
  /permiso/i.test(String(mensaje ?? ''))
    ? 'El servidor de producción no dejó hacer este paso. No es tu cuenta ni la pantalla: producción todavía tiene una regla vieja que solo deja mover personas y vehículos de una empresa donde el administrador FOM sea miembro. El arreglo ya está hecho en el servidor (fom-core #632) y falta que Juan lo publique.'
    : mensaje

export default function Transferencias() {
  const sesion = useSesion()
  const actor = sesion?.perfil
  const [pestana, setPestana] = useState('identidad')
  const [estado, setEstado] = useState('pending')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [creando, setCreando] = useState(false)
  const [seleccionId, setSeleccionId] = useState(null)
  const [cerrando, setCerrando] = useState(null) // { t, paso }

  const lista = useDatos(
    () => (pestana === 'identidad' ? repo.transferencias.identidad.listar({ estado }) : repo.transferencias.vehiculo.listar({ estado })),
    [pestana, estado],
  )
  const empresas = useDatos(() => repo.admin.empresas.listar({}), [])
  const nombreEmpresa = (id) => empresas.datos?.find((e) => e.id === id)?.nombre ?? id?.slice(0, 8) ?? '—'

  async function actuar(fn, exito) {
    setOcupado(true)
    setAviso('')
    try {
      await fn()
      setAviso(exito)
      lista.recargar()
      return true
    } catch (e) {
      setAviso(explicar(e?.message) || 'No se pudo completar la acción.')
      return false
    } finally {
      setOcupado(false)
    }
  }
  const seleccion = lista.datos?.find(t => t.id === seleccionId) ?? lista.datos?.[0]
  const modulo = () => (pestana === 'identidad' ? repo.transferencias.identidad : repo.transferencias.vehiculo)

  return (
    <>
      <Cabecera titulo="Transferencias" bajada="Personas y vehículos que cambian de empresa, con liberación en origen y aceptación en destino.">
        <button type="button" className="pnl-btn primario" onClick={() => setCreando(true)}>
          <Icono nombre="mas" tam={16} />
          {pestana === 'identidad' ? 'Transferir persona' : 'Transferir vehículo'}
        </button>
      </Cabecera>

      <div className="pnl-cuerpo">
        {aviso && <p className="pnl-campo-error" role="status">{aviso}</p>}
        <Pestanas opciones={[{ v: 'identidad', t: 'Personas' }, { v: 'vehiculo', t: 'Vehículos' }]} valor={pestana} alCambiar={setPestana} />

        <div className="pnl-admin-dividido"><Tarjeta titulo={pestana === 'identidad' ? 'Transferencias de personas' : 'Transferencias de vehículos'} sinCuerpo>
          <div className="pnl-card-cuerpo">
            <Chips
              opciones={[{ v: 'pending', t: 'En curso' }, { v: 'completed', t: 'Completadas' }, { v: 'rejected', t: 'Rechazadas' }, { v: 'cancelled', t: 'Canceladas' }, { v: '', t: 'Todas' }]}
              valor={estado}
              alCambiar={setEstado}
            />
          </div>
          {lista.estado === 'cargando' && <Cargando filas={4} />}
          {lista.estado === 'error' && <ErrorCarga onReintentar={lista.recargar} error={{ message: explicar(lista.error?.message) }} />}
          {lista.estado === 'ok' && (lista.datos.length === 0 ? (
            <div className="pnl-card-cuerpo">
              <Vacio icono="comparar" titulo="Sin transferencias" texto="No hay movimientos entre empresas con este filtro." />
            </div>
          ) : (
            <div className="pnl-filas">
              {lista.datos.map((t) => {
                const [esT, esC] = ESTADO[t.estado] ?? [t.estado, 'gris']
                const siguiente = paso(t)
                return (
                  <div className={`pnl-fila pnl-transfer-card${seleccion?.id === t.id ? ' seleccionada' : ''}`} key={t.id}>
                    <Icono nombre={pestana === 'identidad' ? 'gente' : 'camion'} tam={18} />
                    <div className="pnl-fila-txt">
                      <b>
                        {nombreEmpresa(t.origenId)} → {nombreEmpresa(t.destinoId)}
                        {t.rolDestino ? ` · llega como ${t.rolDestino}` : ''}
                        {t.codigoDestino ? ` · código ${t.codigoDestino}` : ''}
                      </b>
                      <span>
                        {t.motivo} · abierta {f.desde(t.creadaEn)}
                        {t.liberadaEn ? ` · liberada ${f.desde(t.liberadaEn)}` : ''}
                        {t.aceptadaEn ? ` · aceptada ${f.desde(t.aceptadaEn)}` : ''}
                        {t.completadaEn ? ` · completada ${f.desde(t.completadaEn)}` : ''}
                      </span>
                    </div>
                    <Tag color={esC}>{esT}</Tag>
                    <button className="pnl-btn sutil" onClick={()=>setSeleccionId(t.id)} aria-pressed={seleccion?.id === t.id}>Ver detalle</button>
                    {siguiente && (
                      <button type="button" className="pnl-btn primario" disabled={ocupado} onClick={() => actuar(() => modulo().decidir(t, siguiente.clave), 'Paso registrado.')}>
                        {siguiente.texto}
                      </button>
                    )}
                    {t.estado === 'pending' && (
                      <>
                        <button type="button" className="pnl-btn sutil" disabled={ocupado} onClick={() => setCerrando({ t, paso: 'rejection' })}>Rechazar</button>
                        <button type="button" className="pnl-btn sutil" disabled={ocupado} onClick={() => setCerrando({ t, paso: 'cancellation' })}>Cancelar</button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </Tarjeta><aside className="pnl-admin-detalle"><Tarjeta titulo="Detalle de la transferencia">
          {seleccion ? <><h3>{nombreEmpresa(seleccion.origenId)} <span aria-hidden="true">→</span> {nombreEmpresa(seleccion.destinoId)}</h3><Tag color={ESTADO[seleccion.estado]?.[1] ?? 'gris'}>{ESTADO[seleccion.estado]?.[0] ?? seleccion.estado}</Tag>
            <ol className="pnl-transfer-pasos">
              <li className="hecho"><i>1</i><div><b>Solicitud</b><span>{f.fechaHora(seleccion.creadaEn)}</span></div></li>
              <li className={seleccion.liberadaEn ? 'hecho' : ''}><i>2</i><div><b>Liberación en origen</b><span>{seleccion.liberadaEn ? f.fechaHora(seleccion.liberadaEn) : 'Pendiente'}</span></div></li>
              <li className={seleccion.aceptadaEn ? 'hecho' : ''}><i>3</i><div><b>Aceptación en destino</b><span>{seleccion.aceptadaEn ? f.fechaHora(seleccion.aceptadaEn) : 'Pendiente'}</span></div></li>
            </ol>
            <div className="pnl-audit-detalle"><b>Motivo</b><p>{seleccion.motivo}</p>{seleccion.rolDestino && <p>Rol en destino: {seleccion.rolDestino}</p>}</div>
          </> : <Vacio icono="comparar" titulo="Sin transferencias" texto="Cuando exista una solicitud podrás consultar sus pasos aquí." />}
        </Tarjeta></aside></div>
      </div>

      {creando && <ModalNueva
        key={pestana}
        tipo={pestana}
        abierto={creando}
        empresas={empresas.datos ?? []}
        admin={esAdminFom(actor)}
        alCerrar={() => setCreando(false)}
        guardar={(datos) => actuar(() => modulo().crear(datos), 'Transferencia abierta: falta que origen libere y destino acepte.')}
      />}
      <ModalCierre cierre={cerrando} alCerrar={() => setCerrando(null)} confirmar={(motivo) => actuar(() => modulo().decidir(cerrando.t, cerrando.paso, motivo), cerrando.paso === 'rejection' ? 'Transferencia rechazada.' : 'Transferencia cancelada.')} />
    </>
  )
}

function ModalNueva({ tipo, abierto, empresas, admin, alCerrar, guardar }) {
  const [d, setD] = useState({ sujeto: '', origenId: '', destinoId: '', rolDestino: 'conductor', codigoDestino: '', motivo: '' })
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const set = (k) => (e) => setD((x) => ({ ...x, [k]: e.target.value }))
  const [opciones, setOpciones] = useState([])
  const [cargando, setCargando] = useState(false)
  const [errorCarga, setErrorCarga] = useState('')
  const [intento, setIntento] = useState(0)
  useEffect(() => {
    let vigente = true
    setOpciones([])
    setErrorCarga('')
    if (!d.origenId) { setCargando(false); return }
    setCargando(true)
    repo.transferencias.opciones({ tipo, origenId: d.origenId })
      .then(lista => { if (vigente) setOpciones(lista) })
      .catch(e => { if (vigente) setErrorCarga(e.message || 'No se pudo cargar la empresa.') })
      .finally(() => { if (vigente) setCargando(false) })
    return () => { vigente = false }
  }, [tipo, d.origenId, intento])
  const opcionesOrigen = opciones.filter(o => o.empresaId === d.origenId)

  async function confirmar() {
    if (!d.origenId) return setError('Elige primero la empresa de origen.')
    if (cargando || errorCarga || !opcionesOrigen.some(o => o.id === d.sujeto)) return setError(tipo === 'identidad' ? 'Elige la persona.' : 'Elige el vehículo.')
    if (!d.origenId || !d.destinoId || d.origenId === d.destinoId) return setError('Origen y destino tienen que ser empresas distintos.')
    if (tipo === 'vehiculo' && !d.codigoDestino.trim()) return setError('Di el código que tendrá el vehículo en el destino.')
    if (d.motivo.trim().length < 3) return setError('Escribe el motivo.')
    setGuardando(true)
    setError('')
    const ok = await guardar(
      tipo === 'identidad'
        ? { usuarioId: d.sujeto, origenId: d.origenId, destinoId: d.destinoId, rolDestino: d.rolDestino, motivo: d.motivo }
        : { vehiculoId: d.sujeto, origenId: d.origenId, destinoId: d.destinoId, codigoDestino: d.codigoDestino.trim(), motivo: d.motivo },
    )
    setGuardando(false)
    if (ok) alCerrar()
  }

  return (
    <Modal titulo={tipo === 'identidad' ? 'Transferir una persona' : 'Transferir un vehículo'} abierto={abierto} alCerrar={alCerrar} ancho={560}>
      <Campo etiqueta="Empresa de origen" ayuda="Primero elige la empresa de la que sale la transferencia." error={error}>
        <select className="pnl-input" value={d.origenId} disabled={guardando} onChange={e => {
          const origenId = e.target.value
          setD(x => ({ ...x, origenId, sujeto: '', destinoId: '', codigoDestino: '' }))
          setOpciones([])
          setCargando(Boolean(origenId))
          setError('')
        }}>
          <option value="">Elige la empresa de origen…</option>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
      </Campo>
      {d.origenId && <Campo etiqueta={tipo === 'identidad' ? 'Persona de esta empresa' : 'Vehículo de esta empresa'}>
        <select className="pnl-input" value={d.sujeto} disabled={guardando || cargando || Boolean(errorCarga) || !opcionesOrigen.length} onChange={set('sujeto')}>
          <option value="">{cargando ? 'Cargando…' : opcionesOrigen.length ? 'Elige…' : 'No hay elementos disponibles'}</option>
          {opcionesOrigen.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
        {errorCarga && <p role="alert" className="pnl-campo-error">{errorCarga} <button type="button" className="pnl-btn sutil" onClick={() => setIntento(x => x + 1)}>Reintentar</button></p>}
        {!cargando && !errorCarga && !opcionesOrigen.length && <p role="status">{tipo === 'identidad' ? 'Esta empresa no tiene personas disponibles para transferir.' : 'Esta empresa no tiene vehículos disponibles para transferir.'}</p>}
      </Campo>}
      <Campo etiqueta="Empresa de destino">
        <select className="pnl-input" value={d.destinoId} onChange={set('destinoId')} disabled={guardando || !d.sujeto}>
          <option value="">Elige la empresa de destino…</option>
          {empresas.filter(e => e.id !== d.origenId && e.servicioActivo).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
      </Campo>
      {tipo === 'identidad' ? (
        <Campo etiqueta="Rol en el destino" ayuda={admin ? 'Solo el administrador FOM puede entregar a alguien como supervisor.' : undefined}>
          <select className="pnl-input" value={d.rolDestino} onChange={set('rolDestino')}>
            {(admin ? [['supervisor', 'Supervisor'], ...ROLES_DESTINO] : ROLES_DESTINO).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </Campo>
      ) : (
        <Campo etiqueta="Código en el destino" ayuda="El alias con el que la unidad existirá en la otra empresa.">
          <input className="pnl-input" value={d.codigoDestino} onChange={set('codigoDestino')} placeholder="vm-xx-000" />
        </Campo>
      )}
      <Campo etiqueta="Motivo">
        <input className="pnl-input" value={d.motivo} onChange={set('motivo')} placeholder="Cambio de contrato" />
      </Campo>
      <div style={PIE}>
        <button type="button" className="pnl-btn sutil" onClick={alCerrar} disabled={guardando}>Cancelar</button>
        <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={guardando || cargando || Boolean(errorCarga) || !d.sujeto || !d.destinoId}>{guardando ? 'Abriendo…' : 'Abrir transferencia'}</button>
      </div>
    </Modal>
  )
}

function ModalCierre({ cierre, alCerrar, confirmar }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  async function ok() {
    if (motivo.trim().length < 3) return setError('Escribe el motivo: queda en el historial.')
    setGuardando(true)
    setError('')
    const bien = await confirmar(motivo.trim())
    setGuardando(false)
    if (bien) {
      setMotivo('')
      alCerrar()
    }
  }
  return (
    <Modal titulo={cierre?.paso === 'rejection' ? 'Rechazar la transferencia' : 'Cancelar la transferencia'} abierto={Boolean(cierre)} alCerrar={alCerrar} ancho={460}>
      <Campo etiqueta="Motivo" error={error}>
        <textarea className="pnl-input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </Campo>
      <div style={PIE}>
        <button type="button" className="pnl-btn sutil" onClick={alCerrar} disabled={guardando}>Volver</button>
        <button type="button" className="pnl-btn primario" onClick={ok} disabled={guardando}>{guardando ? 'Guardando…' : 'Confirmar'}</button>
      </div>
    </Modal>
  )
}
