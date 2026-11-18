import { useState } from 'react'
import { haceCuanto } from '../datos/gps'
import FuncionesDetectadas from './FuncionesDetectadas'
import DetalleDetectado from './DetalleDetectado'
import { paginaDescubrimiento, permiteRegistrarVisto } from '../datos/paginaDescubrimiento'

const fecha = v => v ? new Date(v).toLocaleString('es-VE') : 'Sin lectura'
const TAMANO = 4

export default function DescubrimientoGps({ listado, ahora, seleccionado, alSeleccionar, puedeElegir, puedeRegistrar, alRegistrar, guardando, error, registrado, soloPrueba, alVolver, propuestas = {}, alCambiarPropuesta }) {
  const [visto, setVisto] = useState(seleccionado || '')
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(0)
  const dispositivos = listado.datos ?? []
  const tabla = paginaDescubrimiento(dispositivos, busqueda, pagina)
  const d = dispositivos.find(x => x.imei === visto)
  return <section className="gp-discovery-workspace" aria-label="Detección de dispositivos">
    <div className="gp-discovery-toolbar"><div className="gp-discovery-head"><span className={`gp-radar ${dispositivos.length ? 'ok' : 'espera'}`} aria-hidden="true">⌁</span><div className="gp-titulo"><p className="gp-k">Paso 4 de 4 · Descubrimiento automático</p><h2 className="gp-st">Dispositivos detectados</h2><span className="gp-hint">{dispositivos.length} sin registrar · actualización cada 5 segundos</span></div></div><button type="button" className="gp-btn2 chico" disabled={guardando} onClick={alVolver}>Anterior: Configuración</button></div>
    {listado.estado === 'error' && <p className="gp-error" role="alert">No se pudo actualizar la detección. {listado.error?.message} La lectura anterior no confirma el estado actual.</p>}
    {registrado && <p className="gp-aviso" role="status">Dispositivo registrado. Su ficha ya está disponible en el inventario.</p>}
    <div className="gp-discovery-board">
      <aside className="gp-card gp-discovery-list" aria-label="Lista de GPS sin registrar">
        <label className="gp-f"><span>Buscar dispositivo</span><div className="gp-field"><input value={busqueda} placeholder="IMEI o transporte…" onChange={e => { setBusqueda(e.target.value); setPagina(0) }} /></div></label>
        <div className="gp-discovery-candidates">
          {listado.estado === 'cargando' && <p className="gp-hint" role="status">Consultando el receptor…</p>}
          {listado.estado === 'ok' && !tabla.total && <div className="gp-discovery-empty"><b>{busqueda ? 'Sin coincidencias' : 'Esperando dispositivos'}</b><p>{busqueda ? 'Prueba otro IMEI o borra la búsqueda.' : 'Cuando un GPS se comunique con el receptor aparecerá aquí automáticamente.'}</p></div>}
          {tabla.filas.map(g => <button type="button" className={`gp-discovery-candidate${visto === g.imei ? ' selected' : ''}`} key={g.imei} disabled={guardando} aria-pressed={visto === g.imei} onClick={() => { setVisto(g.imei); if (!registrado && listado.estado === 'ok' && puedeElegir(g)) alSeleccionar(g) }}><span className="gp-mono">{g.imei}</span><small>{g.mensajes} mensajes</small><span className="gp-discovery-candidate-status"><i className={g.reportando ? 'reporting' : ''} />{g.reportando ? 'Reportando' : 'Sin señal reciente'} · {String(g.transporte ?? '').toUpperCase()} · {haceCuanto(g.ultimaVez, ahora)}</span></button>)}
        </div>
        {tabla.totalPaginas > 1 && <div className="gp-discovery-pagination"><button type="button" className="gp-btn2 chico" disabled={!tabla.pagina} onClick={() => setPagina(tabla.pagina - 1)}>Anterior</button><span>{tabla.pagina + 1} / {tabla.totalPaginas}</span><button type="button" className="gp-btn2 chico" disabled={tabla.pagina + 1 >= tabla.totalPaginas} onClick={() => setPagina(tabla.pagina + 1)}>Siguiente</button></div>}
      </aside>
      <section className="gp-card gp-discovery-detail" aria-label="Detalle del dispositivo seleccionado">
        {d ? <Detalle key={d.imei} d={d} ahora={ahora} propuesta={propuestas[d.imei]} alCambiarPropuesta={value => alCambiarPropuesta?.(d.imei,value)} editar={!soloPrueba} /> : <div className="gp-discovery-empty"><h3>{visto ? 'El dispositivo ya no está en esta lectura' : 'Selecciona un dispositivo'}</h3><p>{visto ? 'Puede haberse registrado o quedar fuera de la muestra. Selecciona otro para consultar su comunicación.' : 'Elige un GPS de la lista para ver su identidad, fechas y mensajes aquí, sin salir de esta pantalla.'}</p></div>}
        <div className="gp-discovery-footer">
          {error && <p className="gp-error" role="alert">{error}</p>}
          {!soloPrueba && !registrado && <><span className="gp-hint">{d && !puedeElegir(d) ? 'Para registrar se necesita identidad verificada, señal reciente y el transporte configurado.' : 'Comprueba que el GPS seleccionado corresponde al equipo y a la SIM que estás preparando.'}</span><button type="button" className="gp-btn chico" disabled={!permiteRegistrarVisto({ guardando, estado: listado.estado, visto: d?.imei, seleccionado, puedeRegistrar })} onClick={alRegistrar}>{guardando ? 'Comprobando…' : 'Registrar'}</button></>}
        </div>
      </section>
    </div>
  </section>
}

function Detalle({ d, ahora, propuesta, alCambiarPropuesta, editar }) {
  const [tab, setTab] = useState('resumen')
  const [pagina, setPagina] = useState(0)
  const [avanzado, setAvanzado] = useState(false)
  const mensajes = d.comunicaciones ?? []
  const paginas = Math.max(1, Math.ceil(mensajes.length / TAMANO))
  const actual = Math.min(pagina, paginas - 1)
  return <>
    <div className="gp-discovery-device-heading"><div className="gp-titulo"><span className="gp-k">IMEI observado</span><h3 className="gp-mono">{d.imei}</h3></div><span className={`gp-lbl ${d.reportando ? 'gp-discovery-live' : ''}`}>{d.reportando ? 'Reportando ahora' : `Visto ${haceCuanto(d.ultimaVez, ahora)}`}</span></div>
    <div className="gp-discovery-tabs" role="tablist" aria-label="Información del dispositivo"><button type="button" role="tab" aria-selected={tab === 'resumen'} onClick={() => setTab('resumen')}>Resumen</button><button type="button" role="tab" aria-selected={tab === 'mensajes'} onClick={() => setTab('mensajes')}>Comunicaciones</button><button type="button" role="tab" aria-selected={tab === 'funciones'} onClick={() => setTab('funciones')}>Funciones</button></div>
    <div className="gp-discovery-data" role="tabpanel">
      {tab === 'funciones' ? <FuncionesDetectadas imei={d.imei} draft={propuesta} alCambiar={alCambiarPropuesta} editar={editar} /> : tab === 'resumen' ? <dl className="gp-discovery-facts">
        {[
          ['Primera recepción en la muestra', fecha(d.primeraVez)], ['Última recepción', fecha(d.ultimaVez)],
          ['Transporte', String(d.transporte ?? 'Desconocido').toUpperCase()], ['Mensajes en la muestra', d.mensajes],
          ['Último mensaje', d.bytesUltimo == null ? 'Sin tamaño disponible' : `${d.bytesUltimo} bytes`],
          ['Identidad', d.origenIdentidad === 'coban_imei_field' ? 'Campo IMEI Coban verificado' : 'Secuencia observada, sin verificar'],
          ['Protocolo', d.protocolo || 'Sin identificar'], ['Modelo, firmware y SIM', 'No se deducen de estos mensajes'],
        ].map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl> : <><table className="gp-discovery-messages"><thead><tr><th>Recepción</th><th>Transporte</th><th>Bytes</th></tr></thead><tbody>{mensajes.slice(actual * TAMANO, (actual + 1) * TAMANO).map((m,i) => <tr key={`${m.recibido}-${i}`}><td>{fecha(m.recibido)}</td><td>{m.transporte?.toUpperCase()}</td><td>{m.bytes}</td></tr>)}</tbody></table>{!mensajes.length && <p className="gp-hint">Sin detalle de mensajes disponible.</p>}{paginas > 1 && <div className="gp-discovery-pagination"><button className="gp-btn2 chico" type="button" disabled={!actual} onClick={() => setPagina(actual - 1)}>Mensajes anteriores</button><span>{actual + 1} / {paginas}</span><button className="gp-btn2 chico" type="button" disabled={actual + 1 >= paginas} onClick={() => setPagina(actual + 1)}>Más mensajes</button></div>}</>}
    </div>
    {tab !== 'funciones' && <div className="gp-discovery-note"><span className="gp-hint">Horas de recepción del servidor. Muestra de hasta {d.limiteMuestra ?? 5000} mensajes dentro de {d.diasMuestra ?? 30} días; no es el historial completo.</span><button type="button" className="gp-btn2 chico" onClick={() => setAvanzado(true)}>Prueba de identificación</button></div>}
    {avanzado && <DetalleDetectado inicial={d} alCerrar={() => setAvanzado(false)} />}
  </>
}
