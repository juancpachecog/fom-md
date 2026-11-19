const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu
const HASH = /^[a-f0-9]{64}$/u
const ESTADOS = new Set(['reviewing', 'ready', 'queued', 'deleting_live', 'sanitizing_backups', 'blocked', 'completed', 'cancelled'])
export const AVISO_ELIMINACION_EMPRESA = 'Precaución: se eliminarán todos los datos propios de esta empresa, incluido su historial y sus datos en los respaldos. La eliminación es definitiva. Revisa la empresa seleccionada antes de confirmar.'
export const AVISO_IMAGENES_PENDIENTES = 'Las fotos y logos alojados en Cloudinary quedarán pendientes de eliminación hasta recuperar el acceso a esa cuenta. El resultado indicará cualquier dato que siga pendiente.'
export const uuidEliminacion = valor => {
  if (typeof valor !== 'string' || !UUID.test(valor)) throw new Error('Selecciona una empresa o solicitud válida.')
  return valor.toLowerCase()
}

export function validarSolicitudEmpresa(solicitud, empresaId) {
  if (!solicitud || solicitud.tenantId !== uuidEliminacion(empresaId) || !UUID.test(solicitud.requestId || '')
    || !ESTADOS.has(solicitud.status) || solicitud.includesBackups !== true) {
    throw new Error('No se pudo comprobar que la revisión corresponde a esta empresa y sus respaldos.')
  }
  return solicitud
}

export function puedeConfirmarEliminacion(solicitud, empresaId, nombre) {
  try { validarSolicitudEmpresa(solicitud, empresaId) } catch { return false }
  return solicitud.status === 'ready' && solicitud.canConfirm === true && HASH.test(solicitud.planSha256 || '')
    && typeof solicitud.companyName === 'string' && solicitud.companyName.length > 0
    && nombre === solicitud.companyName && Number.isFinite(Date.parse(solicitud.checkedAt))
    && Date.parse(solicitud.planExpiresAt) > Date.parse(solicitud.checkedAt)
}

export function eliminacionComprobada(solicitud, empresaId) {
  try { validarSolicitudEmpresa(solicitud, empresaId) } catch { return false }
  return solicitud.status === 'completed' && solicitud.complete === true && solicitud.liveDeleted === true
    && Number.isSafeInteger(solicitud.copiesTotal) && solicitud.copiesTotal >= 0
    && solicitud.copiesVerified === solicitud.copiesTotal && !solicitud.failureCode
}

export const estadoEliminacionEmpresa = estado => ({
  reviewing: 'Revisando datos y respaldos', ready: 'Revisión lista para confirmar', queued: 'Eliminación en cola',
  deleting_live: 'Eliminando datos de la empresa', sanitizing_backups: 'Eliminando sus datos de los respaldos',
  blocked: 'Eliminación pendiente de resolver', completed: 'Comprobando el resultado final', cancelled: 'Revisión cancelada',
})[estado] || 'Estado pendiente de comprobar'

export const problemaEliminacionEmpresa = codigo => ({
  executor_unavailable: 'El servicio de eliminación no está disponible. Consulta de nuevo el estado.',
  schema_changed: 'La estructura de datos cambió. Hace falta una revisión nueva.',
  company_changed: 'Los datos de la empresa cambiaron. Revisa el alcance de nuevo.',
  scope_unavailable: 'La empresa o el administrador ya no están disponibles para este proceso.',
  shared_data: 'Hay datos compartidos que necesitan separarse para conservar la información de otras empresas.',
  unclassified_copy: 'Hay una copia pendiente de clasificar. La eliminación todavía no está completa.',
  copy_not_restorable: 'No se pudo comprobar la recuperación de una copia compartida.',
  copy_replacement_failed: 'Una copia sigue pendiente de sustituir por su versión sin los datos de la empresa.',
  source_changed: 'Una copia cambió durante la revisión. Hay que comprobarla otra vez.',
  retained_data_changed: 'La comprobación de los datos de otras empresas no coincide. El proceso se detuvo.',
  live_data_remaining: 'Todavía quedan datos de la empresa en la aplicación.',
  backup_data_remaining: 'Todavía quedan copias con datos de la empresa.',
  resource_limit: 'El volumen supera los límites de esta ejecución. El proceso requiere una ventana de mantenimiento.',
})[codigo] || (codigo ? 'Hay una comprobación pendiente. Consulta de nuevo el estado.' : '')

export function resumenEliminacionEmpresa(solicitud) {
  const cantidades = new Map((Array.isArray(solicitud?.counts) ? solicitud.counts : [])
    .filter(c => typeof c?.family === 'string' && Number.isSafeInteger(c.count) && c.count >= 0)
    .map(c => [c.family, c.count]))
  return [
    ['Vehículos', cantidades.get('vehicles') || 0], ['Accesos', cantidades.get('tenant_memberships') || 0],
    ['Ubicaciones', cantidades.get('gps_positions') || 0],
    ['Registros en total', [...cantidades.values()].reduce((s, n) => s + n, 0)],
  ]
}

export function crearClienteEliminacionEmpresas(consultar) {
  const base = '/api/v1/console/lifecycle'
  const pedir = (ruta, opciones = {}) => consultar(ruta, { ...opciones, empresaContexto: null })
  const ruta = empresaId => `${base}/tenants/${uuidEliminacion(empresaId)}`
  return {
    preparar: (empresaId, clave) => pedir(`${ruta(empresaId)}/company-deletion-plans`, {
      metodo: 'POST', cuerpo: {}, idempotente: true, idempotencia: uuidEliminacion(clave),
    }),
    listar: () => pedir(`${base}/company-deletions`),
    leer: id => pedir(`${base}/company-deletions/${uuidEliminacion(id)}`),
    confirmar: (empresaId, id, planSha256, confirmation) => {
      if (!HASH.test(planSha256 || '') || typeof confirmation !== 'string' || !confirmation.length || confirmation.length > 160)
        throw new Error('Revisa la empresa y escribe su nombre completo.')
      return pedir(`${ruta(empresaId)}/company-deletions/${uuidEliminacion(id)}/confirm`, {
        metodo: 'POST', cuerpo: { planSha256, confirmation, includesBackups: true },
      })
    },
    cancelar: (empresaId, id) => pedir(`${ruta(empresaId)}/company-deletions/${uuidEliminacion(id)}/cancel`, { metodo: 'POST', cuerpo: {} }),
  }
}
