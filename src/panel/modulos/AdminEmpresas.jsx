import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { entrarEmpresa } from '../auth'
import repo, { DIRECTORIO_REAL } from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import {
  Buscador, Cabecera, Campo, Cargando, Chips, ErrorCarga, Modal, Tag, Vacio,
} from '../comp/ui'
import * as f from '../datos/formato'
import { COMPANY_TIPO, etiqueta } from '../datos/catalogos'
import { Icono } from '../Iconos'
import LogoEmpresa from '../comp/LogoEmpresa'
import { useConfirmar } from '../comp/Confirmar'
import { subirLogoDeEmpresa } from '../datos/logos'
import {
  armarUsuarioResponsable, generarClaveTemporal, normalizarTelefono, problemaDelResponsable, textoDeError,
} from '../datos/responsableEmpresa'
import './empresas.css'

// ============================================================
// EMPRESAS (solo Administrador FOM)
// La capa multiempresa: cada empresa del sistema con su gente, su flota,
// su deuda y el estado del servicio.
// ============================================================

function cargar(q, tipo) {
  return repo.admin.empresas.listar({ q, tipo })
}

export default function AdminEmpresas() {
  const navegar = useNavigate()
  const sesion = useSesion()
  const actor = sesion?.perfil
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState('')
  const [creando, setCreando] = useState(false)
  const [predeDe, setPredeDe] = useState(null) // empresa cuyo listado de compañías se edita
  const [aviso, setAviso] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [seleccionId, setSeleccionId] = useState(null)
  const [servicio, setServicio] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [confirmacion, setConfirmacion] = useState('')
  const { confirmar, dialogo } = useConfirmar()

  const seleccionarEmpresa = (id) => {
    setSeleccionId(id)
    setAviso('')
  }

  const gestionar = async (empresa) => {
    if (entrando || ocupado) return
    setEntrando(true)
    setAviso('')
    try {
      await entrarEmpresa(empresa)
      navegar('/panel')
    } catch (e) {
      setAviso(textoDeError(e))
    } finally {
      setEntrando(false)
    }
  }

  const { datos, estado, error, recargar } = useDatos(() => cargar('', ''), [])
  const lista = useMemo(() => (datos ?? []).filter(e =>
    (!tipo || e.tipo === tipo) &&
    (!servicio || !e.respaldo && (servicio === 'activo' ? e.servicioActivo : !e.servicioActivo)) &&
    (!q.trim() || [e.nombre, e.rif, e.contacto, e.email, e.telefono].some(v => String(v ?? '').toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())))
  ), [datos, q, tipo, servicio])

  const accion = async (fn, mensaje) => {
    if (ocupado || entrando) return
    setOcupado(true)
    setAviso('')
    setConfirmacion('')
    try {
      await fn()
      await recargar()
      setConfirmacion(mensaje)
    } catch (e) {
      setAviso(textoDeError(e))
    } finally { setOcupado(false) }
  }
  // Cada empresa tiene su logo y se ve de una vez al entrar; FOM Operations usa el de FOM.
  const subirLogo = (e, archivo) => accion(() => subirLogoDeEmpresa(e.id, archivo), `Logo de ${e.nombre} guardado.`)

  const alternarServicio = async (e) => {
    const suspender = e.servicioActivo
    const verbo = suspender ? 'suspender' : 'reactivar'
    if (!await confirmar({
      titulo: suspender ? 'Suspender servicio' : 'Reactivar servicio',
      texto: `¿Seguro que quieres ${verbo} el servicio de ${e.nombre}?`,
      accion: suspender ? 'Suspender' : 'Reactivar',
      peligro: suspender,
    })) return
    accion(() => repo.admin.empresas.setServicio(e.id, !e.servicioActivo, actor), `Servicio ${e.servicioActivo ? 'suspendido' : 'reactivado'} para ${e.nombre}.`)
  }

  const eliminar = async (e) => {
    if (!await confirmar({
      titulo: 'Retirar de operación',
      texto: `¿Retirar de operación ${e.nombre}? Se suspenderá su servicio y se conservará el historial.`,
      accion: 'Retirar',
      peligro: true,
    })) return
    accion(() => repo.admin.empresas.eliminar(e.id, actor), `${e.nombre} se retiró de operación. Su historial se conserva.`)
  }

  return (
    <div className="emp-root">
      <Cabecera
        titulo="Empresas"
        bajada="Elige una empresa para gestionar su operación, sus usuarios y su flota."
      >
        <Link className="pnl-btn" to="/panel/admin/ciclo-datos">Retirada y limpieza</Link>
        <button type="button" className="pnl-btn primario" disabled={ocupado || entrando} onClick={() => setCreando(true)}>
          <Icono nombre="mas" tam={16} />
          Nueva empresa
        </button>
      </Cabecera>

      <div className="pnl-cuerpo">
        {aviso && <p className="emp-error" role="alert">{aviso}</p>}
        {confirmacion && <p className="emp-confirmacion" role="status"><Icono nombre="check" tam={18} />{confirmacion}</p>}
        {estado === 'cargando' && datos === null && <Cargando filas={6} />}
        {estado === 'error' && <ErrorCarga onReintentar={recargar} error={{ message: textoDeError(error, 'No pudimos cargar las empresas. Inténtalo de nuevo.') }} />}
        {datos !== null && (
          <Contenido subirLogo={subirLogo}
            lista={lista}
            todas={datos}
            q={q}
            setQ={setQ}
            tipo={tipo}
            setTipo={setTipo}
            servicio={servicio}
            setServicio={setServicio}
            ocupado={ocupado || entrando || estado !== 'ok'}
            alternarServicio={alternarServicio}
            eliminar={eliminar}
            abrirPredefinidas={setPredeDe}
            gestionar={gestionar}
            entrando={entrando}
            seleccionId={seleccionId}
            setSeleccionId={seleccionarEmpresa}
          />
        )}
      </div>

      {dialogo}
      <ModalNueva abierto={creando} alCerrar={() => setCreando(false)} alGuardar={recargar} actor={actor} />
      <ModalPredefinidas empresa={predeDe} alCerrar={() => setPredeDe(null)} alGuardar={recargar} actor={actor} />
    </div>
  )
}

function Contenido({ lista, todas, q, setQ, tipo, setTipo, servicio, setServicio, ocupado, alternarServicio, eliminar, abrirPredefinidas, gestionar, entrando, seleccionId, setSeleccionId, subirLogo }) {
  const seleccion = lista.find(e => e.id === seleccionId) ?? lista[0]
  const operativas = todas.filter(e => !e.respaldo)
  const activas = operativas.filter(e => e.servicioActivo).length
  const deuda = operativas.length && operativas.every(e => Number.isFinite(e.deuda)) ? operativas.reduce((a, e) => a + e.deuda, 0) : null
  const limpiar = () => { setQ(''); setTipo(''); setServicio('') }
  const fichaProps = { subirLogo, ocupado, alternarServicio, eliminar, abrirPredefinidas, gestionar, entrando }

  return <>
    <section className="emp-resumen" aria-label="Resumen de las empresas disponibles">
      <div><Icono nombre="empresa" tam={25} /><span>Empresas<strong>{f.numero(operativas.length)}</strong></span></div>
      <div><Icono nombre="check" tam={25} /><span>Servicio activo<strong>{f.numero(activas)}</strong></span></div>
      <div><Icono nombre="reloj" tam={25} /><span>Suspendidas<strong>{f.numero(operativas.length - activas)}</strong></span></div>
      <div><Icono nombre="costos" tam={25} /><span>Deuda acumulada<strong>{deuda === null ? 'Sin dato' : f.moneda(deuda)}</strong></span></div>
    </section>
    <div className="emp-espacio">
      <section className="emp-directorio" aria-label="Directorio de empresas">
        <div className="emp-toolbar"><div><h2>Directorio de empresas</h2><p>{lista.length} {lista.length === 1 ? 'resultado' : 'resultados'} · selecciona para ver los detalles</p></div><Buscador valor={q} alCambiar={setQ} placeholder="Buscar nombre, RIF o contacto" /></div>
        <div className="emp-filtros">
          <Chips opciones={[{ v: '', t: 'Todas', n: todas.length }, ...COMPANY_TIPO.map(t => ({v:t,t:etiqueta('company_tipo', t),n:todas.filter(e=>e.tipo===t).length}))]} valor={tipo} alCambiar={setTipo} />
          <label className="emp-estado-filtro"><span>Servicio</span><select className="pnl-input" aria-label="Servicio" value={servicio} onChange={e=>setServicio(e.target.value)}><option value="">Todos los estados</option><option value="activo">Activo</option><option value="suspendido">Suspendido</option></select></label>
        </div>
        {lista.length ? <ul className="emp-lista">{lista.map(e => <li key={e.id}>
          <button type="button" className={`emp-fila${seleccion?.id === e.id ? ' seleccionada' : ''}`} aria-pressed={seleccion?.id === e.id} aria-label={`Ver detalles de ${e.nombre}`} onClick={()=>setSeleccionId(e.id)}>
            <span className="emp-simbolo"><LogoEmpresa empresaId={e.id} nombre={e.nombre} respaldo={<Icono nombre={e.tipo === 'personal' ? 'gente' : 'empresa'} tam={23} />} /></span>
            <span className="emp-fila-identidad"><strong>{e.nombre}</strong><span>{e.respaldo ? 'Respaldo del sistema' : e.tipoEtiqueta || etiqueta('company_tipo',e.tipo)}{e.rif ? ` · ${e.rif}` : ''}</span><span>{e.contacto || e.email || e.telefono || 'Sin contacto registrado'}</span></span>
            <span className="emp-fila-estado"><Tag color={e.respaldo ? 'gris' : e.servicioActivo ? 'verde' : 'rojo'}>{e.respaldo ? 'Respaldo' : e.servicioActivo ? 'Activo' : 'Suspendido'}</Tag><span>{Number.isFinite(e.vehiculos) ? f.cantidad(e.vehiculos, 'vehículo', 'vehículos') : 'Flota sin dato'}</span></span>
            <Icono nombre="flecha" tam={18} />
          </button>
          {seleccionId === e.id && <div className="emp-ficha-inline"><FichaEmpresa empresa={e} {...fichaProps} /><button type="button" className="pnl-btn sutil" onClick={()=>setSeleccionId(null)}>Cerrar detalles</button></div>}
        </li>)}</ul> : <Vacio icono="buscar" titulo={todas.length ? 'No encontramos empresas' : 'Todavía no hay empresas'} texto={todas.length ? 'Prueba otro nombre, tipo o estado del servicio.' : 'Usa Nueva empresa para registrar la primera.'} accion={todas.length > 0 && <button type="button" className="pnl-btn" onClick={limpiar}>Limpiar filtros</button>} />}
        <p className="emp-pie">El resumen conserva todas las empresas disponibles. La cuenta de respaldo no se incluye en los indicadores.</p>
      </section>
      <aside className="emp-ficha" aria-label="Empresa seleccionada">{seleccion ? <FichaEmpresa empresa={seleccion} {...fichaProps} /> : <Vacio icono="empresa" titulo="Sin empresa seleccionada" texto="Cuando haya resultados, podrás consultar su información aquí." />}</aside>
    </div>
  </>
}

function FichaEmpresa({empresa:e, ocupado, alternarServicio, eliminar, abrirPredefinidas, gestionar, entrando, subirLogo}) {
  return <>
    <div className="emp-ficha-identidad"><span className="emp-simbolo grande"><LogoEmpresa empresaId={e.id} nombre={e.nombre} respaldo={<Icono nombre={e.tipo === 'personal' ? 'gente' : 'empresa'} tam={30} />} /></span><div><h2>{e.nombre}</h2><p>{e.respaldo ? 'Respaldo del sistema' : e.tipoEtiqueta || etiqueta('company_tipo',e.tipo)}</p></div></div>
    <Tag color={e.respaldo ? 'gris' : e.servicioActivo ? 'verde' : 'rojo'}>{e.respaldo ? 'Cuenta de respaldo' : e.servicioActivo ? 'Servicio activo' : 'Servicio suspendido'}</Tag>
    <button type="button" className="pnl-btn primario emp-entrar" disabled={ocupado} onClick={()=>gestionar(e)}><Icono nombre="empresa" tam={18} />{entrando ? 'Comprobando acceso…' : 'Entrar a empresa'}<Icono nombre="flecha" tam={18} /></button>
    <p className="emp-ayuda">Abre su panel para gestionar vehículos, usuarios y la operación según tus permisos.</p>
    <div className="emp-cifras"><div><Icono nombre="gente" tam={19} /><span>Usuarios<strong>{e.usuarios ?? 'Sin dato'}</strong></span></div><div><Icono nombre="camion" tam={19} /><span>Vehículos<strong>{e.vehiculos ?? 'Sin dato'}</strong></span></div></div>
    <section className="emp-contacto"><h3>Información de la empresa</h3><dl>{[
      ['RIF',e.rif || 'Sin registrar'],['Contacto',e.contacto || 'Sin registrar'],['Correo',e.email || 'Sin registrar'],['Teléfono',e.telefono || 'Sin registrar'],['Saldo',Number.isFinite(e.deuda) ? f.moneda(e.deuda) : 'No disponible'],
    ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    {!e.respaldo && <section className="emp-gestion"><h3>Administración</h3><label className={`pnl-btn${ocupado ? ' deshabilitado' : ''}`}><Icono nombre="mas" tam={17} />Subir logo<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={ocupado} onChange={(ev) => { const a = ev.target.files?.[0]; ev.target.value = ''; if (a) subirLogo(e, a) }} /></label>{e.tipo === 'estandar' && <button type="button" className="pnl-btn" disabled={ocupado} onClick={()=>abrirPredefinidas(e)}><Icono nombre="gente" tam={17} />Compañías asociadas</button>}<button type="button" className="pnl-btn" disabled={ocupado} onClick={()=>alternarServicio(e)}><Icono nombre={e.servicioActivo ? 'reloj' : 'check'} tam={17} />{e.servicioActivo ? 'Suspender servicio' : 'Reactivar servicio'}</button><details><summary>Otras acciones</summary><p>Retirar una empresa suspende su servicio y conserva el historial.</p><button type="button" className="pnl-btn sutil" disabled={ocupado} onClick={()=>eliminar(e)}>Retirar de operación</button></details></section>}
  </>
}

function ModalNueva({ abierto, alCerrar, alGuardar, actor }) {
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('estandar')
  const [rif, setRif] = useState('')
  const [contacto, setContacto] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [prede, setPrede] = useState([])
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  // Tras crear la empresa: { empresa, responsable, clave, usuario | null, fallo } (la clave solo vive aquí, en pantalla).
  const [resultado, setResultado] = useState(null)
  const [correoNuevo, setCorreoNuevo] = useState('')
  const companias = useDatos(() => abierto ? repo.admin.empresas.listar({tipo:'predefinida'}) : Promise.resolve([]), [abierto])
  const limpiar = () => {
    setNombre(''); setRif(''); setContacto(''); setTelefono(''); setEmail('')
    setTipo('estandar'); setPrede([]); setError(''); setResultado(null); setCorreoNuevo('')
  }
  const cerrar = () => {
    if (guardando) return
    limpiar(); alCerrar()
  }

  // El responsable queda creado de una vez como usuario SUPERVISOR de la empresa nueva.
  const crearSupervisor = async (empresa, responsable, clave) => {
    const peticion = armarUsuarioResponsable({ responsable, empresaId: empresa.id, tipoEmpresa: empresa.tipo, conectado: DIRECTORIO_REAL, clave })
    const r = await repo.admin.usuarios.crear(peticion, actor)
    return { nombre: r?.nombre || peticion.nombre, email: peticion.email, clave: r?.clave ?? null, claveCreada: r?.claveCreada !== false }
  }

  const confirmar = async event => {
    event.preventDefault()
    if (guardando) return
    if (!nombre.trim()) { setError('Escribe el nombre de la empresa.'); return }
    const problema = problemaDelResponsable({ contacto, email, telefono })
    if (problema) { setError(problema); return }
    setGuardando(true); setError('')
    const responsable = { contacto: contacto.trim(), email: email.trim(), telefono: normalizarTelefono(telefono) }
    let empresa
    try {
      const r = await repo.admin.empresas.crear({ nombre:nombre.trim(), tipo, rif:rif.trim(), contacto:responsable.contacto, telefono:responsable.telefono, email:responsable.email, predefinidas:tipo === 'estandar' ? prede : [] }, actor)
      empresa = { id: r?.id ?? null, nombre: nombre.trim(), tipo }
    } catch(e) {
      setError(textoDeError(e, 'No se pudo crear la empresa. Inténtalo de nuevo.'))
      setGuardando(false)
      return
    }
    // Desde aquí la empresa YA existe: si algo falla con el usuario, se avisa y se puede reintentar solo el usuario.
    const clave = generarClaveTemporal(responsable.email)
    let usuario = null
    let fallo = ''
    if (!empresa.id) {
      fallo = 'El servidor no dijo cuál es la empresa nueva, así que no se pudo crear el usuario. Búscala en la lista y crea al supervisor desde Usuarios.'
    } else {
      try { usuario = await crearSupervisor(empresa, responsable, clave) } catch(e) { fallo = textoDeError(e, 'No se pudo crear el usuario supervisor.') }
    }
    try { await alGuardar() } catch { /* la lista se refresca sola en la próxima carga */ }
    setCorreoNuevo(responsable.email)
    setResultado({ empresa, responsable, clave, usuario, fallo })
    setGuardando(false)
  }

  const reintentarUsuario = async () => {
    if (guardando || !resultado?.empresa.id) return
    const problema = problemaDelResponsable({ contacto: resultado.responsable.contacto, email: correoNuevo })
    if (problema) { setResultado(r => ({ ...r, fallo: problema })); return }
    setGuardando(true)
    const responsable = { ...resultado.responsable, email: correoNuevo.trim() }
    try {
      const usuario = await crearSupervisor(resultado.empresa, responsable, resultado.clave)
      setResultado(r => ({ ...r, responsable, usuario, fallo: '' }))
    } catch(e) {
      setResultado(r => ({ ...r, fallo: textoDeError(e, 'No se pudo crear el usuario supervisor.') }))
    } finally { setGuardando(false) }
  }

  if (resultado) {
    const { empresa, usuario, fallo } = resultado
    return <Modal titulo="Empresa creada" abierto={abierto} alCerrar={cerrar} ancho={560}>
      <div className="emp-form" aria-busy={guardando}>
        <p className="emp-confirmacion" role="status"><Icono nombre="check" tam={18} />{empresa.nombre} ya está creada.</p>
        {usuario ? <>
          <p className="emp-ayuda">{usuario.nombre} ya es <b>supervisor</b> de la empresa{usuario.clave
            ? <> y puede entrar con el correo <b>{usuario.email}</b> y la clave temporal <code>{usuario.clave}</code>.</>
            : <> con el correo <b>{usuario.email}</b>. Ya pertenecía al sistema y conserva su contraseña actual.</>}</p>
          {usuario.clave && <p className="emp-ayuda">Entrégasela en persona: deberá cambiarla al entrar. No se volverá a mostrar.</p>}
          <div className="emp-form-acciones"><button type="button" className="pnl-btn primario" onClick={cerrar}>Entendido</button></div>
        </> : <>
          <p className="emp-error" role="alert">La empresa quedó creada, pero no se pudo crear el usuario supervisor de {resultado.responsable.contacto}. {fallo}</p>
          {empresa.id && <Campo etiqueta="Correo del responsable" ayuda="Si el correo estaba mal, corrígelo antes de reintentar.">
            <input type="email" autoComplete="email" className="pnl-input" value={correoNuevo} disabled={guardando} onChange={e=>setCorreoNuevo(e.target.value)} />
          </Campo>}
          <div className="emp-form-acciones">
            <button type="button" className="pnl-btn" disabled={guardando} onClick={cerrar}>Cerrar y hacerlo después</button>
            {empresa.id && <button type="button" className="pnl-btn primario" disabled={guardando} onClick={reintentarUsuario}><Icono nombre="sync" tam={17} />{guardando ? 'Creando…' : 'Reintentar crear el usuario'}</button>}
          </div>
        </>}
      </div>
    </Modal>
  }

  return <Modal titulo="Nueva empresa" abierto={abierto} alCerrar={cerrar} ancho={760}>
    <form className="emp-form" onSubmit={confirmar} aria-busy={guardando}>
      <p className="emp-ayuda">Registra la empresa y a su responsable. El responsable queda creado como supervisor de la empresa y entra con su correo.</p>
      {error && <p className="emp-error" role="alert">{error}</p>}
      <fieldset disabled={guardando}><legend>Datos de la empresa</legend><div className="emp-form-grid">
        <Campo etiqueta="Nombre de la empresa *"><input required autoComplete="organization" className="pnl-input" value={nombre} onChange={e=>setNombre(e.target.value)} placeholder="Nombre o razón social" /></Campo>
        <Campo etiqueta="RIF"><input className="pnl-input" value={rif} onChange={e=>setRif(e.target.value)} placeholder="J-12345678-9" /></Campo>
      </div><Campo etiqueta="Tipo de empresa"><select className="pnl-input" value={tipo} onChange={e=>setTipo(e.target.value)}>{COMPANY_TIPO.map(t=><option key={t} value={t}>{etiqueta('company_tipo',t)}</option>)}</select></Campo>
      <p className="emp-tipo-ayuda"><Icono nombre={tipo === 'personal' ? 'gente' : 'empresa'} tam={21} />{tipo === 'estandar' ? 'Contratista: opera una flota de vehículos.' : tipo === 'predefinida' ? 'Compañía: supervisa las flotas de sus contratistas.' : 'Personal: una cuenta individual.'}</p></fieldset>
      <fieldset disabled={guardando}><legend>Responsable de la empresa</legend><div className="emp-form-grid">
        <Campo etiqueta="Nombre y apellido *"><input required autoComplete="name" className="pnl-input" value={contacto} onChange={e=>setContacto(e.target.value)} placeholder="Nombre y apellido" /></Campo>
        <Campo etiqueta="Correo *" ayuda="Con este correo entrará a FOM."><input required type="email" autoComplete="email" className="pnl-input" value={email} onChange={e=>setEmail(e.target.value)} placeholder="responsable@empresa.com" /></Campo>
        <Campo etiqueta="Teléfono" ayuda="Opcional. Con + y código del país."><input type="tel" autoComplete="tel" className="pnl-input" value={telefono} onChange={e=>setTelefono(e.target.value)} placeholder="+58 …" /></Campo>
      </div><p className="emp-tipo-ayuda"><Icono nombre="gente" tam={21} />Se crea como usuario supervisor de la empresa, con una clave temporal que verás una sola vez al terminar.</p></fieldset>
      {tipo === 'estandar' && <section><h3>Compañías asociadas</h3><p className="emp-ayuda">Opcional: compañías para las que trabaja esta contratista.</p><SelectorCompanias fuente={companias} seleccion={prede} alCambiar={setPrede} disabled={guardando} /></section>}
      <div className="emp-form-acciones"><button type="button" className="pnl-btn" disabled={guardando} onClick={cerrar}>Cancelar</button><button type="submit" className="pnl-btn primario" disabled={guardando}><Icono nombre="check" tam={17} />{guardando ? 'Creando…' : 'Crear empresa'}</button></div>
    </form>
  </Modal>
}

function SelectorCompanias({fuente, seleccion, alCambiar, disabled}) {
  if (fuente.estado === 'cargando') return <Cargando filas={2} />
  if (fuente.estado === 'error') return <ErrorCarga error={fuente.error && { message: textoDeError(fuente.error) }} texto="No se pudieron cargar las compañías." onReintentar={fuente.recargar} />
  return <div className="emp-companias">{fuente.datos?.length ? fuente.datos.map(c=><label key={c.id}><input type="checkbox" checked={seleccion.includes(c.id)} disabled={disabled} onChange={()=>alCambiar(p=>p.includes(c.id) ? p.filter(id=>id!==c.id) : [...p,c.id])} /><span><strong>{c.nombre}</strong><small>{c.rif || 'Compañía'}</small></span></label>) : <p className="emp-ayuda">No hay compañías registradas para asociar.</p>}</div>
}

function ModalPredefinidas({ empresa, alCerrar, alGuardar, actor }) {
  const [prede, setPrede] = useState([])
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const companias = useDatos(() => empresa ? repo.admin.empresas.listar({tipo:'predefinida'}) : Promise.resolve([]), [empresa?.id])
  useEffect(()=>{ setPrede(empresa?.predefinidas ?? []); setError('') },[empresa])
  if (!empresa) return null
  const cerrar = () => { if (!guardando) alCerrar() }
  const confirmar = async e => {
    e.preventDefault()
    if (guardando || companias.estado !== 'ok') return
    setGuardando(true); setError('')
    try {
      await repo.admin.empresas.asignarPredefinidas(empresa.id, prede, actor)
      await alGuardar(); alCerrar()
    } catch(e) { setError(textoDeError(e, 'No se pudieron guardar las compañías. Inténtalo de nuevo.')) }
    finally { setGuardando(false) }
  }
  return <Modal titulo="Compañías asociadas" abierto alCerrar={cerrar} ancho={620}><form className="emp-form" onSubmit={confirmar} aria-busy={guardando}>
    <div className="emp-asociacion-contexto"><Icono nombre="empresa" tam={28} /><div><h3>{empresa.nombre}</h3><p className="emp-ayuda">Selecciona las compañías para las que trabaja esta contratista.</p></div></div>
    {error && <p className="emp-error" role="alert">{error}</p>}
    <SelectorCompanias fuente={companias} seleccion={prede} alCambiar={setPrede} disabled={guardando} />
    <div className="emp-form-acciones"><button type="button" className="pnl-btn" disabled={guardando} onClick={cerrar}>Cancelar</button><button type="submit" className="pnl-btn primario" disabled={guardando || companias.estado !== 'ok'}><Icono nombre="check" tam={17} />{guardando ? 'Guardando…' : 'Guardar asociaciones'}</button></div>
  </form></Modal>
}
