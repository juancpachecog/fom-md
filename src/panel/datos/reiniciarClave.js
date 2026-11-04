// Reiniciar la clave de una persona (T-210), sin pantalla ni red para poder probarlo.
//
// El servidor (fom-core, console-tenant-fleet-admin.controller) tiene dos rutas:
//  - `POST /console/users/:userId/credential-reset`: solo encuentra personas de la empresa
//    PROPIA de quien pregunta; con una persona de otra empresa responde 404 «Not found».
//  - `POST /console/tenants/:tenantId/users/:userId/credential-reset`: la misma acción dentro
//    de la empresa de la persona, que el servidor vuelve a autorizar.
// No pide `Idempotency-Key`: cada intento genera una clave temporal nueva.

/**
 * Por qué ruta viaja el reinicio, igual que `empresaDeInstalacion` con los equipos GPS.
 *  - `undefined`: no se sabe la empresa de la persona → la ruta normal (la de la empresa en
 *    gestión, si hay una).
 *  - `null`: la persona es de la empresa propia → la ruta propia, aunque el administrador
 *    esté «dentro» de otra empresa.
 *  - un id: la ruta `/tenants/{id}` de la empresa de la persona.
 */
export function empresaDeReinicio(empresaDeLaPersona, propia) {
  if (!empresaDeLaPersona) return undefined
  return empresaDeLaPersona === propia ? null : empresaDeLaPersona
}

/** El error del servidor, en llano. Lo que ya viene en español (sin ruta, sin sesión…) se respeta. */
export function mensajeReiniciarClave(error) {
  const base = error?.message || 'No se pudo restablecer la clave.'
  if (/^Esta función todavía no está/u.test(base)) return base
  if (error?.estado === 404) {
    return 'No se encontró a esa persona en su empresa, o su acceso ya no está activo. Recarga la lista e inténtalo de nuevo.'
  }
  if (error?.estado === 409) {
    return 'Esa persona todavía no tiene una clave creada, así que no hay nada que restablecer.'
  }
  if (error?.estado === 403 && !/temporal/u.test(base)) {
    return 'No tienes permiso para restablecer la clave de esta persona. Solo se puede con quien tiene un rango menor al tuyo.'
  }
  return base
}
