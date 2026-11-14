import { useConfirmar } from '../comp/Confirmar'
import MiniFoto from '../comp/MiniFoto'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import repo from '../datos/repo'
import { cuerpoNuevaUnidad } from '../datos/altaUnidad'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { esAdminFom } from '../auth'
import { esGestor } from '../roles'
import VehicleVisual from '../../components/VehicleVisual'
import {
  Cabecera, Campo, Cargando, Vacio, ErrorCarga, Tag, Tarjeta, Kpi, Buscador, Chips, Modal,
} from '../comp/ui'
import { Icono } from '../Iconos'
import * as f from '../datos/formato'
import { color, etiqueta } from '../datos/catalogos'
import { conSenalAlDia, ordenarSinSenal, textoSinSenal, useMinuto } from '../datos/sinSenal'
import '../../styles/movil-modulos.css'
import { useVistaTelefono } from '../comp/movil-navegacion'
import { BuscadorFiltrosMovil, FilaUnidadMovil, ListaVirtualMovil, MapaFlotaMovil, PastillasRapidasMovil } from './FlotaMovil'

// ============================================================
// FLOTA — listado maestro de unidades
// ------------------------------------------------------------
// La app móvil muestra una lista simple; aquí el supervisor necesita comparar
// unidades entre sí, así que la vista es una tabla ordenable por cualquier
// columna, con filtros combinables y salida a CSV para el reporte semanal.
// ============================================================

/** Una unidad requiere atención si tiene papeles en riesgo o nadie a cargo. */
function requiereAtencion(v) {
  // Si la fuente no lleva documentos —hoy, la base real— no hay nada que
  // afirmar. Marcar «requiere atención» a toda la flota por lo que no sabemos
  // vuelve inútil el indicador justo cuando más debería significar algo.
  if (v.docsVencidos == null) return false
  return v.docsVencidos > 0 || v.docsPorVencer > 0 || !v.conductorPrincipalId
}

function nombreConductor(v) {
  return v.conductorPrincipalId ? v.conductorNombre : 'Sin conductor'
}

/** Columnas de la tabla. `num` alinea a la derecha como el resto del panel. */
const COLUMNAS = [
  { k: 'unidad', t: 'Unidad' },
  { k: 'placa', t: 'Placa' },
  { k: 'area', t: 'Área' },
  { k: 'conductor', t: 'Conductor' },
  { k: 'estado', t: 'Estado' },
  { k: 'documentos', t: 'Documentos' },
  { k: 'indice', t: 'Índice', num: true },
  { k: 'km', t: 'Km', num: true },
]

/** Valor comparable de cada columna. Los documentos ordenan por gravedad. */
function valorOrden(v, k) {
  switch (k) {
    case 'placa': return v.placa
    case 'area': return v.areaNombre
    case 'conductor': return nombreConductor(v)
    case 'estado': return v.estadoMarcha === 'en_marcha' ? 1 : 0
    case 'documentos': return v.docsVencidos * 100 + v.docsPorVencer
    case 'indice': return v.indiceSeguro
    case 'km': return v.km
    default: return v.alias
  }
}

function coincide(v, q) {
  const t = q.trim().toLowerCase()
  if (!t) return true
  return [v.alias, v.placa, v.numero, v.marca, v.modelo, nombreConductor(v), v.areaNombre]
    .join(' ')
    .toLowerCase()
    .includes(t)
}

/** Celda de documentos: al día, por vencer o vencidos. */
function TagDocumentos({ v }) {
  // Con la base real todavía no hay documentos. Se dice que no se sabe, en
  // vez de pintar un «Al día» que nadie ha comprobado.
  if (v.docsVencidos == null) return <span className="pnl-sin-dato">—</span>
  if (v.docsVencidos > 0) {
    return (
      <Tag color="rojo">
        {v.docsVencidos} {v.docsVencidos === 1 ? 'vencido' : 'vencidos'}
      </Tag>
    )
  }
  if (v.docsPorVencer > 0) return <Tag color="ambar">{v.docsPorVencer} por vencer</Tag>
  return <Tag color="verde">Al día</Tag>
}

/**
 * La PEOR novedad de una unidad, como la escala de Flota en la app: decide en
 * qué tramo va en el teléfono («No pueden salir», «Atención», «Sin novedad»)
 * y la única etiqueta que lleva su fila. Solo con lo que la lista ya trae: la
 * web no tiene aquí ni el SOS ni la inspección del día.
 */
function novedadDe(v) {
  if (v.docsVencidos > 0) {
    return { peso: 3, grupo: 'no-salen', color: 'rojo', t: v.docsVencidos === 1 ? 'Documento vencido' : `${v.docsVencidos} vencidos` }
  }
  if (v.docsPorVencer > 0) return { peso: 5, grupo: 'atencion', color: 'ambar', t: `${v.docsPorVencer} por vencer` }
  if (!v.conductorPrincipalId) return { peso: 7, grupo: 'atencion', color: 'ambar', t: 'Sin conductor' }
  return null
}

const TRAMOS = [
  { clave: 'no-salen', t: 'No pueden salir', color: 'rojo' },
  { clave: 'atencion', t: 'Atención', color: 'ambar' },
  { clave: 'sin-novedad', t: 'Sin novedad', color: '' },
]

/**
 * Cómo está la unidad AHORA en el teléfono (la misma escala que la app):
 * sin señal si calla, en marcha, detenida, o «reportando» si la fuente no sabe
 * de marcha pero el equipo transmite. `null`: nunca reportó.
 */
function estadoMovil(v) {
  if (v.conectado === false) return 'sin-senal'
  if (v.estadoMarcha === 'en_marcha') return 'marcha'
  if (v.estadoMarcha === 'parada') return 'detenido'
  if (v.conectado) return 'reportando'
  return v.ultimoReporte ? 'sin-senal' : null
}

/** El número de la unidad («U-003»), como `etiquetaCortaDeUnidad` de la app; sin él, su alias. */
const numeroDe = (v) => (v.numero && String(v.numero).trim() !== '—' ? String(v.numero).toUpperCase() : v.alias || v.placa || 'Unidad')

/**
 * La lista del teléfono, como flota.tsx (T-190): tres tramos por gravedad y
 * dentro de cada uno lo peor primero; cada unidad en su tarjeta con su foto. La
 * lista es virtual: con 340 unidades solo se montan (y piden foto) las que se ven.
 */
function ListaMovil({ unidades, alAbrir, ahora }) {
  const tramos = useMemo(() => {
    const conNovedad = unidades.map((v, i) => ({ v, i, n: novedadDe(v) }))
    const orden = (a, b) => (a.n?.peso ?? 99) - (b.n?.peso ?? 99) || a.i - b.i
    return TRAMOS
      .map((t) => ({ ...t, items: conNovedad.filter((u) => (u.n?.grupo ?? 'sin-novedad') === t.clave).sort(orden) }))
      .filter((t) => t.items.length > 0)
  }, [unidades])
  const pintar = useCallback(({ v, n }) => (
    <FilaUnidadMovil unidad={v} numero={numeroDe(v)} estado={estadoMovil(v)} aviso={n}
      conductor={nombreConductor(v)} ahora={ahora} alAbrir={alAbrir} />
  ), [ahora, alAbrir])
  return (
    <div className="vm-tramos">
      <ListaVirtualMovil tramos={tramos} renderUnidad={pintar} />
    </div>
  )
}

/**
 * El pulso de la flota en el teléfono (TiraEstado de la app): cuatro casillas
 * sobre lo que se ve con el filtro puesto. Si la fuente no sabe de marcha, se
 * cuenta lo que sí consta: quién reporta y quién no.
 */
function TiraMovil({ unidades, sabeMarcha }) {
  const total = unidades.length
  const sinSenal = unidades.filter((v) => v.conectado === false).length
  const enMarcha = unidades.filter((v) => v.estadoMarcha === 'en_marcha' && v.conectado !== false).length
  const cifras = sabeMarcha
    ? [
        { t: total === 1 ? 'unidad' : 'unidades', n: total },
        { t: 'en marcha', n: enMarcha, c: 'verde' },
        { t: 'detenidas', n: unidades.filter(v => v.estadoMarcha === 'parada' && v.conectado !== false).length, c: 'ambar' },
        { t: 'sin señal', n: sinSenal, c: 'gris' },
      ]
    : [
        { t: total === 1 ? 'unidad' : 'unidades', n: total },
        { t: 'reportando', n: total - sinSenal, c: 'verde' },
        { t: 'sin señal', n: sinSenal, c: 'gris' },
        { t: 'sin conductor', n: unidades.filter((v) => !v.conductorPrincipalId).length, c: 'ambar' },
      ]
  return (
    <div className="mv-solo-movil mv-tira" aria-label="Estado de la flota">
      {cifras.map((x) => {
        // Un cero no es un estado: va en gris, como en la app.
        const tono = x.c && x.n > 0 ? x.c : ''
        return (
          <div key={x.t}>
            <span className="mv-tira-num">{x.c && <i className={tono} />}<b>{x.n}</b></span>
            <span>{x.t}</span>
            {x.c && total > 0
              ? <span className="mv-tira-pista"><i className={tono} style={{ width: `${Math.min(100, (x.n / total) * 100)}%` }} /></span>
              : <span className="mv-tira-pista vacia" />}
          </div>
        )
      })}
    </div>
  )
}

/** Descarga la tabla tal como se ve, sin librerías: Blob + enlace temporal. */
function exportarCSV(filas) {
  const cabeceras = [
    'Unidad', 'Número', 'Placa', 'Marca', 'Modelo', 'Año', 'Tipo', 'Área', 'Conductor',
    'Estado', 'Velocidad (km/h)', 'Kilometraje', 'Índice seguro', 'Documentos vencidos',
    'Documentos por vencer', 'Ubicación', 'Último reporte',
  ]
  const celda = (valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`
  const lineas = [
    cabeceras.map(celda).join(';'),
    ...filas.map((v) =>
      [
        v.alias, v.numero, v.placa, v.marca, v.modelo, v.anio,
        etiqueta('vehiculo_tipo', v.tipo), v.areaNombre, nombreConductor(v),
        etiqueta('marcha_estado', v.estadoMarcha), v.estadoMarcha === 'en_marcha' ? v.velocidadKmh : 0,
        Math.round(v.km), v.indiceSeguro, v.docsVencidos, v.docsPorVencer,
        v.ubicacionTexto, f.fechaHora(v.ultimoReporte),
      ]
        .map(celda)
        .join(';')
    ),
  ]
  // El BOM hace que Excel en español abra las tildes correctamente.
  const blob = new Blob([`\ufeff${lineas.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = `flota-fom-${f.hoyISO()}.csv`
  document.body.appendChild(enlace)
  enlace.click()
  enlace.remove()
  URL.revokeObjectURL(url)
}

export default function Flota() {
  const navegar = useNavigate()
  const sesion = useSesion()
  const esAdmin = esAdminFom(sesion?.perfil)
  const esGestorDeFlota = esGestor(sesion?.perfil)
  const [creandoArea, setCreandoArea] = useState(false)
  const [asignando, setAsignando] = useState(null) // { area } cuando se abre «Agregar vehículos a un área»
  const [moviendo, setMoviendo] = useState(null) // la unidad cuya área se cambia desde su fila
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState('todas')
  // En el teléfono: la pastilla rápida (Todas, En marcha, Detenidas, Sin señal, Con avisos).
  const [rapido, setRapido] = useState('todas')
  // En la vista de teléfono, la pestaña de la app: mapa en su tarjeta, pastillas y los filtros finos en una hoja.
  const esMovil = useVistaTelefono()
  const [areaId, setAreaId] = useState('')
  const [orden, setOrden] = useState({ k: 'unidad', dir: 'asc' })
  const [creando, setCreando] = useState(false)
  // Desde «Vehículos generales» el administrador llega ya dentro de la empresa para dar de alta una unidad.
  const ubicacion = useLocation()
  useEffect(() => { if (esAdmin && ubicacion.state?.nuevaUnidad) setCreando(true) }, [esAdmin, ubicacion.state])

  const vehiculos = useDatos(() => repo.vehiculos.listar(), [], 30000)
  const areas = useDatos(() => repo.areas(), [])
  // «Sin señal · hace …» corre solo cada minuto, sin volver a pedir la flota, y con el mismo
  // reloj se recalcula la señal: a los 5 min sin reportar la unidad pasa sola a «Sin señal».
  const ahora = useMinuto()

  const lista = useMemo(() => (vehiculos.datos ?? []).map((v) => conSenalAlDia(v, ahora)), [vehiculos.datos, ahora])
  const estado = vehiculos.estado === 'error' || areas.estado === 'error'
    ? 'error'
    : vehiculos.estado === 'ok' && areas.estado === 'ok'
      ? 'ok'
      : 'cargando'

  // Base: búsqueda de texto (los chips cuentan sobre esta base)
  const buscadas = useMemo(() => lista.filter((v) => coincide(v, q)), [lista, q])
  const porArea = useMemo(
    () => (areaId ? buscadas.filter((v) => v.areaId === areaId) : buscadas),
    [buscadas, areaId]
  )

  const filtradas = useMemo(() => {
    if (esMovil) {
      if (rapido === 'todas') return porArea
      if (rapido === 'avisos') return porArea.filter((v) => novedadDe(v))
      return porArea.filter((v) => estadoMovil(v) === rapido)
    }
    if (filtro === 'sin_senal') return porArea.filter((v) => v.conectado === false)
    if (filtro === 'en_marcha') return porArea.filter((v) => v.estadoMarcha === 'en_marcha')
    if (filtro === 'parada') return porArea.filter((v) => v.estadoMarcha === 'parada')
    if (filtro === 'atencion') return porArea.filter(requiereAtencion)
    return porArea
  }, [porArea, filtro, esMovil, rapido])

  const ordenadas = useMemo(() => {
    const dir = orden.dir === 'asc' ? 1 : -1
    const lista = [...filtradas].sort((a, b) => {
      const va = valorOrden(a, orden.k)
      const vb = valorOrden(b, orden.k)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'es', { numeric: true }) * dir
    })
    // Al ordenar por estado, dentro de su grupo las sin señal van de más tiempo callada a menos.
    return orden.k === 'estado' ? ordenarSinSenal(lista, (v) => v.conexion === 'sin_senal', ahora) : lista
  }, [filtradas, orden, ahora])

  const chipsEstado = [
    { v: 'todas', t: 'Todas', n: porArea.length },
    { v: 'en_marcha', t: 'En marcha', n: porArea.filter((v) => v.estadoMarcha === 'en_marcha').length },
    { v: 'parada', t: 'Detenidas', n: porArea.filter((v) => v.estadoMarcha === 'parada').length },
    { v: 'sin_senal', t: 'Sin señal', n: porArea.filter((v) => v.conectado === false).length },
    { v: 'atencion', t: 'Requieren atención', n: porArea.filter(requiereAtencion).length },
  ]

  const chipsArea = [
    { v: '', t: 'Todas las áreas', n: buscadas.length },
    ...(areas.datos ?? []).map((a) => ({
      v: a.id,
      t: a.nombre,
      n: buscadas.filter((v) => v.areaId === a.id).length,
    })),
  ]

  const enMarcha = lista.filter((v) => v.estadoMarcha === 'en_marcha').length
  // ¿La fuente sabe distinguir marcha de parada? Con la base real todavía no:
  // no se persiste la velocidad, solo la última vez que el equipo reportó.
  const sabeMarcha = lista.some((v) => v.estadoMarcha != null)
  const reportando = lista.filter((v) => v.conectado).length
  const atencion = lista.filter(requiereAtencion).length
  const sinConductor = lista.filter((v) => !v.conductorPrincipalId).length

  // Las pastillas del teléfono, con lo que dejan la búsqueda y el área.
  const pastillas = useMemo(() => {
    const cuenta = (e) => porArea.filter((v) => estadoMovil(v) === e).length
    const base = [{ v: 'todas', t: 'Todas', n: porArea.length }]
    const estados = sabeMarcha
      ? [{ v: 'marcha', t: 'En marcha', n: cuenta('marcha'), tono: 'exito' }, { v: 'detenido', t: 'Detenidas', n: cuenta('detenido'), tono: 'aviso' }]
      : [{ v: 'reportando', t: 'Reportando', n: cuenta('reportando'), tono: 'exito' }]
    return [...base, ...estados,
      { v: 'sin-senal', t: 'Sin señal', n: cuenta('sin-senal'), tono: 'apagado' },
      { v: 'avisos', t: 'Con avisos', n: porArea.filter((v) => novedadDe(v)).length, tono: 'peligro' }]
  }, [porArea, sabeMarcha])

  function ordenarPor(k) {
    setOrden((o) => (o.k === k ? { k, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { k, dir: 'asc' }))
  }

  const abrir = useCallback((id) => navegar(`/panel/flota/${id}`), [navegar])

  return (
    <>
      <Cabecera titulo="Vehículos" bajada={esMovil ? 'Dónde está y cómo está cada unidad.' : 'Toda la flota en una sola tabla: estado, documentos y responsable de cada unidad.'}>
        {!esMovil && <>
        <Buscador valor={q} alCambiar={setQ} placeholder="Buscar unidad, placa, conductor o área…" />
        <button
          type="button"
          className="pnl-btn"
          onClick={() => exportarCSV(ordenadas)}
          disabled={!ordenadas.length}
        >
          <Icono nombre="descargar" tam={16} />
          Exportar CSV
        </button>
        {esGestorDeFlota && (
          <button type="button" className="pnl-btn sutil" onClick={() => setCreandoArea(true)}>
            <Icono nombre="pin" tam={16} />
            Nueva área
          </button>
        )}
        {esGestorDeFlota && (
          <button type="button" className="pnl-btn" onClick={() => setAsignando({ area: areaId })}>
            <Icono nombre="camion" tam={16} />
            Agregar vehículos a un área
          </button>
        )}
        </>}
        {/* «Nueva unidad» no va aquí: crear unidades es del Administrador FOM y se hace en
            Administración › Vehículos generales, que entra a la empresa y abre este mismo alta. */}
      </Cabecera>

      {esGestorDeFlota && (
        <ModalAsignarArea
          abierto={Boolean(asignando)}
          areas={areas.datos ?? []}
          vehiculos={lista}
          areaInicial={asignando?.area ?? ''}
          alCerrar={() => setAsignando(null)}
          alGuardar={vehiculos.recargar}
        />
      )}
      {esGestorDeFlota && (
        <ModalMoverUnidad
          unidad={moviendo}
          areas={areas.datos ?? []}
          alCerrar={() => setMoviendo(null)}
          alGuardar={vehiculos.recargar}
        />
      )}
      {esAdmin && (
        <ModalNuevaUnidad
          abierto={creando}
          areas={areas.datos ?? []}
          alCerrar={() => setCreando(false)}
          alGuardar={() => vehiculos.recargar()}
          actor={sesion?.perfil}
        />
      )}

      <div className="pnl-cuerpo">
        {estado === 'cargando' && <Cargando filas={8} />}
        {estado === 'error' && (
          <ErrorCarga
            onReintentar={() => { vehiculos.recargar(); areas.recargar() }}
            error={vehiculos.error ?? areas.error}
          />
        )}

        {estado === 'ok' && (
          <>
            <TiraMovil unidades={esMovil ? porArea : filtradas} sabeMarcha={sabeMarcha} />
            <div className="pnl-grid k4 mv-solo-escritorio">
              <Kpi titulo="Total de unidades" valor={lista.length} icono="camion" />
              {sabeMarcha ? (
                <Kpi
                  titulo="En marcha"
                  valor={enMarcha}
                  icono="velocidad"
                  tono="ok"
                  nota={`${f.cantidad(lista.filter(v => v.estadoMarcha === 'parada' && v.conectado !== false).length, 'detenida', 'detenidas')} · ${reportando} reportando`}
                />
              ) : (
                /* La base no guarda la velocidad: se informa cuántos equipos
                   están reportando, que es lo que sí consta. */
                <Kpi
                  titulo="Reportando"
                  valor={reportando}
                  icono="velocidad"
                  tono={reportando ? 'ok' : 'aviso'}
                  nota={`${lista.length - reportando} sin señal`}
                />
              )}
              <Kpi
                titulo="Requieren atención"
                valor={atencion}
                icono="alerta"
                tono={atencion ? 'aviso' : 'ok'}
                nota="Documentos en riesgo o sin responsable"
              />
              <Kpi
                titulo="Sin conductor"
                valor={sinConductor}
                icono="gente"
                tono={sinConductor ? 'malo' : 'ok'}
                nota="Unidades sin conductor principal"
              />
            </div>

            {esMovil ? <>
              <MapaFlotaMovil unidades={filtradas} cargando={vehiculos.estado === 'cargando'} novedadDe={novedadDe}
                nombreConductor={nombreConductor} alAbrir={abrir} ahora={ahora} />
              <BuscadorFiltrosMovil q={q} alBuscar={setQ} placeholder="Unidad, placa, conductor o área" titulo="Filtrar unidades"
                grupos={[
                  // El estado va en las pastillas de abajo; en la hoja, el área.
                  { titulo: 'Área', opciones: chipsArea, valor: areaId, alCambiar: setAreaId, base: '' },
                ]}
                acciones={<>
                  {esGestorDeFlota && <button type="button" className="pnl-btn sutil" onClick={() => setCreandoArea(true)}><Icono nombre="pin" tam={16} />Nueva área</button>}
                  {esGestorDeFlota && <button type="button" className="pnl-btn" onClick={() => setAsignando({ area: areaId })}><Icono nombre="camion" tam={16} />Agregar vehículos a un área</button>}
                  <button type="button" className="pnl-btn" onClick={() => exportarCSV(ordenadas)} disabled={!ordenadas.length}><Icono nombre="descargar" tam={16} />Exportar CSV</button>
                </>} />
              <PastillasRapidasMovil opciones={pastillas} valor={rapido} alCambiar={setRapido} />
            </> : <>
              <Chips opciones={chipsEstado} valor={filtro} alCambiar={setFiltro} />
              <Chips opciones={chipsArea} valor={areaId} alCambiar={setAreaId} />
            </>}

            <div className="mv-flota-lista">
            <Tarjeta
              // En el teléfono no va la cuenta: la tira de arriba ya la dice, como en la app.
              titulo={esMovil ? null : `${ordenadas.length} ${ordenadas.length === 1 ? 'unidad' : 'unidades'}`}
              accion={(!esMovil || (esGestorDeFlota && areaId)) &&
                <span className="pnl-chips" style={{ alignItems: 'center' }}>
                  {esGestorDeFlota && areaId && (
                    <button type="button" className="pnl-btn primario" onClick={() => setAsignando({ area: areaId })}>
                      <Icono nombre="mas" tam={16} />
                      Agregar vehículos a «{(areas.datos ?? []).find((a) => a.id === areaId)?.nombre ?? 'esta área'}»
                    </button>
                  )}
                  <span className="pnl-link mv-solo-escritorio">Toca una fila para ver el expediente</span>
                </span>
              }
              sinCuerpo
            >
              {!lista.length && (
                <Vacio
                  icono="camion"
                  titulo="Todavía no hay unidades"
                  texto="Cuando registres vehículos en FOM, aparecerán aquí con su estado en vivo."
                />
              )}

              {lista.length > 0 && !ordenadas.length && (
                <Vacio
                  icono="buscar"
                  titulo="Sin resultados"
                  texto={
                    q.trim()
                      ? `Ninguna unidad coincide con «${q.trim()}».`
                      : 'Ninguna unidad cumple con los filtros seleccionados.'
                  }
                  accion={
                    <button
                      type="button"
                      className="pnl-btn"
                      onClick={() => { setQ(''); setFiltro('todas'); setRapido('todas'); setAreaId('') }}
                    >
                      Limpiar filtros
                    </button>
                  }
                />
              )}

              {esMovil && ordenadas.length > 0 && <ListaMovil unidades={ordenadas} alAbrir={abrir} ahora={ahora} />}
              {!esMovil && ordenadas.length > 0 && (
                <div className="pnl-tabla-wrap mv-solo-escritorio">
                  <table className="pnl-tabla">
                    <thead>
                      <tr>
                        {COLUMNAS.map((c) => {
                          const activa = orden.k === c.k
                          return (
                            <th
                              key={c.k}
                              className={`pnl-tabla-fila-link${c.num ? ' num' : ''}`}
                              aria-sort={activa ? (orden.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                              tabIndex={0}
                              title={`Ordenar por ${c.t}`}
                              onClick={() => ordenarPor(c.k)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  ordenarPor(c.k)
                                }
                              }}
                            >
                              {c.t}
                              {activa ? (orden.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {ordenadas.map((v) => (
                        <tr
                          key={v.id}
                          className="pnl-tabla-fila-link"
                          tabIndex={0}
                          role="link"
                          aria-label={`Abrir el expediente de ${v.alias}, placa ${v.placa}`}
                          onClick={() => abrir(v.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              abrir(v.id)
                            }
                          }}
                        >
                          <td>
                            <div className="pnl-vehicle-cell"><MiniFoto vehiculoId={v.id}><VehicleVisual modelo={v.modelo ?? ''} compacta /></MiniFoto><div className="pnl-doble">
                              <b>{v.alias}</b>
                              <span>{v.numero} · {v.marca} {v.modelo}</span>
                            </div></div>
                          </td>
                          <td className="placa">{v.placa}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span>{v.areaNombre}</span>
                              {esGestorDeFlota && (
                                <button
                                  type="button"
                                  className="pnl-btn sutil"
                                  style={{ minHeight: 30, padding: '2px 10px', fontSize: 12 }}
                                  aria-label={`Cambiar el área de ${v.alias}`}
                                  onClick={(e) => { e.stopPropagation(); setMoviendo(v) }}
                                  onKeyDown={(e) => e.stopPropagation()}
                                >
                                  Cambiar
                                </button>
                              )}
                            </div>
                          </td>
                          <td>{nombreConductor(v)}</td>
                          <td>
                            <div className="pnl-doble">
                              {v.estadoMarcha ? (
                                <>
                                  <Tag color={color('marcha_estado', v.estadoMarcha)}>
                                    {etiqueta('marcha_estado', v.estadoMarcha)}
                                  </Tag>
                                  {v.estadoMarcha === 'en_marcha' && (
                                    <span>{f.velocidad(v.velocidadKmh)}</span>
                                  )}
                                </>
                              ) : (
                                /* Sin velocidad en la base no se puede afirmar
                                   marcha ni parada; se informa la conexión. */
                                v.conexion === 'sin_senal' ? (
                                  <Tag color={color('conexion', v.conexion)}>
                                    {textoSinSenal(v.ultimoReporte, ahora)}
                                  </Tag>
                                ) : (
                                  <>
                                    <Tag color={color('conexion', v.conexion)}>
                                      {etiqueta('conexion', v.conexion)}
                                    </Tag>
                                    <span>{f.desde(v.ultimoReporte)}</span>
                                  </>
                                )
                              )}
                            </div>
                          </td>
                          <td><TagDocumentos v={v} /></td>
                          <td className="num">
                            <Tag color={f.CLASE_SEMAFORO[f.rangoIndice(v.indiceSeguro)]}>
                              {v.indiceSeguro}
                            </Tag>
                          </td>
                          <td className="num">{f.km(v.km)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Tarjeta>
            </div>
          </>
        )}
      </div>
      <ModalArea abierto={creandoArea} tenantId={sesion?.perfil?.empresaId ?? null} alCerrar={() => setCreandoArea(false)} alGuardar={() => { vehiculos.recargar(); areas.recargar() }} />
    </>
  )
}

/**
 * Alta del activo, con instalación GPS opcional e independiente (#767).
 */
export function ModalNuevaUnidad({ abierto, areas, alCerrar, alGuardar, actor }) {
  const { confirmar: pedirConfirmacion, dialogo } = useConfirmar()
  const [alias, setAlias] = useState('')
  const [numero, setNumero] = useState('')
  const [placa, setPlaca] = useState('')
  const [marca, setMarca] = useState('')
  const [modelo, setModelo] = useState('')
  const [anio, setAnio] = useState('')
  const [tipo, setTipo] = useState('camioneta')
  const [gpsId, setGpsId] = useState('')
  const [areaSel, setAreaSel] = useState('')
  const [gpsLibres, setGpsLibres] = useState(null)
  const [errorGps, setErrorGps] = useState('')
  const [resultado, setResultado] = useState(null)
  const enviado = useRef(false)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!abierto) return
    let vigente = true
    setGpsLibres(null); setErrorGps('')
    repo.admin.gps.disponibles().then((equipos) => {
      if (vigente) setGpsLibres(equipos)
    }).catch(() => {
      if (vigente) {
        setGpsLibres([])
        setErrorGps('No se pudo consultar el inventario. Puedes crear la unidad sin GPS y asignarlo después.')
      }
    })
    return () => { vigente = false }
  }, [abierto])

  const cerrar = () => {
    if (guardando) return
    setAlias(''); setPlaca(''); setMarca(''); setModelo(''); setAnio('')
    setNumero('')
    setTipo('camioneta'); setGpsId(''); setAreaSel(''); setError('')
    setResultado(null); enviado.current = false
    alCerrar()
  }

  const confirmar = async () => {
    if (enviado.current) return
    const datos = { alias, placa, marca, modelo, anio, tipo, gpsId, areaId: areaSel || null, numero }
    try { cuerpoNuevaUnidad(datos) } catch (e) { setError(e.message); return }
    enviado.current = true
    setGuardando(true)
    setError('')
    try {
      if (!await pedirConfirmacion({ titulo: 'Crear vehículo', texto: `¿Crear ${placa || alias || numero} en la empresa actual${gpsId ? ' e instalar el GPS seleccionado' : ''}?`, accion: 'Crear vehículo' })) { enviado.current = false; return }
      const r = await repo.vehiculos.crear(datos, actor)
      setResultado(r)
      try { await alGuardar() } catch { /* Recargar no repite un alta confirmada. */ }
    } catch (e) {
      setError(`${e.message} Revisa la flota antes de volver a crear esta unidad.`)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <><Modal titulo="Nueva unidad" abierto={abierto} alCerrar={cerrar} ancho={560}>
      {resultado ? (
        <div role="status">
          <p>Unidad creada.</p>
          {(resultado.pendientes ?? []).map((aviso) => <p key={aviso}>{aviso}</p>)}
          <p className="pnl-campo-ayuda">Puedes continuar con su expediente, mantenimiento y órdenes de trabajo. La instalación GPS se gestiona por separado.</p>
          <button type="button" className="pnl-btn primario" onClick={cerrar} disabled={guardando}>Cerrar</button>
        </div>
      ) : (
        <>
          <Campo etiqueta="Placa (opcional)" ayuda="Si no tiene placa, usa un alias o número interno." error={error}>
            <input type="text" className="pnl-input" value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="A12BC3D" />
          </Campo>
          <Campo etiqueta="Alias (opcional)" ayuda="Por ejemplo: Manlift 01 o Camión con brazo.">
            <input type="text" className="pnl-input" value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Unidad 27" />
          </Campo>
          <Campo etiqueta="Número interno de flota (opcional)"><input className="pnl-input" value={numero} maxLength={30} onChange={e => setNumero(e.target.value)} /></Campo>
          <Campo etiqueta="Marca">
            <input type="text" className="pnl-input" value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Toyota" />
          </Campo>
          <Campo etiqueta="Modelo">
            <input type="text" className="pnl-input" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Hilux" />
          </Campo>
          <Campo etiqueta="Año">
            <input type="number" className="pnl-input" value={anio} onChange={(e) => setAnio(e.target.value)} placeholder="2026" />
          </Campo>
          <Campo etiqueta="Tipo">
            <select className="pnl-input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="camioneta">Camioneta</option>
              <option value="camion">Camión</option>
              <option value="auto">Automóvil</option>
              <option value="otro">Maquinaria / otro equipo</option>
            </select>
          </Campo>
          <Campo etiqueta="GPS (opcional)" ayuda="Puedes asignarlo después. Instalar el equipo no certifica sus señales ni funciones.">
            {gpsLibres === null && <p role="status">Consultando inventario…</p>}
            {errorGps && <p role="alert">{errorGps}</p>}
            {!errorGps && gpsLibres?.length === 0 && <p>No hay GPS disponibles. Puedes asignar uno después.</p>}
            <select className="pnl-input" value={gpsId} onChange={(e) => setGpsId(e.target.value)}>
              <option value="">Sin GPS · asignar después</option>
              {(gpsLibres ?? []).map((g) => (
                <option key={g.id} value={g.id}>{g.modelo} · {g.imei}</option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Área (opcional)">
            <select className="pnl-input" value={areaSel} onChange={(e) => setAreaSel(e.target.value)}>
              <option value="">Sin asignar</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>
          </Campo>

          <div className="pnl-chips">
            <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={guardando || enviado.current}>
              <Icono nombre="check" tam={16} />
              {guardando ? 'Creando…' : 'Crear unidad'}
            </button>
            <button type="button" className="pnl-btn sutil" onClick={cerrar} disabled={guardando}>
              Cancelar
            </button>
          </div>
        </>
      )}
    </Modal>{dialogo}</>
  )
}

// ---------------- Nueva área ----------------
// Igual que en la app: nombre y tipo (ubicación, sector o contrato). El empresa
// es el de la sesión; el servidor la crea bajo `tenants/:id/areas`.
const TIPOS_DE_AREA = [['ubicacion', 'Ubicación'], ['sector', 'Sector'], ['contrato', 'Contrato']]
function ModalArea({ abierto, tenantId, alCerrar, alGuardar }) {
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('ubicacion')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  async function confirmar() {
    if (nombre.trim().length < 2) return setError('Ponle nombre al área.')
    if (!tenantId) return setError('No se sabe el empresa de la sesión: vuelve a entrar.')
    setGuardando(true)
    setError('')
    try {
      await repo.areas.crear(tenantId, { nombre: nombre.trim(), tipo })
      await alGuardar()
      setNombre('')
      alCerrar()
    } catch (e) {
      setError(e?.message || 'No se pudo crear el área.')
    } finally {
      setGuardando(false)
    }
  }
  return (
    <Modal titulo="Nueva área" abierto={abierto} alCerrar={alCerrar} ancho={440}>
      <Campo etiqueta="Nombre" error={error}>
        <input className="pnl-input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Costa oriental" />
      </Campo>
      <Campo etiqueta="Tipo">
        <select className="pnl-input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS_DE_AREA.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </Campo>
      <div className="pnl-chips">
        <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={guardando}>{guardando ? 'Guardando…' : 'Crear área'}</button>
        <button type="button" className="pnl-btn sutil" onClick={alCerrar} disabled={guardando}>Cancelar</button>
      </div>
    </Modal>
  )
}


// ---------------- Agregar vehículos a un área ----------------
// Elige el área, marca las unidades y listo. Cada cambio es el mismo que se hace desde el expediente
// de la unidad (`asignarArea`); aquí se hacen varios de una vez y se avisa de los que no se pudieron.
function ModalAsignarArea({ abierto, areas, vehiculos, areaInicial, alCerrar, alGuardar }) {
  const [destino, setDestino] = useState('')
  const [q, setQ] = useState('')
  const [marcados, setMarcados] = useState(() => new Set())
  const [progreso, setProgreso] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!abierto) return
    setDestino(areaInicial || areas[0]?.id || '')
    setQ('')
    setMarcados(new Set())
    setProgreso(null)
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, areaInicial])

  const candidatos = useMemo(() => {
    const t = q.trim().toLowerCase()
    return vehiculos
      .filter((v) => (v.areaId ?? '') !== destino)
      .filter((v) => !t || [v.alias, v.placa, v.numero, v.areaNombre, v.marca, v.modelo].join(' ').toLowerCase().includes(t))
  }, [vehiculos, destino, q])
  const nombreDestino = destino ? (areas.find((a) => a.id === destino)?.nombre ?? 'el área') : 'Sin área'
  const todosMarcados = candidatos.length > 0 && candidatos.every((v) => marcados.has(v.id))
  const trabajando = progreso !== null

  function alternar(id) {
    setMarcados((m) => {
      const n = new Set(m)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function alternarTodos() {
    setMarcados((m) => {
      const n = new Set(m)
      if (todosMarcados) candidatos.forEach((v) => n.delete(v.id))
      else candidatos.forEach((v) => n.add(v.id))
      return n
    })
  }

  async function confirmar() {
    const ids = [...marcados]
    if (ids.length === 0) return setError('Marca al menos una unidad.')
    setError('')
    const fallidos = []
    for (let i = 0; i < ids.length; i++) {
      setProgreso({ hechos: i, total: ids.length })
      try {
        await repo.vehiculos.asignarArea(ids[i], destino || null)
      } catch (e) {
        fallidos.push({ id: ids[i], motivo: e?.message || 'no se pudo' })
      }
    }
    await alGuardar()
    setProgreso(null)
    if (fallidos.length) {
      setMarcados(new Set(fallidos.map((x) => x.id)))
      const nombre = (id) => vehiculos.find((x) => x.id === id)?.alias ?? 'Unidad'
      setError(`${ids.length - fallidos.length} de ${ids.length} se pasaron. No se pudo con: ${fallidos.map((x) => `${nombre(x.id)} (${x.motivo})`).join(' · ')}`)
      return
    }
    alCerrar()
  }

  return (
    <Modal titulo="Agregar vehículos a un área" abierto={abierto} alCerrar={trabajando ? () => {} : alCerrar} ancho={620}>
      <Campo etiqueta="¿A qué área?">
        <select className="pnl-input" value={destino} disabled={trabajando} onChange={(e) => { setDestino(e.target.value); setMarcados(new Set()) }}>
          <option value="">Sin área</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Unidades que todavía no están ahí" ayuda="Marca las que quieres pasar. Su área actual aparece a la derecha.">
        <input className="pnl-input" value={q} disabled={trabajando} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por alias, placa o área…" />
      </Campo>
      {candidatos.length === 0 ? (
        <Vacio icono="camion" titulo="No hay unidades para agregar" texto={`Todas las unidades ya están en «${nombreDestino}»${q.trim() ? ' o no coinciden con la búsqueda' : ''}.`} />
      ) : (
        <>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 4px', fontSize: 14 }}>
            <input type="checkbox" checked={todosMarcados} disabled={trabajando} onChange={alternarTodos} />
            Marcar todas las que se ven ({candidatos.length})
          </label>
          <div className="pnl-filas" style={{ maxHeight: 320, overflow: 'auto' }}>
            {candidatos.map((v) => (
              <label key={v.id} className="pnl-fila" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={marcados.has(v.id)} disabled={trabajando} onChange={() => alternar(v.id)} />
                <div className="pnl-fila-txt">
                  <b>{v.alias}</b>
                  <span>{v.placa} · {v.marca} {v.modelo}</span>
                </div>
                <em>{v.areaNombre}</em>
              </label>
            ))}
          </div>
        </>
      )}
      {error && <p role="alert" style={{ color: '#f87171', fontSize: 14, margin: '12px 0 0' }}>{error}</p>}
      {trabajando && <p role="status" style={{ fontSize: 14, margin: '12px 0 0' }}>Pasando {progreso.hechos + 1} de {progreso.total}…</p>}
      <div className="pnl-chips" style={{ marginTop: 16 }}>
        <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={trabajando || marcados.size === 0}>
          {marcados.size === 0 ? 'Agregar' : `Agregar ${marcados.size} ${marcados.size === 1 ? 'unidad' : 'unidades'} a «${nombreDestino}»`}
        </button>
        <button type="button" className="pnl-btn sutil" onClick={alCerrar} disabled={trabajando}>Cancelar</button>
      </div>
    </Modal>
  )
}

// ---------------- Cambiar el área de una unidad (desde su fila) ----------------
function ModalMoverUnidad({ unidad, areas, alCerrar, alGuardar }) {
  const [destino, setDestino] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setDestino(unidad?.areaId ?? '')
    setError('')
  }, [unidad])
  async function confirmar() {
    setGuardando(true)
    setError('')
    try {
      await repo.vehiculos.asignarArea(unidad.id, destino || null)
      await alGuardar()
      alCerrar()
    } catch (e) {
      setError(e?.message || 'No se pudo cambiar el área.')
    } finally {
      setGuardando(false)
    }
  }
  return (
    <Modal titulo={unidad ? `Área de ${unidad.alias}` : ''} abierto={Boolean(unidad)} alCerrar={alCerrar} ancho={460}>
      <Campo etiqueta="Área" error={error} ayuda="Ubicación, sector o contrato al que responde la unidad.">
        <select className="pnl-input" value={destino} onChange={(e) => setDestino(e.target.value)}>
          <option value="">Sin área</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
      </Campo>
      <div className="pnl-chips">
        <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={guardando || destino === (unidad?.areaId ?? '')}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        <button type="button" className="pnl-btn sutil" onClick={alCerrar} disabled={guardando}>Cancelar</button>
      </div>
    </Modal>
  )
}
