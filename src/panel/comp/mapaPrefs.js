// ============================================================
// PREFERENCIAS DEL MAPA (Mapbox)
// ------------------------------------------------------------
// Lo que cada quien elige en el panel «Capas» del mapa: luz, vista
// (calles o satélite), 3D, relieve, tráfico, lugares y lluvia. Se guarda en
// el navegador para que al volver el mapa esté como lo dejó. No viaja al
// servidor: es gusto personal, no dato de la flota.
// ============================================================

const CLAVE = 'fom.mapa.prefs'

export const PREFS_POR_DEFECTO = Object.freeze({
  // night | dawn | day | dusk | auto. El panel es oscuro, así que de entrada
  // el mapa va de noche; «auto» sigue la hora de Venezuela.
  luz: 'night',
  // calles | satelite
  vista: 'calles',
  // fom | default | faded | monochrome (solo en calles). «fom» es el estilo
  // de Mapbox con los colores de noche del panel; «default» es el original.
  tema: 'fom',
  // Edificios, árboles y monumentos en 3D (se notan al inclinar la cámara).
  edificios3d: true,
  // Relieve del terreno (montañas con volumen).
  relieve: false,
  // Cámara inclinada (vista 3D) o cenital (plana).
  vista3d: false,
  // Tráfico en vivo sobre las vías.
  trafico: false,
  // Nombres de negocios y lugares.
  lugares: true,
  // Efecto de lluvia (solo decorativo).
  lluvia: false,
})

export function leerPrefs() {
  try {
    const crudo = localStorage.getItem(CLAVE)
    if (!crudo) return { ...PREFS_POR_DEFECTO }
    const guardado = JSON.parse(crudo)
    if (!guardado || typeof guardado !== 'object') return { ...PREFS_POR_DEFECTO }
    // Antes de la versión 2, «default» era el tema con los colores de FOM.
    if (!guardado.v && guardado.tema === 'default') guardado.tema = 'fom'
    return { ...PREFS_POR_DEFECTO, ...guardado }
  } catch {
    return { ...PREFS_POR_DEFECTO }
  }
}

export function guardarPrefs(prefs) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ ...prefs, v: 2 }))
  } catch {
    /* navegador sin almacenamiento: queda en memoria */
  }
}

/** La hora en Venezuela (0–23), para la luz automática. */
function horaEnVenezuela(fecha = new Date()) {
  try {
    const partes = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Caracas' }).formatToParts(fecha)
    const h = Number(partes.find((p) => p.type === 'hour')?.value)
    return Number.isFinite(h) ? h % 24 : fecha.getHours()
  } catch {
    return fecha.getHours()
  }
}

/** La luz que toca ahora: amanecer de 6 a 7, día de 7 a 18, atardecer de 18 a 19, noche el resto. */
export function luzAutomatica(fecha = new Date()) {
  const h = horaEnVenezuela(fecha)
  if (h === 6) return 'dawn'
  if (h >= 7 && h < 18) return 'day'
  if (h === 18) return 'dusk'
  return 'night'
}

export function luzEfectiva(prefs, fecha = new Date()) {
  return prefs.luz === 'auto' ? luzAutomatica(fecha) : prefs.luz
}

export const ESTILOS = Object.freeze({
  calles: 'mapbox://styles/mapbox/standard',
  satelite: 'mapbox://styles/mapbox/standard-satellite',
})

export function estiloDe(prefs) {
  return ESTILOS[prefs.vista] ?? ESTILOS.calles
}

/**
 * Colores de noche afinados a la paleta del panel (#0b1927 de fondo, azul
 * #168fff de acento): el agua y el suelo más hondos, las vías con un azul
 * frío que se lee sobre el negro, y los nombres claros sin deslumbrar.
 */
const COLORES_NOCHE = Object.freeze({
  colorWater: '#07162a',
  colorLand: '#101c2b',
  colorGreenspace: '#112b26',
  colorRoads: '#3b5069',
  colorTrunks: '#4d7bb1',
  colorMotorways: '#5b93d6',
  colorPlaceLabels: '#e3ecf7',
  colorRoadLabels: '#c3d3e5',
  colorPointOfInterestLabels: '#9fb6cf',
})

export const CLAVES_COLOR = Object.freeze(Object.keys(COLORES_NOCHE))

/**
 * Los colores propios que tocan: los de noche de FOM solo con tema «FOM», de
 * noche y en calles. En cualquier otro caso, ninguno (se ve el original de Mapbox).
 * No es un filtro sobre la imagen: son propiedades del estilo Standard.
 */
export function coloresDe(prefs, fecha = new Date()) {
  return prefs.vista !== 'satelite' && prefs.tema === 'fom' && luzEfectiva(prefs, fecha) === 'night' ? COLORES_NOCHE : {}
}

/** La configuración del estilo Standard (`config.basemap`) que sale de las preferencias (sin los colores). */
export function configDe(prefs, fecha = new Date()) {
  const luz = luzEfectiva(prefs, fecha)
  const base = {
    lightPreset: luz,
    showPlaceLabels: true,
    showRoadLabels: true,
    showTransitLabels: false,
    showPointOfInterestLabels: prefs.lugares,
    showPedestrianRoads: true,
  }
  if (prefs.vista === 'satelite') return { ...base, showRoadsAndTransit: true }
  return {
    ...base,
    theme: prefs.tema === 'fom' ? 'default' : prefs.tema,
    show3dObjects: prefs.edificios3d,
    showLandmarkIcons: true,
    densityPointOfInterestLabels: 2,
  }
}

/** Niebla y cielo según la luz: de noche con estrellas, de día un horizonte claro. */
export function nieblaDe(luz) {
  if (luz === 'night') {
    return { range: [-1, 2], 'horizon-blend': 0.25, color: '#15203a', 'high-color': '#0b1226', 'space-color': '#050912', 'star-intensity': 0.7 }
  }
  if (luz === 'dusk' || luz === 'dawn') {
    return { range: [-1, 2], 'horizon-blend': 0.3, color: '#5b4a6b', 'high-color': '#2a2f55', 'space-color': '#0b1026', 'star-intensity': 0.25 }
  }
  return { range: [-1, 2], 'horizon-blend': 0.3, color: '#dfe9f3', 'high-color': '#9ec6ea', 'space-color': '#cfe6fb', 'star-intensity': 0 }
}
