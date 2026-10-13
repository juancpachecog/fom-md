import { useEffect, useRef, useState } from 'react'
import { PREFS_POR_DEFECTO } from './mapaPrefs'

// ============================================================
// PANEL «CAPAS» DEL MAPA
// ------------------------------------------------------------
// Un botón sobre el mapa que abre las opciones de Mapbox: luz, vista,
// 3D, relieve, tráfico, lugares, tema y lluvia. Cada cambio se aplica al
// instante y se recuerda en el navegador (ver mapaPrefs.js).
// ============================================================

const LUCES = [
  { v: 'auto', t: 'Auto' },
  { v: 'dawn', t: 'Amanecer' },
  { v: 'day', t: 'Día' },
  { v: 'dusk', t: 'Atardecer' },
  { v: 'night', t: 'Noche' },
]
const VISTAS = [
  { v: 'calles', t: 'Calles' },
  { v: 'satelite', t: 'Satélite' },
]
const TEMAS = [
  { v: 'default', t: 'Normal' },
  { v: 'faded', t: 'Suave' },
  { v: 'monochrome', t: 'Mono' },
]

function Opciones({ titulo, opciones, valor, alCambiar }) {
  return (
    <div className="mapa-capas-grupo" role="group" aria-label={titulo}>
      <span>{titulo}</span>
      <div className="mapa-capas-chips">
        {opciones.map((o) => (
          <button key={o.v} type="button" className={o.v === valor ? 'on' : ''} aria-pressed={o.v === valor} onClick={() => alCambiar(o.v)}>
            {o.t}
          </button>
        ))}
      </div>
    </div>
  )
}

function Interruptor({ texto, nota, valor, alCambiar }) {
  return (
    <label className="mapa-capas-switch">
      <span>
        {texto}
        {nota && <small>{nota}</small>}
      </span>
      <input type="checkbox" role="switch" aria-label={texto} checked={valor} onChange={(e) => alCambiar(e.target.checked)} />
      <i aria-hidden="true" />
    </label>
  )
}

export default function CapasMapa({ prefs, alCambiar, luzActual }) {
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef(null)

  // Se cierra al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!abierto) return undefined
    const fuera = (e) => { if (!raiz.current?.contains(e.target)) setAbierto(false) }
    const tecla = (e) => { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('pointerdown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('pointerdown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  const poner = (parte) => alCambiar({ ...prefs, ...parte })
  const satelite = prefs.vista === 'satelite'

  return (
    <div className={`mapa-capas${abierto ? ' abierto' : ''}`} ref={raiz}>
      <button type="button" className="mapa-capas-boton" aria-expanded={abierto} aria-controls="mapa-capas-panel" onClick={() => setAbierto((v) => !v)} title="Capas y vista del mapa">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3 2 8l10 5 10-5-10-5Z" />
          <path d="m2 12 10 5 10-5" />
          <path d="m2 16 10 5 10-5" />
        </svg>
        <span>Capas</span>
      </button>
      {abierto && (
        <div className="mapa-capas-panel" id="mapa-capas-panel" role="dialog" aria-label="Capas y vista del mapa">
          <Opciones titulo={`Luz${prefs.luz === 'auto' && luzActual ? ` · ahora ${LUCES.find((l) => l.v === luzActual)?.t.toLowerCase() ?? ''}` : ''}`} opciones={LUCES} valor={prefs.luz} alCambiar={(v) => poner({ luz: v })} />
          <Opciones titulo="Vista" opciones={VISTAS} valor={prefs.vista} alCambiar={(v) => poner({ vista: v })} />
          {!satelite && <Opciones titulo="Tema" opciones={TEMAS} valor={prefs.tema} alCambiar={(v) => poner({ tema: v })} />}
          <Interruptor texto="Vista 3D" nota="Inclina la cámara. Arrastra con el botón derecho para girar." valor={prefs.vista3d} alCambiar={(v) => poner({ vista3d: v })} />
          {!satelite && <Interruptor texto="Edificios y árboles en 3D" valor={prefs.edificios3d} alCambiar={(v) => poner({ edificios3d: v })} />}
          <Interruptor texto="Relieve del terreno" valor={prefs.relieve} alCambiar={(v) => poner({ relieve: v })} />
          <Interruptor texto="Tráfico en vivo" nota="Verde fluido, rojo trancado." valor={prefs.trafico} alCambiar={(v) => poner({ trafico: v })} />
          <Interruptor texto="Nombres de lugares y negocios" valor={prefs.lugares} alCambiar={(v) => poner({ lugares: v })} />
          <Interruptor texto="Lluvia" nota="Solo decorativa." valor={prefs.lluvia} alCambiar={(v) => poner({ lluvia: v })} />
          <button type="button" className="mapa-capas-reset" onClick={() => alCambiar({ ...PREFS_POR_DEFECTO })}>Volver a lo normal</button>
        </div>
      )}
    </div>
  )
}
