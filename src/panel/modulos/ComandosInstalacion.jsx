import {useDatos} from '../useDatos'
import {Cargando,ErrorCarga} from '../comp/ui'
import {leerComandosInstalacion,motivoBloqueoComando} from '../datos/comandosInstalacion'
import './catalogo-funciones.css'
import SegundoFactorComandos from './SegundoFactorComandos'
import PermisosComando from './PermisosComando'
import SolicitudesComando from './SolicitudesComando'
export default function ComandosInstalacion({assignmentId}){
 const data=useDatos(()=>leerComandosInstalacion(assignmentId),[assignmentId],30000)
 if(data.estado==='cargando'&&!data.datos)return<Cargando filas={3}/>
 if(data.error)return<ErrorCarga error={data.error} onReintentar={data.recargar}/>
 return<section className="gp-card catalogo-funciones"><h2>Comandos de esta instalación</h2>
  <p>Cada marca usa su adaptador y cada montaje requiere sus propias pruebas. Restablecer el permiso de arranque permite arrancar normalmente; no enciende el motor.</p>
  <p>{data.datos?.readOnly?'Ninguna acción cumple actualmente todos los requisitos para solicitarla.':'Hay acciones disponibles para crear una solicitud con confirmación específica.'}</p>
  <SegundoFactorComandos onChanged={data.recargar}/>
  {data.datos?.items.map(command=><section className="cf-editor" key={`${command.key}:${command.instance||1}`}><h3>{command.name} · Canal {command.instance||1}</h3><p>{command.physical?'Actuación física':'Consulta al equipo'} · {command.requestAllowed?'Disponible para solicitar':'Sin habilitar'}</p>
   <ul>{command.blockers.map(reason=><li key={reason}>{motivoBloqueoComando(reason)}</li>)}</ul>
  </section>)}
  {!data.datos?.items.length&&<p>No hay acciones declaradas para consultar.</p>}
  {data.datos?.contractVersion===2&&<><PermisosComando assignmentId={assignmentId} actions={data.datos.items} onChanged={data.recargar}/><SolicitudesComando assignmentId={assignmentId} availability={data.datos} onChanged={data.recargar}/></>}
 </section>
}
