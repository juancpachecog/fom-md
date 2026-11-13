import { useState } from 'react'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { Modal } from './ui'
import { haceCuanto } from '../datos/gps'
import { useAhora } from './GpsPiezas'

const fecha = v => Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString('es-VE', {dateStyle:'medium',timeStyle:'medium'}) : 'No disponible'
/** Sólo metadatos de recepción; no concluye apagado ni identidad física. */
export default function DetalleDetectado({ inicial, alCerrar }) {
  const ahora = useAhora(1000)
  const [referencia, setReferencia] = useState(null)
  const listado = useDatos(() => repo.admin.gps.sinEmparejar(), [], 5000)
  const actual = listado.estado === 'ok' ? listado.datos.find(d => d.imei === inicial.imei) : null
  const d = actual ?? inicial
  const nuevo = referencia && actual && Date.parse(actual.ultimaVez) > Date.parse(referencia)
  return <Modal titulo="Comunicación del dispositivo sin registrar" abierto alCerrar={alCerrar} ancho={660}>
    <div className="gp gp-ventana">
      <p className="gp-mono">IMEI observado: {d.imei}</p>
      <p>{actual ? `Último mensaje recibido ${haceCuanto(d.ultimaVez, ahora)}.` : listado.estado === 'ok' ? 'El candidato ya no aparece en la muestra actual. Puede haberse registrado o quedar fuera del límite de consulta.' : 'Mostrando la última lectura disponible; esperando una actualización.'} No recibir mensajes nuevos no confirma que el GPS esté apagado.</p>
      <dl className="gp-kv">
        <div><dt>Primera recepción en la muestra</dt><dd>{fecha(d.primeraVez)}</dd></div>
        <div><dt>Última recepción</dt><dd>{fecha(d.ultimaVez)}</dd></div>
        <div><dt>Transporte observado</dt><dd>{d.transporte?.toUpperCase() || 'Desconocido'}</dd></div>
        <div><dt>Mensajes de la muestra</dt><dd>{d.mensajes}</dd></div>
        <div><dt>Tamaño del último mensaje</dt><dd>{d.bytesUltimo == null ? 'Desconocido' : `${d.bytesUltimo} bytes`}</dd></div>
        <div><dt>Origen de la identidad</dt><dd>{d.origenIdentidad === 'coban_imei_field' ? 'Campo IMEI del protocolo Coban' : 'Secuencia observada; falta verificar el protocolo'}</dd></div>
        <div><dt>Modelo, firmware y teléfono SIM</dt><dd>No se deducen de esta recepción</dd></div>
      </dl>
      <p>Son horas de recepción del servidor, mostradas en {Intl.DateTimeFormat().resolvedOptions().timeZone}. La muestra consulta hasta {d.limiteMuestra ?? 5000} mensajes de los últimos {d.diasMuestra ?? 30} días del receptor; no representa todo el historial.</p>
      <div className="gp-pie"><button className="gp-btn2" type="button" onClick={listado.recargar}>Actualizar comunicación</button><button className="gp-btn2" type="button" disabled={!actual} onClick={() => setReferencia(actual.ultimaVez)}>Marcar referencia para comparar</button></div>
      {referencia && <p role="status">Referencia: {fecha(referencia)}. {!actual ? 'La comparación no está disponible con una lectura actual.' : nuevo ? 'Se recibieron mensajes nuevos después de la referencia.' : 'No se ha observado un mensaje posterior.'} Comprueba físicamente qué equipo corresponde antes de registrarlo.</p>}
      {listado.estado === 'error' && <p role="alert">No se pudo actualizar la recepción. La lectura anterior no acredita el estado actual.</p>}
      <h3>Últimas comunicaciones disponibles</h3>
      {(d.comunicaciones ?? []).length ? <table><thead><tr><th>Recepción</th><th>Transporte</th><th>Bytes</th></tr></thead><tbody>{d.comunicaciones.map((m,i) => <tr key={`${m.recibido}-${i}`}><td>{fecha(m.recibido)}</td><td>{m.transporte?.toUpperCase()}</td><td>{m.bytes}</td></tr>)}</tbody></table> : <p>El servicio todavía no publica el detalle de mensajes de este candidato.</p>}
    </div>
  </Modal>
}
