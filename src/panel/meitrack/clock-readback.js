import {parseT399TcpReadback} from './meitrack-readback.js'
export async function clockReadbackReceipt(raw,imei,firmware,observedAt) {
  const parsed=parseT399TcpReadback(raw,imei,firmware),at=new Date(observedAt)
  if(!parsed || parsed.cells[7]!=='0' || !Number.isFinite(at.getTime()) || at.getTime()>Date.now()) return null
  const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('')
  return {schema:'fom.t399.db4-observation.v1',identitySha256:await hash(imei),firmware,
    protocolFamily:'meitrack-t399',readbackSha256:await hash(raw.trim()),gprsOffsetMinutes:0,
    observedAt:at.toISOString(),status:'owner_review_required',issuesAttestation:false}
}
