import { useMemo } from 'react'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { miAsignacion } from '../datos/asignacion-conductor'
export { miAsignacion } from '../datos/asignacion-conductor'
import { Cabecera, Cargando, Datos, ErrorCarga, Tag, Tarjeta, Vacio } from '../comp/ui'
import Mapa from '../comp/Mapa'
import * as f from '../datos/formato'
import { etiqueta } from '../datos/catalogos'
import { Icono } from '../Iconos'
import FichaUnidad from '../comp/FichaUnidad'
import ScoreManejo from '../comp/ScoreManejo'

// ============================================================
// MI UNIDAD — el inicio del conductor
// ------------------------------------------------------------
// Copia la pantalla de inicio del conductor de la app (`(driver)/index`): la
// unidad que tiene asignada, dónde está, cómo está, la inspección del día y
// lo que hay pendiente de mantenimiento. Nada más: un conductor no ve la
// flota entera, ni la gente, ni los reportes — eso es del panel operativo.
//
// La composición es la «Opción C · Ficha del conductor» elegida por Marco:
// una franja de identidad arriba, el mapa en medio con los números encima, y
// abajo «Hoy» como lista de tareas junto a la ficha.
//
// Reportar una falla y hacer la inspección son trabajo de campo y se hacen
// desde la app: el servidor exige rol de gestor para abrirlas desde la
// consola. Aquí se dice, en vez de ofrecer un botón que va a fallar.
// ============================================================

/**
 * Encuentra la asignación del conductor que ha entrado.
 *
 * La sesión web trae el correo y el nombre pero no el identificador, y la
 * lista de conductores trae el identificador y el nombre pero no el correo.
 * Mientras el servidor no mande el identificador en la sesión, se empareja
 * por nombre; cuando lo mande, `perfil.userId` manda y el nombre sobra.
 */
/** Distancia en km entre dos puntos (haversine). Suficiente para sumar un recorrido. */
function distanciaKm(a, b) {
  const R = 6371
  const rad = (g) => (g * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Kilómetros recorridos HOY según los puntos GPS del día. La base no guarda
 * odómetro ni velocidad, así que esto es lo único que se puede decir con
 * honestidad sobre cuánto se movió la unidad; si hoy no hay puntos, null.
 */
function kmDeHoy(recorrido, hoy) {
  const puntos = (recorrido ?? []).filter((p) => String(p.hora ?? '').slice(0, 10) === hoy)
  if (puntos.length < 2) return puntos.length ? 0 : null
  let total = 0
  for (let i = 1; i < puntos.length; i += 1) total += distanciaKm(puntos[i - 1], puntos[i])
  return total
}

/**
 * Pone la última posición encima de la ficha. La ficha (placa, modelo,
 * equipo) se pide una sola vez porque cuesta unos 8 pedidos; lo que cambia
 * —dónde está, a qué velocidad, cuándo reportó— sale de un pedido pequeño de
 * posiciones que sí se repite. También lo usa el mapa del conductor.
 */
export function conPosicionFresca(unidad, punto) {
  if (!unidad || !punto) return unidad
  const conPunto = { ...unidad, lat: punto.lat, lng: punto.lng }
  // Solo si el punto es más nuevo que lo que ya decía la ficha: un punto viejo
  // no debe pisar una señal más reciente.
  const nuevo = !unidad.ultimoReporte || Date.parse(punto.hora) > Date.parse(unidad.ultimoReporte)
  if (!nuevo) return conPunto
  const v = punto.velocidadKmh ?? null
  return {
    ...conPunto,
    ultimoReporte: punto.hora,
    posicionEn: punto.hora,
    velocidadKmh: v,
    rumbo: punto.rumbo ?? unidad.rumbo ?? null,
    ignition: 'ignition' in punto ? punto.ignition : unidad.ignition,
    // Igual que la base: la marcha se deduce de la velocidad; sin velocidad no se afirma.
    estadoMarcha: v == null ? null : v > 0 ? 'en_marcha' : 'parada',
    conectado: true,
    conexion: 'reportando',
  }
}

/** Una cifra sobre el mapa: etiqueta pequeña arriba, valor tabular debajo. */
function Cifra({ etiqueta: k, valor, tono = '' }) {
  return (
    <div className="pnl-cifra">
      <span className="pnl-cifra-k">{k}</span>
      <span className={`pnl-cifra-v${tono ? ` ${tono}` : ''}`}>{valor}</span>
    </div>
  )
}

export default function MiUnidad() {
  const sesion = useSesion()
  const perfil = sesion?.perfil

  // `repo.conductores()` devuelve las asignaciones vigentes de la empresa:
  // { id, nombre, rol, vehiculoId, vehiculo, desde }.
  // Se vuelve a preguntar cada 5 minutos: quien deja la pantalla abierta se
  // entera solo de que le asignaron una unidad —o se la quitaron—, y una
  // asignación cambia pocas veces al día; preguntar cada minuto era cupo
  // del servidor gastado en la misma respuesta.
  const CINCO_MINUTOS = 5 * 60_000
  const asignaciones = useDatos(() => repo.conductores(), [], CINCO_MINUTOS)

  const asignacion = useMemo(
    () => miAsignacion(perfil, asignaciones.datos ?? []),
    [perfil, asignaciones.datos],
  )
  const vehiculoId = asignacion?.vehiculoId ?? null
  // Solo SU unidad. Listar la flota entera descargaría la posición de todos
  // los vehículos de la empresa para un conductor que solo necesita el suyo:
  // más tráfico, y más de lo que le toca ver.
  // El expediente se pide UNA vez por unidad: ya trae sus órdenes e
  // inspecciones (filtradas por la unidad), así que no se vuelven a pedir.
  const vehiculos = useDatos(
    () => (vehiculoId ? repo.vehiculos.obtener(vehiculoId) : Promise.resolve(null)),
    [vehiculoId],
  )
  // Lo vivo —dónde está y por dónde ha ido hoy— sale de UN pedido de
  // posiciones cada 30 s: da el punto del mapa, el trazo y los km de hoy.
  const vivo = useDatos(
    async () => ({ vehiculoId, recorrido: vehiculoId ? await repo.recorrido(vehiculoId) : [] }),
    [vehiculoId],
    30_000,
  )
  const ficha = vehiculos.datos ?? null
  const recorridoVivo = ficha && vivo.datos?.vehiculoId === ficha.id ? vivo.datos.recorrido : null
  const unidad = useMemo(() => {
    if (!ficha) return null
    if (!recorridoVivo?.length) return ficha
    return conPosicionFresca({ ...ficha, recorrido: recorridoVivo }, recorridoVivo.at(-1))
  }, [ficha, recorridoVivo])

  // El expediente no trae coordenadas; el recorrido sí. El último punto es
  // donde está la unidad, y es lo que el mapa necesita para pintarla.
  const enMapa = useMemo(() => {
    if (!unidad) return []
    const ultimo = (unidad.recorrido ?? []).at(-1) ?? null
    const lat = unidad.lat ?? ultimo?.lat ?? null
    const lng = unidad.lng ?? ultimo?.lng ?? null
    return lat != null && lng != null ? [{ ...unidad, lat, lng }] : []
  }, [unidad])

  // «Cargando» también mientras la unidad que llegó no es la de la
  // asignación actual: el hook conserva el estado «ok» anterior al cambiar de
  // dependencias, y sin esto se ve un «no tienes unidad» falso durante la
  // carga del expediente.
  const cargando =
    asignaciones.estado === 'cargando' ||
    vehiculos.estado === 'cargando' ||
    (asignacion != null && vehiculos.estado !== 'error' && unidad?.id !== asignacion.vehiculoId)
  const error = asignaciones.error ?? vehiculos.error
  const abiertas = (unidad?.odts ?? []).filter((o) => o.estado === 'abierta' || o.estado === 'en_revision')
  const hoy = f.hoyISO()
  const inspeccionHoy = (unidad?.inspecciones ?? []).find((i) => String(i.fecha ?? '').slice(0, 10) === hoy)
  const reportando = unidad?.conexion === 'reportando'
  const kmHoy = useMemo(() => kmDeHoy(unidad?.recorrido, hoy), [unidad?.recorrido, hoy])
  const posicion = enMapa[0] ? `${enMapa[0].lat.toFixed(4)}, ${enMapa[0].lng.toFixed(4)}` : null

  return (
    <>
      <Cabecera
        titulo="Mi unidad"
        bajada={unidad ? 'Dónde está, cómo está y qué te toca hoy.' : 'La unidad que tienes asignada hoy.'}
      />

      {cargando && <Cargando filas={6} />}
      {!cargando && error && <ErrorCarga onReintentar={() => { asignaciones.recargar(); vehiculos.recargar() }} error={error} />}

      {!cargando && !error && !unidad && (
        <Tarjeta>
          <Vacio
            icono="camion"
            titulo="No tienes una unidad asignada"
            texto="Cuando tu supervisor te asigne un vehículo, aquí verás dónde está, su estado, la inspección del día y el mantenimiento pendiente."
          />
        </Tarjeta>
      )}

      {!cargando && !error && unidad && (
        <div className="mu mu-redesign">
          {/* --- Franja de identidad ------------------------------------ */}
          <section className="pnl-card mu-identidad" aria-label="Identidad de la unidad">
            <div className="mu-identidad-icono" aria-hidden="true">
              <Icono nombre="camion" tam={28} />
            </div>
            <div className="mu-identidad-txt">
              <div className="mu-identidad-linea">
                <h2 className="mu-alias">{unidad.alias}</h2>
                <span className="mu-placa">{unidad.placa}</span>
                <span className="mu-modelo">{`${unidad.marca} ${unidad.modelo}`.trim()}</span>
              </div>
              <p className="mu-identidad-sub">
                {asignacion.rol === 'secundario' ? 'Conductor secundario' : 'Conductor principal'}
                {' · '}asignada desde el {f.fecha(asignacion.desde)}
              </p>
            </div>
            <div className={`mu-estado${reportando ? ' ok' : ' aviso'}`} role="status">
              <span className="mu-estado-punto" aria-hidden="true" />
              {reportando ? 'Reportando' : 'Sin señal'}
              <span className="mu-estado-sep" aria-hidden="true">·</span>
              <span className="mu-estado-nota">
                {unidad.ultimoReporte ? `última señal ${f.desde(unidad.ultimoReporte)}` : 'sin reportes todavía'}
              </span>
            </div>
          </section>

          <ScoreManejo />
          <div className="mu-vehicle"><Tarjeta titulo="Tu vehículo"><FichaUnidad unidad={unidad} conEnlace={false} /></Tarjeta></div>
          {/* --- Posición y cifras de la unidad -------------------------- */}
          <section className="mu-mapa" aria-label="Posición de la unidad">
            {enMapa.length > 0 ? (
              <Mapa
                vehiculos={enMapa}
                recorrido={unidad.recorrido ?? null}
                alto="clamp(400px, calc(100vh - 450px), 820px)"
                leyenda={false}
                ficha={false}
              />
            ) : (
              <div className="mu-mapa-vacio">
                <Vacio
                  icono="pin"
                  titulo="Sin posición todavía"
                  texto="Cuando el GPS de la unidad reporte, aquí verás dónde está."
                />
              </div>
            )}
            <div className="pnl-cifras" aria-label="Cifras de la unidad">
              <Cifra etiqueta="Estado" valor={reportando ? 'Reportando' : 'Sin señal'} tono={reportando ? 'ok' : 'aviso'} />
              <Cifra etiqueta="Última señal" valor={unidad.ultimoReporte ? f.desde(unidad.ultimoReporte) : '—'} />
              <Cifra etiqueta="Recorrido hoy" valor={kmHoy != null ? `${kmHoy.toFixed(kmHoy < 10 ? 1 : 0).replace('.', ',')} km` : '—'} />
              <Cifra etiqueta="Posición" valor={posicion ?? '—'} />
            </div>
          </section>

          {/* --- Hoy + Ficha ------------------------------------------- */}
          <div className="mu-abajo">
            <Tarjeta titulo="Hoy">
              <ul className="mu-hoy">
                <li className="mu-hoy-fila">
                  <span className={`mu-hoy-icono${inspeccionHoy ? ' ok' : ' aviso'}`} aria-hidden="true">
                    <Icono nombre="check" tam={18} />
                  </span>
                  <span className="mu-hoy-txt">
                    <b>Inspección del día</b>
                    <span>{inspeccionHoy ? `${etiqueta('inspeccion_resultado', inspeccionHoy.resultado)} · registrada desde la app` : 'Pendiente · se hace desde la app'}</span>
                  </span>
                  <Tag color={inspeccionHoy ? 'verde' : 'ambar'}>{inspeccionHoy ? 'Hecha' : 'Pendiente'}</Tag>
                </li>
                <li className="mu-hoy-fila">
                  <span className={`mu-hoy-icono${abiertas.length > 0 ? ' aviso' : ' ok'}`} aria-hidden="true">
                    <Icono nombre="llave" tam={18} />
                  </span>
                  <span className="mu-hoy-txt">
                    <b>Mantenimiento</b>
                    <span>
                      {abiertas.length === 0
                        ? 'Sin fallas reportadas ni trabajos en taller'
                        : `${abiertas.length} ${abiertas.length === 1 ? 'orden abierta' : 'órdenes abiertas'} o en taller`}
                    </span>
                  </span>
                  <Tag color={abiertas.length > 0 ? 'ambar' : 'verde'}>{abiertas.length > 0 ? 'Pendiente' : 'Al día'}</Tag>
                </li>
                {abiertas.map((o) => (
                  <li className="mu-hoy-fila sub" key={o.id}>
                    <span className="mu-hoy-txt">
                      <b>{o.descripcion}</b>
                      <span>{o.falla ? etiqueta('tipo_falla', o.falla) : 'Sin tipo'} · {f.desde(o.creadaEn)}</span>
                    </span>
                    <Tag color={o.estado === 'en_revision' ? 'ambar' : 'azul'} plano>{etiqueta('odt_estado', o.estado)}</Tag>
                  </li>
                ))}
              </ul>
              {/* Se dice, en vez de ofrecer un botón que el servidor va a
                  rechazar: abrir una orden desde la consola exige rol de
                  gestor. El conductor la reporta desde la app, sobre su
                  unidad, que es como está pensado. */}
              <p className="mu-nota">
                <Icono nombre="llamar" tam={16} />
                <span>Para reportar una falla o hacer la inspección del día usa la <b>app FOM</b> en tu teléfono.</span>
              </p>
            </Tarjeta>

            <Tarjeta titulo="Ficha de la unidad">
              <Datos
                items={[
                  { etiqueta: 'Alias', valor: unidad.alias },
                  { etiqueta: 'Placa', valor: unidad.placa },
                  { etiqueta: 'Marca y modelo', valor: `${unidad.marca} ${unidad.modelo}`.trim() },
                  { etiqueta: 'Tu rol en la unidad', valor: asignacion.rol === 'secundario' ? 'Conductor secundario' : 'Conductor principal' },
                  { etiqueta: 'Asignada desde', valor: f.fecha(asignacion.desde) },
                ]}
              />
            </Tarjeta>
          </div>
        </div>
      )}
    </>
  )
}
