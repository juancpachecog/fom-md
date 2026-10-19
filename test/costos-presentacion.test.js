import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createServer } from 'vite'

test('pantalla de gastos conserva monedas, categorías y el vacío completo', async () => {
  const server = await createServer({ configFile: false, esbuild: { jsx: 'automatic' }, server: { middlewareMode: true }, logLevel: 'error' })
  try {
    const { default: Costos } = await server.ssrLoadModule('/src/panel/modulos/CostosReales.jsx')
    const rango = { from: '2026-09-19', to: '2026-10-18', timezone: 'America/Caracas' }
    const mostrar = costos => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(Costos, { costos })))
    const html = mostrar({ rango, movimientos: 2, porMoneda: [
      { moneda: 'USD', total: '1.25', movimientos: 1, porCategoria: [{ categoria: 'fuel', monto: '1.25' }] },
      { moneda: 'EUR', total: '2.30', movimientos: 1, porCategoria: [{ categoria: 'other', monto: '2.30' }] },
    ] })
    assert.match(html, /1,25 USD/)
    assert.match(html, /2,30 EUR/)
    assert.match(html, /Combustible/)
    assert.match(html, /America\/Caracas/)
    assert.match(html, /no se convierten ni se suman/)
    assert.match(html, /por separado/)
    assert.doesNotMatch(html, /3,55|No disponible/)
    const vacio = mostrar({ rango, movimientos: 0, porMoneda: [] })
    assert.match(vacio, /Sin gastos registrados/)
    assert.match(vacio, /consulta se completó correctamente/)
    assert.doesNotMatch(vacio, /0,00 USD|no disponible/)
  } finally { await server.close() }
})
