import { pedir, empresaGestionActualId } from './api'

const BASE = '/api/v1/console/gps-managed-catalog'
const baseEmpresa = (empresa = empresaGestionActualId()) => empresa
  ? `/api/v1/console/tenants/${idValido(empresa)}/gps-managed-catalog` : BASE
const consultar = (ruta, opciones = {}) => pedir(ruta, { ...opciones, empresaContexto: null })
const idValido = id => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id || '')) throw new Error('Selecciona una definición válida.')
  return id
}
export const listarDefiniciones = ({ category = 'all', status = 'all', offset = 0 } = {}) =>
  consultar(`${baseEmpresa()}?${new URLSearchParams({ category, status, offset: String(offset), limit: '25' })}`)
export const leerDefinicion = (id, empresa = empresaGestionActualId()) => consultar(`${baseEmpresa(empresa)}/${idValido(id)}`)
export const historiaDefinicion = id => consultar(`${baseEmpresa()}/${idValido(id)}/history`)

/** Preserve the caller's key after an uncertain response; never claim a write from a toast. */
export async function guardarDefinicion(id, body, token) {
  const empresa = empresaGestionActualId(), base = baseEmpresa(empresa)
  const receipt = await consultar(id ? `${base}/${idValido(id)}` : base,
    { metodo: id ? 'PUT' : 'POST', cuerpo: body, idempotente: true, idempotencia: token })
  const current = await leerDefinicion(receipt.entryId, empresa)
  const item = current?.items?.[0]
  if (!item || item.id !== receipt.entryId || item.version !== receipt.version
    || item.key !== body.key || item.name !== body.name.trim() || item.status !== body.status) {
    throw new Error('El guardado no quedó verificado. Recarga el catálogo antes de realizar otro cambio.')
  }
  return item
}

export const UNIDADES_FUNCIONES = [
  ['celsius', 'temperature', '°C'], ['fahrenheit', 'temperature', '°F'], ['volt', 'voltage', 'V'],
  ['kilometer', 'distance', 'km'], ['rpm', 'rotation_rate', 'RPM'], ['kph', 'speed', 'km/h'], ['degree', 'angle', '°'],
]

export function cuerpoDefinicion(form, previous) {
  const key = form.key.trim()
  if (!/^[a-z][a-z0-9_.-]{0,39}$/u.test(key)) throw new Error('La clave debe comenzar con letra minúscula y usar hasta 40 letras, números, puntos, guiones o guiones bajos.')
  let definition = null
  if (form.category === 'variable') {
    definition = { semanticKey: key, version: 1, direction: 'observation', risk: 'low',
      maxInstances: Number(form.maxInstances), kind: form.kind, unit: form.kind === 'numeric' ? form.unit : 'none' }
    if (form.kind === 'numeric') {
      const unit = UNIDADES_FUNCIONES.find(u => u[0] === form.unit)
      if (!unit) throw new Error('Selecciona una unidad válida.')
      if ([form.min, form.max, form.precision].some(v => String(v).trim() === '')) throw new Error('Completa el rango y la precisión.')
      Object.assign(definition, { dimension: unit[1], min: Number(form.min), max: Number(form.max), precision: Number(form.precision) })
      if (![definition.min, definition.max].every(Number.isFinite) || definition.min >= definition.max) throw new Error('El mínimo debe ser menor que el máximo.')
    }
    if (form.kind === 'enum') definition.values = form.values.split(',').map(s => s.trim())
  }
  return { key, category: form.category, name: form.name.trim(), description: form.description.trim(),
    status: form.status, expectedVersion: previous?.version ?? 0, reason: form.reason.trim(), definition }
}

export function formularioDefinicion(item) {
  const d = item?.definition
  return { key: item?.key ?? '', category: item?.category ?? 'variable', name: item?.name ?? '',
    description: item?.description ?? '', status: item?.status ?? 'active', reason: '',
    kind: d?.kind ?? 'boolean', unit: d?.unit === 'none' || !d?.unit ? 'celsius' : d.unit,
    min: String(d?.min ?? -40), max: String(d?.max ?? 150), precision: String(d?.precision ?? 2),
    maxInstances: String(d?.maxInstances ?? 1), values: d?.values?.join(', ') ?? '' }
}
