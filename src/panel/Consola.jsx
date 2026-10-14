import LogoFom from '../components/LogoFom'
import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { cerrarSesion, esAdminFom, resolverSesion, salirEmpresa } from './auth'
import { areaDe, esGestor } from './roles'
import { useSesion } from './useSesion'
import { useApariencia } from './useApariencia'
import { estaLeida } from './modulos/alertas-presentacion'
import { Icono } from './Iconos'
import repo, { alCambiarDatos, CONECTADO } from './datos/repo'
import '../styles/apariencia.css'

import Resumen from './modulos/Resumen'
import CentroControl from './modulos/CentroControl'
import Flota from './modulos/Flota'
import ExpedienteVehiculo from './modulos/ExpedienteVehiculo'
import Mantenimiento from './modulos/Mantenimiento'
import MantenimientoConductor from './modulos/MantenimientoConductor'
import Inspecciones from './modulos/Inspecciones'
import ExpedienteConductor from './modulos/ExpedienteConductor'
import Alertas from './modulos/Alertas'
import Documentos from './modulos/Documentos'
import Reportes from './modulos/Reportes'
import AdminEmpresas from './modulos/AdminEmpresas'
import AdminPagos from './modulos/AdminPagos'
import AdminGps from './modulos/AdminGps'
import AdminUsuarios from './modulos/AdminUsuarios'
import AdminAuditoria from './modulos/AdminAuditoria'
import MiUnidad from './modulos/MiUnidad'
import MapaConductor from './modulos/MapaConductor'
import MiPerfil from './modulos/MiPerfil'
import Seguridad from './modulos/Seguridad'
import Jornadas from './modulos/Jornadas'
import Transferencias from './modulos/Transferencias'
import Plataforma from './modulos/Plataforma'
import AdminVehiculos from './modulos/AdminVehiculos'

// Módulos de la consola, agrupados como en la arquitectura FOM-WEB.
const MENU = [
  {
    grupo: 'Operación',
    items: [
      { a: '/panel', icono: 'resumen', texto: 'Resumen', fin: true },
      { a: '/panel/mapa', icono: 'mapa', texto: 'Centro de control' },
      { a: '/panel/alertas', icono: 'alerta', texto: 'Alertas' },
      { a: '/panel/seguridad', icono: 'escudo', texto: 'Eventos y SOS' },
    ],
  },
  {
    grupo: 'Flota',
    items: [
      { a: '/panel/flota', icono: 'camion', texto: 'Vehículos' },
      { a: '/panel/jornadas', icono: 'reloj', texto: 'Jornadas' },
      { a: '/panel/mantenimiento', icono: 'llave', texto: 'Mantenimiento', fin: true },
      { a: '/panel/inspecciones', icono: 'check', texto: 'Inspecciones', fin: true },
      { a: '/panel/documentos', icono: 'documento', texto: 'Documentos' },
    ],
  },
  {
    grupo: 'Usuarios',
    // Una sola entrada. «Personal» y «Usuarios» eran dos pantallas para la
    // misma gente —una preguntaba «puede manejar hoy» y la otra «tiene
    // acceso»— y la primera ademas estaba vacia. Ahora es una.
    items: [{ a: '/panel/personal', icono: 'gente', texto: 'Usuarios' }],
  },
  {
    grupo: 'Análisis',
    items: [{ a: '/panel/reportes', icono: 'reporte', texto: 'Reportes' }],
  },
]

// Grupo extra que SOLO ve el Administrador FOM: la capa multiempresa.
const MENU_ADMIN = {
  grupo: 'Administración FOM',
  items: [
    { a: '/panel/admin/empresas', icono: 'empresa', texto: 'Empresas' },
    { a: '/panel/admin/plataforma', icono: 'buscar', texto: 'Usuarios generales' },
    { a: '/panel/admin/vehiculos', icono: 'camion', texto: 'Vehículos generales' },
    { a: '/panel/admin/transferencias', icono: 'comparar', texto: 'Transferencias' },
    { a: '/panel/admin/pagos', icono: 'costos', texto: 'Facturación' },
    { a: '/panel/admin/gps', icono: 'pin', texto: 'GPS' },
    { a: '/panel/admin/auditoria', icono: 'auditoria', texto: 'Auditoría' },
  ],
}

// Lo que ve cada area. Es la misma reparticion que las carpetas de la app:
// `admin/`, `panel/`, `compania/`, `(driver)/` y `personal/`. Que el menu y
// las rutas salgan de la MISMA lista es lo que impide que una pantalla quede
// alcanzable por la barra de direcciones sin estar en el menu.
const MENU_POR_AREA = {
  admin: [MENU_ADMIN],
  operativo: MENU,
  gerencial: [
    {
      grupo: 'Contratistas',
      items: [
        { a: '/panel/personal', icono: 'gente', texto: 'Usuarios' },
        { a: '/panel/reportes', icono: 'reporte', texto: 'Reportes' },
      ],
    },
  ],
  conductor: [
    {
      grupo: 'Mi trabajo',
      items: [
        { a: '/panel', icono: 'camion', texto: 'Mi unidad', fin: true },
        { a: '/panel/mapa', icono: 'mapa', texto: 'Mapa' },
        { a: '/panel/mantenimiento', icono: 'llave', texto: 'Mantenimiento' },
        { a: '/panel/alertas', icono: 'alerta', texto: 'Alertas' },
      ],
    },
  ],
  personal: [
    {
      grupo: 'Mi flota',
      items: [
        { a: '/panel/mapa', icono: 'mapa', texto: 'Mapa' },
        { a: '/panel/alertas', icono: 'alerta', texto: 'Alertas' },
        { a: '/panel/documentos', icono: 'documento', texto: 'Documentos' },
      ],
    },
  ],
}

/** Rutas alcanzables por area. Todo lo que no este aqui vuelve al inicio. */
const RUTAS_POR_AREA = {
  admin: null, // todas
  operativo: ['', 'mapa', 'alertas', 'seguridad', 'flota', 'jornadas', 'mantenimiento', 'inspecciones', 'documentos', 'personal', 'reportes'],
  gerencial: ['personal', 'reportes'],
  conductor: ['', 'mapa', 'alertas', 'mantenimiento'],
  personal: ['mapa', 'alertas', 'documentos', 'personal'],
}

function inicioDe(area) {
  if (area === 'admin') return '/panel/admin/plataforma'
  if (area === 'gerencial') return '/panel/personal'
  if (area === 'personal') return '/panel/mapa'
  return '/panel'
}

function Lateral({ perfil, abierto, cerrar, sinLeer }) {
  const menu = esAdminFom(perfil) && perfil.empresaGestion
    ? [MENU_ADMIN, ...MENU]
    : MENU_POR_AREA[areaDe(perfil)] ?? MENU_POR_AREA.conductor
  return (
    <aside id="panel-navigation" className={`pnl-side${abierto ? ' abierto' : ''}`} onKeyDown={e => { if (e.key === 'Escape') cerrar() }}>
      <div className="pnl-side-top">
        <NavLink to="/panel" end className="pnl-marca" onClick={cerrar}>
          <LogoFom />
          <em>{esAdminFom(perfil) ? 'Administración' : 'Operación conectada'}</em>
        </NavLink>
        <button type="button" className="pnl-side-cerrar" aria-label="Cerrar navegación" onClick={cerrar}><Icono nombre="cerrar" tam={20} /></button>
      </div>

      <div className={`pnl-empresa${esAdminFom(perfil) ? ' es-admin' : ''}`}>
        <b>{perfil.empresaGestion?.nombre || (esAdminFom(perfil) ? 'Administración FOM' : perfil.empresa)}</b>
        <span>{perfil.empresaGestion ? 'Gestionando como administrador FOM' : esAdminFom(perfil) ? 'Acceso global · Todas las empresas' : perfil.sede}</span>
        {perfil.empresaGestion && <Link className="pnl-btn sutil" to="/panel/admin/empresas" onClick={() => { salirEmpresa(); cerrar() }}>Salir de empresa</Link>}
      </div>

      <nav className="pnl-nav" aria-label="Módulos">
        {menu.map((g) => (
          <div className="pnl-nav-grupo" key={g.grupo}>
            <span className="pnl-nav-titulo">{g.grupo}</span>
            {g.items.map((it) => (
              <NavLink
                key={it.a}
                to={it.a}
                end={it.fin}
                onClick={cerrar}
                className={({ isActive }) => `pnl-nav-item${isActive ? ' activo' : ''}`}
              >
                <Icono nombre={it.icono} />
                {it.texto}
                {it.icono === 'alerta' && sinLeer > 0 && (
                  <em className="pnl-nav-globo" aria-label={`${sinLeer} sin leer`}>
                    {sinLeer}
                  </em>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="pnl-side-pie">
        <NavLink to="/panel/mi-perfil" className="pnl-usuario" aria-label="Abrir mi perfil" onClick={cerrar}>
          <i className="pnl-avatar">{perfil.iniciales}</i>
          <div>
            <b>{perfil.nombre}</b>
            <span>{perfil.rolNombre}</span>
          </div>
        </NavLink>
        <NavLink to="/panel/mi-perfil" className={({ isActive }) => `pnl-salir mp-enlace${isActive ? ' activo' : ''}`} onClick={cerrar}><Icono nombre="gente" />Mi perfil</NavLink>
        <Link to="/" className="pnl-salir">
          <Icono nombre="volver" />
          Ir al sitio
        </Link>
        <button type="button" className="pnl-salir" onClick={cerrarSesion}>
          <Icono nombre="salir" />
          Cerrar sesión
        </button>
      </div>
    </aside>
  )
}

export default function Consola() {
  const sesion = useSesion()
  const { diseno } = useApariencia(sesion?.perfil)
  const { pathname } = useLocation()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [sinLeer, setSinLeer] = useState(0)

  useEffect(() => {
    const raiz = document.documentElement
    const anterior = raiz.getAttribute('data-tema')
    raiz.setAttribute('data-tema', 'oscuro')
    return () => {
      if (anterior) raiz.setAttribute('data-tema', anterior)
      else raiz.removeAttribute('data-tema')
    }
  }, [])

  useEffect(() => {
    setMenuAbierto(false)
  }, [pathname])

  // Contador del globo de alertas: se recalcula al navegar y cuando algo cambia.
  useEffect(() => {
    if (!sesion?.perfil || esAdminFom(sesion.perfil) && !sesion.perfil.empresaGestion) { setSinLeer(0); return }
    let vivo = true
    const leer = () =>
      repo.alertas.listar({}).then((l) => vivo && setSinLeer(l.filter(n => !estaLeida(n)).length)).catch(() => {})
    leer()
    const baja = alCambiarDatos(leer)
    return () => {
      vivo = false
      baja()
    }
  }, [pathname, sesion?.perfil?.id, sesion?.perfil?.empresaGestion?.id])

  useEffect(() => {
    document.title = 'Consola FOM'
    return () => {
      document.title = 'FOM — Control total de tu flota'
    }
  }, [])

  // `undefined` = todavía se le está preguntando al servidor si hay sesión.
  // Redirigir aquí mandaría a /entrar a quien sí tiene sesión abierta.
  if (sesion === undefined) {
    return (
      <div className="pnl-cargando-sesion" role="status">
        Comprobando tu sesión…
      </div>
    )
  }
  if (!sesion) return <Navigate to="/entrar" replace />
  if (sesion.errorConexion) return <div className="pnl-cargando-sesion" role="alert"><p>{sesion.errorConexion}</p><button className="pnl-btn" onClick={resolverSesion}>Reintentar conexión</button></div>
  if (sesion.debeCambiarClave) return <Navigate to="/cambiar-clave-inicial" replace />

  const { perfil } = sesion
  const area = areaDe(perfil)
  const permitidas = RUTAS_POR_AREA[area]
  // La primera parte de la ruta tras /panel/ decide si esta area la alcanza.
  // `pathname` viene del router, no del `window`: asi la guarda vuelve a
  // evaluarse en cada navegacion y no solo al cargar la pagina.
  const primerTramo = pathname.replace(/^\/panel\/?/u, '').split('/')[0]
  if (area === 'admin' && !perfil.empresaGestion && !['admin', 'mi-perfil', 'alertas'].includes(primerTramo)) {
    return <Navigate to="/panel/admin/plataforma" replace />
  }
  if (primerTramo !== 'mi-perfil' && permitidas && !permitidas.includes(primerTramo)) {
    return <Navigate to={inicioDe(area)} replace />
  }

  return (
    <div className="pnl fom-dark" data-diseno={diseno} data-area={area} data-screen={pathname.replace('/panel', '') || '/resumen'}>
      <Lateral
        perfil={perfil}
        abierto={menuAbierto}
        cerrar={() => setMenuAbierto(false)}
        sinLeer={sinLeer}
      />
      {menuAbierto && (
        <button
          type="button"
          className="pnl-velo"
          aria-label="Cerrar menú"
          onClick={() => setMenuAbierto(false)}
        />
      )}

      <main className="pnl-main" id="contenido">
        <div className="pnl-topbar">
          <div className="pnl-topbar-contexto"><span className="pnl-contexto"><Icono nombre={esAdminFom(perfil) ? 'empresa' : 'camion'} tam={18} />{esAdminFom(perfil) && pathname.includes('/admin/') ? 'Administración global FOM' : perfil.empresa || 'FOM · Administración'}</span><span className="pnl-fuente">{CONECTADO ? 'Operación conectada' : 'Datos de demostración'}</span></div>
          <div className="pnl-topbar-derecha">
            <Link to="/panel/alertas" className="pnl-notificaciones" aria-label={esAdminFom(perfil) && !perfil.empresaGestion ? 'Alertas: elegir empresa' : `Alertas: ${sinLeer} sin leer`}>
              <Icono nombre="campana" tam={21} />
              {sinLeer > 0 && <span>{sinLeer}</span>}
            </Link>
            <Link to="/panel/mi-perfil" className="pnl-topbar-perfil" aria-label="Mi perfil"><span className="pnl-topbar-identidad"><b>{perfil.nombre}</b><small>{perfil.rolNombre}</small></span><i className="pnl-avatar">{perfil.iniciales}</i></Link>
          </div>
        </div>
        <button
          type="button"
          className="pnl-menu-btn"
          aria-label="Abrir menú"
          aria-expanded={menuAbierto}
          aria-controls="panel-navigation"
          onClick={() => setMenuAbierto(true)}
        >
          <Icono nombre="menu" />
        </button>

        <Routes key={perfil.empresaGestion?.id || 'global'}>
          <Route path="mi-perfil" element={<MiPerfil />} />
          {/* El inicio depende del area: el conductor abre en SU unidad, no en
              el resumen de toda la flota. */}
          <Route index element={area === 'conductor' ? <MiUnidad /> : <Resumen />} />
          <Route path="mapa" element={area === 'conductor' ? <MapaConductor /> : <CentroControl />} />
          <Route path="alertas" element={<Alertas />} />
          <Route path="flota" element={<Flota />} />
          <Route path="flota/:id" element={<ExpedienteVehiculo />} />
          <Route path="seguridad" element={<Seguridad />} />
          <Route path="jornadas" element={<Jornadas />} />
          <Route path="mantenimiento" element={area === 'conductor' ? <MantenimientoConductor /> : <Mantenimiento />} />
          <Route path="mantenimiento/planes" element={<Navigate to="/panel/mantenimiento?vista=planes" replace />} />
          <Route path="inspecciones" element={<Inspecciones />} />
          <Route path="inspecciones/programa" element={<Navigate to="/panel/inspecciones?vista=agenda" replace />} />
          <Route path="documentos" element={<Documentos />} />
          <Route path="personal" element={<AdminUsuarios />} />
          <Route path="personal/:id" element={<ExpedienteConductor />} />
          <Route path="reportes" element={<Reportes />} />
          {/* La capa multiempresa: solo existe para el Administrador FOM. */}
          {esAdminFom(perfil) && (
            <>
              <Route path="admin/empresas" element={<AdminEmpresas />} />
              <Route path="admin/plataforma" element={<Plataforma />} />
              <Route path="admin/vehiculos" element={<AdminVehiculos />} />
              <Route path="admin/transferencias" element={<Transferencias />} />
              <Route path="admin/pagos" element={<AdminPagos />} />
              <Route path="admin/gps" element={<AdminGps />} />
              <Route path="admin/auditoria" element={<AdminAuditoria />} />
            </>
          )}
          {esGestor(perfil) && <Route path="admin/usuarios" element={<AdminUsuarios />} />}
          <Route path="*" element={<Navigate to="/panel" replace />} />
        </Routes>
      </main>
    </div>
  )
}
