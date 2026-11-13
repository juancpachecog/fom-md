import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import repo from '../datos/repo'
import { firmaFlota } from '../datos/firmaFlota.js'
import { useDatos } from '../useDatos'
import {
  Buscador, Cargando, Chips, ErrorCarga, Vacio,
} from '../comp/ui'
import Mapa from '../comp/Mapa'
import FichaUnidad, { estadoUnidad } from '../comp/FichaUnidad'
import PanelRecorrido from '../comp/PanelRecorrido'
import { analizar, COLA_MIN, colaReciente } from '../datos/recorrido'
import { ordenarSinSenal, textoSinSenal, useMinuto, useUnidadesAlDia } from '../datos/sinSenal'
import { leerEnlaceEvento } from '../datos/eventosManejo'
import { BloqueManejoBrusco, useManejoBrusco } from '../comp/ManejoBrusco'
import * as f from '../datos/formato'
import { Icono } from '../Iconos'
import '../../styles/control-map.css'

const ESTADOS = [
  { v: '', t: 'Todas' },
  { v: 'en_marcha', t: 'En marcha' },
  { v: 'parada', t: 'Detenidas' },
]

/**
 * Conserva el MISMO objeto mientras su contenido no cambie. Cada refresco trae objetos nuevos aunque
 * los datos sean iguales; sin esto el mapa borra y vuelve a dibujar la ruta, cierra los globos que el
 * usuario abrió y parpadea cada 15 s. Con esto, lo que no cambió no se toca.
 */
function useEstable(valor, firma) {
  const guardado = useRef({ f: undefined, v: valor })
  const f = valor == null ? null : firma(valor)
  if (f !== guardado.current.f) guardado.current = { f, v: valor }
  return guardado.current.v
}
/** ¿La unidad coincide con lo escrito en el buscador? Placa, alias, número, marca, modelo o conductor. */
function coincide(v, texto) {
  if (!texto) return true
  return [v.placa, v.alias, v.numero, v.marca, v.modelo, v.conductorNombre].join(' ').toLowerCase().includes(texto)
}

// El conductor entra en la firma: el buscador también filtra por su nombre.
const firmaPuntos = (p) => `${p.length}|${p[0]?.hora}|${p.at(-1)?.hora}|${p.at(-1)?.lat}|${p.at(-1)?.lng}`
const firmaAnalisis = (a) => `${firmaPuntos(a.puntos)}|${a.viajes.length}|${a.paradas.length}`

export default function CentroControl() {
  const [q, setQ] = useState('')
  const [estadoMarcha, setEstadoMarcha] = useState('')
  const [areaId, setAreaId] = useState('')
  const [seleccionado, setSeleccionado] = useState(null)
  const [listaAbierta, setListaAbierta] = useState(false)
  const [viendoRecorrido, setViendoRecorrido] = useState(false)
  const [horas, setHoras] = useState(24)
  const [foco, setFoco] = useState(null)
  const [viajeActivo, setViajeActivo] = useState(null)
  useEffect(() => { setViendoRecorrido(false); setFoco(null); setViajeActivo(null) }, [seleccionado])
  // Modo «manejo brusco»: se guarda la unidad para la que se abrió, así al cambiar de unidad se
  // apaga solo y un enlace puede abrirlo junto con la unidad que elige (sin que el reinicio de
  // arriba, que corre después, lo vuelva a cerrar).
  const [manejoDe, setManejoDe] = useState(null)
  const viendoManejo = Boolean(seleccionado) && manejoDe === seleccionado

  const areas = useDatos(() => repo.areas(), [])
  // Seguimiento en vivo: se vuelve a preguntar por la flota cada 15 segundos.
  // Los equipos reportan cada 1–5 minutos, así que consultar más seguido no
  // adelanta nada; con este ritmo una posición nueva aparece sola en menos de
  // 15 s desde que llega a la base, sin que nadie recargue.
  // Se pide la flota entera y el buscador, el área y el estado filtran aquí lo
  // ya cargado: antes cada letra escrita era un pedido al servidor.
  const flota = useDatos(() => repo.vehiculos.listar({}), [], 15000)
  // La ficha solo necesita de más el IMEI del equipo, que la flota no trae: se saca del inventario
  // de equipos GPS (un solo pedido) al elegir la unidad. Antes se pedía el expediente entero (~8
  // pedidos, todas las páginas de ODT). Lo vivo (posición, velocidad, señal) ya llega con la
  // flota, y el trazo reciente con `cola`.
  const detalle = useDatos(
    () => (seleccionado
      ? repo.admin.gps.listar().then(async (equipos) => {
          const candidatos = equipos.filter((g) => g.vehiculoId === seleccionado)
          const e = candidatos.length === 1 ? candidatos[0] : null
          const ubicacionGps = e?.protocolo === 'meitrack-t399'
            ? await repo.admin.gps.telemetria(e.id, { limite: 1 }).then(r => r.ubicacion).catch(() => ({ state: 'unavailable' })) : null
          return { id: seleccionado, ubicacionGps, gps: e ? { modelo: e.modelo ?? 'Equipo GPS', imei: e.imei, linea: e.linea, verificado: e.verificado, conectado: e.conectado } : null }
        })
      : Promise.resolve(null)),
    [seleccionado], 30000
  )

  // Sin pedir el recorrido: los últimos minutos de camino de la unidad elegida, para saber de
  // dónde viene. Se renueva con el mismo ritmo que la flota.
  const cola = useDatos(
    async () => ({ vehiculoId: seleccionado, puntos: seleccionado ? await repo.colaReciente(seleccionado) : [] }),
    [seleccionado],
    15000
  )
  const colaActual = cola.datos?.vehiculoId === seleccionado
  const colaInfo = useEstable(useMemo(() => colaReciente(colaActual ? cola.datos.puntos : []), [colaActual, cola.datos]), (c) => `${firmaPuntos(c.puntos)}|${c.ampliada}`)
  const colaPuntos = colaInfo?.puntos ?? []
  // Al pedir el recorrido: el rango completo, con viajes, paradas y la hora de cada punto.
  const dia = useDatos(
    () => (seleccionado && viendoRecorrido ? repo.recorridoDetallado(seleccionado, { horas }) : Promise.resolve(null)),
    [seleccionado, viendoRecorrido, horas],
    60000
  )
  const analisis = useEstable(useMemo(() => (viendoRecorrido && dia.datos ? analizar(dia.datos.puntos) : null), [viendoRecorrido, dia.datos]), firmaAnalisis)

  const datosFlota = useEstable(flota.datos, firmaFlota)
  // Diferido: el campo responde al instante y el mapa se filtra cuando React tiene un respiro.
  const texto = useDeferredValue(q.trim().toLowerCase())
  // Cada minuto se recalcula la señal (5 min sin reportar = «Sin señal»), sin pedir nada más;
  // la pantalla solo se vuelve a pintar si alguna unidad cambió de estado (los «hace …» se
  // renuevan solos en la lista y en la ficha, que llevan su propio reloj).
  const alDia = useUnidadesAlDia(datosFlota)
  const lista = useMemo(
    // Primero la señal y la marcha al día (por posición), y con eso el filtro.
    () => alDia.filter((v) =>
      (!areaId || v.areaId === areaId) && (!estadoMarcha || (v.estadoMarcha === estadoMarcha && v.conectado !== false)) && coincide(v, texto)),
    [alDia, areaId, estadoMarcha, texto]
  )
  const enMarcha = lista.filter((v) => v.estadoMarcha === 'en_marcha').length

  // Enlace de un evento de manejo (perfil, Alertas, Eventos y SOS, expediente):
  // `?unidad=…&evento=…` elige la unidad en cuanto llega la flota y se limpia de la dirección.
  const [parametros, setParametros] = useSearchParams()
  const [pedidoEvento, setPedidoEvento] = useState(null)
  useEffect(() => {
    const enlace = leerEnlaceEvento(parametros)
    if (!enlace || flota.estado !== 'ok') return
    if ((datosFlota ?? []).some((v) => v.id === enlace.unidad)) {
      setListaAbierta(false)
      setSeleccionado(enlace.unidad)
      setManejoDe(enlace.unidad)
      setPedidoEvento({ ...enlace, clave: Date.now() })
    }
    setParametros({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parametros, flota.estado])

  // Manejo brusco de la unidad elegida. El servidor no los da por unidad, solo por conductor: se
  // piden los de TODOS sus conductores asignados (principal y secundarios; o el que dice el
  // enlace) y se dejan los de esta unidad. Los de un conductor que ya no la tiene asignada no
  // llegan (falta una lectura por unidad en el servidor). Solo se piden con el modo abierto.
  const conductorEnlace = pedidoEvento?.unidad === seleccionado ? pedidoEvento.conductor : null
  const conductorId = conductorEnlace ?? lista.find((v) => v.id === seleccionado)?.conductorPrincipalId ?? null
  const asignados = useDatos(
    async () => (viendoManejo ? { id: seleccionado, lista: await repo.vehiculos.usuariosAsignados(seleccionado).catch(() => []) } : null),
    [viendoManejo, seleccionado]
  )
  const asignadosAlDia = asignados.datos?.id === seleccionado ? asignados.datos.lista : []
  const manejo = useManejoBrusco({
    vehiculoId: seleccionado,
    userId: viendoManejo ? conductorId : null,
    userIds: viendoManejo ? asignadosAlDia.map((u) => u.id) : null,
    pedido: pedidoEvento,
    // Se vuela al evento del enlace después de que el mapa encuadre la cola de la unidad.
    listoParaVolar: colaActual || cola.estado === 'error',
  })

  // El manejo brusco se mira unidad por unidad, desde su ficha («Ver manejo brusco»).
  const elegirUnidad = (id) => setSeleccionado(id)

  // Si un filtro deja fuera la unidad abierta, se cierra el detalle.
  useEffect(() => {
    if (seleccionado && !lista.some((v) => v.id === seleccionado)) setSeleccionado(null)
  }, [lista, seleccionado])

  const opcionesArea = useMemo(
    () => [{ v: '', t: 'Todas las áreas' }].concat((areas.datos ?? []).map((a) => ({ v: a.id, t: a.nombre }))),
    [areas.datos]
  )

  const limpiar = () => {
    setQ('')
    setEstadoMarcha('')
    setAreaId('')
  }

  // Sin velocidad en la base no se puede contar cuántas van en marcha; lo que
  // sí consta es cuántos equipos están reportando.
  const sabeMarcha = lista.some((v) => v.estadoMarcha != null)
  const reportando = lista.filter((v) => v.conectado).length
  const bajada =
    flota.estado === 'ok'
      ? `${f.numero(lista.length)} ${lista.length === 1 ? 'unidad' : 'unidades'} · ` +
        (sabeMarcha ? `${enMarcha} en marcha · ${reportando} reportando` : `${reportando} reportando`)
      : 'Dónde está cada unidad, en tiempo real.'
  // La flota pasó del tope de lectura: se dice, para que nadie cuente de menos sin saberlo.
  const incompleta = flota.estado === 'ok' && Boolean(datosFlota?.incompleta)

  const unidadLista = lista.find(v => v.id === seleccionado)
  const unidadDetalle = detalle.datos?.id === seleccionado ? detalle.datos : null
  // La lista va encima: sus datos son de hace menos de 15 s; los del expediente, de cuando se eligió.
  const unidad = unidadLista ? { ...unidadDetalle, ...unidadLista, ubicacionGps: unidadDetalle?.ubicacionGps ?? unidadLista.ubicacionGps } : null
  const sinPunto = lista.filter(v => !Number.isFinite(v.lat) || !Number.isFinite(v.lng)).length
  const estadosVisibles = [...new Map(lista.map(v => { const e = estadoUnidad(v); return [e.clave, e] })).values()]

  // En el teléfono la ficha y la lista son hojas a lo ancho que tapan el pie del mapa. Se mide
  // cuánto tapan (`--hoja-alto`) para subir encima el logo de Mapbox, que su licencia exige ver.
  const raiz = useRef(null)
  const hayLista = lista.length > 0
  useEffect(() => {
    const seccion = raiz.current
    if (!seccion || typeof ResizeObserver === 'undefined') return undefined
    const hojas = () => seccion.querySelectorAll(':scope > .control-panel')
    const medir = () => {
      const caja = seccion.getBoundingClientRect()
      let alto = 0
      let izquierda = 0
      hojas().forEach((el) => {
        const r = el.getBoundingClientRect()
        // Las de abajo a lo ancho (teléfono) empujan el logo hacia arriba.
        if (r.width >= caja.width * 0.6 && caja.bottom - r.bottom < 120) alto = Math.max(alto, caja.bottom - r.top)
        // La ficha lateral de escritorio que llega al pie empuja el logo a su derecha.
        else if (r.left - caja.left < 80 && caja.bottom - r.bottom < 120) izquierda = Math.max(izquierda, r.right - caja.left)
      })
      seccion.style.setProperty('--hoja-alto', `${Math.round(alto)}px`)
      seccion.style.setProperty('--hoja-izq', `${Math.round(izquierda)}px`)
    }
    const observador = new ResizeObserver(medir)
    observador.observe(seccion)
    hojas().forEach((el) => observador.observe(el))
    medir()
    return () => observador.disconnect()
  }, [seleccionado, listaAbierta, viendoRecorrido, viendoManejo, flota.estado, hayLista])

  // Recorrido y manejo brusco no se mezclan: abrir uno cierra el otro. Las dos capas juntas
  // (viajes, paradas y eventos) se tapan entre sí y la hoja tendría dos listas largas.
  const alternarRecorrido = () => { setManejoDe(null); setViendoRecorrido((v) => !v) }
  const alternarManejo = () => { setViendoRecorrido(false); setManejoDe((u) => (u === seleccionado ? null : seleccionado)) }
  // Con cualquiera de los dos modos la hoja se compacta (sin foto ni datos extra) y crece.
  const enModo = viendoRecorrido || viendoManejo

  return (
    <section className="control-map" aria-label="Centro de control" ref={raiz}>
      <div className="control-map-canvas">
        <Mapa vehiculos={lista} seleccionado={seleccionado} alSeleccionar={elegirUnidad}
          cola={seleccionado && !viendoRecorrido ? colaPuntos : null} viajes={analisis?.viajes} paradas={analisis?.paradas} foco={foco} viajeActivo={viajeActivo} alElegirViaje={(n) => setViajeActivo((a) => (a === n ? null : n))}
          eventosManejo={viendoManejo ? manejo.visibles : null}
          eventoActivo={manejo.elegido} alElegirEvento={manejo.elegir} encuadrarEventos={false}
          alto="100%" ficha={false} leyenda={false} espacioFicha herramientas />
      </div>
      <div className="control-search">
        <div className="control-search-heading"><div><h1>Centro de control</h1><p>{bajada}{sinPunto > 0 && <> · <button type="button" className="control-sin-posicion" onClick={() => { setListaAbierta(true); setSeleccionado(null) }}>{sinPunto} sin posición · Ver unidades</button></>}</p>{incompleta && <p role="status">Lista incompleta: la flota es más grande de lo que se pudo leer.</p>}</div>
          <div className="control-acciones">
            <button className="pnl-btn" type="button" aria-label="Unidades" aria-expanded={listaAbierta} aria-controls="control-unidades" onClick={() => { setListaAbierta(v => !v); setSeleccionado(null) }}><Icono nombre="camion" tam={18} />Unidades</button>
          </div>
        </div>
        <Buscador valor={q} alCambiar={setQ} placeholder="Placa, alias o conductor…" />
      </div>
      <div className="control-filters">
        <Chips opciones={ESTADOS} valor={estadoMarcha} alCambiar={setEstadoMarcha} />
        {opcionesArea.length > 1 && <select className="pnl-input" aria-label="Área de la flota" value={areaId} onChange={e => setAreaId(e.target.value)}>{opcionesArea.map(a => <option key={a.v} value={a.v}>{a.t}</option>)}</select>}
      </div>
      {(flota.estado !== 'ok' || lista.length === 0) && <div className="control-panel control-feedback" role="status">
        {flota.estado === 'cargando' && <Cargando filas={3} />}
        {flota.estado === 'error' && <ErrorCarga error={flota.error} onReintentar={flota.recargar} />}
        {flota.estado === 'ok' && lista.length === 0 && (
            <Vacio
              icono="buscar"
              titulo="Ninguna unidad coincide"
              texto="Prueba con otra placa o quita los filtros para ver toda la flota."
              accion={
                <button type="button" className="pnl-btn" onClick={limpiar}>
                  Limpiar filtros
                </button>
              }
            />
        )}
      </div>}
      {listaAbierta && flota.estado === 'ok' && lista.length > 0 && !seleccionado && <aside className="control-panel" id="control-unidades" aria-label="Unidades de la flota">
        <div className="control-panel-heading"><h2>Unidades <span>{lista.length}</span></h2><button type="button" aria-label="Cerrar lista de unidades" onClick={() => setListaAbierta(false)}><Icono nombre="cerrar" /></button></div>
        <ListaUnidades vehiculos={lista} seleccionado={seleccionado} alSeleccionar={elegirUnidad} />
      </aside>}
      {seleccionado && <aside className={`control-panel control-unit${enModo ? ' con-ruta' : ''}`} aria-label="Detalle de la unidad">
        <FichaUnidad unidad={unidad} alCerrar={() => setSeleccionado(null)} alVerRecorrido={alternarRecorrido} viendoRecorrido={viendoRecorrido}
          alVerManejo={alternarManejo} viendoManejo={viendoManejo} />
        {viendoManejo && <BloqueManejoBrusco m={manejo} />}
        {!enModo && colaPuntos.length > 1 && <p className="control-detail-note ruta-cola-nota" role="status">{colaInfo?.ampliada ? 'Línea punteada: su último trayecto (ahora está detenida).' : `Línea punteada: los últimos ${COLA_MIN} min de camino.`} Pulsa «Ver recorrido» para el día completo.</p>}
        {!enModo && cola.estado === 'error' && <p className="control-detail-note" role="status">No se pudieron cargar los últimos 5 minutos. <button type="button" onClick={cola.recargar}>Reintentar</button></p>}
        {!enModo && cola.estado !== 'error' && (!colaActual || cola.estado === 'cargando') && <p className="control-detail-note" role="status">Cargando los últimos 5 minutos…</p>}
        {!enModo && colaActual && cola.estado === 'ok' && colaPuntos.length < 2 && <p className="control-detail-note" role="status">{cola.datos.puntos.length > 1 ? 'Sin movimiento registrado en el tramo reciente.' : 'No hay suficientes posiciones para dibujar el recorrido reciente.'} Puedes consultar el día completo en «Ver recorrido».</p>}
        {viendoRecorrido && <PanelRecorrido analisis={analisis} horas={horas} alCambiarHoras={setHoras} cargando={dia.estado === 'cargando'} truncado={dia.datos?.truncado} alEnfocar={(p) => setFoco({ ...p, clave: Date.now() })} viajeActivo={viajeActivo} alElegirViaje={setViajeActivo} />}
        {viendoRecorrido && dia.estado === 'error' && <p className="control-detail-note">No se pudo cargar el recorrido. <button onClick={dia.recargar}>Reintentar</button></p>}
        {detalle.estado === 'error' && <p className="control-detail-note">No se pudo cargar la ficha de la unidad. <button onClick={detalle.recargar}>Reintentar</button></p>}
      </aside>}
      {estadosVisibles.length > 0 && <div className="fleet-map-legend" aria-label="Estados de los vehículos">{estadosVisibles.map(e => <span className={e.color} key={e.clave}><i />{e.texto}</span>)}</div>}
      <div className="control-live"><i />Actualización cada 15 s<span>Selecciona una unidad en el mapa o en Unidades</span></div>
    </section>
  )
}

const esSinSenal = (v) => estadoUnidad(v).clave === 'sin_senal'

function ListaUnidades({ vehiculos, seleccionado, alSeleccionar }) {
  // Cada minuto se rehace el «hace …» y el orden de las calladas, sin pedir nada al servidor.
  const ahora = useMinuto()
  const filas = useMemo(() => ordenarSinSenal(vehiculos, esSinSenal, ahora), [vehiculos, ahora])
  return (
    <div className="pnl-filas">
      {filas.map((v) => {
        const estado = estadoUnidad(v)
        const viva = estado.color === 'verde'
        const abierta = seleccionado === v.id
        const alternar = () => alSeleccionar(abierta ? null : v.id)
        return (
          <div
            key={v.id}
            className={`pnl-fila${abierta ? ' aviso' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={abierta}
            onClick={alternar}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                alternar()
              }
            }}
          >
            <i className={`pnl-punto ${viva ? 'on' : 'off'}`} />
            <div className="pnl-fila-txt">
              <b>{v.alias}</b>
              <span>
                {v.placa} ·{' '}
                {v.conductorNombre === 'Sin asignar' ? 'Sin conductor' : v.conductorNombre}
              </span>
              {(!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) && <span>Sin posición publicada · selecciona para ver el diagnóstico</span>}
            </div>
            {/* Sin señal, cuánto lleva callada. Con velocidad en la base se muestra; sin ella, lo
                único que consta es cuándo reportó el equipo por última vez. */}
            <em>
              {estado.clave === 'sin_senal'
                ? textoSinSenal(v.ultimoReporte, ahora)
                : v.soloRecepcion ? 'Reportando'
                : v.velocidadKmh != null
                ? f.velocidad(v.velocidadKmh)
                : v.estadoMarcha === 'parada'
                  ? 'Detenida'
                  : f.desde(v.ultimoReporte)}
            </em>
          </div>
        )
      })}
    </div>
  )
}
