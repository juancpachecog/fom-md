// FOM #727: portado desde fom-core f2a925b; conserva las guardas del recorrido TEST.
import { useState } from "react";
import { compareT399ClosedReadbacks, parseT399ClosedReadback, parseT399TcpReadback } from "./meitrack-readback.js";
export function MeitrackReadback({ imei, firmware, onBaseline, onLatest }) {
    const [initialText, setInitialText] = useState("");
    const [baseline, setBaseline] = useState(null);
    const [laterText, setLaterText] = useState("");
    const initial = parseT399ClosedReadback(initialText, imei, firmware);
    const later = parseT399ClosedReadback(laterText, imei, firmware) ?? parseT399TcpReadback(laterText, imei, firmware);
    const changes = baseline && later ? compareT399ClosedReadbacks(baseline, later) : null;
    const eligible = /^[0-9]{15}$/.test(imei) && firmware === "T399L-V254";
    return <section className="config-stack" aria-label="Comparación de parámetros Meitrack">
    <h3>Conservar y comprobar las lecturas DB4</h3>
    <p>Las respuestas permanecen sólo en memoria de esta pantalla. No se envían a FOM ni se guardan con el borrador. Conserve también los SMS originales en su teléfono.</p>
    {!eligible ? <p role="status">Introduzca el IMEI del equipo y su firmware observado. La comparación disponible corresponde al formato T399L-V254 con GPRS en CLOSE; otra versión requiere revisión.</p> : null}
    <label className="field"><span>Respuesta DB4 inicial</span>
      <textarea value={initialText} disabled={!eligible || baseline !== null} maxLength={1024} autoComplete="off" spellCheck={false} onChange={event => setInitialText(event.target.value)}/>
      <small>Pegue únicamente el SMS DB4 de este equipo. No introduzca contraseñas.</small>
    </label>
    {initialText && !initial ? <p role="alert">La lectura inicial no coincide con el equipo, firmware o formato disponible. No se ha conservado como referencia.</p> : null}
    <button type="button" disabled={!initial || baseline !== null} onClick={() => { if (initial) {
        setBaseline(initial);
        onBaseline?.(initial);
    } }}>Conservar lectura inicial</button>
    {baseline ? <>
      <p role="status">Referencia conservada para este equipo. Una lectura posterior no sustituye la inicial.</p>
      <label className="field"><span>Respuesta DB4 posterior</span>
        <textarea value={laterText} maxLength={1024} autoComplete="off" spellCheck={false} onChange={event => { setLaterText(event.target.value); onLatest?.(event.target.value); }}/>
      </label>
      {laterText && !later ? <p role="alert">No se puede comparar esta respuesta: revise equipo, formato y tipo CLOSE o TCP. La referencia inicial se conserva.</p> : null}
      {changes ? <p role="status">{changes.length === 0
                    ? "La configuración visible coincide con la lectura inicial."
                    : `Campos modificados respecto a la lectura inicial: ${changes.join(", ")}.`}</p> : null}
      <button type="button" onClick={() => { setBaseline(null); setInitialText(""); setLaterText(""); onBaseline?.(null); onLatest?.(""); }}>Descartar lecturas de esta pantalla</button>
    </> : null}
    <p>La comparación incluye todos los campos visibles, sin deducir unidades de los campos adicionales. DB4 no demuestra las credenciales APN ni un respaldo integral. Coincidir con la referencia no confirma conexión con FOM, entrega de un SMS ni activación del GPS.</p>
  </section>;
}
