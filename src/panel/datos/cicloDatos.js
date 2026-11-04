import { pedir } from './api'

const BASE = '/api/v1/console/lifecycle'
const uuid = (value) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value || '')) throw new Error('Selecciona un registro válido.')
  return value
}
const rutaEmpresa = (id) => id === 'global' ? `${BASE}/global` : `${BASE}/tenants/${uuid(id)}`
const consultar = (ruta, opciones = {}) => pedir(ruta, { ...opciones, empresaContexto: null })

export const TIPOS_CICLO = Object.freeze({ tenant: 'Empresa', vehicle: 'Vehículo', user: 'Usuario', gps_device: 'GPS' })
export const claveCiclo = (item) => `${item.type}:${item.id}`
export const estadoCiclo = (estado) => ({ active: 'Activo', inactive: 'Inactivo', archived: 'Retirado',
  revoked: 'Acceso retirado', suspended: 'Suspendido', invited: 'Invitado', onboarding: 'En preparación',
  inventory: 'En inventario', maintenance: 'En mantenimiento', lost: 'Extraviado',
  pending: 'Pendiente', locked: 'Bloqueado', disabled: 'Deshabilitado' })[estado] || 'Estado no disponible'
export const leerCiclo = (empresaId) => consultar(rutaEmpresa(empresaId))
export const candidatosCiclo = (empresaId, { tipo = 'all', q = '', offset = 0 } = {}) =>
  consultar(`${rutaEmpresa(empresaId)}/candidates?${new URLSearchParams({ entityType: tipo, q, offset: String(offset), limit: '50' })}`)
export const registrarRetencion = (empresaId, cuerpo) => consultar(`${rutaEmpresa(empresaId)}/policies`, { metodo: 'POST', cuerpo })
export const crearConjuntoPrueba = (empresaId, reason, idempotencia) => consultar(`${rutaEmpresa(empresaId)}/test-sets`,
  { metodo: 'POST', cuerpo: { reason }, idempotente: true, idempotencia })
export const marcarPrueba = (conjuntoId, item, reason) => consultar(`${BASE}/test-sets/${uuid(conjuntoId)}/entities`,
  { metodo: 'POST', cuerpo: { entityType: item.type, entityId: uuid(item.id), reason } })
export const revisarRetirada = (empresaId, item) => consultar(`${rutaEmpresa(empresaId)}/entities/${encodeURIComponent(item.type)}/${uuid(item.id)}/retirement-preflight`)
export const retirarRegistro = (empresaId, item, reason, idempotencia) => consultar(`${rutaEmpresa(empresaId)}/entities/${encodeURIComponent(item.type)}/${uuid(item.id)}/retire`,
  { metodo: 'POST', cuerpo: { reason, expectedStatus: item.status }, idempotente: true, idempotencia })
export const revisarLimpieza = (conjuntoId) => consultar(`${BASE}/test-sets/${uuid(conjuntoId)}/cleanup-plans`, { metodo: 'POST', cuerpo: {} })
export const limpiarPruebas = (conjuntoId, cuerpo, idempotencia) => consultar(`${BASE}/test-sets/${uuid(conjuntoId)}/cleanup`,
  { metodo: 'POST', cuerpo, idempotente: true, idempotencia })
export const leerReciboLimpieza = (planId) => consultar(`${BASE}/cleanup-receipts/${uuid(planId)}`)

export function versionActual(policies, family) {
  return (policies || []).filter(p => p.family === family).reduce((last, p) => !last || p.version > last.version ? p : last, null)
}
