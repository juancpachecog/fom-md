// FOM #727: portado desde fom-core f2a925b; conserva las guardas del recorrido TEST.
const literalIpv4 = (value) => /^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)
    && value.split(".").every(part => Number(part) <= 255);
const port = (value) => /^[1-9]\d{0,4}$/.test(value) && Number(value) <= 65535;
function parseReadback(raw, imei, firmware, connectionType) {
    if (typeof raw !== "string" || raw.length > 1024 || !/^[0-9]{15}$/.test(imei)
        || firmware !== "T399L-V254")
        return null;
    const text = raw.trim();
    if (/[\x00-\x1f\x7f]/.test(text))
        return null;
    const cells = text.split(",");
    if (cells.length !== 20 || cells[0] !== imei || cells[1] !== "DB4" || cells[2] !== connectionType
        || !cells[3].startsWith("IP1:") || !literalIpv4(cells[3].slice(4))
        || !cells[4].startsWith("PORT1:") || !port(cells[4].slice(6))
        || !cells[5].startsWith("IP2:") || !cells[6].startsWith("PORT2:")
        || cells[19] !== "")
        return null;
    const secondaryIp = cells[5].slice(4), secondaryPort = cells[6].slice(6);
    if ((secondaryIp === "") !== (secondaryPort === "")
        || (secondaryIp !== "" && (!literalIpv4(secondaryIp) || !port(secondaryPort)))
        || !/^[a-zA-Z0-9.-]{0,100}$/.test(cells[8])
        || [7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].some(index => !/^[0-9]{1,20}$/.test(cells[index])))
        return null;
    return Object.freeze({ cells: Object.freeze(cells) });
}
export const parseT399ClosedReadback = (raw, imei, firmware) => parseReadback(raw, imei, firmware, 'CLOSE');
/** TCP is the documented connection type, not proof of a network connection. */
export const parseT399TcpReadback = (raw, imei, firmware) => parseReadback(raw, imei, firmware, 'TCP');
/** Every visible cell participates, including the unqualified numeric tail.
 * Deliberately return labels, never device identity or raw values. */
export function compareT399ClosedReadbacks(before, after) {
    if (before.cells[0] !== after.cells[0])
        return null;
    const labels = new Set();
    for (let index = 1; index < before.cells.length; index++) {
        if (before.cells[index] === after.cells[index])
            continue;
        labels.add(index === 2 ? "Tipo de transporte GPRS" : index === 3 || index === 4 ? "Destino principal"
            : index === 5 || index === 6 ? "Destino secundario"
                : index === 8 ? "APN" : "Otros campos visibles");
    }
    return [...labels];
}
