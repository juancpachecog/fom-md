import { useCallback, useEffect, useRef, useState } from 'react'
import { Icono } from '../Iconos'
import { Modal } from './ui'
import { listarArchivos, problemaDe, puedeSubirArchivos, subirVarios, urlDelServidor } from '../datos/archivos'
import { alCambiarFotos } from '../datos/cloudinary'
import './archivos.css'

// ============================================================
// FOTOS Y PDF QUE ACOMPAÑAN A UNA ORDEN, UN DOCUMENTO, ETC.
//   <GaleriaArchivos>  lo que ya hay, y «Agregar» para sumar más.
//   <SelectorArchivos> elegir archivos ANTES de que exista la orden o el
//                       documento: se suben justo después de crearlo.
// ============================================================

const aceptaDe = (pdf) => (pdf ? 'image/*,application/pdf' : 'image/*')

/** Miniatura que reintenta unos segundos: justo después de subir, la nube tarda un instante en servirla. */
function Miniatura({ src, alt }) {
  const [intento, setIntento] = useState(0)
  const [rota, setRota] = useState(false)
  if (rota) return <span className="arch-pdf"><Icono nombre="documento" tam={26} />Foto</span>
  return (
    <img
      src={intento ? `${src}&r=${intento}` : src}
      alt={alt}
      onError={() => (intento < 8 ? setTimeout(() => setIntento((n) => n + 1), 1500) : setRota(true))}
    />
  )
}

export function GaleriaArchivos({ coleccion, padreId, proposito, titulo, vacio = 'Todavía no hay archivos.', puedeSubir = true, aceptaPdf = true }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [subiendo, setSubiendo] = useState('')
  const [abierta, setAbierta] = useState(null)
  const campo = useRef(null)

  const cargar = useCallback(async () => {
    try {
      setItems(await listarArchivos({ coleccion, padreId, proposito }))
    } catch (e) {
      setError(e?.message || 'No se pudieron leer los archivos.')
      setItems([])
    }
  }, [coleccion, padreId, proposito])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => alCambiarFotos(() => cargar()), [cargar])

  async function elegir(e) {
    const archivos = [...(e.target.files ?? [])]
    e.target.value = ''
    if (!archivos.length) return
    const malos = archivos.map((a) => problemaDe(a, coleccion)).filter(Boolean)
    const buenos = archivos.filter((a) => !problemaDe(a, coleccion))
    setError(malos.join(' '))
    if (!buenos.length) return
    setSubiendo(buenos.length === 1 ? 'Subiendo…' : `Subiendo ${buenos.length} archivos…`)
    const r = await subirVarios({ coleccion, padreId, proposito, archivos: buenos })
    setSubiendo('')
    if (r.errores.length) setError([...malos, ...r.errores].join(' '))
    await cargar()
  }

  async function abrir(item) {
    if (item.via === 'servidor') {
      try {
        const url = await urlDelServidor({ coleccion, padreId, objetoId: item.objetoId })
        if (url) window.open(url, '_blank', 'noopener')
      } catch (e) {
        setError(e?.message || 'No se pudo abrir el archivo.')
      }
      return
    }
    if (item.pdf) { window.open(item.url, '_blank', 'noopener'); return }
    setAbierta(item)
  }

  const permitido = puedeSubir && puedeSubirArchivos()
  return (
    <section className="arch" aria-label={titulo}>
      <div className="arch-cab">
        <h4>{titulo}{items?.length ? <span>{items.length}</span> : null}</h4>
        {permitido && (
          <>
            <button type="button" className="pnl-btn sutil" disabled={Boolean(subiendo)} onClick={() => campo.current?.click()}>
              <Icono nombre="mas" tam={15} />{subiendo || 'Agregar'}
            </button>
            <input ref={campo} type="file" accept={aceptaDe(aceptaPdf)} multiple hidden onChange={elegir} />
          </>
        )}
      </div>
      {items === null ? (
        <p className="arch-nota" role="status">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="arch-nota">{vacio}</p>
      ) : (
        <ul className="arch-lista">
          {items.map((it) => (
            <li key={it.clave}>
              <button type="button" onClick={() => abrir(it)} aria-label={`Abrir ${it.nombre}`}>
                {it.pdf || !it.miniatura ? <span className="arch-pdf"><Icono nombre="documento" tam={26} />{it.pdf ? 'PDF' : 'Foto'}</span> : <Miniatura src={it.miniatura} alt={it.nombre} />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="arch-error" role="alert">{error}</p>}
      <Modal titulo={titulo} abierto={Boolean(abierta)} alCerrar={() => setAbierta(null)} ancho={920}>
        {abierta && (
          <div className="fd-grande">
            <img src={abierta.url} alt={abierta.nombre} />
            <a className="pnl-link" href={abierta.url} target="_blank" rel="noreferrer">Abrir original</a>
          </div>
        )}
      </Modal>
    </section>
  )
}

/** Elegir archivos antes de crear lo que van a acompañar. Muestra la vista previa y deja quitar. */
export function SelectorArchivos({ archivos, alCambiar, coleccion, titulo = 'Fotos', ayuda = '', aceptaPdf = false, deshabilitado = false }) {
  const campo = useRef(null)
  const [error, setError] = useState('')
  const [vistas, setVistas] = useState([])

  useEffect(() => {
    const urls = archivos.map((a) => (/^image\//u.test(a.type) ? URL.createObjectURL(a) : null))
    setVistas(urls)
    return () => urls.forEach((u) => u && URL.revokeObjectURL(u))
  }, [archivos])

  if (!puedeSubirArchivos()) return null

  function elegir(e) {
    const nuevos = [...(e.target.files ?? [])]
    e.target.value = ''
    const malos = nuevos.map((a) => problemaDe(a, coleccion)).filter(Boolean)
    setError(malos.join(' '))
    const buenos = nuevos.filter((a) => !problemaDe(a, coleccion))
    if (buenos.length) alCambiar([...archivos, ...buenos].slice(0, 10))
  }

  return (
    <div className="arch arch-selector">
      <div className="arch-cab">
        <h4>{titulo}</h4>
        <button type="button" className="pnl-btn sutil" disabled={deshabilitado || archivos.length >= 10} onClick={() => campo.current?.click()}>
          <Icono nombre="mas" tam={15} />{archivos.length ? 'Agregar más' : 'Agregar'}
        </button>
        <input ref={campo} type="file" accept={aceptaDe(aceptaPdf)} multiple hidden onChange={elegir} />
      </div>
      {ayuda && <p className="arch-nota">{ayuda}</p>}
      {archivos.length > 0 && (
        <ul className="arch-lista">
          {archivos.map((a, i) => (
            <li key={`${a.name}-${a.size}-${i}`} className="arch-elegido">
              {vistas[i] ? <img src={vistas[i]} alt={a.name} /> : <span className="arch-pdf"><Icono nombre="documento" tam={26} />PDF</span>}
              <button type="button" className="arch-quitar" disabled={deshabilitado} aria-label={`Quitar ${a.name}`} onClick={() => alCambiar(archivos.filter((_, j) => j !== i))}>
                <Icono nombre="cerrar" tam={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="arch-error" role="alert">{error}</p>}
    </div>
  )
}
