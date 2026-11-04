// Reglas puras (sin red ni pantalla). La llamada al servidor vive en unidadEnEmpresaApi.js.
// Crear una unidad EN una empresa desde la consola del administrador FOM, sin «entrar» a ella (T-215).
//
// Lo que dice el servidor (fom-core, console-tenant-fleet-admin.controller):
//  - `POST /console/tenants/{id}/vehicles` da de alta la unidad en esa empresa. Solo exige `code`;
//    la placa, la marca y el modelo se piden aquí para que la unidad no nazca a medias.
//  - `POST /console/tenants/{id}/gps-devices/{equipo}/installation` instala el equipo en una unidad
//    de esa empresa. Desde el inventario global (#749) el equipo no tiene que ser de la misma empresa.

/** Topes del servidor (CreateVehicleDto). */
export const LIMITES_UNIDAD = { numero: 30, codigo: 60, placa: 20, alias: 80, marca: 80, modelo: 80 }

export const TIPOS_UNIDAD = [
  { v: 'camioneta', t: 'Camioneta' },
  { v: 'camion', t: 'Camión' },
  { v: 'auto', t: 'Automóvil' },
  { v: 'otro', t: 'Otro' },
]

export const UNIDAD_VACIA = { numero: '', placa: '', marca: '', modelo: '', anio: '', tipo: 'camioneta' }

/** Lo que falta o sobra en el formulario, en llano. `{}` si todo está bien. */
export function validarUnidad(datos) {
  const d = datos ?? {}
  const t = (v) => String(v ?? '').trim()
  const errores = {}
  if (!t(d.numero)) errores.numero = 'Escribe el número o código de la unidad.'
  else if (t(d.numero).length > LIMITES_UNIDAD.numero) errores.numero = `Máximo ${LIMITES_UNIDAD.numero} caracteres.`
  if (!t(d.placa)) errores.placa = 'Escribe la placa.'
  else if (t(d.placa).length > LIMITES_UNIDAD.placa) errores.placa = `Máximo ${LIMITES_UNIDAD.placa} caracteres.`
  if (!t(d.marca)) errores.marca = 'Escribe la marca.'
  else if (t(d.marca).length > LIMITES_UNIDAD.marca) errores.marca = `Máximo ${LIMITES_UNIDAD.marca} caracteres.`
  if (!t(d.modelo)) errores.modelo = 'Escribe el modelo.'
  else if (t(d.modelo).length > LIMITES_UNIDAD.modelo) errores.modelo = `Máximo ${LIMITES_UNIDAD.modelo} caracteres.`
  if (t(d.anio)) {
    const n = Number(t(d.anio))
    if (!Number.isInteger(n) || n < 1950 || n > 2100) errores.anio = 'El año va entre 1950 y 2100.'
  }
  return errores
}

/** El cuerpo que el servidor espera (`CreateVehicleDto`). */
export function cuerpoUnidad(datos) {
  const t = (v) => String(v ?? '').trim()
  const numero = t(datos.numero)
  return {
    // El código es único dentro de la empresa; se arma con el número, sin espacios.
    code: numero.toLowerCase().replace(/\s+/gu, '-').slice(0, LIMITES_UNIDAD.codigo),
    alias: numero.slice(0, LIMITES_UNIDAD.alias),
    fleetNumber: numero.slice(0, LIMITES_UNIDAD.numero),
    plate: t(datos.placa),
    make: t(datos.marca),
    model: t(datos.modelo),
    modelYear: t(datos.anio) ? Number(t(datos.anio)) : undefined,
    vehicleType: t(datos.tipo) || undefined,
  }
}

/** El mensaje, en llano, cuando el servidor rechaza el alta de la unidad. */
export function mensajeCrearUnidad(error) {
  if (error?.estado === 409) return 'Esa empresa ya tiene una unidad con ese número o esa placa. Cámbialo o búscala en su flota.'
  if (error?.estado === 400) return 'El servidor no aceptó los datos de la unidad. Revisa el número, la placa, la marca y el modelo.'
  if (error?.estado === 403) return 'No tienes permiso para crear unidades en esa empresa.'
  if (error?.estado === 404) return 'El servidor no encontró esa empresa. Recarga la pantalla y vuelve a elegirla.'
  if (error?.estado === 501) return 'El servidor todavía no permite crear unidades desde aquí. Entra a la empresa y créala desde su flota.'
  return error?.message || 'No se pudo crear la unidad. Inténtalo de nuevo.'
}
