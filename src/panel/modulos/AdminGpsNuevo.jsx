import { useRef, useState } from 'react'
import { useConfirmar } from '../comp/Confirmar'
import { pedir } from '../datos/api'
import { MeitrackInstallationSetup } from '../meitrack/MeitrackInstallationSetup'
import { registerInventory, sha256 } from '../meitrack/registration'
import { useLocation, useNavigate } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { useSesion } from '../useSesion'
import { Cabeza, Detectado, IcoGps, Pastilla, RAIZ_GPS, useAhora } from '../comp/GpsPiezas'
import { ComandosSms, PruebaSenal } from './AdminGpsProbar'
import { validarPreparacion, identidadConfirmada, coincideDetectado, testigoInventarioCoban } from '../datos/gps-discovery'
import {
  CATALOGO_GPS, ESTADOS_SIM, haceCuanto, validarIccid, validarImei, validarLinea,
} from '../datos/gps'
import './admin-gps.css'

// ============================================================
// NUEVO GPS: preparar equipo y SIM sin crear inventario; configurar por SMS,
// comparar la identidad con la recepción y registrar al final, sin activar.
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
  const { confirmar, dialogo } = useConfirmar()
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
  const [imeiSms, setImeiSms] = useState('')
  const [seleccionado, setSeleccionado] = useState(null)
  const [guideLocked, setGuideLocked] = useState(false)
  const inFlight = useRef(false)
  const detectados = useDatos(() => repo.admin.gps.sinEmparejar(), [], 30_000)

  const modelo = CATALOGO_GPS[datos.marca]?.[datos.modelo] ?? null
  const meitrack = datos.marca === 'Meitrack' && datos.modelo === 'T399L'
  const identidad = identidadConfirmada(datos.imei, imeiSms)
  const imeiPreparacion = identidad ?? (!validarImei(datos.imei).error ? validarImei(datos.imei).valor : '')
  const seleccionadoCoban = !meitrack && detectados.estado === 'ok' && (detectados.datos ?? []).find(d => d.imei === seleccionado && coincideDetectado(d, { inicial: datos.imei, sms: imeiSms, transporte: datos.transporte, ahora }))
  const puedeRegistrar = !!identidad && (meitrack ? meitrackReceived && seleccionado === identidad : !!seleccionadoCoban)
  const poner = (campo, valor) => {
    setSeleccionado(null)
    setMeitrackReceived(false)
    setDatos((d) => ({ ...d, [campo]: valor }))
    setErrores((e) => ({ ...e, [campo]: undefined }))
    if (campo === 'imei' && valor !== imeiDeSenal) setImeiDeSenal(null)
  }
  const usarImei = (d) => {
    if (equipo || !coincideDetectado(d, { inicial: datos.imei, sms: imeiSms, transporte: datos.transporte, ahora })) return
    setSeleccionado(d.imei)
    setErrores((e) => ({ ...e, imei: undefined }))
  }

  const siguiente1 = () => {
    const e = validarPreparacion(datos)
    if (meitrack && !/^[0-9]{4}$/.test(clave)) e.clave = 'Introduce la clave SMS actual de cuatro dígitos.'
    if (meitrack && (datos.firmware.trim() && datos.firmware.trim() !== 'T399L-V254' || datos.transporte !== 'tcp')) e.firmware = 'La conexión controlada requiere firmware observado T399L-V254 y transporte TCP; puedes consultar la versión durante la preparación.'
    setErrores(e)
    if (Object.keys(e).length === 0) setPaso(2)
  }

  // Lo que se manda al servidor: los mismos nombres de campo que «Editar» (metadatosGps).
  const metadatos = () => ({
    simPhone: datos.telefono.trim(),
    ...(validarIccid(datos.iccid).valor ? { iccid: validarIccid(datos.iccid).valor } : {}),
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
    setPaso(3)
  }

  const registrarCoban = async () => {
    if (inFlight.current || equipo || !puedeRegistrar || meitrack) return
    inFlight.current = true
    setGuardando(true)
    setErrorAlta('')
    try {
      if (!navigator.locks?.request) throw Error('Use un navegador compatible con la protección de intentos entre pestañas.')
      const payload = { imei: identidad, model: datos.modelo, manufacturer: datos.marca,
        protocolFamily: modelo?.protocolo, ...metadatos(), ...(datos.serie.trim() ? { serialNumber: datos.serie.trim() } : {}) }
      const unitHash = await sha256(identidad)
      const id = await navigator.locks.request(`fom-727-registration:${unitHash}`, () => registerInventory(payload, {
        storage: localStorage, digest: sha256,
        request: async path => {
          if (path === 'registration') return testigoInventarioCoban(await repo.admin.gps.listar(), payload)
          const fresh = await repo.admin.gps.sinEmparejar()
          if (!fresh.some(d => coincideDetectado(d, { inicial: datos.imei, sms: imeiSms, transporte: datos.transporte }))) throw Error('La señal coincidente ya no está disponible. Actualiza la lista.')
          return repo.admin.gps.registrar({ imei: identidad, modelo: datos.modelo, fabricante: datos.marca,
            protocolo: modelo?.protocolo, serie: datos.serie.trim() || undefined, ...metadatos() }, sesion?.perfil)
        },
      }))
      setEquipo({ id, ...metadatos() })
    } catch (err) {
      setErrorAlta(err.message)
    } finally {
      inFlight.current = false
      setGuardando(false)
    }
  }

  const registrarMeitrack = async () => {
    if (inFlight.current || equipo || !puedeRegistrar || !meitrack) return
    inFlight.current = true
    setGuardando(true)
    setErrorAlta('')
    try {
      const payload = { imei: identidad, model: datos.modelo, manufacturer: datos.marca,
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

  const salir = async () => {
    const seguro = !guideLocked || equipo || await confirmar({
      titulo: '¿Salir de la preparación?',
      texto: 'Descartar cierra esta preparación. No deshace los SMS que ya enviaste al GPS.',
      accion: 'Salir',
      peligro: true,
    })
    if (seguro) navegar(equipo ? `${RAIZ_GPS}/${equipo.id}` : RAIZ_GPS)
  }
  const bajada = paso === 3
    ? meitrack ? 'Configura por SMS y busca la señal coincidente al final para registrar sin activar.' : 'Envía los comandos por SMS a la línea del equipo y espera su primera señal.'
    : 'Prepara el equipo y su línea, configura por SMS y confirma la identidad recibida antes de registrarlo.'

  // La vista del equipo para los comandos y la prueba: lo escrito aquí, con el id del registro.
  const equipoVista = {
    ...equipo,
    imei: identidad ?? imeiPreparacion,
    transport: datos.transporte,
    apn: datos.apn.trim(),
    carrier: datos.operador.trim(),
    modelo: datos.modelo,
    fabricante: datos.marca,
    linea: datos.telefono.trim(),
    vehiculoId: null,
  }


  return (
    <div className="gp">
      <Cabeza
        ruta={[['Hardware y telemetría'], ['Equipos GPS', RAIZ_GPS], ['Nuevo GPS']]}
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
              <span className="gp-lbl">Elige marca y modelo. Si aún no conoces el IMEI, podrás consultarlo por SMS y compararlo con la señal al final.</span>
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
              <Campo id="n-imei" etiqueta="IMEI conocido (opcional)" todo error={errores.imei} ayuda={equipo ? 'Ya registrado: el IMEI no se corrige.' : 'Déjalo vacío si no lo conoces. El registro esperará la coincidencia entre el SMS y la señal recibida.'}>
                <div className={`gp-field${errores.imei ? ' mal' : imeiDeSenal ? ' ok' : ''}${equipo ? ' ro' : ''}`}>
                  <input id="n-imei" className="gp-mono" inputMode="numeric" autoComplete="off" maxLength={20} value={datos.imei} readOnly={Boolean(equipo)} onChange={(e) => poner('imei', e.target.value)} aria-invalid={Boolean(errores.imei)} />
                  {imeiDeSenal && <TomadoDeLaSenal d={(detectados.datos ?? []).find((x) => x.imei === imeiDeSenal)} ahora={ahora} />}
                </div>
              </Campo>
              <Campo id="n-serie" etiqueta="Número de serie" error={errores.serie}>
                <div className="gp-field"><input id="n-serie" placeholder="Opcional" maxLength={100} value={datos.serie} onChange={(e) => poner('serie', e.target.value)} /></div>
              </Campo>
              {!meitrack && <Campo id="n-fw" etiqueta="Firmware" error={errores.firmware}>
                <div className="gp-field"><input id="n-fw" placeholder="Opcional" maxLength={100} value={datos.firmware} onChange={(e) => poner('firmware', e.target.value)} /></div>
              </Campo>}
              <Campo id="n-clave" etiqueta="Clave SMS del equipo" error={errores.clave} todo ayuda="Solo arma los comandos del paso 3. No se guarda ni se envía al servidor.">
                <div className="gp-field"><input id="n-clave" type="password" autoComplete="new-password" placeholder={meitrack ? 'Contraseña actual de cuatro dígitos' : 'De fábrica: 123456'} value={clave} onChange={(e) => setClave(e.target.value)} /></div>
              </Campo>
            </div>
            <div className="gp-pie">
              <button type="button" className="gp-btn" onClick={siguiente1}>Siguiente: Línea SIM<IcoGps nombre="siguiente" /></button>
            </div>
          </section>

          <section className="gp-card gp-col">
            <h2 className="gp-st">Primero configura, después identifica</h2>
            <p>En el último paso tendrás los comandos SMS y los dispositivos detectados sin registrar. Compara el IMEI que responda tu GPS, selecciona su señal y registra el equipo.</p>
            <p>No se crea ningún registro al avanzar por estas pantallas.</p>
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
              <Campo id="n-iccid" etiqueta="ICCID (opcional)" error={errores.iccid} ayuda="Puedes dejarlo en blanco. Si lo indicas, debe tener de 18 a 22 dígitos, impreso en la tarjeta.">
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
                Siguiente: Configurar y probar<IcoGps nombre="siguiente" />
              </button>
            </div>
          </section>

          <section className="gp-card gp-col" aria-labelledby="gp-res">
            <p className="gp-k">Equipo</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="gp-ibox"><IcoGps nombre="gps" /></span>
              <div className="gp-titulo">
                <b id="gp-res" style={{ fontSize: 15, fontWeight: 600 }}>{datos.marca} {datos.modelo}</b>
                <span className="gp-hint gp-mono">IMEI {validarImei(datos.imei).valor || 'pendiente de consultar por SMS'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Pastilla tono="info">{modelo?.protocoloNombre}</Pastilla>
              <Pastilla tono="info">{datos.transporte.toUpperCase()}</Pastilla>
              {equipo && <Pastilla tono="ok">Registrado</Pastilla>}
            </div>
              <span className="gp-hint">Al seguir, preparas la configuración. El registro espera la coincidencia de identidad y la recepción comprobada; no activa el GPS.</span>
          </section>
        </div>
      )}

      {paso === 3 && meitrack && <>
        <MeitrackInstallationSetup password={clave} imei={imeiPreparacion} firmware={datos.firmware.trim()} apn={datos.apn.trim()}
          knownImei={!validarImei(datos.imei).error ? validarImei(datos.imei).valor : ''} onCapture={setMeitrackReceived}
          onIdentityChange={value => { setImeiSms(value.imei); setDatos(d => ({ ...d, firmware: value.firmware, transporte:'tcp' })); setSeleccionado(null); setMeitrackReceived(false) }}
          onLockChange={setGuideLocked} onSelect={() => { if (identidad && meitrackReceived) setSeleccionado(identidad) }}
          selected={!!identidad && seleccionado === identidad} canRegister={puedeRegistrar} onRegister={registrarMeitrack}
          registered={!!equipo} registering={guardando} registrationError={errorAlta} />
        <button type="button" className="gp-btn2" disabled={guideLocked || !!equipo} onClick={() => setPaso(2)}>Anterior: Línea SIM</button>
      </>}
      {paso === 3 && !meitrack && (
        <section className="gp-card" aria-label="Identidad consultada por SMS">
          <h2 className="gp-st">Configura y confirma la identidad</h2>
          <p>Envía los comandos desde tu teléfono. La consulta de identidad no requiere conocer el IMEI de antemano. Compara la respuesta del mismo GPS con la señal recibida antes de registrar.</p>
          <Campo id="n-imei-sms" etiqueta="IMEI consultado por SMS" ayuda="Puede quedar pendiente mientras envías las consultas de abajo. Después introduce sólo sus 15 dígitos, sin contraseñas ni respuestas completas.">
            <div className="gp-field"><input id="n-imei-sms" inputMode="numeric" autoComplete="off" value={imeiSms} readOnly={!!equipo} onChange={e => { setImeiSms(e.target.value); setSeleccionado(null) }} /></div>
          </Campo>
          {imeiSms && !identidad && <p role="alert">El IMEI consultado no es válido o no coincide con el indicado al principio. No selecciones otro dispositivo para continuar.</p>}

        </section>
      )}
      {paso === 3 && !meitrack && (
        <>
          <div className="gp-aviso" role="status">{equipo ? 'Registro comprobado en inventario; instalar y activar son pasos separados.' : 'Preparación sin registro. Configura por SMS, consulta el IMEI y elige la señal coincidente al final.'}</div>
          <div className="gp-grid l400">
            <ComandosSms equipo={equipoVista} clave={clave} alCambiarClave={setClave} />
            {equipo && <PruebaSenal equipo={equipoVista} />}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="gp-btn2" disabled={!!equipo} onClick={() => setPaso(2)}><IcoGps nombre="anterior" />Anterior</button>
          </div>
        </>
      )}
      {paso === 3 && !meitrack && !equipo && (
        <section className="gp-card gp-col" aria-labelledby="det-final">
          <h2 className="gp-st" id="det-final">Detectados sin registrar · confirmar al final</h2>
          <p>Compara el IMEI de la respuesta SMS. Selecciona la identidad coincidente con recepción comprobada y el mismo transporte.</p>
          <>

            {detectados.estado === 'error' && <p role="alert">{detectados.error?.message}</p>}
            {(detectados.datos ?? []).length === 0 && <p>No hay dispositivos sin registrar detectados todavía. Envía los comandos y actualiza la lista.</p>}
            {(detectados.datos ?? []).map(d => <Detectado key={d.imei} d={d} ahora={ahora} elegido={seleccionado === d.imei} detallado>
              <button type="button" className="gp-btn2 chico" disabled={!coincideDetectado(d, { inicial: datos.imei, sms: imeiSms, transporte: datos.transporte, ahora })} onClick={() => usarImei(d)}>{seleccionado === d.imei ? 'Coincidencia seleccionada' : 'Seleccionar este dispositivo'}</button>
            </Detectado>)}
            <button type="button" className="gp-btn2" onClick={() => detectados.recargar()}>Actualizar lista</button>
          </>
          {errorAlta && <p role="alert">{errorAlta}</p>}
          <button type="button" className="gp-btn" disabled={guardando || !puedeRegistrar} onClick={registrarCoban}>{guardando ? 'Comprobando registro…' : 'Registrar sin activar'}</button>
        </section>
      )}
      {dialogo}
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
