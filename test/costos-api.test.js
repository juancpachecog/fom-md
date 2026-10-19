import test from 'node:test'
import assert from 'node:assert/strict'
import { crearCostosApi, rangoCostos, importeCostos } from '../src/panel/datos/costos-api.js'

const empresa = '11111111-1111-4111-8111-111111111111'
const hogar = '22222222-2222-4222-8222-222222222222'
const ahora = new Date('2026-10-19T02:00:00Z')
const rango = { from: '2026-09-19', to: '2026-10-18', timezone: 'America/Caracas' }
const gasto = (id, amount = '0.10', currency = 'USD', category = 'fuel') => ({ id, amount, currency, category, expenseDate: '2026-10-01' })
function fuente(filas = [], { elegir = () => empresa, pagina, fallar } = {}) {
  const llamadas = []
  const repo = crearCostosApi(async (ruta, opciones) => {
    llamadas.push({ ruta, opciones })
    if (ruta.endsWith('/auth/session')) return { user: { tenantId: hogar } }
    const url = new URL(ruta, 'https://ejemplo.test')
    if (!url.pathname.endsWith('/fleet-expenses')) return { tenant: { id: url.pathname.split('/').at(-1), timezone: 'America/Caracas' } }
    if (fallar) throw new Error('HTTP 503')
    if (url.searchParams.get('limit') === '1') return {
      items: [], page: { offset: 0, limit: 1, count: 0, total: 0 },
      range: { from: url.searchParams.get('from'), to: url.searchParams.get('to'), timezone: 'America/Caracas' },
    }
    const offset = Number(url.searchParams.get('offset'))
    const items = filas.slice(offset, offset + 200)
    const respuesta = { items, page: { offset, limit: 200, count: items.length, total: filas.length }, range: rango }
    return pagina ? pagina(respuesta, llamadas) : respuesta
  }, elegir)
  return { repo, llamadas }
}

test('rango inclusivo respeta medianoche de la empresa, año bisiesto y DST', () => {
  assert.deepEqual(rangoCostos(30, 'America/Caracas', ahora), rango)
  assert.equal(rangoCostos(30, 'UTC', new Date('2024-03-01T12:00:00Z')).from, '2024-02-01')
  assert.equal(rangoCostos(30, 'America/New_York', new Date('2026-03-20T12:00:00Z')).from, '2026-02-19')
  assert.equal(rangoCostos(365, 'UTC', new Date('2026-01-01T00:00:00Z')).from, '2025-01-02')
  assert.throws(() => rangoCostos(0, 'UTC', ahora))
  assert.throws(() => rangoCostos(30, null, ahora))
})

test('vacío completo es éxito sin inventar moneda, total o costo/km', async () => {
  const { repo, llamadas } = fuente()
  const r = await repo.resumen({ ahora })
  assert.equal(r.movimientos, 0)
  assert.deepEqual(r.porMoneda, [])
  assert.equal(r.costoPorKm, null)
  assert.equal('total' in r, false)
  assert.equal(llamadas.length, 2)
})

test('recorre más de una página y suma centavos por categoría y moneda', async () => {
  const filas = Array.from({ length: 201 }, (_, i) => gasto(`g${i}`))
  filas.push(gasto('eur', '3.23', 'EUR', 'other'))
  const { repo, llamadas } = fuente(filas)
  const r = await repo.resumen({ ahora })
  assert.deepEqual(r.porMoneda.map(g => [g.moneda, g.total, g.movimientos]), [['EUR', '3.23', 1], ['USD', '20.10', 201]])
  assert.deepEqual(r.porMoneda[1].porCategoria, [{ categoria: 'fuel', monto: '20.10' }])
  const urls = llamadas.filter(c => c.ruta.includes('fleet-expenses') && c.ruta.includes('limit=200')).map(c => new URL(c.ruta, 'https://ejemplo.test'))
  assert.deepEqual(urls.map(u => u.searchParams.get('offset')), ['0', '200'])
  assert.ok(urls.every(u => u.pathname.includes(`/tenants/${empresa}/`) && u.searchParams.get('from') === rango.from))
  assert.ok(llamadas.every(c => c.opciones.empresaContexto === null && !c.opciones.metodo && !c.opciones.cuerpo))
})

test('sin empresa elegida usa exclusivamente el hogar de la sesión', async () => {
  const { repo, llamadas } = fuente([], { elegir: () => null })
  await repo.resumen({ ahora })
  assert.equal(llamadas.length, 3)
  assert.match(llamadas[2].ruta, new RegExp(`/tenants/${hogar}/fleet-expenses`))
})

test('si cambia la empresa descarta el resultado y no consulta otra empresa', async () => {
  let actual = empresa
  const { repo, llamadas } = fuente([gasto('g1')], { elegir: () => actual, pagina: r => { actual = hogar; return r } })
  await assert.rejects(repo.resumen({ ahora }), /empresa cambió/)
  assert.ok(llamadas.every(c => !c.ruta.includes(hogar)))
})

test('503 no se presenta como período sin gastos', async () => {
  const { repo } = fuente([], { fallar: true })
  await assert.rejects(repo.resumen({ ahora }), /503/)
})

test('rechaza páginas repetidas, truncadas y un total que cambia', async () => {
  const filas = Array.from({ length: 201 }, (_, i) => gasto(`g${i}`))
  for (const modificar of [
    r => r.page.offset ? { ...r, items: [filas[0]] } : r,
    r => r.page.offset ? { ...r, items: [], page: { ...r.page, count: 0 } } : r,
    r => r.page.offset ? { ...r, page: { ...r.page, total: 202 } } : r,
  ]) {
    const { repo } = fuente(filas, { pagina: modificar })
    await assert.rejects(repo.resumen({ ahora }), /reporte completo/)
  }
})

test('un contrato mal formado, otra zona/rango o importe desconocido no produce totales', async () => {
  for (const modificar of [
    r => ({ ...r, range: { ...r.range, timezone: 'UTC' } }),
    r => ({ ...r, range: { ...r.range, from: '2026-01-01' } }),
    r => ({ ...r, page: { ...r.page, total: '1' } }),
    r => ({ ...r, items: null }),
    r => ({ ...r, items: [{ ...r.items[0], amount: null }] }),
    r => ({ ...r, items: [{ ...r.items[0], amount: '1.234' }] }),
    r => ({ ...r, items: [{ ...r.items[0], currency: null }] }),
    r => ({ ...r, items: [{ ...r.items[0], expenseDate: '2027-01-01' }] }),
  ]) {
    const { repo } = fuente([gasto('g1')], { pagina: modificar })
    await assert.rejects(repo.resumen({ ahora }), /reporte completo/)
  }
})

test('totales grandes y su presentación conservan centavos sin conversión a float', async () => {
  const { repo } = fuente(Array.from({ length: 100 }, (_, i) => gasto(`g${i}`, '999999999999.99')))
  const r = await repo.resumen({ ahora })
  assert.equal(r.porMoneda[0].total, '99999999999999.00')
  assert.match(importeCostos('99999999999999.99', 'USD'), /,99 USD$/)
})
