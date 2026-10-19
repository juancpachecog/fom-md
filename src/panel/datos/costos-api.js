const CONSOLA = '/api/v1/console'
const ERROR = 'No se pudo obtener el reporte completo de gastos. Reintenta la consulta.'

/** Días civiles inclusivos en la zona de la empresa, sin restar horas por DST. */
export function rangoCostos(dias, zona, ahora = new Date()) {
  if (![30, 90, 365].includes(dias) || !zona) throw new Error(ERROR)
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(ahora)
  const valor = tipo => partes.find(p => p.type === tipo).value
  const to = `${valor('year')}-${valor('month')}-${valor('day')}`
  const inicio = new Date(`${to}T00:00:00Z`)
  inicio.setUTCDate(inicio.getUTCDate() - dias + 1)
  return { from: inicio.toISOString().slice(0, 10), to, timezone: zona }
}

function centavos(importe) {
  if (typeof importe !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(importe)) throw new Error(ERROR)
  const [entero, fraccion = ''] = importe.split('.')
  return BigInt(entero) * 100n + BigInt(fraccion.padEnd(2, '0'))
}
const decimal = n => `${n / 100n}.${String(n % 100n).padStart(2, '0')}`

/** No pasa importes por Number: conserva céntimos incluso en totales grandes. */
export function importeCostos(importe, moneda) {
  const n = centavosTotal(importe)
  return `${new Intl.NumberFormat('es').format(n / 100n)},${String(n % 100n).padStart(2, '0')} ${moneda}`
}
function centavosTotal(importe) {
  if (typeof importe !== 'string' || !/^\d+\.\d{2}$/.test(importe)) throw new Error(ERROR)
  return BigInt(importe.replace('.', ''))
}

/** Solo GET; la empresa queda fijada durante toda la paginación. */
export function crearCostosApi(consultar, empresaActual) {
  return {
    async resumen({ dias = 30, ahora = new Date() } = {}) {
      const elegida = empresaActual()
      const comprobar = () => { if (empresaActual() !== elegida) throw new Error('La empresa cambió. Vuelve a consultar el reporte.') }
      const leer = async ruta => {
        comprobar()
        const dato = await consultar(ruta, { empresaContexto: null })
        comprobar()
        return dato
      }
      const id = elegida || (await leer(`${CONSOLA}/auth/session`))?.user?.tenantId
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id || '')) throw new Error(ERROR)
      const base = `${CONSOLA}/tenants/${id}`
      // La consola no publica GET /tenants/:id. La propia lectura de gastos
      // entrega la zona del ente: una sonda de un día no se suma al reporte.
      const diaSonda = ahora.toISOString().slice(0, 10)
      const sonda = await leer(`${base}/fleet-expenses?${new URLSearchParams({ from: diaSonda, to: diaSonda, limit: '1', offset: '0' })}`)
      if (sonda?.range?.from !== diaSonda || sonda.range.to !== diaSonda) throw new Error(ERROR)
      const rango = rangoCostos(dias, sonda.range.timezone, ahora)
      const vistos = new Set(), monedas = new Map()
      let offset = 0, total = null
      for (let pagina = 0; pagina < 50; pagina++) {
        const parametros = new URLSearchParams({ from: rango.from, to: rango.to, limit: '200', offset: String(offset) })
        const r = await leer(`${base}/fleet-expenses?${parametros}`)
        if (!Array.isArray(r?.items) || !Number.isSafeInteger(r?.page?.total) || r.page.total < 0 ||
            r.page.offset !== offset || r.page.limit !== 200 || r.page.count !== r.items.length || r.items.length > 200 ||
            r.range?.from !== rango.from || r.range?.to !== rango.to || r.range?.timezone !== rango.timezone ||
            (total !== null && r.page.total !== total)) throw new Error(ERROR)
        total = r.page.total
        for (const gasto of r.items) {
          if (!gasto.id || vistos.has(gasto.id) || !/^[A-Z]{3}$/.test(gasto.currency || '') ||
              typeof gasto.category !== 'string' || !gasto.category ||
              !/^\d{4}-\d{2}-\d{2}$/.test(gasto.expenseDate || '') || gasto.expenseDate < rango.from || gasto.expenseDate > rango.to) throw new Error(ERROR)
          vistos.add(gasto.id)
          const importe = centavos(gasto.amount)
          const grupo = monedas.get(gasto.currency) || { total: 0n, movimientos: 0, categorias: new Map() }
          grupo.total += importe
          grupo.movimientos++
          grupo.categorias.set(gasto.category, (grupo.categorias.get(gasto.category) || 0n) + importe)
          monedas.set(gasto.currency, grupo)
        }
        offset += r.items.length
        if (offset > total || (offset < total && r.items.length === 0)) throw new Error(ERROR)
        if (offset === total) return {
          rango, dias, movimientos: total, costoPorKm: null,
          porMoneda: [...monedas].sort(([a], [b]) => a.localeCompare(b)).map(([moneda, g]) => ({
            moneda, total: decimal(g.total), movimientos: g.movimientos,
            porCategoria: [...g.categorias].sort(([a], [b]) => a.localeCompare(b)).map(([categoria, monto]) => ({ categoria, monto: decimal(monto) })),
          })),
        }
      }
      throw new Error(ERROR)
    },
  }
}
