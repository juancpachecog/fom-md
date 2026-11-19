import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../../src/styles/global.css'
import '../../../src/styles/panel.css'
import EliminarEmpresa from '../../../src/panel/modulos/EliminarEmpresa'

const tenant = '11111111-1111-4111-8111-111111111111', id = '33333333-3333-4333-8333-333333333333'
let status = 'ready', confirms = 0, closed = false, reads = 0
const request = () => ({ tenantId: tenant, requestId: id, companyName: 'Empresa SINTÉTICA',
  status, includesBackups: true, canConfirm: status === 'ready', planSha256: 'a'.repeat(64),
  checkedAt: new Date().toISOString(), planExpiresAt: new Date(Date.now() + 300000).toISOString(),
  copiesTotal: 2, copiesVerified: 0, liveDeleted: false, complete: false,
  confirmedAt: status === 'queued' ? new Date().toISOString() : null,
  counts: [{ family: 'vehicles', count: 2 }, { family: 'tenant_memberships', count: 3 }, { family: 'gps_positions', count: 100 }] })
const respond = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
globalThis.fetch = async (url, options = {}) => {
  const path = new URL(url, location.origin).pathname
  if (!path.includes('/api/v1/console/lifecycle/')) throw Error('Synthetic fixture rejects other destinations')
  const method = options.method || 'GET'
  if (method === 'GET') { reads++; return respond(request()) }
  if (path.endsWith('/company-deletion-plans')) return respond(request())
  if (path.endsWith('/confirm')) {
    const body = JSON.parse(options.body)
    if (body.confirmation !== 'Empresa SINTÉTICA' || body.includesBackups !== true || body.planSha256 !== 'a'.repeat(64)) throw Error('Synthetic invalid confirmation')
    confirms++; status = 'queued'
    document.getElementById('proof').textContent = `SINTÉTICO: confirmaciones=${confirms}; resultado pendiente; consultas=${reads}`
    throw new TypeError('Synthetic response lost after confirmation')
  }
  if (path.endsWith('/cancel')) { status = 'cancelled'; return respond(request()) }
  throw Error('Synthetic fixture rejects unexpected operation')
}
function App() {
  const [open, setOpen] = React.useState(true)
  return <div data-tema="oscuro"><main className="pnl" style={{ padding: 24, display: 'block' }}><h1>Eliminación · prueba SINTÉTICA</h1><p id="proof">Sin datos reales. Ningún borrado se ejecuta.</p>
    {closed && <p>Ventana cerrada. La solicitud confirmada se conserva.</p>}
    {open && <EliminarEmpresa empresa={{ id: tenant, nombre: 'Empresa SINTÉTICA' }} alCerrar={() => { closed = true; setOpen(false) }} />}
  </main></div>
}
createRoot(document.getElementById('root')).render(<App />)
