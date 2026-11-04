import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../../../src/styles/panel.css'

const tenant = '11111111-1111-4111-8111-111111111111'
const vehicle = '33333333-3333-4333-8333-333333333333'
const user = '55555555-5555-4555-8555-555555555555'
const planId = '66666666-6666-4666-8666-666666666666'
const state = { candidates: [{ type: 'vehicle', id: vehicle, label: 'Vehículo SINTÉTICO', status: 'active' },
  { type: 'user', id: user, label: 'Usuario SINTÉTICO', status: 'revoked' }], sets: [], policies: [],
  stats: { reads: 0, setRequests: 0, sets: 0, retired: 0, cleaned: 0, receiptReads: 0 }, failRead: true, failCreate: true,
  failCleanupResponse: true, receipt: null }
let renderStats = () => {}
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url, location.origin).pathname.replace(/^\/fixture-api/u, '')
  const method = options.method || 'GET'
  const body = options.body ? JSON.parse(options.body) : {}
  const finish = value => { renderStats({ ...state.stats }); return response(value) }
  if (!path.startsWith('/api/v1/console/')) throw new Error('Synthetic fixture rejects unrecognized network access')
  if (path.endsWith('/candidates')) {
    state.stats.reads++
    renderStats({ ...state.stats })
    if (state.failRead) { state.failRead = false; return response({ message: 'Inventario SINTÉTICO temporalmente no disponible' }, 503) }
    return finish({ items: state.candidates, total: state.candidates.length, offset: 0, limit: 50 })
  }
  if (path.endsWith('/retirement-preflight')) return finish({ canRetire: true, message: 'Preflight SINTÉTICO.' })
  if (path.endsWith('/retire')) {
    state.candidates.find(item => path.includes(item.id)).status = 'archived'
    state.stats.retired++
    return finish({ historyRetained: true })
  }
  if (method === 'POST' && path.endsWith('/test-sets')) {
    state.stats.setRequests++
    const key = options.headers['idempotency-key']
    if (!state.sets.some(s => s.id === key)) { state.stats.sets++; state.sets.push({ id: key, reason: body.reason, entities: [] }) }
    renderStats({ ...state.stats })
    if (state.failCreate) { state.failCreate = false; throw new TypeError('Synthetic response lost after persistence') }
    return finish({ id: key })
  }
  if (method === 'POST' && path.endsWith('/entities')) {
    const set = state.sets.find(s => path.includes(s.id))
    if (!set.entities.some(item => item.id === body.entityId)) set.entities.push({ type: body.entityType, id: body.entityId })
    return finish({ recorded: true })
  }
  if (method === 'POST' && path.endsWith('/cleanup-plans')) return finish({ planId, canDelete: true,
    executionEnabled: true, recoveryDays: 7, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    counts: [{ family: 'synthetic', label: 'Registros SINTÉTICOS', count: state.sets[0]?.entities.length ?? 0 }],
    blockers: [], message: 'Plan SINTÉTICO: ninguna conexión ni eliminación nominal.' })
  if (path.endsWith('/cleanup')) {
    if (body.confirmation !== 'ELIMINAR PRUEBAS') return response({ message: 'Synthetic confirmation rejected' }, 400)
    if (state.receipt) return finish({ planId, status: 'completed', replayed: true })
    state.stats.cleaned++
    const ids = new Set(state.sets[0]?.entities.map(item => item.id))
    state.candidates = state.candidates.filter(item => !ids.has(item.id))
    state.receipt = { planId, status: 'verified', remaining: 0, recoveryAvailable: true,
      completedAt: new Date().toISOString(), counts: [{ family: 'vehicles', count: 1 }, { family: 'users', count: 1 }] }
    renderStats({ ...state.stats })
    if (state.failCleanupResponse) { state.failCleanupResponse = false; throw new TypeError('Synthetic cleanup response lost after commit') }
    return finish({ planId, status: 'completed', replayed: false })
  }
  if (method === 'GET' && path.includes('/cleanup-receipts/')) {
    state.stats.receiptReads++
    return state.receipt ? finish(state.receipt) : response({ message: 'Synthetic receipt not found' }, 404)
  }
  if (method === 'POST' && path.endsWith('/policies')) {
    state.policies.push({ ...body, version: body.expectedVersion + 1 })
    return finish({ id: planId })
  }
  if (path.includes('/lifecycle/tenants/') || path.endsWith('/lifecycle/global')) return finish({ policies: state.policies, testSets: state.sets, purgeEnabled: false })
  // El componente de esta prueba no requiere una sesión nominal.
  return response({ message: 'Synthetic route not configured' }, 404)
}

const { default: repo } = await import('../../../src/panel/datos/repo')
repo.admin.empresas.listar = async () => [{ id: tenant, nombre: 'Empresa SINTÉTICA' }]
const { default: AdminCicloDatos } = await import('../../../src/panel/modulos/AdminCicloDatos')

function Fixture() {
  const [stats, setStats] = useState(state.stats)
  renderStats = setStats
  return <MemoryRouter><main style={{ padding: 24 }}><h1>SINTÉTICO · ciclo de datos</h1>
    <p>Sin servidor nominal, credenciales, GPS, SMS ni datos reales. No es evidencia de producción.</p>
    <output id="fixture-counters">{JSON.stringify(stats)}</output><AdminCicloDatos /></main></MemoryRouter>
}
createRoot(document.getElementById('root')).render(<Fixture />)
