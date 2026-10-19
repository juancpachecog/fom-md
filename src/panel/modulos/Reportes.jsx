import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { Buscador, Cargando, ErrorCarga, Modal, Tag, Vacio } from '../comp/ui'
import { Anillo, BarrasH } from '../comp/Grafico'
import * as f from '../datos/formato'
import { etiqueta } from '../datos/catalogos'
import { Icono } from '../Iconos'
import { calcularReporte, crearCsv, numeroValido } from './reportes-datos'
import './reportes.css'
import CostosReales from './CostosReales'

const VISTAS = [['resumen', 'Resumen'], ['operacion', 'Operación'], ['mantenimiento', 'Mantenimiento'], ['seguridad', 'Seguridad'], ['costos', 'Costos'], ['unidades', 'Unidades'], ['conductores', 'Conductores']]
const FUENTES = ['Vehículos', 'Órdenes de trabajo', 'Conductores', 'Costos', 'Eventos de alerta', 'Resumen']
const CATEGORIAS = { combustible: 'Combustible', repuestos: 'Repuestos', neumaticos: 'Neumáticos', lubricantes: 'Lubricantes', mano_obra: 'Mano de obra', preventivo: 'Mantenimiento preventivo', correctivo: 'Mantenimiento correctivo', peajes: 'Peajes', seguros: 'Seguros' }
const periodo = dias => `Últimos ${dias} días`
const rango = n => n >= 85 ? 'verde' : n >= 70 ? 'ambar' : 'rojo'
const semaforo = n => n >= 85 ? 'Conforme' : n >= 70 ? 'Alerta' : 'Atención'
const estadoMarcha = v => v.estadoMarcha === 'en_marcha' ? 'En marcha' : v.estadoMarcha === 'parada' ? 'Detenida' : 'Sin dato'

function Panel({ titulo, detalle, accion, children, clase = '' }) {
  return <section className={`rp-panel ${clase}`}><div className="rp-panel-head"><div><h2>{titulo}</h2>{detalle && <p>{detalle}</p>}</div>{accion}</div>{children}</section>
}
function Banda({ items, nota }) {
  return <div className="rp-banda"><dl style={{ '--columnas': items.length }}>{items.map(([nombre, valor, icono]) => <div key={nombre}><Icono nombre={icono} tam={27} /><div><dt>{nombre}</dt><dd>{valor ?? 'Sin dato'}</dd></div></div>)}</dl>{nota && <p>{nota}</p>}</div>
}
function Aviso({ children }) { return <div className="rp-aviso"><Icono nombre="alerta" tam={20} /><div>{children}</div></div> }
function Distribucion({ items, total }) {
  return <div className="rp-distribucion"><div className="rp-stack" aria-hidden="true">{items.filter(i => i.valor > 0).map(i => <span key={i.etiqueta} className={i.tono} style={{ flex: i.valor }}>{i.valor}</span>)}</div><ul className="rp-leyenda">{items.map(i => <li key={i.etiqueta}><i className={i.tono} /><span>{i.etiqueta}</span><b>{i.valor}</b><small>{total ? Math.round(i.valor / total * 100) : 0}%</small></li>)}</ul><p className="rp-total">Total: {total} {total === 1 ? 'registro' : 'registros'}</p></div>
}
function Marcha({ unidades, c }) {
  return <Panel titulo="Operación de la flota" detalle="Estado actual de las unidades"><Distribucion total={unidades.length} items={[{ etiqueta: 'En marcha', valor: c.enMarcha, tono: 'azul' }, { etiqueta: 'Detenidas', valor: c.detenidas, tono: 'neutro' }, { etiqueta: 'Sin dato', valor: c.sinDato, tono: 'gris' }]} /></Panel>
}
function Asignacion({ c, total }) {
  return <Panel titulo="Identificación de conductores" detalle="Unidades con conductor asignado"><div className="rp-ident"><Anillo valor={c.identificacion / 100} texto={`${c.identificacion}%`} tono="azul" /><div><Tag color={rango(c.identificacion)}>{semaforo(c.identificacion)}</Tag><strong>{c.conConductor} de {total}</strong><p>unidades con conductor.</p></div></div></Panel>
}
function Disponibilidad({ d, recargar }) {
  return <Panel titulo="Disponibilidad de información" detalle="Fuentes incluidas en este reporte."><ul className="rp-fuentes">{FUENTES.map(nombre => {
    const falta = d.faltantes.find(x => x.nombre === nombre)
    return <li key={nombre}><Icono nombre={falta ? 'alerta' : 'check'} tam={18} /><span>{nombre}</span><Tag color={falta ? 'ambar' : 'verde'}>{falta ? 'No disponible' : 'Disponible'}</Tag></li>
  })}</ul>{d.faltantes.length > 0 && <><Aviso><b>Reporte parcial</b><p>Los datos disponibles se conservan.</p></Aviso><details className="rp-causas"><summary>Ver qué información falta</summary><ul>{d.faltantes.map(x => <li key={x.nombre}><b>{x.nombre}:</b> {x.motivo}</li>)}</ul><button className="pnl-btn" onClick={recargar}>Reintentar fuentes</button></details></>}</Panel>
}
function Resumen({ unidades, c, d, recargar, disponible }) {
  return <><Banda items={[
    ['Unidades', unidades.length, 'camion'], ['En marcha', c.enMarcha, 'velocidad'], ['ODT del período', disponible('Órdenes de trabajo') ? c.odts.length : 'No disponible', 'documento'], ['Unidades con conductor', `${c.conConductor} de ${unidades.length}`, 'gente'],
  ]} nota="Estado de flota actual · ODT creadas dentro del período seleccionado." /><div className="rp-grid rp-asimetrico rp-resumen"><Marcha unidades={unidades} c={c} /><Disponibilidad d={d} recargar={recargar} /><Panel titulo="Mantenimiento del período" detalle="Órdenes creadas en el período seleccionado." accion={<Link className="rp-link" to="?vista=mantenimiento">Ver detalle →</Link>}><div className="rp-mini-stats">{[['Abiertas', c.abiertas], ['En revisión', c.enRevision], ['Cerradas', c.cerradas]].map(([t, n]) => <div key={t}><span>{t}</span><strong>{disponible('Órdenes de trabajo') ? n : '—'}</strong></div>)}<div><span>Costo registrado en ODT cerradas</span><strong>{disponible('Órdenes de trabajo') ? f.moneda(c.costoOdts) : '—'}</strong></div></div><p className="rp-nota">{disponible('Órdenes de trabajo') ? `${c.conCosto} de ${c.cerradas} órdenes cerradas con costo registrado. Los demás estados se conservan en el total.` : 'Fuente de órdenes no disponible.'}</p></Panel><Asignacion c={c} total={unidades.length} /></div></>
}
function Operacion({ unidades, c }) {
  return <><Banda items={[
    ['Unidades', unidades.length, 'camion'], ['En marcha', c.enMarcha, 'velocidad'], ['Odómetros acumulados', c.kmTotal == null ? 'Sin dato completo' : f.km(c.kmTotal), 'mapa'], ['Índice promedio', c.indice == null ? 'Sin dato completo' : `${c.indice} / 100`, 'escudo'],
  ]} nota="Vista actual. Los odómetros acumulados no equivalen a kilómetros recorridos durante el período." /><Marcha unidades={unidades} c={c} /><Panel titulo="Estado de cada unidad" detalle="Consulta el expediente para revisar la información completa."><div className="rp-tabla-wrap"><table className="rp-tabla"><thead><tr><th>Unidad</th><th>Placa</th><th>Estado actual</th><th>Conductor asignado</th><th>Expediente</th></tr></thead><tbody>{unidades.map(v => <tr key={v.id}><td><b>{v.alias}</b></td><td>{v.placa || '—'}</td><td><MarchaTag v={v} /></td><td>{v.conductorNombre || 'Sin asignar'}</td><td><Link className="rp-link" to={`/panel/flota/${v.id}`}>Ver unidad</Link></td></tr>)}</tbody></table></div></Panel></>
}
function Mantenimiento({ c, d, disponible, recargar }) {
  if (!disponible('Órdenes de trabajo')) return <FuenteAusente nombre="Órdenes de trabajo" d={d} recargar={recargar} />
  return <><Banda items={[
    ['ODT del período', c.odts.length, 'documento'], ['Abiertas', c.abiertas, 'alerta'], ['En revisión', c.enRevision, 'reloj'], ['Cerradas', c.cerradas, 'check'], ['Costo registrado', f.moneda(c.costoOdts), 'reporte'], ['Tiempo promedio', d.resumen?.horasPromedioResolucion == null ? 'Sin dato' : f.duracion(d.resumen.horasPromedioResolucion * 60), 'reloj'],
  ]} nota="ODT creadas en el período y área seleccionados. El tiempo promedio, cuando disponible, corresponde al resumen general de la empresa." /><div className="rp-grid"><Panel titulo="Fallas más frecuentes" detalle="Tipos de falla en las ODT creadas en el período.">{c.fallas.length ? <BarrasH datos={c.fallas.map(x => ({ etiqueta: etiqueta('tipo_falla', x.clave), valor: x.valor }))} formato={f.numero} /> : <Vacio icono="llave" titulo="Sin órdenes en este período" texto="Prueba un período más amplio." />}</Panel><Panel titulo="Estado de las órdenes" detalle="Todos los estados registrados se incluyen en el total.">{c.odts.length ? <Distribucion total={c.odts.length} items={c.estados.map(x => ({ etiqueta: etiqueta('odt_estado', x.clave), valor: x.valor, tono: x.clave === 'cerrada' ? 'verde' : x.clave === 'abierta' ? 'ambar' : x.clave === 'en_revision' ? 'azul' : 'neutro' }))} /> : <p>No hay órdenes creadas en este período.</p>}</Panel></div><Panel titulo="Costo de ODT cerradas" detalle="Costo registrado al cerrar las órdenes del conjunto seleccionado." accion={<Link className="pnl-btn primario" to="/panel/mantenimiento">Ir a mantenimiento</Link>}><div className="rp-costo"><strong>{f.moneda(c.costoOdts)}</strong><span>{c.conCosto} de {c.cerradas} órdenes cerradas con costo registrado</span></div><p className="rp-nota">Este importe no representa el costo total de operación de la flota.</p></Panel></>
}
function Seguridad({ c, unidades, disponible }) {
  return <><div className="rp-grid"><Panel titulo="Índice de manejo seguro" detalle="Promedio de los índices actuales de las unidades.">{c.indice == null ? <Vacio icono="escudo" titulo="Sin dato completo" texto="Faltan índices válidos de algunas unidades. No se asigna una puntuación promedio." /> : <div className="rp-ident"><Anillo valor={c.indice / 100} texto={`${c.indice}`} sub="sobre 100" tono={rango(c.indice)} /><Tag color={rango(c.indice)}>{semaforo(c.indice)}</Tag></div>}</Panel><Asignacion c={c} total={unidades.length} /></div><div className="rp-grid"><Panel titulo="Eventos por 100 km" detalle="Solo se calcula con eventos y distancia del mismo período."><Vacio icono="mapa" titulo="Métrica no disponible" texto="El odómetro acumulado no permite conocer la distancia recorrida en el período. No se calcula una tasa con ese dato." /><p className="rp-nota">Eventos de alerta del período: {disponible('Eventos de alerta') ? c.eventos : 'No disponibles'}. Esta cantidad no es un índice de manejo.</p></Panel><Panel titulo="Cómo interpretar la información"><ul className="rp-umbrales"><li><Tag color="rojo">Atención</Tag><span>Menor a 70</span></li><li><Tag color="ambar">Alerta</Tag><span>De 70 a 84</span></li><li><Tag color="verde">Conforme</Tag><span>85 o más</span></li></ul><p className="rp-nota">La asignación refleja el conductor principal de cada unidad; no confirma quién condujo cada viaje.</p></Panel></div></>
}
function FuenteAusente({ nombre, d, recargar }) {
  return <Panel titulo={`${nombre}: no disponible`}><Vacio icono="reporte" titulo="No disponible" texto={d.faltantes.find(x => x.nombre === nombre)?.motivo || 'Esta fuente no devolvió información.'} accion={<button className="pnl-btn" onClick={recargar}>Reintentar</button>} /></Panel>
}
function Costos({ d, dias, recargar, c, disponible }) {
  if (d.costos == null) return <><FuenteAusente nombre="Costos" d={d} recargar={recargar} /><Panel titulo="El costo de mantenimiento sí tiene su propio registro" detalle="Se registra al cerrar cada orden de trabajo." accion={<Link className="pnl-btn primario" to="/panel/mantenimiento">Ver mantenimiento</Link>}><div className="rp-costo"><strong>{disponible('Órdenes de trabajo') ? f.moneda(c.costoOdts) : 'No disponible'}</strong><span>ODT cerradas del área y período seleccionados</span></div><p className="rp-nota">No se interpreta la ausencia de costos de operación como un gasto de $0.</p></Panel></>
  const costos = d.costos
  if (costos.porMoneda) return <CostosReales costos={costos} />
  return <><Banda items={[
    ['Costo del período', f.moneda(costos.total), 'reporte'], ['Costo por kilómetro', numeroValido(costos.costoPorKm) ? `$${Number(costos.costoPorKm).toLocaleString('es', { maximumFractionDigits: 3 })}` : 'Sin dato', 'mapa'], ['Movimientos', f.numero(costos.movimientos), 'documento'],
  ]} nota={`${periodo(dias)} · Toda la empresa. Esta fuente no se filtra por área.`} /><Panel titulo="Costos por categoría" detalle="Toda la empresa, durante el período seleccionado.">{costos.porCategoria?.length ? <BarrasH datos={costos.porCategoria.map(x => ({ etiqueta: CATEGORIAS[x.categoria] || x.categoria, valor: x.monto }))} formato={f.moneda} /> : <Vacio icono="reporte" titulo="Sin movimientos registrados" texto="La fuente respondió sin costos por categoría para este período." />}</Panel></>
}
function MarchaTag({ v }) { return <Tag color={v.estadoMarcha === 'en_marcha' ? 'azul' : 'gris'}>{estadoMarcha(v)}</Tag> }
function Indice({ valor }) { return numeroValido(valor) && valor >= 0 && valor <= 100 ? <Tag color={rango(valor)}>{valor} / 100</Tag> : <Tag color="gris">Sin dato</Tag> }
function Docs({ v }) {
  if (v.docsVencidos > 0) return <Tag color="rojo">{v.docsVencidos} vencidos</Tag>
  if (v.docsVencidos == null || v.docsPorVencer == null) return <Tag color="gris">Sin dato</Tag>
  if (v.docsPorVencer > 0) return <Tag color="ambar">{v.docsPorVencer} por vencer</Tag>
  return <Tag color="verde">Al día</Tag>
}
function TablaUnidades({ unidades, simple = false }) {
  return <div className="rp-tabla-wrap"><table className="rp-tabla"><thead><tr><th>Unidad</th><th>Placa</th><th>Área</th><th>Estado</th><th>Odómetro</th><th>Índice</th>{!simple && <th>Documentos</th>}<th>Conductor</th>{!simple && <th>Expediente</th>}</tr></thead><tbody>{unidades.map(v => <tr key={v.id}><td><div className="pnl-doble"><b>{v.alias}</b>{!simple && <span>{v.marca} {v.modelo}</span>}</div></td><td>{v.placa || '—'}</td><td>{v.areaNombre || 'Sin área'}</td><td><MarchaTag v={v} /></td><td>{numeroValido(v.km) ? f.km(v.km) : 'Sin dato'}</td><td><Indice valor={v.indiceSeguro} /></td>{!simple && <td><Docs v={v} /></td>}<td>{v.conductorNombre || 'Sin asignar'}</td>{!simple && <td><Link className="rp-link" to={`/panel/flota/${v.id}`}>Ver unidad</Link></td>}</tr>)}</tbody></table></div>
}
function Unidades({ unidades }) {
  const [buscar, setBuscar] = useState('')
  const [estado, setEstado] = useState('')
  const visibles = unidades.filter(v => `${v.alias} ${v.placa} ${v.marca} ${v.modelo}`.toLocaleLowerCase('es').includes(buscar.toLocaleLowerCase('es')) && (!estado || estadoMarcha(v) === estado))
  return <Panel titulo="Desglose por unidad" detalle="Información actual de las unidades cargadas en este alcance."><div className="rp-table-controls"><Buscador valor={buscar} alCambiar={setBuscar} placeholder="Buscar unidad o placa" /><label>Estado<select className="pnl-select" aria-label="Estado" value={estado} onChange={e => setEstado(e.target.value)}><option value="">Todos los estados</option>{['En marcha', 'Detenida', 'Sin dato'].map(t => <option key={t}>{t}</option>)}</select></label><span>{visibles.length} de {unidades.length} unidades cargadas</span></div>{visibles.length ? <TablaUnidades unidades={visibles} /> : <Vacio titulo="Sin coincidencias" texto="Prueba otra placa o cambia el filtro de estado." accion={<button className="pnl-btn" onClick={() => { setBuscar(''); setEstado('') }}>Limpiar filtros</button>} />}</Panel>
}
function Conductores({ c, unidades, d, disponible, recargar }) {
  const [buscar, setBuscar] = useState('')
  if (!disponible('Conductores')) return <FuenteAusente nombre="Conductores" d={d} recargar={recargar} />
  const visibles = c.conductores.filter(p => `${p.nombre} ${p.unidadNombre || ''}`.toLocaleLowerCase('es').includes(buscar.toLocaleLowerCase('es')))
  return <><Banda items={[
    ['Conductores cargados', c.conductores.length, 'gente'], ['Unidades con conductor', `${c.conConductor} de ${unidades.length}`, 'camion'], ['Asignación actual', `${c.identificacion}%`, 'check'],
  ]} /><div className="rp-grid rp-asimetrico"><Panel titulo="Desglose por conductor" detalle="Personas autorizadas dentro del alcance seleccionado."><div className="rp-table-controls"><Buscador valor={buscar} alCambiar={setBuscar} placeholder="Buscar conductor o unidad" /><span>{visibles.length} conductores</span></div>{visibles.length ? <div className="rp-tabla-wrap"><table className="rp-tabla"><thead><tr><th>Conductor</th><th>Unidad asignada</th><th>Eventos*</th><th>Índice actual</th><th>Perfil</th></tr></thead><tbody>{visibles.map(p => <tr key={p.id}><td><b>{p.nombre}</b></td><td>{p.unidadNombre || unidades.find(v => v.conductorPrincipalId === p.id)?.alias || 'Sin asignar'}</td><td>{f.numero(p.eventos)}</td><td><Indice valor={p.indiceSeguro} /></td><td><Link className="rp-link" to={`/panel/personal/${p.id}`}>Ver perfil</Link></td></tr>)}</tbody></table></div> : <Vacio icono="gente" titulo={buscar ? 'Sin coincidencias' : 'Sin conductores en este alcance'} texto={buscar ? 'Prueba otro nombre o unidad.' : 'Las personas asignadas a las unidades aparecerán aquí.'} /> }<p className="rp-nota">*Datos del perfil del conductor. No se asegura que correspondan al período elegido.</p></Panel><Panel titulo="Cómo leer este reporte"><p>El conductor asignado es el responsable principal registrado en la unidad.</p><hr /><p>Un índice ausente se muestra como «Sin dato». No significa que el conductor tenga una puntuación de cero.</p><hr /><p>Abre el perfil para consultar la información disponible de cada persona.</p></Panel></div></>
}
function Informe({ empresa, alcance, dias, fecha, unidades, c, d, disponible }) {
  return <article className="rp-papel">
    <header><b className="rp-paper-logo">FOM</b><div><h2>Reporte de gestión de flota</h2><p>{empresa}</p></div></header>
    <div className="rp-paper-meta"><span><b>Alcance</b>{alcance}</span><span><b>Período</b>{periodo(dias)}</span><span><b>Generado</b>{f.fecha(fecha)} · {f.hora(fecha)}</span></div>
    <Banda items={[
      ['Unidades', unidades.length, 'camion'], ['En marcha ahora', c.enMarcha, 'velocidad'], ['ODT del período', disponible('Órdenes de trabajo') ? c.odts.length : 'No disponible', 'documento'],
    ]} />
    {d.faltantes.length > 0 && <Aviso><b>Reporte parcial</b><ul>{d.faltantes.map(x => <li key={x.nombre}>{x.nombre}: {x.motivo}</li>)}</ul></Aviso>}
    <div className="rp-paper-columns">
      <section><h3>Operación actual</h3><p>{c.enMarcha} en marcha · {c.detenidas} detenidas · {c.sinDato} sin dato de marcha.</p><p>Odómetros acumulados: {c.kmTotal == null ? 'Sin dato completo' : f.km(c.kmTotal)}. No representan kilómetros del período.</p></section>
      <section><h3>Mantenimiento del período</h3>{disponible('Órdenes de trabajo') ? <><p>{c.abiertas} abiertas · {c.enRevision} en revisión · {c.cerradas} cerradas · {c.odts.length} órdenes totales.</p><p>Costo registrado en ODT cerradas: {f.moneda(c.costoOdts)} ({c.conCosto} de {c.cerradas} con costo). Otros estados incluidos en el total.</p></> : <p>Fuente no disponible.</p>}</section>
      <section><h3>Seguridad y asignación</h3><p>Índice promedio: {c.indice == null ? 'Sin dato completo' : c.indice}. {c.conConductor} de {unidades.length} unidades con conductor asignado ({c.identificacion}%).</p><p>Eventos por 100 km: no disponible; falta distancia validada del período.</p></section>
    </div>
    <section><h3>Unidades del alcance</h3><TablaUnidades unidades={unidades} simple /></section>
    <footer>Información consultada en FOM. Estado, odómetros y asignaciones corresponden a la vista actual; las ODT se filtran por fecha de creación.</footer>
  </article>
}

export default function Reportes() {
  const [parametros, setParametros] = useSearchParams()
  const vista = VISTAS.some(([id]) => id === parametros.get('vista')) ? parametros.get('vista') : 'resumen'
  const [dias, setDias] = useState(30)
  const [areaId, setAreaId] = useState('')
  const [exportacion, setExportacion] = useState(false)
  const [informe, setInforme] = useState(false)
  const [generado, setGenerado] = useState(new Date().toISOString())
  const [descarga, setDescarga] = useState('')
  const sesion = useSesion()
  const areas = useDatos(() => repo.areas(), [])
  const carga = useDatos(async () => {
    const faltantes = []
    const tolerar = async (nombre, consultar, vacio) => {
      try { return await consultar() } catch (error) { faltantes.push({ nombre, motivo: nombre === 'Costos' ? 'No se pudo completar la consulta de gastos. Reintenta; los costos de mantenimiento se conservan por separado.' : `No se pudo consultar ${nombre.toLocaleLowerCase('es')}. Reintenta para actualizar esta información.` }); return vacio }
    }
    const [resumen, vehiculos, conductores, odts, costos, eventos] = await Promise.all([
      tolerar('Resumen', () => repo.resumen(), null), tolerar('Vehículos', () => repo.vehiculos.listar({ areaId }), []),
      tolerar('Conductores', () => repo.personal.listar({ soloConductores: true }), []), tolerar('Órdenes de trabajo', () => repo.odts.listar({}), []),
      tolerar('Costos', () => repo.costos.resumen({ dias }), null), tolerar('Eventos de alerta', () => repo.alertas.eventos({ dias }), []),
    ])
    return { resumen, vehiculos, conductores, odts, costos, eventos, faltantes }
  }, [areaId, dias])
  const d = carga.datos
  const c = useMemo(() => d ? calcularReporte(d, dias, areaId) : null, [d, dias, areaId])
  const disponible = nombre => d && !d.faltantes.some(x => x.nombre === nombre)
  const unidades = d?.vehiculos || []
  const listo = carga.estado === 'ok' && disponible('Vehículos') && unidades.length > 0
  const alcance = (areas.datos || []).find(a => a.id === areaId)?.nombre || 'Toda la empresa'
  const abrirInforme = () => { setGenerado(new Date().toISOString()); setInforme(true); setExportacion(false) }
  const exportar = () => {
    const filas = [['Unidad', 'Placa', 'Área', 'Estado actual', 'Odómetro acumulado (km)', 'Índice actual', 'Docs vencidos', 'Docs por vencer', 'Conductor'], ...unidades.map(v => [v.alias, v.placa, v.areaNombre, estadoMarcha(v), numeroValido(v.km) ? Math.round(v.km) : '', v.indiceSeguro, v.docsVencidos, v.docsPorVencer, v.conductorNombre])]
    const url = URL.createObjectURL(new Blob([crearCsv(filas)], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a'); a.href = url; a.download = `reporte-flota-${dias}dias-${f.hoyISO()}.csv`; document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setDescarga('Descarga CSV iniciada. Incluye las unidades del alcance seleccionado.'); setExportacion(false)
  }
  const props = { unidades, c, d, disponible, recargar: carga.recargar, dias }
  return <div className={`rp-root${informe ? ' rp-preview' : ''}`}>
    <header className="rp-header"><div><h1>Reportes</h1><p>Entiende tu flota y comparte la información.</p></div><div className="rp-actions"><button className="pnl-btn" disabled={!listo} onClick={() => setExportacion(true)}><Icono nombre="descargar" tam={17} />Exportar y compartir</button><button className="pnl-btn primario" disabled={!listo} onClick={abrirInforme}><Icono nombre="reporte" tam={17} />Imprimir / PDF</button></div></header>
    <nav className="rp-nav" aria-label="Vistas de Reportes">{VISTAS.map(([id, texto]) => <button key={id} aria-current={vista === id ? 'page' : undefined} onClick={() => { const siguiente = new URLSearchParams(parametros); siguiente.set('vista', id); setParametros(siguiente); setInforme(false) }}>{texto}</button>)}</nav>
    <div className="rp-filtros"><div className="rp-periodos" role="group" aria-label="Período de reporte">{[30, 90, 365].map(n => <button key={n} aria-pressed={dias === n} onClick={() => { setDias(n); setInforme(false); setDescarga('') }}>{n === 30 ? periodo(n) : `${n} días`}</button>)}</div><label>Área<select className="pnl-select" aria-label="Área" value={areaId} disabled={areas.estado === 'cargando'} onChange={e => { setAreaId(e.target.value); setInforme(false); setDescarga('') }}><option value="">Toda la empresa</option>{(areas.datos || []).map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label><p>Período para ODT, costos y eventos.<br />Flota, odómetros y asignaciones: vista actual.</p></div>
    {areas.estado === 'error' && <Aviso>No se pudieron cargar las áreas. <button className="rp-link" onClick={areas.recargar}>Reintentar áreas</button></Aviso>}
    <div className="rp-contexto"><span>{sesion?.perfil?.empresa || 'Tu empresa'} · {alcance} · {periodo(dias)}</span>{listo && <span>Consulta de registros cargados</span>}</div>
    {descarga && <p role="status" className="rp-descarga">{descarga}</p>}
    {carga.estado === 'cargando' && <Cargando filas={6} />}
    {carga.estado === 'error' && <ErrorCarga error={carga.error} onReintentar={carga.recargar} />}
    {carga.estado === 'ok' && !disponible('Vehículos') && <FuenteAusente nombre="Vehículos" d={d} recargar={carga.recargar} />}
    {carga.estado === 'ok' && disponible('Vehículos') && !unidades.length && <Panel titulo="Sin unidades en este alcance"><Vacio icono="camion" titulo="No hay unidades para mostrar" texto="Selecciona otra área o consulta toda la empresa. Se conserva el período elegido." accion={areaId ? <button className="pnl-btn primario" onClick={() => setAreaId('')}>Ver toda la empresa</button> : <Link className="pnl-btn" to="/panel/flota">Ver vehículos</Link>} /></Panel>}
    {listo && <><div className="rp-pantalla">{informe ? <div className="rp-preview-head"><div><h2>Vista previa del informe</h2><p>El navegador permite imprimirlo o guardarlo como PDF.</p></div><div className="rp-actions"><button className="pnl-btn" onClick={() => setInforme(false)}>Volver al reporte</button><button className="pnl-btn primario" onClick={() => window.print()}>Imprimir / guardar PDF</button></div></div> : <>{vista !== 'resumen' && d.faltantes.length > 0 && <Aviso><b>Reporte parcial:</b> faltan {d.faltantes.map(x => x.nombre.toLocaleLowerCase('es')).join(', ')}. <button className="rp-link" onClick={carga.recargar}>Reintentar</button></Aviso>}{vista === 'resumen' && <Resumen {...props} />}{vista === 'operacion' && <Operacion {...props} />}{vista === 'mantenimiento' && <Mantenimiento {...props} />}{vista === 'seguridad' && <Seguridad {...props} />}{vista === 'costos' && <Costos {...props} />}{vista === 'unidades' && <Unidades {...props} />}{vista === 'conductores' && <Conductores {...props} />}</>}</div><div className={`rp-informe ${informe ? 'visible' : ''}`}><Informe empresa={sesion?.perfil?.empresa || 'Tu empresa'} alcance={alcance} dias={dias} fecha={generado} {...props} /></div></>}
    <Modal titulo="Exportar y compartir reporte" abierto={exportacion && listo} alCerrar={() => setExportacion(false)} ancho={620}><div className="rp-export"><p>Elige cómo llevarte la información del alcance seleccionado.</p><button className="rp-export-option" onClick={exportar}><Icono nombre="descargar" tam={28} /><span><b>Descargar unidades en CSV</b><small>Unidad, placa, área, estado, odómetro, índice, documentos y conductor. Se abre en Excel.</small></span></button><button className="rp-export-option" onClick={abrirInforme}><Icono nombre="reporte" tam={28} /><span><b>Imprimir o guardar como PDF</b><small>Informe con resumen, operación, mantenimiento, seguridad y unidades. Incluye avisos de información faltante.</small></span></button><div className="rp-export-scope"><b>{alcance}</b><span>{periodo(dias)} · {unidades.length} unidades</span></div><button className="pnl-btn" onClick={() => setExportacion(false)}>Cerrar</button></div></Modal>
  </div>
}

