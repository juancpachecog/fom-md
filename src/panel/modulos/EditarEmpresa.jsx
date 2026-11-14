import { useState } from 'react'
import repo from '../datos/repo'
import { Campo, Modal } from '../comp/ui'
import { useConfirmar } from '../comp/Confirmar'

const campos = [['nombre', 'Nombre', 160], ['rif', 'RIF', 20], ['contacto', 'Contacto', 120], ['telefono', 'Teléfono (+58…)', 20], ['email', 'Correo', 254]]
export default function EditarEmpresa({ empresa, alCerrar, alGuardar }) {
  const [datos, setDatos] = useState(() => Object.fromEntries(campos.map(([k]) => [k, empresa[k] || ''])))
  const [ocupado, setOcupado] = useState(false), [error, setError] = useState('')
  const { confirmar, dialogo } = useConfirmar()
  async function guardar(e) {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true); setError('')
    try {
      if (!await confirmar({ titulo: 'Guardar datos de la empresa', texto: `¿Guardar los cambios de ${empresa.nombre}?`, accion: 'Guardar cambios' })) return
      await repo.admin.empresas.set(empresa.id, datos)
      await alGuardar(); alCerrar()
    } catch (e) { setError(e.message) }
    finally { setOcupado(false) }
  }
  return <><Modal abierto titulo="Editar empresa" alCerrar={() => !ocupado && alCerrar()}>
    <form onSubmit={guardar}>{campos.map(([k, etiqueta, max]) => <Campo key={k} etiqueta={etiqueta}><input className="pnl-input" required={k === 'nombre'} minLength={k === 'nombre' || k === 'contacto' ? 2 : undefined} type={k === 'email' ? 'email' : 'text'} maxLength={max} disabled={ocupado} value={datos[k]} onChange={e => setDatos(d => ({ ...d, [k]: e.target.value }))} /></Campo>)}
      {error && <p role="alert">{error}</p>}<button type="button" className="pnl-btn" disabled={ocupado} onClick={alCerrar}>Cancelar</button><button type="submit" className="pnl-btn primario" disabled={ocupado}>{ocupado ? 'Comprobando…' : 'Guardar cambios'}</button>
    </form>
  </Modal>{dialogo}</>
}
