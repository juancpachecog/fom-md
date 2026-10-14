import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Planes from './Planes'
import VehicleVisual from '../../components/VehicleVisual'
import './mantenimiento.css'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import {
  Barra,
  Buscador,
  Campo,
  Cargando,
  Chips,
  Datos,
  ErrorCarga,
  Modal,
  Tag,
  Tarjeta,
  Vacio,
} from '../comp/ui'
import * as f from '../datos/formato'
import { color, etiqueta } from '../datos/catalogos'
import { presentarHistorial } from '../datos/historial-odt'
import { GaleriaArchivos, SelectorArchivos } from '../comp/Archivos'
import { subirVarios } from '../datos/archivos'
import { Icono } from '../Iconos'

// ============================================================
// MANTENIMIENTO — órdenes de trabajo de la flota.
// La app móvil solo muestra la lista de ODT de un vehículo; aquí el
// supervisor ve toda la operación: tablero por estado, tabla completa,
// expediente de cada orden y las reglas que crean las preventivas solas.
// ============================================================

// El tablero agrupa los nueve estados del servidor en cuatro columnas que
// se leen de un vistazo; el detalle de cada orden enseña el estado exacto.
const GRUPOS = [
  { clave: 'abierta', titulo: 'Abiertas', color: 'ambar', estados: ['abierta'], vacio: 'Nadie ha reportado fallas nuevas.' },
  { clave: 'revision', titulo: 'En revisión', color: 'azul', estados: ['en_revision', 'aprobada'], vacio: 'Ninguna orden esperando aprobación.' },
  { clave: 'taller', titulo: 'En taller', color: 'azul', estados: ['asignada', 'en_ejecucion', 'pausada', 'en_calidad'], vacio: 'Ninguna unidad está en taller ahora mismo.' },
  { clave: 'cerrada', titulo: 'Finalizadas', color: 'verde', estados: ['cerrada', 'cancelada'], vacio: 'Todavía no se ha cerrado ninguna orden.' },
]
const EN_CURSO = ['en_revision', 'aprobada', 'asignada', 'en_ejecucion', 'pausada', 'en_calidad']

// Los pasos posibles desde cada estado. Es la tabla de transiciones del
// servidor más los dos caminos aparte que usa la app: asignar responsable
// (aprobada → asignada) y los eventos de ejecución (inicio, pausa,
// reanudación, entrega).
const PASOS_ODT = {
  abierta: [
    { a: 'en_revision', t: 'Pasar a revisión' },
    { a: 'cerrada', t: 'Resolver sin taller' },
    { a: 'cancelada', t: 'Cancelar orden', sutil: true },
  ],
  en_revision: [
    { a: 'aprobada', t: 'Aprobar' },
    { a: 'abierta', t: 'Devolver a abierta', sutil: true },
    { a: 'cerrada', t: 'Resolver sin taller' },
    { a: 'cancelada', t: 'Cancelar orden', sutil: true },
  ],
  aprobada: [
    { a: 'asignar', t: 'Asignar responsable' },
    { a: 'en_revision', t: 'Volver a revisión', sutil: true },
    { a: 'cerrada', t: 'Resolver sin taller' },
    { a: 'cancelada', t: 'Cancelar orden', sutil: true },
  ],
  asignada: [
    { a: 'inicio', t: 'Iniciar trabajo', ejecucion: true },
    { a: 'asignar', t: 'Reasignar', sutil: true },
    { a: 'en_revision', t: 'Volver a revisión', sutil: true },
    { a: 'cancelada', t: 'Cancelar orden', sutil: true },
  ],
  en_ejecucion: [
    { a: 'entrega', t: 'Entregar a calidad', ejecucion: true },
    { a: 'pausa', t: 'Pausar', ejecucion: true, sutil: true },
    { a: 'cancelada', t: 'Cancelar orden', sutil: true },
  ],
  pausada: [
    { a: 'reanudacion', t: 'Reanudar', ejecucion: true },
    { a: 'cancelada', t: 'Cancelar orden', sutil: true },
  ],
  en_calidad: [
    { a: 'cerrada', t: 'Cerrar' },
    { a: 'en_ejecucion', t: 'Devolver a ejecución', sutil: true },
    { a: 'cancelada', t: 'Cancelar orden', sutil: true },
  ],
  cerrada: [{ a: 'en_revision', t: 'Reabrir' }],
  cancelada: [],
}
const AYUDA_ODT = {
  abierta: 'Alguien reportó la falla. Pásala a revisión para evaluarla, o resuélvela directo si no necesita taller.',
  en_revision: 'Se está evaluando. Apruébala para llevarla a taller, o resuélvela sin taller si ya se atendió.',
  aprobada: 'Aprobada. Asigna quién la ejecuta en taller (lo verá en su app), o resuélvela sin taller.',
  asignada: 'Tiene responsable. El trabajo empieza cuando el responsable lo inicia desde su app.',
  en_ejecucion: 'En taller. Cuando termine, se entrega a calidad.',
  pausada: 'El trabajo está detenido. Reanúdalo cuando siga.',
  en_calidad: 'Terminó el trabajo: revisa y cierra con lo que se hizo y el costo.',
  cerrada: 'Si la falla volvió, reábrela: pasa a revisión y el cierre queda en el historial.',
  cancelada: 'Cancelada: no admite más cambios.',
}

const TIPOS_FALLA = ['motor', 'frenos', 'neumaticos', 'electrico', 'carroceria', 'otro']

const UBICACION_POR_DEFECTO = 'Registrada desde el panel'

/** Ámbar para lo correctivo (algo se dañó), azul para lo preventivo (algo se cuida). */
function colorTipo(tipo) {
  return tipo === 'preventiva' ? 'azul' : 'ambar'
}

/** Todo el módulo se pide junto: un solo error con reintento en vez de tres. */
function cargarMantenimiento() {
  return Promise.all([repo.odts.listar({}), repo.vehiculos.listar({})]).then(
    ([odts, vehiculos]) => ({ odts, vehiculos, reglas: [] })
  )
}

export default function Mantenimiento() {
  const [params, setParams] = useSearchParams()
  const vista = ['planes', 'todas'].includes(params.get('vista')) ? params.get('vista') : 'ordenes'
  function cambiar(v) { setParams(v === 'ordenes' ? {} : { vista: v }) }
  return <div className="mnt-root">
    <div className="mnt-heading"><div><span className="mnt-breadcrumb">Inicio › Mantenimiento</span><h1>Mantenimiento</h1><p>Qué necesita atención y qué sigue en taller.</p></div></div>
    <nav className="mnt-nav" aria-label="Secciones de mantenimiento">
      {[['ordenes', 'llave', 'Órdenes'], ['todas', 'documento', 'Todas las órdenes'], ['planes', 'sync', 'Planes']].map(([v, icono, t]) => <button key={v} type="button" aria-current={vista === v ? 'page' : undefined} className={vista === v ? 'activo' : ''} onClick={() => cambiar(v)}><Icono nombre={icono} tam={18}/>{t}</button>)}
    </nav>
    {['ordenes', 'todas'].includes(vista) ? <Ordenes key={vista} listaCompleta={vista === 'todas'} /> : <Planes key={vista} vista={vista} integrado />}
  </div>
}

function Ordenes({ listaCompleta = false }) {
  const sesion = useSesion()
  const { datos, estado, error, recargar } = useDatos(cargarMantenimiento, [])
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState('')
  const [vista, setVista] = useState(listaCompleta ? 'lista' : 'atencion')
  const [unidadFiltro, setUnidadFiltro] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [grupo, setGrupo] = useState('')
  const [params] = useSearchParams()
  const [detalleId, setDetalleId] = useState(() => params.get('orden'))
  const [creando, setCreando] = useState(false)
  const [aviso, setAviso] = useState('')
  const odts = datos?.odts ?? []
  const vehiculos = datos?.vehiculos ?? []
  const visibles = useMemo(() => odts.filter(o => {
    if (tipo && o.tipo !== tipo) return false
    if (unidadFiltro && o.vehiculoId !== unidadFiltro) return false
    if (estadoFiltro && o.estado !== estadoFiltro) return false
    if (grupo && !GRUPOS.find(g => g.clave === grupo)?.estados.includes(o.estado)) return false
    return [o.id, o.descripcion, o.vehiculoNombre, o.creadorNombre, etiqueta('tipo_falla', o.tipoFalla)].join(' ').toLowerCase().includes(q.trim().toLowerCase())
  }), [odts, q, tipo, grupo, unidadFiltro, estadoFiltro])
  const detalle = detalleId ? odts.find(o => o.id === detalleId) : null
  const filtrosEtapa = <div className="mnt-states" aria-label="Filtrar por etapa"><button type="button" aria-pressed={!grupo} onClick={() => setGrupo('')}>Todas <b>{odts.length}</b></button>{GRUPOS.map(g => <button type="button" key={g.clave} aria-pressed={grupo === g.clave} onClick={() => setGrupo(grupo === g.clave ? '' : g.clave)}><i className={g.color}/>{g.titulo}<b>{odts.filter(o => g.estados.includes(o.estado)).length}</b></button>)}</div>
  return <div className="mnt-content">
    <div className="mnt-toolbar"><div><h2>{listaCompleta ? 'Todas las órdenes de mantenimiento' : 'Órdenes de trabajo'}</h2><p>{listaCompleta ? 'Consulta abiertas, en proceso, cerradas y canceladas de esta empresa.' : 'De la falla reportada a la unidad lista para volver.'}</p></div><button className="pnl-btn primario" type="button" onClick={() => setCreando(true)}><Icono nombre="mas" tam={18}/>Crear orden</button></div>
    {aviso && <div className="mnt-success" role="status"><Icono nombre="check" tam={20}/>{aviso}</div>}
    {estado === 'cargando' && <Cargando filas={6}/>}
    {estado === 'error' && <ErrorCarga onReintentar={recargar} texto={error?.message}/>}
    {estado === 'ok' && <>
      <Indicadores odts={odts}/>
      {vista === 'lista' &&       <div className="mnt-filters"><Buscador valor={q} alCambiar={setQ} placeholder="Buscar orden o unidad…"/><FiltroTipo odts={odts} valor={tipo} alCambiar={setTipo}/>{!listaCompleta && <div className="mnt-view"><button type="button" aria-pressed={vista === 'atencion'} onClick={() => setVista('atencion')}>Resumen</button><button type="button" aria-pressed={vista === 'lista'} onClick={() => setVista('lista')}>Lista</button></div>}</div>
}
      {vista === 'lista' && (listaCompleta ? <div className="mnt-all-filters">
        <Campo etiqueta="Vehículo"><select aria-label="Vehículo" className="pnl-input" value={unidadFiltro} onChange={e => setUnidadFiltro(e.target.value)}><option value="">Todos los vehículos</option>{[...new Map(odts.map(o => [o.vehiculoId, o.vehiculoNombre])).entries()].filter(([id]) => id).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></Campo>
        <Campo etiqueta="Estado"><select aria-label="Estado" className="pnl-input" value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}><option value="">Todos los estados</option>{Object.keys(AYUDA_ODT).map(e => <option key={e} value={e}>{etiqueta('odt_estado', e)}</option>)}</select></Campo>
        <p role="status">{visibles.length} de {odts.length} órdenes</p>
        {(q || tipo || unidadFiltro || estadoFiltro) && <button type="button" className="pnl-btn sutil" onClick={() => { setQ(''); setTipo(''); setUnidadFiltro(''); setEstadoFiltro('') }}>Limpiar filtros</button>}
      </div> : filtrosEtapa)}
      {vista === 'lista' ? <Tarjeta titulo="Todas las órdenes" sinCuerpo><Lista odts={visibles} alAbrir={setDetalleId}/></Tarjeta> : <div className="mnt-overview"><div><Tarjeta titulo="Necesita tu atención" accion={<div className="mnt-attention-tools"><div className="mnt-view"><button type="button" aria-pressed={vista === 'atencion'} onClick={() => setVista('atencion')}>Prioridades</button><button type="button" aria-pressed={vista === 'lista'} onClick={() => setVista('lista')}>Lista</button></div><Buscador valor={q} alCambiar={setQ} placeholder="Buscar orden o unidad…"/></div>} sinCuerpo><Atencion odts={visibles.filter(o => !['cerrada', 'cancelada'].includes(o.estado))} vehiculos={vehiculos} alAbrir={setDetalleId} alCrear={() => setCreando(true)}/><details className="mnt-type-filter"><summary>Filtrar por tipo de orden</summary><FiltroTipo odts={odts} valor={tipo} alCambiar={setTipo}/></details>      {filtrosEtapa}
</Tarjeta></div><aside className="mnt-guide"><h3>Cómo avanza una orden</h3><p className="mnt-guide-intro">Del reporte al cierre, en cuatro pasos.</p>{[['Reportar', 'Elige la unidad y describe la falla.'], ['Revisar y asignar', 'Evalúa el reporte y asigna a quien hará el trabajo.'], ['Trabajo en taller', 'El responsable inicia, pausa y entrega desde su app.'], ['Revisar y cerrar', 'Confirma la solución y registra el costo si lo tienes.']].map(([t,d],i) => <div className="mnt-guide-step" key={t}><b>{i+1}</b><div><strong>{t}</strong><p>{d}</p></div></div>)}<Link to="/panel/mantenimiento?vista=planes" className="pnl-link">Prepara tus servicios con un plan →</Link></aside></div>}
      {vista === 'atencion' && <Tarjeta titulo="Órdenes cerradas · toca una para ver qué pasó" sinCuerpo><Cierres odts={visibles.filter(o => o.estado === 'cerrada').sort((a,b) => new Date(b.resueltaEn || b.creadaEn) - new Date(a.resueltaEn || a.creadaEn))} alAbrir={setDetalleId}/></Tarjeta>}
      <details className="mnt-legacy"><summary>Consultar reglas heredadas</summary><ReglasHeredadas/></details>
    </>}
    <Modal titulo="Detalle de la orden" abierto={Boolean(detalle)} alCerrar={() => setDetalleId(null)} ancho={1080}>{detalle && <Detalle key={detalle.id} odt={detalle} perfil={sesion?.perfil ?? null} vehiculo={vehiculos.find(v => v.id === detalle.vehiculoId)} recargar={recargar} alCerrar={() => setDetalleId(null)}/>}</Modal>
    <Modal titulo="Crear orden de trabajo" abierto={creando} alCerrar={() => setCreando(false)} ancho={840}>{creando && <NuevaOdt vehiculos={vehiculos} creadorId={sesion?.perfil?.id ?? null} recargar={recargar} alCerrar={() => setCreando(false)} alCrear={nombre => setAviso(`Orden creada para ${nombre}. Ya puedes revisarla.`)}/>}</Modal>
  </div>
}

function Atencion({ odts, vehiculos, alAbrir, alCrear }) {
  if (!odts.length) return <Vacio icono="check" titulo="No hay órdenes pendientes con estos filtros" texto="Cuando se reporte una falla aparecerá aquí con su siguiente paso." accion={<button type="button" className="pnl-btn" onClick={alCrear}>Crear orden</button>}/>
  const prioridad = { critica: 0, alta: 1, media: 2, baja: 3 }
  return <div className="mnt-orders">{[...odts].sort((a,b) => (prioridad[a.prioridad] ?? 2) - (prioridad[b.prioridad] ?? 2) || new Date(a.creadaEn) - new Date(b.creadaEn)).map(o => <article key={o.id} className="mnt-order"><div className="mnt-thumb"><VehicleVisual modelo={vehiculos.find(v => v.id === o.vehiculoId)?.modelo ?? ''} compacta/></div><div className="mnt-order-copy"><span>{o.vehiculoNombre}</span><h3>{o.descripcion}</h3><div><Tag color={color('odt_estado', o.estado)}>{etiqueta('odt_estado', o.estado)}</Tag><small>{f.desde(o.creadaEn)} · {etiqueta('odt_tipo', o.tipo)}</small></div></div><button type="button" className="pnl-btn" onClick={() => alAbrir(o.id)}>{o.estado === 'abierta' ? 'Revisar' : o.estado === 'aprobada' ? 'Asignar' : o.estado === 'en_calidad' ? 'Revisar cierre' : 'Ver orden'} →</button></article>)}</div>
}

// ---------------- Indicadores ----------------

function Indicadores({ odts }) {
  const abiertas = odts.filter((o) => o.estado === 'abierta')
  const enRevision = odts.filter((o) => EN_CURSO.includes(o.estado))
  const cerradas = odts.filter((o) => o.estado === 'cerrada')

  const hoy = new Date()
  const cerradasMes = cerradas.filter((o) => {
    if (!o.resueltaEn) return false
    const d = new Date(o.resueltaEn)
    return d.getMonth() === hoy.getMonth() && d.getFullYear() === hoy.getFullYear()
  })
  const gasto = cerradas.reduce((a, o) => a + (Number(o.costo) || 0), 0)
  const conCosto = cerradas.filter((o) => o.costo != null).length

  return <div className="mnt-summary">{[['Por revisar', abiertas.length, 'Pendientes de revisión'], ['En proceso', enRevision.length, 'Revisión y taller'], ['Cerradas este mes', cerradasMes.length, 'Servicios completados'], ['Costo acumulado', f.moneda(gasto), `${conCosto} cierres con costo`]].map(([t,v,d],i) => <div key={t}><Icono nombre={['documento','llave','check','reporte'][i]} tam={28}/><span>{t}</span><b>{v}</b><small>{d}</small></div>)}</div>
}

function FiltroTipo({ odts, valor, alCambiar }) {
 return <Chips opciones={[{v:'',t:'Todas',n:odts.length},{v:'correctiva',t:'Correctivas',n:odts.filter(o=>o.tipo==='correctiva').length},{v:'preventiva',t:'Preventivas',n:odts.filter(o=>o.tipo==='preventiva').length}]} valor={valor} alCambiar={alCambiar}/>
}

// ---------------- Vista lista ----------------

function Lista({ odts, alAbrir }) {
  if (odts.length === 0) {
    return (
      <div className="pnl-card-cuerpo">
        <Vacio
          icono="llave"
          titulo="No hay órdenes con estos filtros"
          texto="Prueba con otra búsqueda o muestra todos los tipos de orden."
        />
      </div>
    )
  }

  return (
    <div className="pnl-tabla-wrap">
      <table className="pnl-tabla">
        <thead>
          <tr>
            <th>Descripción</th>
            <th>Unidad</th>
            <th>Tipo</th>
            <th>Falla</th>
            <th>Generó</th>
            <th>Creada</th>
            <th>Estado</th>
            <th className="num">Costo</th>
          </tr>
        </thead>
        <tbody>
          {odts.map((o) => (
            <tr
              key={o.id}
              className="pnl-tabla-fila-link"
              onClick={() => alAbrir(o.id)}
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  alAbrir(o.id)
                }
              }}
            >
              <td>
                <div className="pnl-doble">
                  <button type="button" className="mnt-table-link" onClick={e => { e.stopPropagation(); alAbrir(o.id) }}>{o.descripcion}</button>
                  <span>{o.ubicacion || 'Sin ubicación'}</span>
                </div>
              </td>
              <td>{o.vehiculoNombre}</td>
              <td>
                <Tag color={colorTipo(o.tipo)}>{etiqueta('odt_tipo', o.tipo)}</Tag>
              </td>
              <td>{o.tipoFalla ? etiqueta('tipo_falla', o.tipoFalla) : 'No especificado'}</td>
              <td>{o.creadorNombre}</td>
              <td>{f.fechaCorta(o.creadaEn)}</td>
              <td>
                <Tag color={color('odt_estado', o.estado)}>{etiqueta('odt_estado', o.estado)}</Tag>
              </td>
              <td className="num">{o.costo != null ? f.moneda(o.costo) : '·'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cierres({ odts, alAbrir }) {
 if (!odts.length) return <Vacio icono="check" titulo="Aún no hay cierres con estos filtros" texto="Aquí aparecerán las órdenes resueltas y su costo registrado."/>
 return <div className="pnl-tabla-wrap"><table className="pnl-tabla"><thead><tr><th>Cierre</th><th>Unidad</th><th>Trabajo realizado</th><th>Tipo</th><th className="num">Costo</th></tr></thead><tbody>{odts.map(o => <tr key={o.id} className="pnl-tabla-fila-link" onClick={() => alAbrir(o.id)}><td>{o.resueltaEn ? f.fechaCorta(o.resueltaEn) : 'Sin fecha'}</td><td>{o.vehiculoNombre}</td><td><button type="button" className="mnt-table-link" onClick={() => alAbrir(o.id)}>{o.descripcion}</button></td><td>{etiqueta('odt_tipo',o.tipo)}</td><td className="num">{o.costo != null ? f.moneda(o.costo) : 'Sin registrar'}</td></tr>)}</tbody></table></div>
}

// ---------------- Detalle de una ODT ----------------

function Detalle({ odt, perfil, vehiculo, recargar, alCerrar }) {
  // ------------------------------------------------------------
  // El ciclo de la orden es el MISMO que el de la app y el del servidor:
  //   abierta → en revisión → aprobada → asignada → en ejecución ⇄ pausada
  //   → en calidad → cerrada; cancelada en cualquier punto; cerrada se
  //   reabre a revisión.
  // Cada paso viaja con el estado que se vio (para no pisar a nadie) y una
  // nota que queda en el historial. Asignar responsable y ejecutar (iniciar,
  // pausar, reanudar, entregar) son rutas distintas del cambio de estado, tal
  // como las usa la app en el taller.
  // ------------------------------------------------------------
  const [pendiente, setPendiente] = useState(null) // { a, t, ... }
  const [nota, setNota] = useState('')
  const [notaSolucion, setNotaSolucion] = useState(odt.notaSolucion ?? '')
  const [costo, setCosto] = useState(odt.costo != null ? String(odt.costo) : '')
  const [responsableId, setResponsableId] = useState('')
  const [buscarPersona, setBuscarPersona] = useState('')
  const confirmacionRef = useRef(null)
  const siguienteRef = useRef(null)
  const teniaPaso = useRef(false)
  useEffect(() => {
    if (pendiente) {
      confirmacionRef.current?.querySelector('input,textarea,select,button:not(:disabled)')?.focus()
      teniaPaso.current = true
    } else if (teniaPaso.current) {
      siguienteRef.current?.querySelector('button:not(:disabled)')?.focus()
      teniaPaso.current = false
    }
  }, [pendiente?.a])
  const [errores, setErrores] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState('')
  const [aviso, setAviso] = useState('')
  const gente = useDatos(() => repo.admin.usuarios.listar({}), [])
  // Responsable y eventos de taller: solo cuando la orden ya está en taller.
  const enTaller = ['asignada', 'en_ejecucion', 'pausada', 'en_calidad'].includes(odt.estado)
  const ejecucion = useDatos(
    () => ((enTaller || odt.estado === 'cerrada') && repo.odts.ejecucion ? repo.odts.ejecucion(odt.id) : Promise.resolve(null)),
    [odt.id, odt.estado],
  )
  // Cada cambio de estado de la orden, guardado en la base con su autor, su fecha y su nota.
  const historial = useDatos(() => (repo.odts.historial ? repo.odts.historial(odt.id) : Promise.resolve(null)), [odt.id, odt.estado])
  const responsable = ejecucion.datos?.responsable ?? null
  // La sesión trae correo y nombre, no identificador: se resuelve contra la
  // lista de gente. Iniciar, pausar, reanudar y entregar los hace SOLO el
  // responsable (el servidor responde «no existe» a cualquier otro), igual
  // que en la app: el gestor asigna, revisa y cierra.
  const yo = (gente.datos ?? []).find((p) => p.email && perfil?.correo && p.email.toLowerCase() === perfil.correo.toLowerCase())
  const soyResponsable = Boolean(responsable && yo && (yo.userId ?? yo.id) === responsable.id)

  const items = [
    {
      etiqueta: 'Unidad',
      valor: odt.vehiculoId ? (
        <Link to={`/panel/flota/${odt.vehiculoId}`} className="pnl-link" onClick={alCerrar}>
          {odt.vehiculoNombre}
        </Link>
      ) : (
        'Sin unidad'
      ),
    },
    { etiqueta: 'Tipo de orden', valor: etiqueta('odt_tipo', odt.tipo) },
    { etiqueta: 'Prioridad', valor: etiqueta('odt_prioridad', odt.prioridad) },
    {
      etiqueta: 'Tipo de falla',
      valor: odt.tipoFalla ? etiqueta('tipo_falla', odt.tipoFalla) : 'No especificado',
    },
    { etiqueta: 'La generó', valor: odt.creadorNombre },
    { etiqueta: 'Creada', valor: f.fechaHora(odt.creadaEn) },
    { etiqueta: 'Ubicación', valor: odt.ubicacion || 'Sin ubicación' },
  ]
  if (responsable) items.push({ etiqueta: 'Responsable', valor: `${responsable.nombre} · desde ${f.fechaHora(responsable.desde)}` })

  if (odt.estado === 'cerrada' && odt.resueltaEn) {
    const minutos = (new Date(odt.resueltaEn) - new Date(odt.creadaEn)) / 60000
    items.push({ etiqueta: 'Resuelta', valor: f.fechaHora(odt.resueltaEn) })
    const dias = Math.floor(minutos / 1440)
    const resto = Math.round(minutos % 1440)
    items.push({ etiqueta: 'Tiempo de resolución', valor: Number.isFinite(minutos) && minutos >= 0 ? (dias ? `${dias} ${dias === 1 ? 'día' : 'días'}${resto ? ` y ${f.duracion(resto)}` : ''}` : f.duracion(minutos)) : 'Sin fecha válida' })
  }

  const pasos = (PASOS_ODT[odt.estado] ?? []).filter((p) => !p.ejecucion || soyResponsable)
  const pasosDelResponsable = (PASOS_ODT[odt.estado] ?? []).filter((p) => p.ejecucion)
  // Antes de llegar al taller, la orden puede resolverse directo (una revisión rápida, un ajuste en sitio…).
  const sinTaller = ['abierta', 'en_revision', 'aprobada'].includes(odt.estado) ? (PASOS_ODT[odt.estado] ?? []).find((p) => p.a === 'cerrada') : null

  // Solo piden datos (y por eso abren formulario) asignar, cerrar y cancelar. Iniciar, pausar, reanudar,
  // entregar, aprobar o devolver no tienen nada que preguntar: se hacen con un clic.
  const PIDEN_DATOS = ['asignar', 'cerrada', 'cancelada']
  function elegir(paso) {
    if (guardando) return
    setFallo('')
    setErrores({})
    if (!PIDEN_DATOS.includes(paso.a)) {
      confirmar(paso)
      return
    }
    setPendiente(pendiente?.a === paso.a ? null : paso)
  }

  async function confirmar(directo) {
    // Llamado desde un botón recibe el evento; llamado desde `elegir`, el paso.
    const paso = directo?.a ? directo : pendiente
    const err = {}
    // La nota es opcional: si no se escribe, el historial guarda qué paso se dio y desde dónde.
    const notaFinal = nota.trim().length >= 3 ? nota.trim() : `${paso.t} (desde la consola)`
    if (paso.a === 'asignar' && !responsableId) err.responsable = 'Elige quién se hace cargo.'
    let monto = null
    if (paso.a === 'cerrada') {
      if (!notaSolucion.trim()) err.notaSolucion = 'Cuenta qué se hizo para resolver la falla.'
      const crudo = costo.trim()
      monto = crudo === '' ? null : Number(crudo)
      if (monto !== null && (!Number.isFinite(monto) || monto < 0)) err.costo = 'El costo no puede ser negativo.'
    }
    setErrores(err)
    if (Object.keys(err).length > 0) return

    setGuardando(true)
    setFallo('')
    try {
      if (paso.a === 'asignar') {
        await repo.odts.asignarResponsable(odt.id, { usuarioId: responsableId, nota: notaFinal })
      } else if (paso.ejecucion) {
        await repo.odts.ejecutar(odt, paso.a, notaFinal)
      } else {
        await repo.odts.cambiarEstado(odt.id, paso.a, {
          estadoActual: odt.estado,
          nota: notaFinal,
          notaSolucion: paso.a === 'cerrada' ? notaSolucion.trim() : undefined,
          costo: paso.a === 'cerrada' ? monto : undefined,
          moneda: paso.a === 'cerrada' && monto != null ? 'USD' : undefined,
        })
      }
      setAviso(paso.a === 'asignar' ? 'Responsable asignado.' : `Cambio confirmado: ${paso.t}.`)
      setPendiente(null)
      setNota('')
      await recargar()
    } catch (e) {
      setFallo(e?.message || 'No pudimos guardar el cambio. Inténtalo otra vez.')
    } finally {
      setGuardando(false)
    }
  }

  if (pendiente) return <div className="mnt-action-dialog"><aside className="mnt-action-context"><VehicleVisual modelo={vehiculo?.modelo ?? ''}/><h3>{odt.vehiculoNombre}</h3><p>{odt.descripcion}</p><hr/><span className="mnt-muted">Estado actual</span><Tag color={color('odt_estado', odt.estado)}>{etiqueta('odt_estado', odt.estado)}</Tag><p>El cambio y la nota quedarán registrados en la orden.</p>{pendiente.a === 'cerrada' && <p>La solución se conserva como historial de la unidad.</p>}{pendiente.a === 'asignar' && <p>Solo el responsable asignado podrá iniciar, pausar y entregar el trabajo.</p>}</aside><div>
        <section ref={confirmacionRef} className="mnt-confirm mnt-action-form">
          <h3>{pendiente.t}</h3><p>{pendiente.a === 'cancelada' ? 'La orden quedará cancelada y no admitirá más cambios.' : pendiente.a === 'asignar' ? 'El responsable verá el trabajo en su app.' : `Confirma este paso para ${odt.vehiculoNombre}.`}</p>
          {pendiente.a === 'asignar' && (
            <div className="mnt-assignee"><Buscador valor={buscarPersona} alCambiar={setBuscarPersona} placeholder="Buscar responsable por nombre…"/>
              {gente.estado === 'cargando' && <Cargando filas={3}/>}
              {gente.estado === 'error' && <ErrorCarga texto={gente.error?.message} onReintentar={gente.recargar}/>}
              <div className="mnt-people" role="group" aria-label="Responsable">{(gente.datos ?? []).filter(p => (p.estado === 'active' || p.estado === 'activo' || !p.estado) && p.nombre?.toLowerCase().includes(buscarPersona.trim().toLowerCase())).map(p => <button type="button" key={p.id} aria-pressed={responsableId === (p.userId ?? p.id)} onClick={() => setResponsableId(p.userId ?? p.id)}><span className="mnt-person-avatar">{f.iniciales(p.nombre)}</span><span><b>{p.nombre}</b><small>{p.rolEtiqueta || 'Miembro activo de la empresa'}</small></span><i>{responsableId === (p.userId ?? p.id) ? '✓' : ''}</i></button>)}</div>
              {errores.responsable && <p className="pnl-campo-error" role="alert">{errores.responsable}</p>}
            </div>
          )}
          {pendiente.a === 'cerrada' && (
            <>
              <Campo etiqueta="Qué se hizo" error={errores.notaSolucion} ayuda="Queda como historial de la unidad.">
                <textarea
                  className="pnl-textarea"
                  rows={3}
                  value={notaSolucion}
                  onChange={(e) => setNotaSolucion(e.target.value)}
                  placeholder="Se cambiaron las pastillas delanteras y se purgó el sistema."
                />
              </Campo>
              <Campo etiqueta="Costo (USD)" error={errores.costo} ayuda="Opcional. Déjalo vacío si aún no lo tienes.">
                <input type="number" className="pnl-input" min="0" step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} placeholder="0" />
              </Campo>
            </>
          )}
          <Campo etiqueta={pendiente.a === 'cerrada' ? 'Nota del cierre (opcional)' : 'Nota (opcional)'} error={errores.nota} ayuda="Si la escribes, queda en el historial de la orden.">
            <textarea className="pnl-textarea" rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
          </Campo>
          <div className="pnl-kanban-cab">
            <button type="button" className={`pnl-btn primario${pendiente.a === 'cancelada' ? ' mnt-critical' : ''}`} onClick={confirmar} disabled={guardando}>
              {guardando ? 'Guardando…' : pendiente.t}
            </button>
            <button type="button" className="pnl-btn sutil" onClick={() => { setPendiente(null); setErrores({}) }} disabled={guardando}>
              Volver
            </button>
          </div>
        </section>
{fallo && <p className="pnl-campo-error" role="alert">{fallo}</p>}</div></div>

  return (
    <div className="mnt-detail">
      <section className="mnt-detail-main">
      <div className="pnl-kanban-cab">
        <Tag color={color('odt_estado', odt.estado)}>{etiqueta('odt_estado', odt.estado)}</Tag>
        <Tag color={colorTipo(odt.tipo)}>{etiqueta('odt_tipo', odt.tipo)}</Tag>
        {odt.prioridad && <Tag color={color('odt_prioridad', odt.prioridad)} plano>{etiqueta('odt_prioridad', odt.prioridad)}</Tag>}
        <em>{f.desde(odt.creadaEn)}</em>
      </div>

      <header className="mnt-detail-title">
        <span>Problema reportado</span>
        <h2>{odt.descripcion}</h2>
        <p>Referencia de la orden: <code>{odt.id.slice(0, 8)}</code></p>
      </header>

      <div className="mnt-unit"><VehicleVisual modelo={vehiculo?.modelo ?? ''} compacta/><div><b>{odt.vehiculoNombre}</b><span>{[vehiculo?.marca, vehiculo?.modelo].filter(Boolean).join(' ') || 'Unidad de la flota'}</span></div></div>
      <section className={`mnt-resolution${odt.estado === 'cerrada' && !odt.notaSolucion ? ' incompleta' : ''}`} aria-label="Situación del trabajo">
        <div className="mnt-resolution-heading"><Icono nombre={odt.estado === 'cerrada' ? (odt.notaSolucion ? 'check' : 'alerta') : 'llave'} tam={24}/><h3>{odt.estado === 'cerrada' ? 'Resultado del trabajo' : 'Estado del trabajo'}</h3></div>
        {odt.estado === 'cerrada' ? <>
          <p>{odt.notaSolucion || 'La orden está cerrada, pero no se registró qué se hizo para solucionar la falla.'}</p>
          <dl className="mnt-resolution-facts"><div><dt>Cierre</dt><dd>{odt.resueltaEn ? f.fechaHora(odt.resueltaEn) : 'Sin fecha registrada'}</dd></div><div><dt>Costo registrado</dt><dd>{odt.costo != null ? f.moneda(odt.costo) : 'Sin registrar'}</dd></div><div><dt>Tiempo hasta el cierre</dt><dd>{items.find(i => i.etiqueta === 'Tiempo de resolución')?.valor || 'Sin fechas suficientes'}</dd></div></dl>
        </> : <><p>{AYUDA_ODT[odt.estado] || 'Revisa el reporte y elige la siguiente acción disponible.'}</p><p className="mnt-detail-responsable"><b>Responsable:</b> {responsable?.nombre || 'Aún sin asignar'}</p></>}
      </section>
      <details className="mnt-record"><summary>Datos del reporte <span>Unidad, responsable, fechas y ubicación</span></summary><Datos items={items}/><p className="mnt-order-reference">Identificador completo: <code>{odt.id}</code></p></details>
      <div className="arch-bloque">
        <GaleriaArchivos coleccion="work-orders" padreId={odt.id} proposito="work_order_opening" titulo="Fotos del reporte" vacio="Nadie ha subido fotos de la falla todavía." />
        <GaleriaArchivos coleccion="work-orders" padreId={odt.id} proposito="work_order_closure" titulo="Fotos del trabajo terminado" vacio="Todavía no hay fotos del trabajo hecho." />
      </div>

      {ejecucion.estado === 'error' && <ErrorCarga texto={ejecucion.error?.message} onReintentar={ejecucion.recargar}/>}
      {(() => {
        const hitos = presentarHistorial(odt, historial.datos ?? [], ejecucion.datos)
        const grupos = []
        for (const hito of hitos) {
          const fecha = hito.fechaValida ? f.fecha(hito.en) : 'Sin fecha registrada'
          if (grupos.at(-1)?.fecha !== fecha) grupos.push({ fecha, hitos: [] })
          grupos.at(-1).hitos.push(hito)
        }
        return (
          <section className="mnt-history">
            <h3>Historial de la orden</h3>
            <p className="mnt-history-intro">Del reporte al cierre, en el orden en que ocurrió.</p>
            {historial.estado === 'cargando' && <p role="status">Consultando los cambios registrados…</p>}
            {historial.estado === 'error' && <ErrorCarga texto="No se pudo cargar el historial completo. Estas son las fechas disponibles de la orden." onReintentar={historial.recargar}/>}
            {grupos.map(grupo => <div className="mnt-history-day" key={grupo.fecha}>
              <h4>{grupo.fecha}</h4>
              <ol className="mnt-history-events">
                {grupo.hitos.map((h, i) => <li className="mnt-history-event" key={i}>
                  <time dateTime={h.fechaValida ? new Date(h.en).toISOString() : undefined}>{h.fechaValida ? f.hora(h.en) : 'Sin hora'}</time>
                  <div className="mnt-history-event-body">
                    <strong>{h.titulo}</strong>
                    <span className="mnt-history-actor">{h.actor ? `Por ${h.actor}` : 'Autor no registrado'}</span>
                    {h.responsable && <p className="mnt-history-responsable"><b>A cargo de:</b> {h.responsable}</p>}
                    {h.notas.length > 0 && <div className="mnt-history-note"><span>Nota registrada</span>{h.notas.map((n, j) => <p key={j}>{n}</p>)}</div>}
                  </div>
                </li>)}
              </ol>
            </div>)}
          </section>
        )
      })()}
      </section><aside className="mnt-next">
      {aviso && <div className="mnt-success" role="status">{aviso}</div>}
      <div className="pnl-fila-txt">
        <b>{odt.estado === 'cerrada' ? '¿La falla volvió?' : 'Siguiente paso'}</b>
        <span>{AYUDA_ODT[odt.estado] ?? 'Mueve la orden según vaya avanzando el trabajo.'}</span>
      </div>

      {enTaller && pasosDelResponsable.length > 0 && !soyResponsable && (
        <div className="pnl-fila">
          <Icono nombre="llamar" tam={16} />
          <div className="pnl-fila-txt">
            <b>{pasosDelResponsable.map((p) => p.t).join(', ')}: lo hace {responsable ? responsable.nombre : 'el responsable'} desde su app.</b>
            <span>Como en el taller: quien tiene la orden asignada la inicia, la pausa y la entrega. Las demás acciones disponibles se muestran según la etapa actual.</span>
          </div>
        </div>
      )}

      {pasos.length === 0 ? (
        <span className="pnl-fila-txt">Esta orden está cancelada: no admite más cambios.</span>
      ) : (
        <div ref={siguienteRef} className="mnt-next-actions" role="group" aria-label="Acciones sobre la orden">
          {pasos.filter(p => !p.sutil).slice(0,1).map(p => <button key={p.a} type="button" className="pnl-btn primario" onClick={() => elegir(p)} disabled={guardando}>{p.t} →</button>)}
          {sinTaller && <button type="button" className="pnl-btn" onClick={() => elegir(sinTaller)} disabled={guardando}>{sinTaller.t}</button>}
          {sinTaller && <p className="mnt-muted" style={{ fontSize: 12, margin: 0 }}>¿No necesita taller? Ciérrala ahora contando qué se hizo.</p>}
          <details><summary>Más acciones</summary>{pasos.filter(p => p !== pasos.find(p => !p.sutil) && p !== sinTaller).map(p => <button key={p.a} type="button" className="pnl-btn sutil" onClick={() => elegir(p)} disabled={guardando}>{p.t}</button>)}</details>
        </div>
      )}

      {fallo && (
        <div className="pnl-fila critica">
          <Icono nombre="alerta" tam={16} />
          <div className="pnl-fila-txt">
            <b>{fallo}</b>
          </div>
        </div>
      )}
    </aside></div>
  )
}

// ---------------- Nueva ODT ----------------

export function NuevaOdt({ vehiculos, creadorId, recargar, alCerrar, alCrear, sinPermiso = '', comoConductor = false }) {
  // Con una sola unidad (el conductor) no hay nada que elegir: se salta al paso de la falla.
  const [vehiculoId, setVehiculoId] = useState(vehiculos.length === 1 ? vehiculos[0].id : '')
  const [paso, setPaso] = useState(vehiculos.length === 1 ? 2 : 1)
  const [busqueda, setBusqueda] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [tipoFalla, setTipoFalla] = useState('motor')
  const [ubicacion, setUbicacion] = useState(UBICACION_POR_DEFECTO)
  const [errores, setErrores] = useState({})
  const [guardando, setGuardando] = useState(false)
  const [fallo, setFallo] = useState('')
  const [fotos, setFotos] = useState([])
  // La orden ya se creó pero alguna foto no subió: el botón pasa a «Listo».
  const [creada, setCreada] = useState(false)

  if (vehiculos.length === 0) {
    return (
      <Vacio
        icono="camion"
        titulo="No hay unidades registradas"
        texto="Agrega una unidad a la flota para poder levantar órdenes de trabajo."
      />
    )
  }

  const elegido = vehiculos.find((v) => v.id === vehiculoId)

  function crear() {
    const err = {}
    if (!vehiculoId) err.vehiculo = "Elige una unidad."
    // El mismo minimo que exige el servidor. Validarlo aqui convierte un
    // rechazo del servidor en un aviso junto al campo, que es donde se puede
    // corregir.
    if (!descripcion.trim()) err.descripcion = 'Describe la falla.'
    else if (descripcion.trim().length < 10)
      err.descripcion = 'Describe un poco mas: al menos 10 caracteres.'
    setErrores(err)
    if (Object.keys(err).length > 0) return

    setGuardando(true)
    setFallo('')
    repo.odts
      .crear({
        vehiculoId,
        descripcion: descripcion.trim(),
        tipoFalla,
        ubicacion: ubicacion.trim() || UBICACION_POR_DEFECTO,
        creadorId,
        comoConductor,
      })
      .then(async (r) => {
        // Las fotos se suben DESPUÉS de crear la orden: necesitan su número para quedar unidas a ella.
        // El servidor devuelve { id }; el modo demo, el id solo.
        const odtId = typeof r === 'string' ? r : r?.id
        if (fotos.length && odtId) {
          const s = await subirVarios({ coleccion: 'work-orders', padreId: odtId, proposito: 'work_order_opening', archivos: fotos })
          if (s.errores.length) {
            setFallo(`La orden quedó creada, pero ${s.errores.length} de ${fotos.length} fotos no se subieron: ${s.errores[0]} Puedes agregarlas desde el detalle de la orden.`)
            setCreada(true)
            setGuardando(false)
            return recargar()
          }
        }
        alCrear(elegido?.placa || elegido?.alias || "la unidad")
        alCerrar()
        return recargar()
      })
      .catch((error) => {
        // Se muestra el motivo REAL. Un «inténtalo otra vez» generico invita a
        // repetir algo que no puede funcionar, y esconde justo el dato que
        // permite arreglarlo.
        setFallo(sinPermiso && /permiso/i.test(error?.message ?? '') ? sinPermiso : (error?.message || 'No pudimos crear la orden.'))
        setGuardando(false)
      })
  }

  return <div className="mnt-wizard">
    <div className="mnt-wizard-steps">{vehiculos.length > 1 && <span className={paso === 1 ? 'activo' : ''}>1 · Elige la unidad</span>}<span className={paso === 2 ? 'activo' : ''}>{vehiculos.length > 1 ? '2 · ' : ''}Describe la falla</span></div>
    {paso === 1 ? <>
      <h3>¿Qué unidad necesita atención?</h3><p>Selecciona el vehículo para continuar.</p>
      <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar por placa o nombre…"/>
      <div className="mnt-vehicle-options">{vehiculos.filter(v => [v.alias,v.placa,v.marca,v.modelo].join(' ').toLowerCase().includes(busqueda.trim().toLowerCase())).map(v => <button key={v.id} type="button" aria-pressed={vehiculoId === v.id} onClick={() => setVehiculoId(v.id)}><VehicleVisual modelo={v.modelo ?? ''} compacta/><span><b>{v.placa || v.alias}</b><small>{v.alias} · {v.marca} {v.modelo}</small><small>{v.conductorNombre || 'Sin conductor asignado'}</small></span><i>{vehiculoId === v.id ? '✓' : ''}</i></button>)}</div>
      <div className="mnt-form-footer"><span>{elegido ? `Seleccionada: ${elegido.placa || elegido.alias}` : 'Selecciona una unidad'}</span><button type="button" className="pnl-btn primario" disabled={!vehiculoId} onClick={() => setPaso(2)}>Continuar →</button></div>
    </> : <div className="mnt-new-layout"><div className="pnl-filas">
      <Campo
        etiqueta="Qué le pasa a la unidad"
        error={errores.descripcion}
        ayuda="Mientras más claro, más rápido la resuelven en taller."
      >
        <textarea
          className="pnl-textarea"
          rows={3}
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="El freno de mano no sostiene la camioneta en pendiente."
        />
      </Campo>

      <fieldset className="mnt-failure"><legend>Tipo de falla</legend><div>{TIPOS_FALLA.map(t => <button type="button" key={t} aria-pressed={tipoFalla === t} onClick={() => setTipoFalla(t)}><Icono nombre="llave" tam={18}/>{etiqueta('tipo_falla', t)}</button>)}</div></fieldset>

      <Campo etiqueta="Ubicación" ayuda="Dónde está la unidad o dónde ocurrió la falla.">
        <input
          type="text"
          className="pnl-input"
          value={ubicacion}
          onChange={(e) => setUbicacion(e.target.value)}
          placeholder={UBICACION_POR_DEFECTO}
        />
      </Campo>

      <SelectorArchivos
        archivos={fotos}
        alCambiar={setFotos}
        coleccion="work-orders"
        titulo="Fotos de la falla (opcional)"
        ayuda="Hasta 10 fotos de lo que se dañó. Se suben al crear la orden."
        deshabilitado={guardando || creada}
      />

      {fallo && (
        <div className="pnl-fila critica">
          <Icono nombre="alerta" tam={16} />
          <div className="pnl-fila-txt">
            <b>{fallo}</b>
          </div>
        </div>
      )}

      <div className="pnl-kanban-cab">
        {creada ? (
          <button type="button" className="pnl-btn primario" onClick={alCerrar}>Listo</button>
        ) : (
          <button type="button" className="pnl-btn primario" onClick={crear} disabled={guardando}>
            {guardando ? (fotos.length ? 'Creando y subiendo fotos…' : 'Creando…') : 'Crear orden'}
          </button>
        )}
        {vehiculos.length > 1 && (<button type="button" className="pnl-btn sutil" onClick={() => setPaso(1)} disabled={guardando}>
          ← Cambiar unidad
        </button>)}
      </div>
    </div><aside className="mnt-new-context"><VehicleVisual modelo={elegido?.modelo ?? ''}/><h3>{elegido?.placa || elegido?.alias}</h3><p>{elegido?.marca} {elegido?.modelo}</p><p>{elegido?.conductorNombre || 'Sin conductor asignado'}</p><hr/><b>¿Qué sigue?</b><p>La orden quedará abierta para revisarla y asignar el trabajo.</p></aside></div>}
  </div>
}

// ---------------- Reglas de alerta ----------------

function textoRegla(r) {
  if (r.tipo === 'velocidad') return `Velocidad mayor a ${f.numero(r.umbral)} km/h`
  return `${r.servicio || 'Servicio programado'}: cada ${f.numero(r.umbral)} km`
}

function ReglasHeredadas() {
 const lectura = useDatos(() => repo.reglas.listar(), [])
 return lectura.estado === 'cargando' ? <Cargando filas={2}/> : lectura.estado === 'error' ? <ErrorCarga texto={lectura.error?.message} onReintentar={lectura.recargar}/> : <Reglas reglas={lectura.datos ?? []}/>
}

function Reglas({ reglas }) {
  return (
    <Tarjeta titulo="Reglas de alerta">
      {reglas.length === 0 ? (
        <Vacio
          icono="alerta"
          titulo="Todavía no hay reglas"
          texto="Cuando configures una regla de velocidad o de mantenimiento la verás aquí."
        />
      ) : (
        <div className="pnl-filas">
          {reglas.map((r) => {
            const asignadas = r.vehiculos?.length ?? 0
            const promedio =
              r.tipo === 'mantenimiento' && asignadas > 0 && r.umbral
                ? r.vehiculos.reduce((a, v) => a + (v.progresoKm ?? 0), 0) / asignadas / r.umbral
                : 0
            const listo = promedio >= 0.85
            return (
              <div className={`pnl-fila${listo ? ' aviso' : ''}`} key={r.id}>
                <div className="pnl-fila-txt">
                  <b>{textoRegla(r)}</b>
                  <span>
                    {asignadas} {asignadas === 1 ? 'unidad asignada' : 'unidades asignadas'}
                  </span>
                  {r.tipo === 'mantenimiento' && (
                    <>
                      <Barra valor={promedio} tono={listo ? 'aviso' : ''} />
                      <span>Progreso promedio: {Math.round(Math.min(1, promedio) * 100)}%</span>
                    </>
                  )}
                </div>
                <Tag color={r.activa ? 'verde' : 'gris'}>{r.activa ? 'Activa' : 'Pausada'}</Tag>
                <em>{f.fechaCorta(r.creadaEn)}</em>
              </div>
            )
          })}
          <p className="pnl-fila-txt">
            <span>
              Estas reglas son de consulta. Gestiona los servicios actuales desde Planes y Próximos servicios.
            </span>
          </p>
        </div>
      )}
    </Tarjeta>
  )
}
