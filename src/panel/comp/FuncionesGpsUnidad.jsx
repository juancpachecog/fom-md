import { fechaHora, desde } from '../datos/formato'
import { filasFuncionesGps, leerFuncionesInstalacion } from '../datos/funcionesInstalacion'
import { useDatos } from '../useDatos'

export default function FuncionesGpsUnidad({ instalacionId }) {
  const { datos, estado } = useDatos(() => leerFuncionesInstalacion(instalacionId), [instalacionId], 30000)
  const filas = estado === 'ok' ? filasFuncionesGps(instalacionId, datos) : []
  if (estado === 'error') return <p className="fleet-gps-aviso" role="status">No se pudieron consultar las funciones del GPS.</p>
  if (!filas.length) return null

  return <section className="fleet-gps" aria-label="Funciones del GPS">
    <h4>Funciones del GPS</h4>
    <dl>{filas.map(({ id, etiqueta, valor, instante, vigencia }) => <div key={id}>
      <dt>{etiqueta}</dt>
      <dd>
        <strong>{valor}</strong>
        {instante && <small>
          {vigencia && `${vigencia} · `}
          <time dateTime={instante} title={fechaHora(instante)}>{desde(instante)}</time>
        </small>}
      </dd>
    </div>)}</dl>
  </section>
}
