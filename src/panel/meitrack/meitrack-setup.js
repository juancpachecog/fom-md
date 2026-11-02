// FOM #727: portado desde fom-core f2a925b; conserva las guardas del recorrido TEST.
import { parseT399ClosedReadback, parseT399TcpReadback } from "./meitrack-readback.js";
const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const keys = (v, list) => !!v && !Array.isArray(v) && Object.keys(v).length === list.length && list.every(k => Object.hasOwn(v, k));
export function parseSetupReadiness(raw) {
    if (!raw || typeof raw !== "object" || !keys(raw, ["setup"]))
        return null;
    const s = raw.setup;
    if (!s || !keys(s, ["ready", "reason", "serverNow", "activationAllowed", "window"]) || !iso(s.serverNow) || s.activationAllowed !== false)
        return null;
    if (s.ready === false)
        return s.reason === "not_ready" && s.window === null ? s : null;
    const w = s.window;
    if (s.ready !== true || s.reason !== null || !w || !keys(w, ["reference", "expiresAt", "firmware", "destination", "remainingConnections", "acknowledgementAllowed"])
        || typeof w.reference !== "string" || !/^issue\/727\/[a-z0-9][a-z0-9/_.-]{0,119}$/.test(w.reference)
        || !iso(w.expiresAt) || Date.parse(w.expiresAt) - Date.parse(s.serverNow) <= 90000 || Date.parse(w.expiresAt) - Date.parse(s.serverNow) > 3600000
        || w.firmware !== "T399L-V254" || !w.destination || !keys(w.destination, ["host", "port", "transport"])
        || w.destination.host !== "51.81.195.12" || w.destination.port !== 5002 || w.destination.transport !== "tcp"
        || !Number.isSafeInteger(w.remainingConnections) || w.remainingConnections < 1 || w.remainingConnections > 99 || w.acknowledgementAllowed !== false)
        return null;
    return s;
}
export function setupWindowUsable(s, elapsedMs) {
    return !!s?.ready && !!s.window && Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < 10000
        && Date.parse(s.window.expiresAt) - Date.parse(s.serverNow) - elapsedMs > 90000;
}
export function setupRecoverySms(password, baseline, imei, firmware, emptyAuth) {
    if (typeof password !== "string" || !/^[0-9]{4}$/.test(password) || !emptyAuth || !baseline || !Array.isArray(baseline.cells)
        || !parseT399ClosedReadback(baseline.cells.join(","), imei, firmware))
        return null;
    return `${password},A21,0,${baseline.cells[3].slice(4)},${baseline.cells[4].slice(6)},${baseline.cells[8]},,`;
}
const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function parseRegistrationWitness(raw) {
    if (!raw || typeof raw !== "object" || !keys(raw, ["registration"]))
        return null;
    const w = raw.registration;
    if (!w || !keys(w, ["state", "id", "activationAllowed"]) || w.activationAllowed !== false
        || !["unavailable", "absent", "matching", "conflict"].includes(w.state) || (w.state === "matching" ? !uuid(w.id) : w.id !== null))
        return null;
    return w;
}
/** An uncertain POST is followed only by reads. A retained attempt never issues
 * another write; an existing record must match actor, metadata and assignment. */
export async function registerMeitrackOnce(options) {
    let found = await options.lookup(), known = options.deviceId;
    if (found.state === "absent" && !options.attempted && !known) {
        options.retainAttempt(null);
        try {
            known = await options.create();
        }
        catch { /* Result uncertain; query independently. */ }
        if (known)
            options.retainAttempt(known);
        found = await options.lookup();
    }
    if (found.state !== "matching" || !uuid(found.id) || known && known !== found.id)
        return { state: found.state === "conflict" ? "conflict" : "pending", id: null };
    return { state: "confirmed", id: found.id };
}
export function setupConnectionSms(password, baseline, imei, firmware, apn, emptyAuth, recoverySaved, announced, readiness, elapsedMs) {
    if (!setupRecoverySms(password, baseline, imei, firmware, emptyAuth) || !recoverySaved || !announced.includes("A21") || !announced.includes("DB4")
        || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,99}$/.test(apn) || !setupWindowUsable(readiness, elapsedMs))
        return null;
    return `${password},A21,1,${readiness.window.destination.host},${readiness.window.destination.port},${apn},,`;
}
export function configuredT399Readback(raw, baseline, imei, firmware, apn, destination) {
    const actual = parseT399TcpReadback(raw, imei, firmware);
    if (!actual || !baseline || !destination || !parseT399ClosedReadback(baseline.cells.join(','), imei, firmware))
        return false;
    const expected = [...baseline.cells];
    expected[2] = 'TCP';
    expected[3] = `IP1:${destination.host}`;
    expected[4] = `PORT1:${destination.port}`;
    expected[8] = apn;
    return actual.cells.every((cell, index) => cell === expected[index]);
}
export function parseSetupCapture(raw, reference) {
    if (!raw || typeof raw !== "object" || !keys(raw, ["capture"]))
        return null;
    const c = raw.capture;
    if (!c || !keys(c, ["reference", "windowAvailable", "received", "messages", "activationAllowed"]) || c.activationAllowed !== false
        || c.reference !== reference || c.windowAvailable !== true || typeof c.received !== "boolean" || !Array.isArray(c.messages) || c.messages.length > 5
        || c.received !== (c.messages.length > 0))
        return null;
    const ids = new Set();
    for (const m of c.messages) {
        if (!m || !keys(m, ["receiptId", "receivedAt", "bytes", "sha256", "records", "identityMatches", "clockQualified"])
            || typeof m.receiptId !== "string" || !/^[1-9][0-9]{0,18}$/.test(m.receiptId) || ids.has(m.receiptId)
            || !iso(m.receivedAt) || !Number.isSafeInteger(m.bytes) || m.bytes < 1 || m.bytes > 16384
            || typeof m.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(m.sha256)
            || !Number.isSafeInteger(m.records) || m.records < 1 || m.records > 64 || m.identityMatches !== true || m.clockQualified !== false)
            return null;
        ids.add(m.receiptId);
    }
    return c;
}
