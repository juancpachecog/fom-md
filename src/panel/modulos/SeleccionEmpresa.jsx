import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { entrarEmpresa, salirEmpresa } from '../auth'
import { Cabecera, Cargando, ErrorCarga, Buscador, Modal, Tag } from '../comp/ui'
import LogoEmpresa from '../comp/LogoEmpresa'
import './seleccion-empresa.css'

export default function SeleccionEmpresa({ empresaId, alCerrar } = {}) {
  const empresas = useDatos(() => repo.admin.empresas.listar({}), [])
  const [buscar, setBuscar] = useState(''), [ocupada, setOcupada] = useState(null), [error, setError] = useState('')
  const cambiando = useRef(false)
  const navegar = useNavigate()
  const disponibles = (empresas.datos || []).filter(e => e.servicioActivo && e.nombre.toLocaleLowerCase('es').includes(buscar.trim().toLocaleLowerCase('es')))
  async function elegir(empresa) {
    if (cambiando.current || empresa.id === empresaId) return
    cambiando.current = true
    setOcupada(empresa.id); setError('')
    try {
      await entrarEmpresa(empresa)
      navegar(alCerrar ? '/panel/mapa' : '/panel', { replace: true })
      alCerrar?.()
    }
    catch (e) { setError(e.message) }
    finally { cambiando.current = false; setOcupada(null) }
  }
  const selector = <>
    <Buscador valor={buscar} alCambiar={setBuscar} placeholder="Buscar empresa…" />
    {error && <p role="alert">{error}</p>}
    {empresas.estado === 'cargando' ? <Cargando /> : empresas.estado === 'error' ? <ErrorCarga error={empresas.error} onReintentar={empresas.recargar} /> : <>
      <div className="seleccion-empresa-lista">{disponibles.map(e => {
        const actual = e.id === empresaId
        return <button key={e.id} type="button" className="seleccion-empresa-opcion" aria-current={actual || undefined}
          disabled={actual || Boolean(ocupada)} onClick={() => elegir(e)}>
          <LogoEmpresa empresaId={e.id} codigo={e.codigo} nombre={e.nombre} />
          <span><strong>{e.nombre}</strong><small>{actual ? 'Empresa activa' : ocupada === e.id ? 'Comprobando acceso…' : 'Entrar a la operación'}</small></span>
          {!actual && <Tag color="azul">Seleccionar</Tag>}
        </button>
      })}</div>
      {!disponibles.length && <p>No hay empresas activas que coincidan con la búsqueda.</p>}
    </>}
  </>
  if (alCerrar) return (
    <Modal titulo="Cambiar empresa" abierto alCerrar={() => { if (!cambiando.current) alCerrar() }}>
      {selector}
    </Modal>
  )
  return <div className="pnl-modulo seleccion-empresa">
    <Cabecera titulo="Seleccionar empresa" bajada="Elige la empresa en la que vas a operar." />
    {selector}
    <Link className="pnl-btn" to="/panel/admin/empresas" onClick={salirEmpresa}>Administración global de FOM</Link>
  </div>
}
