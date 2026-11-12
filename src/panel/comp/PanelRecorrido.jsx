import { useMemo } from 'react'
import * as f from '../datos/formato'
import { resumen } from '../datos/recorrido'

const RANGOS = [6, 12, 24]

/**
 * Lo que explica el recorrido del mapa: el rango, un resumen y la línea de tiempo con cada
 * viaje (inicio y fin) y cada parada. Cada renglón lleva el mapa a ese lugar.
 */
export default function PanelRecorrido({ analisis, horas, alCambiarHoras, cargando, truncado, alEnfocar, viajeActivo, alElegirViaje }) {
  const linea = useMemo(() => {
    if (!analisis) return []
    const viajes = analisis.viajes.map((v) => ({ clave: `v${v.numero}`, tipo: 'viaje', desde: v.inicio.hora, v }))
    const paradas = analisis.paradas.map((p) => ({ clave: `p${p.numero}`, tipo: 'parada', desde: p.desde, p }))
    return [...viajes, ...paradas].sort((a, b) => Date.parse(b.desde) - Date.parse(a.desde))
  }, [analisis])
  const r = analisis ? resumen(analisis) : null

  return (
    <section className="ruta-panel" aria-label="Recorrido de la unidad">
      <div className="ruta-rangos" role="group" aria-label="Rango del recorrido">
        {RANGOS.map((h) => (
          <button key={h} type="button" aria-pressed={horas === h} className={horas === h ? 'on' : ''} onClick={() => alCambiarHoras(h)}>
            Últimas {h} h
          </button>
        ))}
      </div>
      {cargando && !analisis && <p className="ruta-nota" role="status">Cargando recorrido…</p>}
      {analisis && linea.length === 0 && <p className="ruta-nota" role="status">No hay viajes ni paradas registrados en este rango.</p>}
      {r && linea.length > 0 && (
        <p className="ruta-resumen">
          <b>{r.viajes}</b> {r.viajes === 1 ? 'viaje' : 'viajes'} · <b>{r.km.toFixed(1)}</b> km · <b>{r.paradas}</b>{' '}
          {r.paradas === 1 ? 'parada' : 'paradas'} ({f.duracion(r.minutosParada)})
        </p>
      )}
      {truncado && <p className="ruta-nota">El rango trae más posiciones de las que se pueden mostrar: faltan las más antiguas.</p>}
      <ol className="ruta-linea">
        {linea.map((it) =>
          it.tipo === 'viaje' ? (
            <li key={it.clave}>
              <button type="button" className={`ruta-item viaje${viajeActivo === it.v.numero ? ' activo' : ''}`} aria-pressed={viajeActivo === it.v.numero} onClick={() => { const quita = viajeActivo === it.v.numero; alElegirViaje?.(quita ? null : it.v.numero); if (!quita) alEnfocar?.({ lat: it.v.inicio.lat, lng: it.v.inicio.lng, limites: it.v.puntos.map((p) => [p.lat, p.lng]) }) }}>
                <i aria-hidden="true">A</i>
                <span>
                  <b>Viaje {it.v.numero}</b>
                  <small>
                    {f.hora(it.v.inicio.hora)} → {it.v.fin.enCurso ? 'en camino' : f.hora(it.v.fin.hora)} · {f.duracion(it.v.minutos)} · {(it.v.distanciaM / 1000).toFixed(1)} km
                  </small>
                </span>
              </button>
            </li>
          ) : (
            <li key={it.clave}>
              <button type="button" className="ruta-item parada" onClick={() => alEnfocar?.({ lat: it.p.lat, lng: it.p.lng })}>
                <i aria-hidden="true">{it.p.numero}</i>
                <span>
                  <b>Parada {it.p.numero} · {f.duracion(it.p.minutos)}</b>
                  <small>
                    {f.hora(it.p.desde)} → {f.hora(it.p.hasta)}
                  </small>
                </span>
              </button>
            </li>
          ),
        )}
      </ol>
      <p className="ruta-ayuda">Pasa el cursor por la línea para ver la hora de cada punto; haz clic para fijarla.</p>
      <p className="ruta-ayuda">Las paradas se numeran desde la más antigua (1) hasta la más reciente del rango.</p>
    </section>
  )
}
