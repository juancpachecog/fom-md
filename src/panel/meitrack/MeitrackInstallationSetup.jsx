// FOM #727: portado desde fom-core f2a925b; conserva las guardas del recorrido TEST.
import { useEffect, useState } from "react";
import { pedir } from "../datos/api";
import { MeitrackSmsPreparation } from "./MeitrackSmsPreparation";
import { configuredT399Readback, parseSetupCapture, parseSetupReadiness, setupConnectionSms, setupRecoverySms, setupWindowUsable } from "./meitrack-setup.js";
import "./meitrack.css";
async function requestSetup(path, body, signal) {
    return pedir(`/api/v1/console/meitrack-setup/${path}`, { metodo: "POST", cuerpo: body, señal: signal, empresaContexto: null });
}
export function MeitrackInstallationSetup({ password, imei, firmware, apn, onReady, onCapture, onPasswordChange }) {
    const [baseline, setBaseline] = useState(null);
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
    return <section className="meitrack-panel config-stack" style={{ gridColumn: "1 / -1" }} aria-label="Instalación controlada Meitrack">
    <label className="field"><span>Contraseña SMS actual</span><input type="password" value={password} autoComplete="new-password" onChange={e => onPasswordChange(e.target.value)}/>
      <small>Se utiliza sólo en esta pantalla; nunca se envía al servidor ni se guarda con el borrador.</small></label>
    <MeitrackSmsPreparation password={password} imei={imei} firmware={firmware} onBaseline={setBaseline} onAnnounced={setAnnounced} onLatest={setLatest}/>
    <h3>Configuración y recuperación por SMS</h3>
    <label className="field"><span><input type="checkbox" checked={emptyAuth} onChange={e => setEmptyAuth(e.target.checked)}/> Confirmo que el plan y los campos APN guardados en este equipo no usan usuario ni contraseña.</span></label>
    <div className="command-card"><div><strong>1. Conserve primero la restauración</strong><code>{recovery ?? "Pendiente: contraseña SMS, lectura inicial y confirmación de autenticación APN"}</code>
      <small>Vuelve al destino y APN de la lectura inicial, con GPRS deshabilitado. Conserve este mensaje en su teléfono: cerrar esta pantalla pierde las lecturas.</small></div>
      <button type="button" disabled={!recovery} onClick={() => void copy("recovery")}>Copiar restauración</button></div>
    <label className="field"><span><input type="checkbox" checked={recoverySaved} disabled={!recovery} onChange={e => setSavedRecovery(e.target.checked ? recoveryKey : null)}/> Conservé el mensaje de restauración en mi teléfono.</span></label>
    {setupWindowUsable(setup, elapsed) ? <p role="status">Ventana de instalación disponible hasta {new Date(setup.window.expiresAt).toLocaleTimeString()} · {setup.window.remainingConnections} conexiones disponibles · {setup.window.destination.host}:{setup.window.destination.port} TCP.</p>
            : <p role="status">La ventana de recepción para este equipo aún no está disponible o venció. El SMS de conexión permanece bloqueado; la restauración conservada sigue disponible.</p>}
    <div className="command-card"><div><strong>2. Conecte durante la ventana disponible</strong><code>{connection ?? (capture?.received ? "Recepción comprobada: no repita el SMS de conexión" : "Pendiente: preparación y receptor comprobados")}</code>
      <small>Después del OK del equipo, consulte DB4 y conserve la respuesta. Copiar no confirma el envío ni la recepción en FOM. No se cambian reloj, intervalos, entradas ni salidas.</small></div>
      <button type="button" disabled={!connection} onClick={() => void copy("connection")}>Copiar conexión</button></div>
    {message ? <p role="status">{message}</p> : null}
    <p role="status">{configured ? "DB4 confirma el destino, APN y tipo TCP previstos; los demás campos visibles permanecen iguales." : "Pegue la respuesta DB4 posterior a la configuración para comprobar el destino, APN, tipo TCP y conservación de los demás campos."}</p>
    <h3>Recepción en FOM</h3>
    {capture?.received ? <div role="status"><strong>Trama conservada e identidad coincidente</strong>
      <p>La recepción pertenece a la ventana {capture.reference}. El reloj y las funciones siguen pendientes de cualificación; esto no activa el GPS.</p>
      {capture.messages.map(item => <div className="command-card" key={item.receiptId}><div><strong>{new Date(item.receivedAt).toLocaleString()} · {item.bytes} bytes · {item.records} registros</strong>
        <small>SHA-256 {item.sha256}</small></div></div>)}</div>
            : <p role="status">Esperando una trama interpretable de este equipo. Un SMS OK o una conexión TCP por sí solos no confirman la recepción coincidente.</p>}
    <p>El registro de inventario no activa el GPS. La recepción, el reloj y las funciones de la instalación deben comprobarse antes de ponerlo en servicio.</p>
  </section>;
}
