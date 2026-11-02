import { useRef, useState } from 'react'
import { pedir } from '../datos/api'
import { MeitrackInstallationSetup } from '../meitrack/MeitrackInstallationSetup'
import { registerInventory, sha256 } from '../meitrack/registration'
import { useLocation, useNavigate } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { Cabeza, Detectado, IcoGps, Pastilla, RAIZ_GPS, useAhora } from '../comp/GpsPiezas'
import { ComandosSms, PruebaSenal } from './AdminGpsProbar'
import { cambiosGps } from '../datos/metadatosGps'
import {
  CATALOGO_GPS, ESTADOS_SIM, haceCuanto, validarEquipo, validarIccid, validarImei, validarLinea,
} from '../datos/gps'
import './admin-gps.css'

// ============================================================
// NUEVO GPS EN 3 PASOS (T-95, tableros GW2 y GW3)
//   1 · Equipo: marca y modelo (eligen el protocolo), IMEI, serie, firmware,
//       TCP/UDP y la clave SMS (solo en memoria: arma los comandos).
//   2 · Línea SIM: teléfono, ICCID, operador, APN, estado y plan.
//   3 · Configurar y probar: al entrar se registra el equipo
//       (POST gps-devices) y se muestran los comandos y la prueba de señal.
// Registrar e instalar son pasos aparte: el equipo puede esperar en la gaveta.
// ============================================================

const OPERADORES = [
  ['Movistar', 'internet.movistar.ve'],
  ['Digitel', 'gprsweb.digitel.ve'],
  ['Movilnet', 'int.movilnet.com.ve'],
]

const PASOS = ['Equipo', 'Línea SIM', 'Configurar y probar']

const INICIAL = {
  marca: 'Coban', modelo: 'GPS-403', transporte: 'tcp', imei: '', serie: '', firmware: '',
  telefono: '', iccid: '', operador: '', apn: '', estadoSim: 'active', plan: '',
}

export default function AdminGpsNuevo() {
  const navegar = useNavigate()
  const { state } = useLocation()
  const sesion = useSesion()
  const ahora = useAhora()
  const [paso, setPaso] = useState(1)
  const [datos, setDatos] = useState(() => ({ ...INICIAL, imei: state?.imei ?? '' }))
  // De qué detectado salió el IMEI (para la pastilla «Tomado de la señal»).
  const [imeiDeSenal, setImeiDeSenal] = useState(state?.imei ?? null)
  const [clave, setClave] = useState('')
  const [errores, setErrores] = useState({})
  const [equipo, setEquipo] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [errorAlta, setErrorAlta] = useState('')
  const [meitrackReceived, setMeitrackReceived] = useState(false)
  const inFlight = useRef(false)
  const detectados = useDatos(() => repo.admin.gps.sinEmparejar(), [], 30_000)

  const modelo = CATALOGO_GPS[datos.marca]?.[datos.modelo] ?? null
  const meitrack = datos.marca === 'Meitrack' && datos.modelo === 'T399L'
  const poner = (campo, valor) => {
    setDatos((d) => ({ ...d, [campo]: valor }))
    setErrores((e) => ({ ...e, [campo]: undefined }))
    if (campo === 'imei' && valor !== imeiDeSenal) setImeiDeSenal(null)
  }
  const usarImei = (d) => {
    if (equipo) return
    setDatos((x) => ({ ...x, imei: d.imei, transporte: d.transporte === 'udp' ? 'udp' : 'tcp' }))
    setImeiDeSenal(d.imei)
    setErrores((e) => ({ ...e, imei: undefined }))
  }

  const siguiente1 = () => {
    const e = validarEquipo(datos)
    if (meitrack && (datos.firmware.trim() !== 'T399L-V254' || datos.transporte !== 'tcp')) e.firmware = 'Esta preparación requiere firmware observado T399L-V254 y transporte TCP.'
    setErrores(e)
    if (Object.keys(e).length === 0) setPaso(2)
  }

  // Lo que se manda al servidor: los mismos nombres de campo que «Editar» (metadatosGps).
  const metadatos = () => ({
    simPhone: datos.telefono.trim(),
    iccid: validarIccid(datos.iccid).valor,
    carrier: datos.operador.trim(),
    apn: datos.apn.trim(),
    simStatus: datos.estadoSim,
    simPlan: datos.plan.trim(),
    firmwareVersion: datos.firmware.trim(),
    transport: datos.transporte,
  })

  const siguiente2 = async () => {
    const e = validarLinea(datos)
    setErrores(e)
    if (Object.keys(e).length > 0) return
    if (meitrack) { setPaso(3); return }
    setGuardando(true)
    setErrorAlta('')
    try {
      if (!equipo) {
        const r = await repo.admin.gps.registrar({
          imei: validarImei(datos.imei).valor,
          modelo: datos.modelo,
          fabricante: datos.marca,
          protocolo: modelo?.protocolo,
          serie: datos.serie.trim() || undefined,
          ...metadatos(),
        }, sesion?.perfil)
        if (!r?.id) throw new Error('El servidor no devolvió el equipo registrado. Búscalo en el inventario antes de volver a intentarlo.')
        setEquipo({ id: r.id, ...metadatos() })
      } else {
        // Volvió atrás y cambió la línea: solo se manda lo que cambió. El IMEI ya no se corrige.
        const cambios = cambiosGps(metadatos(), equipo)
        if (Object.keys(cambios).length > 0) {
          await repo.admin.gps.set(equipo.id, { serie: datos.serie.trim() || undefined, metadatos: cambios })
          setEquipo((x) => ({ ...x, ...metadatos() }))
        }
      }
      setPaso(3)
    } catch (err) {
      setErrorAlta(err.message)
    } finally {
      setGuardando(false)
    }
  }

  const registrarMeitrack = async () => {
    if (inFlight.current || equipo || !meitrackReceived) return
    inFlight.current = true
    setGuardando(true)
    setErrorAlta('')
    try {
      const payload = { imei: validarImei(datos.imei).valor, model: datos.modelo, manufacturer: datos.marca,
        protocolFamily: 'meitrack-t399', ...metadatos(),
        ...(datos.serie.trim() ? { serialNumber: datos.serie.trim() } : {}) }
      if (!navigator.locks?.request) throw Error('Este navegador no permite proteger el intento entre pestañas. Use un navegador compatible; el alta permanece bloqueada.')
      const unitHash = await sha256(payload.imei)
      const id = await navigator.locks.request(`fom-727-registration:${unitHash}`, () => registerInventory(payload, { storage: localStorage, digest: sha256,
        request: (path, cuerpo) => pedir(`/api/v1/console/meitrack-setup/${path}`, { metodo: 'POST', cuerpo, empresaContexto: null }) }))
      setEquipo({ id, ...metadatos() })
    } catch (err) { setErrorAlta(err.message) }
    finally { inFlight.current = false; setGuardando(false) }
  }

  const salir = () => navegar(equipo ? `${RAIZ_GPS}/${equipo.id}` : RAIZ_GPS)
  const bajada = paso === 3
    ? meitrack ? 'Conserva la recuperación, configura por SMS y comprueba la recepción antes del alta. No activa el GPS.' : 'Envía los comandos por SMS a la línea del equipo y espera su primera señal.'
    : 'Registra el equipo en el inventario. Instalarlo en una unidad es un paso aparte.'

  // La vista del equipo para los comandos y la prueba: lo escrito aquí, con el id del registro.
  const equipoVista = equipo && {
    ...equipo,
    imei: validarImei(datos.imei).valor,
    modelo: datos.modelo,
    fabricante: datos.marca,
    linea: datos.telefono.trim(),
    vehiculoId: null,
  }

  return (
    <div className="gp">
      <Cabeza
        ruta={[['Administración FOM'], ['Inventario GPS', RAIZ_GPS], ['Nuevo GPS']]}
        titulo="Nuevo GPS"
        bajada={bajada}
        acciones={<button type="button" className="gp-btn2" onClick={salir}>{equipo ? 'Ir al equipo' : 'Descartar'}</button>}
      />

      <ol className="gp-steps gp-card" aria-label="Pasos del alta">
        {PASOS.map((t, i) => {
          const n = i + 1
          const clase = n === paso ? 'on' : n < paso ? 'done' : ''
          return [
            i > 0 && <li key={`l${n}`} className={`gp-sline${n <= paso ? ' done' : ''}`} aria-hidden="true" />,
            <li key={n} className={`gp-stp ${clase}`} aria-current={n === paso ? 'step' : undefined}>
              <b>{n < paso ? <IcoGps nombre="check" /> : n}</b><span>{t}</span>
            </li>,
          ]
        })}
      </ol>

      {paso === 1 && (
        <div className="gp-grid l360">
          <section className="gp-card" style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '22px 24px' }} aria-labelledby="gp-p1">
            <div className="gp-titulo">
              <p className="gp-k">Paso 1 de 3</p>
              <h2 className="gp-st" id="gp-p1">Datos del equipo</h2>
              <span className="gp-lbl">La marca y el modelo eligen el protocolo. El IMEI no se corrige después.</span>
            </div>
            <div className="gp-campos">
              <Campo id="n-marca" etiqueta="Marca *" error={errores.marca}>
                <div className="gp-field">
                  <select id="n-marca" value={datos.marca} onChange={(e) => { poner('marca', e.target.value); poner('modelo', Object.keys(CATALOGO_GPS[e.target.value] ?? {})[0] ?? '') }}>
                    {Object.keys(CATALOGO_GPS).map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <IcoGps nombre="abajo" />
                </div>
              </Campo>
              <Campo id="n-modelo" etiqueta="Modelo *" error={errores.modelo}>
                <div className="gp-field">
                  <select id="n-modelo" value={datos.modelo} onChange={(e) => poner('modelo', e.target.value)}>
                    {Object.keys(CATALOGO_GPS[datos.marca] ?? {}).map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <IcoGps nombre="abajo" />
                </div>
              </Campo>
              <Campo id="n-proto" etiqueta="Protocolo" ayuda="Se pone solo según el modelo.">
                <div className="gp-field ro"><input id="n-proto" value={modelo?.protocoloNombre ?? '—'} readOnly /></div>
              </Campo>
              <div className="gp-f">
                <span className="gp-fl" id="n-tr">Transporte</span>
                <div className="gp-chips" role="group" aria-labelledby="n-tr">
                  {['tcp', 'udp'].map((t) => (
                    <button key={t} type="button" className="gp-chip alto" aria-pressed={datos.transporte === t} onClick={() => poner('transporte', t)}>{t.toUpperCase()}</button>
                  ))}
                </div>
                <span className="gp-hint">{meitrack ? 'Esta preparación admite TCP; no acredita el estado de fábrica del equipo.' : `${(modelo?.transporte ?? 'tcp').toUpperCase()} es el de fábrica del ${datos.modelo}.`}</span>
              </div>
              <Campo id="n-imei" etiqueta="IMEI *" todo error={errores.imei} ayuda={equipo ? 'Ya registrado: el IMEI no se corrige.' : '15 dígitos, único en FOM. Si no lo tienes, elige uno de «Detectados sin registrar».'}>
                <div className={`gp-field${errores.imei ? ' mal' : imeiDeSenal ? ' ok' : ''}${equipo ? ' ro' : ''}`}>
                  <input id="n-imei" className="gp-mono" inputMode="numeric" autoComplete="off" maxLength={20} value={datos.imei} readOnly={Boolean(equipo)} onChange={(e) => poner('imei', e.target.value)} aria-invalid={Boolean(errores.imei)} />
                  {imeiDeSenal && <TomadoDeLaSenal d={(detectados.datos ?? []).find((x) => x.imei === imeiDeSenal)} ahora={ahora} />}
                </div>
              </Campo>
              <Campo id="n-serie" etiqueta="Número de serie" error={errores.serie}>
                <div className="gp-field"><input id="n-serie" placeholder="Opcional" maxLength={100} value={datos.serie} onChange={(e) => poner('serie', e.target.value)} /></div>
              </Campo>
              <Campo id="n-fw" etiqueta="Firmware" error={errores.firmware}>
                <div className="gp-field"><input id="n-fw" placeholder="Opcional" maxLength={100} value={datos.firmware} onChange={(e) => poner('firmware', e.target.value)} /></div>
              </Campo>
              <Campo id="n-clave" etiqueta="Clave SMS del equipo" todo ayuda="Solo arma los comandos del paso 3. No se guarda ni se envía al servidor.">
                <div className="gp-field"><input id="n-clave" type="password" autoComplete="new-password" placeholder={meitrack ? 'Contraseña actual de cuatro dígitos' : 'De fábrica: 123456'} value={clave} onChange={(e) => setClave(e.target.value)} /></div>
              </Campo>
            </div>
            <div className="gp-pie">
              <button type="button" className="gp-btn" onClick={siguiente1}>Siguiente: Línea SIM<IcoGps nombre="siguiente" /></button>
            </div>
          </section>

          <section className="gp-card gp-col" aria-labelledby="det-t">
            <div className="gp-titulo">
              <h2 className="gp-st" id="det-t">Detectados sin registrar</h2>
              <span className="gp-hint">Elige el equipo que ya envía datos. Lo que mandó se guarda tal cual.</span>
            </div>
            {detectados.estado === 'error' && <span className="gp-hint">{detectados.error?.message}</span>}
            {detectados.estado === 'ok' && (detectados.datos ?? []).length === 0 && <span className="gp-hint">Ahora mismo no llega ningún IMEI sin registrar.</span>}
            {(detectados.datos ?? []).map((d) => (
              <Detectado key={d.imei} d={d} ahora={ahora} elegido={d.imei === datos.imei} detallado>
                {d.imei === datos.imei
                  ? <span className="en-uso"><IcoGps nombre="check" />En uso en este alta</span>
                  : <button type="button" className="gp-btn2 chico" disabled={Boolean(equipo)} onClick={() => usarImei(d)}>Usar este IMEI</button>}
              </Detectado>
            ))}
            <button type="button" className="gp-btn2 ancho" onClick={() => detectados.recargar()}><IcoGps nombre="sync" />Actualizar lista</button>
            <span className="gp-hint">¿No aparece? Configura el equipo hacia el receptor FOM y actualiza.</span>
          </section>
        </div>
      )}

      {paso === 2 && (
        <div className="gp-grid l360">
          <section className="gp-card" style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '22px 24px' }} aria-labelledby="gp-p2">
            <div className="gp-titulo">
              <p className="gp-k">Paso 2 de 3</p>
              <h2 className="gp-st" id="gp-p2">Línea SIM</h2>
              <span className="gp-lbl">La línea por la que el equipo manda sus datos y recibe los comandos.</span>
            </div>
            <div className="gp-campos">
              <Campo id="n-tel" etiqueta="Teléfono de la línea *" error={errores.telefono}>
                <div className={`gp-field${errores.telefono ? ' mal' : ''}`}><input id="n-tel" type="tel" placeholder="0414-5523187" maxLength={30} value={datos.telefono} onChange={(e) => poner('telefono', e.target.value)} /></div>
              </Campo>
              <Campo id="n-iccid" etiqueta="ICCID *" error={errores.iccid} ayuda="De 18 a 22 dígitos, impreso en la tarjeta.">
                <div className={`gp-field${errores.iccid ? ' mal' : ''}`}><input id="n-iccid" className="gp-mono" inputMode="numeric" autoComplete="off" maxLength={26} value={datos.iccid} onChange={(e) => poner('iccid', e.target.value)} /></div>
              </Campo>
              <Campo id="n-op" etiqueta="Operador *" error={errores.operador}>
                <div className={`gp-field${errores.operador ? ' mal' : ''}`}>
                  <input id="n-op" list="gp-operadores" maxLength={80} value={datos.operador} onChange={(e) => {
                    const v = e.target.value
                    poner('operador', v)
                    // El APN del operador conocido se sugiere si el campo está vacío.
                    const apn = OPERADORES.find(([o]) => o.toLowerCase() === v.trim().toLowerCase())?.[1]
                    if (apn && !datos.apn.trim()) poner('apn', apn)
                  }} />
                  <datalist id="gp-operadores">{OPERADORES.map(([o]) => <option key={o} value={o} />)}</datalist>
                </div>
              </Campo>
              <Campo id="n-apn" etiqueta="APN *" error={errores.apn} ayuda="Lo da el operador para los datos móviles.">
                <div className={`gp-field${errores.apn ? ' mal' : ''}`}><input id="n-apn" autoComplete="off" maxLength={120} value={datos.apn} onChange={(e) => poner('apn', e.target.value)} /></div>
              </Campo>
              <Campo id="n-est" etiqueta="Estado de la SIM" error={errores.estadoSim}>
                <div className="gp-field">
                  <select id="n-est" value={datos.estadoSim} onChange={(e) => poner('estadoSim', e.target.value)}>
                    {ESTADOS_SIM.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                  <IcoGps nombre="abajo" />
                </div>
              </Campo>
              <Campo id="n-plan" etiqueta="Plan" error={errores.plan}>
                <div className="gp-field"><input id="n-plan" placeholder="Opcional" maxLength={120} value={datos.plan} onChange={(e) => poner('plan', e.target.value)} /></div>
              </Campo>
            </div>
            {errorAlta && <div className="gp-aviso error" role="alert">{errorAlta}</div>}
            <div className="gp-pie entre">
              <button type="button" className="gp-btn2" onClick={() => setPaso(1)} disabled={guardando}><IcoGps nombre="anterior" />Anterior</button>
              <button type="button" className="gp-btn" onClick={siguiente2} disabled={guardando}>
                {guardando ? 'Registrando…' : meitrack || equipo ? 'Siguiente: Configurar y probar' : 'Registrar y configurar'}<IcoGps nombre="siguiente" />
              </button>
            </div>
          </section>

          <section className="gp-card gp-col" aria-labelledby="gp-res">
            <p className="gp-k">Equipo</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="gp-ibox"><IcoGps nombre="gps" /></span>
              <div className="gp-titulo">
                <b id="gp-res" style={{ fontSize: 15, fontWeight: 600 }}>{datos.marca} {datos.modelo}</b>
                <span className="gp-hint gp-mono">IMEI {validarImei(datos.imei).valor}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Pastilla tono="info">{modelo?.protocoloNombre}</Pastilla>
              <Pastilla tono="info">{datos.transporte.toUpperCase()}</Pastilla>
              {equipo && <Pastilla tono="ok">Registrado</Pastilla>}
            </div>
              <span className="gp-hint">{meitrack ? 'Al seguir, preparas la configuración. El alta espera la recepción comprobada y no activa el GPS.' : 'Al seguir, el equipo queda registrado en el inventario y pasas a configurarlo y probarlo.'}</span>
          </section>
        </div>
      )}

      {paso === 3 && meitrack && (
        <>
          <MeitrackInstallationSetup key={JSON.stringify([datos.imei, datos.firmware, datos.apn])}
            password={clave} imei={validarImei(datos.imei).valor} firmware={datos.firmware.trim()} apn={datos.apn.trim()}
            onReady={() => {}} onCapture={setMeitrackReceived} onPasswordChange={setClave} />
          {errorAlta && <p className="gp-aviso error" role="alert">{errorAlta}</p>}
          {equipo ? <p className="gp-aviso" role="status">Registro comprobado en inventario. La instalación, el reloj y las funciones siguen pendientes; el GPS no está activado.</p>
            : <button type="button" className="gp-btn" disabled={guardando || !meitrackReceived} onClick={registrarMeitrack}>{guardando ? 'Comprobando registro…' : 'Registrar sin activar'}</button>}
        </>
      )}
      {paso === 3 && !meitrack && equipoVista && (
        <>
          <div className="gp-aviso" role="status"><IcoGps nombre="check" />Equipo registrado en el inventario. Ya puedes configurarlo y probarlo.</div>
          <div className="gp-grid l400">
            <ComandosSms equipo={equipoVista} clave={clave} />
            <PruebaSenal equipo={equipoVista} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="gp-btn2" onClick={() => setPaso(2)}><IcoGps nombre="anterior" />Anterior</button>
          </div>
        </>
      )}
    </div>
  )
}

function TomadoDeLaSenal({ d, ahora }) {
  return <Pastilla tono="ok" punto>{d?.ultimaVez ? `Tomado de la señal · ${haceCuanto(d.ultimaVez, ahora)}` : 'Tomado de la señal'}</Pastilla>
}

/** Campo con su etiqueta, ayuda y error, en el formato del diseño. */
function Campo({ id, etiqueta, ayuda, error, todo = false, children }) {
  return (
    <div className={`gp-f${todo ? ' todo' : ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {error ? <span className="gp-error" role="alert">{error}</span> : ayuda && <span className="gp-hint">{ayuda}</span>}
    </div>
  )
}
