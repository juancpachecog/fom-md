// Análisis del recorrido de una unidad: paradas, viajes y cola reciente.
// Funciones puras (sin red ni DOM) para poder probarlas y usarlas desde cualquier mapa.
//
// Entran puntos {lat, lng, hora, velocidadKmh?} en orden del más antiguo al más reciente.
// OJO: aquí deben entrar los puntos CRUDOS. El trazado que se dibuja ya pasó por el filtro
// de deriva (repoApi.sinDeriva), que borra los puntos de un GPS parado; con ellos fuera, el
// tiempo que estuvo estacionada la unidad desaparece.

/** Una unidad que se queda en el mismo sitio al menos esto (minutos) está estacionada. */
export const MIN_PARADA_MIN = 5
/** «El mismo sitio»: radio, en metros, alrededor del centro de los puntos de la parada. Un GPS parado
 * baila decenas de metros alrededor de su sitio real; con menos radio una parada se rompe en pedazos. */
export const RADIO_PARADA_M = 100
/** Un viaje más corto que esto (metros) es ruido del GPS, no un viaje. */
const MIN_VIAJE_M = 150
/** Ventana de la cola que se muestra sin pedir el recorrido completo. */
export const COLA_MIN = 5

const RADIO_TIERRA_M = 6371000
const rad = (g) => (g * Math.PI) / 180

/**
 * Quita los «saltos» del GPS: puntos que aparecen lejos de donde estaba la unidad, más rápido de lo que ella
 * misma dice que va (un carro parado que «viaja» 500 m en un minuto), y que vuelven enseguida. Se dibujan como
 * rectas largas que cruzan el mapa. Si los puntos lejanos se repiten (4 seguidos) se acepta que la unidad sí
 * se movió, por ejemplo tras un túnel o un rato sin señal.
 */
export function quitarSaltos(puntos, { minM = 150, kmhMin = 25, kmhTope = 160, seguidos = 4 } = {}) {
  const salida = []
  let rechazados = 0
  for (const p of puntos ?? []) {
    const a = salida[salida.length - 1]
    if (!a) { salida.push(p); continue }
    const dt = Math.abs(Date.parse(p.hora) - Date.parse(a.hora)) / 3600000
    const m = distanciaM(a, p)
    const dicha = Math.max(a.velocidadKmh ?? 0, p.velocidadKmh ?? 0)
    const conocida = a.velocidadKmh != null && p.velocidadKmh != null
    const tope = conocida ? Math.max(dicha * 2, kmhMin) : kmhTope
    const salto = m > minM && (dt <= 0 || m / 1000 / dt > tope)
    if (salto && rechazados < seguidos - 1) { rechazados++; continue }
    rechazados = 0
    salida.push(p)
  }
  return salida
}

/** Distancia en metros entre dos puntos (fórmula de haversine). */
export function distanciaM(a, b) {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

const tiempo = (p) => Date.parse(p.hora)
const minutosEntre = (a, b) => Math.max(0, (tiempo(b) - tiempo(a)) / 60000)

function validos(puntos) {
  return (puntos ?? [])
    .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(tiempo(p)))
    .sort((a, b) => tiempo(a) - tiempo(b))
}

function largo(puntos) {
  let m = 0
  for (let i = 1; i < puntos.length; i++) m += distanciaM(puntos[i - 1], puntos[i])
  return m
}

/**
 * Último índice del grupo que empieza en `i`: los puntos seguidos que no se alejan más de `radioM`
 * del CENTRO del grupo (se recalcula al sumar cada punto) y cumplen `admite`.
 */
function barrido(p, i, radioM, admite = () => true) {
  let sLat = p[i].lat
  let sLng = p[i].lng
  let n = 1
  let j = i
  while (j + 1 < p.length && admite(p[j + 1])) {
    if (distanciaM({ lat: sLat / n, lng: sLng / n }, p[j + 1]) > radioM) break
    j++
    sLat += p[j].lat
    sLng += p[j].lng
    n++
  }
  return j
}

/**
 * Colapsa a UN punto cada racha de puntos quietos (sin velocidad, a ≤ `velMax` km/h o con el motor
 * apagado) que bailan dentro de `radioM`. Es la deriva de un GPS parado: sin esto, una unidad
 * detenida se dibuja como una nube de puntos y parece que anduvo.
 */
export function compactarQuietud(puntos, { radioM = RADIO_PARADA_M, velMax = 8 } = {}) {
  const p = validos(puntos)
  const quieto = (x) => x.ignition === false || x.velocidadKmh == null || x.velocidadKmh <= velMax
  const salida = []
  let i = 0
  while (i < p.length) {
    if (!quieto(p[i])) {
      salida.push(p[i++])
      continue
    }
    const j = barrido(p, i, radioM, quieto)
    if (j > i) {
      const grupo = p.slice(i, j + 1)
      salida.push({
        ...p[j],
        lat: grupo.reduce((s, x) => s + x.lat, 0) / grupo.length,
        lng: grupo.reduce((s, x) => s + x.lng, 0) / grupo.length,
        velocidadKmh: 0,
      })
    } else {
      salida.push(p[i])
    }
    i = j + 1
  }
  return salida
}

/**
 * Busca los tramos en que la unidad no salió de un radio de `radioM` durante al menos
 * `minParadaMin` minutos. Devuelve cada parada con su sitio (centro de los puntos),
 * cuándo empezó y terminó, cuánto duró, y los índices de los puntos que abarca.
 */
export function detectarParadas(puntos, { minParadaMin = MIN_PARADA_MIN, radioM = RADIO_PARADA_M } = {}) {
  const p = validos(puntos)
  const paradas = []
  let i = 0
  while (i < p.length) {
    const j = barrido(p, i, radioM)
    if (j > i && minutosEntre(p[i], p[j]) >= minParadaMin) {
      const tramo = p.slice(i, j + 1)
      const lat = tramo.reduce((s, x) => s + x.lat, 0) / tramo.length
      const lng = tramo.reduce((s, x) => s + x.lng, 0) / tramo.length
      paradas.push({
        numero: paradas.length + 1,
        lat,
        lng,
        desde: p[i].hora,
        hasta: p[j].hora,
        minutos: minutosEntre(p[i], p[j]),
        primero: i,
        ultimo: j,
      })
      i = j + 1
    } else {
      i++
    }
  }
  return { puntos: p, paradas }
}

/**
 * Parte el recorrido en viajes (de parada a parada). Cada viaje trae su inicio y su fin;
 * `fin.enCurso` es cierto cuando el viaje llega hasta el último punto y la unidad no está
 * estacionada: sigue en camino, no ha «terminado».
 */
export function analizar(puntos, opciones) {
  const { puntos: p, paradas } = detectarParadas(puntos, opciones)
  const viajes = []
  const cortes = []
  let desde = 0
  for (const s of paradas) {
    cortes.push([desde, s.primero])
    desde = s.ultimo
  }
  cortes.push([desde, p.length - 1])

  for (const [a, b] of cortes) {
    if (b <= a) continue
    const tramo = p.slice(a, b + 1)
    const distancia = largo(tramo)
    if (distancia < MIN_VIAJE_M) continue
    const ultimo = tramo.at(-1)
    viajes.push({
      numero: viajes.length + 1,
      puntos: compactarQuietud(tramo),
      distanciaM: distancia,
      minutos: minutosEntre(tramo[0], ultimo),
      inicio: { lat: tramo[0].lat, lng: tramo[0].lng, hora: tramo[0].hora },
      fin: { lat: ultimo.lat, lng: ultimo.lng, hora: ultimo.hora, enCurso: b === p.length - 1 },
    })
  }
  return { puntos: p, paradas, viajes }
}

/** Los últimos `min` minutos de recorrido, contados hasta el último punto conocido. */
export function ultimosMinutos(puntos, min = COLA_MIN) {
  const p = validos(puntos)
  if (p.length === 0) return []
  const corte = tiempo(p.at(-1)) - min * 60000
  const cola = p.filter((x) => tiempo(x) >= corte)
  // Con un solo punto no hay línea que dibujar; se suma el anterior si lo hay.
  return cola.length < 2 && p.length >= 2 ? p.slice(-2) : cola
}

/**
 * La cola que se dibuja al elegir una unidad: sus últimos `min` minutos. Si en ese lapso casi no se
 * movió (estacionada, o reportando desde el mismo sitio), cinco minutos no enseñan de dónde viene:
 * se amplía hacia atrás hasta su último trayecto, `minM` metros de camino o `maxMin` minutos.
 * `ampliada` avisa de que la línea cubre más de `min` minutos.
 */
export function colaReciente(puntos, { min = COLA_MIN, minM = 120, maxMin = 60 } = {}) {
  const p = compactarQuietud(puntos)
  if (p.length < 2) return { puntos: [], ampliada: false }
  const fin = tiempo(p.at(-1))
  const base = p.filter((x) => tiempo(x) >= fin - min * 60000)
  // Se mide cuánto SE ALEJÓ del punto actual, no el camino recorrido: la deriva de un GPS parado
  // suma metros de zigzag sin ir a ninguna parte.
  const lejos = (tramo) => tramo.reduce((m, x) => Math.max(m, distanciaM(x, p.at(-1))), 0)
  if (base.length >= 2 && lejos(base) >= minM) return { puntos: base, ampliada: false }
  let i = p.length - 1
  while (i > 0 && lejos(p.slice(i)) < minM && fin - tiempo(p[i - 1]) <= maxMin * 60000) i--
  const amplia = p.slice(i)
  if (amplia.length < 2 || lejos(amplia) < 20) return { puntos: [], ampliada: false }
  return { puntos: amplia, ampliada: true }
}

/** El punto del trazado más cercano a un lugar (donde se hizo clic). */
export function puntoEnRuta(puntos, lugar) {
  let mejor = null
  let mejorD = Infinity
  puntos.forEach((x, indice) => {
    const d = distanciaM(x, lugar)
    if (d < mejorD) {
      mejorD = d
      mejor = { ...x, indice, distanciaM: d }
    }
  })
  return mejor
}

/** Resumen de una lista de viajes y paradas para el encabezado del recorrido. */
export function resumen({ viajes = [], paradas = [] }) {
  return {
    viajes: viajes.length,
    km: viajes.reduce((s, v) => s + v.distanciaM, 0) / 1000,
    paradas: paradas.length,
    minutosParada: paradas.reduce((s, x) => s + x.minutos, 0),
  }
}
