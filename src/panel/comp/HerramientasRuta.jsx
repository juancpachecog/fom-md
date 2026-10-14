import * as f from '../datos/formato'

// ============================================================
// LLEGADA Y ALCANCE (sobre el mapa de Mapbox, para la unidad elegida)
// ------------------------------------------------------------
// «Llegada a un punto»: tocas un sitio del mapa (o otra unidad) y se ve
// cuánto tarda la unidad en llegar con el tráfico de ahora, y por dónde.
// «Alcance»: hasta dónde llega en 10, 20 y 30 minutos.
// ============================================================

const km = (n) => `${n < 10 ? n.toFixed(1) : Math.round(n)} km`

export default function HerramientasRuta({ unidad, estado, alElegirDestino, alQuitarLlegada, alAlternarAlcance }) {
  const { eligiendo, llegada, cargandoLlegada, errorLlegada, alcance, cargandoAlcance, errorAlcance } = estado
  return (
    <div className="mapa-herr" aria-label="Llegada y alcance de la unidad">
      <div className="mapa-herr-cab">
        <b>{unidad.placa || unidad.alias}</b>
        <span>Llegada y alcance</span>
      </div>
      <div className="mapa-herr-botones">
        <button type="button" className={eligiendo || llegada ? 'on' : ''} aria-pressed={Boolean(eligiendo || llegada)} onClick={() => (llegada ? alQuitarLlegada() : alElegirDestino())}>
          {llegada ? 'Quitar llegada' : eligiendo ? 'Elige el destino…' : 'Llegada a un punto'}
        </button>
        <button type="button" className={alcance ? 'on' : ''} aria-pressed={Boolean(alcance)} disabled={cargandoAlcance} onClick={alAlternarAlcance}>
          {cargandoAlcance ? 'Calculando…' : alcance ? 'Quitar alcance' : 'Alcance en minutos'}
        </button>
      </div>
      {eligiendo && <p className="mapa-herr-nota">Toca el destino en el mapa, o toca otra unidad. Esc para cancelar.</p>}
      {cargandoLlegada && <p className="mapa-herr-nota" role="status">Calculando la ruta con el tráfico de ahora…</p>}
      {errorLlegada && <p className="mapa-herr-nota error" role="alert">{errorLlegada}</p>}
      {llegada && (
        <div className="mapa-herr-eta" role="status">
          <strong>Llega en {f.duracion(llegada.minutos)}</strong>
          <span>
            {km(llegada.km)} · con el tráfico de ahora
            {llegada.minutosNormales && Math.abs(llegada.minutosNormales - llegada.minutos) >= Math.max(2, llegada.minutos * 0.1) ? ` · normalmente ${f.duracion(llegada.minutosNormales)}` : ''}
          </span>
          <span className="mapa-herr-semaforo"><i className="low" />fluido <i className="moderate" />lento <i className="heavy" />pesado <i className="severe" />trancado</span>
        </div>
      )}
      {errorAlcance && <p className="mapa-herr-nota error" role="alert">{errorAlcance}</p>}
      {alcance && (
        <div className="mapa-herr-alcance" role="status">
          <span><i className="a10" />10 min</span>
          <span><i className="a20" />20 min</span>
          <span><i className="a30" />30 min</span>
        </div>
      )}
    </div>
  )
}
