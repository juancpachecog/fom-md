import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../../../src/styles/global.css'
import '../../../src/styles/panel.css'

const tenant = '11111111-1111-4111-8111-111111111111'
const vehicle = '33333333-3333-4333-8333-333333333333'
const user = '55555555-5555-4555-8555-555555555555'
const planId = '66666666-6666-4666-8666-666666666666'
const empresaCompleta = new URLSearchParams(location.search).get('empresa') === '1'
const policyLoss = new URLSearchParams(location.search).get('policyLoss')
const expiryPlanId = '77777777-7777-4777-8777-777777777777'
const expiryRecords = [], activations = []
let activationLost = false, stopLost = false, expiryFamily = 'raw_ingress'
let expiryReceipt = null, expiryLost = false
const state = { candidates: empresaCompleta ? [{ type: 'tenant', id: tenant, label: 'Empresa SINTÉTICA', status: 'active' }] : [{ type: 'vehicle', id: vehicle, label: 'Vehículo SINTÉTICO', status: 'active' },
  { type: 'user', id: user, label: 'Usuario SINTÉTICO', status: 'revoked' }], sets: [], policiesByScope: {}, policyLost: false,
  stats: { reads: 0, setRequests: 0, sets: 0, retired: 0, cleaned: 0, receiptReads: 0, jobPosts: 0, queued: 0, policyPosts: 0, policyWrites: 0, policyReads: 0, expiryPlans: 0, expiryPosts: 0, expiredGroups: 0, activationPosts: 0, activations: 0, stopPosts: 0 }, failRead: true, failCreate: true,
  failCleanupResponse: true, receipt: null, pending: false, deletedCompany: false }
let renderStats = () => {}
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url, location.origin).pathname.replace(/^\/fixture-api/u, '')
  const method = options.method || 'GET'
  const body = options.body ? JSON.parse(options.body) : {}
  const finish = value => { renderStats({ ...state.stats }); return response(value) }
  if (!path.startsWith('/api/v1/console/')) throw new Error('Synthetic fixture rejects unrecognized network access')
  if (path.endsWith('/retention-schedule')) return finish({executionEnabled:true,items:activations.filter(a=>a.scope===(path.includes('/global/')?'global':tenant))})
  if (method==='POST' && path.endsWith('/retention-activation')) {
    if(body.confirmation!=='ACTIVAR RETENCION AUTOMATICA'||body.planId!==expiryPlanId) return response({message:'Synthetic activation confirmation rejected'},400)
    state.stats.activationPosts++
    if(!activations.some(a=>a.planId===body.planId&&a.active)) {
      activations.push({activationId:'88888888-8888-4888-8888-888888888888',planId:body.planId,family:expiryFamily,
        scope:path.includes('/global/')?'global':tenant,createdAt:new Date().toISOString(),status:'scheduled',active:true,nextScanAt:new Date(Date.now()+15000).toISOString()})
      state.stats.activations++
    }
    renderStats({...state.stats})
    if(!activationLost){activationLost=true;throw new TypeError('Synthetic activation response lost after persistence')}
    return finish({activationId:activations[0].activationId,replayed:false})
  }
  if(method==='POST'&&path.endsWith('/retention-stop')) {
    state.stats.stopPosts++
    const found=activations.find(a=>a.activationId===body.activationId&&a.scope===(path.includes('/global/')?'global':tenant))
    if(!found||body.confirmation!=='DETENER RETENCION')return response({message:'Synthetic stop confirmation rejected'},400)
    found.active=false;found.status='disabled';found.nextScanAt=null
    renderStats({...state.stats})
    if(!stopLost){stopLost=true;throw new TypeError('Synthetic stop response lost after persistence')}
    return finish({activationId:found.activationId,stopped:true})
  }
  if (path.endsWith('/expiry-history')) return finish({ items: expiryRecords.filter(r => r.scope === (path.includes('/global/') ? 'global' : tenant)) })
  if (method === 'POST' && path.endsWith('/expiry-plans')) {
    state.stats.expiryPlans++; expiryFamily = body.family
    return finish({ planId: expiryPlanId, canDelete: true, executionEnabled: true, recoveryDays: 7,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), asOf: new Date().toISOString(),
      policy: { id: planId, family: body.family, calendarMonths: 6, version: 1, cutoffExclusive: '2026-05-04T00:00:00Z' },
      confirmation: 'EXPIRAR TELEMETRIA', purpose: 'telemetry_expiry', nextCursor: '9007199254740993',
      counts: [{ family: 'gps_raw_messages', count: 1 }, { family: 'gps_raw_message_attempts', count: 1 }], blockers: [] })
  }
  if (method === 'POST' && path.endsWith('/expiry')) {
    if (body.confirmation !== 'EXPIRAR TELEMETRIA' || body.planId !== expiryPlanId) return response({message:'Synthetic expiry confirmation rejected'},400)
    state.stats.expiryPosts++
    if (!expiryReceipt) {
      const record = {planId:expiryPlanId, family:'raw_ingress', scope:path.includes('/global/') ? 'global' : tenant,
        createdAt:new Date().toISOString(),status:'queued'}
      expiryRecords.push(record)
      expiryReceipt={planId:expiryPlanId,jobId:expiryPlanId,status:'queued',remaining:null,counts:[],completedAt:null}
      setTimeout(() => {
        state.stats.expiredGroups++;record.status='completed'
        expiryReceipt={...expiryReceipt,status:'verified',remaining:0,completedAt:new Date().toISOString(),
          counts:[{family:'gps_raw_messages',count:1},{family:'gps_raw_message_attempts',count:1}],recoveryAvailable:true}
        renderStats({...state.stats})
      },3000)
    }
    renderStats({...state.stats})
    if(!expiryLost){expiryLost=true;throw new TypeError('Synthetic expiry response lost after queue persistence')}
    return finish({planId:expiryPlanId,jobId:expiryPlanId,status:'queued',replayed:true})
  }
  if(method==='GET' && path.endsWith('/cleanup-receipts/'+expiryPlanId)) return expiryReceipt ? finish(expiryReceipt) : response({message:'Synthetic expiry receipt absent'},404)
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
    state.stats.jobPosts++
    if (state.receipt) return finish({ planId, status: 'completed', replayed: true })
    if (state.pending) return finish({ planId, jobId: planId, status: 'queued', replayed: true })
    state.pending = true; state.stats.queued++
    state.sets[0].cleanupPlanId = planId; state.sets[0].cleanupStatus = 'queued'
    // Solo ejecutor SINTÉTICO. Una lectura no provoca el borrado; el cambio
    // ocurre después en este transporte falso, independiente de los GET.
    setTimeout(() => {
      state.stats.cleaned++
      const ids = new Set(state.sets[0]?.entities.map(item => item.id))
      state.candidates = state.candidates.filter(item => !ids.has(item.id))
      if (empresaCompleta && ids.has(tenant)) state.deletedCompany = true
      state.pending = false; state.sets[0].cleanupStatus = 'completed'
      state.receipt = { planId, jobId: planId, status: 'verified', remaining: 0, recoveryAvailable: true,
        completedAt: new Date().toISOString(), counts: empresaCompleta ? [{ family: 'tenants', count: 1 }] : [{ family: 'vehicles', count: 1 }, { family: 'users', count: 1 }] }
      renderStats({ ...state.stats })
    }, 3_000)
    renderStats({ ...state.stats })
    if (state.failCleanupResponse) { state.failCleanupResponse = false; throw new TypeError('Synthetic queue response lost after commit') }
    return finish({ planId, jobId: planId, status: 'queued', replayed: false })
  }
  if (method === 'GET' && path.includes('/cleanup-receipts/')) {
    state.stats.receiptReads++
    return state.receipt ? finish(state.receipt) : state.pending
      ? finish({ planId, jobId: planId, status: 'queued', remaining: null, completedAt: null, counts: [], recoveryAvailable: false })
      : response({ message: 'Synthetic receipt not found' }, 404)
  }
  if (method === 'POST' && path.endsWith('/policies')) {
    state.stats.policyPosts++
    const scope = path.includes('/lifecycle/global/') ? 'global' : tenant
    const policies = state.policiesByScope[scope] ??= []
    const last = policies.filter(p => p.family === body.family).sort((a, b) => b.version - a.version)[0]
    if ((last?.version ?? 0) === body.expectedVersion) {
      policies.push({ ...body, version: body.expectedVersion + 1 }); state.stats.policyWrites++
    } else if (!(last?.version === body.expectedVersion + 1 && last.calendarMonths === body.calendarMonths && last.reason === body.reason)) {
      return response({ message: 'Synthetic policy version conflict' }, 409)
    }
    renderStats({ ...state.stats })
    if (!state.policyLost && state.stats.policyPosts === (policyLoss === 'first' ? 1 : policyLoss === 'second' ? 2 : -1)) {
      state.policyLost = true
      throw new TypeError('Synthetic policy response lost after persistence')
    }
    return finish({ id: planId })
  }
  if (path.includes('/lifecycle/tenants/') || path.endsWith('/lifecycle/global')) {
    const global = path.endsWith('/lifecycle/global')
    state.stats.policyReads++
    return finish({ policies: state.policiesByScope[global ? 'global' : tenant] ?? [], testSets: global ? [] : state.sets, purgeEnabled: false,
      historicalOnly: !global && state.deletedCompany,
      historicalScopes: global && state.deletedCompany ? [{ id: tenant, reason: state.sets[0].reason, lastActivityAt: state.receipt.completedAt }] : [] })
  }
  // El componente de esta prueba no requiere una sesión nominal.
  return response({ message: 'Synthetic route not configured' }, 404)
}

const { default: repo } = await import('../../../src/panel/datos/repo')
repo.admin.empresas.listar = async () => state.deletedCompany ? [] : [{ id: tenant, nombre: 'Empresa SINTÉTICA' }]
const { default: AdminCicloDatos } = await import('../../../src/panel/modulos/AdminCicloDatos')

function Fixture() {
  const [stats, setStats] = useState(state.stats)
  renderStats = setStats
  return <MemoryRouter><div data-tema={new URLSearchParams(location.search).get('tema') || 'claro'}><main className="pnl" style={{ padding: 24, display: 'block' }}><h1>SINTÉTICO · ciclo de datos</h1>
    <p>Sin servidor nominal, credenciales, GPS, SMS ni datos reales. No es evidencia de producción.</p>
    <output id="fixture-counters">{JSON.stringify(stats)}</output><AdminCicloDatos /></main></div></MemoryRouter>
}
createRoot(document.getElementById('root')).render(<Fixture />)
