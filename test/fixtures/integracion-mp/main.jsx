import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import NuevaUnidadEmpresa from '../../../src/panel/comp/NuevaUnidadEmpresa'
import { useConfirmar } from '../../../src/panel/comp/Confirmar'
import { ComandosMeitrackFicha } from '../../../src/panel/modulos/AdminGpsMeitrack'
import repo from '../../../src/panel/datos/repo'
import { api } from '../../../src/panel/datos/api'
import '../../../src/styles/panel.css'
import '../../../src/panel/modulos/admin-gps.css'

const counters = { inventario: 0, altas: 0, instalaciones: 0 }
let renderCounters = () => {}
const contar = nombre => { counters[nombre]++; renderCounters({ ...counters }) }
repo.admin.gps.disponibles = async () => {
  contar('inventario')
  if (counters.inventario === 1) throw new Error('Synthetic inventory unavailable')
  return [{ id: 'gps-synthetic', modelo: 'GPS de prueba', imei: 'SINTÉTICO' }]
}
api.crearVehiculo = async () => { contar('altas'); return { vehicleId: 'vehicle-synthetic' } }
repo.admin.gps.instalar = async () => {
  contar('instalaciones')
  if (counters.instalaciones === 1) throw new Error('Fallo sintético de instalación')
}

function Fixture() {
  const [stats, setStats] = useState({ ...counters })
  renderCounters = setStats
  const [abierto, setAbierto] = useState(false)
  const [resultado, setResultado] = useState('Sin acciones')
  const { confirmar, dialogo } = useConfirmar()
  return <main style={{ padding: 30, maxWidth: 780, margin: 'auto' }}>
    <h1>Integración MP · SINTÉTICO</h1>
    <p>Sin servidor nominal, equipo físico, SMS ni cambios reales.</p>
    <p role="status">Inventario: {stats.inventario} · Altas: {stats.altas} · Instalaciones: {stats.instalaciones}</p>
    <button className="pnl-btn" onClick={() => setAbierto(true)}>Probar nueva unidad</button>
    <button className="pnl-btn" onClick={async () => setResultado(await confirmar({ titulo: 'Confirmación sintética', texto: 'No realiza ninguna operación real.', accion: 'Aceptar prueba', peligro: true }) ? 'Confirmación aceptada' : 'Confirmación cancelada')}>Probar confirmación</button>
    <p role="status">{resultado}</p>
    <ComandosMeitrackFicha equipo={{ protocolo: 'meitrack-t399' }} />
    <NuevaUnidadEmpresa abierto={abierto} empresas={[{ id: 'empresa-synthetic', nombre: 'Empresa sintética' }]}
      empresaInicial="empresa-synthetic" propia="empresa-synthetic" ofrecerGps
      alCerrar={() => setAbierto(false)} alListo={() => { setAbierto(false); setResultado('Unidad sintética creada e instalada') }} />
    {dialogo}
  </main>
}
createRoot(document.getElementById('root')).render(<MemoryRouter><div className="pnl" style={{ display: 'block', minHeight: '100vh' }}><Fixture /></div></MemoryRouter>)
