import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useFom } from './provider';
import { FomError } from './session';
import { Button, Copy, Field, Page, message } from './ui';
import { addChoice, definitiveRejection, displayValue, functionKey, GpsOperation, profileKey, sameDeclaredManufacturer, resourceOptions,
  type Choice, type Configuration, type Definition, type Device, type Mapping, type Page as ApiPage,
  type Profile, type ProfileSummary, type ReportBody, type Sample, type SavedFunction } from './gps';

function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
    <Switch accessibilityLabel={label} value={value} onValueChange={onChange} disabled={disabled} /><Copy>{label}</Copy>
  </View>;
}
function Pager({ page, busy, change }: { page: ApiPage<unknown>['page']; busy: boolean; change: (offset: number) => void }) {
  return <View style={{ gap: 8 }}><Copy>{page.total} resultados · desde {page.offset + (page.count ? 1 : 0)} · {page.count} en esta página</Copy>
    <Button label="Página anterior" variant="secondary" disabled={busy || page.offset === 0} onPress={() => change(Math.max(0, page.offset - page.limit))} />
    <Button label="Página siguiente" variant="secondary" disabled={busy || page.offset + page.count >= page.total || page.offset + page.limit > 10000}
      onPress={() => change(page.offset + page.limit)} />
  </View>;
}
export function Workspace() {
  const { client, state, logout } = useFom();
  const [devices, setDevices] = useState<ApiPage<Device> | null>(null); const [selected, setSelected] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const load = useCallback(async (offset = 0) => {
    setBusy(true); setError('');
    try { setDevices(await client.request<ApiPage<Device>>(`/gps-devices/page?assignmentState=installed&limit=25&offset=${offset}`)); }
    catch (e) { setDevices(null); setError(message(e)); } finally { setBusy(false); }
  }, [client]);
  useEffect(() => { void load(); }, [load]); // This component is keyed by the server session.
  return <Page title="Funciones del GPS">
    <Copy>{state.identity?.user.displayName} · {state.identity?.tenant.name} · rol {state.identity?.tenant.role}</Copy>
    <Copy>Las funciones disponibles, configuradas, habilitadas y probadas se consultan por separado.</Copy>
    <Button label="Cerrar sesión" variant="secondary" onPress={() => void logout()} />
    {selected?.installationId ? <Installation key={selected.installationId} assignmentId={selected.installationId} manufacturer={selected.manufacturer}
      heading={`${selected.model} · ${selected.vehicleCode ?? 'vehículo sin código'}`} back={() => setSelected(null)} /> : <>
      <Button label="Consultar montajes instalados" variant="secondary" disabled={busy} onPress={() => void load()} />
      {busy && <Copy>Consultando…</Copy>}{error ? <Copy alert>{error}</Copy> : null}
      {devices?.items.map(device => <Button key={device.id} label={`${device.model} · ${device.vehicleCode ?? 'vehículo sin código'}`}
        disabled={busy || !device.installationId} onPress={() => setSelected(device)} />)}
      {devices && devices.items.length === 0 && <Copy>No hay montajes instalados disponibles para esta cuenta.</Copy>}
      {devices && <Pager page={devices.page} busy={busy} change={offset => void load(offset)} />}
    </>}
  </Page>;
}
function Installation({ assignmentId, heading, back, manufacturer }: { assignmentId: string; heading: string; back: () => void; manufacturer: string | null }) {
  const { client } = useFom();
  const [saved, setSaved] = useState<Configuration | null>(null); const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<ApiPage<ProfileSummary> | null>(null); const [choices, setChoices] = useState<Choice[]>([]);
  const [busy, setBusy] = useState(false); const [reporting, setReporting] = useState<string | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [nonce, setNonce] = useState(0);
  const operation = useRef<GpsOperation | null>(null); const flight = useRef(false); const [pending, setPending] = useState(false);
  const locked = busy || pending || reporting !== null;
  const declaredManufacturer = !!manufacturer?.trim();
  const profileMatches = profile ? sameDeclaredManufacturer(profile, manufacturer) : false;
  const catalog = useCallback(async (offset = 0) => {
    if (!manufacturer?.trim()) { setProfiles(null); return; }
    setBusy(true); setError('');
    try { const query = new URLSearchParams({ limit: '25', offset: String(offset), ...(manufacturer?.trim() ? { manufacturer: manufacturer.trim() } : {}) });
      setProfiles(await client.request<ApiPage<ProfileSummary>>(`/gps-capability-catalog?${query}`)); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }, [client, manufacturer]);
  const hydrateProfile = useCallback(async (summary: ProfileSummary, keep?: Configuration) => {
    const next = await client.request<Profile>(`/gps-capability-catalog/${encodeURIComponent(summary.profileId)}/versions/${summary.profileVersion}`);
    if (next.profileId !== summary.profileId || next.profileVersion !== summary.profileVersion) throw new FomError(0, 'profile_mismatch');
    setProfile(next); setChoices(keep ? keep.items.map(i => ({ selected: i.selected, mapping: { ...i.mapping } })) : []); setNonce(n => n + 1);
  }, [client]);
  const reload = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const current = await client.request<Configuration>(`/gps-installations/${encodeURIComponent(assignmentId)}/functions`);
      if (current.assignmentId !== assignmentId) throw new FomError(0, 'installation_mismatch');
      setSaved(current);
      if (current.profileId && current.profileVersion) await hydrateProfile({ profileId: current.profileId, profileVersion: current.profileVersion } as ProfileSummary, current);
      else { setProfile(null); setChoices([]); }
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }, [client, assignmentId, hydrateProfile]);
  useEffect(() => { void (async () => { await reload(); await catalog(); })(); }, [reload, catalog]);
  async function choose(summary: ProfileSummary) {
    setBusy(true); setError(''); setNotice('');
    try { await hydrateProfile(summary); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  function update(index: number, delta: Partial<Mapping>) {
    setChoices(rows => rows.map((row, i) => i === index ? { ...row, mapping: { ...row.mapping, ...delta } } : row));
  }
  async function save() {
    if (flight.current || reporting !== null || !saved || !profile || !saved.isCurrent || !profileMatches) return;
    if (!operation.current) {
      if (choices.some(c => !Number.isFinite(c.mapping.scale) || c.mapping.scale === 0 || Math.abs(c.mapping.scale) > 1e12
        || !Number.isFinite(c.mapping.offset) || Math.abs(c.mapping.offset) > 1e12)) { setError('Revise escalas y desplazamientos: deben ser finitos; la escala no puede ser cero.'); return; }
      try { operation.current = new GpsOperation(assignmentId, 'configure', { expectedVersion: saved.installationVersion,
        profileId: profile.profileId, profileVersion: profile.profileVersion, functions: choices }, () => Crypto.randomUUID()); }
      catch (e) { setError(message(e)); return; }
      setPending(true);
    }
    flight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const confirmed = await operation.current.run(client) as Configuration;
      operation.current = null; setPending(false); setSaved(confirmed);
      setChoices(confirmed.items.map(i => ({ selected: i.selected, mapping: { ...i.mapping } }))); setNonce(n => n + 1);
      setNotice('Configuración solicitada guardada y consultada aparte. No habilita ni acciona el equipo.');
    } catch (e) {
      if (!operation.current?.received && definitiveRejection(e)) { operation.current = null; setPending(false); }
      setError(message(e));
    } finally { flight.current = false; setBusy(false); }
  }
  return <View style={{ gap: 16 }}>
    <Copy>{heading}</Copy><Button label="Volver al inventario" variant="secondary" disabled={locked} onPress={back} />
    {error ? <Copy alert>{error}</Copy> : null}{notice ? <Copy>{notice}</Copy> : null}
    {pending && <Copy>El resultado sigue pendiente. Reintente esta misma solicitud; no se enviará otra escritura después de obtener el recibo.</Copy>}
    <Button label="Recargar configuración guardada" variant="secondary" disabled={locked} onPress={() => void reload()} />
    {saved && <Copy>Versión guardada: {saved.installationVersion} · {saved.isCurrent ? 'montaje vigente' : 'montaje retirado: sólo consulta'}</Copy>}
    <Copy>Perfil declarado</Copy>
    {!declaredManufacturer && <Copy>Falta declarar el fabricante en el inventario GPS. El historial guardado permanece disponible.</Copy>}
    {profile && !profileMatches && <Copy>El perfil guardado no coincide con el fabricante declarado. Seleccione el perfil correcto; se conserva el historial anterior.</Copy>}
    {profiles?.items.map(p => <Button key={profileKey(p)} label={`${p.manufacturer} · ${p.model} · versión ${p.profileVersion}`}
      variant="secondary" disabled={locked || !saved?.isCurrent} onPress={() => void choose(p)} />)}
    {profiles && <Pager page={profiles.page} busy={locked} change={offset => void catalog(offset)} />}
    {profile && profileMatches && <>
      <Copy>{profile.manufacturer} · {profile.model}. Firmware: {profile.firmwareLabel ?? 'desconocido'}. La selección no confirma cableado ni soporte físico.</Copy>
      {profile.functions.map(d => <Button key={`${d.semanticKey}/${d.definitionVersion}`} label={`Añadir ${d.semanticKey} · ${d.hardwareSupport === 'declared' ? 'compatibilidad declarada' : d.hardwareSupport === 'unsupported' ? 'no soportada' : 'compatibilidad desconocida'} · ${d.interpretationSupport === 'implemented' ? 'interpretada' : 'interpretación pendiente'}`}
        variant="secondary" disabled={locked || !saved?.isCurrent || d.direction === 'command' || d.hardwareSupport === 'unsupported' || choices.length >= 32}
        onPress={() => { try { setChoices([...choices, addChoice(profile, d, choices)]); setError(''); } catch (e) { setError(message(e)); } }} />)}
      <Copy>{choices.length}/32 funciones solicitadas</Copy>
      {choices.map((choice, index) => <MappingRow key={`${profileKey(profile)}/${nonce}/${functionKey(choice.mapping)}/${choice.mapping.inputUnit}`}
        choice={choice} definition={profile.functions.find(d => d.semanticKey === choice.mapping.semanticKey && d.definitionVersion === choice.mapping.definitionVersion)}
        profile={profile} disabled={locked || !saved?.isCurrent} update={delta => update(index, delta)}
        select={selected => setChoices(rows => rows.map((r, i) => i === index ? { ...r, selected } : r))}
        remove={() => setChoices(rows => rows.filter((_, i) => i !== index))} />)}
      <Button label={pending ? operation.current?.received ? 'Consultar guardado pendiente' : 'Reintentar guardado' : 'Guardar configuración solicitada'}
        disabled={busy || reporting !== null || !saved?.isCurrent} onPress={() => void save()} />
    </>}
    <Copy>Funciones guardadas · pruebas e historial</Copy>
    {saved?.items.map(item => <View key={item.functionId} style={{ gap: 12 }}>
      <Copy>{item.semanticKey} · instancia {item.instance}</Copy>
      <Copy>Configuración: {item.configurationStatus} · habilitada: {item.enabled ? 'sí' : 'no'} · prueba: {item.verification}
        {item.verificationSource === 'operator_report' ? ' (resultado declarado por gestor)' : ''}</Copy>
      <Copy>{item.lastObservation ? `Último dato: ${displayValue(item.lastObservation)} · ${item.freshness === 'fresh' ? 'reciente' : 'histórico: no confirma el estado actual'}`
        : 'Sin observación comprobada. No se sustituye por cero ni apagado.'}</Copy>
      <History assignmentId={assignmentId} item={item} canReport={saved.isCurrent} blocked={busy || pending || (reporting !== null && reporting !== item.functionId)}
        onPending={value => setReporting(value ? item.functionId : null)} onRecorded={() => { void reload(); }} />
    </View>)}
  </View>;
}
function MappingRow({ choice, definition, profile, disabled, update, select, remove }: {
  choice: Choice; definition?: Definition; profile: Profile; disabled: boolean; update: (delta: Partial<Mapping>) => void;
  select: (value: boolean) => void; remove: () => void;
}) {
  const mapping = choice.mapping;
  return <View style={{ gap: 10 }}><Copy>{mapping.semanticKey} · instancia {mapping.instance}</Copy>
    <Toggle label="Seleccionada" value={choice.selected} onChange={select} disabled={disabled} />
    <Copy>Canal: {mapping.channel} · unidad de entrada: {mapping.inputUnit}</Copy>
    {mapping.source === 'io' && definition && resourceOptions(profile, definition).map(r => <Button key={r.key} label={`Canal ${r.channel} · ${r.kind}`} variant="secondary" disabled={disabled}
        onPress={() => update({ resourceKey: r.key, channel: r.channel, mode: definition.requirements.find(q => q.kind === 'io')?.mode ?? r.modes.find(m => m !== 'digital_output') })} />)}
    {definition?.valueKind === 'boolean' && <Toggle label="Polaridad invertida" value={mapping.polarity === 'inverted'} disabled={disabled}
      onChange={value => update({ polarity: value ? 'inverted' : 'normal' })} />}
    {definition?.valueKind === 'numeric' && <>
      {definition.dimension === 'temperature' && ['celsius', 'fahrenheit'].map(unit => <Button key={unit} label={`Entrada ${unit}`} variant="secondary" disabled={disabled}
        onPress={() => update({ inputUnit: unit, scale: unit === 'fahrenheit' && definition.unit === 'celsius' ? 5 / 9 : unit === 'celsius' && definition.unit === 'fahrenheit' ? 9 / 5 : 1,
          offset: unit === 'fahrenheit' && definition.unit === 'celsius' ? -160 / 9 : unit === 'celsius' && definition.unit === 'fahrenheit' ? 32 : 0 })} />)}
      <Field label="Escala" defaultValue={String(mapping.scale)} editable={!disabled} keyboardType="numbers-and-punctuation"
        onChangeText={v => update({ scale: v.trim() ? Number(v) : NaN })} />
      <Field label="Desplazamiento" defaultValue={String(mapping.offset)} editable={!disabled} keyboardType="numbers-and-punctuation"
        onChangeText={v => update({ offset: v.trim() ? Number(v) : NaN })} />
      <Copy>Valor final en {definition.unit}: lectura × escala + desplazamiento.</Copy>
    </>}
    {definition?.requirements.map((r, i) => <Copy key={i}>Requisito: {r.kind} · {r.reference ?? r.resourceKey ?? 'pendiente'}</Copy>)}
    <Button label="Quitar de la solicitud" variant="secondary" disabled={disabled} onPress={remove} />
  </View>;
}
const quality: Record<string, string> = { valid: 'Válido', invalid: 'Tipo inválido', out_of_range: 'Fuera de rango', contradictory: 'Contradictorio', uncertain: 'Incierto', unknown: 'Desconocido' };
const reasons = [['no_signal', 'No se recibió señal'], ['unexpected_value', 'Valor inesperado'], ['wiring_unconfirmed', 'Cableado sin confirmar'],
  ['interpretation_missing', 'Interpretación no implementada'], ['test_interrupted', 'Prueba interrumpida']] as const;
function History({ assignmentId, item, canReport, blocked, onPending, onRecorded }: { assignmentId: string; item: SavedFunction; canReport: boolean;
  blocked: boolean; onPending: (value: boolean) => void; onRecorded: () => void }) {
  const { client } = useFom(); const [samples, setSamples] = useState<ApiPage<Sample> | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null); const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<'pass' | 'fail'>('fail'); const [attested, setAttested] = useState(false); const [reason, setReason] = useState('no_signal');
  const [busy, setBusy] = useState(false); const [pending, setPending] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const operation = useRef<GpsOperation | null>(null); const flight = useRef(false); const day = 86400000;
  const sequence = useRef(0);
  const locked = blocked || busy || pending;
  async function history(next: { from: string; to: string }, offset = 0) {
    const request = ++sequence.current;
    setBusy(true); setError(''); setSelected([]); setSamples(null); setRange(next);
    try { const data = await client.request<ApiPage<Sample>>(`/gps-installations/${encodeURIComponent(assignmentId)}/functions/${encodeURIComponent(item.functionId)}/observations?${new URLSearchParams({ ...next, offset: String(offset), limit: '10' })}`); if (request === sequence.current) setSamples(data); }
    catch (e) { if (request === sequence.current) setError(message(e)); } finally { if (request === sequence.current) setBusy(false); }
  }
  function shift(direction: number) { if (range) void history({ from: new Date(Date.parse(range.from) + direction * day).toISOString(), to: new Date(Date.parse(range.to) + direction * day).toISOString() }); }
  async function report() {
    if (flight.current || blocked || !canReport) return;
    if (!operation.current) {
      if (result === 'pass' && (!attested || selected.length === 0)) { setError('Confirme la inspección y seleccione muestras válidas de esta función.'); return; }
      const body: ReportBody = { result, inspectionAttested: attested, reasonCode: result === 'pass' ? null : reason, observationIds: [...selected].sort() };
      try { operation.current = new GpsOperation(assignmentId, 'report', body, () => Crypto.randomUUID(), item.functionId); }
      catch (e) { setError(message(e)); return; }
      setPending(true); onPending(true);
    }
    flight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await operation.current.run(client); operation.current = null; setPending(false); onPending(false);
      setNotice('Resultado declarado por el gestor, guardado y consultado aparte. La habilitación permanece separada.'); onRecorded();
    } catch (e) {
      if (!operation.current?.received && definitiveRejection(e)) { operation.current = null; setPending(false); onPending(false); }
      setError(message(e));
    } finally { flight.current = false; setBusy(false); }
  }
  return <View style={{ gap: 12 }}>
    <Button label="Consultar últimas 24 horas" variant="secondary" disabled={locked} onPress={() => { const now = Date.now(); void history({ from: new Date(now - day).toISOString(), to: new Date(now).toISOString() }); }} />
    {range && <><Copy>Recepción: {new Date(range.from).toLocaleString()} – {new Date(range.to).toLocaleString()} (fin exclusivo).</Copy>
      <Button label="Día anterior" variant="secondary" disabled={locked} onPress={() => shift(-1)} />
      <Button label="Día siguiente" variant="secondary" disabled={locked || Date.parse(range.to) + day > Date.now()} onPress={() => shift(1)} /></>}
    {samples && <><Copy>{samples.page.total} observaciones. Ausencia de datos no confirma cero ni apagado.</Copy>
      {samples.items.map(sample => <View key={sample.observationId} style={{ gap: 8 }}>
        <Copy>{new Date(sample.receivedAt).toLocaleString()} · {displayValue(sample)} · {quality[sample.quality] ?? 'Desconocido'}</Copy>
        {canReport && <Toggle label={`Seleccionar muestra de ${new Date(sample.receivedAt).toLocaleString()}`} value={selected.includes(sample.observationId)}
          disabled={locked || (!selected.includes(sample.observationId) && selected.length >= 8)}
          onChange={checked => setSelected(rows => checked ? [...rows, sample.observationId] : rows.filter(id => id !== sample.observationId))} />}
      </View>)}
      <Pager page={samples.page} busy={locked} change={offset => { if (range) void history(range, offset); }} />
    </>}
    {canReport && <>
      <Copy>Comunicar resultado de prueba. Conforme exige inspección y muestras válidas de los últimos 15 minutos; booleanos requieren ambos valores en recepciones distintas.</Copy>
      <Toggle label="Resultado conforme" value={result === 'pass'} disabled={locked} onChange={v => setResult(v ? 'pass' : 'fail')} />
      <Toggle label="Confirmo que realicé la inspección de esta función en este montaje" value={attested} disabled={locked} onChange={setAttested} />
      {result === 'fail' && reasons.map(([code, label]) => <Button key={code} label={`${reason === code ? 'Seleccionado: ' : ''}${label}`} variant="secondary" disabled={locked} onPress={() => setReason(code)} />)}
      <Copy>{selected.length}/8 muestras seleccionadas. Un reporte no acciona ni certifica físicamente el equipo.</Copy>
      {pending && <Copy>Resultado pendiente de comprobación. La misma solicitud conserva su clave y sus muestras.</Copy>}
      <Button label={pending ? operation.current?.received ? 'Consultar resultado pendiente' : 'Reintentar registro' : 'Registrar resultado declarado'} disabled={busy || blocked} onPress={() => void report()} />
    </>}
    {error ? <Copy alert>{error}</Copy> : null}{notice ? <Copy>{notice}</Copy> : null}
  </View>;
}
