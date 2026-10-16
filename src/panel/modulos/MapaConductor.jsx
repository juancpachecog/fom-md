import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { miAsignacion, unidadDeAsignacion } from '../datos/asignacion-conductor'
import Mapa from '../comp/Mapa'
import FichaUnidad from '../comp/FichaUnidad'
import { Cargando, ErrorCarga, Vacio } from '../comp/ui'
import { Icono } from '../Iconos'
import { conPosicionFresca } from './MiUnidad'
import '../../styles/control-map.css'

const CINCO_MINUTOS = 5 * 60_000

/** Mismo mapa a pantalla completa, consultando solo la unidad asignada. */
export default function MapaConductor() {
  const perfil = useSesion()?.perfil
  const cuenta = perfil?.userId ?? perfil?.nombre
  const [fichaAbierta, setFichaAbierta] = useState(false)
  // Antes, cada 15 s se repetía todo en serie (asignaciones + expediente, ~9
  // pedidos) para mover un punto. Ahora cada cosa a su ritmo:
  // · quién lleva qué unidad cambia pocas veces al día → cada 5 min;
  const asignaciones = useDatos(
    async () => ({ cuenta, lista: await repo.conductores() }),
    [perfil?.userId, perfil?.nombre, perfil?.empresaId],
    CINCO_MINUTOS,
  )
  // La cuenta va sellada: al cambiar de sesión no se pinta la unidad de la anterior.
  const actual = asignaciones.datos?.cuenta === cuenta
  const asignacion = useMemo(
    () => (actual ? miAsignacion(perfil, asignaciones.datos.lista) : null),
    [actual, perfil, asignaciones.datos],
  )
  const vehiculoId = asignacion?.vehiculoId ?? null
  // · la ficha (placa, modelo, equipo) no cambia mientras se mira → una vez por unidad;
  const ficha = useDatos(
    async () => ({ vehiculoId, unidad: vehiculoId ? await repo.vehiculos.obtener(vehiculoId) : null }),
    [vehiculoId],
  )
  const fichaActual = ficha.datos?.vehiculoId === vehiculoId
  // · lo único vivo es dónde está → las últimas posiciones, UN pedido cada 15 s.
  //   Se piden unas pocas y no solo la última: la más reciente puede venir sin GPS válido.
  const posicion = useDatos(
    async () => ({ vehiculoId, puntos: vehiculoId ? await repo.colaReciente(vehiculoId, 5) : [] }),
    [vehiculoId],
    15000,
  )
  const punto = posicion.datos?.vehiculoId === vehiculoId ? posicion.datos.puntos.at(-1) ?? null : null
  const unidad = useMemo(
    () => conPosicionFresca(unidadDeAsignacion(asignacion, fichaActual ? ficha.datos.unidad : null), punto),
    [asignacion, fichaActual, ficha.datos, punto],
  )
  const posicionValida = Number.isFinite(unidad?.lat) && Number.isFinite(unidad?.lng)
  const vehiculos = useMemo(() => posicionValida ? [unidad] : [], [posicionValida, unidad])
  const partes = [asignaciones, ficha, posicion]
  const conError = partes.some((p) => p.estado === 'error')
  const cargando = !conError && (
    asignaciones.estado === 'cargando' || !actual || ficha.estado === 'cargando' || !fichaActual
  )
  // Reintentar solo lo que falló: repetir el expediente entero sin necesidad gasta ~8 pedidos.
  const reintentar = () => partes.filter((p) => p.estado === 'error').forEach((p) => p.recargar())

  return <section className="control-map" aria-label="Mapa de mi unidad">
    <div className="control-map-canvas">
      <Mapa vehiculos={vehiculos} seleccionado={fichaAbierta ? unidad?.id : null}
        alSeleccionar={() => setFichaAbierta(true)} alto="100%" ficha={false} leyenda={false} espacioFicha />
    </div>
    <div className="control-search">
      <div className="control-search-heading"><div><h1>Mi mapa</h1><p>{unidad ? `${unidad.placa || unidad.alias} · Tu unidad asignada` : 'Ubicación de tu unidad asignada'}</p></div>
        <Link className="pnl-btn" to="/panel"><Icono nombre="camion" tam={18} />Mi unidad</Link>
      </div>
    </div>
    {(cargando || conError || !unidad || !posicionValida) && <div className="control-panel control-feedback" role="status">
      {cargando ? <Cargando filas={3} /> : conError ? <ErrorCarga onReintentar={reintentar} /> : <Vacio icono="pin"
        titulo={unidad ? 'Todavía no hay posición GPS' : 'No tienes una unidad asignada'}
        texto={unidad ? 'El mapa mostrará tu vehículo cuando llegue una posición válida del GPS.' : 'Pide a tu supervisor que te asigne un vehículo para verlo aquí.'} />}
    </div>}
    {fichaAbierta && unidad && <aside className="control-panel control-unit" aria-label="Mi vehículo">
      <FichaUnidad unidad={unidad} conEnlace={false} alCerrar={() => setFichaAbierta(false)} />
    </aside>}
    <div className="control-live"><i />Actualización cada 15 s<span>Solo tu unidad asignada</span></div>
  </section>
}
