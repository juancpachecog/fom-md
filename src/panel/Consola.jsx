import LogoFom from '../components/LogoFom'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, UNSAFE_NavigationContext, useLocation, useNavigate } from 'react-router-dom'
import { cerrarSesion, esAdminFom, resolverSesion, salirEmpresa, sesionActual } from './auth'
import { areaDe, esGestor } from './roles'
import { useSesion } from './useSesion'
import { useApariencia } from './useApariencia'
import { estaLeida } from './modulos/alertas-presentacion'
import { Icono } from './Iconos'
import repo, { alCambiarAvisosGps, alCambiarDatos, CONECTADO } from './datos/repo'
import { useAvisosConductor } from './datos/useAvisosConductor'
import '../styles/apariencia.css'
import { accesosDe, esPestana, MovilContexto, pestanasDe, tituloDe, useEsMovil } from './comp/movil-navegacion'
import { MovilBarra, MovilEncabezado, MovilPantalla } from './comp/movil-piezas'
import { conTransicion, useEntradaPantalla, useFilasUnaVez, useNavegacionSuave } from './movimiento'

import { Cargando } from './comp/ui'
import { ReceptorMenu } from './comp/GpsPiezas'
// Los estilos de los módulos, fijos y en su orden de siempre (ver el archivo).
import './estilos-consola'
// Al final: el teléfono manda sobre los estilos de escritorio de los módulos.
import '../styles/movil-app.css'
// El movimiento de toda la consola (T-184), después de todo lo demás.
import '../styles/movimiento.css'

// Cada módulo se baja cuando se entra a su pantalla (o un poco antes, en los
// ratos libres): el primer pintado de la consola ya no carga Reportes, Admin,
// GPS, Planes... de quien solo viene a ver su unidad. Los `import()` quedan en
// una tabla para poder pedirlos por adelantado sin duplicar la ruta.
const CARGADORES = {
  Resumen: () => import('./modulos/Resumen'),
  CentroControl: () => import('./modulos/CentroControl'),
  Flota: () => import('./modulos/Flota'),
  ExpedienteVehiculo: () => import('./modulos/ExpedienteVehiculo'),
  Mantenimiento: () => import('./modulos/Mantenimiento'),
  MantenimientoConductor: () => import('./modulos/MantenimientoConductor'),
  Inspecciones: () => import('./modulos/Inspecciones'),
  ExpedienteConductor: () => import('./modulos/ExpedienteConductor'),
  Alertas: () => import('./modulos/Alertas'),
  Documentos: () => import('./modulos/Documentos'),
  Reportes: () => import('./modulos/Reportes'),
  AdminEmpresas: () => import('./modulos/AdminEmpresas'),
  AdminCicloDatos: () => import('./modulos/AdminCicloDatos'),
  AdminPagos: () => import('./modulos/AdminPagos'),
  CatalogoFunciones: () => import('./modulos/CatalogoFunciones'),
  AdminGps: () => import('./modulos/AdminGps'),
  AdminUsuarios: () => import('./modulos/AdminUsuarios'),
  AdminAuditoria: () => import('./modulos/AdminAuditoria'),
  MiUnidad: () => import('./modulos/MiUnidad'),
  MapaConductor: () => import('./modulos/MapaConductor'),
  InspeccionConductor: () => import('./modulos/InspeccionConductor'),
  SosConductor: () => import('./modulos/SosConductor'),
  OtraUnidad: () => import('./modulos/OtraUnidad'),
  MiPerfil: () => import('./modulos/MiPerfil'),
  Configuracion: () => import('./modulos/Configuracion'),
  Seguridad: () => import('./modulos/Seguridad'),
  Jornadas: () => import('./modulos/Jornadas'),
  Transferencias: () => import('./modulos/Transferencias'),
  Plataforma: () => import('./modulos/Plataforma'),
  AdminVehiculos: () => import('./modulos/AdminVehiculos'),
}
const Resumen = lazy(CARGADORES.Resumen)
const CentroControl = lazy(CARGADORES.CentroControl)
const Flota = lazy(CARGADORES.Flota)
const ExpedienteVehiculo = lazy(CARGADORES.ExpedienteVehiculo)
const Mantenimiento = lazy(CARGADORES.Mantenimiento)
const MantenimientoConductor = lazy(CARGADORES.MantenimientoConductor)
const Inspecciones = lazy(CARGADORES.Inspecciones)
const ExpedienteConductor = lazy(CARGADORES.ExpedienteConductor)
const Alertas = lazy(CARGADORES.Alertas)
const Documentos = lazy(CARGADORES.Documentos)
const Reportes = lazy(CARGADORES.Reportes)
const AdminEmpresas = lazy(CARGADORES.AdminEmpresas)
const AdminPagos = lazy(CARGADORES.AdminPagos)
const CatalogoFunciones = lazy(CARGADORES.CatalogoFunciones)
const AdminGps = lazy(CARGADORES.AdminGps)
const AdminUsuarios = lazy(CARGADORES.AdminUsuarios)
const AdminAuditoria = lazy(CARGADORES.AdminAuditoria)
const MiUnidad = lazy(CARGADORES.MiUnidad)
const MapaConductor = lazy(CARGADORES.MapaConductor)
const InspeccionConductor = lazy(CARGADORES.InspeccionConductor)
const SosConductor = lazy(CARGADORES.SosConductor)
const OtraUnidad = lazy(CARGADORES.OtraUnidad)
const MiPerfil = lazy(CARGADORES.MiPerfil)
const Configuracion = lazy(CARGADORES.Configuracion)
const Seguridad = lazy(CARGADORES.Seguridad)
const Jornadas = lazy(CARGADORES.Jornadas)
const Transferencias = lazy(CARGADORES.Transferencias)
const Plataforma = lazy(CARGADORES.Plataforma)
const AdminVehiculos = lazy(CARGADORES.AdminVehiculos)
const AdminCicloDatos = lazy(CARGADORES.AdminCicloDatos)

/**
 * Qué módulo(s) pide cada ruta. Sirve para empezar a bajar la pantalla antes de
 * que se pinte (al abrir el enlace, o al pasar el dedo/ratón por el menú).
 */
const MODULOS_ADMIN = { funciones: 'CatalogoFunciones', empresas: 'AdminEmpresas', 'ciclo-datos': 'AdminCicloDatos', plataforma: 'Plataforma', vehiculos: 'AdminVehiculos', transferencias: 'Transferencias', pagos: 'AdminPagos', gps: 'AdminGps', auditoria: 'AdminAuditoria', usuarios: 'AdminUsuarios' }
function modulosDeRuta(pathname, area) {
  const [tramo = '', sub] = pathname.replace(/^\/panel\/?/u, '').replace(/\/+$/u, '').split('/')
  const conductor = area === 'conductor'
  switch (tramo) {
    case '': return area ? [conductor ? 'MiUnidad' : 'Resumen'] : []
    case 'mapa': return area ? [conductor ? 'MapaConductor' : 'CentroControl'] : []
    case 'alertas': return ['Alertas']
    case 'flota': return [sub ? 'ExpedienteVehiculo' : 'Flota']
    case 'seguridad': return ['Seguridad']
    case 'jornadas': return ['Jornadas']
    case 'mantenimiento': return area ? [conductor ? 'MantenimientoConductor' : 'Mantenimiento'] : []
    case 'inspecciones': return ['Inspecciones']
    case 'inspeccion': return ['InspeccionConductor']
    case 'sos': return ['SosConductor']
    case 'otra-unidad': return ['OtraUnidad']
    case 'documentos': return ['Documentos']
    case 'personal': return [sub ? 'ExpedienteConductor' : 'AdminUsuarios']
    case 'reportes': return ['Reportes']
    case 'mi-perfil': return ['MiPerfil']
    case 'configuracion': return ['Configuracion']
    case 'funciones': return ['CatalogoFunciones']
    case 'admin': return MODULOS_ADMIN[sub] ? [MODULOS_ADMIN[sub]] : []
    default: return []
  }
}

/** Pide ya los módulos de una ruta. Si falla, no pasa nada: se reintenta al entrar. */
function precargarRuta(pathname, area) {
  modulosDeRuta(pathname, area).forEach((k) => { CARGADORES[k]().catch(() => {}) })
}

// En los ratos libres, tras pintar la primera pantalla, se bajan los demás
// módulos que esa persona puede abrir (de uno en uno, sin competir con el
// mapa), para que cambiar de pantalla no espere a la red.
const PRECARGA_POR_AREA = {
  conductor: ['InspeccionConductor', 'MapaConductor', 'MantenimientoConductor', 'Alertas', 'MiPerfil', 'SosConductor', 'OtraUnidad', 'Configuracion'],
  operativo: ['Flota', 'CentroControl', 'Alertas', 'Seguridad', 'Mantenimiento', 'Jornadas', 'Inspecciones', 'Documentos', 'AdminUsuarios', 'MiPerfil', 'Configuracion', 'ExpedienteVehiculo', 'ExpedienteConductor', 'Reportes'],
  gerencial: ['AdminUsuarios', 'Reportes', 'ExpedienteConductor', 'MiPerfil', 'Configuracion'],
  personal: ['CentroControl', 'Alertas', 'Documentos', 'AdminUsuarios', 'MiPerfil'],
  admin: ['Plataforma', 'AdminEmpresas', 'AdminVehiculos', 'Transferencias', 'AdminPagos', 'AdminGps', 'AdminAuditoria', 'Alertas', 'MiPerfil', 'Configuracion'],
}

function precargaEnReposo(claves) {
  // Con «ahorro de datos» no se baja nada que nadie haya pedido.
  if (typeof navigator === 'undefined' || navigator.connection?.saveData) return () => {}
  let vivo = true
  let reloj
  let idle
  let i = 0
  const pedir = (f) => {
    if (globalThis.requestIdleCallback) idle = globalThis.requestIdleCallback(f, { timeout: 4000 })
    else reloj = setTimeout(f, 300)
  }
  const siguiente = () => {
    if (!vivo || i >= claves.length) return
    CARGADORES[claves[i++]]().catch(() => {}).finally(() => pedir(siguiente))
  }
  reloj = setTimeout(() => pedir(siguiente), 1500)
  return () => {
    vivo = false
    clearTimeout(reloj)
    if (idle != null) globalThis.cancelIdleCallback?.(idle)
  }
}

// Si ya hay sesión guardada, la pantalla de esta ruta empieza a bajar en cuanto
// se evalúa este archivo, en paralelo con el resto del arranque.
if (typeof window !== 'undefined') {
  try {
    const guardada = sesionActual()
    precargarRuta(window.location.pathname, guardada?.perfil ? areaDe(guardada.perfil) : null)
  } catch { /* sin sesión guardada: se pedirá al pintar */ }
}

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
      { a: '/panel/funciones', icono: 'pin', texto: 'Variables y etiquetas', soloGestor: true },
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
    { a: '/panel/admin/ciclo-datos', icono: 'auditoria', texto: 'Retirada y limpieza' },
    { a: '/panel/admin/plataforma', icono: 'buscar', texto: 'Usuarios generales' },
    { a: '/panel/admin/vehiculos', icono: 'camion', texto: 'Vehículos generales' },
    { a: '/panel/admin/transferencias', icono: 'comparar', texto: 'Transferencias' },
    { a: '/panel/admin/pagos', icono: 'costos', texto: 'Facturación' },
    { a: '/panel/admin/funciones', icono: 'pin', texto: 'Variables y etiquetas' },
    { a: '/panel/admin/gps', icono: 'pin', texto: 'Inventario GPS' },
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
        // La inspección diaria se hace también desde la web (T-167a), como en la app.
        { a: '/panel/inspeccion', icono: 'inspeccion', texto: 'Inspección del día' },
        { a: '/panel/mapa', icono: 'mapa', texto: 'Mapa' },
        { a: '/panel/mantenimiento', icono: 'llave', texto: 'Mantenimiento' },
        { a: '/panel/alertas', icono: 'alerta', texto: 'Alertas' },
        // Activarse en otra unidad con el PIN (T-167b). En el teléfono se llega
        // desde Mi perfil, como en la app; en la computadora, desde aquí.
        { a: '/panel/otra-unidad', icono: 'sync', texto: 'Otra unidad', soloEscritorio: true },
        // El SOS, como en la app (T-167b). En el teléfono no va en «Accesos»:
        // allí es el botón rojo que flota sobre el mapa de Mi unidad.
        { a: '/panel/sos', icono: 'llamar', texto: 'Emergencia (SOS)', clase: 'sos-nav', soloEscritorio: true },
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
  operativo: ['', 'mapa', 'alertas', 'seguridad', 'flota', 'funciones', 'jornadas', 'mantenimiento', 'inspecciones', 'documentos', 'personal', 'reportes'],
  gerencial: ['personal', 'reportes'],
  // Más el SOS y otra unidad con PIN (T-167b), que se abren desde Mi unidad y Mi perfil.
  conductor: ['', 'inspeccion', 'mapa', 'alertas', 'mantenimiento'].concat(['sos', 'otra-unidad']),
  personal: ['mapa', 'alertas', 'documentos', 'personal'],
}

/** Pantallas del conductor que no están en el menú del teléfono: su nombre en la cápsula, como el ScreenHeader de la app. */
const TITULOS_PROPIOS = {
  '/panel/sos': 'Emergencia',
  '/panel/otra-unidad': 'Usar otra unidad (PIN)',
}

function inicioDe(area) {
  if (area === 'admin') return '/panel/admin/plataforma'
  if (area === 'gerencial') return '/panel/personal'
  if (area === 'personal') return '/panel/mapa'
  return '/panel'
}

/** El menú de esta persona: el mismo para el lateral y para el teléfono. */
function menuDe(perfil) {
  const menu = esAdminFom(perfil) && perfil.empresaGestion
    ? [MENU_ADMIN, ...MENU]
    : MENU_POR_AREA[areaDe(perfil)] ?? MENU_POR_AREA.conductor
  return menu.map(g=>({...g,items:g.items.filter(item=>!item.soloGestor||esGestor(perfil))}))
}

function Lateral({ perfil, abierto, cerrar, sinLeer }) {
  const menu = menuDe(perfil)
  const area = areaDe(perfil)
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
                onPointerEnter={() => precargarRuta(it.a, area)}
                onFocus={() => precargarRuta(it.a, area)}
                className={({ isActive }) => `pnl-nav-item${it.clase ? ` ${it.clase}` : ''}${isActive ? ' activo' : ''}`}
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
        {/* Estado del receptor GPS: solo para el Administrador FOM y solo si el servidor lo publica. */}
        {esAdminFom(perfil) && <ReceptorMenu />}
        <NavLink to="/panel/mi-perfil" className="pnl-usuario" aria-label="Abrir mi perfil" onClick={cerrar}>
          <i className="pnl-avatar">{perfil.iniciales}</i>
          <div>
            <b>{perfil.nombre}</b>
            <span>{perfil.rolNombre}</span>
          </div>
        </NavLink>
        <NavLink to="/panel/mi-perfil" className={({ isActive }) => `pnl-salir mp-enlace${isActive ? ' activo' : ''}`} onClick={cerrar}><Icono nombre="gente" />Mi perfil</NavLink>
        <NavLink to="/panel/configuracion" className={({ isActive }) => `pnl-salir mp-enlace${isActive ? ' activo' : ''}`} onClick={cerrar}><Icono nombre="ajustes" />Configuración</NavLink>
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
  const navegar = useNavigate()
  const esMovil = useEsMovil()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [sinLeer, setSinLeer] = useState(0)
  // Al conductor la campana le cuenta SUS avisos (su unidad, sus órdenes y sus
  // papeles), como la app y como la campana del teléfono; no los de toda la
  // empresa. Los demás roles, sin cambios.
  const esConductor = areaDe(sesion?.perfil) === 'conductor' && !sesion?.perfil?.empresaGestion
  const suyos = useAvisosConductor(sesion?.perfil, { activo: esConductor, refresco: pathname })
  // Transiciones suaves (T-184): toda navegación que cambia de pantalla pasa
  // por una View Transition; sin la API, la pantalla nueva entra igual.
  const navegacionSuave = useNavegacionSuave()
  const principal = useRef(null)
  useEntradaPantalla(principal)
  useFilasUnaVez()

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
    if (!sesion?.perfil || esConductor || esAdminFom(sesion.perfil) && !sesion.perfil.empresaGestion) { setSinLeer(0); return }
    let vivo = true
    const leer = () =>
      repo.alertas.listar({}).then((l) => vivo && setSinLeer(l.filter(n => !estaLeida(n)).length)).catch(() => {})
    leer()
    const baja = alCambiarDatos(leer)
    // Un aviso nuevo de «GPS sin señal» mueve el globo de la campana en cuanto llega.
    const bajaGps = alCambiarAvisosGps(leer)
    return () => {
      vivo = false
      baja()
      bajaGps()
    }
  }, [pathname, esConductor, sesion?.perfil?.id, sesion?.perfil?.empresaGestion?.id])

  // Tras la primera pantalla, el resto de módulos de su rol se baja en reposo.
  const areaPrecarga = sesion?.perfil ? areaDe(sesion.perfil) : null
  const gestionando = Boolean(sesion?.perfil?.empresaGestion)
  useEffect(() => {
    if (!areaPrecarga) return undefined
    const claves = [...(PRECARGA_POR_AREA[areaPrecarga] ?? PRECARGA_POR_AREA.conductor)]
    if (areaPrecarga === 'admin' && gestionando) claves.push(...PRECARGA_POR_AREA.operativo)
    return precargaEnReposo([...new Set(claves)])
  }, [areaPrecarga, gestionando])

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
  if (area === 'admin' && !perfil.empresaGestion && !['admin', 'mi-perfil', 'configuracion', 'alertas'].includes(primerTramo)) {
    return <Navigate to="/panel/admin/plataforma" replace />
  }
  if (!['mi-perfil', 'configuracion'].includes(primerTramo) && permitidas && !permitidas.includes(primerTramo)) {
    return <Navigate to={inicioDe(area)} replace />
  }

  // En el teléfono: las pestañas del rol abajo y, fuera de ellas, el botón atrás.
  const menu = menuDe(perfil)
  const pestanas = pestanasDe(perfil, area)
  const enPestana = esPestana(pathname, pestanas)
  const titulo = TITULOS_PROPIOS[pathname.replace(/\/+$/u, '')] ?? tituloDe(pathname, menu, pestanas)
  const avisos = esConductor ? suyos.noLeidas : sinLeer
  const etiquetaCampana = esAdminFom(perfil) && !perfil.empresaGestion ? 'Alertas: elegir empresa' : `Alertas: ${avisos} sin leer`
  // Sin historial (se abrió el enlace directo) atrás lleva al inicio: nadie se queda encerrado.
  const volver = () => (window.history.state?.idx > 0 ? navegacionSuave.navigator.go(-1) : conTransicion(() => navegar(inicioDe(area))))
  // Lo que es solo de la computadora (el SOS del menú) no va a «Accesos» del teléfono.
  const menuTelefono = menu.map((g) => ({ ...g, items: g.items.filter((it) => !it.soloEscritorio) }))
  const movil = { esMovil, accesos: accesosDe(menuTelefono, pestanas), sinLeer: avisos, perfil }

  return (
    <UNSAFE_NavigationContext.Provider value={navegacionSuave}>
    <MovilContexto.Provider value={movil}>
    <div className="pnl fom-dark" data-diseno={diseno} data-area={area} data-screen={pathname.replace('/panel', '') || '/resumen'} data-movil={esMovil ? (enPestana ? 'pestana' : 'pila') : undefined}>
      <Lateral
        perfil={perfil}
        abierto={menuAbierto}
        cerrar={() => setMenuAbierto(false)}
        sinLeer={avisos}
      />
      {menuAbierto && (
        <button
          type="button"
          className="pnl-velo"
          aria-label="Cerrar menú"
          onClick={() => setMenuAbierto(false)}
        />
      )}

      <main className="pnl-main" id="contenido" ref={principal}>
        <div className="pnl-topbar">
          <div className="pnl-topbar-contexto"><span className="pnl-contexto"><Icono nombre={esAdminFom(perfil) ? 'empresa' : 'camion'} tam={18} />{esAdminFom(perfil) && pathname.includes('/admin/') ? 'Administración global FOM' : perfil.empresa || 'FOM · Administración'}</span><span className="pnl-fuente">{CONECTADO ? 'Operación conectada' : 'Datos de demostración'}</span></div>
          <div className="pnl-topbar-derecha">
            <Link to="/panel/alertas" className="pnl-notificaciones" aria-label={etiquetaCampana}>
              <Icono nombre="campana" tam={21} />
              {avisos > 0 && <span>{avisos}</span>}
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
        {esMovil && (enPestana
          ? <MovilEncabezado
              seccion={titulo}
              // Como encabezado-fom de la app: el conductor ve solo la sección
              // (su empresa ya está en Mi perfil); los demás, la empresa.
              nombre={area === 'conductor' ? '' : perfil.empresaGestion?.nombre || (esAdminFom(perfil) ? '' : perfil.empresa)}
              sinLeer={avisos}
              etiquetaCampana={etiquetaCampana}
              iniciales={perfil.iniciales}
            />
          : <MovilPantalla titulo={titulo} alVolver={volver} />)}

        {/* Cada pantalla llega en su propio trozo; mientras baja, el esqueleto de siempre
            (espera 120 ms antes de asomarse, ver movimiento.css). */}
        <Suspense fallback={<div className="pnl-cuerpo"><Cargando filas={4} /></div>}>
        <Routes key={perfil.empresaGestion?.id || 'global'}>
          <Route path="mi-perfil" element={<MiPerfil />} />
          <Route path="configuracion" element={<Configuracion />} />
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
          {/* La diaria del conductor; quien gestiona la flota las ve todas en Inspecciones. */}
          <Route path="inspeccion" element={area === 'conductor' ? <InspeccionConductor /> : <Navigate to="/panel/inspecciones" replace />} />
          {/* El SOS y otra unidad con PIN: del conductor, como en la app (T-167b). */}
          <Route path="sos" element={area === 'conductor' ? <SosConductor /> : <Navigate to="/panel/seguridad" replace />} />
          <Route path="otra-unidad" element={area === 'conductor' ? <OtraUnidad /> : <Navigate to="/panel" replace />} />
          <Route path="inspecciones/programa" element={<Navigate to="/panel/inspecciones?vista=plantillas" replace />} />
          <Route path="documentos" element={<Documentos />} />
          <Route path="personal" element={<AdminUsuarios />} />
          <Route path="personal/:id" element={<ExpedienteConductor />} />
          <Route path="reportes" element={<Reportes />} />
          {/* La capa multiempresa: solo existe para el Administrador FOM. */}
          {esAdminFom(perfil) && (
            <>
              <Route path="admin/empresas" element={<AdminEmpresas />} />
              <Route path="admin/ciclo-datos" element={<AdminCicloDatos />} />
              <Route path="admin/plataforma" element={<Plataforma />} />
              <Route path="admin/vehiculos" element={<AdminVehiculos />} />
              <Route path="admin/transferencias" element={<Transferencias />} />
              <Route path="admin/pagos" element={<AdminPagos />} />
              <Route path="admin/funciones" element={<CatalogoFunciones />} />
              <Route path="admin/gps/*" element={<AdminGps />} />
              <Route path="admin/auditoria" element={<AdminAuditoria />} />
            </>
          )}
          {esGestor(perfil) && <Route path="admin/usuarios" element={<AdminUsuarios />} />}
          {esGestor(perfil) && <Route path="funciones" element={<CatalogoFunciones />} />}
          <Route path="*" element={<Navigate to="/panel" replace />} />
        </Routes>
        </Suspense>
      </main>
      {esMovil && enPestana && <MovilBarra pestanas={pestanas} />}
    </div>
    </MovilContexto.Provider>
    </UNSAFE_NavigationContext.Provider>
  )
}
