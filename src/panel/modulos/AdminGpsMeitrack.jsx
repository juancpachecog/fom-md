import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import repo from '../datos/repo'
import { useDatos } from '../useDatos'
import { Cabeza, IcoGps, Pastilla, RAIZ_GPS, useAhora } from '../comp/GpsPiezas'
import {
  CATALOGO_GPS, haceCuanto, huellaCorta, validarImei, validarLinea,
} from '../datos/gps'
import {
  AVISO_RUTA_AUSENTE, MEITRACK, armarComandosMeitrack, cuerpoAltaMeitrack, db4Configurado, lecturaDb4,
  listaComandos, mensajeMeitrack, receptorValido, resumenRecepcion, rutaAusente, validarApnMeitrack,
  validarClaveMeitrack, ventanaUsable,
} from '../datos/gpsMeitrack'
import './admin-gps.css'

// ============================================================
// NUEVO GPS · MEITRACK T399L (T-211)
// Cuatro pasos, con el mismo aspecto del alta del Coban:
//   1 · Equipo y SIM: IMEI, serie y la línea de la tarjeta.
//   2 · Comandos SMS: los de Juan (fom-core, apps/gps-web) para guardar la
//       configuración actual y apuntar el equipo al receptor, puerto 5002 por TCP.
//       FOM no manda SMS: la persona los copia y los envía desde su teléfono.
//   3 · Esperando señal: consulta cada 5 s si llegó una trama del mismo IMEI.
//   4 · Registrar: solo inventario (`meitrack-setup/register`). No instala ni activa.
// Las rutas son de una rama de fom-core que puede no estar publicada: si el servidor
// responde «Cannot POST», se avisa en llano y no como error técnico.
// ============================================================

// IP del receptor para el comando de conexión: sale de la configuración del sitio, no del código.
const IP_RECEPTOR = String(import.meta.env?.VITE_GPS_RECEPTOR || '').trim()

const PASOS = ['Equipo y SIM', 'Comandos SMS', 'Esperando señal', 'Registrar']
const SIN_SERVIDOR = 'El registro de Meitrack necesita la conexión con el servidor de FOM.'

const SMS_INICIAL = { clave: '', e04: '', db4: '', db4Despues: '', sinAuth: false, guardada: null }

/** Las rutas de Meitrack del repositorio; sin servidor real (demostración) avisan como ruta ausente. */
function servicio() {
  const s = repo.admin.gps.meitrack
  if (!s) {
    const e = new Error(SIN_SERVIDOR)
    e.estado = 501
    throw e
  }
  return s
}

export default function AdminGpsMeitrack({ marca, modelo, imeiInicial = '', alElegirModelo }) {
  const navegar = useNavigate()
  const [paso, setPaso] = useState(1)
  const [datos, setDatos] = useState({ imei: imeiInicial, serie: '', telefono: '', iccid: '', operador: '', apn: '', plan: '' })
  const [errores, setErrores] = useState({})
  const [sms, setSms] = useState(SMS_INICIAL)
  const [ausente, setAusente] = useState(false)
  const [equipoId, setEquipoId] = useState(null)
  const [registrado, setRegistrado] = useState(false)

  const imei = validarImei(datos.imei).valor
  // El DB4 de después confirma destino, APN y TCP: sin eso el alta no se ofrece (igual que la app).
  const configurado = db4Configurado(sms.db4Despues, lecturaDb4(sms.db4, imei), imei, datos.apn, { ip: IP_RECEPTOR, puerto: MEITRACK.puerto })
  const poner = (campo, valor) => {
    setDatos((d) => ({ ...d, [campo]: valor }))
    setErrores((e) => ({ ...e, [campo]: undefined }))
    // Otro equipo, otras lecturas: lo pegado se borra, igual que en la consola de Juan.
    if (campo === 'imei') setSms((s) => ({ ...SMS_INICIAL, clave: s.clave }))
  }
  const ponerSms = (campo, valor) => setSms((s) => ({ ...s, [campo]: valor }))

  const siguiente1 = () => {
    const e = {}
    const i = validarImei(datos.imei)
    if (i.error) e.imei = i.error
    if (datos.serie.trim().length > 100) e.serie = 'El número de serie admite hasta 100 caracteres.'
    Object.assign(e, validarLinea({ ...datos, estadoSim: 'active' }))
    const apn = validarApnMeitrack(datos.apn)
    if (apn.error) e.apn = apn.error
    else delete e.apn
    setErrores(e)
    if (Object.keys(e).length === 0) setPaso(2)
  }

  const salir = () => navegar(equipoId ? `${RAIZ_GPS}/${equipoId}` : RAIZ_GPS)
  const bajadas = {
    1: 'Registra el Meitrack T399L en el inventario. Instalarlo en una unidad es un paso aparte.',
    2: 'Manda estos mensajes por SMS desde tu teléfono a la línea del equipo, en orden.',
    3: 'FOM espera la primera señal del equipo en el receptor.',
    4: 'Revisa los datos y guárdalos en el inventario.',
  }

  return (
    <div className="gp">
      <Cabeza
        ruta={[['Administración FOM'], ['Inventario GPS', RAIZ_GPS], ['Nuevo GPS']]}
        titulo="Nuevo GPS"
        bajada={bajadas[paso]}
        acciones={<button type="button" className="gp-btn2" onClick={salir}>{registrado ? 'Ir al equipo' : 'Descartar'}</button>}
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

      {ausente && paso > 1 && <AvisoRutaAusente />}

      {paso === 1 && (
        <PasoEquipo
          marca={marca} modelo={modelo} datos={datos} errores={errores} poner={poner}
          alElegirModelo={(m, mo) => alElegirModelo(m, mo, datos.imei)} alSeguir={siguiente1}
        />
      )}
      {paso === 2 && (
        <PasoComandos
          datos={datos} imei={imei} sms={sms} ponerSms={ponerSms} ausente={ausente} alAusente={() => setAusente(true)}
          alVolver={() => setPaso(1)} alSeguir={() => setPaso(3)}
        />
      )}
      {paso === 3 && (
        <PasoSenal imei={imei} ausente={ausente} alAusente={() => setAusente(true)} alVolver={() => setPaso(2)} alSeguir={() => setPaso(4)} />
      )}
      {paso === 4 && (
        <PasoRegistro
          datos={datos} ausente={ausente} alAusente={() => setAusente(true)} alVolver={() => setPaso(3)}
          equipoId={equipoId} registrado={registrado} configurado={configurado}
          alRegistrar={(id) => { setEquipoId(id); setRegistrado(true) }}
          alIr={(id) => navegar(id ? `${RAIZ_GPS}/${id}` : RAIZ_GPS)}
        />
      )}
    </div>
  )
}

/** Aviso llano de que las rutas de Meitrack todavía no están en el servidor publicado. */
function AvisoRutaAusente() {
  return (
    <div className="gp-aviso info" role="status">
      <IcoGps nombre="senal" />
      <span>
        <b>{AVISO_RUTA_AUSENTE}</b>{' '}
        Ya está hecho en el panel y espera a que Juan lo publique. Mientras tanto no se puede registrar este modelo; el Coban GPS-403 sigue igual.
      </span>
    </div>
  )
}

function Campo({ id, etiqueta, ayuda, error, todo = false, children }) {
  return (
    <div className={`gp-f${todo ? ' todo' : ''}`}>
      <label htmlFor={id}>{etiqueta}</label>
      {children}
      {error ? <span className="gp-error" role="alert">{error}</span> : ayuda && <span className="gp-hint">{ayuda}</span>}
    </div>
  )
}

// --- Paso 1 ------------------------------------------------------------

function PasoEquipo({ marca, modelo, datos, errores, poner, alElegirModelo, alSeguir }) {
  return (
    <div className="gp-grid l360">
      <section className="gp-card" style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '22px 24px' }} aria-labelledby="mt-p1">
        <div className="gp-titulo">
          <p className="gp-k">Paso 1 de 4</p>
          <h2 className="gp-st" id="mt-p1">Datos del equipo y de la SIM</h2>
          <span className="gp-lbl">El modelo elige el protocolo y el receptor. El IMEI no se corrige después.</span>
        </div>
        <div className="gp-campos">
          <Campo id="mt-marca" etiqueta="Marca *">
            <div className="gp-field">
              <select id="mt-marca" value={marca} onChange={(e) => alElegirModelo(e.target.value, Object.keys(CATALOGO_GPS[e.target.value] ?? {})[0] ?? '')}>
                {Object.keys(CATALOGO_GPS).map((m) => <option key={m}>{m}</option>)}
              </select>
              <IcoGps nombre="abajo" />
            </div>
          </Campo>
          <Campo id="mt-modelo" etiqueta="Modelo *">
            <div className="gp-field">
              <select id="mt-modelo" value={modelo} onChange={(e) => alElegirModelo(marca, e.target.value)}>
                {Object.keys(CATALOGO_GPS[marca] ?? {}).map((m) => <option key={m}>{m}</option>)}
              </select>
              <IcoGps nombre="abajo" />
            </div>
          </Campo>
          <Campo id="mt-proto" etiqueta="Protocolo" ayuda="Se pone solo según el modelo.">
            <div className="gp-field ro"><input id="mt-proto" value={`${CATALOGO_GPS.Meitrack.T399L.protocoloNombre} · ${MEITRACK.transporte.toUpperCase()} · puerto ${MEITRACK.puerto}`} readOnly /></div>
          </Campo>
          <Campo id="mt-fw" etiqueta="Firmware" ayuda="Solo se registra esta versión.">
            <div className="gp-field ro"><input id="mt-fw" className="gp-mono" value={MEITRACK.firmware} readOnly /></div>
          </Campo>
          <Campo id="mt-imei" etiqueta="IMEI *" todo error={errores.imei} ayuda="15 dígitos, único en FOM. Viene en la etiqueta del equipo.">
            <div className={`gp-field${errores.imei ? ' mal' : ''}`}>
              <input id="mt-imei" className="gp-mono" inputMode="numeric" autoComplete="off" maxLength={20} value={datos.imei} onChange={(e) => poner('imei', e.target.value)} aria-invalid={Boolean(errores.imei)} />
            </div>
          </Campo>
          <Campo id="mt-serie" etiqueta="Número de serie" error={errores.serie}>
            <div className="gp-field"><input id="mt-serie" placeholder="Opcional" maxLength={100} value={datos.serie} onChange={(e) => poner('serie', e.target.value)} /></div>
          </Campo>
          <Campo id="mt-tel" etiqueta="Teléfono de la línea *" error={errores.telefono} ayuda="La línea a la que mandas los SMS.">
            <div className={`gp-field${errores.telefono ? ' mal' : ''}`}><input id="mt-tel" type="tel" placeholder="0414-5523187" maxLength={30} value={datos.telefono} onChange={(e) => poner('telefono', e.target.value)} /></div>
          </Campo>
          <Campo id="mt-iccid" etiqueta="ICCID *" error={errores.iccid} ayuda="De 18 a 22 dígitos, impreso en la tarjeta.">
            <div className={`gp-field${errores.iccid ? ' mal' : ''}`}><input id="mt-iccid" className="gp-mono" inputMode="numeric" autoComplete="off" maxLength={26} value={datos.iccid} onChange={(e) => poner('iccid', e.target.value)} /></div>
          </Campo>
          <Campo id="mt-op" etiqueta="Operador *" error={errores.operador}>
            <div className={`gp-field${errores.operador ? ' mal' : ''}`}><input id="mt-op" maxLength={80} placeholder="Movistar, Digitel…" value={datos.operador} onChange={(e) => poner('operador', e.target.value)} /></div>
          </Campo>
          <Campo id="mt-apn" etiqueta="APN *" error={errores.apn} ayuda="Lo da el operador. Sin usuario ni clave.">
            <div className={`gp-field${errores.apn ? ' mal' : ''}`}><input id="mt-apn" autoComplete="off" maxLength={100} value={datos.apn} onChange={(e) => poner('apn', e.target.value)} /></div>
          </Campo>
        </div>
        <div className="gp-pie">
          <button type="button" className="gp-btn" onClick={alSeguir}>Siguiente: Comandos SMS<IcoGps nombre="siguiente" /></button>
        </div>
      </section>

      <section className="gp-card gp-col" aria-labelledby="mt-que">
        <p className="gp-k">Cómo sigue</p>
        <h2 className="gp-st" id="mt-que">El Meitrack se prepara distinto</h2>
        <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }} className="gp-lbl">
          <li>Guardas la configuración que trae el equipo, para poder devolverla.</li>
          <li>Lo apuntas al receptor de FOM por SMS (puerto {MEITRACK.puerto}, TCP).</li>
          <li>FOM espera su primera señal.</li>
          <li>Solo entonces se registra en el inventario.</li>
        </ol>
        <span className="gp-hint">FOM nunca manda los SMS: tú los copias y los envías desde tu teléfono.</span>
      </section>
    </div>
  )
}

// --- Paso 2 ------------------------------------------------------------

function PasoComandos({ datos, imei, sms, ponerSms, ausente, alAusente, alVolver, alSeguir }) {
  const ahora = useAhora(1000)
  const [copiado, setCopiado] = useState(null)
  const [aviso, setAviso] = useState('')

  // La ventana de recepción que el servidor tiene abierta para este equipo: se mira cada 5 s.
  const ventana = useDatos(
    () => servicio().ventana(imei).then((setup) => ({ setup, en: Date.now() })).catch((e) => {
      if (rutaAusente(e)) alAusente()
      throw e
    }),
    [imei],
    ausente ? 0 : 5_000,
  )
  const setup = ventana.datos?.setup ?? null
  const usable = ventanaUsable(setup, ventana.datos ? Math.max(0, ahora - ventana.datos.en) : Infinity)
  const destino = setup?.window?.destination
  const ip = IP_RECEPTOR

  const anunciadosLista = listaComandos(sms.e04)
  const anunciados = anunciadosLista ?? []
  const base = lecturaDb4(sms.db4, imei)
  const claveError = sms.clave ? validarClaveMeitrack(sms.clave).error : ''
  const llave = JSON.stringify([base?.celdas, sms.clave, datos.apn, sms.sinAuth])
  const guardada = sms.guardada === llave

  const comandos = armarComandosMeitrack({
    clave: sms.clave, anunciados, base, sinUsuarioNiClave: sms.sinAuth, restauracionGuardada: guardada,
    apn: datos.apn, ip, ventana: usable,
  })
  const configurado = db4Configurado(sms.db4Despues, base, imei, datos.apn, { ip, puerto: MEITRACK.puerto })

  const copiar = async (c) => {
    setAviso('')
    try {
      await navigator.clipboard.writeText(c.texto)
      setCopiado(c.n)
      setAviso('Mensaje copiado. Mándalo a la línea del equipo desde tu teléfono; FOM no lo envía.')
      setTimeout(() => setCopiado((x) => (x === c.n ? null : x)), 2000)
    } catch {
      setAviso('No se pudo copiar. Escribe el mensaje a mano en el SMS, con tu contraseña en lugar de los puntos. FOM no lo envió.')
    }
  }

  const campoPegado = (id, etiqueta, valor, clave, ayuda, mal) => (
    <div className="gp-f todo" style={{ paddingLeft: 46 }}>
      <label htmlFor={id}>{etiqueta}</label>
      <div className={`gp-field${mal ? ' mal' : ''}`}>
        <input id={id} className="gp-mono" autoComplete="off" spellCheck={false} maxLength={clave === 'db4' || clave === 'db4Despues' ? 1024 : 2048} value={valor} onChange={(e) => ponerSms(clave, e.target.value)} aria-invalid={Boolean(mal)} />
      </div>
      {mal ? <span className="gp-error" role="alert">{mal}</span> : <span className="gp-hint">{ayuda}</span>}
    </div>
  )

  return (
    <div className="gp-grid l400">
      <section className="gp-card" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '22px 24px 10px' }} aria-labelledby="mt-cmd-t">
        <div className="gp-titulo" style={{ marginBottom: 6 }}>
          <p className="gp-k">Paso 2 de 4</p>
          <h2 className="gp-st" id="mt-cmd-t">Configura el equipo por SMS</h2>
          <span className="gp-lbl">Manda cada mensaje a {datos.telefono.trim() || 'la línea del equipo'}{datos.operador.trim() ? ` (${datos.operador.trim()})` : ''}, en orden. Copiar no envía nada.</span>
        </div>

        <div className="gp-f" style={{ marginBottom: 8 }}>
          <label htmlFor="mt-clave">Contraseña SMS actual del equipo</label>
          <div className={`gp-field${claveError ? ' mal' : ''}`}><input id="mt-clave" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" placeholder="4 dígitos" value={sms.clave} onChange={(e) => ponerSms('clave', e.target.value)} aria-invalid={Boolean(claveError)} /></div>
          {claveError ? <span className="gp-error" role="alert">{claveError}</span> : <span className="gp-hint">Solo arma los mensajes. No se guarda ni se envía al servidor.</span>}
        </div>

        {comandos.map((c) => (
          <div key={c.n}>
            <div className="gp-cmd">
              <span className="n">{c.n}</span>
              <div className="tx">
                <b>{c.titulo}</b>
                <code style={c.falta ? { color: 'var(--e-texto-3, #8c97a7)', whiteSpace: 'normal' } : undefined}>{c.falta ? `Pendiente: ${c.falta}` : c.visible}</code>
                <span className="gp-hint">{c.respuesta}</span>
              </div>
              <button type="button" className="gp-btn2" disabled={Boolean(c.falta)} aria-label={`Copiar mensaje ${Number(c.n)}`} onClick={() => copiar(c)}>
                <IcoGps nombre={copiado === c.n ? 'check' : 'copiar'} />{copiado === c.n ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            {c.n === '02' && campoPegado('mt-e04', 'Códigos que respondió E04', sms.e04, 'e04', 'Ejemplo: A00,A21,DB4,DA6,E91. Solo los códigos, sin IMEI.', anunciadosLista === null ? 'Escribe solo códigos de 3 caracteres separados por comas; no pegues la respuesta completa.' : '')}
            {c.n === '03' && campoPegado('mt-db4', 'Respuesta de DB4 (antes de configurar)', sms.db4, 'db4', 'Debe decir CLOSE. Se queda en esta pantalla y se borra al cambiar de equipo.', sms.db4.trim() && !base ? 'Esa respuesta no es la de este equipo en CLOSE. Revisa que sea el IMEI correcto y que la hayas pegado completa.' : '')}
            {c.n === '04' && (
              <div style={{ paddingLeft: 46, display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
                <label className="gp-chk"><input type="checkbox" checked={sms.sinAuth} onChange={(e) => ponerSms('sinAuth', e.target.checked)} />Confirmo que el APN guardado en el equipo no usa usuario ni contraseña.</label>
                <label className="gp-chk"><input type="checkbox" disabled={Boolean(c.falta)} checked={guardada} onChange={(e) => ponerSms('guardada', e.target.checked ? llave : null)} />Conservé el mensaje de restauración en mi teléfono.</label>
              </div>
            )}
            {c.n === '06' && campoPegado('mt-db4b', 'Respuesta de DB4 (después de configurar)', sms.db4Despues, 'db4Despues', 'Para comprobar el destino, el APN y el tipo TCP.', '')}
          </div>
        ))}
        {sms.db4Despues.trim() && (
          <div className={`gp-chk${configurado ? '' : ' no'}`} role="status" style={{ paddingLeft: 46 }}>
            <span className="c">{configurado && <IcoGps nombre="check" />}</span>
            {configurado ? 'DB4 confirma el destino, el APN y TCP; lo demás sigue igual.' : 'DB4 todavía no muestra el destino, el APN y TCP previstos.'}
          </div>
        )}
        {aviso && <p className="gp-hint" role="status">{aviso}</p>}
        <span className="gp-hint" style={{ padding: '10px 0 6px', borderTop: '1px solid var(--e-borde, #262e39)' }}>Los puntos son la contraseña SMS: se pone al copiar y no se guarda. No se cambian reloj, intervalos, entradas ni salidas.</span>
        <div className="gp-pie entre" style={{ marginBottom: 12 }}>
          <button type="button" className="gp-btn2" onClick={alVolver}><IcoGps nombre="anterior" />Anterior</button>
          <button type="button" className="gp-btn" onClick={alSeguir}>Siguiente: Esperando señal<IcoGps nombre="siguiente" /></button>
        </div>
      </section>

      <section className="gp-card gp-col" aria-labelledby="mt-rec">
        <p className="gp-k">Receptor de FOM</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="gp-ibox"><IcoGps nombre="gps" /></span>
          <div className="gp-titulo">
            <b id="mt-rec" style={{ fontSize: 15, fontWeight: 600 }}>Meitrack T399L</b>
            <span className="gp-hint gp-mono">IMEI {imei}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Pastilla tono="info">TCP · puerto {MEITRACK.puerto}</Pastilla>
          <Pastilla tono="info">{MEITRACK.firmware}</Pastilla>
        </div>
        <dl className="gp-dl" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div><dt className="gp-hint">Dirección del receptor</dt><dd className="gp-mono" style={{ margin: 0 }}>{receptorValido(ip) ? `${ip.trim()}:${MEITRACK.puerto}` : 'Falta en la configuración del sitio'}</dd></div>
        </dl>
        {destino?.host && receptorValido(ip) && destino.host !== ip.trim() && (
          <div className="gp-aviso error" role="alert">El servidor espera la señal en {destino.host}:{destino.port}, no en la dirección de este sitio. Avisa a Juan antes de enviar el mensaje 05.</div>
        )}
        {ventana.estado === 'cargando' && <span className="gp-hint">Consultando la ventana de recepción…</span>}
        {ventana.estado === 'error' && !ausente && <div className="gp-aviso error" role="alert">{mensajeMeitrack(ventana.error)}</div>}
        {ventana.estado === 'ok' && usable && (
          <div className="gp-aviso" role="status"><IcoGps nombre="check" />Ventana de recepción abierta hasta las {new Date(setup.window.expiresAt).toLocaleTimeString('es-VE', { hour12: false, hour: '2-digit', minute: '2-digit' })}. Quedan {setup.window.remainingConnections} conexiones.</div>
        )}
        {ventana.estado === 'ok' && !usable && (
          <div className="gp-aviso mute" role="status">La ventana de recepción de FOM todavía no está abierta para este equipo, o está por vencer. El mensaje 05 queda bloqueado; los de lectura y la restauración siguen disponibles.</div>
        )}
        <span className="gp-hint">Las respuestas del equipo por SMS no confirman la conexión con FOM: eso se ve en el paso 3.</span>
      </section>
    </div>
  )
}

// --- Paso 3 ------------------------------------------------------------

function PasoSenal({ imei, ausente, alAusente, alVolver, alSeguir }) {
  const ahora = useAhora(5000)
  const rec = useDatos(
    () => servicio().recepcion(imei).catch((e) => {
      if (rutaAusente(e)) alAusente()
      throw e
    }),
    [imei],
    ausente ? 0 : 5_000,
  )
  const r = resumenRecepcion(rec.datos)
  const recibida = r.estado === 'recibida'

  return (
    <div className="gp-grid l400">
      <section className="gp-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 22 }} aria-labelledby="mt-sen-t" aria-live="polite">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className={`gp-radar${recibida ? ' ok' : ' espera'}`}><IcoGps nombre="senal" /></span>
          <div className="gp-titulo" style={{ gap: 4 }}>
            <p className="gp-k">Paso 3 de 4</p>
            {recibida
              ? <Pastilla tono="ok" punto sola>Señal recibida · {haceCuanto(r.ultima.receivedAt, ahora)}</Pastilla>
              : <Pastilla tono="info" punto sola>{r.estado === 'sin-ventana' ? 'Ventana de recepción cerrada' : 'Esperando la señal'}</Pastilla>}
            <h2 className="gp-st" id="mt-sen-t">Esperando señal</h2>
            <span className="gp-hint gp-mono">IMEI {imei}</span>
          </div>
        </div>

        {rec.estado === 'error' && !ausente && <div className="gp-aviso error" role="alert">{mensajeMeitrack(rec.error)}</div>}
        {rec.estado === 'ok' && r.estado === 'sin-ventana' && (
          <div className="gp-aviso mute" role="status">La ventana de recepción de FOM no está abierta para este equipo. Sin ella no se puede comprobar la señal; avisa a Juan para que la abra.</div>
        )}
        {rec.estado === 'ok' && r.estado === 'esperando' && (
          <div className="gp-aviso info" role="status">Todavía no llegó ninguna trama de este equipo. Con el mensaje 05 enviado y el OK del equipo, suele tardar unos minutos. Se revisa sola cada 5 segundos.</div>
        )}

        {recibida && (
          <>
            <div className="gp-chk"><span className="c"><IcoGps nombre="check" /></span>Llegó una trama del mismo IMEI y se pudo leer.</div>
            {r.mensajes.map((m) => (
              <div className="gp-evidencia" key={m.receiptId}>
                <b>{new Date(m.receivedAt).toLocaleString('es-VE', { hour12: false })} · {m.bytes} bytes · {m.records} {m.records === 1 ? 'registro' : 'registros'}</b>
                <span className="gp-hint gp-mono">SHA-256 {huellaCorta(m.sha256)}</span>
              </div>
            ))}
          </>
        )}

        <span className="gp-hint">Un «OK» del equipo por mensaje no prueba que FOM lo esté oyendo: lo prueba la señal de arriba. Una conexión TCP sola tampoco cuenta; hace falta una trama que el servidor pueda leer.</span>
        <div className="gp-pie entre">
          <button type="button" className="gp-btn2" onClick={alVolver}><IcoGps nombre="anterior" />Anterior</button>
          <button type="button" className="gp-btn" onClick={alSeguir} disabled={!recibida}>Siguiente: Registrar<IcoGps nombre="siguiente" /></button>
        </div>
      </section>

      <section className="gp-card gp-col" aria-labelledby="mt-sen-ayuda">
        <p className="gp-k">Si no llega</p>
        <h2 className="gp-st" id="mt-sen-ayuda">Qué revisar</h2>
        <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }} className="gp-lbl">
          <li>Que el equipo respondió OK al mensaje 05.</li>
          <li>Que la SIM tiene datos y el APN es el del paso 1.</li>
          <li>Que el equipo está encendido y con cobertura.</li>
          <li>Con el mensaje 06 (DB4) comprueba que dice TCP, la IP del receptor y el puerto {MEITRACK.puerto}.</li>
        </ol>
        <button type="button" className="gp-btn2 ancho" onClick={() => rec.recargar()}><IcoGps nombre="sync" />Revisar ahora</button>
      </section>
    </div>
  )
}

// --- Paso 4 ------------------------------------------------------------

const ESTADOS_ALTA = {
  absent: ['ok', 'Este equipo todavía no está en el inventario: se puede registrar.'],
  matching: ['info', 'Este equipo ya está registrado con estos mismos datos.'],
  conflict: ['error', 'Ya existe un equipo con este IMEI pero con datos distintos. Revísalo en el inventario antes de seguir.'],
  unavailable: ['mute', 'El servidor no pudo comprobar si el equipo ya existe. La consulta solo funciona con la ventana de recepción abierta.'],
}

function PasoRegistro({ datos, ausente, alAusente, alVolver, equipoId, registrado, configurado, alRegistrar, alIr }) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const alta = useDatos(
    () => servicio().alta(datos).catch((e) => {
      if (rutaAusente(e)) alAusente()
      throw e
    }),
    [datos.imei],
  )
  const estado = alta.datos?.state ?? null
  const idExistente = estado === 'matching' ? alta.datos.id : null
  const hecho = registrado || estado === 'matching'
  const cuerpo = cuerpoAltaMeitrack(datos)

  const registrar = async () => {
    setGuardando(true)
    setError('')
    try {
      const r = await servicio().registrar(datos)
      alRegistrar(r.id)
    } catch (e) {
      if (rutaAusente(e)) alAusente()
      // Un fallo sin respuesta clara no se reintenta a ciegas: se pregunta si el alta quedó hecha.
      let existe = null
      if (!e.estado || e.estado >= 500) {
        existe = await servicio().alta(datos).catch(() => null)
      }
      if (existe?.state === 'matching') alRegistrar(existe.id)
      else setError(mensajeMeitrack(e))
    } finally {
      setGuardando(false)
    }
  }

  const [tono, texto] = ESTADOS_ALTA[estado] ?? ['mute', '']
  const fila = (k, v) => <div key={k}><dt className="gp-hint">{k}</dt><dd className="gp-mono" style={{ margin: 0 }}>{v || '—'}</dd></div>

  return (
    <div className="gp-grid l400">
      <section className="gp-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '22px 24px' }} aria-labelledby="mt-reg-t">
        <div className="gp-titulo">
          <p className="gp-k">Paso 4 de 4</p>
          <h2 className="gp-st" id="mt-reg-t">Registrar en el inventario</h2>
          <span className="gp-lbl">Se guarda en el inventario de FOM. No se instala en una unidad ni se activa: eso es un paso aparte, con la señal ya comprobada.</span>
        </div>

        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          {fila('Equipo', `${cuerpo.manufacturer} ${cuerpo.model}`)}
          {fila('IMEI', cuerpo.imei)}
          {fila('Firmware', cuerpo.firmwareVersion)}
          {fila('Serie', cuerpo.serialNumber)}
          {fila('Línea SIM', cuerpo.simPhone)}
          {fila('ICCID', cuerpo.iccid)}
          {fila('Operador', cuerpo.carrier)}
          {fila('APN', cuerpo.apn)}
        </dl>

        {alta.estado === 'cargando' && <span className="gp-hint">Comprobando si ya existe…</span>}
        {alta.estado === 'error' && !ausente && <div className="gp-aviso error" role="alert">{mensajeMeitrack(alta.error)}</div>}
        {alta.estado === 'ok' && !registrado && texto && <div className={`gp-aviso${tono === 'ok' ? '' : ` ${tono}`}`} role="status">{tono === 'ok' && <IcoGps nombre="check" />}{texto}</div>}
        {registrado && <div className="gp-aviso" role="status"><IcoGps nombre="check" />Equipo registrado en el inventario. Instalarlo en una unidad es un paso aparte.</div>}
        {!hecho && !configurado && <div className="gp-aviso mute" role="status">Falta pegar, en el paso 2, la lectura DB4 de después: debe decir TCP, el destino y el APN previstos.</div>}
        {error && <div className="gp-aviso error" role="alert">{error}</div>}

        <div className="gp-pie entre">
          <button type="button" className="gp-btn2" onClick={alVolver} disabled={guardando || registrado}><IcoGps nombre="anterior" />Anterior</button>
          {hecho
            ? <button type="button" className="gp-btn" onClick={() => alIr(equipoId ?? idExistente)}>Ir al equipo<IcoGps nombre="siguiente" /></button>
            : <button type="button" className="gp-btn" onClick={registrar} disabled={guardando || ausente || estado !== 'absent' || !configurado}>{guardando ? 'Registrando…' : 'Registrar en el inventario'}<IcoGps nombre="siguiente" /></button>}
        </div>
      </section>

      <section className="gp-card gp-col" aria-labelledby="mt-reg-n">
        <p className="gp-k">Después</p>
        <h2 className="gp-st" id="mt-reg-n">Qué falta</h2>
        <span className="gp-lbl">Registrar no activa el GPS. Falta instalarlo en una unidad y comprobar su reloj y sus funciones antes de ponerlo en servicio.</span>
        <span className="gp-hint">El servidor revisa otra vez, antes de guardar, que llegó la señal de prueba y que el equipo no existe.</span>
      </section>
    </div>
  )
}
