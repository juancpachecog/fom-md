import * as f from '../datos/formato'

export function KmHoy({ lectura }) {
  const m = lectura?.metrica
  const texto = lectura?.estado === 'cargando' ? 'Cargando…' : lectura?.estado === 'error' ? 'No disponible' : m ? `${m.km.toLocaleString('es-VE',{maximumFractionDigits:1})} km` : 'Sin dato'
  const titulo = m ? `${m.fecha} · ${m.zona}${m.calculadoEn ? ` · Calculado: ${f.fechaHora(m.calculadoEn)}` : ''}${m.parcial ? ' · Acumulado parcial del servidor' : ''}` : 'Distancia diaria publicada por el servidor; no es el odómetro total.'
  return <span className="fleet-km-hoy" role="status" title={titulo} aria-label={`Kilómetros de hoy: ${texto}${m?.parcial ? ', parcial' : ''}`}><small>Hoy{m?.parcial ? ' · parcial' : ''}</small><b>{texto}</b></span>
}
