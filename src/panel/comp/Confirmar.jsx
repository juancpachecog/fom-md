import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from './ui'
import { normalizarPeticion, puedeAceptar, resultadoDe } from './logicaConfirmar'
import './dialogoConfirmar.css'

// ============================================================
// Confirmación propia del panel (T-216)
//   const { confirmar, dialogo } = useConfirmar()
//   if (!await confirmar({ titulo, texto, accion: 'Reactivar', peligro })) return
//   …y en el JSX, una vez: {dialogo}
// Con `campo` pide un texto (antes el prompt del navegador) y devuelve el texto o null.
// ============================================================

function Contenido({ peticion, valor, setValor, resolver }) {
  const primario = useRef(null)
  const cancelar = useRef(null)
  const campo = useRef(null)
  useEffect(() => {
    // El Modal enfoca el primer botón (la X) en el siguiente cuadro; se espera
    // un cuadro más para dejar el foco donde corresponde.
    let segundo = 0
    const primero = requestAnimationFrame(() => {
      segundo = requestAnimationFrame(() => {
        // Lo destructivo arranca en Cancelar para que un Enter de más no borre nada.
        (campo.current ?? (peticion.peligro ? cancelar.current : primario.current))?.focus()
      })
    })
    return () => { cancelAnimationFrame(primero); cancelAnimationFrame(segundo) }
  }, [peticion])

  const aceptable = puedeAceptar(peticion, valor)
  const enviar = (e) => {
    e.preventDefault()
    if (aceptable) resolver(true)
  }
  return (
    <form onSubmit={enviar}>
      {peticion.texto && <p className="cnf-texto">{peticion.texto}</p>}
      {peticion.campo && (
        <label className="pnl-campo cnf-campo">
          <span>{peticion.campo.etiqueta}</span>
          <input
            ref={campo}
            className="pnl-input"
            value={valor}
            placeholder={peticion.campo.placeholder}
            onChange={(e) => setValor(e.target.value)}
          />
        </label>
      )}
      <div className="cnf-acciones">
        <button ref={cancelar} type="button" className="pnl-btn" onClick={() => resolver(false)}>
          {peticion.cancelar}
        </button>
        <button ref={primario} type="submit" className={`pnl-btn primario${peticion.peligro ? ' peligro' : ''}`} disabled={!aceptable}>
          {peticion.accion}
        </button>
      </div>
    </form>
  )
}

/**
 * Devuelve `confirmar(opciones)` (promesa) y `dialogo` (el elemento a pintar).
 * Si quien pregunta se desmonta con la ventana abierta, cuenta como cancelado.
 */
export function useConfirmar() {
  const [pendiente, setPendiente] = useState(null) // { peticion, fin }
  const [valor, setValor] = useState('')
  const vigente = useRef(null)

  const cerrar = useCallback((aceptado, texto) => {
    const actual = vigente.current
    if (!actual) return
    vigente.current = null
    setPendiente(null)
    actual.fin(resultadoDe(actual.peticion, aceptado, texto))
  }, [])

  const confirmar = useCallback((opciones) => new Promise((resolver) => {
    // Una pregunta nueva con otra abierta cancela la anterior.
    vigente.current?.fin(resultadoDe(vigente.current.peticion, false))
    const peticion = normalizarPeticion(opciones)
    vigente.current = { peticion, fin: resolver }
    setValor('')
    setPendiente({ peticion })
  }), [])

  useEffect(() => () => {
    const actual = vigente.current
    vigente.current = null
    actual?.fin(resultadoDe(actual.peticion, false))
  }, [])

  const peticion = pendiente?.peticion
  const dialogo = (
    <Modal titulo={peticion?.titulo ?? ''} abierto={!!peticion} alCerrar={() => cerrar(false, valor)} ancho={440}>
      {peticion && (
        <Contenido peticion={peticion} valor={valor} setValor={setValor} resolver={(ok) => cerrar(ok, valor)} />
      )}
    </Modal>
  )
  return { confirmar, dialogo }
}
