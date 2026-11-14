import { useConfirmar } from './Confirmar'
import { useEffect, useRef, useState } from 'react'
import repo from '../datos/repo'
import { Campo, Modal } from './ui'
import { Icono } from '../Iconos'
import { empresaDeInstalacion } from '../datos/instalarGps'
import { TIPOS_UNIDAD, UNIDAD_VACIA, LIMITES_UNIDAD, validarUnidad } from '../datos/unidadEnEmpresa'
import { crearUnidadEnEmpresa } from '../datos/unidadEnEmpresaApi'
import './nueva-unidad-empresa.css'

// ============================================================
// NUEVA UNIDAD EN UNA EMPRESA (T-215, solo Administrador FOM)
// Crea la unidad en la empresa elegida por la ruta de ESA empresa (`/tenants/{id}/vehicles`),
// sin «entrar» a ella, y si hay un GPS elegido lo instala en el mismo paso. Se usa en
// «Vehículos generales» (empresa y GPS libres a elegir) y en «Instalar en una unidad» (empresa y
// equipo ya fijos: un solo botón, «Crear e instalar»).
//
// Si la unidad se crea y el GPS no se instala, la unidad queda guardada en el formulario: el botón
// pasa a «Instalar el GPS» y reintentar NO crea otra.
// ============================================================

/**
 * @param {object} p
 * @param {boolean} p.abierto
 * @param {Array<{id: string, nombre: string}>} p.empresas
 * @param {string} [p.empresaInicial]  empresa que sale elegida
 * @param {boolean} [p.empresaFija]    no se puede cambiar
 * @param {{id: string, imei?: string, modelo?: string}|null} [p.equipoFijo]  GPS ya decidido
 * @param {boolean} [p.ofrecerGps]     ofrece los GPS libres (si no hay `equipoFijo`)
 * @param {{tecnico?: string, ubicacion?: string, notas?: string}} [p.datosInstalacion]
 * @param {string|null} [p.propia]     empresa propia del administrador
 * @param {string} [p.nombrePropia]
 * @param {(r: {vehiculoId: string, alias: string, empresaId: string, empresaNombre: string, instalado: boolean}) => void} p.alListo
 *   Todo salió bien (la unidad y, si lo había, el GPS).
 * @param {(r: {vehiculoId: string, alias: string, empresaId: string}) => void} [p.alCerrarConUnidad]
 *   Se cerró con la unidad ya creada pero sin su GPS: quien llama recarga su lista.
 * @param {() => void} p.alCerrar
 */
export default function NuevaUnidadEmpresa({
  abierto, empresas = [], empresaInicial = '', empresaFija = false, equipoFijo = null, ofrecerGps = false,
  datosInstalacion = {}, propia = null, nombrePropia = 'tu empresa', alListo, alCerrarConUnidad, alCerrar,
}) {
  const { confirmar, dialogo } = useConfirmar()
  const [empresaId, setEmpresaId] = useState(empresaInicial)
  const [datos, setDatos] = useState(UNIDAD_VACIA)
  const [gpsId, setGpsId] = useState('')
  const [libres, setLibres] = useState(null)
  const [errorGps, setErrorGps] = useState('')
  const [intentoGps, setIntentoGps] = useState(0)
  const [altaIncierta, setAltaIncierta] = useState(false)
  const enviando = useRef(false)
  const [errores, setErrores] = useState({})
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  // La unidad ya creada en el servidor: reintentar solo instala el GPS.
  const [creada, setCreada] = useState(null)

  // Al abrir se parte de cero (y con la empresa pedida).
  useEffect(() => {
    if (!abierto) return
    setEmpresaId(empresaInicial || '')
    setDatos(UNIDAD_VACIA)
    setGpsId('')
    setErrores({})
    setError('')
    setCreada(null)
    setAltaIncierta(false)
    setGuardando(false)
  }, [abierto, empresaInicial])

  // Los GPS libres del inventario (T-214), sin filtrar por empresa: el inventario es global.
  useEffect(() => {
    if (!abierto || !ofrecerGps || equipoFijo) return
    let vivo = true
    setLibres(null)
    setErrorGps('')
    repo.admin.gps.disponibles({ global: true })
      .then((l) => { if (vivo) setLibres(l) })
      .catch(() => { if (vivo) setErrorGps('No se pudo consultar el inventario GPS. Reintenta la lectura o crea la unidad sin GPS.') })
    return () => { vivo = false }
  }, [abierto, ofrecerGps, equipoFijo, intentoGps])

  const campo = (clave) => ({
    value: datos[clave],
    disabled: Boolean(creada) || guardando,
    onChange: (e) => { setDatos((d) => ({ ...d, [clave]: e.target.value })); setErrores((x) => ({ ...x, [clave]: undefined })) },
  })
  const empresa = empresas.find((e) => e.id === empresaId)
  const gpsElegido = equipoFijo?.id || gpsId || ''
  const etiquetaGuardar = guardando
    ? (creada ? 'Instalando…' : gpsElegido ? 'Creando e instalando…' : 'Creando…')
    : creada ? 'Instalar el GPS' : gpsElegido ? 'Crear e instalar' : 'Crear unidad'

  const cerrar = () => {
    if (guardando) return
    // Quedó creada sin su GPS: quien llama la necesita en su lista.
    if (creada && alCerrarConUnidad) alCerrarConUnidad({ vehiculoId: creada.id, alias: creada.alias, empresaId })
    alCerrar()
  }

  const guardar = async () => {
    if (enviando.current || altaIncierta) return
    setError('')
    if (!creada) {
      if (!empresa) { setError('Elige la empresa de la unidad.'); return }
      const faltas = validarUnidad(datos)
      if (Object.keys(faltas).length) { setErrores(faltas); setError('Revisa los datos marcados.'); return }
    }
    enviando.current = true
    setGuardando(true)
    if (!await confirmar({ titulo: creada ? 'Instalar GPS' : 'Crear vehículo', texto: `${creada ? '¿Instalar el GPS en la unidad creada' : '¿Crear el vehículo en la empresa seleccionada'}${gpsElegido && !creada ? ' e instalar el GPS seleccionado' : ''}?`, accion: creada ? 'Instalar GPS' : 'Crear vehículo' })) { enviando.current = false; setGuardando(false); return }
    let unidad = creada
    try {
      if (!unidad) {
        const r = await crearUnidadEnEmpresa({ empresaId, propia, datos })
        unidad = { id: r.id, alias: r.alias }
        setCreada(unidad)
      }
    } catch (e) {
      setError(e.message)
      setAltaIncierta(Boolean(e.altaIncierta))
      enviando.current = false
      setGuardando(false)
      return
    }
    if (gpsElegido) {
      try {
        await repo.admin.gps.instalar(gpsElegido, {
          vehiculoId: unidad.id,
          // La propia viaja por la ruta propia (null); otra empresa, por la suya.
          empresaId: propia ? empresaDeInstalacion(empresaId, propia) : empresaId,
          nombrePropia,
          tecnico: datosInstalacion.tecnico,
          ubicacion: datosInstalacion.ubicacion,
          notas: datosInstalacion.notas,
        })
      } catch (e) {
        setError(`La unidad «${unidad.alias}» ya quedó creada en ${empresa?.nombre ?? 'la empresa'}, pero el GPS no se instaló. ${e.message} No vuelvas a crearla: pulsa «Instalar el GPS» para reintentar.`)
        enviando.current = false
        setGuardando(false)
        return
      }
    }
    setGuardando(false)
    enviando.current = false
    alListo({ vehiculoId: unidad.id, alias: unidad.alias, empresaId, empresaNombre: empresa?.nombre ?? '', instalado: Boolean(gpsElegido) })
  }

  return (
    <><Modal titulo={equipoFijo ? 'Crear unidad e instalar el GPS' : 'Nueva unidad'} abierto={abierto} alCerrar={cerrar} ancho={560}>
      <div className="nue">
        {errorGps && <p role="alert">{errorGps} <button type="button" className="pnl-btn" disabled={guardando} onClick={() => setIntentoGps(n => n + 1)}>Reintentar inventario</button></p>}
        {creada && (
          <p className="nue-hecho" role="status">
            <Icono nombre="check" tam={16} />La unidad «{creada.alias}» ya está creada en {empresa?.nombre ?? 'la empresa'}.
          </p>
        )}

        <Campo etiqueta="Empresa" error={errores.empresa}>
          <select className="pnl-input" value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} disabled={empresaFija || Boolean(creada) || guardando}>
            {!empresaId && <option value="">Elige la empresa…</option>}
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </Campo>
        <p className="nue-nota">La unidad se crea en esa empresa sin entrar a ella.</p>

        <div className="nue-par">
          <Campo etiqueta="Número o código" error={errores.numero}>
            <input className="pnl-input" placeholder="Unidad 27" maxLength={LIMITES_UNIDAD.numero} autoComplete="off" {...campo('numero')} />
          </Campo>
          <Campo etiqueta="Placa" error={errores.placa}>
            <input className="pnl-input" placeholder="A12BC3D" maxLength={LIMITES_UNIDAD.placa} autoComplete="off" {...campo('placa')} />
          </Campo>
          <Campo etiqueta="Marca" error={errores.marca}>
            <input className="pnl-input" placeholder="Toyota" maxLength={LIMITES_UNIDAD.marca} autoComplete="off" {...campo('marca')} />
          </Campo>
          <Campo etiqueta="Modelo" error={errores.modelo}>
            <input className="pnl-input" placeholder="Hilux" maxLength={LIMITES_UNIDAD.modelo} autoComplete="off" {...campo('modelo')} />
          </Campo>
        </div>

        <details className="nue-mas">
          <summary>Más datos (opcional)</summary>
          <div className="nue-par">
            <Campo etiqueta="Año" error={errores.anio}>
              <input className="pnl-input" type="number" inputMode="numeric" placeholder="2026" {...campo('anio')} />
            </Campo>
            <Campo etiqueta="Tipo">
              <select className="pnl-input" {...campo('tipo')}>
                {TIPOS_UNIDAD.map((t) => <option key={t.v} value={t.v}>{t.t}</option>)}
              </select>
            </Campo>
          </div>
        </details>

        {equipoFijo ? (
          <p className="nue-gps">
            <Icono nombre="pin" tam={16} />
            <span>Se instalará el GPS {equipoFijo.modelo ? `${equipoFijo.modelo} · ` : ''}<b>{equipoFijo.imei}</b>.</span>
          </p>
        ) : ofrecerGps && (
          <Campo
            etiqueta="GPS libre (opcional)"
            ayuda={libres && libres.length === 0 ? 'No hay equipos libres en el inventario: puedes crear la unidad y instalarlo después.' : 'Si eliges uno, queda instalado al crear la unidad.'}>
            <select className="pnl-input" value={gpsId} onChange={(e) => setGpsId(e.target.value)} disabled={libres === null || guardando}>
              <option value="">{errorGps ? 'Inventario no disponible' : libres === null ? 'Buscando equipos libres…' : 'Sin GPS por ahora'}</option>
              {(libres ?? []).map((g) => <option key={g.id} value={g.id}>{g.modelo} · {g.imei}</option>)}
            </select>
          </Campo>
        )}

        {error && <p className="pnl-campo-error nue-error" role="alert">{error}</p>}

        <div className="nue-acciones">
          <button type="button" className="pnl-btn" onClick={cerrar} disabled={guardando}>{creada ? 'Cerrar sin instalar' : 'Cancelar'}</button>
          <button type="button" className="pnl-btn primario" onClick={guardar} disabled={guardando || altaIncierta}>
            <Icono nombre="check" tam={16} />{etiquetaGuardar}
          </button>
        </div>
      </div>
    </Modal>{dialogo}</>
  )
}
