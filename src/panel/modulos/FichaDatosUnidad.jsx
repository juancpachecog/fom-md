import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import repo from '../datos/repo'
import { HAY_API } from '../datos/api'
import { Campo, ErrorCarga, Tag, Tarjeta } from '../comp/ui'
import { Icono } from '../Iconos'
import { etiqueta } from '../datos/catalogos'
import * as f from '../datos/formato'
import { perfilDeUsuario } from '../datos/usuariosUnidad'
import './expediente-unidad.css'
import EditarVehiculo from './EditarVehiculo'
import { useConfirmar } from '../comp/Confirmar'

function Hechos({ items, unaColumna = false }) {
  return <dl className={`eu-hechos${unaColumna ? ' una-columna' : ''}`}>{items.map(([nombre, valor]) =>
    <div key={nombre}><dt>{nombre}</dt><dd>{valor ?? 'Sin registrar'}</dd></div>
  )}</dl>
}

export default function FichaDatosUnidad({ unidad: v, areas, puedeEditar, cambiarArea, guardandoArea, errorArea, guardado, verUsuarios, alGuardar }) {
  const [editando, setEditando] = useState(false)
  const { confirmar, dialogo } = useConfirmar()
  const [numero, setNumero] = useState(v.numeroFlota || '')
  const [ocupadoNumero, setOcupadoNumero] = useState(false)
  const [errorNumero, setErrorNumero] = useState('')
  const [numeroComprobado, setNumeroComprobado] = useState(null)
  useEffect(() => { setNumero(v.numeroFlota || ''); setNumeroComprobado(null); setErrorNumero('') }, [v.id, v.numeroFlota])
  const guardarNumero = async e => {
    e.preventDefault()
    if (ocupadoNumero) return
    if (!await confirmar({ titulo: 'Guardar número interno', texto: `¿Actualizar el número interno de ${v.placa}?`, accion: 'Guardar' })) return
    setOcupadoNumero(true); setErrorNumero('')
    try {
      const valor = numero.trim()
      await repo.vehiculos.set(v.id, { numero: valor })
      const nueva = await repo.vehiculos.obtener(v.id)
      if (!nueva || nueva.id !== v.id || (nueva.numeroFlota || '') !== valor) throw new Error('No pudimos comprobar el número guardado. Recarga la ficha antes de repetir.')
      setNumeroComprobado(valor)
    } catch (e) { setErrorNumero(e.message) }
    finally { setOcupadoNumero(false) }
  }
  const perfil = perfilDeUsuario(v.conductorPrincipalId)
  return <div className="eu-ficha">
    <div className="eu-ficha-grid">
      <Tarjeta titulo="Identificación de la unidad">
        {puedeEditar && HAY_API && <button type="button" className="pnl-btn primario" onClick={() => setEditando(true)}>Editar vehículo</button>}
        <div className="eu-identidad"><span className="eu-icono"><Icono nombre="camion" tam={28} /></span><div><span className="eu-etiqueta">Placa</span><h2>{v.placa || 'Sin placa'}</h2><p>{[v.marca, v.modelo, v.anio].filter(Boolean).join(' · ') || 'Datos del vehículo sin registrar'}</p></div></div>
        <Hechos items={[
          ['Alias', v.aliasRegistrado], ['Número interno', numeroComprobado !== null ? numeroComprobado || 'Sin registrar' : v.numero], ['Marca', v.marca], ['Modelo', v.modelo],
          ['Año', v.anio], ['Tipo de unidad', etiqueta('vehiculo_tipo', v.tipo)],
        ]} />
        {puedeEditar && HAY_API && <form onSubmit={guardarNumero}><Campo etiqueta="Editar número interno de flota" error={errorNumero}><input className="pnl-input" value={numero} maxLength={30} disabled={ocupadoNumero} onChange={e => { setNumero(e.target.value); setNumeroComprobado(null) }} /></Campo><button type="submit" className="pnl-btn sutil" disabled={ocupadoNumero || numero.trim() === (numeroComprobado ?? v.numeroFlota ?? '')}>{ocupadoNumero ? 'Guardando…' : 'Guardar número interno'}</button>{numeroComprobado !== null && <span className="eu-nota" role="status">Guardado y comprobado.</span>}</form>}
        <p className="eu-nota"><Icono nombre="reloj" tam={16} />{v.creadoEn ? `Alta en el sistema: ${f.fecha(v.creadoEn)}` : 'Fecha de alta sin registrar'}</p>
      </Tarjeta>
      <div className="eu-ficha-lateral">
        <Tarjeta titulo="Equipo GPS" accion={v.gps ? <Tag color="azul">Instalado</Tag> : null}>
          {v.gps ? <Hechos unaColumna items={[
            ['Modelo del equipo', v.gps.modelo], ['IMEI', v.gps.imei],
            ['Seguridad', v.gps.pinSupport ? 'GPS con PIN' : 'GPS sin PIN'],
            ...(v.gps.linea ? [['Línea', v.gps.linea]] : []),
          ]} /> : <p className="eu-nota">Esta unidad no tiene un equipo GPS registrado.</p>}
        </Tarjeta>
        <Tarjeta titulo="Área asignada" accion={guardado ? <span role="status"><Tag color="verde">{guardado}</Tag></span> : null}>
          <div className="eu-area"><span className="eu-icono"><Icono nombre="pin" tam={22} /></span><div><b>{v.areaNombre || 'Sin área'}</b><p>Ubicación, sector o contrato de la unidad.</p></div></div>
          {puedeEditar && <>
            {areas.estado === 'error' ? <ErrorCarga error={areas.error} onReintentar={areas.recargar} /> : <Campo etiqueta="Cambiar área" error={errorArea}>
              <select className="pnl-select" value={v.areaId ?? ''} disabled={guardandoArea || areas.estado !== 'ok'} onChange={async e => { const id = e.target.value; if (await confirmar({ titulo: 'Cambiar área', texto: `¿Cambiar el área de ${v.placa}?`, accion: 'Cambiar área' })) cambiarArea(id) }}>
                <option value="">Sin área</option>
                {(areas.datos ?? []).map(a => <option key={a.id} value={a.id}>{a.nombre} ({etiqueta('area_tipo', a.tipo)})</option>)}
              </select>
            </Campo>}
            {guardandoArea && <p className="eu-nota" role="status">Guardando área…</p>}
          </>}
        </Tarjeta>
      </div>
    </div>
    <Tarjeta titulo="Usuario asignado" accion={<button type="button" className="pnl-btn sutil" onClick={verUsuarios}>Ver usuarios</button>}>
      {v.asignacionesError ? <p className="eu-nota" role="alert">No pudimos consultar la asignación. Abre Usuarios para reintentar.</p> : <div className="eu-usuario-resumen">
        <i className="pnl-avatar">{v.conductorPrincipalId ? f.iniciales(v.conductorNombre) : <Icono nombre="gente" tam={24} />}</i>
        <div><b>{v.conductorPrincipalId ? v.conductorNombre : 'Sin conductor principal'}</b><p>{v.conductorPrincipalId ? 'Conductor principal de la unidad' : 'Gestiona las asignaciones desde Usuarios.'}</p></div>
        {v.conductorPrincipalId && <Tag color="verde">Asignación vigente</Tag>}
        {perfil && <Link to={perfil} className="pnl-btn sutil">Ver perfil</Link>}
      </div>}
    </Tarjeta>
    {editando && <EditarVehiculo key={v.id} unidad={v} alCerrar={() => setEditando(false)} alGuardar={alGuardar} />}{dialogo}
  </div>
}
