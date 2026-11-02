import { api } from './api.js'
import { empresaDeInstalacion } from './instalarGps.js'
import { cuerpoUnidad, mensajeCrearUnidad } from './unidadEnEmpresa.js'

// La llamada de T-215: crear la unidad en una empresa sin entrar a ella.

/**
 * Crea la unidad en la empresa elegida, por la ruta de ESA empresa y sin cambiar de empresa.
 * La propia viaja por la ruta propia (`null`), igual que la instalación; otra, por la suya.
 * Devuelve `{ id, alias }`. Si el servidor no dice el id, se avisa: reintentar crearía otra.
 */
export async function crearUnidadEnEmpresa({ empresaId, propia = null, datos }) {
  const cuerpo = cuerpoUnidad(datos)
  // Sin saber cuál es la propia, manda la empresa elegida (nunca caer en la ruta de otra).
  const ruta = propia ? empresaDeInstalacion(empresaId, propia) : empresaId
  let r
  try {
    r = await api.crearVehiculo(cuerpo, ruta)
  } catch (e) {
    const error = new Error(mensajeCrearUnidad(e))
    error.estado = e?.estado
    throw error
  }
  const id = r?.vehicleId ?? r?.vehicle?.id ?? null
  if (!id) throw new Error('El servidor no devolvió el identificador de la unidad creada. Revisa la flota de la empresa antes de reintentar.')
  return { id, alias: cuerpo.alias }
}
