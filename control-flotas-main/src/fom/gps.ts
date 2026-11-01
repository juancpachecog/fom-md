import { FomError, FomSession } from './session';
export interface PageMeta { limit: number; offset: number; count: number; total: number }
export interface Page<T> { items: T[]; page: PageMeta }
export interface Device { id: string; installationId: string | null; manufacturer: string | null; model: string; vehicleCode: string | null; assignmentState: string }
export interface Definition { semanticKey: string; definitionVersion: number; valueKind: string; unit: string; dimension: string | null;
  maxInstances: number; direction: string; hardwareSupport: string; interpretationSupport: string;
  requirements: { kind: string; reference: string | null; resourceKey: string | null; mode: string | null }[] }
export interface ProfileSummary { profileId: string; profileVersion: number; manufacturer: string; model: string; firmwareLabel: string | null }
export interface Resource { key: string; channel: string; kind: string; modes: string[]; exclusionGroup: string | null }
export interface Profile extends ProfileSummary { functions: Definition[]; resources: Resource[];
  nativeChannels: { channel: string; semanticKey: string; definitionVersion: number }[] }
export interface Mapping { semanticKey: string; definitionVersion: number; instance: number; source: 'native' | 'io'; channel: string;
  inputUnit: string; polarity: string; scale: number; offset: number; resourceKey?: string; mode?: string }
export interface Choice { selected: boolean; mapping: Mapping }
export interface Observation { quality: string; booleanValue: boolean | null; numericValue: number | null; enumValue: string | null;
  receivedAt: string; observedAt?: string | null; historicalOnly?: boolean; timeEvidenceCurrent?: boolean | null; commissioningEligible?: boolean }
export interface SavedFunction extends Definition, Choice { functionId: string; instance: number; configurationStatus: string;
  enabled: boolean; verification: string; verificationSource: string; freshness: string;
  freshnessBasis?: 'received_at' | 'observed_at' | 'unknown'; lastObservation: Observation | null }
export interface Configuration { assignmentId: string; isCurrent: boolean; installationVersion: number; profileId: string | null;
  profileVersion: number | null; items: SavedFunction[] }
export interface Sample extends Observation { observationId: string; observedAt: string | null; valueKind: string }
export interface ReportBody { result: 'pass' | 'fail'; inspectionAttested: boolean; reasonCode: string | null; observationIds: string[] }
export const profileKey = (p: ProfileSummary) => `${p.profileId}/${p.profileVersion}`;
export const sameDeclaredManufacturer = (profile: ProfileSummary, manufacturer: string | null) =>
  !!manufacturer?.trim() && profile.manufacturer.trim().toLowerCase() === manufacturer.trim().toLowerCase();
export const resourceOptions = (profile: Profile, definition: Definition) => profile.resources.filter(r =>
  (r.kind === 'serial' || r.kind === (definition.valueKind === 'numeric' ? 'analog' : 'digital'))
  && r.modes.some(mode => mode !== 'digital_output')
  && definition.requirements.filter(q => q.kind === 'io').every(q => q.resourceKey === r.key && r.modes.includes(q.mode ?? '')));
export const functionKey = (m: Pick<Mapping, 'semanticKey' | 'definitionVersion' | 'instance'>) => `${m.semanticKey}/${m.definitionVersion}/${m.instance}`;
export function displayValue(v: { quality: string; booleanValue: boolean | null; numericValue: number | null; enumValue: string | null }): string {
  if (v.quality !== 'valid') return 'Sin valor utilizable';
  return String(v.booleanValue ?? v.numericValue ?? v.enumValue ?? 'Desconocido');
}
const neutralObservation = (v: Observation) => v.observedAt != null || v.historicalOnly !== undefined
  || v.timeEvidenceCurrent !== undefined || v.commissioningEligible !== undefined;
/** The API decides eligibility; the report endpoint revalidates it at submission. */
export function sampleCanSupportTest(v: Sample): boolean {
  return !neutralObservation(v) || (v.historicalOnly === false && v.timeEvidenceCurrent === true && v.commissioningEligible === true);
}
export function selectedTestSamples(samples: Sample[], selected: string[]): string[] {
  return [...new Set(selected)].filter(id => samples.some(v => v.observationId === id && sampleCanSupportTest(v))).sort();
}
const utcTime = (v: string | null | undefined) => v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : 'no resuelto';
export function observationTime(v: Observation): string {
  const received = `Recepción: ${utcTime(v.receivedAt)}`;
  if (!neutralObservation(v)) return received;
  const evidence = v.timeEvidenceCurrent === true ? 'Prueba UTC vigente' : v.timeEvidenceCurrent === false
    ? 'Prueba UTC retirada o sin calificar' : 'Sin prueba UTC';
  return `Evento UTC: ${utcTime(v.observedAt)} · ${received} · ${evidence}${v.historicalOnly === true ? ' · Histórico' : ''}`;
}
export function latestObservationDescription(item: Pick<SavedFunction, 'lastObservation' | 'freshness' | 'freshnessBasis'>): string {
  const v = item.lastObservation;
  if (!v) return 'Sin observación comprobada. No se sustituye por cero ni apagado.';
  const neutral = neutralObservation(v);
  const current = item.freshness === 'fresh' && (!neutral || (item.freshnessBasis === 'observed_at' && v.timeEvidenceCurrent === true && v.historicalOnly === false));
  return `Último dato: ${displayValue(v)} · ${observationTime(v)} · ${current ? 'reciente' : 'no confirma el estado actual'}`;
}
export function addChoice(profile: Profile, definition: Definition, current: Choice[]): Choice {
  if (current.length >= 32 || definition.direction === 'command' || definition.hardwareSupport === 'unsupported') throw new FomError(400, 'function_unavailable');
  let instance = 1;
  while (current.some(c => c.mapping.semanticKey === definition.semanticKey && c.mapping.definitionVersion === definition.definitionVersion && c.mapping.instance === instance)) instance++;
  if (instance > definition.maxInstances) throw new FomError(400, 'instance_limit');
  const requiredIo = definition.requirements.find(q => q.kind === 'io');
  const native = !requiredIo ? profile.nativeChannels.find(c => c.semanticKey === definition.semanticKey && c.definitionVersion === definition.definitionVersion) : undefined;
  const resource = resourceOptions(profile, definition)[0];
  if (!native && (!resource || !resource.modes.some(m => m !== 'digital_output'))) throw new FomError(400, 'channel_unavailable');
  return { selected: true, mapping: { semanticKey: definition.semanticKey, definitionVersion: definition.definitionVersion, instance,
    source: native ? 'native' : 'io', channel: native?.channel ?? resource!.channel,
    inputUnit: definition.unit, scale: 1, offset: 0, polarity: definition.valueKind === 'boolean' ? 'normal' : 'not_applicable',
    ...(!native ? { resourceKey: resource!.key, mode: requiredIo?.mode ?? resource!.modes.find(m => m !== 'digital_output') } : {}) } };
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
const normalizedChoices = (items: Choice[]) => items.map(c => ({ selected: c.selected,
  mapping: { ...c.mapping, resourceKey: c.mapping.resourceKey ?? null, mode: c.mapping.mode ?? null } }))
  .sort((a, b) => functionKey(a.mapping).localeCompare(functionKey(b.mapping)));
export const definitiveRejection = (e: unknown) => e instanceof FomError && [400, 401, 403, 404, 409, 422, 429].includes(e.status);

/** One user operation: uncertainty preserves key/body; after receipt retries GET only. */
export class GpsOperation {
  private receipt: Record<string, unknown> | null = null;
  readonly body: unknown;
  readonly key: string;
  constructor(private assignmentId: string, private kind: 'configure' | 'report', body: unknown,
    createKey: () => string, private functionId?: string) {
    this.body = JSON.parse(JSON.stringify(body)); this.key = createKey();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(this.key)) throw new FomError(0, 'invalid_idempotency_key');
  }
  get received() { return this.receipt !== null; }
  async run(client: FomSession): Promise<Configuration | Record<string, unknown>> {
    const configPath = `/gps-installations/${encodeURIComponent(this.assignmentId)}/functions`;
    const path = this.kind === 'configure' ? configPath : `${configPath}/${encodeURIComponent(this.functionId!)}/test-reports`;
    if (!this.receipt) {
      const receipt = await client.request<Record<string, unknown>>(path, { method: this.kind === 'configure' ? 'PUT' : 'POST', body: this.body, key: this.key });
      if (receipt.assignmentId !== this.assignmentId || (this.kind === 'report' && (receipt.functionId !== this.functionId
        || typeof receipt.reportId !== 'string' || !/^[0-9a-f-]{36}$/i.test(receipt.reportId)
        || typeof receipt.recordedAt !== 'string' || !Number.isFinite(Date.parse(receipt.recordedAt))
        || receipt.result !== (this.body as ReportBody).result))
        || (this.kind === 'configure' && (!Number.isSafeInteger(receipt.version) || Number(receipt.version) < 1))) throw new FomError(0, 'receipt_mismatch');
      this.receipt = receipt;
    }
    if (this.kind === 'configure') {
      const body = this.body as { profileId: string; profileVersion: number; functions: Choice[] };
      const saved = await client.request<Configuration>(configPath);
      if (saved.assignmentId !== this.assignmentId || saved.installationVersion !== this.receipt.version
        || saved.profileId !== body.profileId || saved.profileVersion !== body.profileVersion
        || canonical(normalizedChoices(saved.items.map(i => ({ selected: i.selected, mapping: i.mapping })))) !== canonical(normalizedChoices(body.functions))) {
        throw new FomError(0, 'configuration_witness_mismatch');
      }
      return saved;
    }
    const body = this.body as ReportBody;
    const saved = await client.request<Record<string, unknown>>(`${path}/${encodeURIComponent(String(this.receipt.reportId))}`);
    if (saved.assignmentId !== this.assignmentId || saved.functionId !== this.functionId || saved.reportId !== this.receipt.reportId
      || saved.recordedAt !== this.receipt.recordedAt || saved.result !== body.result || saved.source !== 'operator_report'
      || saved.inspectionAttested !== body.inspectionAttested || saved.reasonCode !== body.reasonCode
      || !Array.isArray(saved.observationIds) || canonical([...saved.observationIds].sort()) !== canonical([...body.observationIds].sort())) {
      throw new FomError(0, 'report_witness_mismatch');
    }
    return saved;
  }
}
