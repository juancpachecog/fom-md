import { Link } from 'react-router-dom'
import { importeCostos } from '../datos/costos-api.js'

const CATEGORIAS = {
  fuel: 'Combustible', toll: 'Peajes', parking: 'Estacionamiento', washing: 'Lavado',
  insurance: 'Seguros', registration: 'Registro', fine: 'Multas', parts: 'Repuestos',
  tires: 'Neumáticos', lubricants: 'Lubricantes', labor: 'Mano de obra', other: 'Otros',
}

export default function CostosReales({ costos }) {
  return <section className="rp-panel">
    <div className="rp-panel-head"><div><h2>Gastos de operación</h2>
      <p>{costos.rango.from} a {costos.rango.to} · {costos.rango.timezone} · Toda la empresa</p>
    </div></div>
    <p>{costos.movimientos} movimientos registrados. Esta fuente no se filtra por área.</p>
    {costos.porMoneda.length === 0 ? <div className="rp-aviso"><p>Sin gastos registrados en este período. La consulta se completó correctamente.</p></div> : costos.porMoneda.map(grupo => <div key={grupo.moneda}>
      <h3>{grupo.moneda} · {importeCostos(grupo.total, grupo.moneda)}</h3>
      <p>{grupo.movimientos} movimientos</p>
      <div className="rp-tabla-wrap"><table className="rp-tabla"><caption>Gastos por categoría en {grupo.moneda}</caption>
        <thead><tr><th scope="col">Categoría</th><th scope="col">Importe</th></tr></thead>
        <tbody>{grupo.porCategoria.map(fila => <tr key={fila.categoria}><th scope="row">{CATEGORIAS[fila.categoria] || fila.categoria}</th><td>{importeCostos(fila.monto, grupo.moneda)}</td></tr>)}</tbody>
      </table></div>
    </div>)}
    <p className="rp-nota">Los importes conservan su moneda; no se convierten ni se suman entre monedas. Costo por kilómetro: sin dato, falta una distancia validada para estos gastos.</p>
    <p className="rp-nota">Los costos registrados al cerrar órdenes de trabajo se consultan por separado en <Link to="/panel/mantenimiento">Mantenimiento</Link>; no se agregan a estos gastos.</p>
  </section>
}
