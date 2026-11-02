import { FILTROS_INVENTARIO } from './gps.js'

const LIBRES = FILTROS_INVENTARIO.find((f) => f.clave === 'libres')

// Reglas de «Instalar en una unidad» (T-208), sin pantalla ni red para poder probarlas.
//
// Lo que dice el servidor (fom-core, console-gps-inventory.controller y
// console-directory.service):
//  - `GET /console/gps-devices` y `GET /console/gps-devices/:id` sirven SOLO los equipos
//    de la empresa propia de quien pregunta ("del tenant actual"); no hay lectura por empresa.
//  - Instalar busca el equipo Y la unidad en la MISMA empresa (`installGpsDevice`): un equipo
//    del inventario propio no se puede montar en una unidad de otra empresa.

/** La empresa propia del administrador: la de su cuenta, aunque esté «dentro» de otra. */
export function empresaPropia(sesion) {
  return sesion?.perfilGlobal?.empresaId ?? sesion?.perfil?.empresaId ?? null
}

/**
 * Un equipo por su id. Primero el detalle; si el servidor dice 404, se busca en el inventario
 * (la lista) antes de rendirse: una fila que se ve en la lista no debe dar «no existe» al abrirla.
 * Devuelve el equipo del servidor, o `null` si de verdad no está. Otros errores se propagan.
 */
export async function buscarEquipoGps(equipoId, { detalle, lista }) {
  try {
    const r = await detalle(equipoId)
    if (r?.device) return r.device
  } catch (e) {
    if (e?.estado !== 404) throw e
  }
  const r = await lista()
  return (r?.devices ?? []).find((d) => d?.id === equipoId) ?? null
}

/**
 * Por qué ruta viaja la instalación.
 * `null` = la ruta propia (donde vive el equipo que se ve en el inventario); un id = la ruta de
 * esa empresa. Importa el `null` explícito: estando «dentro» de otra empresa, la ruta normal se
 * volvería la de esa empresa y el equipo propio no existiría allí.
 */
export function empresaDeInstalacion(empresaElegida, propia) {
  if (!empresaElegida || !propia || empresaElegida === propia) return null
  return empresaElegida
}

/** El mensaje, en llano, cuando el servidor rechaza la instalación. */
export function mensajeInstalarGps(error, { otraEmpresa = false, nombrePropia = 'tu empresa' } = {}) {
  if (error?.estado === 409) return 'Esa unidad ya lleva un GPS, o este equipo ya está instalado en otra.'
  if (error?.estado === 404) {
    return otraEmpresa
      ? `El servidor no aceptó instalar este equipo en una unidad de otra empresa. Es posible que el servidor publicado aún no tenga el inventario global de equipos; mientras tanto solo instala en unidades de la empresa donde está registrado el equipo (el inventario de ${nombrePropia}). Elige una unidad de esa empresa, o avisa a Juan para publicar la actualización.`
      : 'El servidor no encontró el equipo o la unidad. Recarga la pantalla e inténtalo de nuevo.'
  }
  return error?.message || 'No se pudo instalar el equipo. Inténtalo de nuevo.'
}

/**
 * Los equipos que «Nueva unidad» puede ofrecer (T-214).
 *
 * Solo los libres (los de «Sin instalar» del inventario: sin unidad y ni inactivos ni archivados)
 * y solo los de la empresa donde se crea la unidad: el servidor instala equipo y unidad dentro
 * de la misma empresa. Un equipo sin `empresaId` es del inventario propio (la lista sin empresa
 * por equipo es la de la empresa de la cuenta).
 *
 * «Verificado» con datos reales = el receptor ya lo oyó alguna vez (`verificado`). El servidor
 * deja instalar cualquier equipo del inventario, así que el que nunca reportó NO se esconde:
 * sale al final con `sinSenal: true` y «(sin señal todavía)» en el nombre. Primero van los que
 * hablaron más recientemente.
 *
 * `global` (T-215): con el inventario global del servidor (#749) el administrador FOM crea la
 * unidad en CUALQUIER empresa sin entrar a ella y el equipo libre no tiene que ser de esa empresa:
 * no se filtra por empresa. Si el servidor publicado aún no lo admite, rechaza la instalación y
 * se explica al guardar (`mensajeInstalarGps`).
 */
export function equiposParaNuevaUnidad(equipos, { destino = null, propia = null, global = false } = {}) {
  const meta = global ? null : destino || propia || null
  const ms = (g) => { const t = Date.parse(g.ultimaConexion ?? ''); return Number.isFinite(t) ? t : 0 }
  return (equipos ?? [])
    .filter((g) => LIBRES.pasa(g))
    .filter((g) => !meta || (g.empresaId ?? propia ?? meta) === meta)
    .map((g) => {
      const sinSenal = !g.verificado
      return { ...g, sinSenal, modelo: sinSenal ? `${g.modelo || 'GPS'} (sin señal todavía)` : g.modelo }
    })
    .sort((a, b) => Number(a.sinSenal) - Number(b.sinSenal) || ms(b) - ms(a))
}
