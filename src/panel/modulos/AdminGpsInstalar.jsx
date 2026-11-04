import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { Cargando, ErrorCarga, Vacio } from '../comp/ui'
import NuevaUnidadEmpresa from '../comp/NuevaUnidadEmpresa'
import { Cabeza, IcoGps, Pastilla, RAIZ_GPS, useAhora } from '../comp/GpsPiezas'
import { estadoEquipo, nombreEquipo, senalDe } from '../datos/gps'
import { empresaDeInstalacion, empresaPropia } from '../datos/instalarGps'
import * as f from '../datos/formato'
import './admin-gps.css'

// ============================================================
// INSTALAR EN UNA UNIDAD (T-95, tablero GW4)
// Empresa → una de sus unidades sin GPS → técnico, ubicación y notas.
// Un equipo va en una sola unidad y cada unidad lleva un solo GPS; el
// servidor lo sostiene y aquí se avisa antes. El servidor deja instalar un
// equipo que nunca reportó (se monta antes de oírse), y se avisa de probarlo.
// POST gps-devices/:id/installation; la fecha la pone el servidor al guardar.
// T-215: «Crear unidad aquí» crea la unidad en la empresa elegida (sin entrar a ella) y le instala
// el equipo en el mismo paso; el inventario es global, así que la empresa se puede elegir libremente.
// ============================================================

export default function AdminGpsInstalar() {
  const { id } = useParams()
  const navegar = useNavigate()
  const sesion = useSesion()
  const ahora = useAhora()
  const equipo = useDatos(() => repo.admin.gps.obtener(id), [id])
  const empresas = useDatos(() => repo.admin.empresas.listar({}), [])
  const [empresaElegida, setEmpresaElegida] = useState('')
  const [q, setQ] = useState('')
  const [soloSinGps, setSoloSinGps] = useState(true)
  const [unidadId, setUnidadId] = useState('')
  const [tecnico, setTecnico] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [creando, setCreando] = useState(false)

  const listaEmpresas = useMemo(() => empresas.datos ?? [], [empresas.datos])
  // Por defecto, la empresa del equipo si el servidor la dice (T-209); si no, la propia del
  // administrador (aunque esté «dentro» de otra) y, si no, la primera. Con el inventario global
  // (#749) se puede elegir cualquiera: si el servidor publicado aún no lo admite, rechaza al
  // instalar y se explica en llano (T-215).
  const propia = empresaPropia(sesion)
  const nombrePropia = listaEmpresas.find((e) => e.id === propia)?.nombre || 'tu empresa'
  const dueno = equipo.datos?.empresaId || ''
  const empresaId = empresaElegida
    || dueno
    || listaEmpresas.find((e) => e.id === propia)?.id
    || listaEmpresas[0]?.id
    || ''
  const rutaEmpresa = empresaDeInstalacion(empresaId, propia)
  const unidades = useDatos(
    () => (empresaId ? repo.admin.gps.unidadesDe(empresaId) : Promise.resolve([])),
    [empresaId],
  )

  const g = equipo.datos
  const todas = unidades.datos ?? []
  const sinGps = todas.filter((u) => !u.gps)
  const t = q.trim().toLowerCase()
  const visibles = (soloSinGps ? sinGps : todas)
    .filter((u) => !t || [u.alias, u.placa, u.conductorNombre].some((v) => String(v ?? '').toLowerCase().includes(t)))
    .sort((a, b) => String(a.alias).localeCompare(String(b.alias), 'es', { numeric: true }))
  const unidad = todas.find((u) => u.id === unidadId && !u.gps) ?? null
  const puedeCrear = Boolean(empresaId) && !g?.vehiculoId && g?.estado === 'inventory'

  const instalar = async () => {
    if (!unidad) { setError('Elige la unidad donde va el equipo.'); return }
    setGuardando(true)
    setError('')
    try {
      await repo.admin.gps.instalar(g.id, {
        vehiculoId: unidad.id,
        // La propia viaja por la ruta propia (null); otra empresa, por la suya.
        empresaId: rutaEmpresa,
        nombrePropia,
        tecnico, ubicacion, notas,
      })
      navegar(`${RAIZ_GPS}/${g.id}`, {
        state: {
          aviso: g.ultimaConexion
            ? `Equipo instalado en ${unidad.alias}.`
            : `Equipo instalado en ${unidad.alias}. Aún no ha reportado: usa «Probar señal» para comprobar que empiece a enviar.`,
        },
      })
    } catch (e) {
      setError(e.message)
      setGuardando(false)
    }
  }

  // Creada la unidad con su GPS: se va al detalle del equipo, igual que al instalar en una existente.
  const instaladoAlCrear = (r) => {
    setCreando(false)
    navegar(`${RAIZ_GPS}/${g.id}`, {
      state: {
        aviso: g.ultimaConexion
          ? `Unidad ${r.alias} creada en ${r.empresaNombre} y equipo instalado.`
          : `Unidad ${r.alias} creada en ${r.empresaNombre} y equipo instalado. Aún no ha reportado: usa «Probar señal» para comprobar que empiece a enviar.`,
      },
    })
  }
  // Se creó la unidad pero el equipo no entró: queda en la lista, elegida, para instalarlo con el botón de siempre.
  const creadaSinEquipo = (r) => {
    unidades.recargar()
    setSoloSinGps(true)
    setUnidadId(r.vehiculoId)
  }

  const ruta = [['Administración FOM'], ['Inventario GPS', RAIZ_GPS], [g?.imei ?? 'Equipo', `${RAIZ_GPS}/${id}`], ['Instalar']]

  if (equipo.estado !== 'ok' || !g) {
    return (
      <div className="gp">
        <Cabeza ruta={ruta} titulo="Instalar en una unidad" bajada="Un equipo va en una sola unidad y cada unidad lleva un solo GPS." />
        <section className="gp-card">
          {equipo.estado === 'cargando' && <Cargando filas={4} />}
          {equipo.estado === 'error' && <ErrorCarga onReintentar={equipo.recargar} error={equipo.error} />}
          {equipo.estado === 'ok' && !g && <Vacio icono="pin" titulo="Ese equipo no está en el inventario" texto="No lo encontramos entre los equipos de tu empresa. Puede estar registrado en otra empresa: desde aquí solo se ven los de la propia. Vuelve al inventario y elige otro." />}
        </section>
      </div>
    )
  }

  const est = estadoEquipo(g.estado)
  const senal = senalDe(g, ahora)
  const yaInstalado = Boolean(g.vehiculoId)
  const fueraDeInventario = !yaInstalado && g.estado !== 'inventory'

  return (
    <div className="gp">
      <Cabeza ruta={ruta} titulo="Instalar en una unidad" bajada="Un equipo va en una sola unidad y cada unidad lleva un solo GPS." />

      {yaInstalado && (
        <div className="gp-aviso info">
          Este equipo ya está instalado en {g.vehiculoNombre}. Para llevarlo a otra unidad, desmóntalo primero desde <Link className="gp-enlace" to={`${RAIZ_GPS}/${g.id}`}>su detalle</Link>.
        </div>
      )}
      {fueraDeInventario && (
        <div className="gp-aviso error" role="alert">
          Solo se instala un equipo que está en el inventario, y este está «{est.texto}». Cámbialo a «En inventario» en «Datos del equipo» y vuelve.
        </div>
      )}

      <div className="gp-grid l400">
        <section className="gp-card" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '22px 24px' }} aria-labelledby="gp-elige">
          <div className="gp-titulo">
            <h2 className="gp-st" id="gp-elige">Elige la unidad</h2>
            <span className="gp-lbl">Primero la empresa; luego una de sus unidades sin GPS, o crea una nueva ahí mismo.</span>
          </div>
          <div className="gp-campos">
            <div className="gp-f">
              <label htmlFor="i-emp">Empresa</label>
              <div className="gp-field">
                <IcoGps nombre="empresa" />
                <select id="i-emp" value={empresaId} onChange={(e) => { setEmpresaElegida(e.target.value); setUnidadId('') }} disabled={empresas.estado !== 'ok'}>
                  {listaEmpresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
                <IcoGps nombre="abajo" />
              </div>
            </div>
            <div className="gp-f">
              <label htmlFor="i-buscar">Buscar unidad</label>
              <div className="gp-field">
                <IcoGps nombre="buscar" />
                <input id="i-buscar" type="search" placeholder="Número, placa o conductor…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="gp-chips" role="group" aria-label="Filtrar unidades">
            <button type="button" className="gp-chip" aria-pressed={soloSinGps} onClick={() => setSoloSinGps(true)}>Sin GPS <b>{sinGps.length}</b></button>
            <button type="button" className="gp-chip" aria-pressed={!soloSinGps} onClick={() => setSoloSinGps(false)}>Todas <b>{todas.length}</b></button>
            {puedeCrear && !(unidades.estado === 'ok' && todas.length === 0) && (
              <button type="button" className={sinGps.length === 0 && unidades.estado === 'ok' ? 'gp-btn chico' : 'gp-btn2 chico'} style={{ marginLeft: 'auto', alignSelf: 'center' }} onClick={() => setCreando(true)}>
                <IcoGps nombre="mas" />Crear unidad aquí
              </button>
            )}
          </div>

          {empresas.estado === 'error' && <ErrorCarga onReintentar={empresas.recargar} error={empresas.error} compacto />}
          {unidades.estado === 'cargando' && <Cargando filas={3} />}
          {unidades.estado === 'error' && <ErrorCarga onReintentar={unidades.recargar} error={unidades.error} compacto />}
          {unidades.estado === 'ok' && visibles.length === 0 && (
            <Vacio icono="camion" compacto
              titulo={todas.length === 0 ? 'Esta empresa no tiene unidades' : 'Ninguna unidad en este grupo'}
              texto={todas.length === 0 ? 'Crea la primera aquí mismo, sin entrar a la empresa, o elige otra empresa.' : soloSinGps ? 'Todas sus unidades ya llevan GPS. Mira «Todas», crea una nueva o elige otra empresa.' : 'Cambia la búsqueda.'}
              accion={puedeCrear && todas.length === 0 ? <button type="button" className="gp-btn" onClick={() => setCreando(true)}><IcoGps nombre="mas" />Crear unidad aquí</button> : null} />
          )}
          {unidades.estado === 'ok' && visibles.length > 0 && (
            <fieldset className="gp-unidades">
              <legend className="gp-sr">Unidad donde instalar</legend>
              {visibles.map((u) => {
                const ocupada = Boolean(u.gps)
                const elegida = unidadId === u.id && !ocupada
                const sub = [[u.marca, u.modelo, u.anio].filter(Boolean).join(' '), ocupada ? `ya lleva el GPS …${String(u.gps.imei ?? '').slice(-4)}` : u.conductorNombre].filter(Boolean).join(' · ')
                return (
                  <label key={u.id} htmlFor={`u-${u.id}`} className={`gp-det${elegida ? ' sel' : ''}${ocupada ? ' apagada' : ''}`}>
                    <input type="radio" id={`u-${u.id}`} name="unidad" checked={elegida} disabled={ocupada || yaInstalado} onChange={() => setUnidadId(u.id)} />
                    <span className="gp-ibox"><IcoGps nombre="camion" /></span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                      <b>{u.alias}{u.placa ? ` · ${u.placa}` : ''}</b>
                      {sub && <span className="gp-hint">{sub}</span>}
                    </span>
                    {ocupada ? <Pastilla tono="mute">Ya tiene GPS</Pastilla> : <Pastilla tono="info">Sin GPS</Pastilla>}
                  </label>
                )
              })}
            </fieldset>
          )}
        </section>

        <div className="gp-pila">
          <section className="gp-card gp-col" style={{ gap: 10 }}>
            <p className="gp-k">Equipo</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="gp-ibox"><IcoGps nombre="gps" /></span>
              <div className="gp-titulo">
                <b style={{ fontSize: 15, fontWeight: 600 }}>{nombreEquipo(g)}</b>
                <span className="gp-hint gp-mono">IMEI {g.imei}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Pastilla tono={est.tono}>{est.texto}</Pastilla>
              <Pastilla tono={senal.tono} punto>{senal.texto}</Pastilla>
            </div>
            <span className="gp-hint">{g.linea ? `Línea ${g.linea}${g.carrier ? ` · ${g.carrier}` : ''}` : 'Sin línea registrada'}</span>
            {!g.ultimaConexion && (
              <div className="gp-aviso info" role="note">Este equipo aún no ha reportado; tras instalarlo comprueba que empiece a enviar señal.</div>
            )}
          </section>

          <section className="gp-card gp-col" style={{ gap: 14 }} aria-labelledby="gp-datos-ins">
            <h2 className="gp-st" id="gp-datos-ins">Datos de la instalación</h2>
            <div className="gp-f">
              <label htmlFor="i-fecha">Fecha de instalación *</label>
              <div className="gp-field ro"><IcoGps nombre="reloj" /><input id="i-fecha" value={f.fecha(new Date().toISOString())} readOnly /></div>
              <span className="gp-hint">La pone el servidor al guardar: es el momento de la instalación.</span>
            </div>
            <div className="gp-f">
              <label htmlFor="i-tec">Técnico</label>
              <div className="gp-field"><input id="i-tec" placeholder="Quién lo montó" maxLength={120} value={tecnico} onChange={(e) => setTecnico(e.target.value)} /></div>
            </div>
            <div className="gp-f">
              <label htmlFor="i-ubi">Ubicación en la unidad</label>
              <div className="gp-field"><input id="i-ubi" placeholder="Bajo el tablero, lado del copiloto" maxLength={255} value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} /></div>
            </div>
            <div className="gp-f">
              <label htmlFor="i-notas">Notas</label>
              <div className="gp-field"><input id="i-notas" placeholder="Opcional" maxLength={500} value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
            </div>
            {error && <div className="gp-aviso error" role="alert">{error}</div>}
            <button type="button" className="gp-btn ancho" disabled={!unidad || guardando || yaInstalado || fueraDeInventario} onClick={instalar}>
              <IcoGps nombre="enlace" />{guardando ? 'Instalando…' : unidad ? `Instalar en ${unidad.alias}` : 'Elige una unidad'}
            </button>
            <span className="gp-hint">Al desmontarlo, el equipo vuelve al inventario con todo su historial.</span>
          </section>
        </div>
      </div>

      {puedeCrear && (
        <NuevaUnidadEmpresa
          abierto={creando}
          empresas={listaEmpresas}
          empresaInicial={empresaId}
          empresaFija
          equipoFijo={{ id: g.id, imei: g.imei, modelo: nombreEquipo(g) }}
          datosInstalacion={{ tecnico, ubicacion, notas }}
          propia={propia}
          nombrePropia={nombrePropia}
          alCerrar={() => setCreando(false)}
          alCerrarConUnidad={creadaSinEquipo}
          alListo={instaladoAlCrear}
        />
      )}
    </div>
  )
}
