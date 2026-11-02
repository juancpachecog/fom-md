// FOM #727: portado desde fom-core f2a925b; conserva las guardas del recorrido TEST.
import { useEffect, useState } from "react";
import { pedir } from "../datos/api";
import { t399ReadOnlyQuery } from './commands.js';
import { parseT399ClosedReadback, compareT399ClosedReadbacks } from './meitrack-readback.js';
import { readIdentitySms, readCommandsSms, readPendingSms, readConnectionOk } from './guided-sms.js';
import { validarLinea } from '../datos/gps.js';
import { configuredT399Readback, parseSetupCapture, parseSetupReadiness, setupConnectionSms, setupRecoverySms, setupWindowUsable } from "./meitrack-setup.js";
import "./meitrack.css";
async function requestSetup(path, body, signal) {
    return pedir(`/api/v1/console/meitrack-setup/${path}`, { metodo: "POST", cuerpo: body, señal: signal, empresaContexto: null });
}
export function MeitrackInstallationSetup({ password, imei, firmware, apn, onReady, onCapture, onPasswordChange, knownImei = "", onIdentityChange, lineData = {}, onLineChange, onLockChange, onSelect, selected = false, canRegister = false, onRegister, registered = false, registering = false, registrationError = "" }) {
    const [baseline, setBaseline] = useState(null);
    const [step, setStep] = useState(1), [preparation, setPreparation] = useState(0);
    const [identityText, setIdentityText] = useState(''), [commandsText, setCommandsText] = useState('');
    const [baselineText, setBaselineText] = useState(''), [pendingText, setPendingText] = useState('');
    const [okText, setOkText] = useState(''), [sentReference, setSentReference] = useState(null);
    const [recoveryWitness, setRecoveryWitness] = useState(null), [restoreText, setRestoreText] = useState('');
    useEffect(() => { onLockChange?.(!!sentReference || registered); }, [sentReference, registered, onLockChange]);
    const [announced, setAnnounced] = useState([]);
    const [emptyAuth, setEmptyAuth] = useState(false), [savedRecovery, setSavedRecovery] = useState(null);
    const [response, setResponse] = useState(null);
    const [tick, setTick] = useState(0), [message, setMessage] = useState("");
    const [capture, setCapture] = useState(null);
    const [latest, setLatest] = useState("");
    const [lastWindow, setLastWindow] = useState(null);
    useEffect(() => {
        let stopped = false;
        let timer;
        let activeRequest = null;
        async function update() {
            const controller = new AbortController();
            activeRequest = controller;
            const deadline = setTimeout(() => controller.abort(), 5000);
            try {
                if (!/^[0-9]{15}$/.test(imei) || firmware !== "T399L-V254") {
                    setResponse(null);
                    return;
                }
                const setup = parseSetupReadiness(await requestSetup("readiness", { imei, firmware }, controller.signal));
                if (!stopped)
                    setResponse(setup ? { setup, at: performance.now() } : null);
                if (setup?.ready && setup.window && !stopped) {
                    setLastWindow(setup.window);
                    const received = parseSetupCapture(await requestSetup("capture", { imei, firmware }, controller.signal), setup.window.reference);
                    if (!stopped && received?.received)
                        setCapture(received);
                }
            }
            catch {
                if (!stopped)
                    setResponse(null);
            }
            finally {
                clearTimeout(deadline);
                activeRequest = null;
                if (!stopped)
                    timer = setTimeout(() => void update(), 5000);
            }
        }
        void update();
        const clock = setInterval(() => setTick(performance.now()), 1000);
        return () => { stopped = true; activeRequest?.abort(); clearTimeout(timer); clearInterval(clock); };
    }, [imei, firmware]);
    const recoveryKey = JSON.stringify([baseline?.cells, password, apn, emptyAuth]);
    const recoverySaved = savedRecovery === recoveryKey;
    const elapsed = response ? Math.max(0, tick - response.at) : Infinity;
    const setup = response?.setup ?? null;
    const recovery = setupRecoverySms(password, baseline, imei, firmware, emptyAuth);
    const connection = capture?.received ? null : setupConnectionSms(password, baseline, imei, firmware, apn, emptyAuth, recoverySaved, announced, setup, elapsed);
    useEffect(() => { onReady(connection !== null); }, [connection, onReady, tick]);
    const configured = configuredT399Readback(latest, baseline, imei, firmware, apn, lastWindow?.destination ?? null);
    const currentWindow = setupWindowUsable(setup, elapsed);
    useEffect(() => { onCapture(currentWindow && capture?.received === true && capture.reference === lastWindow?.reference && configured && emptyAuth); }, [currentWindow, capture, onCapture, lastWindow, configured, emptyAuth]);
    async function copy(kind) {
        const currentElapsed = response ? performance.now() - response.at : Infinity;
        const command = kind === "recovery" ? recovery : capture?.received ? null
            : setupConnectionSms(password, baseline, imei, firmware, apn, emptyAuth, recoverySaved, announced, setup, currentElapsed);
        if (!command) {
            setMessage("La preparación o la ventana no permiten copiar este mensaje.");
            return;
        }
        try {
            await navigator.clipboard.writeText(command);
            setMessage("Mensaje copiado. Debe enviarlo desde su teléfono; FOM no lo ha enviado.");
        }
        catch {
            setMessage("No se pudo copiar. El mensaje no se ha enviado.");
        }
    }
    const identity = readIdentitySms(identityText, knownImei);
    const commandList = readCommandsSms(commandsText, imei);
    const initial = parseT399ClosedReadback(baselineText, imei, firmware);
    const pending = readPendingSms(pendingText, imei);
    const acknowledged = readConnectionOk(okText, imei);
    const lineErrors = validarLinea(lineData);
    const receiverReady = currentWindow && capture?.received === true && configured && acknowledged && !restoreText;
    const titles = ['Coloca la clave SMS', 'Identifica tu equipo', 'Configura la línea y el APN', 'Prepara la recuperación', 'Conecta y comprueba', 'Selecciona y registra'];
    const preparationTitles = ['Consultar comandos', 'Conservar configuración actual', 'Revisar datos pendientes', 'Guardar cómo volver atrás'];
    const nextAllowed = step === 1 ? /^[0-9]{4}$/.test(password)
        : step === 2 ? identity?.supported === true
        : step === 3 ? Object.keys(lineErrors).length === 0
        : step === 4 ? preparation === 0 ? !!commandList : preparation === 1 ? !!initial
          : preparation === 2 ? !!pending && pending.closed && pending.gprs === 0 && pending.sms === 0 : recoverySaved
        : step === 5 ? receiverReady : false;
    function next() {
        if (!nextAllowed) return;
        setMessage('');
        if (step === 2) {
            onIdentityChange?.(identity);
            setBaseline(null); setAnnounced([]); setCapture(null); setLatest(''); setPreparation(0);
        }
        if (step === 3) { setBaseline(null); setAnnounced([]); setCapture(null); setLatest(''); setPreparation(0); }
        if (step === 4 && preparation < 3) {
            if (preparation === 0) setAnnounced(commandList);
            if (preparation === 1) setBaseline(initial);
            setPreparation(preparation + 1); return;
        }
        setStep(step + 1);
    }
    function previous() {
        if (sentReference || registered) return;
        setMessage('');
        if (step === 4 && preparation > 0) setPreparation(preparation - 1);
        else setStep(Math.max(1, step - 1));
    }
    async function copyQuery(command) {
        const query = t399ReadOnlyQuery(password, command, announced);
        if (!query) return;
        try { await navigator.clipboard.writeText(query); setMessage('SMS copiado. Envíalo desde tu teléfono; FOM no lo ha enviado.'); }
        catch { setMessage('No se pudo copiar. No se ha enviado ningún SMS.'); }
    }
    function queryCard(command, instruction) {
        const query = t399ReadOnlyQuery(password, command, announced);
        return <div className="command-card"><div><p>{instruction}</p><code>{query ?? 'Completa la clave y las comprobaciones anteriores.'}</code></div>
            <button type="button" disabled={!query} onClick={() => void copyQuery(command)}>Copiar SMS {command}</button></div>;
    }
    const restore = recoveryWitness ? parseT399ClosedReadback(restoreText, recoveryWitness.imei, recoveryWitness.firmware) : null;
    const restored = restore && compareT399ClosedReadbacks(recoveryWitness.baseline, restore)?.length === 0;
    return <section className="meitrack-panel meitrack-guide" aria-label="Guía de instalación Meitrack">
        <header><p className="gp-k">PASO {step} DE 6</p><h2>{titles[step - 1]}</h2>
            <progress value={step} max="6" aria-label="Progreso de configuración" />
            <p>Una acción a la vez. Copia el SMS, envíalo desde tu teléfono y pega la respuesta cuando se solicite. Puedes usar las respuestas que ya conservas si la configuración no cambió.</p>
        </header>
        {step === 1 && <>
            <p>Introduce la clave SMS actual del GPS. No cambiaremos esa clave.</p>
            <label className="field"><span>Clave SMS actual · cuatro dígitos</span><input type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={password} onChange={e => onPasswordChange(e.target.value)} /></label>
            <small>La clave permanece en esta pantalla; no se envía a FOM ni se guarda.</small>
        </>}
        {step === 2 && <>
            {queryCard('E91', 'Este SMS consulta la identidad y la versión del GPS. No cambia su configuración.')}
            <label className="field"><span>Respuesta del GPS a E91</span><textarea value={identityText} maxLength={1024} autoComplete="off" spellCheck={false} onChange={e => setIdentityText(e.target.value)} /></label>
            {identity ? <p role="status">IMEI identificado: <b>{identity.imei}</b>. Versión leída: <b>{identity.firmware}</b>.</p> : identityText ? <p role="alert">No pudimos reconocer la respuesta o no coincide con el IMEI conocido. Pega el SMS E91 completo de este equipo, sin añadir la clave.</p> : null}
            {identity && !identity.supported && <p role="alert">Esta versión necesita una revisión de compatibilidad. Conserva la respuesta; no cambiaremos su configuración.</p>}
            <small>No necesitas conocer el firmware de antemano: lo leemos aquí. La respuesta y su número de serie permanecen sólo en memoria.</small>
        </>}
        {step === 3 && <>
            <p>Usa los datos de la SIM que está dentro del GPS.</p>
            {[['telefono', 'Teléfono de la SIM'], ['iccid', 'ICCID de la SIM'], ['operador', 'Operador'], ['apn', 'APN']].map(([key, label]) =>
                <label className="field" key={key}><span>{label}</span><input value={lineData[key] ?? ''} autoComplete="off" maxLength={key === 'apn' ? 120 : 80} onChange={e => onLineChange?.(key, e.target.value)} />
                    {lineData[key] && lineErrors[key] && <small role="alert">{lineErrors[key]}</small>}</label>)}
            <small>El APN lo proporciona tu operador. No se envía ningún SMS al completar este paso.</small>
        </>}
        {step === 4 && <>
            <p className="gp-k">COMPROBACIÓN {preparation + 1} DE 4 · {preparationTitles[preparation]}</p>
            {preparation === 0 && <>
                {queryCard('E04', 'Consulta qué comandos admite este equipo. El asistente elegirá sólo los necesarios.')}
                <label className="field"><span>Respuesta del GPS a E04</span><textarea value={commandsText} maxLength={2048} autoComplete="off" spellCheck={false} onChange={e => setCommandsText(e.target.value)} /></label>
                <small>Si ya conservas sólo la lista de códigos separados por comas, también puedes pegarla aquí.</small>
                {commandsText && !commandList && <p role="alert">La respuesta debe ser de este GPS y anunciar A21, DB4 y DA6. No se ha habilitado ningún cambio.</p>}
            </>}
            {preparation === 1 && <>
                {queryCard('DB4', 'Lee la configuración actual. La conservaremos para generar la vuelta atrás sin reemplazar otros parámetros.')}
                <label className="field"><span>Respuesta DB4 actual</span><textarea value={baselineText} maxLength={1024} autoComplete="off" spellCheck={false} onChange={e => setBaselineText(e.target.value)} /></label>
                {baselineText && !initial && <p role="alert">La respuesta no coincide con este equipo o no está en el estado CLOSE admitido. Conserva el SMS; no cambies el destino.</p>}
            </>}
            {preparation === 2 && <>
                {queryCard('DA6', 'Comprueba la conexión y si hay mensajes pendientes antes de cambiar el destino.')}
                <label className="field"><span>Respuesta del GPS a DA6</span><textarea value={pendingText} maxLength={2048} autoComplete="off" spellCheck={false} onChange={e => setPendingText(e.target.value)} /></label>
                {pendingText && !pending && <p role="alert">No se pudo comprobar esta respuesta DA6 para el mismo equipo.</p>}
                {pending && <p role="status">Conexión: {pending.closed ? 'CLOSE' : 'abierta'}. Pendientes GPRS: {pending.gprs}; SMS: {pending.sms}.</p>}
                {pending && (!pending.closed || pending.gprs || pending.sms) ? <p role="alert">Hay una conexión o mensajes pendientes. Detén el cambio de destino y conserva la respuesta; no borres la memoria.</p> : null}
                <details><summary>Qué comprueba esta lectura</summary><p>Los contadores de DA6 no prueban que toda la memoria esté vacía. Los satélites no certifican posición ni reloj.</p></details>
            </>}
            {preparation === 3 && <>
                <p>Antes de conectar con FOM, guarda en tu teléfono el SMS para volver a la configuración anterior.</p>
                <label className="field"><span><input type="checkbox" checked={emptyAuth} onChange={e => setEmptyAuth(e.target.checked)} /> El plan y la configuración APN guardada en este GPS no usan usuario ni contraseña.</span></label>
                <div className="command-card"><div><code>{recovery ?? 'Confirma la autenticación del APN para preparar la recuperación.'}</code></div><button type="button" disabled={!recovery} onClick={() => void copy('recovery')}>Copiar recuperación</button></div>
                <label className="field"><span><input type="checkbox" checked={recoverySaved} disabled={!recovery} onChange={e => {
                    setSavedRecovery(e.target.checked ? recoveryKey : null);
                    if (e.target.checked && recovery) setRecoveryWitness({ command: recovery, baseline, imei, firmware });
                }} /> Guardé el SMS de recuperación en mi teléfono.</span></label>
            </>}
        </>}
        {step === 5 && <>
            {!currentWindow ? <p role="status">El receptor de prueba no está disponible ahora. Conserva esta pantalla; la conexión permanece bloqueada hasta que FOM habilite una ventana para tu equipo.</p>
                : <p role="status">Receptor disponible hasta {new Date(setup.window.expiresAt).toLocaleTimeString()}. La recepción se comprobará automáticamente.</p>}
            {!acknowledged ? <>
                <div className="command-card"><div><p>Envía este SMS una sola vez para conectar con FOM. Ante silencio o error, conserva la respuesta y no lo repitas.</p><code>{connection ?? 'Pendiente de preparación o receptor disponible.'}</code></div>
                    <button type="button" disabled={!connection || sentReference === setup?.window?.reference} onClick={() => void copy('connection')}>Copiar conexión</button></div>
                <button type="button" disabled={!connection || !!sentReference} onClick={() => { if (setup?.window) setSentReference(setup.window.reference); }}>Ya envié el SMS de conexión</button>
                <label className="field"><span>Respuesta del GPS a A21</span><textarea value={okText} maxLength={256} autoComplete="off" spellCheck={false} onChange={e => { setOkText(e.target.value); if (readConnectionOk(e.target.value, imei) && setup?.window) setSentReference(setup.window.reference); }} /></label>
                {okText && !acknowledged && <p role="alert">No se ha reconocido A21 OK del mismo GPS. No repitas el comando; conserva la respuesta.</p>}
            </> : <>
                <p role="status">A21 OK reconocido. Ahora comprobaremos lo que quedó guardado; el OK por sí solo no confirma la conexión.</p>
                {queryCard('DB4', 'Consulta DB4 una vez y pega la respuesta para comprobar destino, APN, TCP y los demás parámetros.')}
                <label className="field"><span>Respuesta DB4 después de conectar</span><textarea value={latest} maxLength={1024} autoComplete="off" spellCheck={false} onChange={e => setLatest(e.target.value)} /></label>
                {latest && !configured && <p role="alert">La configuración no coincide exactamente con lo previsto. No repitas A21; conserva la respuesta y usa la recuperación.</p>}
                {configured && <p role="status">Configuración comprobada. {capture?.received ? 'FOM recibió una trama del mismo equipo.' : 'Esperando la recepción de este equipo en FOM…'}</p>}
            </>}
        </>}
        {step === 6 && <>
            {registered ? <p role="status">Registro comprobado en inventario. El GPS no está activado; la instalación, el reloj y las funciones se comprueban por separado.</p> : <>
                <p>Compara el IMEI consultado por SMS con el dispositivo que acaba de recibir FOM.</p>
                {receiverReady ? <div className="command-card"><div><strong>Detectado sin registrar: {imei}</strong><span>Meitrack T399L · TCP · identidad coincidente</span></div>
                    <button type="button" onClick={onSelect}>{selected ? 'Dispositivo seleccionado' : 'Seleccionar este dispositivo'}</button></div>
                    : <p role="status">La recepción o la ventana ya no permiten completar el registro. La recuperación conservada sigue disponible.</p>}
                {registrationError && <p role="alert">{registrationError}</p>}
                <button type="button" disabled={!receiverReady || !selected || !canRegister || registering} onClick={onRegister}>{registering ? 'Comprobando registro…' : 'Registrar sin activar'}</button>
                <details><summary>Ver comprobación técnica</summary><p>La captura pertenece a la ventana autorizada; DB4 coincide y se conserva la trama original. Esto no certifica el reloj ni las funciones del vehículo.</p></details>
            </>}
        </>}
        {message && <p role="status">{message}</p>}
        {step < 6 && <nav className="meitrack-guide-nav" aria-label="Navegación de la guía">
            <button type="button" disabled={step === 1 || !!sentReference || registered} onClick={previous}>Anterior</button>
            <button type="button" disabled={!nextAllowed} onClick={next}>{step === 5 ? 'Continuar: seleccionar dispositivo' : 'Continuar'}</button>
        </nav>}
        {recoveryWitness && <details className="meitrack-recovery"><summary>Recuperar la configuración anterior</summary>
            <p>Este mensaje vuelve al destino y APN iniciales con los datos GPRS deshabilitados. Está disponible aunque venza el receptor.</p><code>{recoveryWitness.command}</code>
            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(recoveryWitness.command); setMessage('Recuperación copiada; envíala desde tu teléfono sólo cuando corresponda.'); } catch { setMessage('No se pudo copiar la recuperación. Usa la copia conservada en tu teléfono.'); } }}>Copiar recuperación conservada</button>
            <p>Después del OK, consulta DB4 y compara la lectura. Un OK no basta para confirmar la recuperación.</p>
            <label className="field"><span>DB4 después de recuperar</span><textarea value={restoreText} maxLength={1024} autoComplete="off" spellCheck={false} onChange={e => setRestoreText(e.target.value)} /></label>
            {restoreText && <p role={restored ? 'status' : 'alert'}>{restored ? 'La lectura coincide con todos los parámetros iniciales conservados.' : 'La lectura todavía no confirma la configuración inicial completa.'}</p>}
        </details>}
    </section>;
}
