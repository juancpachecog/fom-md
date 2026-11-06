import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { esGestor } from '../roles'
import {
  Cabecera, Cargando, Vacio, ErrorCarga, Tag, Tarjeta, Kpi, Barra, Modal, Campo,
  Volver, Pestanas, Datos,
} from '../comp/ui'
import Mapa from '../comp/Mapa'
import { BarrasH } from '../comp/Grafico'
import { Icono } from '../Iconos'
import FichaUnidad from '../comp/FichaUnidad'
import { SelectorArchivos } from '../comp/Archivos'
import { subirVarios } from '../datos/archivos'
import { ArchivosDeDocumento, ModalNuevoDocumento } from './Documentos'
import FotoUnidad from '../comp/FotoUnidad'
import FichaDatosUnidad from './FichaDatosUnidad'
import UsuariosUnidad from './UsuariosUnidad'
import EtiquetasVehiculo from './EtiquetasVehiculo'
import { FranjaFichaMovil, UbicacionUnidadMovil, textoRecorridoHoy, useHoyDeUnidad } from './FichaUnidadMovil'
import { useMinuto } from '../datos/sinSenal'
import * as f from '../datos/formato'
import { masNuevoPrimero } from '../datos/orden'
import { enlaceEventoEnMapa } from '../datos/eventosManejo'
import { TIPO_FALLA, color, etiqueta } from '../datos/catalogos'
import './expediente-unidad.css'
import '../../styles/movil-modulos.css'

// ============================================================
// EXPEDIENTE DEL VEHÍCULO
// ------------------------------------------------------------
// Todo lo que se sabe de una unidad en un solo lugar: ficha, telemetría,
// mantenimiento, inspecciones, documentos y gasto. Las asignaciones (área y
// conductor) se editan aquí mismo, sin salir de la pantalla.
// ============================================================

const PESTANAS = [
  { v: 'resumen', t: 'Resumen' },
  { v: 'ficha', t: 'Ficha de la unidad' },
  { v: 'telemetria', t: 'Telemetría' },
  { v: 'usuarios', t: 'Usuarios' },
  { v: 'inspecciones', t: 'Inspecciones' },
  { v: 'mantenimiento', t: 'Mantenimiento' },
  { v: 'documentos', t: 'Documentos' },
  { v: 'costos', t: 'Costos' },
]

const TONO_INDICE = { verde: 'ok', amarillo: 'aviso', rojo: 'malo' }

// Mismas nueve categorías del costService de la app.
const CATEGORIA_COSTO = {
  combustible: 'Combustible',
  repuestos: 'Repuestos',
  neumaticos: 'Neumáticos',
  lubricantes: 'Lubricantes',
  mano_obra: 'Mano de obra',
  preventivo: 'Preventivo',
  correctivo: 'Correctivo',
  peajes: 'Peajes',
  seguros: 'Seguros',
}

const DIAS_EVENTOS = 28

function tonoNivel(pct, malo, aviso) {
  if (pct <= malo) return 'malo'
  if (pct <= aviso) return 'aviso'
  return ''
}

/** Fila de nivel con barra y porcentaje (aceite; el combustible no se mide). */
function Nivel({ icono, titulo, pct, tono }) {
  return (
    <div className="pnl-fila">
      <Icono nombre={icono} tam={18} />
      <div className="pnl-fila-txt">
        <b>{titulo}</b>
        <Barra valor={(pct ?? 0) / 100} tono={tono} />
      </div>
      <em>{pct ?? 0}%</em>
    </div>
  )
}

/**
 * Kilometraje de la unidad: lo de HOY en grande y el TOTAL del carro. El total es la lectura oficial del odómetro más
 * lo recorrido desde que se registró (los km por día los calcula el servidor con todas las posiciones del GPS). Sin
 * lectura oficial no se inventa un total: se dice y se ofrece registrar el odómetro actual.
 */
function KpiKilometraje({ v, puedeRegistrar }) {
  const [registrando, setRegistrando] = useState(false)
  const [version, setVersion] = useState(0)
  const datos = useDatos(async () => {
    const oficial = repo.vehiculos.odometro ? await repo.vehiculos.odometro(v.id).catch(() => null) : null
    // Desde el día de la lectura hasta hoy (lo que se movió después de que alguien miró el tablero).
    const desdeLectura = oficial?.en ? Math.ceil((Date.now() - Date.parse(oficial.en)) / 86400000) + 1 : 0
    const dias = repo.vehiculos.kmPorDia ? await repo.vehiculos.kmPorDia(v.id, Math.min(120, Math.max(7, desdeLectura))).catch(() => null) : null
    return { oficial, dias }
  }, [v.id, version])
  const hoy = f.hoyISO()
  const km1 = (n) => `${n < 10 ? n.toFixed(1).replace('.', ',') : f.numero(Math.round(n))} km`
  const { oficial, dias } = datos.datos ?? {}
  const lectura = oficial?.km ?? v.km ?? null

  let valor = 'Sin dato'
  let nota = 'Sin recorrido registrado hoy.'
  if (dias && dias.length > 0) {
    const hoyKm = dias.find((d) => d.fecha === hoy)?.km ?? 0
    const semana = dias.filter((d) => d.fecha >= hoyMenos(7)).reduce((s, d) => s + d.km, 0)
    valor = `${km1(hoyKm)} hoy`
    let total = 'Total del carro: sin odómetro registrado'
    if (lectura != null) {
      // Lo recorrido desde el día de la lectura (si no hay fecha de lectura, es el odómetro tal cual lo manda el equipo).
      const desde = oficial?.en ? String(oficial.en).slice(0, 10) : null
      const despues = desde ? dias.filter((d) => d.fecha >= desde).reduce((s, d) => s + d.km, 0) : 0
      total = `Total del carro: ${f.km(lectura + despues)}`
    }
    nota = `${total} · últimos 7 días ${km1(semana)}`
  } else if (lectura != null) {
    valor = f.km(lectura)
    nota = 'Odómetro registrado.'
  }

  return (
    <div className="km-card">
      <Kpi titulo="Kilometraje" valor={valor} icono="camion" nota={nota} />
      {puedeRegistrar && lectura == null && (
        <button type="button" className="pnl-link km-registrar" onClick={() => setRegistrando(true)}>Registrar el odómetro actual →</button>
      )}
      {puedeRegistrar && lectura != null && (
        <button type="button" className="pnl-link km-registrar" onClick={() => setRegistrando(true)}>Corregir el odómetro →</button>
      )}
      <ModalOdometro unidad={v} abierto={registrando} alCerrar={() => setRegistrando(false)} alGuardar={() => { setRegistrando(false); setVersion((n) => n + 1) }} />
    </div>
  )
}

/** El día de hace `n` días como AAAA-MM-DD, para sumar los últimos 7 días. */
function hoyMenos(n) {
  const d = new Date(Date.now() - (n - 1) * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------------- Tarjetas compactas del Resumen ----------------
// Usan lo que la ficha ya trae (documentos y costos de la unidad): no piden
// nada nuevo al servidor. El detalle completo sigue en su pestaña.

const PRIORIDAD_DOC = { vencido: 0, por_vencer: 1, vigente: 2 }
const TONO_DOC = { vencido: 'malo', por_vencer: 'aviso', vigente: '' }
const MAX_DOCS_RESUMEN = 4
// Los rubros que no caben se suman en «Otros» para que la barra no se corte.
const MAX_RUBROS_RESUMEN = 3
const TONOS_RUBRO = ['primario', 'aviso', 'tenue', 'otros']

function VerTodo({ alPulsar, children }) {
  return <button type="button" className="pnl-link eu-ver" onClick={alPulsar}>{children} →</button>
}

/** Primero lo vencido y lo que está por vencer: es lo que hay que atender. */
function ResumenDocumentos({ documentos, verTodo }) {
  const lista = [...(documentos ?? [])]
    .sort((a, b) => (PRIORIDAD_DOC[a.estado] ?? 3) - (PRIORIDAD_DOC[b.estado] ?? 3) || String(a.venceEn).localeCompare(String(b.venceEn)))
  const visibles = lista.slice(0, MAX_DOCS_RESUMEN)
  const resto = lista.length - visibles.length
  return (
    <Tarjeta titulo="Documentos de la unidad" accion={<VerTodo alPulsar={verTodo}>Ver documentos</VerTodo>}>
      {!visibles.length ? (
        <p className="eu-nota eu-nota-sola">Sin documentos cargados. Regístralos desde Documentos para no perder los vencimientos.</p>
      ) : (
        <div className="eu-docs">
          {visibles.map((d) => (
            <div key={d.id} className="eu-doc">
              <span className={`eu-doc-icono ${TONO_DOC[d.estado] ?? ''}`}><Icono nombre="documento" tam={18} /></span>
              <div className="eu-doc-txt">
                <b>{d.tipo}</b>
                <span>{d.venceEn ? `Vence el ${f.fecha(d.venceEn)} · ${f.vencimiento(d.venceEn)}` : 'Sin fecha de vencimiento'}</span>
              </div>
              <Tag color={color('documento_estado', d.estado)}>{etiqueta('documento_estado', d.estado)}</Tag>
            </div>
          ))}
          {resto > 0 && <p className="eu-nota">Y {resto} {resto === 1 ? 'documento más' : 'documentos más'} en Documentos.</p>}
        </div>
      )}
    </Tarjeta>
  )
}

/** "octubre 2026": el mes en curso, para decir de qué período es el total. */
function mesActual() {
  const d = new Date()
  return `${d.toLocaleDateString('es', { month: 'long' })} ${d.getFullYear()}`
}

/** Total del mes en curso y sus rubros principales, con los costos que la ficha ya trae. */
function ResumenCostos({ costos, verTodo }) {
  const { total, rubros } = useMemo(() => {
    const mes = f.hoyISO().slice(0, 7)
    const suma = {}
    let total = 0
    ;(costos ?? []).forEach((c) => {
      if (String(c.fecha ?? c.creadaEn ?? '').slice(0, 7) !== mes) return
      // Un monto vacío o no numérico no debe volver NaN todo el total.
      const monto = Number(c.monto) || 0
      suma[c.categoria] = (suma[c.categoria] || 0) + monto
      total += monto
    })
    const orden = Object.entries(suma)
      .map(([clave, valor]) => ({ etiqueta: CATEGORIA_COSTO[clave] ?? clave, valor }))
      .sort((a, b) => b.valor - a.valor)
    const rubros = orden.slice(0, MAX_RUBROS_RESUMEN)
    const otros = orden.slice(MAX_RUBROS_RESUMEN).reduce((s, r) => s + r.valor, 0)
    if (otros > 0) rubros.push({ etiqueta: 'Otros', valor: otros })
    return { total, rubros }
  }, [costos])
  return (
    <Tarjeta titulo="Costos del mes" accion={<VerTodo alPulsar={verTodo}>Ver costos</VerTodo>}>
      {!rubros.length ? (
        // Con el servidor real la ficha aún no trae costos: no se afirma «sin gastos».
        <p className="eu-nota eu-nota-sola">No hay costos cargados para este mes.</p>
      ) : (
        <div className="eu-costos">
          <div className="eu-costo-total">
            <b>{f.moneda(total)}</b>
            <span>en total · {mesActual()}</span>
          </div>
          <div className="eu-costo-barra" aria-hidden="true">
            {rubros.map((r, i) => (
              <span key={r.etiqueta} className={TONOS_RUBRO[i]} style={{ flexGrow: r.valor }} />
            ))}
          </div>
          <div>
            {rubros.map((r, i) => (
              <div key={r.etiqueta} className="eu-costo-fila">
                <i className={TONOS_RUBRO[i]} />
                {r.etiqueta}
                <b>{f.moneda(r.valor)}</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </Tarjeta>
  )
}

// ---------------- Teléfono: la ficha en una sola página ----------------
// Como unidad.tsx de la app: las ocho pestañas se vuelven una fila de chips
// que lleva a cada sección, y las secciones van una debajo de otra.

const CONSULTA_MOVIL = '(max-width: 767px)'

/** ¿Pantalla de teléfono? Sigue al ancho en vivo (girar, cambiar de ventana). */
function useEsMovil() {
  const [movil, setMovil] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(CONSULTA_MOVIL).matches))
  useEffect(() => {
    const mq = window.matchMedia?.(CONSULTA_MOVIL)
    if (!mq) return undefined
    const cambio = () => setMovil(mq.matches)
    cambio()
    mq.addEventListener?.('change', cambio)
    return () => mq.removeEventListener?.('change', cambio)
  }, [])
  return movil
}

/** En el teléfono, cada parte es una sección con su nombre; en escritorio, nada. */
function Parte({ clave, movil, children }) {
  if (!movil) return children
  const nombre = PESTANAS.find((p) => p.v === clave)?.t
  return (
    <section id={`parte-${clave}`} data-parte={clave} className="mv-seccion" aria-label={nombre}>
      {clave !== 'resumen' && <h2 className="mv-seccion-titulo">{nombre}</h2>}
      {children}
    </section>
  )
}

/**
 * La fila de partes: se queda arriba al bajar y enciende la sección que se
 * está leyendo.
 */
function PartesMovil({ activa, alElegir }) {
  const fila = useRef(null)
  useEffect(() => {
    // El chip encendido, siempre a la vista dentro de la fila.
    const nav = fila.current
    const chip = nav?.querySelector('[aria-current="true"]')
    if (nav && chip) nav.scrollTo({ left: chip.offsetLeft - 16, behavior: 'smooth' })
  }, [activa])
  return (
    <nav ref={fila} className="mv-partes" aria-label="Partes de la ficha">
      {PESTANAS.map((p) => (
        <button key={p.v} type="button" aria-current={p.v === activa ? 'true' : undefined} onClick={() => alElegir(p.v)}>
          {p.t}
        </button>
      ))}
    </nav>
  )
}

function ModalOdometro({ unidad, abierto, alCerrar, alGuardar }) {
  const [km, setKm] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  async function confirmar() {
    const n = Number(String(km).replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return setError('Escribe los kilómetros que marca el tablero del carro.')
    setGuardando(true)
    setError('')
    try {
      await repo.vehiculos.registrarOdometro(unidad.id, n)
      setKm('')
      alGuardar()
    } catch (e) {
      setError(/todavía no está en el servidor/i.test(e?.message ?? '') ? 'El servidor todavía no permite registrar el odómetro a mano: falta esa ruta. Está pedida en el Issue del servidor.' : (e?.message || 'No se pudo registrar el odómetro.'))
    } finally {
      setGuardando(false)
    }
  }
  return (
    <Modal titulo={`Odómetro de ${unidad.alias || unidad.placa}`} abierto={abierto} alCerrar={() => { if (!guardando) alCerrar() }} ancho={460}>
      <Campo etiqueta="Kilómetros que marca el tablero hoy" ayuda="Desde ese número, la web suma lo que el GPS vaya registrando para mostrar el total del carro." error={error}>
        <input className="pnl-input" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="52340" autoFocus />
      </Campo>
      <div className="pnl-chips">
        <button type="button" className="pnl-btn primario" disabled={guardando} onClick={confirmar}>{guardando ? 'Guardando…' : 'Guardar odómetro'}</button>
        <button type="button" className="pnl-btn sutil" disabled={guardando} onClick={alCerrar}>Cancelar</button>
      </div>
    </Modal>
  )
}

export default function ExpedienteVehiculo() {
  const { id } = useParams()
  const [parametros, setParametros] = useSearchParams()
  const pestana = PESTANAS.some(p => p.v === parametros.get('vista')) ? parametros.get('vista') : 'resumen'
  const setPestana = valor => setParametros(previos => {
    const siguientes = new URLSearchParams(previos)
    if (valor === 'resumen') siguientes.delete('vista')
    else siguientes.set('vista', valor)
    return siguientes
  }, { replace: true })
  const sesion = useSesion()
  const movil = useEsMovil()
  // En el teléfono: la parte que se está leyendo, para encender su chip.
  const [parteVista, setParteVista] = useState('resumen')
  const saltando = useRef(null)

  const { datos: v, estado, error, recargar } = useDatos(() => repo.vehiculos.obtener(id), [id], 30_000)
  const areas = useDatos(() => repo.areas(), [])
  const conductores = useDatos(() => repo.personal.listar({ soloConductores: true }), [])

  const [pinSeleccionado, setPinSeleccionado] = useState(null)
  // En el teléfono (T-190): dónde está ahora y lo de hoy, y si el mapa de arriba enseña el día entero.
  const ahora = useMinuto()
  const vivo = useHoyDeUnidad(v, ahora, movil && estado === 'ok' && Boolean(v))
  const [verRecorrido, setVerRecorrido] = useState(false)
  useEffect(() => { setVerRecorrido(false) }, [id])
  const [guardado, setGuardado] = useState('')
  const [conductorElegido, setConductorElegido] = useState(null)
  const [asignandoConductor, setAsignandoConductor] = useState(false)
  const [guardandoArea, setGuardandoArea] = useState(false)
  const [errorArea, setErrorArea] = useState('')
  useEffect(() => { setConductorElegido(null); setErrorForma(''); setErrorArea('') }, [id])

  // Modal de nueva ODT
  const [modalOdt, setModalOdt] = useState(false)
  const [forma, setForma] = useState({ descripcion: '', tipoFalla: 'motor', ubicacion: '' })
  const [errorForma, setErrorForma] = useState('')
  const [archivando, setArchivando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [fotosOdt, setFotosOdt] = useState([])
  // Documentos de la unidad: registrar uno nuevo y ver o subir sus archivos.
  const [registrandoDoc, setRegistrandoDoc] = useState(false)
  const [archivosDe, setArchivosDe] = useState(null)

  const reloj = useRef(null)
  useEffect(() => () => { clearTimeout(reloj.current); clearTimeout(saltando.current) }, [])

  /** Ir a una parte: en escritorio cambia la pestaña; en el teléfono baja hasta su sección. */
  function irAParte(clave) {
    if (!movil) return setPestana(clave)
    setParteVista(clave)
    // Mientras dura el salto, el desplazamiento no va encendiendo las de en medio.
    clearTimeout(saltando.current)
    saltando.current = setTimeout(() => { saltando.current = null }, 900)
    document.getElementById(`parte-${clave}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Al bajar a mano, el chip encendido sigue a la sección que se lee.
  const hayFicha = estado === 'ok' && Boolean(v)
  useEffect(() => {
    if (!movil || !hayFicha || typeof IntersectionObserver === 'undefined') return undefined
    const obs = new IntersectionObserver((entradas) => {
      if (saltando.current) return
      const visible = entradas
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) setParteVista(visible.target.dataset.parte)
    }, { rootMargin: '-140px 0px -55% 0px' })
    document.querySelectorAll('.mv-seccion[data-parte]').forEach((s) => obs.observe(s))
    return () => obs.disconnect()
  }, [movil, hayFicha])

  function avisarGuardado(texto = 'Guardado') {
    setGuardado(texto)
    clearTimeout(reloj.current)
    reloj.current = setTimeout(() => setGuardado(''), 2000)
  }

  const eventosRecientes = useMemo(() => {
    if (!v?.eventos) return []
    const corte = Date.now() - DIAS_EVENTOS * 86400000
    return v.eventos.filter((e) => new Date(e.creadaEn).getTime() >= corte)
  }, [v])

  const porCategoria = useMemo(() => {
    if (!v?.costos?.length) return []
    const suma = {}
    v.costos.forEach((c) => {
      suma[c.categoria] = (suma[c.categoria] || 0) + c.monto
    })
    return Object.entries(suma)
      .map(([clave, valor]) => ({ etiqueta: CATEGORIA_COSTO[clave] ?? clave, valor }))
      .sort((a, b) => b.valor - a.valor)
  }, [v])

  const totalCostos = useMemo(() => (v?.costos ?? []).reduce((a, c) => a + c.monto, 0), [v])

  // El manejo brusco de los últimos días, por tipo (la tarjeta «Manejo brusco» del teléfono).
  const manejoPorTipo = useMemo(() => {
    const cuenta = new Map()
    eventosRecientes.forEach((e) => { const k = e.nombre ?? e.clave ?? 'Evento'; cuenta.set(k, (cuenta.get(k) ?? 0) + 1) })
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1])
  }, [eventosRecientes])

  // Sin try/catch un rechazo del servidor era una promesa sin capturar:
  // ningun mensaje, el selector volvia a su valor, y parecia que «no dejaba».
  async function cambiarArea(valor) {
    if (guardandoArea) return
    setGuardandoArea(true)
    setErrorArea('')
    try {
      await repo.vehiculos.asignarArea(id, valor || null)
      await recargar()
      avisarGuardado()
    } catch (e) {
      setErrorArea(e.message)
    } finally {
      setGuardandoArea(false)
    }
  }

  async function cambiarConductor(valor) {
    if (asignandoConductor) return
    setAsignandoConductor(true)
    setErrorForma('')
    try {
      await repo.vehiculos.asignarConductor(id, valor || null)
      await recargar()
      setConductorElegido(null)
      avisarGuardado(valor ? 'Conductor asignado' : 'Asignación retirada')
    } catch (e) {
      setErrorForma(e.message)
    } finally {
      setAsignandoConductor(false)
    }
  }

  async function cambiarVencimiento(docId, venceEn) {
    if (!venceEn) return
    await repo.documentos.actualizarVencimiento(docId, venceEn)
    await recargar()
    avisarGuardado('Vencimiento actualizado')
  }

  function abrirModalOdt() {
    setForma({ descripcion: '', tipoFalla: 'motor', ubicacion: v?.ubicacionTexto ?? '' })
    setErrorForma('')
    setModalOdt(true)
  }

  async function crearOdt(e) {
    e.preventDefault()
    if (!forma.descripcion.trim()) {
      setErrorForma('Describe la falla.')
      return
    }
    setEnviando(true)
    try {
      const creada = await repo.odts.crear({
        vehiculoId: id,
        descripcion: forma.descripcion.trim(),
        tipoFalla: forma.tipoFalla,
        ubicacion: forma.ubicacion.trim(),
        creadorId: sesion?.perfil?.id ?? null,
      })
      // Las fotos van después: necesitan el número de la orden para quedar unidas a ella.
      let nota = ''
      const odtId = typeof creada === 'string' ? creada : creada?.id
      if (fotosOdt.length && odtId) {
        const r = await subirVarios({ coleccion: 'work-orders', padreId: odtId, proposito: 'work_order_opening', archivos: fotosOdt })
        if (r.errores.length) nota = ` · ${r.errores.length} foto(s) no se subieron; agrégalas desde la orden`
      }
      setFotosOdt([])
      setModalOdt(false)
      await recargar()
      avisarGuardado(`ODT creada${nota}`)
    } finally {
      setEnviando(false)
    }
  }

  const cargando = estado === 'cargando'
  // En el teléfono se pintan todas las partes, una debajo de otra.
  const ver = (clave) => movil || pestana === clave
  const abiertas = (v?.odts ?? []).filter((o) => o.estado === 'abierta').length
  const enRevision = (v?.odts ?? []).filter((o) => o.estado === 'en_revision').length

  return (
    <>
      <Cabecera
        className={`eu-cabecera${movil ? ' fum-cab' : ''}`}
        imagen={v && !movil && <FotoUnidad key={v.id} unidad={v} variante="cabecera" />}
        titulo={v ? v.alias : 'Expediente de la unidad'}
        bajada={
          // Solo lo que existe. Un año nulo salia como la palabra «null» en
          // medio del subtitulo, que es peor que no decir el año.
          v
            ? [`${v.marca} ${v.modelo}`.trim(), v.anio, v.placa].filter(Boolean).join(' · ')
            : 'Ficha completa de la unidad'
        }
      >
        {v && !movil && (
          <>
            <Tag color={color('marcha_estado', v.estadoMarcha)}>
              {etiqueta('marcha_estado', v.estadoMarcha)}
            </Tag>
            {esGestor(sesion?.perfil) && (
              <button type="button" className="pnl-btn" onClick={() => setArchivando(true)}>
                <Icono nombre="cerrar" tam={16} />
                Archivar unidad
              </button>
            )}
            <Tag color="azul">{etiqueta('vehiculo_tipo', v.tipo)}</Tag>
          </>
        )}
      </Cabecera>

      <div className="pnl-cuerpo">
        <Volver a="/panel/flota">Vehículos</Volver>

        {cargando && <Cargando filas={6} />}
        {estado === 'error' && <ErrorCarga onReintentar={recargar} error={error} />}

        {estado === 'ok' && !v && (
          <Vacio
            icono="camion"
            titulo="No encontramos esa unidad"
            texto="Puede que la hayan dado de baja o que el enlace esté equivocado."
            accion={<Link to="/panel/flota" className="pnl-btn">Ver todas las unidades</Link>}
          />
        )}

        {estado === 'ok' && v && (
          <>
            {(() => {
              const kpis = <div className="pnl-grid k4">
              <KpiKilometraje v={v} puedeRegistrar={esGestor(sesion?.perfil)} />
              <Kpi
                titulo="Índice seguro"
                valor={v.indiceSeguro}
                icono="escudo"
                tono={TONO_INDICE[f.rangoIndice(v.indiceSeguro)]}
                nota="Manejo seguro sobre 100"
              />
              <Kpi
                titulo="ODT abiertas"
                valor={abiertas}
                icono="llave"
                tono={abiertas ? 'aviso' : 'ok'}
                nota={`${enRevision} en revisión`}
                a="/panel/mantenimiento"
              />
              <Kpi
                titulo="Eventos de manejo"
                valor={eventosRecientes.length}
                icono="alerta"
                tono={eventosRecientes.length > 6 ? 'malo' : ''}
                nota={`Últimos ${DIAS_EVENTOS} días`}
                a={enlaceEventoEnMapa({ vehiculoId: v.id })}
              />
            </div>
              // En el teléfono: arriba dónde está, y las cuatro cifras en la hoja bajo la foto.
              if (!movil || !vivo.unidad) return kpis
              return (
                <div className="fum">
                  <UbicacionUnidadMovil unidad={vivo.unidad} cola={vivo.cola} puntosDia={vivo.puntos} ahora={ahora}
                    verRecorrido={verRecorrido} alVerRecorrido={() => setVerRecorrido((x) => !x)} />
                  <FranjaFichaMovil unidad={vivo.unidad} hoy={vivo.hoy}>{kpis}</FranjaFichaMovil>
                </div>
              )
            })()}

            {movil
              ? <PartesMovil activa={parteVista} alElegir={irAParte} />
              : <Pestanas opciones={PESTANAS} valor={pestana} alCambiar={setPestana} />}

            {/* ---------------- Resumen ---------------- */}
            {ver('resumen') && (
              <Parte clave="resumen" movil={movil}>
                {movil ? (
                  // El mapa ya está arriba: aquí, lo de hoy en palabras y el día entero a un toque.
                  <Tarjeta titulo="Recorrido" accion={<button type="button" className="pnl-link eu-ver" onClick={() => { setVerRecorrido(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Ver recorrido →</button>}>
                    <p className="fum-nota">{textoRecorridoHoy(vivo.hoy, vivo.unidad)}</p>
                  </Tarjeta>
                ) : (
                  <div className="pnl-expediente-hero"><Tarjeta titulo="Vehículo"><FichaUnidad unidad={v} conEnlace={false} /></Tarjeta><Tarjeta titulo="Recorrido del día" sinCuerpo><Mapa vehiculos={[v]} seleccionado={pinSeleccionado} alSeleccionar={setPinSeleccionado} recorrido={v.recorrido} alto="470px" ficha={false} /></Tarjeta></div>
                )}
                <div className="eu-resumen-grid">
                  <ResumenDocumentos documentos={v.documentos} verTodo={() => irAParte('documentos')} />
                  <ResumenCostos costos={v.costos} verTodo={() => irAParte('costos')} />
                </div>
              </Parte>
            )}

            {ver('ficha') && <Parte clave="ficha" movil={movil}><FichaDatosUnidad
              unidad={v} areas={areas} puedeEditar={esGestor(sesion?.perfil)} cambiarArea={cambiarArea}
              guardandoArea={guardandoArea} errorArea={errorArea} guardado={guardado}
              verUsuarios={() => irAParte('usuarios')}
            />{esGestor(sesion?.perfil)&&<EtiquetasVehiculo key={v.id} vehicleId={v.id}/>}</Parte>}

            {/* ---------------- Telemetría ---------------- */}
            {ver('telemetria') && (
              <Parte clave="telemetria" movil={movil}>
                {v.aceitePct != null && (
                  <Tarjeta titulo="Niveles">
                    <div className="pnl-filas">
                      <Nivel
                        icono="llave"
                        titulo="Aceite"
                        pct={v.aceitePct}
                        tono={tonoNivel(v.aceitePct, 25, 40)}
                      />
                    </div>
                  </Tarjeta>
                )}

                <Tarjeta titulo="Estado en vivo">
                  <Datos
                    items={[
                      { etiqueta: 'Temperatura del motor', valor: v.tempMotorC == null ? 'Sin dato' : `${v.tempMotorC} °C` },
                      { etiqueta: 'Velocidad actual', valor: v.velocidadKmh == null ? 'Sin dato' : f.velocidad(v.velocidadKmh) },
                      { etiqueta: 'Estado', valor: etiqueta('marcha_estado', v.estadoMarcha) },
                      { etiqueta: 'Kilometraje', valor: f.km(v.km) },
                      { etiqueta: 'Ubicación', valor: v.ubicacionTexto || (Number.isFinite(v.lat) && Number.isFinite(v.lng) ? `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}` : 'Sin posición') },
                      { etiqueta: 'Último reporte', valor: f.desde(v.ultimoReporte) },
                    ]}
                  />
                </Tarjeta>

                {movil && (
                  <Tarjeta titulo="Manejo brusco" accion={<Link className="pnl-link eu-ver" to={enlaceEventoEnMapa({ vehiculoId: v.id })}>Ver en el mapa →</Link>}>
                    {!manejoPorTipo.length ? <p className="fum-nota">{`Sin eventos de manejo en los últimos ${DIAS_EVENTOS} días.`}</p> : (
                      <Datos items={manejoPorTipo.map(([nombre, n]) => ({ etiqueta: nombre, valor: String(n) }))} />
                    )}
                  </Tarjeta>
                )}

                <Tarjeta titulo="Equipo GPS">
                  <div className="pnl-filas">
                    <div className="pnl-fila">
                      <span className={`pnl-punto ${v.gps?.verificado ? 'on' : 'off'}`} />
                      <div className="pnl-fila-txt">
                        <b>{v.gps?.modelo ?? 'Sin equipo'}</b>
                        <span>IMEI {v.gps?.imei ?? 'sin registrar'} · Línea {v.gps?.linea ?? 'sin registrar'}</span>
                      </div>
                      <Tag color={v.gps?.pinSupport ? 'verde' : 'gris'}>
                        {v.gps?.pinSupport ? 'GPS con PIN' : 'GPS sin PIN'}
                      </Tag>
                    </div>
                    <div className="pnl-fila">
                      <Icono nombre="pin" tam={16} />
                      <div className="pnl-fila-txt">
                        <span>
                          La telemetría detallada llega del GPS; hoy el sistema guarda posición,
                          velocidad y kilometraje.
                        </span>
                      </div>
                    </div>
                  </div>
                </Tarjeta>
              </Parte>
            )}

            {ver('usuarios') && <Parte clave="usuarios" movil={movil}><UsuariosUnidad key={v.id}
              unidad={v} conductores={conductores} puedeEditar={esGestor(sesion?.perfil)}
              elegido={conductorElegido} elegir={valor => { setConductorElegido(valor); setErrorForma('') }}
              asignando={asignandoConductor} asignar={cambiarConductor} error={errorForma} guardado={guardado}
            /></Parte>}

            {/* ---------------- Inspecciones ---------------- */}
            {ver('inspecciones') && (
              <Parte clave="inspecciones" movil={movil}>
              <Tarjeta titulo="Inspecciones diarias" sinCuerpo>
                {!v.inspecciones.length ? (
                  <Vacio
                    icono="check"
                    titulo="Sin inspecciones registradas"
                    texto="Todavía nadie ha hecho el chequeo de esta unidad desde la app."
                  />
                ) : (
                  <div className="pnl-tabla-wrap">
                    <table className="pnl-tabla mv-lista">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Resultado</th>
                          <th className="num">Observaciones</th>
                          <th className="num">Fallas críticas</th>
                          <th>Ubicación</th>
                        </tr>
                      </thead>
                      <tbody>
                        {masNuevoPrimero(v.inspecciones, ['creadaEn', 'fecha']).map((i) => (
                          <tr key={i.id} className={i.resultado === 'bloqueada' ? 'mv-u1' : i.resultado === 'aprobada_con_observaciones' ? 'mv-u2' : undefined}>
                            <td className="mv-t">
                              <div className="pnl-doble">
                                <b>{f.fecha(i.fecha)}</b>
                                <span>{f.desde(i.creadaEn)}</span>
                              </div>
                            </td>
                            <td className="mv-e">
                              <Tag color={color('inspeccion_resultado', i.resultado)}>
                                {etiqueta('inspeccion_resultado', i.resultado)}
                              </Tag>
                            </td>
                            <td className="num mv-d"><span className="mv-rotulo">Observaciones </span>{i.observaciones ?? 0}</td>
                            <td className="num mv-d"><span className="mv-rotulo">Fallas críticas </span>{i.fallasCriticas ?? 0}</td>
                            <td className="mv-d">{i.ubicacion || 'Sin registrar'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Tarjeta>
              </Parte>
            )}

            {/* ---------------- Mantenimiento ---------------- */}
            {ver('mantenimiento') && (
              <Parte clave="mantenimiento" movil={movil}>
              <Tarjeta
                titulo="Órdenes de trabajo"
                accion={
                  <button type="button" className="pnl-btn primario" onClick={abrirModalOdt}>
                    <Icono nombre="mas" tam={16} />
                    Nueva ODT
                  </button>
                }
              >
                {!v.odts.length ? (
                  <Vacio
                    icono="llave"
                    titulo="Sin órdenes de trabajo"
                    texto="Esta unidad no tiene fallas reportadas. Cuando aparezca una, la registras aquí."
                  />
                ) : (
                  <div className="pnl-filas">
                    {masNuevoPrimero(v.odts, 'creadaEn').map((o) => (
                      <div
                        key={o.id}
                        className={`pnl-fila${o.estado === 'abierta' ? ' critica' : o.estado === 'en_revision' ? ' aviso' : ''}`}
                      >
                        <div className="pnl-fila-txt">
                          <b>{o.descripcion}</b>
                          <span>
                            {o.tipoFalla ? etiqueta('tipo_falla', o.tipoFalla) : 'Sin clasificar'}
                            {' · '}
                            {f.fechaCorta(o.creadaEn)}
                            {o.estado === 'cerrada' && o.costo != null ? ` · ${f.moneda(o.costo)}` : ''}
                          </span>
                        </div>
                        <Tag color="gris">{etiqueta('odt_tipo', o.tipo)}</Tag>
                        <Tag color={color('odt_estado_visible', o.estado)}>{etiqueta('odt_estado_visible', o.estado)}</Tag>
                      </div>
                    ))}
                  </div>
                )}
              </Tarjeta>
              </Parte>
            )}

            {/* ---------------- Documentos ---------------- */}
            {ver('documentos') && (
              <Parte clave="documentos" movil={movil}>
              <Tarjeta
                titulo="Documentos de la unidad"
                accion={
                  <div className="pnl-chips">
                    {guardado ? <Tag color="verde">{guardado}</Tag> : null}
                    <button type="button" className="pnl-btn primario" onClick={() => setRegistrandoDoc(true)}>
                      <Icono nombre="mas" tam={16} />Registrar documento
                    </button>
                  </div>
                }
                sinCuerpo
              >
                {!v.documentos.length ? (
                  <Vacio
                    icono="documento"
                    titulo="Sin documentos cargados"
                    texto="Carga la póliza, el certificado de circulación y la revisión técnica para no perder de vista los vencimientos."
                  />
                ) : (
                  <div className="pnl-tabla-wrap">
                    <table className="pnl-tabla mv-lista">
                      <thead>
                        <tr>
                          <th>Documento</th>
                          <th>Vence</th>
                          <th>Estado</th>
                          <th>Cambiar vencimiento</th>
                          <th>Archivos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {v.documentos.map((d) => (
                          <tr key={d.id} className={d.estado === 'vencido' ? 'mv-u1' : d.estado === 'por_vencer' ? 'mv-u2' : undefined}>
                            <td className="mv-t"><b>{d.tipo}</b></td>
                            <td className="mv-d">
                              <div className="pnl-doble">
                                <b>{f.fecha(d.venceEn)}</b>
                                <span>({f.vencimiento(d.venceEn)})</span>
                              </div>
                            </td>
                            <td className="mv-e">
                              <Tag color={color('documento_estado', d.estado)}>
                                {etiqueta('documento_estado', d.estado)}
                              </Tag>
                            </td>
                            <td className="mv-pie">
                              <input
                                type="date"
                                className="pnl-input"
                                value={String(d.venceEn).slice(0, 10)}
                                min={f.hoyISO()}
                                aria-label={`Cambiar el vencimiento de ${d.tipo}`}
                                onChange={(e) => cambiarVencimiento(d.id, e.target.value)}
                              />
                            </td>
                            <td className="mv-a">
                              <button type="button" className="pnl-btn sutil" onClick={() => setArchivosDe(d)}>
                                <Icono nombre="documento" tam={15} />Fotos y PDF
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Tarjeta>
              </Parte>
            )}

            {/* ---------------- Costos ---------------- */}
            {ver('costos') && (
              <Parte clave="costos" movil={movil}>
              <Tarjeta
                titulo="Gasto por categoría"
                accion={<span className="pnl-link">Total: {f.moneda(totalCostos)}</span>}
              >
                {!porCategoria.length ? (
                  <Vacio
                    icono="reporte"
                    titulo="Sin gastos registrados"
                    texto="Cuando cargues combustible, repuestos o mano de obra de esta unidad, el resumen aparece acá."
                  />
                ) : (
                  <>
                    <BarrasH datos={porCategoria} formato={(n) => f.moneda(n)} />
                    <div className="pnl-filas">
                      <div className="pnl-fila">
                        <div className="pnl-fila-txt">
                          <b>Total del período</b>
                          <span>{f.cantidad(v.costos.length, 'movimiento registrado', 'movimientos registrados')}</span>
                        </div>
                        <em>{f.moneda(totalCostos)}</em>
                      </div>
                    </div>
                  </>
                )}
              </Tarjeta>
              </Parte>
            )}

            {/* En el teléfono, Archivar va al final, como en la app (solo quien gestiona la flota). */}
            {movil && esGestor(sesion?.perfil) && (
              <button type="button" className="pnl-btn fum-archivar" onClick={() => setArchivando(true)}>
                <Icono nombre="cerrar" tam={16} />
                Archivar unidad
              </button>
            )}
          </>
        )}
      </div>

      <Modal titulo="Nueva orden de trabajo" abierto={modalOdt} alCerrar={() => setModalOdt(false)}>
        <form onSubmit={crearOdt}>
          <Campo etiqueta="¿Qué le pasa a la unidad?" error={errorForma}>
            <textarea
              className="pnl-textarea"
              rows={4}
              value={forma.descripcion}
              placeholder="Ejemplo: el freno de mano no sostiene la unidad en pendiente."
              onChange={(e) => {
                setForma((s) => ({ ...s, descripcion: e.target.value }))
                if (errorForma) setErrorForma('')
              }}
            />
          </Campo>

          <Campo etiqueta="Tipo de falla">
            <select
              className="pnl-select"
              value={forma.tipoFalla}
              onChange={(e) => setForma((s) => ({ ...s, tipoFalla: e.target.value }))}
            >
              {TIPO_FALLA.map((t) => (
                <option key={t} value={t}>{etiqueta('tipo_falla', t)}</option>
              ))}
            </select>
          </Campo>

          <Campo etiqueta="Ubicación" ayuda="Dónde está la unidad ahora mismo.">
            <input
              type="text"
              className="pnl-input"
              value={forma.ubicacion}
              placeholder="Ejemplo: Intercomunal, Ciudad Ojeda"
              onChange={(e) => setForma((s) => ({ ...s, ubicacion: e.target.value }))}
            />
          </Campo>

          <SelectorArchivos
            archivos={fotosOdt}
            alCambiar={setFotosOdt}
            coleccion="work-orders"
            titulo="Fotos de la falla (opcional)"
            ayuda="Hasta 10 fotos de lo que se dañó. Se suben al crear la orden."
            deshabilitado={enviando}
          />

          <div className="pnl-cab-acciones">
            <button type="button" className="pnl-btn sutil" onClick={() => setModalOdt(false)}>
              Cancelar
            </button>
            <button type="submit" className="pnl-btn primario" disabled={enviando}>
              {enviando ? 'Guardando…' : 'Crear ODT'}
            </button>
          </div>
        </form>
      </Modal>
      {v && (
        <ModalNuevoDocumento
          abierto={registrandoDoc}
          alCerrar={() => setRegistrandoDoc(false)}
          alGuardar={async () => { await recargar(); avisarGuardado('Documento registrado') }}
          fijo={{ ambito: 'vehiculo', vehiculoId: v.id, nombre: [v.alias, v.placa].filter(Boolean).join(' · ') }}
        />
      )}
      <Modal titulo={archivosDe ? `Fotos y PDF: ${archivosDe.tipo}` : 'Fotos y PDF'} abierto={Boolean(archivosDe)} alCerrar={() => setArchivosDe(null)} ancho={760}>
        {archivosDe && <ArchivosDeDocumento documento={archivosDe} />}
      </Modal>
      {v && archivando && (
        <ModalArchivar unidad={v} alCerrar={() => setArchivando(false)} alHecho={() => { setArchivando(false); recargar() }} />
      )}
    </>
  )
}

// ---------------- Archivar la unidad ----------------
// Mismo paso que en la app: primero se pregunta qué lo impide (jornadas o
// asignaciones abiertas, GPS instalado, órdenes o emergencias vivas) y solo
// si nada lo impide se archiva, con motivo y con el estado que se vio.
const BLOQUEO = {
  driverSessions: 'jornadas abiertas', driverAssignments: 'conductores asignados', gpsInstallations: 'equipos GPS instalados',
  workOrders: 'órdenes de trabajo abiertas', emergencies: 'emergencias activas',
}
function ModalArchivar({ unidad, alCerrar, alHecho }) {
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const pre = useDatos(() => repo.vehiculos.preflightArchivo(unidad.id), [unidad.id])
  const bloqueos = Object.entries(pre.datos?.bloqueos ?? {}).filter(([, n]) => Number(n) > 0)
  async function confirmar() {
    if (motivo.trim().length < 3) return setError('Escribe el motivo: queda en el historial.')
    setGuardando(true)
    setError('')
    try {
      await repo.vehiculos.archivar(unidad.id, { estadoActual: pre.datos?.estadoActual, motivo: motivo.trim() })
      alHecho()
    } catch (e) {
      setError(e?.message || 'No se pudo archivar.')
    } finally {
      setGuardando(false)
    }
  }
  return (
    <Modal titulo={`Archivar ${unidad.alias}`} abierto alCerrar={alCerrar} ancho={480}>
      {pre.estado === 'cargando' && <Cargando filas={2} />}
      {pre.estado === 'error' && <ErrorCarga onReintentar={pre.recargar} error={pre.error} />}
      {pre.estado === 'ok' && (
        <>
          {bloqueos.length > 0 ? (
            <div className="pnl-fila critica">
              <Icono nombre="alerta" tam={16} />
              <div className="pnl-fila-txt">
                <b>Todavía no se puede archivar</b>
                <span>Antes resuelve: {bloqueos.map(([k, n]) => `${n} ${BLOQUEO[k] ?? k}`).join(', ')}.</span>
              </div>
            </div>
          ) : (
            <p style={{ margin: '0 0 12px', color: 'var(--e-texto-2)' }}>La unidad sale de la operación y conserva todo su historial. No se borra nada.</p>
          )}
          <Campo etiqueta="Motivo" error={error}>
            <input className="pnl-input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Vendida, siniestrada, fuera de servicio…" />
          </Campo>
          <div className="pnl-chips">
            <button type="button" className="pnl-btn primario" onClick={confirmar} disabled={guardando || bloqueos.length > 0}>
              {guardando ? 'Archivando…' : 'Archivar'}
            </button>
            <button type="button" className="pnl-btn sutil" onClick={alCerrar} disabled={guardando}>Cancelar</button>
          </div>
        </>
      )}
    </Modal>
  )
}
