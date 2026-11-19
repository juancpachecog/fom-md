import { useEffect, useRef, useState } from 'react'
import { eliminacionEmpresas } from '../datos/eliminacionEmpresas'
import { eliminacionComprobada, estadoEliminacionEmpresa, validarSolicitudEmpresa } from '../datos/eliminacionEmpresasContrato'
import { Tag } from '../comp/ui'

export default function EliminacionesEmpresas({ alAbrir, alComprobar, version = 0 }) {
  const [items, setItems] = useState([]), [error, setError] = useState('')
  const [pagina, setPagina] = useState(0), avisados = useRef(new Set())
  useEffect(() => {
    let cancelado = false, timer
    async function cargar() {
      try {
        const r = await eliminacionEmpresas.listar()
        if (!Array.isArray(r?.items)) throw new Error('No se pudo comprobar la lista de eliminaciones.')
        r.items.forEach(item => validarSolicitudEmpresa(item, item.tenantId))
        if (cancelado) return
        setItems(r.items); setError('')
        const nuevos = []
        for (const item of r.items) {
          const hito = `${item.requestId}:${eliminacionComprobada(item, item.tenantId)}`
          if (item.liveDeleted && !avisados.current.has(hito)) { avisados.current.add(hito); nuevos.push(item) }
        }
        if (nuevos.length) alComprobar?.(nuevos, false)
      } catch (e) { if (!cancelado) setError(e.message) }
      finally { if (!cancelado) timer = setTimeout(cargar, 5000) }
    }
    cargar()
    return () => { cancelado = true; clearTimeout(timer) }
  }, [version])
  if (!items.length && !error) return null
  const paginas = Math.max(1, Math.ceil(items.length / 4)), actual = Math.min(pagina, paginas - 1)
  const pendientes = items.filter(item => !eliminacionComprobada(item, item.tenantId)).length
  return <details className="emp-eliminaciones" aria-label="Eliminación de empresas">
    <summary>Eliminación de empresas<span>{pendientes ? `${pendientes} pendientes` : `${items.length} resultados`}</span></summary>
    {error && <p className="emp-error" role="alert">{error}</p>}
    <ul>{items.slice(actual * 4, actual * 4 + 4).map(item => {
      const final = eliminacionComprobada(item, item.tenantId)
      return <li key={item.requestId}>
        <div><strong>{final ? 'Empresa eliminada' : item.companyName || 'Empresa en proceso'}</strong><span>{new Date(item.requestedAt).toLocaleString('es-VE')}</span></div>
        <Tag color={final ? 'verde' : item.status === 'blocked' ? 'rojo' : 'azul'}>{final ? 'Eliminación comprobada' : estadoEliminacionEmpresa(item.status)}</Tag>
        <button type="button" className="pnl-btn sutil" onClick={() => alAbrir(item)}>{final ? 'Ver resultado' : 'Ver estado'}</button>
      </li>
    })}</ul>
    {paginas > 1 && <nav className="emp-eliminaciones-paginas" aria-label="Páginas de eliminaciones"><button type="button" className="pnl-btn sutil" disabled={actual === 0} onClick={() => setPagina(actual - 1)}>Anterior</button><span>{actual + 1} de {paginas}</span><button type="button" className="pnl-btn sutil" disabled={actual + 1 >= paginas} onClick={() => setPagina(actual + 1)}>Siguiente</button></nav>}
  </details>
}
