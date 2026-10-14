import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDatos } from '../useDatos'
import { entrarEmpresa } from '../auth'
import { vehiculosDeLaPlataforma } from '../datos/vehiculosPlataforma'
import { Buscador, Campo, Cargando, Chips, Datos, ErrorCarga, Kpi, Modal, Tag, Vacio } from '../comp/ui'
import MiniFoto from '../comp/MiniFoto'
import { Icono } from '../Iconos'
import * as f from '../datos/formato'
import { etiqueta } from '../datos/catalogos'
import './mantenimiento.css'
import './admin-vehiculos.css'

// ============================================================
// VEHÍCULOS GENERALES (solo Administrador FOM)
// ------------------------------------------------------------
// Todas las unidades de todas las empresas en una lista: buscar, filtrar
// por empresa, señal y tipo, ver la ficha de cada una y abrir su
// expediente completo (se entra a su empresa primero). Crear unidades es
// solo del administrador: el servidor rechaza el alta de un supervisor.
// ============================================================

const SENALES = [
  { v: 'todas', t: 'Todas' },
  { v: 'reportando', t: 'Reportando' },
  { v: 'sin_senal', t: 'Sin señal' },
]
const POR_PAGINA = 60
const reportando = (v) => Boolean(v.ultimoReporte) && Date.now() - Date.parse(v.ultimoReporte) < 24 * 3600 * 1000

export default function AdminVehiculos() {
  const navegar = useNavigate()
  const datos = useDatos(() => vehiculosDeLaPlataforma(), [])
  const [q, setQ] = useState('')
  const [empresaId, setEmpresaId] = useState('')
  const [senal, setSenal] = useState('todas')
  const [tipo, setTipo] = useState('')
  const [mostrar, setMostrar] = useState(POR_PAGINA)
  const [seleccion, setSeleccion] = useState(null)
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState('')
  const [creando, setCreando] = useState(false)

  const todos = datos.datos?.vehiculos ?? []
  const empresas = datos.datos?.empresas ?? []
  const tipos = useMemo(() => [...new Set(todos.map((v) => v.tipo))].sort(), [todos])

  const lista = useMemo(() => {
    const texto = q.trim().toLowerCase()
    return todos.filter((v) =>
      (!empresaId || v.empresaId === empresaId) &&
      (!tipo || v.tipo === tipo) &&
      (senal === 'todas' || (senal === 'reportando' ? reportando(v) : !reportando(v))) &&
      (!texto || [v.alias, v.placa, v.numero, v.marca, v.modelo, v.empresaNombre, v.conductorNombre].join(' ').toLowerCase().includes(texto)))
  }, [todos, q, empresaId, tipo, senal])

  const conEmpresas = new Set(todos.map((v) => v.empresaId)).size
  const vivas = todos.filter(reportando).length

  async function abrirExpediente(v) {
    if (abriendo) return
    setAbriendo(true)
    setError('')
    try {
      await entrarEmpresa(v.empresa)
      navegar(`/panel/flota/${encodeURIComponent(v.id)}?origen=vehiculos-generales`)
    } catch (e) {
      setError(e.message || 'No se pudo abrir el expediente.')
      setAbriendo(false)
    }
  }

  return (
    <div className="mnt-root av-root">
      <div className="mnt-heading av-cabecera">
        <div>
          <span className="mnt-breadcrumb">Inicio › Administración › Vehículos generales</span>
          <h1>Vehículos generales</h1>
          <p>Todas las unidades de todas las empresas. Busca, filtra y abre la ficha completa de cada una.</p>
        </div>
        <button type="button" className="pnl-btn primario" onClick={() => setCreando(true)} disabled={!empresas.length}>
          <Icono nombre="mas" tam={16} />Nueva unidad
        </button>
      </div>

      <div className="pnl-grid k4 av-kpis">
        <Kpi titulo="Unidades" valor={f.numero(todos.length)} icono="camion" nota="En toda la plataforma" />
        <Kpi titulo="Empresas con unidades" valor={`${conEmpresas} de ${empresas.length}`} icono="empresa" />
        <Kpi titulo="Reportando" valor={f.numero(vivas)} icono="pin" tono="ok" nota="Señal en las últimas 24 h" />
        <Kpi titulo="Sin señal" valor={f.numero(todos.length - vivas)} icono="alerta" tono="aviso" nota="Más de 24 h o nunca" />
      </div>

      <div className="av-filtros">
        <Buscador valor={q} alCambiar={(v) => { setQ(v); setMostrar(POR_PAGINA) }} placeholder="Placa, alias, marca, conductor o empresa…" />
        <select className="pnl-input" aria-label="Empresa" value={empresaId} onChange={(e) => { setEmpresaId(e.target.value); setMostrar(POR_PAGINA) }}>
          <option value="">Todas las empresas</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <select className="pnl-input" aria-label="Tipo de unidad" value={tipo} onChange={(e) => { setTipo(e.target.value); setMostrar(POR_PAGINA) }}>
          <option value="">Todos los tipos</option>
          {tipos.map((t) => <option key={t} value={t}>{etiqueta('vehiculo_tipo', t)}</option>)}
        </select>
        <Chips opciones={SENALES} valor={senal} alCambiar={(v) => { setSenal(v); setMostrar(POR_PAGINA) }} />
      </div>

      {datos.datos?.fallidas?.length > 0 && (
        <p className="av-aviso" role="status">
          <Icono nombre="alerta" tam={16} />
          No se pudieron leer las unidades de: {datos.datos.fallidas.map((x) => x.empresa.nombre).join(', ')}. Las demás sí se muestran.
        </p>
      )}
      {error && <p className="pnl-campo-error" role="alert">{error}</p>}

      {datos.estado === 'cargando' ? <Cargando filas={6} /> : datos.estado === 'error' ? (
        <ErrorCarga error={datos.error} onReintentar={datos.recargar} />
      ) : lista.length === 0 ? (
        <Vacio icono="camion" titulo="Ninguna unidad coincide" texto="Cambia la búsqueda o quita algún filtro." />
      ) : (
        <div className="pnl-card av-tabla">
          <div className="pnl-tabla-wrap">
            <table className="pnl-tabla">
              <thead>
                <tr><th>Unidad</th><th>Empresa</th><th>Marca y modelo</th><th>Conductor</th><th>Señal</th><th>Kilometraje</th><th aria-label="Acciones" /></tr>
              </thead>
              <tbody>
                {lista.slice(0, mostrar).map((v) => (
                  <tr key={`${v.empresaId}:${v.id}`} className="av-fila" onClick={() => setSeleccion(v)}>
                    <td>
                      <div className="av-unidad">
                        <MiniFoto vehiculoId={v.id} alto={44} ancho={56} />
                        <div><b>{v.alias}</b><span>{[v.placa, v.numero && v.numero !== v.alias ? `N.º ${v.numero}` : ''].filter(Boolean).join(' · ') || 'Sin placa'}</span></div>
                      </div>
                    </td>
                    <td>{v.empresaNombre}</td>
                    <td>{[v.marca, v.modelo, v.anio].filter(Boolean).join(' ') || '—'}<small className="av-sub">{etiqueta('vehiculo_tipo', v.tipo)}</small></td>
                    <td>{v.conductorNombre || <span className="av-tenue">Sin conductor</span>}</td>
                    <td>{reportando(v) ? <Tag color="verde">{f.desde(v.ultimoReporte)}</Tag> : <Tag color="gris">{v.ultimoReporte ? f.desde(v.ultimoReporte) : 'Nunca'}</Tag>}</td>
                    <td className="num">{v.km != null ? `${f.numero(Math.round(v.km))} km` : '—'}</td>
                    <td className="num">
                      <button type="button" className="pnl-btn sutil" onClick={(e) => { e.stopPropagation(); setSeleccion(v) }}>Ver ficha</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="av-pie">
            <span>{f.numero(Math.min(mostrar, lista.length))} de {f.numero(lista.length)} unidades</span>
            {mostrar < lista.length && <button type="button" className="pnl-btn sutil" onClick={() => setMostrar((n) => n + POR_PAGINA)}>Mostrar más</button>}
          </div>
        </div>
      )}

      <Modal titulo={seleccion ? `${seleccion.alias}${seleccion.placa ? ` · ${seleccion.placa}` : ''}` : 'Unidad'} abierto={Boolean(seleccion)} alCerrar={() => setSeleccion(null)} ancho={720}>
        {seleccion && (
          <div className="av-ficha">
            <div className="av-ficha-cab">
              <MiniFoto vehiculoId={seleccion.id} alto={120} ancho={160} />
              <div>
                <b>{seleccion.alias}</b>
                <span>{seleccion.empresaNombre}</span>
                {reportando(seleccion) ? <Tag color="verde">Reportando · {f.desde(seleccion.ultimoReporte)}</Tag> : <Tag color="gris">Sin señal{seleccion.ultimoReporte ? ` · ${f.desde(seleccion.ultimoReporte)}` : ''}</Tag>}
              </div>
            </div>
            <Datos items={[
              { etiqueta: 'Empresa', valor: seleccion.empresaNombre },
              { etiqueta: 'Placa', valor: seleccion.placa || '—' },
              { etiqueta: 'Número de flota', valor: seleccion.numero || '—' },
              { etiqueta: 'Marca y modelo', valor: [seleccion.marca, seleccion.modelo].filter(Boolean).join(' ') || '—' },
              { etiqueta: 'Año', valor: seleccion.anio ?? '—' },
              { etiqueta: 'Tipo', valor: etiqueta('vehiculo_tipo', seleccion.tipo) },
              { etiqueta: 'Área', valor: seleccion.areaNombre || 'Sin área' },
              { etiqueta: 'Conductor principal', valor: seleccion.conductorNombre || 'Sin conductor' },
              { etiqueta: 'Kilometraje', valor: seleccion.km != null ? `${f.numero(Math.round(seleccion.km))} km` : '—' },
              { etiqueta: 'Velocidad', valor: seleccion.velocidadKmh != null ? f.velocidad(seleccion.velocidadKmh) : '—' },
              { etiqueta: 'Último reporte', valor: seleccion.ultimoReporte ? f.fechaHora(seleccion.ultimoReporte) : 'Nunca' },
              { etiqueta: 'Posición', valor: seleccion.lat != null ? `${seleccion.lat.toFixed(5)}, ${seleccion.lng.toFixed(5)}` : '—' },
            ]} />
            <p className="av-nota">El expediente completo tiene documentos, mantenimiento, inspecciones, recorrido y costos. Para abrirlo se entra a la empresa de la unidad.</p>
            <div className="av-acciones">
              <button type="button" className="pnl-btn" onClick={() => setSeleccion(null)}>Cerrar</button>
              <button type="button" className="pnl-btn primario" disabled={abriendo} onClick={() => abrirExpediente(seleccion)}>
                {abriendo ? 'Entrando a la empresa…' : 'Abrir expediente completo'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {creando && <NuevaUnidadEnEmpresa empresas={empresas} alCerrar={() => setCreando(false)} />}
    </div>
  )
}

/** Crear una unidad: se elige la empresa, se entra a ella y se abre el alta de la flota. */
function NuevaUnidadEnEmpresa({ empresas, alCerrar }) {
  const navegar = useNavigate()
  const [empresaId, setEmpresaId] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  async function continuar() {
    const empresa = empresas.find((e) => e.id === empresaId)
    if (!empresa) { setError('Elige la empresa de la unidad.'); return }
    setOcupado(true)
    setError('')
    try {
      await entrarEmpresa(empresa)
      navegar('/panel/flota', { state: { nuevaUnidad: true } })
    } catch (e) {
      setError(e.message || 'No se pudo entrar a la empresa.')
      setOcupado(false)
    }
  }
  return (
    <Modal titulo="Nueva unidad" abierto alCerrar={alCerrar} ancho={520}>
      <div className="av-ficha">
        <Campo etiqueta="¿De qué empresa es la unidad?" error={error}>
          <select className="pnl-input" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
            <option value="">Elige la empresa…</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </Campo>
        <p className="av-nota">Se abre el alta de la flota de esa empresa con sus áreas y su GPS.</p>
        <div className="av-acciones">
          <button type="button" className="pnl-btn" onClick={alCerrar} disabled={ocupado}>Cancelar</button>
          <button type="button" className="pnl-btn primario" onClick={continuar} disabled={ocupado}>{ocupado ? 'Entrando…' : 'Continuar'}</button>
        </div>
      </div>
    </Modal>
  )
}
