// ============================================================
// PREFERENCIAS DEL MAPA (Mapbox)
// ------------------------------------------------------------
// Lo que cada quien elige en el panel «Capas» del mapa: luz, vista
// (calles o satélite), tráfico, lugares y lluvia. Se guarda en el navegador
// para que al volver el mapa esté como lo dejó. No viaja al servidor: es
// gusto personal, no dato de la flota.
//
// Sin 3D (pedido del dueño, 16 oct 2026): ni edificios, ni relieve, ni cámara
// inclinada, ni niebla de estrellas. Es lo que más pesa y en una flota no
// aporta. Las claves siguen aquí siempre en falso para que el panel «Capas»
// no se rompa mientras quita sus interruptores.
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
  // 3D apagado siempre (ver `sin3d`).
  edificios3d: false,
  relieve: false,
  vista3d: false,
  // Tráfico en vivo sobre las vías.
  trafico: false,
  // Nombres de negocios y lugares. Apagado de entrada: llenan el mapa y lo hacen más pesado.
  lugares: false,
  // Efecto de lluvia (solo decorativo).
  lluvia: false,
})

/** Las preferencias sin nada de 3D, vengan de donde vengan (lo guardado o un interruptor viejo). */
export function sin3d(prefs) {
  return { ...prefs, edificios3d: false, relieve: false, vista3d: false }
}

export function leerPrefs() {
  try {
    const crudo = localStorage.getItem(CLAVE)
    if (!crudo) return { ...PREFS_POR_DEFECTO }
    const guardado = JSON.parse(crudo)
    if (!guardado || typeof guardado !== 'object') return { ...PREFS_POR_DEFECTO }
    // Antes de la versión 2, «default» era el tema con los colores de FOM.
    if (!guardado.v && guardado.tema === 'default') guardado.tema = 'fom'
    // Versión 3 (mapa más ligero): quien ya tenía preferencias pasa a «sin lugares»;
    // si los quiere, los vuelve a encender en «Capas». El 3D se apaga siempre.
    if ((guardado.v ?? 0) < 3) guardado.lugares = PREFS_POR_DEFECTO.lugares
    return sin3d({ ...PREFS_POR_DEFECTO, ...guardado })
  } catch {
    return { ...PREFS_POR_DEFECTO }
  }
}

export function guardarPrefs(prefs) {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ ...sin3d(prefs), v: 3 }))
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
    // Veredas y caminos peatonales: no aportan a una flota y suman geometría.
    showPedestrianRoads: false,
    // Sin 3D: edificios, árboles y monumentos planos (las claves que el estilo no tenga se ignoran).
    show3dObjects: false,
    show3dBuildings: false,
    show3dTrees: false,
    show3dLandmarks: false,
    show3dFacades: false,
  }
  if (prefs.vista === 'satelite') return { ...base, showRoadsAndTransit: true }
  return {
    ...base,
    theme: prefs.tema === 'fom' ? 'default' : prefs.tema,
    showLandmarkIcons: false,
    densityPointOfInterestLabels: 2,
  }
}
