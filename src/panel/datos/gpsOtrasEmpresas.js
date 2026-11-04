// T-209 · El inventario GPS de la web solo trae los equipos de la empresa propia del administrador.
//
// El servidor acota `GET /api/v1/console/gps-devices` a la empresa de la sesión, y la consola
// web se autentica con cookie: no tiene ruta para leer los GPS de OTRA empresa (las de
// `/api/v1/mobile/tenants/{id}/gps-devices` piden el Bearer de la app, que la web no guarda y no
// debe guardar). Hasta que el servidor publique el listado por empresa en la consola, la pantalla
// lo dice con claridad y lleva a «Entrar a empresa».

export const TITULO_OTRAS_EMPRESAS = 'Aquí ves los GPS de tu empresa'
export const TEXTO_OTRAS_EMPRESAS =
  'Los GPS registrados dentro de otras empresas se ven entrando a esa empresa, hasta que el servidor permita verlos desde aquí. '
  + 'Si registraste un equipo estando dentro de otra empresa, búscalo allá: tampoco sale en «Detectados sin registrar» porque ya tiene dueño.'
export const ACCION_OTRAS_EMPRESAS = 'Buscar en otra empresa'
/** Donde se elige la empresa y se pulsa «Entrar a empresa». */
export const RUTA_OTRAS_EMPRESAS = '/panel/admin/empresas'

// --- Cuando el servidor publique el listado global (parche T-209) -------------------------
// Cada equipo trae `tenantId` y `tenantName`; la web ya los usa y el aviso de arriba se esconde.

/** ¿El servidor ya manda la empresa de cada equipo? Entonces el listado es de todas las empresas. */
export function hayListadoGlobal(equipos) {
  return (equipos ?? []).some((g) => g.empresaId)
}

/** Las empresas que aparecen en la lista, por nombre: `[{ id, nombre, equipos }]`. */
export function empresasDe(equipos) {
  const por = new Map()
  for (const g of equipos ?? []) {
    if (!g.empresaId) continue
    const e = por.get(g.empresaId) ?? { id: g.empresaId, nombre: g.empresaNombre || 'Empresa sin nombre', equipos: 0 }
    e.equipos += 1
    por.set(g.empresaId, e)
  }
  return [...por.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** Filtro por empresa (`null` o vacío = todas). */
export function deLaEmpresa(equipos, empresaId) {
  return empresaId ? (equipos ?? []).filter((g) => g.empresaId === empresaId) : (equipos ?? [])
}
