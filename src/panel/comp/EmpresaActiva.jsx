import { empresaActiva } from '../datos/empresaActiva.js'

export function EmpresaActiva({ perfil, admin = false, alPulsar, abierto = false }) {
  const nombre = empresaActiva(perfil, admin)
  if (alPulsar) return (
    <button type="button" className="pnl-empresa-activa pnl-empresa-cambiar"
      aria-label={`Cambiar empresa. Empresa activa: ${nombre}`} aria-haspopup="dialog"
      aria-expanded={abierto} onClick={alPulsar} title={nombre}>
      <small>Empresa activa</small><b>{nombre}</b>
    </button>
  )
  return <span className="pnl-empresa-activa" role="status" aria-label={`Empresa activa: ${nombre}`} title={nombre}><small>Empresa activa</small><b>{nombre}</b></span>
}
