// ============================================================
// REPOSITORIO DE DATOS DEL PANEL
// ------------------------------------------------------------
// Única puerta de acceso a los datos. Todas las funciones son asíncronas a
// propósito: el día que exista backend, cada una pasa a ser una consulta a
// Supabase (o a la API que se elija) sin tocar ni un módulo de la interfaz.
//
//   listarVehiculos()  ->  supabase.from('vehiculos').select(VEHICULO_SELECT)
//   cambiarEstadoOdt() ->  supabase.from('odts').update({estado}).eq('id', id)
//
// Mientras tanto lee la semilla y guarda los cambios del usuario en el
// navegador, para que lo que edite el supervisor siga ahí al recargar.
// ============================================================

import * as semillaBase from './semilla'
import { semillaActiva } from './semillaEstres'
import {
  CLAVE_POR_DEFECTO, DESEMPLEADOS_ID, ETIQUETA, ITEMS_INSPECCION, ROLES_ASIGNABLES,
  estadoDocumento, etiquetaRol, puedeGestionarA, validarRolEmpresa,
} from './catalogos'
import { hoyISO } from './formato'
import { DIAS_SEMANA, diasParaEnviar, normalizarDias, tocaTodosLosDias } from './diasPlanilla'
import { comoEventoManejo } from './eventosManejo'
import { calificacionManejo } from './manejo'
import { empresaGestionActualId } from './api'
import {
  AVISO_BLOQUEADA, AVISO_OTRA_UNIDAD, InspeccionYaHecha, argumentosDeFormato, cuerpoEmergencia, cuerpoPlantilla, detalleDeEnvio,
  emergenciaDelConductor, emergenciaParaConsola, guardarDiaria, leerDiariaGuardada, plantillaDeFormato, publicarSiHaceFalta,
  resultadoDeEnvio,
} from './repoApi'
import { perfilActual } from '../auth'

// Flota de estrés (T-80): solo con `?estres=…` o `fom.demo.estres` guardado.
// Sin eso, `semillaActiva` devuelve la semilla de siempre, tal cual.
const SEMILLA = semillaActiva(semillaBase)
const {
  AREAS, AUDITORIA, COSTOS, DOCUMENTOS, EMPRESA, EMPRESAS, EVENTOS, GPS_LIBRES,
  INSPECCIONES, NOTIFICACIONES, ODTS, PAGOS, PERFILES, REGLAS, VEHICULOS, recorridoDe, recorridoDetalladoDe,
} = SEMILLA

const CLAVE_CAMBIOS = SEMILLA.claveCambios ?? 'fom.panel.cambios'
// La flota de siempre (no la de estrés, que ya mueve sus horas con el reloj).
const ES_BASE = SEMILLA === semillaBase
const DIA_MS = 86_400_000
// Cinco minutos sin reportar = «Sin señal»: la misma regla de sinSenal.js (SIN_SENAL_MS).
const SIN_SENAL_DEMO_MS = 5 * 60_000

/**
 * La última señal de una unidad de la semilla, corrida con el reloj: la semilla fija sus horas al
 * cargar y, sin esto, a los 5 minutos toda la flota pasaba a «Sin señal». Cada lectura la deja
 * igual de reciente que al abrir, como una flota que sigue reportando.
 */
function reporteAlDia(v, ahora = Date.now()) {
  const t = Date.parse(v.ultimoReporte)
  if (!ES_BASE || !Number.isFinite(t)) return v
  return { ...v, ultimoReporte: new Date(t + (ahora - semillaBase.AHORA_SEMILLA)).toISOString() }
}
/** `conexion` como la trae el servidor: Mi unidad decide «Reportando» o «Sin señal» con ella. */
function conConexion(v, ahora = Date.now()) {
  const t = Date.parse(v.ultimoReporte)
  return { ...v, conexion: Number.isFinite(t) && ahora - t < SIN_SENAL_DEMO_MS ? 'reportando' : 'sin_senal' }
}

/**
 * Eventos de manejo de ejemplo de una unidad (forma del servidor, pasada por `comoEventoManejo`).
 * Caen sobre puntos de su recorrido: los primeros hoy, el resto en días anteriores por el mismo
 * camino. Algunos excesos quedan en 120 km/h o menos a propósito: el mapa no los muestra.
 * Los 16 primeros caen en los últimos 28 días; los 24 siguientes, entre 28 y 90 días atrás, para
 * que Reportes tenga con qué comparar el período anterior.
 */
function eventosManejoDemo(v) {
  let semilla = v.id.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 17)
  const azar = () => {
    semilla = (semilla * 1664525 + 1013904223) >>> 0
    return semilla / 4294967296
  }
  const rodando = recorridoDetalladoDe(v.id, 24).puntos.filter((p) => p.velocidadKmh > 0)
  if (!rodando.length) return []
  const tipos = ['harsh_braking', 'speeding', 'harsh_acceleration', 'harsh_braking', 'speeding', 'harsh_acceleration']
  const salida = []
  for (let i = 0; i < 40; i += 1) {
    const p = rodando[Math.floor(azar() * rodando.length)]
    const type = tipos[i % tipos.length]
    const dia = i < 5 ? 0 : i < 16 ? 1 + Math.floor(azar() * 27) : 28 + Math.floor(azar() * 62)
    const antes = type === 'speeding' ? 108 + Math.round(azar() * 40)
      : type === 'harsh_braking' ? 62 + Math.round(azar() * 34) : 8 + Math.round(azar() * 22)
    const despues = type === 'speeding' ? null
      : type === 'harsh_braking' ? Math.max(0, antes - 30 - Math.round(azar() * 25)) : antes + 30 + Math.round(azar() * 18)
    salida.push(comoEventoManejo({
      id: `ev-manejo-${v.id}-${i + 1}`,
      type,
      occurredAt: new Date(Date.parse(p.hora) - dia * 86400000).toISOString(),
      vehicleId: v.id,
      vehicleCode: v.alias,
      lat: p.lat,
      lng: p.lng,
      speedBeforeKph: antes,
      speedAfterKph: despues,
    }))
  }
  return salida.sort((a, b) => Date.parse(b.hora) - Date.parse(a.hora))
}

// Los eventos de una unidad salen de su recorrido del día: se arman una vez y se reusan
// (el ranking los cuenta para toda la flota y Reportes lo pide por cada corte).
const eventosGuardados = new Map()
function eventosDeUnidad(v) {
  const clave = `${v.id}:${v.alias}`
  if (!eventosGuardados.has(clave)) eventosGuardados.set(clave, eventosManejoDemo(v))
  return eventosGuardados.get(clave)
}

/**
 * Km diarios de ejemplo de una unidad. La media sale de su índice: con los eventos de su última
 * semana, a peor índice menos km (más eventos por cada 100 km), así índice, tasa y semáforo
 * cuentan lo mismo. Cada día varía un poco, siempre igual para la misma unidad y el mismo día.
 */
function kmDiarioBase(v, eventos) {
  if (!eventos.length) return 0
  const ultimo = Math.max(...eventos.map((e) => Date.parse(e.hora)))
  const semana = eventos.filter((e) => Date.parse(e.hora) > ultimo - 7 * DIA_MS).length
  const indice = Number.isFinite(v.indiceSeguro) ? v.indiceSeguro : 80
  const tasa = 0.4 + (100 - indice) * 0.08 // eventos por 100 km que «merece» ese índice
  return Math.min(320, Math.max(25, ((Math.max(1, semana) / tasa) * 100) / 7))
}
function kmDeLosDias(v, eventos, dias) {
  const base = kmDiarioBase(v, eventos)
  let km = 0
  for (let d = 0; d < Math.ceil(dias); d += 1) km += base * (0.7 + 0.6 * hashSemilla(`${v.id}:km:${d}`))
  return Math.round(km * 10) / 10
}

/**
 * El score de manejo de ejemplo de quien maneja la unidad, en la forma de `repoApi.manejo`
 * ({ id, nombre, indice, eventosPor100, km, dias, frenadas, aceleraciones, excesos, rating }).
 * Frenadas, aceleraciones y excesos son los MISMOS eventos que devuelve `manejo.eventos` en
 * esos días: la tarjeta, la tabla y el mapa cuentan lo mismo.
 */
function scoreDemo(v, persona, dias, ahora = Date.now()) {
  const eventos = eventosDeUnidad(v)
  const corte = ahora - dias * DIA_MS
  const delPeriodo = eventos.filter((e) => Date.parse(e.hora) >= corte)
  const cuenta = (tipo) => delPeriodo.filter((e) => e.tipo === tipo).length
  const frenadas = cuenta('frenada')
  const aceleraciones = cuenta('aceleracion')
  const excesos = cuenta('exceso')
  const km = kmDeLosDias(v, eventos, dias)
  const indice = km > 0 && Number.isFinite(v.indiceSeguro) ? v.indiceSeguro : null
  return {
    id: persona.id,
    nombre: persona.nombre,
    indice,
    eventosPor100: km > 0 ? Math.round(((frenadas + aceleraciones + excesos) / km) * 10000) / 100 : null,
    km,
    dias,
    frenadas,
    aceleraciones,
    excesos,
    rating: calificacionManejo({ indice }),
  }
}

// --- Capa de cambios locales ----------------------------------------------
function leerCambios() {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_CAMBIOS) || '{}')
  } catch {
    return {}
  }
}
let cambios = leerCambios()

function guardar() {
  try {
    localStorage.setItem(CLAVE_CAMBIOS, JSON.stringify(cambios))
  } catch {
    /* almacenamiento lleno o bloqueado: los cambios viven solo en memoria */
  }
  avisar()
}

const oyentes = new Set()
function avisar() {
  oyentes.forEach((fn) => fn())
}
/** Suscribirse a cualquier cambio de datos. Devuelve la baja. */
export function alCambiarDatos(fn) {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}

/** Borra todo lo editado y vuelve a los datos de origen. */
export function reiniciarDatos() {
  cambios = {}
  localStorage.removeItem(CLAVE_CAMBIOS)
  avisar()
}

function parche(coleccion, id) {
  return cambios[coleccion]?.[id]
}
function aplicar(coleccion, fila) {
  const p = parche(coleccion, fila.id)
  return p ? { ...fila, ...p } : fila
}
function guardarParche(coleccion, id, patch) {
  cambios[coleccion] = cambios[coleccion] || {}
  cambios[coleccion][id] = { ...(cambios[coleccion][id] || {}), ...patch }
  guardar()
}
function agregados(coleccion) {
  return cambios.nuevos?.[coleccion] || []
}
function agregar(coleccion, fila) {
  cambios.nuevos = cambios.nuevos || {}
  cambios.nuevos[coleccion] = [...(cambios.nuevos[coleccion] || []), fila]
  guardar()
}

// Latencia simulada, como fakeNetwork() de la app: obliga a los módulos a
// manejar el estado de carga desde ya.
const responder = (valor, ms = 120) =>
  new Promise((r) => setTimeout(() => r(typeof valor === 'function' ? valor() : valor), ms))

// --- Colecciones resueltas -------------------------------------------------
function todosVehiculos() {
  const ahora = Date.now()
  const lista = [...VEHICULOS.map((v) => reporteAlDia(v, ahora)), ...agregados('vehiculos')].map((v) => aplicar('vehiculos', v))
  // La de estrés se deja tal cual: sus unidades en marcha leen la hora en cada acceso.
  return conGpsAlDia(ES_BASE ? lista.map((v) => conConexion(v, ahora)) : lista)
}
function todosPerfiles() {
  // Los eliminados definitivamente no existen para nadie.
  return [...PERFILES, ...agregados('perfiles')]
    .map((p) => aplicar('perfiles', p))
    .filter((p) => !p.eliminado)
}
/** Solo la gente de la empresa del supervisor (la vista clásica del panel). */
function perfilesDeLaEmpresa() {
  return todosPerfiles().filter((p) => (p.empresaId ?? EMPRESA.id) === EMPRESA.id)
}
function todasOdts() {
  return [...agregados('odts'), ...ODTS]
    .map((o) => aplicar('odts', o))
    .sort((a, b) => new Date(b.creadaEn) - new Date(a.creadaEn))
}
function todosDocumentos() {
  return [...DOCUMENTOS, ...agregados('documentos')].map((d) => aplicar('documentos', d))
}
function todasNotificaciones() {
  // Las descartadas salen de la bandeja (y del conteo sin leer), como en la API.
  return [...NOTIFICACIONES, ...agregados('notificaciones')]
    .map((n) => aplicar('notificaciones', n))
    .filter((n) => !n.descartada)
    .sort((a, b) => new Date(b.creadaEn) - new Date(a.creadaEn))
}
function todasInspecciones() {
  return [...agregados('inspecciones'), ...INSPECCIONES.filter((i) => !esDiariaPendienteDemo(i)), ...historialInspecciones()]
    .map((i) => aplicar('inspecciones', i))
}

// El conductor de la demostración (usr-002) hace su diaria desde la web (T-167a):
// la semilla no se la da hecha, así la de hoy de su unidad queda pendiente
// hasta que él la envíe, igual para él que para su supervisor.
const CONDUCTOR_DEMO = 'usr-002'
function esDiariaPendienteDemo(i) {
  return i.conductorId === CONDUCTOR_DEMO && i.fecha === hoyISO()
}

// La semilla trae 12 días de inspecciones; la vista «Por persona» necesita el
// mes entero. Este historial cubre del día 12 al 50 hacia atrás con la misma
// regla que la operación: cada conductor hace la diaria todos los días con
// su propia constancia, y de vez en cuando le toca una programada. Sale de un
// hash de (conductor, fecha): la misma persona, el mismo día, el mismo resultado.
function hashSemilla(texto) {
  let h = 2166136261
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // Mezcla final (fmix32): sin ella, dos fechas seguidas dan casi el mismo número.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
let historialCache = null
function historialInspecciones() {
  // La flota de estrés ya trae su año de inspecciones.
  if (SEMILLA.sinHistorialExtra) return []
  const hoy = hoyISO()
  if (historialCache?.hoy === hoy) return historialCache.lista
  const lista = []
  for (const veh of VEHICULOS) {
    const conductorId = veh.conductorPrincipalId
    if (!conductorId) continue
    // Constancia propia de cada conductor: entre 55 % y 100 % de los días.
    const constancia = 0.55 + hashSemilla(conductorId) * 0.45
    for (let d = 12; d <= 50; d++) {
      const dia = new Date(); dia.setHours(12, 0, 0, 0); dia.setDate(dia.getDate() - d)
      const fecha = hoyISO(dia)
      const base = { vehiculoId: veh.id, conductorId, fecha, ubicacion: veh.ubicacionTexto }
      const hora = (n) => { const t = new Date(dia); t.setHours(6 + Math.floor(n * 3), Math.floor(n * 59)); return t.toISOString() }
      if (hashSemilla(conductorId + fecha) < constancia) {
        const r = hashSemilla(fecha + conductorId)
        const resultado = r > 0.93 ? 'bloqueada' : r > 0.75 ? 'aprobada_con_observaciones' : 'aprobada'
        lista.push({
          ...base, id: `insp-h-${conductorId}-${fecha}`, clase: 'daily', resultado, creadaEn: hora(r),
          observaciones: resultado === 'aprobada' ? 0 : 1 + Math.floor(r * 10) % 3,
          fallasCriticas: resultado === 'bloqueada' ? 1 : 0,
        })
      }
      if (hashSemilla(conductorId + fecha + 'programada') < 0.07) {
        lista.push({
          ...base, id: `insp-p-${conductorId}-${fecha}`, clase: 'scheduled', resultado: 'aprobada',
          creadaEn: hora(0.9), observaciones: 0, fallasCriticas: 0,
        })
      }
    }
  }
  historialCache = { hoy, lista }
  return lista
}

// Plantillas de inspección: cada empresa tiene las suyas (la del admin FOM
// es la empresa en la que entró).
const empresaDePlantillas = () => empresaGestionActualId() || EMPRESA.id
function plantillasDeLaEmpresa() {
  const empresaId = empresaDePlantillas()
  return agregados('plantillasInspeccion')
    .map((t) => aplicar('plantillasInspeccion', t))
    .filter((t) => t.empresaId === empresaId)
}
function conflicto(mensaje) {
  const error = new Error(mensaje)
  error.estado = 409
  return error
}
/** Crea el borrador con las mismas reglas del servidor; devuelve el id. */
function crearPlantillaSemilla(datos) {
  const cuerpo = cuerpoPlantilla(datos)
  if (plantillasDeLaEmpresa().some((t) => t.codigo === cuerpo.code && t.version === cuerpo.version)) {
    throw conflicto('Ya existe uno igual.')
  }
  const id = `pla-n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  agregar('plantillasInspeccion', {
    id, empresaId: empresaDePlantillas(), codigo: cuerpo.code, version: cuerpo.version, nombre: cuerpo.name,
    descripcion: cuerpo.description ?? null, estado: 'borrador', items: cuerpo.items, dias: normalizarDias(cuerpo.weekdays), creadaEn: new Date().toISOString(),
  })
  return id
}
const TRANSICIONES_PLANTILLA = { borrador: ['publicada', 'archivada'], publicada: ['archivada'], archivada: [] }
function moverPlantillaSemilla(id, esperado, destino) {
  const t = plantillasDeLaEmpresa().find((x) => x.id === id)
  if (!t) throw new Error('Ese elemento ya no existe.')
  if (t.estado !== esperado) throw conflicto('Alguien más cambió esto mientras lo mirabas. Recarga y vuelve a intentarlo.')
  if (!TRANSICIONES_PLANTILLA[esperado]?.includes(destino)) throw conflicto('Ese cambio de estado no está permitido.')
  // Como la base: una sola versión publicada por código.
  if (destino === 'publicada' && plantillasDeLaEmpresa().some((x) => x.codigo === t.codigo && x.estado === 'publicada')) {
    throw conflicto('Ya hay otra versión de esta plantilla publicada en esta empresa. Archívala antes de publicar esta.')
  }
  guardarParche('plantillasInspeccion', id, { estado: destino })
}
/** Cambia los días en que toca la planilla (borrador o publicada; la archivada no). */
function cambiarDiasSemilla(id, dias) {
  const t = plantillasDeLaEmpresa().find((x) => x.id === id)
  if (!t) throw new Error('Ese elemento ya no existe.')
  if (t.estado === 'archivada') throw conflicto('Una plantilla archivada ya no puede cambiar sus días.')
  const nuevos = diasParaEnviar(dias)
  guardarParche('plantillasInspeccion', id, { dias: nuevos })
  return nuevos
}
function todasEmpresas() {
  return [...EMPRESAS, ...agregados('empresas')]
    .map((e) => aplicar('empresas', e))
    .filter((e) => !e.eliminada)
}
function todosPagos() {
  return [...PAGOS, ...agregados('pagos')].map((p) => aplicar('pagos', p))
}
// --- Inventario GPS de la demostración (T-95) -------------------------------
// Todo equipo vive en UNA lista —los libres de la semilla, dos Coban GPS-403 de
// la gaveta y los montados en cada unidad— y su `vehiculoId` dice dónde está.
// Instalar o desmontar solo cambia ese campo, así la ficha de la unidad y el
// inventario cuentan siempre lo mismo. Tres unidades salen sin GPS para que
// «Instalar en una unidad» se pueda recorrer.
const UNIDADES_SIN_GPS_DEMO = new Set(['veh-012', 'veh-015', 'veh-021'])
const MIN = 60_000
const GPS_GAVETA_DEMO = [
  {
    id: 'gps-201', fabricante: 'Coban', modelo: 'GPS-403', protocolo: 'coban-gps103', transport: 'tcp',
    imei: '868166051449120', linea: '0414-9017745', simPhone: '0414-9017745', carrier: 'Movistar',
    apn: 'internet.movistar.ve', iccid: '8958040119045539120', simStatus: 'active',
    estado: 'inventory', ubicacion: 'Gaveta 2 · Maracaibo', empresaId: null,
    verificado: true, pinSupport: false, panicoProbado: false,
    ultimaConexion: new Date(Date.now() - 6 * 24 * 60 * MIN).toISOString(),
  },
  {
    id: 'gps-202', fabricante: 'Coban', modelo: 'GPS-403', protocolo: 'coban-gps103', transport: 'tcp',
    imei: '868166051443907', linea: null, estado: 'inventory', ubicacion: 'Gaveta 2 · Maracaibo', empresaId: null,
    verificado: false, pinSupport: false, panicoProbado: false, ultimaConexion: null,
  },
]
/** El operador sale del prefijo de la línea venezolana. */
function operadorDe(linea) {
  const d = String(linea ?? '').replace(/\D/gu, '').replace(/^58/u, '').replace(/^0/u, '')
  if (/^4(14|24)/u.test(d)) return ['Movistar', 'internet.movistar.ve']
  if (/^412/u.test(d)) return ['Digitel', 'gprsweb.digitel.ve']
  if (/^4(16|26)/u.test(d)) return ['Movilnet', 'int.movilnet.com.ve']
  return [null, null]
}
function equipoDeSemilla(g, extra = {}) {
  const [carrier, apn] = operadorDe(g.linea)
  const coban = /coban/iu.test(g.modelo ?? '')
  return {
    fabricante: null, protocolo: coban ? 'coban-gps103' : null, transport: 'tcp',
    simPhone: g.linea ?? null, carrier, apn, simStatus: g.linea ? 'active' : null,
    estado: 'inventory', ubicacion: null, ultimaConexion: null,
    ...g,
    ...extra,
  }
}
function inventarioGps() {
  const libres = GPS_LIBRES.map((g) => equipoDeSemilla(g, {
    ubicacion: 'Oficina FOM · Maracaibo',
    ultimaConexion: g.verificado ? new Date(Date.now() - 2 * 24 * 60 * MIN).toISOString() : null,
  }))
  const montados = VEHICULOS
    .filter((v) => v.gps && !UNIDADES_SIN_GPS_DEMO.has(v.id))
    .map((v) => equipoDeSemilla(v.gps, {
      vehiculoId: v.id,
      vehiculoNombre: `${v.alias} · ${v.placa}`,
      empresaId: v.empresaId ?? EMPRESA.id,
      estado: 'active',
      // La misma última señal que la ficha de la unidad: el inventario y la flota no se contradicen.
      ultimaConexion: reporteAlDia(v).ultimoReporte ?? null,
      instalacionId: `ins-${v.gps.id}`,
      instaladoEn: v.creadoEn ?? null,
      ubicacionInstalacion: 'Bajo el tablero',
    }))
  return [...libres, ...GPS_GAVETA_DEMO, ...montados, ...agregados('gps').map((g) => equipoDeSemilla(g))]
    .map((g) => aplicar('gps', g))
}
function todosGps() {
  return inventarioGps()
}
/** La unidad con el equipo que de verdad lleva hoy (o `null` si va sin GPS). */
function conGpsAlDia(vehiculos) {
  const porUnidad = new Map(inventarioGps().filter((g) => g.vehiculoId).map((g) => [g.vehiculoId, g]))
  return vehiculos.map((v) => {
    const g = porUnidad.get(v.id) ?? null
    if (!g) return v.gps ? { ...v, gps: null } : v
    return { ...v, gps: { ...(v.gps ?? {}), ...g } }
  })
}

// Tramas de la demostración: una cada 30 s hacia atrás desde la última señal,
// con un latido cada cuatro y algún hueco de 2 min. Al abrir una prueba sobre
// un equipo callado, la primera trama llega a los 8 s, como en campo.
const PRUEBA_TARDA_MS = 8000
function ultimaSenalDemo(g, ahora = Date.now()) {
  const desde = g.pruebaDesde ? new Date(g.pruebaDesde).getTime() : NaN
  if (Number.isFinite(desde) && ahora - desde >= PRUEBA_TARDA_MS) {
    return ahora - ((ahora - desde - PRUEBA_TARDA_MS) % 30_000)
  }
  const t = g.ultimaConexion ? new Date(g.ultimaConexion).getTime() : NaN
  return Number.isFinite(t) ? t : null
}
function alDiaDemo(g, ahora = Date.now()) {
  const t = ultimaSenalDemo(g, ahora)
  if (!t) return g
  return { ...g, ultimaConexion: new Date(t).toISOString(), conectado: ahora - t < 5 * MIN, verificado: true }
}
/** Huella de ejemplo, estable por trama (FNV-1a encadenado). No es SHA-256: es demostración. */
function huellaDemo(texto) {
  let h = 0x811c9dc5
  let salida = ''
  for (let r = 0; salida.length < 64; r += 1) {
    for (const ch of `${texto}#${r}`) {
      h ^= ch.charCodeAt(0)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    salida += h.toString(16).padStart(8, '0')
  }
  return salida.slice(0, 64)
}
function tramasDemo(g, ahora = Date.now(), limite = 50) {
  const ultima = ultimaSenalDemo(g, ahora)
  if (!ultima) return []
  const pd = g.pruebaDesde ? new Date(g.pruebaDesde).getTime() : NaN
  const desde = Number.isFinite(pd) ? pd + PRUEBA_TARDA_MS : -Infinity
  const salida = []
  let t = ultima
  for (let i = 0; i < limite && t >= desde; i += 1) {
    const latido = i % 4 === 3
    salida.push({
      id: `${g.id}-${t}`,
      recibido: new Date(t).toISOString(),
      via: String(g.transport || 'tcp').toUpperCase(),
      bytes: latido ? 64 : 212,
      diagnostico: `${g.protocolo || 'coban-gps103'} · ${latido ? 'heartbeat' : 'position_valid'}`,
      fresco: ahora - t < 5 * MIN,
      imeiCoincide: true,
      huella: huellaDemo(`${g.imei}-${t}`),
    })
    t -= i % 7 === 6 ? 120_000 : 30_000
  }
  return salida
}
function posicionesDemo(g, tramas) {
  const unidad = g.vehiculoId ? VEHICULOS.find((v) => v.id === g.vehiculoId) : null
  const lat0 = unidad?.lat ?? 10.6427
  const lng0 = unidad?.lng ?? -71.6125
  // Las lecturas «andando» salen del rastro reciente de la unidad: caen sobre su vía, no en el lago.
  const rastro = unidad ? recorridoDetalladoDe(unidad.id, 24).puntos : []
  return tramas
    .filter((m) => m.diagnostico.endsWith('position_valid'))
    .map((m, i) => {
      const anda = i % 5 === 2
      const p = (anda && rastro.at(-1 - i)) || { lat: lat0, lng: lng0 }
      return {
        id: `pos-${m.id}`, recibido: m.recibido, hora: m.recibido,
        lat: p.lat, lng: p.lng, valida: true,
        velocidad: anda ? 12 : 0, rumbo: anda ? 120 : null, encendido: i !== 0,
      }
    })
}
/** Dos IMEI que ya llegan al receptor sin estar registrados (los del diseño). */
function detectadosDemo(ahora = Date.now()) {
  const registrados = new Set(inventarioGps().map((g) => g.imei))
  return [
    { imei: '868166051450012', primeraVez: new Date(ahora - 3 * 60 * MIN).toISOString(), ultimaVez: new Date(ahora - 12_000).toISOString(), mensajes: 38, transporte: 'tcp', reportando: true, bytesUltimo: 212 },
    { imei: '868166051441275', primeraVez: new Date(ahora - 26 * 60 * MIN).toISOString(), ultimaVez: new Date(ahora - 25 * MIN).toISOString(), mensajes: 6, transporte: 'udp', reportando: false, bytesUltimo: 96 },
  ].filter((d) => !registrados.has(d.imei))
}
function todaAuditoria() {
  return [...agregados('auditoria'), ...AUDITORIA]
    .map((a) => aplicar('auditoria', a))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
}
let audSecuencia = 0
/** Deja constancia en la bitácora; toda acción de administración pasa por aquí. */
function auditar(tipo, { actor, empresaId = null, objetivo = '', detalle = '' } = {}) {
  audSecuencia += 1
  agregar('auditoria', {
    id: `aud-n${Date.now().toString(36)}-${audSecuencia}`,
    tipo,
    actorId: actor?.id ?? 'usr-000',
    actorNombre: actor?.nombre ?? 'Administrador FOM',
    empresaId,
    objetivo,
    detalle,
    fecha: new Date().toISOString(),
  })
}
/** Falla igual que la app: mensaje en español listo para mostrar. */
function fallo(mensaje) {
  return Promise.reject(new Error(mensaje))
}

/** Vehículo con conductor, área y estado de documentos ya resueltos. */
function enriquecerVehiculo(v, perfiles, docs) {
  const conductor = perfiles.find((p) => p.id === v.conductorPrincipalId) || null
  const area = AREAS.find((a) => a.id === v.areaId) || null
  const misDocs = docs.filter((d) => d.ambito === 'vehiculo' && d.vehiculoId === v.id)
  const vencidos = misDocs.filter((d) => estadoDocumento(d.venceEn) === 'vencido').length
  const porVencer = misDocs.filter((d) => estadoDocumento(d.venceEn) === 'por_vencer').length
  return {
    ...v,
    conductor,
    conductorNombre: conductor?.nombre ?? 'Sin asignar',
    area,
    areaNombre: area?.nombre ?? 'Sin área',
    docsVencidos: vencidos,
    docsPorVencer: porVencer,
  }
}

// ============================================================
// API
// ============================================================
export const repo = {
  empresa: () => responder(EMPRESA, 40),
  areas: () => responder(AREAS, 40),

  // ---------------- Resumen ejecutivo ----------------
  async resumen() {
    const veh = todosVehiculos()
    const perfiles = perfilesDeLaEmpresa()
    const docs = todosDocumentos()
    const odts = todasOdts()
    const insp = todasInspecciones()
    const hoy = hoyISO()

    const enMarcha = veh.filter((v) => v.estadoMarcha === 'en_marcha').length
    const inspHoy = insp.filter((i) => i.fecha === hoy)
    const bloqueadas = inspHoy.filter((i) => i.resultado === 'bloqueada')
    const docsVencidos = docs.filter((d) => estadoDocumento(d.venceEn) === 'vencido').length
    const docsPorVencer = docs.filter((d) => estadoDocumento(d.venceEn) === 'por_vencer').length
    const abiertas = odts.filter((o) => o.estado === 'abierta')
    const enRevision = odts.filter((o) => o.estado === 'en_revision')
    const cerradas = odts.filter((o) => o.estado === 'cerrada')

    // Promedio del índice de manejo seguro (media simple, como la app)
    const indice = Math.round(veh.reduce((a, v) => a + v.indiceSeguro, 0) / (veh.length || 1))

    // Horas promedio de resolución sobre las ODT cerradas
    const conTiempo = cerradas.filter((o) => o.resueltaEn)
    const horasProm = conTiempo.length
      ? Math.round(
          conTiempo.reduce((a, o) => a + (new Date(o.resueltaEn) - new Date(o.creadaEn)) / 3600000, 0) /
            conTiempo.length
        )
      : 0

    return responder({
      totalVehiculos: veh.length,
      enMarcha,
      detenidos: veh.length - enMarcha,
      conductores: perfiles.filter((p) => p.conduce).length,
      odtAbiertas: abiertas.length,
      odtEnRevision: enRevision.length,
      odtCerradas: cerradas.length,
      costoCerradas: cerradas.reduce((a, o) => a + (o.costo ?? 0), 0),
      horasPromedioResolucion: horasProm,
      inspeccionesHoy: inspHoy.length,
      inspeccionesPendientes: Math.max(0, veh.length - inspHoy.length),
      unidadesBloqueadas: bloqueadas.length,
      docsVencidos,
      docsPorVencer,
      indiceSeguroPromedio: indice,
      alertasSinLeer: todasNotificaciones().filter((n) => !n.leida).length,
      sinConductor: veh.filter((v) => !v.conductorPrincipalId).length,
      porArea: AREAS.map((a) => ({
        ...a,
        total: veh.filter((v) => v.areaId === a.id).length,
        enMarcha: veh.filter((v) => v.areaId === a.id && v.estadoMarcha === 'en_marcha').length,
      })).filter((a) => a.total > 0),
    })
  },

  // ---------------- Vehículos ----------------
  vehiculos: {
    async usuariosAsignados(id) {
      const v = todosVehiculos().find(x => x.id === id)
      const p = todosPerfiles().find(x => x.id === v?.conductorPrincipalId)
      return responder(p ? [{ id: p.id, nombre: p.nombre, rol: 'principal', desde: null }] : [])
    },
    async listar({ q = '', areaId = '', estado = '' } = {}) {
      const perfiles = todosPerfiles()
      const docs = todosDocumentos()
      let lista = todosVehiculos().map((v) => enriquecerVehiculo(v, perfiles, docs))
      if (areaId) lista = lista.filter((v) => v.areaId === areaId)
      if (estado) lista = lista.filter((v) => v.estadoMarcha === estado)
      if (q) {
        const t = q.toLowerCase()
        lista = lista.filter((v) =>
          [v.placa, v.alias, v.numero, v.marca, v.modelo, v.conductorNombre]
            .join(' ')
            .toLowerCase()
            .includes(t)
        )
      }
      return responder(lista.sort((a, b) => a.alias.localeCompare(b.alias)))
    },

    async obtener(id) {
      const perfiles = todosPerfiles()
      const docs = todosDocumentos()
      const v = todosVehiculos().find((x) => x.id === id)
      if (!v) return responder(null)
      const completo = enriquecerVehiculo(v, perfiles, docs)
      return responder({
        ...completo,
        documentos: docs
          .filter((d) => d.ambito === 'vehiculo' && d.vehiculoId === id)
          .map((d) => ({ ...d, estado: estadoDocumento(d.venceEn) }))
          .sort((a, b) => new Date(a.venceEn) - new Date(b.venceEn)),
        odts: todasOdts().filter((o) => o.vehiculoId === id),
        inspecciones: todasInspecciones()
          .filter((i) => i.vehiculoId === id)
          .sort((a, b) => new Date(b.creadaEn) - new Date(a.creadaEn)),
        eventos: EVENTOS.filter((e) => e.vehiculoId === id),
        costos: COSTOS.filter((c) => c.vehiculoId === id),
        recorrido: recorridoDe(id),
      })
    },

    async actualizar(id, patch) {
      guardarParche('vehiculos', id, patch)
      return responder(true, 200)
    },

    /** Asigna el conductor principal (equivale a asignarConductorPrincipal). */
    async asignarConductor(id, userId) {
      guardarParche('vehiculos', id, { conductorPrincipalId: userId || null })
      return responder(true, 200)
    },

    async asignarArea(id, areaId) {
      guardarParche('vehiculos', id, { areaId: areaId || null })
      return responder(true, 200)
    },

    /**
     * Demostración de alta independiente, con GPS opcional (#767).
     */
    async crear({ alias, placa, marca, modelo, anio, tipo = 'camioneta', gpsId, areaId = null, numero }, actor) {
      if (actor?.rol !== 'admin') return fallo('Solo el Administrador FOM puede crear vehículos.')
      const placaN = String(placa || '').toUpperCase().replace(/\s+/g, '')
      if (!placaN && !alias?.trim() && !numero?.trim()) return fallo('Indica una placa, un alias o un número interno.')
      if (placaN && todosVehiculos().some((v) => (v.placa || '').toUpperCase().replace(/\s+/g, '') === placaN))
        return fallo('Ya existe un vehículo con esa placa.')
      const gps = todosGps().find((g) => g.id === gpsId)
      if (gpsId && !gps) return fallo('Selecciona un GPS del inventario.')
      if (gps && (gps.estado !== 'inventory' || gps.vehiculoId)) return fallo('Ese GPS no está disponible en inventario.')

      const n = todosVehiculos().length + 1
      const id = `veh-n${Date.now().toString(36)}`
      const area = AREAS.find((a) => a.id === areaId) || AREAS[0]
      const fila = {
        id,
        empresaId: EMPRESA.id,
        marca: marca || 'Toyota',
        modelo: modelo || 'Hilux',
        anio: Number(anio) || new Date().getFullYear(),
        placa: placaN,
        numero: numero?.trim() || `U-${String(n).padStart(3, '0')}`,
        alias: alias?.trim() || `Unidad ${String(n).padStart(2, '0')}`,
        tipo,
        gps: gps ? { id: gps.id, modelo: gps.modelo, imei: gps.imei, linea: gps.linea, verificado: gps.verificado, pinSupport: gps.pinSupport, panicoProbado: gps.panicoProbado } : null,
        areaId: area.id,
        conductorPrincipalId: null,
        estadoMarcha: null,
        velocidadKmh: null,
        km: 0,
        lat: null,
        lng: null,
        indiceSeguro: 100,
        aceitePct: 100,
        tempMotorC: 0,
        ubicacionTexto: 'Patio principal',
        ultimoReporte: null,
        creadoEn: new Date().toISOString(),
      }
      agregar('vehiculos', fila)
      if (gps) guardarParche('gps', gps.id, { vehiculoId: id, empresaId: EMPRESA.id, estado: 'active' })
      auditar('crear_vehiculo', {
        actor,
        empresaId: EMPRESA.id,
        objetivo: `${fila.alias} · ${fila.placa}`,
        detalle: gps ? `Alta con GPS ${gps.modelo}, sin certificar funciones` : 'Alta sin GPS',
      })
      return responder({ ...fila, pendientes: [] }, 300)
    },
  },

  // ---------------- Personal ----------------
  personal: {
    async listar({ q = '', soloConductores = false } = {}) {
      const veh = todosVehiculos()
      let lista = perfilesDeLaEmpresa().map((p) => {
        const unidad = veh.find((v) => v.conductorPrincipalId === p.id) || null
        const misEventos = EVENTOS.filter((e) => e.conductorId === p.id)
        return {
          ...p,
          unidad,
          unidadNombre: unidad ? `${unidad.alias} · ${unidad.placa}` : 'Sin unidad',
          indiceSeguro: unidad?.indiceSeguro ?? null,
          eventos: misEventos.length,
          licenciaEstado: p.licenciaVence ? estadoDocumento(p.licenciaVence) : null,
          medicaEstado: p.cartaMedicaVence ? estadoDocumento(p.cartaMedicaVence) : null,
        }
      })
      if (soloConductores) lista = lista.filter((p) => p.conduce)
      if (q) {
        const t = q.toLowerCase()
        lista = lista.filter((p) => [p.nombre, p.cedula, p.email].join(' ').toLowerCase().includes(t))
      }
      return responder(lista.sort((a, b) => a.nombre.localeCompare(b.nombre)))
    },

    async obtener(id) {
      const p = todosPerfiles().find((x) => x.id === id)
      if (!p) return responder(null)
      const veh = todosVehiculos()
      const unidad = veh.find((v) => v.conductorPrincipalId === id) || null
      const misEventos = EVENTOS.filter((e) => e.conductorId === id)
      const misInsp = todasInspecciones()
        .filter((i) => i.conductorId === id)
        .sort((a, b) => new Date(b.creadaEn) - new Date(a.creadaEn))
      return responder({
        ...p,
        // Como la fila de Usuarios: las acciones de la cuenta en el perfil del teléfono usan esta ficha.
        empresaNombre: todasEmpresas().find((e) => e.id === p.empresaId)?.nombre ?? '—',
        esDesempleado: p.empresaId === DESEMPLEADOS_ID,
        unidad,
        eventos: misEventos,
        inspecciones: misInsp,
        odts: todasOdts().filter((o) => o.creadorId === id),
        documentos: todosDocumentos()
          .filter((d) => d.ambito === 'persona' && d.userId === id)
          .map((d) => ({ ...d, estado: estadoDocumento(d.venceEn) })),
        indiceSeguro: unidad?.indiceSeguro ?? null,
        // El mismo score de 7 días que el ranking y «Mi perfil» (como `repoApi.personal.obtener`):
        // sin él, la ficha que mira el supervisor dejaba frenadas, excesos y km en «—».
        manejo: unidad ? scoreDemo(unidad, p, 7) : null,
        indiceFuente: 'conductor',
      })
    },

    async actualizar(id, patch) {
      guardarParche('perfiles', id, patch)
      return responder(true, 200)
    },
    async actualizarPerfil(id, { cedula, telefono, direccion, nacimiento }) {
      const persona = todosPerfiles().find(p => p.id === id)
      if (!persona) throw new Error('No conseguimos a esta persona.')
      const cambios = Object.fromEntries(Object.entries({ cedula, telefono, direccion, fechaNacimiento: nacimiento }).filter(([, valor]) => valor !== undefined))
      const actual = { ...persona, ...cambios }
      guardarParche('perfiles', id, { ...cambios, perfilCompleto: Boolean(actual.cedula && actual.telefono && actual.direccion && actual.fechaNacimiento) })
      return responder(true, 200)
    },
  },

  // ---------------- Órdenes de trabajo ----------------
  odts: {
    async listar({ estado = '', tipo = '', q = '' } = {}) {
      const veh = todosVehiculos()
      const perfiles = todosPerfiles()
      let lista = todasOdts().map((o) => {
        const v = veh.find((x) => x.id === o.vehiculoId)
        const creador = perfiles.find((p) => p.id === o.creadorId)
        return {
          ...o,
          vehiculo: v,
          vehiculoNombre: v ? `${v.alias} · ${v.placa}` : '—',
          creadorNombre: o.creadorId ? (creador?.nombre ?? '—') : 'Sistema',
        }
      })
      if (estado) lista = lista.filter((o) => o.estado === estado)
      if (tipo) lista = lista.filter((o) => o.tipo === tipo)
      if (q) {
        const t = q.toLowerCase()
        lista = lista.filter((o) =>
          [o.descripcion, o.vehiculoNombre, o.creadorNombre, o.tipoFalla].join(' ').toLowerCase().includes(t)
        )
      }
      return responder(lista)
    },

    async obtener(id) {
      const lista = await this.listar()
      return lista.find((o) => o.id === id) ?? null
    },

    /** Crea una ODT correctiva, como crearOrdenDeTrabajo de la app. */
    async crear({ vehiculoId, descripcion, tipoFalla, ubicacion, creadorId }) {
      const id = `odt-n${Date.now().toString(36)}`
      const veh = todosVehiculos().find((v) => v.id === vehiculoId)
      agregar('odts', {
        id,
        empresaId: EMPRESA.id,
        vehiculoId,
        creadorId: creadorId ?? null,
        autorVia: 'principal',
        tipo: 'correctiva',
        estado: 'abierta',
        descripcion,
        tipoFalla: tipoFalla || null,
        ubicacion: ubicacion || veh?.ubicacionTexto || '',
        evidenciaUrls: [],
        notaSolucion: null,
        costo: null,
        resueltaEn: null,
        reglaId: null,
        creadaEn: new Date().toISOString(),
      })
      // El trigger de la base crea la notificación; aquí se replica.
      agregar('notificaciones', {
        id: `not-n${Date.now().toString(36)}`,
        empresaId: EMPRESA.id,
        tipo: 'odt_nueva',
        titulo: `Nueva ODT — Vehículo ${veh?.alias ?? ''} (${veh?.placa ?? ''})`,
        detalle: descripcion,
        odtId: id,
        leida: false,
        creadaEn: new Date().toISOString(),
      })
      return responder(id, 260)
    },

    /**
     * Cambia el estado. Al cerrar guarda nota y costo y sella resueltaEn;
     * al reabrir lo limpia (mismo comportamiento del trigger V3).
     */
    async cambiarEstado(id, estado, extras = {}) {
      const patch = { estado }
      if (estado === 'cerrada') {
        patch.resueltaEn = new Date().toISOString()
        if (extras.notaSolucion !== undefined) patch.notaSolucion = extras.notaSolucion
        if (extras.costo !== undefined) patch.costo = extras.costo
      } else {
        patch.resueltaEn = null
      }
      guardarParche('odts', id, patch)
      return responder(true, 220)
    },
  },

  // ---------------- Inspecciones ----------------
  inspecciones: {
    itemsPlantilla: (tipo = 'otro') =>
      ITEMS_INSPECCION.filter((i) => i.tipos.length === 0 || i.tipos.includes(tipo)),

    async listar({ fecha = '', resultado = '', q = '', desde = '', hasta = '' } = {}) {
      const veh = todosVehiculos()
      const perfiles = todosPerfiles()
      let lista = todasInspecciones().map((i) => {
        const v = veh.find((x) => x.id === i.vehiculoId)
        const c = perfiles.find((p) => p.id === i.conductorId)
        return {
          ...i,
          vehiculo: v,
          vehiculoNombre: v ? `${v.alias} · ${v.placa}` : '—',
          conductorNombre: c?.nombre ?? '—',
          tipoVehiculo: v?.tipo ?? 'otro',
        }
      })
      if (fecha) lista = lista.filter((i) => i.fecha === fecha)
      if (desde) lista = lista.filter((i) => i.fecha >= desde)
      if (hasta) lista = lista.filter((i) => i.fecha <= hasta)
      if (resultado) lista = lista.filter((i) => i.resultado === resultado)
      if (q) {
        const t = q.toLowerCase()
        lista = lista.filter((i) => [i.vehiculoNombre, i.conductorNombre].join(' ').toLowerCase().includes(t))
      }
      return responder(lista.sort((a, b) => new Date(b.creadaEn) - new Date(a.creadaEn)))
    },

    /** Unidades sin inspección de hoy: lo que el supervisor debe perseguir. */
    async pendientesHoy() {
      const hoy = hoyISO()
      const hechas = new Set(todasInspecciones().filter((i) => i.fecha === hoy).map((i) => i.vehiculoId))
      const perfiles = todosPerfiles()
      const docs = todosDocumentos()
      return responder(
        todosVehiculos()
          .filter((v) => !hechas.has(v.id))
          .map((v) => enriquecerVehiculo(v, perfiles, docs))
      )
    },
  },

  // ---------------- Plantillas de inspección ----------------
  // Misma forma que repoApi.programaInspecciones (solo plantillas), para
  // probar crear y publicar formatos sin servidor.
  programaInspecciones: {
    plantillas: ({ estado = '' } = {}) =>
      responder(() => plantillasDeLaEmpresa()
        .filter((t) => !estado || t.estado === estado)
        .map(({ id, codigo, version, nombre, estado: e, items, dias }) => ({ id, codigo, version, nombre, estado: e, puntos: items.length, dias: normalizarDias(dias), soportaDias: true }))),
    async crearPlantilla(datos) {
      return responder({ id: crearPlantillaSemilla(datos) }, 200)
    },
    async cambiarPlantilla(plantilla, estado) {
      moverPlantillaSemilla(plantilla.id, plantilla.estado, estado)
      return responder(true, 200)
    },
    async cambiarDias(plantilla, dias) {
      return responder({ dias: cambiarDiasSemilla(plantilla.id, dias) }, 200)
    },
    async publicarFormato(formato) {
      const igual = () => plantillasDeLaEmpresa().find((t) => t.codigo === formato.code && Number(t.version) === Number(formato.version))
      const existente = igual()
      const actual = existente
        ? { id: existente.id, estado: existente.estado }
        : { id: crearPlantillaSemilla(argumentosDeFormato(formato)), estado: 'borrador' }
      const r = await publicarSiHaceFalta(actual, !existente, async (id, { expectedStatus, status }) => moverPlantillaSemilla(id, expectedStatus, status))
      return responder(r, 300)
    },
  },

  // ---------------- Documentos ----------------
  documentos: {
    async listar({ ambito = '', estado = '', q = '' } = {}) {
      const veh = todosVehiculos()
      const perfiles = todosPerfiles()
      let lista = todosDocumentos().map((d) => {
        const v = d.vehiculoId ? veh.find((x) => x.id === d.vehiculoId) : null
        const p = d.userId ? perfiles.find((x) => x.id === d.userId) : null
        return {
          ...d,
          estado: estadoDocumento(d.venceEn),
          titular: v ? `${v.alias} · ${v.placa}` : (p?.nombre ?? '—'),
          titularId: v?.id ?? p?.id ?? null,
        }
      })
      if (ambito) lista = lista.filter((d) => d.ambito === ambito)
      if (estado) lista = lista.filter((d) => d.estado === estado)
      if (q) {
        const t = q.toLowerCase()
        lista = lista.filter((d) => [d.tipo, d.titular].join(' ').toLowerCase().includes(t))
      }
      const orden = { vencido: 0, por_vencer: 1, vigente: 2 }
      return responder(
        lista.sort(
          (a, b) => orden[a.estado] - orden[b.estado] || new Date(a.venceEn) - new Date(b.venceEn)
        )
      )
    },

    async actualizarVencimiento(id, venceEn) {
      guardarParche('documentos', id, { venceEn })
      return responder(true, 200)
    },
  },

  // ---------------- Alertas y notificaciones ----------------
  alertas: {
    async listar({ soloSinLeer = false } = {}) {
      let lista = todasNotificaciones()
      if (soloSinLeer) lista = lista.filter((n) => !n.leida)
      return responder(lista)
    },
    async marcarLeida(id) {
      guardarParche('notificaciones', id, { leida: true })
      return responder(true, 100)
    },
    async marcarTodasLeidas() {
      todasNotificaciones().forEach((n) => {
        if (!n.leida) guardarParche('notificaciones', n.id, { leida: true })
      })
      return responder(true, 150)
    },
    /** Descartar saca el aviso de la bandeja; misma respuesta que repoApi. */
    async descartar(id) {
      guardarParche('notificaciones', id, { descartada: true })
      return responder(true, 100)
    },
    async descartarLeidos() {
      const leidas = todasNotificaciones().filter((n) => n.leida)
      leidas.forEach((n) => guardarParche('notificaciones', n.id, { descartada: true }))
      return responder({ descartados: leidas.length }, 150)
    },
    /** Eventos de manejo detectados (base del índice seguro). */
    async eventos({ dias = 28 } = {}) {
      const veh = todosVehiculos()
      const perfiles = todosPerfiles()
      const corte = Date.now() - dias * 86400000
      return responder(
        EVENTOS.filter((e) => new Date(e.creadaEn).getTime() >= corte).map((e) => ({
          ...e,
          vehiculo: veh.find((v) => v.id === e.vehiculoId) ?? null,
          conductorNombre: perfiles.find((p) => p.id === e.conductorId)?.nombre ?? '—',
        }))
      )
    },
  },

  // ---------------- Reglas de alerta ----------------
  reglas: {
    listar: () => responder(REGLAS),
  },

  // ---------------- Costos y reportes ----------------
  costos: {
    async resumen({ dias = 30 } = {}) {
      const desde = new Date(Date.now() - dias * 86400000)
      const lista = COSTOS.filter((c) => new Date(`${c.fecha}T00:00:00`) >= desde)
      const total = lista.reduce((a, c) => a + c.monto, 0)
      const porCategoria = {}
      lista.forEach((c) => {
        porCategoria[c.categoria] = (porCategoria[c.categoria] || 0) + c.monto
      })
      const veh = todosVehiculos()
      const kmTotal = veh.reduce((a, v) => a + v.km, 0)
      return responder({
        total,
        dias,
        porCategoria: Object.entries(porCategoria)
          .map(([categoria, monto]) => ({ categoria, monto }))
          .sort((a, b) => b.monto - a.monto),
        costoPorKm: kmTotal ? total / kmTotal : 0,
        movimientos: lista.length,
      })
    },
  },

  /** Serie de posiciones del día para dibujar el recorrido. */
  recorrido: (vehiculoId) => responder(recorridoDe(vehiculoId), 80),
  /**
   * Score de manejo de ejemplo, con la misma forma de `repoApi.manejo` (en la base real lo calcula
   * el servidor). Sale de los eventos de ejemplo de cada unidad y de sus km del período.
   */
  manejo: {
    /** El de la persona en sesión (o `userId`); `null` si no tiene unidad, como el servidor sin recorridos. */
    miScore: ({ dias = 7, userId } = {}) => responder(() => {
      const id = userId ?? perfilActual()?.id
      const v = id ? todosVehiculos().find((x) => x.conductorPrincipalId === id) : null
      const persona = v ? todosPerfiles().find((p) => p.id === id) : null
      return persona ? scoreDemo(v, persona, dias) : null
    }, 60),
    /** Los conductores con unidad, del mejor índice al peor. */
    ranking: ({ dias = 7 } = {}) => responder(() => {
      const perfiles = perfilesDeLaEmpresa()
      return todosVehiculos()
        .map((v) => [v, perfiles.find((p) => p.id === v.conductorPrincipalId)])
        // Una fila por persona aunque un cambio local le haya dejado dos unidades.
        .filter(([, p], i, filas) => p && filas.findIndex(([, q]) => q?.id === p.id) === i)
        .map(([v, p]) => scoreDemo(v, p, dias))
        .sort((a, b) => (b.indice ?? -1) - (a.indice ?? -1) || (a.eventosPor100 ?? 0) - (b.eventosPor100 ?? 0))
    }, 60),
    /**
     * Eventos de ejemplo para ver el mapa de frenadas, aceleraciones y excesos en demo: los de la
     * unidad de la persona, sobre su recorrido. Misma forma que `repoApi.manejo.eventos`.
     */
    eventos: ({ userId, dias = 7 } = {}) => {
      const v = todosVehiculos().find((x) => x.conductorPrincipalId === userId)
      const corte = Date.now() - dias * 86400000
      return responder(v ? eventosDeUnidad(v).filter((e) => Date.parse(e.hora) >= corte) : [], 120)
    },
  },

  /** Asignaciones vigentes: quién maneja qué unidad (misma forma que la base real). */
  conductores: () => responder(
    todosVehiculos()
      .filter((v) => v.conductorPrincipalId)
      .map((v) => {
        const p = todosPerfiles().find((x) => x.id === v.conductorPrincipalId)
        return { id: v.conductorPrincipalId, nombre: p?.nombre ?? '', rol: 'conductor', vehiculoId: v.id, vehiculo: v.placa, desde: v.creadoEn ?? null }
      }),
    80,
  ),
  recorridoDetallado: (vehiculoId, { horas = 24 } = {}) => responder(recorridoDetalladoDe(vehiculoId, horas), 120),
  colaReciente: (vehiculoId) => responder(recorridoDetalladoDe(vehiculoId, 24).puntos.slice(-60), 60),

  // ============================================================
  // ADMINISTRACIÓN FOM — espejo de las Edge Functions de la app.
  // Solo el rol `admin` llega aquí; la consola además esconde estas
  // rutas para cualquier otro rol.
  // ============================================================
  admin: {
    // ---------------- Empresas (empresas) ----------------
    empresas: {
      async listar({ q = '', tipo = '' } = {}) {
        const perfiles = todosPerfiles()
        const pagos = todosPagos()
        const veh = todosVehiculos()
        let lista = todasEmpresas().map((e) => {
          const gente = perfiles.filter((p) => p.empresaId === e.id)
          const deuda = pagos.filter((p) => p.empresaId === e.id && p.estado !== 'pagado')
          return {
            ...e,
            tipoEtiqueta: ETIQUETA.company_tipo[e.tipo] ?? e.tipo,
            usuarios: gente.length,
            conductores: gente.filter((p) => p.conduce).length,
            vehiculos: veh.filter((v) => (v.empresaId ?? EMPRESA.id) === e.id).length,
            pagosPendientes: deuda.length,
            deuda: deuda.reduce((a, p) => a + p.monto, 0),
          }
        })
        if (tipo) lista = lista.filter((e) => e.tipo === tipo)
        if (q) {
          const t = q.toLowerCase()
          lista = lista.filter((e) => [e.nombre, e.rif, e.contacto, e.email].join(' ').toLowerCase().includes(t))
        }
        // El empresa de respaldo siempre al final, como en la app.
        return responder(lista.sort((a, b) => (a.respaldo ? 1 : 0) - (b.respaldo ? 1 : 0) || a.nombre.localeCompare(b.nombre)))
      },

      async obtener(id) {
        const lista = await this.listar()
        const e = lista.find((x) => x.id === id)
        if (!e) return responder(null)
        return responder({
          ...e,
          personal: todosPerfiles()
            .filter((p) => p.empresaId === id)
            .map((p) => ({ ...p, rolEtiqueta: etiquetaRol(p.rol, e.tipo) })),
          pagos: todosPagos().filter((p) => p.empresaId === id),
          gps: todosGps().filter((g) => g.empresaId === id),
        })
      },

      async crear({ nombre, tipo = 'estandar', rif = '', contacto = '', telefono = '', email = '', predefinidas = [] }, actor) {
        if (!nombre?.trim()) return fallo('El nombre del empresa es obligatorio.')
        const slug = nombre.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
        if (todasEmpresas().some((e) => e.slug === slug)) return fallo('Ya existe un empresa con ese nombre.')
        const fila = {
          id: slug, slug, nombre: nombre.trim(), tipo, rif, contacto, telefono, email,
          servicioActivo: true,
          // Solo una contratista trabaja PARA compañías; los demás tipos no llevan lista.
          predefinidas: tipo === 'estandar' ? predefinidas : [],
        }
        agregar('empresas', fila)
        auditar('crear_empresa', { actor, empresaId: slug, objetivo: fila.nombre, detalle: `Alta de ${ETIQUETA.company_tipo[tipo] ?? tipo}` })
        return responder(fila, 280)
      },

      async actualizar(id, patch, actor) {
        const e = todasEmpresas().find((x) => x.id === id)
        if (!e) return fallo('Ese empresa no existe.')
        if (e.respaldo) return fallo('El empresa de respaldo no se edita: es del sistema.')
        guardarParche('empresas', id, patch)
        auditar('editar_empresa', { actor, empresaId: id, objetivo: e.nombre, detalle: 'Datos del empresa actualizados' })
        return responder(true, 220)
      },

      /** Suspende o reactiva el servicio FOM del empresa. */
      async setServicio(id, activo, actor) {
        const e = todasEmpresas().find((x) => x.id === id)
        if (!e) return fallo('Ese empresa no existe.')
        if (e.respaldo) return fallo('El empresa de respaldo no tiene servicio que suspender.')
        guardarParche('empresas', id, { servicioActivo: !!activo })
        auditar('servicio_empresa', {
          actor, empresaId: id, objetivo: e.nombre,
          detalle: activo ? 'Servicio reactivado' : 'Servicio suspendido',
        })
        return responder(true, 240)
      },

      /** Qué compañías (predefinidas) puede ver una contratista. */
      async asignarPredefinidas(id, listaIds, actor) {
        const e = todasEmpresas().find((x) => x.id === id)
        if (!e) return fallo('Ese empresa no existe.')
        if (e.tipo !== 'estandar') return fallo('Solo una contratista trabaja para compañías.')
        guardarParche('empresas', id, { predefinidas: listaIds })
        auditar('editar_empresa', { actor, empresaId: id, objetivo: e.nombre, detalle: `Compañías asignadas: ${listaIds.length}` })
        return responder(true, 220)
      },

      async eliminar(id, actor) {
        const e = todasEmpresas().find((x) => x.id === id)
        if (!e) return fallo('Ese empresa no existe.')
        if (e.respaldo) return fallo('El empresa de respaldo no se puede eliminar.')
        if (todosPerfiles().some((p) => p.empresaId === id))
          return fallo('El empresa aún tiene personal: muévelo o envíalo a Desempleados C.A. primero.')
        guardarParche('empresas', id, { eliminada: true })
        auditar('eliminar_empresa', { actor, empresaId: id, objetivo: e.nombre, detalle: 'Empresa eliminado' })
        return responder(true, 260)
      },
    },

    // ---------------- Pagos del servicio ----------------
    pagos: {
      async listar({ empresaId = '', estado = '' } = {}) {
        const empresas = todasEmpresas()
        let lista = todosPagos().map((p) => ({
          ...p,
          empresa: empresas.find((e) => e.id === p.empresaId) ?? null,
          empresaNombre: empresas.find((e) => e.id === p.empresaId)?.nombre ?? '—',
        }))
        if (empresaId) lista = lista.filter((p) => p.empresaId === empresaId)
        if (estado) lista = lista.filter((p) => p.estado === estado)
        // Lo urgente primero: vencido, pendiente, pagado; dentro, lo más reciente.
        const orden = { vencido: 0, pendiente: 1, pagado: 2 }
        return responder(lista.sort((a, b) => orden[a.estado] - orden[b.estado] || b.periodo.localeCompare(a.periodo)))
      },

      async registrar({ empresaId, monto, moneda = 'USD', periodo, nota = '' }, actor) {
        const e = todasEmpresas().find((x) => x.id === empresaId)
        if (!e) return fallo('Selecciona el empresa del pago.')
        if (!(Number(monto) > 0)) return fallo('El monto debe ser mayor que cero.')
        if (!/^\d{4}-\d{2}$/.test(periodo || '')) return fallo('El período va como AAAA-MM, por ejemplo 2026-08.')
        if (todosPagos().some((p) => p.empresaId === empresaId && p.periodo === periodo))
          return fallo('Ese período ya tiene una cuota registrada para este empresa.')
        const fila = {
          id: `pag-n${Date.now().toString(36)}`,
          empresaId, monto: Number(monto), moneda, periodo,
          estado: 'pendiente', pagadoEn: null, nota,
          creadaEn: new Date().toISOString(),
        }
        agregar('pagos', fila)
        auditar('registrar_pago', { actor, empresaId, objetivo: `${periodo} · ${monto} ${moneda}`, detalle: nota || 'Cuota del servicio' })
        return responder(fila, 280)
      },

      /** Marca pagado / pendiente / vencido; al pagar sella pagadoEn. */
      async actualizarEstado(id, estado, actor) {
        const p = todosPagos().find((x) => x.id === id)
        if (!p) return fallo('Ese pago no existe.')
        guardarParche('pagos', id, { estado, pagadoEn: estado === 'pagado' ? new Date().toISOString() : null })
        auditar('actualizar_pago', {
          actor, empresaId: p.empresaId,
          objetivo: `${p.periodo} · ${p.monto} ${p.moneda}`,
          detalle: `Estado: ${ETIQUETA.pago_estado[estado] ?? estado}`,
        })
        return responder(true, 240)
      },
    },

    // ---------------- Inventario de GPS ----------------
    // Mismas reglas que el servidor: se instala solo lo que está en el
    // inventario, la prueba de señal se abre con el equipo ya instalado y se
    // aprueba solo con una trama del mismo IMEI en los últimos 5 minutos.
    gps: {
      async listar({ q = '' } = {}) {
        const empresas = todasEmpresas()
        const ahora = Date.now()
        let lista = inventarioGps().map((g) => ({
          ...alDiaDemo(g, ahora),
          empresaNombre: g.empresaId ? (empresas.find((e) => e.id === g.empresaId)?.nombre ?? '—') : 'Sin asociar',
        }))
        if (q) {
          const t = q.toLowerCase()
          lista = lista.filter((g) => [g.modelo, g.imei, g.linea, g.empresaNombre, g.vehiculoNombre].join(' ').toLowerCase().includes(t))
        }
        return responder(lista)
      },

      async obtener(id) {
        const g = inventarioGps().find((x) => x.id === id)
        if (!g) return fallo('Ese GPS no está en el inventario.')
        const empresa = todasEmpresas().find((e) => e.id === g.empresaId)
        return responder({ ...alDiaDemo(g), empresaNombre: empresa?.nombre ?? '—' })
      },

      /** Inventario libre; la recepción no es requisito de instalación. */
      async disponibles() {
        return responder(todosGps().filter((g) => g.estado === 'inventory' && !g.vehiculoId))
      },

      async registrar({ modelo, imei, linea = '', fabricante, protocolo, serie, ...metadata }, actor) {
        if (!modelo?.trim()) return fallo('Indica el modelo del equipo.')
        const imeiN = String(imei || '').replace(/\D/g, '')
        if (!/^\d{15}$/.test(imeiN)) return fallo('El IMEI debe tener exactamente 15 dígitos.')
        if (todosGps().some((g) => g.imei === imeiN)) return fallo('Ya hay un GPS registrado con ese IMEI.')
        const ahora = Date.now()
        // Si ya transmitía como «detectado», sigue transmitiendo: su señal no se corta al registrarlo.
        const detectado = detectadosDemo(ahora).find((d) => d.imei === imeiN && d.reportando)
        const fila = {
          id: `gps-n${ahora.toString(36)}`,
          modelo: modelo.trim(), imei: imeiN,
          fabricante: fabricante || null, protocolo: protocolo || null, serie: serie || null,
          linea: linea || metadata.simPhone || null,
          simPhone: linea || metadata.simPhone || null,
          iccid: metadata.iccid || null, carrier: metadata.carrier || null, apn: metadata.apn || null,
          simStatus: metadata.simStatus || null, simPlan: metadata.simPlan || null,
          firmwareVersion: metadata.firmwareVersion || null, transport: metadata.transport || 'tcp',
          estado: 'inventory', ubicacion: null,
          empresaId: null, verificado: false, pinSupport: false, panicoProbado: false,
          ...(detectado ? { pruebaDesde: new Date(ahora - PRUEBA_TARDA_MS).toISOString() } : {}),
        }
        agregar('gps', fila)
        auditar('registrar_gps', { actor, objetivo: `${fila.modelo} · ${imeiN}`, detalle: 'Equipo agregado al inventario' })
        return responder(fila, 280)
      },

      /**
       * Verificación por ping, igual que la app: el PRIMER intento siempre
       * falla (el equipo tarda en despertar); el segundo confirma.
       */
      async verificar(id, actor) {
        const g = todosGps().find((x) => x.id === id)
        if (!g) return fallo('Ese GPS no está en el inventario.')
        if (g.verificado) return responder({ ok: true, mensaje: 'El equipo ya estaba verificado.' }, 300)
        if (!g.intentoVerificacion) {
          guardarParche('gps', id, { intentoVerificacion: true })
          return responder({ ok: false, error: 'El equipo no respondió al primer ping. Suele despertar al segundo intento: vuelve a probar.' }, 900)
        }
        guardarParche('gps', id, { verificado: true })
        auditar('verificar_gps', { actor, empresaId: g.empresaId, objetivo: `${g.modelo} · ${g.imei}`, detalle: 'Equipo verificado por ping' })
        return responder({ ok: true, mensaje: 'GPS verificado: el equipo respondió con posición válida.' }, 900)
      },

      /** Instala el equipo en una unidad (el mismo paso que `POST gps-devices/:id/installation`). */
      async asociar(id, vehiculoId, actor) {
        return repo.admin.gps.instalar(id, { vehiculoId }, actor)
      },

      async instalar(id, { vehiculoId, tecnico = '', ubicacion = '', notas = '' } = {}, actor) {
        const g = todosGps().find((x) => x.id === id)
        if (!g) return fallo('Ese GPS no está en el inventario.')
        if (g.vehiculoId) return fallo('Ese GPS ya está instalado en una unidad. Desmóntalo primero.')
        if (g.estado !== 'inventory') return fallo('Solo se instala un equipo que está en el inventario. Márcalo «En inventario» desde «Datos del equipo» y vuelve a intentarlo.')
        const v = todosVehiculos().find((x) => x.id === vehiculoId)
        if (!v) return fallo('Esa unidad no existe.')
        if (v.gps) return fallo('Esa unidad ya lleva un GPS, o este equipo ya está instalado en otra.')
        guardarParche('gps', id, {
          vehiculoId: v.id, vehiculoNombre: `${v.alias} · ${v.placa}`, empresaId: v.empresaId ?? EMPRESA.id,
          estado: 'active', ubicacion: null,
          instalacionId: `ins-${id}-${Date.now().toString(36)}`, instaladoEn: new Date().toISOString(),
          tecnico: tecnico.trim() || null, ubicacionInstalacion: ubicacion.trim() || null, notasInstalacion: notas.trim() || null,
        })
        auditar('asociar_gps', {
          actor, empresaId: v.empresaId ?? EMPRESA.id,
          objetivo: `${g.modelo} · ${g.imei}`,
          detalle: `Instalado en ${v.alias} · ${v.placa}`,
        })
        return responder(true, 260)
      },

      /** Desmonta: el equipo vuelve al inventario con su historial (`PATCH gps-installations/:id/remove`). */
      async desmontar(instalacionId, notas, ubicacion, actor) {
        const g = todosGps().find((x) => x.instalacionId && x.instalacionId === instalacionId)
        if (!g) return fallo('Esa instalación ya no está abierta.')
        guardarParche('gps', g.id, {
          vehiculoId: null, vehiculoNombre: null, estado: 'inventory', instalacionId: null,
          ubicacion: String(ubicacion ?? '').trim() || null, pruebaDesde: null, sesionPrueba: null,
        })
        auditar('desmontar_gps', { actor, empresaId: g.empresaId, objetivo: `${g.modelo} · ${g.imei}`, detalle: notas ? `Desmontado: ${notas}` : 'Desmontado; vuelve al inventario' })
        return responder(true, 240)
      },

      /** Corrige datos del equipo. El IMEI no se corrige. */
      async set(id, { estado, fabricante, serie, metadatos = {} }) {
        const g = todosGps().find((x) => x.id === id)
        if (!g) return fallo('Ese GPS no está en el inventario.')
        const limpio = Object.fromEntries(Object.entries({ estado, fabricante, serie }).filter(([, v]) => v !== undefined))
        const extra = { ...metadatos }
        if (Object.hasOwn(metadatos, 'simPhone')) extra.linea = metadatos.simPhone
        guardarParche('gps', id, { ...limpio, ...extra })
        return responder(true, 220)
      },

      async telemetria(id, { limite = 50 } = {}) {
        const g = inventarioGps().find((x) => x.id === id)
        if (!g) return fallo('Ese GPS no está en el inventario.')
        const ahora = Date.now()
        const mensajes = tramasDemo(g, ahora, limite)
        return responder({
          conectado: Boolean(mensajes[0]?.fresco),
          imei: g.imei,
          ultimaRecepcion: mensajes[0]?.recibido ?? null,
          frescuraS: 300,
          mensajes,
        }, 200)
      },

      async ultimaPosicion(id) {
        const g = inventarioGps().find((x) => x.id === id)
        if (!g) return fallo('Ese GPS no está en el inventario.')
        return responder(posicionesDemo(g, tramasDemo(g, Date.now(), 10))[0] ?? null)
      },

      async posiciones(id, { limite = 50 } = {}) {
        const g = inventarioGps().find((x) => x.id === id)
        if (!g) return fallo('Ese GPS no está en el inventario.')
        return responder(posicionesDemo(g, tramasDemo(g, Date.now(), limite)))
      },

      async capacidades(id) {
        const g = inventarioGps().find((x) => x.id === id)
        if (!g) return fallo('Ese GPS no está en el inventario.')
        return responder({ panico: g.pinSupport ? true : null, pin: null, encendido: null, verificadasEn: null })
      },

      /** Abre la prueba de señal. Como el servidor: solo con el equipo instalado. */
      async iniciarPrueba(id) {
        const g = inventarioGps().find((x) => x.id === id)
        if (!g) return fallo('Ese GPS no está en el inventario.')
        if (!g.vehiculoId) return fallo('La prueba se registra con el equipo ya instalado en una unidad.')
        const ahora = Date.now()
        const sesionId = `ses-${id}-${ahora.toString(36)}`
        const ultima = ultimaSenalDemo(g, ahora)
        // Si está callado, la demostración «lo enciende»: la primera trama llega a los pocos segundos.
        const callado = !ultima || ahora - ultima >= 5 * MIN
        guardarParche('gps', id, { sesionPrueba: sesionId, ...(callado ? { pruebaDesde: new Date(ahora).toISOString() } : {}) })
        return responder({ sesionId, existente: false }, 300)
      },

      async completarPrueba(sesionId, { aprobada, notas } = {}, actor) {
        const g = inventarioGps().find((x) => x.sesionPrueba === sesionId)
        if (!g) return fallo('Esa prueba ya no está abierta. Vuelve a empezarla.')
        const ahora = Date.now()
        if (aprobada) {
          const [ultima] = tramasDemo(g, ahora, 1)
          if (!ultima?.fresco) return fallo('Todavía no llega una trama de este IMEI en los últimos 5 minutos. Espera la señal y vuelve a activarlo.')
          guardarParche('gps', g.id, { estado: 'active', verificado: true, ultimaConexion: ultima.recibido, sesionPrueba: null })
          auditar('probar_gps', { actor, empresaId: g.empresaId, objetivo: `${g.modelo} · ${g.imei}`, detalle: 'Prueba de señal aprobada' })
          return responder({ estado: 'passed', estadoEquipo: 'active', huella: ultima.huella, ultimaRecepcion: ultima.recibido }, 500)
        }
        const estadoEquipo = g.estado === 'active' ? 'inactive' : g.estado
        guardarParche('gps', g.id, { estado: estadoEquipo, sesionPrueba: null, pruebaDesde: null })
        auditar('probar_gps', { actor, empresaId: g.empresaId, objetivo: `${g.modelo} · ${g.imei}`, detalle: `Prueba de señal fallida${notas ? `: ${notas}` : ''}` })
        return responder({ estado: 'failed', estadoEquipo, huella: null, ultimaRecepcion: null }, 400)
      },

      /** IMEI que llegan al receptor sin estar en ninguna empresa. */
      async sinEmparejar() {
        return responder(detectadosDemo(Date.now()), 200)
      },

      /** Estado del receptor FOM. Solo en la demostración: el servidor aún no lo publica. */
      async receptor() {
        return responder({ activo: true, tcp: true, udp: true, puerto: 5001, ultimoMensaje: new Date(Date.now() - 4000).toISOString(), mensajesRecientes: 1284, fallosAlGuardar: 0 })
      },

      /** Unidades de una empresa para instalar, con el GPS que ya llevan. */
      async unidadesDe(empresaId) {
        const perfiles = todosPerfiles()
        return responder(todosVehiculos()
          .filter((v) => (v.empresaId ?? EMPRESA.id) === empresaId)
          .map((v) => ({
            id: v.id, alias: v.alias, placa: v.placa, marca: v.marca, modelo: v.modelo, anio: v.anio,
            conductorNombre: perfiles.find((p) => p.id === v.conductorPrincipalId)?.nombre ?? null,
            gps: v.gps ? { id: v.gps.id, imei: v.gps.imei } : null,
          })))
      },

      /** Prueba del botón de pánico (solo equipos verificados con soporte PIN). */
      async probarPanico(id, actor) {
        const g = todosGps().find((x) => x.id === id)
        if (!g) return fallo('Ese GPS no está en el inventario.')
        if (!g.verificado) return fallo('Verifica el equipo antes de probar el pánico.')
        if (!g.pinSupport) return fallo('Ese modelo no trae entrada de botón de pánico.')
        guardarParche('gps', id, { panicoProbado: true })
        auditar('probar_panico', { actor, empresaId: g.empresaId, objetivo: `${g.modelo} · ${g.imei}`, detalle: 'Botón de pánico probado correctamente' })
        return responder({ ok: true, mensaje: 'Señal de pánico recibida en la central.' }, 900)
      },
    },

    // ---------------- Usuarios del sistema (todas las empresas) ----------------
    usuarios: {
      async listar({ q = '', empresaId = '', rol = '' } = {}) {
        const empresas = todasEmpresas()
        let lista = todosPerfiles().map((p) => {
          const e = empresas.find((x) => x.id === p.empresaId) ?? null
          return {
            ...p,
            empresa: e,
            empresaNombre: e?.nombre ?? '—',
            rolEtiqueta: etiquetaRol(p.rol, e?.tipo),
            esDesempleado: p.empresaId === DESEMPLEADOS_ID,
          }
        })
        if (empresaId) lista = lista.filter((p) => p.empresaId === empresaId)
        if (rol) lista = lista.filter((p) => p.rol === rol)
        if (q) {
          const t = q.toLowerCase()
          lista = lista.filter((p) => [p.nombre, p.email, p.cedula, p.empresaNombre].join(' ').toLowerCase().includes(t))
        }
        return responder(lista.sort((a, b) => a.nombre.localeCompare(b.nombre)))
      },

      /**
       * Alta de usuario, como la Edge Function: rol asignable, compatible con
       * el tipo de empresa, y clave por defecto que se entrega una sola vez.
       */
      async crear({ nombre, email, rol, empresaId, conduce = false }, actor) {
        if (!nombre?.trim()) return fallo('El nombre es obligatorio.')
        if (!/.+@.+\..+/.test(email || '')) return fallo('Escribe un correo válido.')
        if (todosPerfiles().some((p) => p.email.toLowerCase() === email.toLowerCase()))
          return fallo('Ya existe un usuario con ese correo.')
        if (!ROLES_ASIGNABLES.includes(rol)) return fallo('Ese rol no se puede asignar desde el panel.')
        const e = todasEmpresas().find((x) => x.id === empresaId)
        if (!e) return fallo('Selecciona el empresa del usuario.')
        const errorRol = validarRolEmpresa(rol, e.tipo)
        if (errorRol) return fallo(errorRol)
        const fila = {
          id: `usr-n${Date.now().toString(36)}`,
          nombre: nombre.trim(),
          email: email.trim(),
          rol,
          empresaId,
          conduce: rol === 'conductor' ? true : !!conduce,
          perfilCompleto: false,
          cedula: '', telefono: '', direccion: '', fechaNacimiento: null,
          licenciaNumero: '', licenciaCategoria: '', licenciaVence: null,
          cartaMedicaVence: null, areaId: null,
          claveTemporal: true,
          creadoEn: new Date().toISOString(),
        }
        agregar('perfiles', fila)
        auditar('crear_usuario', {
          actor, empresaId,
          objetivo: fila.nombre,
          detalle: `Perfil ${etiquetaRol(rol, e.tipo)} con clave por defecto`,
        })
        return responder({ ...fila, clave: CLAVE_POR_DEFECTO }, 300)
      },

      async actualizar(id, patch, actor) {
        const p = todosPerfiles().find((x) => x.id === id)
        if (!p) return fallo('Ese usuario no existe.')
        if (!puedeGestionarA(actor, p)) return fallo('No puedes gestionar a ese usuario: su rango no es menor que el tuyo.')
        guardarParche('perfiles', id, patch)
        auditar('editar_usuario', { actor, empresaId: p.empresaId, objetivo: p.nombre, detalle: 'Perfil actualizado' })
        return responder(true, 240)
      },

      /** Mueve a otro empresa, validando rol contra el tipo de destino. */
      async mover(id, empresaId, actor) {
        const p = todosPerfiles().find((x) => x.id === id)
        if (!p) return fallo('Ese usuario no existe.')
        if (!puedeGestionarA(actor, p)) return fallo('No puedes gestionar a ese usuario: su rango no es menor que el tuyo.')
        const e = todasEmpresas().find((x) => x.id === empresaId)
        if (!e) return fallo('Ese empresa no existe.')
        const errorRol = validarRolEmpresa(p.rol, e.tipo)
        if (errorRol) return fallo(errorRol)
        guardarParche('perfiles', id, { empresaId, areaId: null })
        auditar('mover_usuario', { actor, empresaId, objetivo: p.nombre, detalle: `Movido a ${e.nombre}` })
        return responder(true, 260)
      },

      /**
       * "Eliminar" de la app: la cuenta no se borra, pasa a Desempleados C.A.
       * y suelta la unidad que tuviera asignada.
       */
      async enviarADesempleados(id, actor) {
        const p = todosPerfiles().find((x) => x.id === id)
        if (!p) return fallo('Ese usuario no existe.')
        if (!puedeGestionarA(actor, p)) return fallo('No puedes gestionar a ese usuario: su rango no es menor que el tuyo.')
        if (p.empresaId === DESEMPLEADOS_ID) return fallo('Ese usuario ya está en Desempleados C.A.')
        todosVehiculos().forEach((v) => {
          if (v.conductorPrincipalId === id) guardarParche('vehiculos', v.id, { conductorPrincipalId: null })
        })
        guardarParche('perfiles', id, { empresaId: DESEMPLEADOS_ID, areaId: null })
        auditar('eliminar_usuario', { actor, empresaId: p.empresaId, objetivo: p.nombre, detalle: 'Salió de la empresa; su cuenta pasó a Desempleados C.A.' })
        return responder(true, 280)
      },

      /** Borrado real: solo desde el empresa de respaldo, y es definitivo. */
      async eliminarDefinitivo(id, actor) {
        const p = todosPerfiles().find((x) => x.id === id)
        if (!p) return fallo('Ese usuario no existe.')
        if (!puedeGestionarA(actor, p)) return fallo('No puedes gestionar a ese usuario: su rango no es menor que el tuyo.')
        if (p.empresaId !== DESEMPLEADOS_ID)
          return fallo('Solo se elimina definitivamente desde Desempleados C.A.: envíalo allí primero.')
        guardarParche('perfiles', id, { eliminado: true })
        auditar('eliminar_definitivo', { actor, empresaId: DESEMPLEADOS_ID, objetivo: p.nombre, detalle: 'Cuenta eliminada definitivamente' })
        return responder(true, 300)
      },

      /** Restablece la clave a la por defecto. Jamás a un admin ni a uno mismo. */
      async cambiarClave(id, actor) {
        const p = todosPerfiles().find((x) => x.id === id)
        if (!p) return fallo('Ese usuario no existe.')
        if (p.rol === 'admin') return fallo('La clave de un Administrador FOM no se restablece desde el panel.')
        if (actor?.id === id) return fallo('Tu propia clave se cambia desde tu perfil, no desde aquí.')
        if (!puedeGestionarA(actor, p)) return fallo('No puedes gestionar a ese usuario: su rango no es menor que el tuyo.')
        guardarParche('perfiles', id, { claveTemporal: true })
        auditar('cambiar_clave', { actor, empresaId: p.empresaId, objetivo: p.nombre, detalle: 'Clave restablecida a la por defecto' })
        return responder({ clave: CLAVE_POR_DEFECTO }, 280)
      },
    },

    // ---------------- Auditoría ----------------
    auditoria: {
      async listar({ tipo = '', empresaId = '', q = '' } = {}) {
        const empresas = todasEmpresas()
        let lista = todaAuditoria().map((a) => ({
          ...a,
          empresaNombre: a.empresaId ? (empresas.find((e) => e.id === a.empresaId)?.nombre ?? '—') : 'Sistema',
        }))
        if (tipo) lista = lista.filter((a) => a.tipo === tipo)
        if (empresaId) lista = lista.filter((a) => a.empresaId === empresaId)
        if (q) {
          const t = q.toLowerCase()
          lista = lista.filter((a) => [a.actorNombre, a.objetivo, a.detalle, a.empresaNombre].join(' ').toLowerCase().includes(t))
        }
        return responder(lista)
      },
    },
  },
}

// ---------------- Inspección diaria del conductor (T-167a) ----------------
// Misma forma que repoApi.inspeccionConductor, para probar el flujo entero sin
// servidor: el formato, el envío (con su resultado y sus ODT), lo que queda
// recordado en el navegador y los avisos al supervisor.
//
// Va APARTE del objeto `repo` a propósito: repo.js mezcla toda la semilla en el
// modo conectado, y esta colección no debe colarse allí como si fuera real.

/** El orden de la hoja de la demo: frenos y luces primero, como el formato de la app. */
const ORDEN_CATEGORIAS_DEMO = ['Frenos', 'Luces']
function formatoDemo(tipo, elegida = null) {
  const publicada = elegida ?? plantillasDeLaEmpresa().find((t) => t.estado === 'publicada')
  if (publicada) {
    return {
      id: publicada.id,
      name: publicada.nombre,
      // Como el servidor: solo los puntos que aplican al tipo de la unidad.
      items: publicada.items
        .filter((it) => !it.vehicleTypes?.length || it.vehicleTypes.includes(tipo))
        .map((it, n) => ({ ...it, id: it.id ?? it.code ?? `punto-${n + 1}` })),
    }
  }
  const peso = (c) => { const n = ORDEN_CATEGORIAS_DEMO.indexOf(c); return n < 0 ? ORDEN_CATEGORIAS_DEMO.length : n }
  const items = ITEMS_INSPECCION
    .filter((i) => i.tipos.length === 0 || i.tipos.includes(tipo))
    .map((i, n) => ({ i, n }))
    .sort((a, b) => peso(a.i.categoria) - peso(b.i.categoria) || a.n - b.n)
    .map(({ i }, n) => ({ id: i.id, category: i.categoria, name: i.nombre, isCritical: i.critico, helpText: null, displayOrder: n + 1 }))
  return { id: 'formato-demo', name: 'Inspección preoperacional', items }
}

/**
 * Las planillas de la unidad para hoy (T-200), cada una con `dueToday`; las de hoy primero.
 * Sin plantillas publicadas por el supervisor, la demo trae dos: la preoperacional de siempre y
 * «Inicio de turno». Con publicadas, las de la empresa, según los días en que tocan.
 */
function formatosDemo(tipo) {
  const hoy = DIAS_SEMANA[(new Date().getDay() + 6) % 7].valor
  const publicadas = plantillasDeLaEmpresa().filter((t) => t.estado === 'publicada')
  const lista = publicadas.length
    ? publicadas.map((t) => {
        const f = formatoDemo(tipo, t)
        return { ...f, dueToday: tocaTodosLosDias(t.dias) || normalizarDias(t.dias).includes(hoy) }
      })
    : [
        { ...formatoDemo(tipo), dueToday: true },
        {
          id: 'formato-demo-turno',
          name: 'Inicio de turno',
          dueToday: true,
          items: ITEMS_INSPECCION
            .filter((i) => ['Cabina y seguridad', 'Documentos'].includes(i.categoria) && (i.tipos.length === 0 || i.tipos.includes(tipo)))
            // Ids propios: lo respondido en una planilla no se marca en la otra.
            .map((i, n) => ({ id: `turno-${i.id}`, category: i.categoria, name: i.nombre, isCritical: i.critico, helpText: null, displayOrder: n + 1 })),
        },
      ]
  return lista.sort((a, b) => Number(b.dueToday) - Number(a.dueToday))
}

/** ¿Esta inspección de hoy es de esa planilla? Las de la semilla no dicen cuál: cuentan para la primera. */
const esDePlanilla = (i, formatoId, nombre, primera) =>
  i.plantillaId ? i.plantillaId === formatoId : i.plantilla ? i.plantilla === nombre : primera

/** FOM decide el resultado: un crítico en falla bloquea; cualquier otra no conformidad, observaciones. */
function resultadoDemo(plantilla, respuestas) {
  const criticos = new Set(plantilla.categorias.flatMap((c) => c.items).filter((i) => i.critico).map((i) => i.id))
  if (respuestas.some((r) => r.estado === 'falla' && criticos.has(r.itemId))) return 'bloqueada'
  return respuestas.some((r) => r.estado !== 'conforme') ? 'aprobada_con_observaciones' : 'aprobada'
}

function avisoDemo(aviso, veh) {
  agregar('notificaciones', {
    id: `not-i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    empresaId: EMPRESA.id,
    tipo: aviso.kind,
    titulo: `${aviso.title} — ${veh?.alias ?? 'Unidad'} (${veh?.placa ?? ''})`,
    detalle: aviso.detail,
    odtId: null,
    leida: false,
    creadaEn: new Date().toISOString(),
  })
}

/** Una inspección de hoy de la demo en la forma de «hecha»: `{ inspeccion, detalle }`. */
function hechaDeDemo(fila, vehiculoId, guardada) {
  const veh = todosVehiculos().find((v) => v.id === vehiculoId)
  const detalle = guardada?.detalle?.id === fila.id ? guardada.detalle : fila.detalle ?? null
  return {
    detalle,
    inspeccion: detalle ?? {
      id: fila.id,
      resultado: fila.resultado,
      clase: fila.clase ?? 'daily',
      fecha: fila.fecha,
      enviadaEn: fila.creadaEn,
      vehiculoId,
      unidad: veh?.numero ?? veh?.alias ?? 'Unidad',
      placa: veh?.placa ?? null,
      conductor: todosPerfiles().find((p) => p.id === fila.conductorId)?.nombre ?? 'Sin conductor',
      conductorId: fila.conductorId ?? null,
      ubicacion: fila.ubicacion ?? null,
      formato: fila.plantilla ?? 'Inspección preoperacional',
    },
  }
}

export const inspeccionConductorSemilla = {
  async plantilla(vehiculo) {
    return responder(() => plantillaDeFormato(formatoDemo(vehiculo.tipo), vehiculo.tipo))
  },

  /** TODAS las planillas de hoy de la unidad y cuáles ya están hechas (misma forma que repoApi). */
  async planillasDeHoy(vehiculo, { empresaId = null } = {}) {
    const hoy = hoyISO()
    const guardada = leerDiariaGuardada(empresaId, vehiculo.id, hoy)
    const hechas = todasInspecciones()
      .filter((i) => i.vehiculoId === vehiculo.id && i.fecha === hoy && i.clase !== 'scheduled')
      .sort((a, b) => String(b.creadaEn).localeCompare(String(a.creadaEn)))
    const planillas = formatosDemo(vehiculo.tipo)
      .map((f, n) => ({ ...f, plantilla: plantillaDeFormato(f, vehiculo.tipo), primera: n === 0 }))
      .filter((f) => f.plantilla.categorias.length > 0)
      .map((f) => {
        const fila = hechas.find((i) => esDePlanilla(i, f.id, f.name, f.primera))
        return {
          id: f.id,
          plantilla: f.plantilla,
          dueToday: f.dueToday,
          hecha: fila ? hechaDeDemo(fila, vehiculo.id, guardada) : null,
        }
      })
    return responder({ nuevo: true, planillas, motivo: null })
  },

  async diariaDeHoy(vehiculoId, { empresaId = null } = {}) {
    const hoy = hoyISO()
    const guardada = leerDiariaGuardada(empresaId, vehiculoId, hoy)
    // La demo ve la lista entera, como un supervisor: también la que hizo otra persona.
    const diaria = todasInspecciones()
      .filter((i) => i.vehiculoId === vehiculoId && i.fecha === hoy && i.clase !== 'scheduled')
      .sort((a, b) => String(b.creadaEn).localeCompare(String(a.creadaEn)))[0]
    if (diaria) return responder({ estado: 'hecha', ...hechaDeDemo(diaria, vehiculoId, guardada) })
    if (guardada) return responder({ estado: 'hecha', inspeccion: guardada.detalle, detalle: guardada.detalle })
    return responder({ estado: 'pendiente' })
  },

  async detalle(id) {
    const i = todasInspecciones().find((x) => x.id === id)
    if (!i?.detalle) throw new Error('No pudimos cargar las respuestas de esta inspección.')
    return responder(i.detalle)
  },

  async enviar({ vehiculo, plantilla, respuestas, ubicacion }, quien) {
    if (!plantilla?.formatoId) throw new Error('Tu empresa no tiene un formato de inspección publicado.')
    const hoy = hoyISO()
    // Una por unidad, planilla y día, como la regla de FOM (409).
    const primera = formatosDemo(vehiculo.tipo)[0]?.id === plantilla.formatoId
    if (todasInspecciones().some((i) => i.vehiculoId === vehiculo.id && i.fecha === hoy && i.clase !== 'scheduled'
      && esDePlanilla(i, plantilla.formatoId, plantilla.nombre, primera))) {
      throw new InspeccionYaHecha({ porPlanilla: true })
    }
    const veh = todosVehiculos().find((v) => v.id === vehiculo.id) ?? vehiculo
    const items = new Map(plantilla.categorias.flatMap((c) => c.items).map((i) => [i.id, i]))
    const estado = resultadoDemo(plantilla, respuestas)
    const ahora = new Date().toISOString()
    const id = `insp-w${Date.now().toString(36)}`

    // Las ODT que pide la inspección: siempre en los críticos, y en las demás si dijo que sí.
    // Numeradas como las de la semilla (odt-016, odt-017…), sin repetir ninguna.
    const usados = new Set(todasOdts().map((o) => o.id))
    let siguiente = usados.size
    const nuevoId = () => {
      let id
      do id = `odt-${String(++siguiente).padStart(3, '0')}`
      while (usados.has(id))
      usados.add(id)
      return id
    }
    const ordenes = respuestas
      .filter((r) => r.estado === 'falla' && (items.get(r.itemId)?.critico || r.crearOdt === true))
      .map((r) => {
        const item = items.get(r.itemId)
        const odt = {
          id: nuevoId(),
          empresaId: EMPRESA.id,
          vehiculoId: vehiculo.id,
          creadorId: quien.id,
          autorVia: 'principal',
          tipo: 'correctiva',
          estado: 'abierta',
          descripcion: `Inspección: ${item?.nombre ?? r.itemId}${r.nota?.trim() ? `. ${r.nota.trim()}` : ''}`,
          tipoFalla: null,
          ubicacion: ubicacion || veh?.ubicacionTexto || '',
          evidenciaUrls: [],
          notaSolucion: null,
          costo: null,
          resueltaEn: null,
          reglaId: null,
          creadaEn: ahora,
        }
        agregar('odts', odt)
        agregar('notificaciones', {
          id: `not-${odt.id}`,
          empresaId: EMPRESA.id,
          tipo: 'odt_nueva',
          titulo: `Nueva ODT — Vehículo ${veh?.alias ?? ''} (${veh?.placa ?? ''})`,
          detalle: odt.descripcion,
          odtId: odt.id,
          leida: false,
          creadaEn: ahora,
        })
        return { id: odt.id, estado: odt.estado, descripcion: odt.descripcion }
      })

    const detalle = detalleDeEnvio({ id, resultado: estado, enviadaEn: ahora, vehiculo: veh, plantilla, respuestas, ubicacion, quien })
    const resultado = resultadoDeEnvio(estado, plantilla, respuestas, ordenes, ahora)
    // En la lista del supervisor, con sus cuentas y lo respondido (para «Ver resultado»).
    agregar('inspecciones', {
      id,
      vehiculoId: vehiculo.id,
      conductorId: quien.id,
      fecha: hoy,
      resultado: estado,
      clase: 'daily',
      ubicacion: detalle.ubicacion,
      creadaEn: ahora,
      plantillaId: plantilla.formatoId,
      plantilla: plantilla.nombre,
      observaciones: respuestas.filter((r) => r.estado !== 'conforme').length - resultado.fallasCriticas,
      fallasCriticas: resultado.fallasCriticas,
      detalle,
    })
    if (estado === 'bloqueada') avisoDemo(AVISO_BLOQUEADA, veh)
    guardarDiaria(quien.empresaId, vehiculo.id, detalle)
    // La demo no tiene dónde guardar fotos: se cuentan y la pantalla lo dice.
    const fotos = respuestas.reduce((n, r) => n + (r.estado === 'falla' ? r.fotos?.length ?? 0 : 0), 0)
    return responder({ resultado, detalle, fotos: { subidas: 0, fallidas: 0, enDemo: fotos } }, 450)
  },

  async pedirOtraUnidad(vehiculoId) {
    avisoDemo(AVISO_OTRA_UNIDAD, todosVehiculos().find((v) => v.id === vehiculoId))
    return responder(true, 250)
  },
}

// ---------------- El SOS del conductor (T-167b) ----------------
// Misma forma que repoApi.sos (lo que ve el conductor) y que
// repoApi.seguridad.emergencias (lo que ve su supervisor en «Eventos y SOS»):
// el aviso se guarda con la forma de FOM y cada lado lo lee con su traductor,
// así lo que manda el conductor de la demo le llega al supervisor de la demo.
// Aparte de `repo`, como la inspección: conectado no debe colarse nada de aquí.

function todasEmergencias() {
  return agregados('emergencias')
    .map((e) => aplicar('emergencias', e))
    .sort((a, b) => String(b.reportedAt).localeCompare(String(a.reportedAt)))
}
const EN_CURSO = new Set(['active', 'acknowledged'])
const yoDemo = (usuarioId) => usuarioId ?? perfilActual()?.id ?? null

/** Quién es quién en la demo, para decir quién tomó el aviso. */
function nombresDemo() {
  return new Map(todosPerfiles().map((p) => [p.id, p.nombre]))
}

/** Pasa un aviso de un estado a otro, con la misma regla que FOM (409 si ya cambió). */
function moverEmergencia(id, desde, cambio, mensaje) {
  const e = todasEmergencias().find((x) => x.id === id)
  if (!e) throw new Error('Ese aviso ya no está a tu alcance.')
  if (!desde.includes(e.status)) throw new Error(mensaje)
  guardarParche('emergencias', id, cambio)
}

export const sosSemilla = {
  async miEmergencia({ usuarioId = null } = {}) {
    const yo = yoDemo(usuarioId)
    const mia = todasEmergencias().find((e) => EN_CURSO.has(e.status) && e.reportedByUserId === yo)
    return responder(mia ? emergenciaDelConductor(mia, nombresDemo()) : null, 150)
  },

  async enviar(entrada, { usuarioId = null } = {}) {
    const yo = yoDemo(usuarioId)
    const previa = todasEmergencias().find((e) => EN_CURSO.has(e.status) && e.reportedByUserId === yo)
    if (previa) return responder(emergenciaDelConductor(previa, nombresDemo()), 200)
    const cuerpo = cuerpoEmergencia(entrada)
    // La posición de la unidad la pone FOM con su GPS: aquí, la última conocida.
    const veh = cuerpo.vehicleId ? todosVehiculos().find((v) => v.id === cuerpo.vehicleId) : null
    const fila = {
      id: `sos-${Date.now().toString(36)}`,
      empresaId: EMPRESA.id,
      vehicleId: cuerpo.vehicleId ?? null,
      reportedByUserId: yo,
      kind: cuerpo.kind,
      kindOther: cuerpo.kindOther ?? null,
      detail: cuerpo.detail,
      reporterLocation: cuerpo.reporterLatitude != null ? { latitude: cuerpo.reporterLatitude, longitude: cuerpo.reporterLongitude } : null,
      vehicleLocation: veh?.lat != null ? { latitude: veh.lat, longitude: veh.lng } : null,
      status: 'active',
      acknowledgedByUserId: null,
      acknowledgedAt: null,
      reportedAt: new Date().toISOString(),
    }
    agregar('emergencias', fila)
    return responder(emergenciaDelConductor(fila, nombresDemo()), 350)
  },

  async cancelar(emergencia) {
    moverEmergencia(emergencia.id, ['active'], { status: 'cancelled' }, 'Tu supervisor ya lo tomó: ya no se puede retirar.')
    return responder(true, 200)
  },

  async terminar(emergencia) {
    moverEmergencia(emergencia.id, ['acknowledged'], { status: 'resolved' }, 'El aviso cambió mientras lo tenías abierto. Vuelve a abrirlo.')
    return responder(true, 200)
  },
}

/** Las emergencias en «Eventos y SOS» del supervisor de la demo (el resto de la pantalla sigue pidiendo la base real). */
export const seguridadSemilla = {
  async emergencias({ estado = '' } = {}) {
    return responder(() => todasEmergencias().filter((e) => !estado || e.status === estado).map(emergenciaParaConsola))
  },
  async reconocerEmergencia(id) {
    moverEmergencia(id, ['active'], { status: 'acknowledged', acknowledgedByUserId: perfilActual()?.id ?? null, acknowledgedAt: new Date().toISOString() },
      'Alguien más cambió esto mientras lo mirabas. Recarga y vuelve a intentarlo.')
    return responder(true, 200)
  },
  async resolverEmergencia(id) {
    moverEmergencia(id, ['active', 'acknowledged'], { status: 'resolved' }, 'Alguien más cambió esto mientras lo mirabas. Recarga y vuelve a intentarlo.')
    return responder(true, 200)
  },
}

// ---------------- Otra unidad con PIN (T-167b) ----------------
// Misma forma que repoApi.otraUnidad. En la demo, el conductor es secundario
// de las dos unidades que siguen a la suya, y cualquier PIN de 4 a 8 dígitos
// abre: no hay un servidor que guarde el PIN de verdad.

/** Las unidades donde la persona es secundaria en la demo. */
function secundariasDemo(usuarioId) {
  const vehiculos = todosVehiculos()
  const n = vehiculos.findIndex((v) => v.conductorPrincipalId === usuarioId)
  if (n < 0) return []
  return [1, 2].map((k) => vehiculos[(n + k) % vehiculos.length]).filter((v) => v && v.conductorPrincipalId !== usuarioId)
}

export const otraUnidadSemilla = {
  async unidades() {
    return responder(() => secundariasDemo(perfilActual()?.id).map((v) => ({
      vehiculoId: v.id,
      nombre: v.numero && v.numero !== '—' ? v.numero : v.alias,
      placa: v.placa && v.placa !== '—' ? v.placa : null,
    })))
  },
  async sesionActual() {
    const yo = perfilActual()?.id
    return responder(() => (cambios.sesionConduccion?.[yo] ?? null), 100)
  },
  async usar(vehiculoId, pin) {
    const yo = perfilActual()?.id
    if (!secundariasDemo(yo).some((v) => v.id === vehiculoId)) throw new Error('No estás autorizado en esta unidad.')
    if (!/^\d{4,8}$/u.test(String(pin).trim())) throw new Error('PIN incorrecto para esta unidad. Verifica con tu supervisor.')
    if (cambios.sesionConduccion?.[yo]) throw new Error('Ya estás usando otra unidad: déjala primero.')
    cambios.sesionConduccion = { ...(cambios.sesionConduccion ?? {}), [yo]: { id: `ses-${Date.now().toString(36)}`, vehiculoId, rol: 'secundario' } }
    guardar()
    return responder(true, 300)
  },
  async dejar() {
    const yo = perfilActual()?.id
    if (cambios.sesionConduccion?.[yo]) {
      const { [yo]: _fuera, ...resto } = cambios.sesionConduccion
      cambios.sesionConduccion = resto
      guardar()
    }
    return responder(true, 250)
  },
}

export default repo
