import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { entrarEmpresa, salirEmpresa } from '../auth'
import { Cabecera, Cargando, ErrorCarga, Buscador, Tag } from '../comp/ui'
import LogoEmpresa from '../comp/LogoEmpresa'
import './seleccion-empresa.css'

export default function SeleccionEmpresa() {
  const empresas = useDatos(() => repo.admin.empresas.listar({}), [])
  const [buscar, setBuscar] = useState(''), [ocupada, setOcupada] = useState(null), [error, setError] = useState('')
  const navegar = useNavigate()
  const disponibles = (empresas.datos || []).filter(e => e.servicioActivo && e.nombre.toLocaleLowerCase('es').includes(buscar.trim().toLocaleLowerCase('es')))
  async function elegir(empresa) {
    if (ocupada) return
    setOcupada(empresa.id); setError('')
    try { await entrarEmpresa(empresa); navegar('/panel', { replace: true }) }
    catch (e) { setError(e.message) }
    finally { setOcupada(null) }
  }
  return <div className="pnl-modulo seleccion-empresa">
    <Cabecera titulo="Seleccionar empresa" bajada="Elige la empresa en la que vas a operar." />
    <Buscador valor={buscar} alCambiar={setBuscar} placeholder="Buscar empresa…" />
    {error && <p role="alert">{error}</p>}
    {empresas.estado === 'cargando' ? <Cargando /> : empresas.estado === 'error' ? <ErrorCarga error={empresas.error} onReintentar={empresas.recargar} /> : <>
      <div className="seleccion-empresa-lista">{disponibles.map(e => <button key={e.id} type="button" className="seleccion-empresa-opcion" disabled={Boolean(ocupada)} onClick={() => elegir(e)}>
        <LogoEmpresa empresaId={e.id} codigo={e.codigo} nombre={e.nombre} />
        <span><strong>{e.nombre}</strong><small>{ocupada === e.id ? 'Comprobando acceso…' : 'Entrar a la operación'}</small></span>
        <Tag color="azul">Seleccionar</Tag>
      </button>)}</div>
      {!disponibles.length && <p>No hay empresas activas que coincidan con la búsqueda.</p>}
    </>}
    <Link className="pnl-btn" to="/panel/admin/empresas" onClick={salirEmpresa}>Administración global de FOM</Link>
  </div>
}
