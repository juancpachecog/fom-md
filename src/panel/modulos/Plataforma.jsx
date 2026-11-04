import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { entrarEmpresa } from '../auth'
import repo, { DIRECTORIO_REAL } from '../datos/repo'
import { useSesion } from '../useSesion'
import { ModalCrear, ModalCambiarRol, useAccionesCuenta } from './AdminUsuarios'
import { useDatos } from '../useDatos'
import { Buscador, Cargando, Datos, ErrorCarga, Tag, Tarjeta, Vacio } from '../comp/ui'
import * as f from '../datos/formato'
import { etiquetaRolSesion, rolCanonico } from '../roles'
import { Icono } from '../Iconos'
import './mantenimiento.css'
import './admin-rediseno.css'
import './usuarios-perfil.css'

// ============================================================
// USUARIOS GENERALES (solo Administrador FOM)
// ------------------------------------------------------------
// Las personas de TODAS las empresas en una sola búsqueda: nombre, correo,
// empresa o código. Una fila por membresía, así que quien pertenece a dos
// empresas sale dos veces, y eso es correcto: son dos accesos distintos.
// Mismo estilo que Mantenimiento: lista a la izquierda, la persona elegida
// con sus acciones a la derecha.
// ============================================================

const POR_PAGINA = 50
const COLOR_ROL = { admin_fom: 'rojo', supervisor: 'azul', operator: 'ambar', conductor: 'verde', usuario: 'gris' }
const COLOR_ESTADO = { active: 'verde', suspended: 'ambar', invited: 'azul', disabled: 'gris', revoked: 'gris' }
const ESTADO = { active: 'Activa', suspended: 'Suspendida', invited: 'Invitada', disabled: 'Inactiva', revoked: 'Sin acceso' }

const GRUPOS = [
  { clave: '', titulo: 'Todos', color: '', filtro: () => true },
  { clave: 'supervisor', titulo: 'Supervisores', color: '', filtro: (p) => rolCanonico(p.rol) === 'supervisor' },
  { clave: 'conductor', titulo: 'Conductores', color: 'verde', filtro: (p) => rolCanonico(p.rol) === 'conductor' },
  { clave: 'operator', titulo: 'Operadores', color: 'ambar', filtro: (p) => rolCanonico(p.rol) === 'operator' },
  { clave: 'admin_fom', titulo: 'Administradores FOM', color: 'rojo', filtro: (p) => rolCanonico(p.rol) === 'admin_fom' },
  { clave: 'sinacceso', titulo: 'Sin acceso', color: 'gris', filtro: (p) => p.estado === 'revoked' },
]

export default function Plataforma() {
  const navegar = useNavigate()
  const [abriendoPerfil, setAbriendoPerfil] = useState(false)
  const [errorPerfil, setErrorPerfil] = useState('')
  const sesion = useSesion()
  const [creando, setCreando] = useState(false)
  const [editandoRol, setEditandoRol] = useState(null)
  const [empresaId, setEmpresaId] = useState('')
  const [grupo, setGrupo] = useState('')
  const [seleccionId, setSeleccionId] = useState(null)
  const empresas = useDatos(() => repo.admin.empresas.listar({}), [])
  const [q, setQ] = useState('')
  const [desde, setDesde] = useState(0)
  const empresa = (empresas.datos ?? []).find((e) => e.id === empresaId)
  const personas = useDatos(() => repo.admin.plataforma.personas({ q, limite: POR_PAGINA, desde, empresa }), [q, desde, empresa])
  // Restablecer la clave: la misma acción (y el mismo modal con la clave) que Usuarios de una empresa.
  const cuenta = useAccionesCuenta({ actor: sesion?.perfil, alCambiar: personas.recargar })
  const total = personas.datos?.pagina?.total ?? null
  const paginas = total == null ? 1 : Math.max(1, Math.ceil(total / POR_PAGINA))
  const actual = Math.floor(desde / POR_PAGINA) + 1

  const lista = useMemo(() => personas.datos ?? [], [personas.datos])
  const filtro = (GRUPOS.find((g) => g.clave === grupo) ?? GRUPOS[0]).filtro
  const visibles = lista.filter(filtro)
  const seleccion = visibles.find((p) => p.id === seleccionId) ?? visibles[0] ?? null
  const soyAdmin = rolCanonico(sesion?.perfil?.rol) === 'admin_fom'
  const puedeCambiarRol = (p) => soyAdmin && rolCanonico(p.rol) !== 'admin_fom' && p.email !== sesion?.perfil?.correo && p.estado !== 'revoked'
  async function abrirPerfil(persona) {
    if (abriendoPerfil || !persona?.empresaId || !persona?.userId) return
    setAbriendoPerfil(true)
    setErrorPerfil('')
    try {
      const destino = (empresas.datos ?? []).find(e => e.id === persona.empresaId)
      if (!destino) throw new Error('No se pudo resolver la empresa de este acceso. Recarga la lista de empresas.')
      await entrarEmpresa(destino)
      navegar(`/panel/personal/${encodeURIComponent(persona.userId)}?origen=plataforma`)
    } catch (e) { setErrorPerfil(e.message || 'No se pudo abrir el perfil.') }
    finally { setAbriendoPerfil(false) }
  }

  const resumen = [
    ['Membresías', total == null ? '—' : f.numero(total), 'Una por persona y empresa', 'gente'],
    ['Empresas', (empresas.datos ?? []).length, 'En la plataforma', 'empresa'],
    ['Activas', lista.filter((p) => p.estado === 'active').length, 'En esta página', 'check'],
    ['Sin acceso', lista.filter((p) => p.estado === 'revoked').length, 'En esta página', 'alerta'],
  ]

  return (
    <div className="mnt-root usr-plataforma">
      <div className="mnt-heading">
        <div>
          <span className="mnt-breadcrumb">Inicio › Administración › Usuarios generales</span>
          <h1>Usuarios generales</h1>
          <p>Todas las personas de todas las empresas en un solo lugar. Cambia el rol de cada acceso.</p>
        </div>
      </div>

      <div className="mnt-content" style={{ marginTop: 24 }}>
        <div className="mnt-toolbar">
          <div><h2>Personas</h2></div>
          <button type="button" onClick={() => setCreando(true)} className="pnl-btn primario"><Icono nombre="mas" tam={18} />Nuevo usuario</button>
        </div>

        <div className="mnt-summary">
          {resumen.map(([t, v, d, i]) => (
            <div key={t}><Icono nombre={i} tam={28} /><span>{t}</span><b>{v}</b><small>{d}</small></div>
          ))}
        </div>

        <div className="mnt-filters">
          <Buscador valor={q} alCambiar={(v) => { setQ(v); setDesde(0) }} placeholder="Nombre, correo, empresa o código…" />
          <select className="pnl-input" aria-label="Empresa" value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setDesde(0); setEditandoRol(null) }}>
            <option value="">Todas las empresas</option>
            {(empresas.datos ?? []).map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        {empresas.estado === 'error' && <ErrorCarga error={empresas.error} onReintentar={empresas.recargar} />}

        <div className="mnt-states" aria-label="Filtrar por rol">
          {GRUPOS.map((g) => (
            <button type="button" key={g.clave || 'todos'} aria-pressed={grupo === g.clave} onClick={() => setGrupo(g.clave)}>
              {g.color && <i className={g.color} />}{g.titulo}<b>{lista.filter(g.filtro).length}</b>
            </button>
          ))}
        </div>

        {personas.estado === 'cargando' && <Cargando filas={8} />}
        {personas.estado === 'error' && <ErrorCarga onReintentar={personas.recargar} error={personas.error} />}
        {personas.estado === 'ok' && (
          <div className="adm-layout">
            <Tarjeta titulo={total == null ? 'Personas' : f.cantidad(total, 'persona', 'personas')} sinCuerpo>
              {visibles.length === 0 ? (
                <div className="pnl-card-cuerpo">
                  <Vacio icono="buscar" titulo="Nadie coincide" texto="Prueba con parte del nombre, el correo o el código de la empresa." />
                </div>
              ) : (
                <div className="pnl-tabla-wrap">
                  <table className="pnl-tabla usr-tabla-global">
                  <thead><tr><th>Persona</th><th>Empresa</th><th>Rol</th><th>Estado</th></tr></thead>
                  <tbody>
                  {visibles.map((p) => {
                    const rol = rolCanonico(p.rol)
                    return (
                      <tr key={p.id} className={seleccion?.id === p.id ? 'seleccionada' : ''} onClick={() => { setSeleccionId(p.id); setErrorPerfil('') }}>
                        <td><div className="pnl-persona"><i className="pnl-avatar">{f.iniciales(p.nombre)}</i><div className="pnl-doble">
                          <button type="button" className="usr-nombre usr-seleccionar" aria-pressed={seleccion?.id === p.id} onClick={() => { setSeleccionId(p.id); setErrorPerfil('') }}>{p.nombre}</button>
                          <span>{p.email}</span>
                        </div></div></td>
                        <td>{rol === 'admin_fom' ? 'Acceso global · FOM' : p.empresaNombre}</td>
                        <td><Tag color={COLOR_ROL[rol] ?? 'gris'}>{etiquetaRolSesion(rol)}</Tag></td>
                        <td><Tag color={COLOR_ESTADO[p.estado] ?? 'gris'} plano>{ESTADO[p.estado] ?? p.estado}</Tag></td>
                      </tr>
                    )
                  })}
                  </tbody></table>
                </div>
              )}
              {paginas > 1 && (
                <div className="pnl-card-cuerpo" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: 'var(--e-t-xs)', color: 'var(--e-texto-2)' }}>Página {actual} de {paginas}</span>
                  <button type="button" className="pnl-btn sutil" disabled={desde === 0} onClick={() => setDesde(Math.max(0, desde - POR_PAGINA))}>Anterior</button>
                  <button type="button" className="pnl-btn sutil" disabled={actual >= paginas} onClick={() => setDesde(desde + POR_PAGINA)}>Siguiente</button>
                </div>
              )}
            </Tarjeta>

            <aside className="adm-panel">
              {seleccion ? (
                <div className="adm-detalle">
                  <div className="adm-cab">
                    <div className="mnt-thumb"><i className="pnl-avatar">{f.iniciales(seleccion.nombre)}</i></div>
                    <div><h3>{seleccion.nombre}</h3><p className="usr-email">{seleccion.email}</p></div>
                  </div>
                  <div className="adm-tags">
                    <Tag color={COLOR_ROL[rolCanonico(seleccion.rol)] ?? 'gris'}>{etiquetaRolSesion(rolCanonico(seleccion.rol))}</Tag>
                    <Tag color={COLOR_ESTADO[seleccion.estado] ?? 'gris'}>{ESTADO[seleccion.estado] ?? seleccion.estado}</Tag>
                  </div>
                  <Datos items={[
                    { etiqueta: 'Empresa', valor: rolCanonico(seleccion.rol) === 'admin_fom' ? 'Acceso global · FOM' : seleccion.empresaNombre },
                    { etiqueta: 'Código de la empresa', valor: rolCanonico(seleccion.rol) === 'admin_fom' ? '—' : (seleccion.empresaCodigo || '—') },
                  ]} />
                  <div className="adm-acciones" role="group" aria-label="Acciones sobre la persona">
                    {seleccion.empresaId && seleccion.userId && (
                      <button type="button" className="pnl-btn primario usr-abrir" disabled={abriendoPerfil} onClick={() => abrirPerfil(seleccion)}>
                        {abriendoPerfil ? 'Abriendo perfil…' : 'Abrir perfil completo'} <Icono nombre="volver" tam={16} />
                      </button>
                    )}
                    {errorPerfil && <p className="pnl-campo-error" role="alert">{errorPerfil}</p>}
                    {puedeCambiarRol(seleccion) && (
                      <button type="button" className="pnl-btn primario" onClick={() => setEditandoRol(seleccion)}>Cambiar rol →</button>
                    )}
                    {rolCanonico(seleccion.rol) !== 'admin_fom' && seleccion.userId && (
                      <button type="button" className="pnl-btn" onClick={() => cuenta.restablecerClave({ ...seleccion, id: seleccion.userId })}>
                        <Icono nombre="escudo" tam={16} />Restablecer clave
                      </button>
                    )}
                    {cuenta.aviso && <p className="pnl-campo-error" role="alert">{cuenta.aviso}</p>}
                    <Link className="pnl-btn" to="/panel/admin/transferencias"><Icono nombre="comparar" tam={16} />Pasarla a otra empresa →</Link>
                    <Link className="pnl-btn" to={`/panel/admin/auditoria`}><Icono nombre="auditoria" tam={16} />Ver auditoría →</Link>
                    <Link className="pnl-btn sutil" to="/panel/admin/empresas"><Icono nombre="empresa" tam={16} />Ver las empresas →</Link>
                  </div>
                  {rolCanonico(seleccion.rol) === 'admin_fom' && <p className="mnt-muted">Los administradores FOM no cambian de rol desde aquí.</p>}
                </div>
              ) : (
                <Vacio icono="gente" titulo="Elige una persona" texto="Aquí verás su empresa, su rol y lo que puedes hacer." />
              )}
            </aside>
          </div>
        )}
      </div>
      {creando && <ModalCrear abierto global empresaInicial={empresaId} empresas={empresas.datos ?? []} actor={sesion?.perfil} directorioReal={DIRECTORIO_REAL} alCerrar={() => setCreando(false)} alGuardar={personas.recargar} />}
      {cuenta.modalClave}
      {editandoRol && <ModalCambiarRol key={editandoRol.id} persona={editandoRol} alCerrar={() => setEditandoRol(null)} alGuardar={personas.recargar} />}
    </div>
  )
}
