import {useDatos} from '../useDatos'
import {Cargando,ErrorCarga} from '../comp/ui'
import {leerComandosInstalacion,motivoBloqueoComando} from '../datos/comandosInstalacion'
import './catalogo-funciones.css'
import SegundoFactorComandos from './SegundoFactorComandos'
export default function ComandosInstalacion({assignmentId}){
 const data=useDatos(()=>leerComandosInstalacion(assignmentId),[assignmentId],30000)
 if(data.estado==='cargando'&&!data.datos)return<Cargando filas={3}/>
 if(data.error)return<ErrorCarga error={data.error} onReintentar={data.recargar}/>
 return<section className="gp-card catalogo-funciones"><h2>Comandos de esta instalación</h2>
  <p>Cada marca usa su adaptador y cada montaje requiere sus propias pruebas. Restablecer el permiso de arranque permite arrancar normalmente; no enciende el motor.</p>
  <p>Esta vista consulta requisitos pendientes. Las solicitudes y el envío permanecen deshabilitados.</p>
  <SegundoFactorComandos onChanged={data.recargar}/>
  {data.datos?.items.map(command=><section className="cf-editor" key={command.key}><h3>{command.name}</h3><p>{command.physical?'Actuación física':'Consulta al equipo'} · Sin habilitar</p>
   <ul>{command.blockers.map(reason=><li key={reason}>{motivoBloqueoComando(reason)}</li>)}</ul>
  </section>)}
  {!data.datos?.items.length&&<p>No hay acciones declaradas para consultar.</p>}
 </section>
}
