// FOM #727: portado desde fom-core f2a925b; conserva las guardas del recorrido TEST.
import { useEffect, useMemo, useState } from "react";
import { parseT399CommandList, t399ReadOnlyQuery } from "./commands.js";
import { MeitrackReadback } from "./MeitrackReadback";
export function MeitrackSmsPreparation({ password, imei = "", firmware = "", onBaseline, onAnnounced, onLatest }) {
    const [announcedText, setAnnouncedText] = useState("");
    const announced = useMemo(() => parseT399CommandList(announcedText), [announcedText]);
    useEffect(() => { onBaseline?.(null); onLatest?.(""); onAnnounced?.(announced ?? []); }, [announced, onAnnounced, onBaseline, onLatest]);
    const commands = [
        { command: "E91", title: "Consultar firmware", instruction: "Registre sólo la versión en Firmware; la respuesta completa contiene IMEI y número de serie." },
        { command: "E04", title: "Consultar comandos disponibles", instruction: "Copie abajo sólo los códigos que siguen a E04, sin IMEI. La lista corresponde a este equipo y firmware." },
        { command: "DB4", title: "Consultar parámetros actuales", instruction: "Conserve la respuesta original de forma privada. Esta lectura no es un respaldo integral ni prueba de restauración." },
        { command: "DA6", title: "Consultar conexión y colas pendientes", instruction: "Revise conexión y GPRS/SMS pendientes. Cero en esas colas no demuestra que toda la memoria esté vacía; los satélites no prueban posición ni reloj." },
    ];
    return <section className="config-stack" style={{ gridColumn: "1 / -1" }} aria-label="Preparación SMS Meitrack T399L">
    <div className="device-profile"><div><span>PERFIL DEL MODELO</span><strong>Meitrack T399L</strong>
      <small>Preparación por SMS · use la contraseña actual del equipo.</small></div></div>
    <p>Consulte primero firmware y comandos disponibles desde su teléfono. Estas consultas no cambian la configuración; copiar un mensaje no lo envía.</p>
    <label className="field"><span>Comandos anunciados por E04</span>
      <textarea value={announcedText} maxLength={2048} autoComplete="off" spellCheck={false} placeholder="A00,DB4,DA6,E91" onChange={event => setAnnouncedText(event.target.value)}/>
      <small>Introduzca sólo la lista de códigos, sin IMEI ni respuestas con parámetros o credenciales. Permanece en este navegador y se borra al cambiar de equipo, firmware o paso.</small>
    </label>
    {announced === null ? <p role="alert">Use códigos de tres caracteres separados por comas; no pegue la respuesta completa.</p> : null}
    {commands.map(({ command, title, instruction }, index) => {
            const query = t399ReadOnlyQuery(password, command, announced ?? []);
            const needsSupport = (command === "DB4" || command === "DA6") && !announced?.includes(command);
            return <div className="command-card" key={command}><span className="command-number">{String(index + 1).padStart(2, "0")}</span><div><strong>{title}</strong>
        <code>{query ?? (needsSupport ? `Pendiente: el equipo debe anunciar ${command} en E04` : "Introduzca la contraseña SMS de cuatro dígitos en Datos del GPS")}</code>
        <small>{instruction}</small>
      </div><button type="button" aria-label={`Copiar consulta ${command}`} disabled={query === null} onClick={() => { if (query)
                void navigator.clipboard.writeText(query); }}>Copiar</button></div>;
        })}
    {announced?.includes("DB4") ? <MeitrackReadback key={JSON.stringify([imei, firmware, announcedText])} imei={imei} firmware={firmware} onBaseline={onBaseline} onLatest={onLatest}/> : null}
    <p>Las respuestas SMS no confirman conexión con FOM ni compatibilidad física. La configuración de APN, destino, reloj e intervalos y la prueba de recepción requieren un procedimiento cualificado para la unidad. No utilice los mensajes ni el destino del perfil Coban.</p>
  </section>;
}
