import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { entrarEmpresa } from '../auth'
import { vehiculosDeLaPlataforma } from '../datos/vehiculosPlataforma'
import { Buscador, Cargando, Chips, Datos, ErrorCarga, Kpi, Modal, Tag, Vacio } from '../comp/ui'
import MiniFoto from '../comp/MiniFoto'
import NuevaUnidadEmpresa from '../comp/NuevaUnidadEmpresa'
import { empresaPropia } from '../datos/instalarGps'
import { Icono } from '../Iconos'
import * as f from '../datos/formato'
import { etiqueta } from '../datos/catalogos'
import { ordenarSinSenal, textoSinSenal, textoUltimoReporte, transmitiendo, useMinuto } from '../datos/sinSenal'
import './mantenimiento.css'
import './admin-vehiculos.css'

// ============================================================
// VEHÍCULOS GENERALES (solo Administrador FOM)
// ------------------------------------------------------------
// Todas las unidades de todas las empresas en una lista: buscar, filtrar
// por empresa, señal y tipo, ver la ficha de cada una y abrir su
// expediente completo (se entra a su empresa primero). Crear unidades es
// solo del administrador: el servidor rechaza el alta de un supervisor. «Nueva
// unidad» crea en la empresa elegida SIN entrar a ella (T-215).
// ============================================================

const SENALES = [
  { v: 'todas', t: 'Todas' },
  { v: 'reportando', t: 'Reportando' },
  { v: 'sin_senal', t: 'Sin señal' },
]
const POR_PAGINA = 60
// Con señal = reportó hace menos de 5 min, la misma regla de la app y del resto del panel.
const reportando = (v, ahora) => transmitiendo(v.ultimoReporte, ahora)

export default function AdminVehiculos() {
  const navegar = useNavigate()
  const sesion = useSesion()
  const datos = useDatos(() => vehiculosDeLaPlataforma(), [], 30_000)
  const [q, setQ] = useState('')
  const [empresaId, setEmpresaId] = useState('')
  const [senal, setSenal] = useState('todas')
  const [tipo, setTipo] = useState('')
  const [mostrar, setMostrar] = useState(POR_PAGINA)
  const [seleccion, setSeleccion] = useState(null)
  const [abriendo, setAbriendo] = useState(false)
  const [error, setError] = useState('')
  const [creando, setCreando] = useState(false)
  const [creada, setCreada] = useState('')
  // «Sin señal · hace …» corre solo cada minuto, sin volver a leer las empresas.
  const ahora = useMinuto()

  const todos = datos.datos?.vehiculos ?? []
  const empresas = datos.datos?.empresas ?? []
  const propia = empresaPropia(sesion)
  const tipos = useMemo(() => [...new Set(todos.map((v) => v.tipo))].sort(), [todos])

  const lista = useMemo(() => {
    const texto = q.trim().toLowerCase()
    const filtradas = todos.filter((v) =>
      (!empresaId || v.empresaId === empresaId) &&
      (!tipo || v.tipo === tipo) &&
      (senal === 'todas' || (senal === 'reportando' ? reportando(v, ahora) : !reportando(v, ahora))) &&
      (!texto || [v.alias, v.placa, v.numero, v.marca, v.modelo, v.empresaNombre, v.conductorNombre].join(' ').toLowerCase().includes(texto)))
    // Las sin señal, de más tiempo callada a menos, en los puestos que ya ocupaban.
    return ordenarSinSenal(filtradas, (v) => !reportando(v, ahora), ahora)
  }, [todos, q, empresaId, tipo, senal, ahora])

  const conEmpresas = new Set(todos.map((v) => v.empresaId)).size
  const vivas = todos.filter((v) => reportando(v, ahora)).length

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
        <Kpi titulo="Reportando" valor={f.numero(vivas)} icono="pin" tono="ok" nota="Señal en los últimos 5 min" />
        <Kpi titulo="Sin señal" valor={f.numero(todos.length - vivas)} icono="alerta" tono="aviso" nota="Más de 5 min o nunca" />
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
      {creada && <p className="av-aviso" role="status"><Icono nombre="check" tam={16} />{creada}</p>}
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
                    <td>{reportando(v, ahora) ? <Tag color="verde">{f.desde(v.ultimoReporte)}</Tag> : <Tag color="gris">{textoSinSenal(v.ultimoReporte, ahora)}</Tag>}</td>
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
            <span>{f.numero(Math.min(mostrar, lista.length))} de {f.cantidad(lista.length, 'unidad', 'unidades')}</span>
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
                {reportando(seleccion, ahora) ? <Tag color="verde">Reportando · {f.desde(seleccion.ultimoReporte)}</Tag> : <Tag color="gris">{textoSinSenal(seleccion.ultimoReporte, ahora)}</Tag>}
                {!reportando(seleccion, ahora) && textoUltimoReporte(seleccion.ultimoReporte) && <small className="av-ultimo">{textoUltimoReporte(seleccion.ultimoReporte)}</small>}
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

      <NuevaUnidadEmpresa
        abierto={creando}
        empresas={empresas}
        ofrecerGps
        propia={propia}
        nombrePropia={empresas.find((e) => e.id === propia)?.nombre || 'tu empresa'}
        alCerrar={() => setCreando(false)}
        alCerrarConUnidad={(r) => { setCreada(`La unidad «${r.alias}» se creó, pero sin GPS. Instálalo desde Administración FOM → GPS.`); datos.recargar() }}
        alListo={(r) => {
          setCreando(false)
          setCreada(`La unidad «${r.alias}» se creó en ${r.empresaNombre}${r.instalado ? ' con su GPS instalado' : ''}.`)
          datos.recargar()
        }}
      />
    </div>
  )
}
