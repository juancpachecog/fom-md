import { useEffect, useMemo, useState } from 'react'
import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { Cargando, ErrorCarga, Vacio } from '../comp/ui'
import { Cabeza, Detectado, IcoGps, Pastilla, ReceptorTarjeta, useAhora } from '../comp/GpsPiezas'
import {
  FILTROS_INVENTARIO, buscarEquipos, cifrasInventario, estadoEquipo, nombreEquipo, senalDe,
} from '../datos/gps'
import {
  ACCION_OTRAS_EMPRESAS, RUTA_OTRAS_EMPRESAS, TEXTO_OTRAS_EMPRESAS, TITULO_OTRAS_EMPRESAS,
  deLaEmpresa, empresasDe, hayListadoGlobal,
} from '../datos/gpsOtrasEmpresas'
import AdminGpsNuevo from './AdminGpsNuevo'
import AdminGpsDetalle from './AdminGpsDetalle'
import AdminGpsInstalar from './AdminGpsInstalar'
import { ProbarGps } from './AdminGpsProbar'
import './admin-gps.css'

// ============================================================
// INVENTARIO GPS (solo Administrador FOM) — T-95
// Cuatro pantallas, como en el diseño aprobado el 21 oct:
//   /panel/admin/gps              Inventario (GW1)
//   /panel/admin/gps/nuevo        Nuevo GPS en 3 pasos (GW2, GW3)
//   /panel/admin/gps/:id          Detalle y diagnóstico (GW5)
//   /panel/admin/gps/:id/instalar Instalar en una unidad (GW4)
//   /panel/admin/gps/:id/probar   Repetir la prueba de señal
// En la dirección va solo el id del equipo: el IMEI, el ICCID y la clave
// SMS nunca viajan en la URL.
// ============================================================

export default function AdminGps() {
  return (
    <Routes>
      <Route index element={<Inventario />} />
      <Route path="nuevo" element={<AdminGpsNuevo />} />
      <Route path=":id" element={<AdminGpsDetalle />} />
      <Route path=":id/instalar" element={<AdminGpsInstalar />} />
      <Route path=":id/probar" element={<ProbarGps />} />
    </Routes>
  )
}

function cargarInventario() {
  return Promise.all([
    repo.admin.gps.listar({}),
    // Solo para la línea chica de la unidad (marca, modelo y año): si falla, la lista sale igual.
    repo.vehiculos.listar({}).catch(() => []),
  ]).then(([equipos, vehiculos]) => ({ equipos, vehiculos }))
}

function Inventario() {
  const navegar = useNavigate()
  const { state } = useLocation()
  const [params, setParams] = useSearchParams()
  // Enlaces viejos traían el IMEI en `?q=`: se usa para buscar y se borra de la dirección.
  const [q, setQ] = useState(() => params.get('q') ?? '')
  useEffect(() => {
    if (params.get('q')) setParams({}, { replace: true })
  }, [params, setParams])
  const [filtro, setFiltro] = useState('todos')
  // Filtro por empresa (T-209): vacío = todas. Las cifras de arriba siempre cuentan el total.
  const [empresaSel, setEmpresaSel] = useState('')
  const ahora = useAhora()

  const { datos, estado, error, recargar } = useDatos(cargarInventario, [], 30_000)
  const detectados = useDatos(() => repo.admin.gps.sinEmparejar(), [], 30_000)

  const equipos = useMemo(() => datos?.equipos ?? [], [datos])
  const porUnidad = useMemo(() => new Map((datos?.vehiculos ?? []).map((v) => [v.id, v])), [datos])
  const cifras = cifrasInventario(equipos, ahora)
  const global = hayListadoGlobal(equipos)
  const empresas = useMemo(() => empresasDe(equipos), [equipos])
  // El buscador mira todas las empresas; el filtro por empresa acota lo que se lista.
  const buscados = deLaEmpresa(buscarEquipos(equipos, q), empresaSel)
  const elegido = FILTROS_INVENTARIO.find((x) => x.clave === filtro) ?? FILTROS_INVENTARIO[0]
  // Primero los montados en una unidad (por nombre), después los del inventario.
  const visibles = buscados
    .filter((g) => elegido.pasa(g, ahora))
    .sort((a, b) => (a.vehiculoId ? 0 : 1) - (b.vehiculoId ? 0 : 1)
      || String(a.vehiculoNombre ?? '').localeCompare(String(b.vehiculoNombre ?? ''), 'es', { numeric: true }))
  const lista = detectados.datos ?? []

  const registrar = (imei) => navegar('nuevo', imei ? { state: { imei } } : undefined)

  return (
    <div className="gp">
      <Cabeza
        ruta={[['Administración FOM'], ['Inventario GPS']]}
        titulo="Inventario GPS"
        bajada="Equipos registrados, en qué unidad están y si envían señal."
        acciones={(
          <>
            {lista.length > 0 && (
              <button type="button" className="gp-btn2" onClick={() => document.getElementById('gp-detectados')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
                <IcoGps nombre="senal" />Detectados sin registrar · {lista.length}
              </button>
            )}
            <button type="button" className="gp-btn" onClick={() => registrar()}><IcoGps nombre="mas" />Nuevo GPS</button>
          </>
        )}
      />

      {state?.aviso && <div className="gp-aviso" role="status"><IcoGps nombre="check" />{state.aviso}</div>}

      {/* T-209: el servidor solo deja leer aquí los equipos de la empresa propia. */}
      {!global && (
      <div className="gp-aviso info" role="note" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <IcoGps nombre="senal" />
        <span style={{ flex: 1, minWidth: 220 }}><b>{TITULO_OTRAS_EMPRESAS}.</b> {TEXTO_OTRAS_EMPRESAS}</span>
        <Link className="gp-btn2 chico" to={RUTA_OTRAS_EMPRESAS}>{ACCION_OTRAS_EMPRESAS}</Link>
      </div>
      )}

      {estado === 'cargando' && <section className="gp-card"><Cargando filas={6} /></section>}
      {estado === 'error' && <section className="gp-card"><ErrorCarga onReintentar={recargar} error={error} /></section>}

      {estado === 'ok' && (
        <>
          <section className="gp-card gp-cifras" aria-label="Cifras del inventario">
            <Cifra punto="var(--e-texto-3, #8c97a7)" titulo="Equipos" valor={cifras.equipos} nota="En el inventario" />
            <Cifra punto="var(--e-exito, #3dd68c)" titulo="Con señal" valor={cifras.conSenal} nota="Reportaron en los últimos 5 min" />
            <Cifra punto="var(--e-peligro, #ff6369)" titulo="Sin señal" valor={cifras.sinSenal} nota="Instalados y sin reportar" />
            <Cifra punto="#3d9bf5" titulo="Sin instalar" valor={cifras.sinInstalar} nota="Esperan una unidad" />
          </section>

          <div className="gp-grid">
            <section className="gp-card" style={{ padding: '18px 8px 6px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: '0 12px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h2 className="gp-st">Equipos</h2>
                <div className="gp-chips" role="group" aria-label="Filtrar equipos" style={{ marginLeft: 8 }}>
                  {FILTROS_INVENTARIO.map((x) => (
                    <button key={x.clave} type="button" className="gp-chip" aria-pressed={filtro === x.clave} onClick={() => setFiltro(x.clave)}>
                      {x.titulo} <b>{buscados.filter((g) => x.pasa(g, ahora)).length}</b>
                    </button>
                  ))}
                </div>
              </div>
              {empresas.length > 1 && (
                <div className="gp-chips" role="group" aria-label="Filtrar por empresa" style={{ padding: '0 12px', flexWrap: 'wrap' }}>
                  <button type="button" className="gp-chip" aria-pressed={!empresaSel} onClick={() => setEmpresaSel('')}>Todas las empresas <b>{equipos.length}</b></button>
                  {empresas.map((e) => (
                    <button key={e.id} type="button" className="gp-chip" aria-pressed={empresaSel === e.id} onClick={() => setEmpresaSel(e.id)}>{e.nombre} <b>{e.equipos}</b></button>
                  ))}
                </div>
              )}
              <div style={{ padding: '0 12px' }}>
                <label htmlFor="gp-buscar" className="gp-sr">Buscar equipo</label>
                <div className="gp-field">
                  <IcoGps nombre="buscar" />
                  <input id="gp-buscar" type="search" placeholder={global ? 'Buscar IMEI, línea, unidad o empresa…' : 'Buscar IMEI, línea o unidad…'} value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
                </div>
              </div>

              {equipos.length === 0 ? (
                <Vacio icono="pin" titulo="Inventario vacío" texto="Registra el primer equipo con «Nuevo GPS»." />
              ) : visibles.length === 0 ? (
                <Vacio icono="buscar" titulo="Nada en este grupo" texto="Cambia el filtro o la búsqueda para ver los demás equipos." compacto />
              ) : (
                <div className="gp-tabla-caja">
                  <table className="gp-tbl">
                    <thead>
                      <tr><th>Equipo</th>{global && <th>Empresa</th>}<th>Unidad</th><th>Línea SIM</th><th>Estado</th><th>Señal</th><th><span className="gp-sr">Abrir</span></th></tr>
                    </thead>
                    <tbody>
                      {visibles.map((g) => (
                        <FilaEquipo key={g.id} g={g} conEmpresa={global} unidad={porUnidad.get(g.vehiculoId)} ahora={ahora} abrir={() => navegar(g.id)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="gp-pila">
              <ReceptorTarjeta ahora={ahora} />
              <section className="gp-card gp-col" id="gp-detectados" aria-labelledby="gp-det-t">
                <div className="gp-titulo">
                  <h2 className="gp-st" id="gp-det-t">Detectados sin registrar</h2>
                  <span className="gp-hint">Ya transmiten al receptor y no están en ninguna empresa.</span>
                </div>
                {detectados.estado === 'cargando' && <span className="gp-hint">Buscando…</span>}
                {detectados.estado === 'error' && <span className="gp-hint">{detectados.error?.message}</span>}
                {detectados.estado === 'ok' && lista.length === 0 && (
                  <span className="gp-hint">Nada sin registrar: todo IMEI que llega al receptor ya está en alguna empresa.</span>
                )}
                {lista.map((d) => (
                  <Detectado key={d.imei} d={d} ahora={ahora}>
                    <button type="button" className="gp-btn2 chico" onClick={() => registrar(d.imei)}>Registrar este</button>
                  </Detectado>
                ))}
                {lista.length > 0 && (
                  <button type="button" className="gp-btn2 ancho" onClick={() => registrar((lista.find((d) => d.reportando) ?? lista[0]).imei)}>
                    Registrar un detectado
                  </button>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Cifra({ punto, titulo, valor, nota }) {
  return (
    <div className="gp-kcell">
      <span className="gp-lbl"><i style={{ background: punto }} />{titulo}</span>
      <span className="gp-num">{valor}</span>
      <span className="gp-hint">{nota}</span>
    </div>
  )
}

function FilaEquipo({ g, unidad, ahora, abrir, conEmpresa }) {
  const est = estadoEquipo(g.estado)
  const senal = senalDe(g, ahora)
  const subUnidad = unidad ? [unidad.marca, unidad.modelo, unidad.anio].filter(Boolean).join(' ') : !conEmpresa && g.empresaNombre && g.empresaNombre !== '—' ? g.empresaNombre : ''
  return (
    <tr className="abrible" onClick={abrir}>
      <td>
        <b>{nombreEquipo(g)}</b><br />
        <span className="gp-hint gp-mono mono">IMEI {g.imei}</span>
      </td>
      {conEmpresa && <td><Pastilla tono="mute">{g.empresaNombre}</Pastilla></td>}
      <td>
        {g.vehiculoId ? (
          <><b>{g.vehiculoNombre || 'Unidad sin nombre'}</b>{subUnidad && <><br /><span className="gp-hint">{subUnidad}</span></>}</>
        ) : (
          <><span className="claro">En inventario</span>{g.ubicacion && <><br /><span className="gp-hint">{g.ubicacion}</span></>}</>
        )}
      </td>
      <td>
        {g.linea ? (
          <><span className="claro">{g.linea}</span>{g.carrier && <><br /><span className="gp-hint">{g.carrier}</span></>}</>
        ) : <span className="gp-hint">Sin línea</span>}
      </td>
      <td><Pastilla tono={est.tono}>{est.texto}</Pastilla></td>
      <td><Pastilla tono={senal.tono} punto>{senal.texto}</Pastilla></td>
      <td className="der">
        <button type="button" className="gp-enlace" onClick={(e) => { e.stopPropagation(); abrir() }} aria-label={`Ver ${nombreEquipo(g)} ${g.vehiculoNombre ?? 'en inventario'}`}>Ver →</button>
      </td>
    </tr>
  )
}
