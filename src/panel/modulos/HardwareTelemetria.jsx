import { useState } from 'react'
import { Link } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { Cabecera, Cargando, ErrorCarga } from '../comp/ui'
import { listarPerfilesFunciones } from '../datos/funcionesInstalacion'
import { nombreEquipo } from '../datos/gps'
import './catalogo-funciones.css'

export default function HardwareTelemetria({ vista }) {
  return vista === 'perfiles' ? <Perfiles /> : <Pruebas />
}

function Pruebas() {
  const data = useDatos(() => repo.admin.gps.listar({}), [])
  return <div className="pnl-modulo catalogo-funciones">
    <Cabecera titulo="Pruebas y diagnósticos" bajada="Hardware y telemetría · Selecciona un equipo para revisar su recepción y sus funciones." />
    <p>Las pruebas y los comandos se consultan en la ficha del GPS. Cada instalación conserva su configuración e historial.</p>
    <p><Link to="/panel/admin/gps">Equipos GPS</Link></p>
    {data.estado === 'cargando' && <Cargando />}
    {data.error && <ErrorCarga error={data.error} onReintentar={data.recargar} />}
    {data.datos && <div className="cf-scroll"><table><thead><tr><th>Equipo</th><th>Unidad</th><th>Acciones</th></tr></thead><tbody>
      {data.datos.map(g => <tr key={g.id}><td>{nombreEquipo(g)}</td><td>{g.vehiculoNombre || 'Sin instalar'}</td><td>
        <Link to={`/panel/admin/gps/${g.id}`}>Diagnóstico</Link>{' · '}
        <Link to={`/panel/admin/gps/${g.id}/probar`}>Probar señal</Link>{' · '}
        <Link to={`/panel/admin/gps/${g.id}?vista=funciones`}>Funciones y sensores</Link>{' · '}
        <Link to={`/panel/admin/gps/${g.id}?vista=comandos`}>Comandos</Link>
      </td></tr>)}
    </tbody></table>{!data.datos.length && <p>No hay equipos disponibles.</p>}</div>}
  </div>
}

function Perfiles() {
  const [offset, setOffset] = useState(0)
  const data = useDatos(() => listarPerfilesFunciones(offset), [offset])
  const items = data.datos?.items ?? []
  return <div className="pnl-modulo catalogo-funciones">
    <Cabecera titulo="Marcas y perfiles" bajada="Hardware y telemetría · Compatibilidad declarada por modelo y versión." />
    <p>Selecciona y configura el perfil en Funciones y sensores de cada equipo instalado. El perfil no acredita el cableado ni habilita comandos por sí solo.</p>
    <p><Link to="/panel/admin/gps">Abrir Equipos GPS para configurar una instalación</Link></p>
    {data.estado === 'cargando' && <Cargando />}
    {data.error && <ErrorCarga error={data.error} onReintentar={data.recargar} />}
    {data.datos && <><div className="cf-scroll"><table><thead><tr><th>Marca</th><th>Modelo</th><th>Protocolo</th><th>Perfil</th><th>Versión</th></tr></thead><tbody>
      {items.map(p => <tr key={`${p.profileId}@${p.profileVersion}`}><td>{p.manufacturer}</td><td>{p.model}</td><td>{p.protocolFamily}</td><td>{p.profileId}</td><td>{p.profileVersion}</td></tr>)}
    </tbody></table>{!items.length && <p>No hay perfiles en esta página.</p>}</div>
      <div className="cf-toolbar"><button className="pnl-btn" disabled={!offset || data.estado === 'cargando'} onClick={() => setOffset(n => Math.max(0, n - 50))}>Anterior</button><button className="pnl-btn" disabled={items.length < 50 || data.estado === 'cargando'} onClick={() => setOffset(n => n + 50)}>Siguiente</button></div>
    </>}
  </div>
}
