import { empresaActiva } from '../datos/empresaActiva.js'

export function EmpresaActiva({ perfil, admin = false }) {
  const nombre = empresaActiva(perfil, admin)
  return <span className="pnl-empresa-activa" role="status" aria-label={`Empresa activa: ${nombre}`} title={nombre}><small>Empresa activa</small><b>{nombre}</b></span>
}
