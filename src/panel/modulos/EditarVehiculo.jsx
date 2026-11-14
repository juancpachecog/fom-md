import { useState } from 'react'
import repo from '../datos/repo'
import { Campo, Modal } from '../comp/ui'
import { useConfirmar } from '../comp/Confirmar'
import { TIPOS_UNIDAD } from '../datos/unidadEnEmpresa'

const campos = [
  ['codigo', 'Código de la unidad', 50], ['vin', 'VIN / número de chasis (17 caracteres)', 17],
  ['placa', 'Placa', 20], ['alias', 'Alias', 80], ['numero', 'Número interno de flota', 30],
  ['marca', 'Marca', 80], ['modelo', 'Modelo', 80], ['anio', 'Año', 4], ['tipo', 'Tipo de unidad', 40],
]
const valorCampo = (v, k) => {
  const valor = k === 'numero' ? v.numeroFlota : k === 'alias' ? v.aliasRegistrado : v[k]
  return valor === '—' ? '' : String(valor ?? '')
}

export default function EditarVehiculo({ unidad, alCerrar, alGuardar }) {
  const [inicial] = useState(() => Object.fromEntries(campos.map(([k]) => [k, valorCampo(unidad, k)])))
  const [valores, setValores] = useState(inicial)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const { confirmar, dialogo } = useConfirmar()
  async function guardar(e) {
    e.preventDefault()
    if (ocupado) return
    setOcupado(true); setError('')
    try {
      if (!await confirmar({ titulo: 'Guardar datos del vehículo', texto: `¿Guardar los cambios de ${unidad.placa}? Se conserva su historial y sus asignaciones.`, accion: 'Guardar cambios' })) return
      const parche = Object.fromEntries(Object.entries(valores).filter(([k, v]) => v.trim() !== inicial[k].trim()).map(([k, v]) => [k, ['placa', 'vin'].includes(k) ? v.trim().toUpperCase() : v.trim()]))
      if (parche.codigo !== undefined) parche.codigo = parche.codigo.toLowerCase()
      if (!Object.keys(parche).length) return
      await repo.vehiculos.set(unidad.id, parche)
      const nueva = await repo.vehiculos.obtener(unidad.id)
      const coincide = nueva?.id === unidad.id && Object.keys(parche).every(k => valorCampo(nueva, k) === parche[k])
      if (!coincide) throw new Error('La lectura posterior no coincide. Recarga la ficha antes de repetir el cambio.')
      await alGuardar()
      alCerrar()
    } catch (e) { setError(e.message) }
    finally { setOcupado(false) }
  }
  return <><Modal abierto titulo="Editar vehículo" alCerrar={() => !ocupado && alCerrar()}>
    <form onSubmit={guardar}>
      {campos.map(([k, titulo, max]) => <Campo key={k} etiqueta={titulo}>{k === 'tipo'
        ? <select className="pnl-select" value={valores[k]} disabled={ocupado} onChange={e => setValores(v => ({ ...v, [k]: e.target.value }))}>{!TIPOS_UNIDAD.some(t => t.v === valores[k]) && <option value={valores[k]}>{valores[k] || 'Sin tipo'}</option>}{TIPOS_UNIDAD.map(t => <option key={t.v} value={t.v}>{t.t}</option>)}</select>
        : <input className="pnl-input" required={k === 'codigo'} pattern={k === 'vin' ? '[A-HJ-NPR-Za-hj-npr-z0-9]{17}' : undefined} maxLength={max} type={k === 'anio' ? 'number' : 'text'} min={k === 'anio' ? 1950 : undefined} max={k === 'anio' ? 2100 : undefined} value={valores[k]} disabled={ocupado} onChange={e => setValores(v => ({ ...v, [k]: e.target.value }))} />}</Campo>)}
      {error && <p role="alert">{error}</p>}
      <button type="button" className="pnl-btn" disabled={ocupado} onClick={alCerrar}>Cancelar</button>
      <button type="submit" className="pnl-btn primario" disabled={ocupado || campos.every(([k]) => valores[k].trim() === inicial[k].trim())}>{ocupado ? 'Comprobando…' : 'Guardar cambios'}</button>
    </form>
  </Modal>{dialogo}</>
}
