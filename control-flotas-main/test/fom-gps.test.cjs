const { test } = require('node:test');
const assert = require('node:assert/strict');
const { addChoice, displayValue, GpsOperation, sameDeclaredManufacturer } = require('../.fom-test-build/gps.js');
const uuid = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const assignment = uuid(1); const functionId = '1-1';
const body = { result: 'fail', inspectionAttested: false, reasonCode: 'no_signal', observationIds: [] };
const receipt = { assignmentId: assignment, functionId, reportId: uuid(2), recordedAt: '2026-10-31T20:00:00Z', result: 'fail' };
const stored = { ...receipt, ...body, source: 'operator_report' };
test('a profile from another manufacturer or unknown metadata is not offered as this device profile', () => {
  const profile = { manufacturer: 'Coban' };
  assert.equal(sameDeclaredManufacturer(profile, ' cobAN '), true);
  assert.equal(sameDeclaredManufacturer(profile, 'Meitrack'), false);
  assert.equal(sameDeclaredManufacturer(profile, null), false);
});
test('uncertain mutation retries the same body/key, and after receipt only independent GET is repeated', async () => {
  const calls = []; let post = 0; let reads = 0;
  const client = { async request(path, init) {
    calls.push({ path, init });
    if (init?.method === 'POST') { post++; if (post === 1) throw Error('synthetic-response-lost-after-commit'); return receipt; }
    reads++; if (reads === 1) throw Error('synthetic-read-unavailable'); return stored;
  } };
  const original = structuredClone(body); const op = new GpsOperation(assignment, 'report', original, () => uuid(3), functionId);
  original.reasonCode = 'test_interrupted';
  await assert.rejects(() => op.run(client)); assert.equal(op.received, false);
  await assert.rejects(() => op.run(client)); assert.equal(op.received, true);
  await op.run(client);
  assert.equal(post, 2); assert.equal(reads, 2);
  const writes = calls.filter(c => c.init?.method === 'POST');
  assert.equal(writes[0].init.key, writes[1].init.key); assert.deepEqual(writes[0].init.body, body); assert.deepEqual(writes[1].init.body, body);
});
test('a later deliberate test gets its own key and record even with the same result', async () => {
  let i = 10;
  const first = new GpsOperation(assignment, 'report', body, () => uuid(i++), functionId);
  const second = new GpsOperation(assignment, 'report', body, () => uuid(i++), functionId);
  assert.notEqual(first.key, second.key); assert.deepEqual(first.body, second.body);
});
test('a receipt alone or a different function/sample/source never confirms a report', async () => {
  for (const delta of [{ functionId: '1-2' }, { observationIds: [uuid(99)] }, { source: 'physical_certification' }]) {
    const op = new GpsOperation(assignment, 'report', body, () => uuid(3), functionId);
    const client = { async request(_path, init) { return init ? receipt : { ...stored, ...delta }; } };
    await assert.rejects(() => op.run(client), e => e.code === 'report_witness_mismatch'); assert.equal(op.received, true);
  }
});
test('configuration GET must independently match version, profile, choices and mapping', async () => {
  const mapping = { semanticKey: 'door.open', definitionVersion: 1, instance: 1, source: 'io', channel: 'IN1', resourceKey: 'pin1', mode: 'digital_input', inputUnit: 'none', polarity: 'normal', scale: 1, offset: 0 };
  const proposal = { expectedVersion: 1, profileId: uuid(4), profileVersion: 1, functions: [{ selected: true, mapping }] };
  for (const changed of [false, true]) {
    const op = new GpsOperation(assignment, 'configure', proposal, () => uuid(3));
    const client = { async request(_path, init) { return init ? { assignmentId: assignment, version: 2 }
      : { assignmentId: assignment, installationVersion: 2, profileId: proposal.profileId, profileVersion: 1,
        items: [{ selected: true, mapping: { ...mapping, polarity: changed ? 'inverted' : 'normal' } }] }; } };
    if (changed) await assert.rejects(() => op.run(client), e => e.code === 'configuration_witness_mismatch');
    else assert.equal((await op.run(client)).installationVersion, 2);
  }
});
test('false, zero and absence have distinct displays; invalid quality has no usable value', () => {
  const empty = { quality: 'valid', booleanValue: null, numericValue: null, enumValue: null };
  assert.equal(displayValue(empty), 'Desconocido'); assert.equal(displayValue({ ...empty, booleanValue: false }), 'false');
  assert.equal(displayValue({ ...empty, numericValue: 0 }), '0'); assert.equal(displayValue({ ...empty, quality: 'contradictory', numericValue: 1 }), 'Sin valor utilizable');
});
test('two door instances keep separate channels/polarities; commands and exhausted slots are rejected', () => {
  const definition = { semanticKey: 'door.open', definitionVersion: 1, maxInstances: 2, valueKind: 'boolean', unit: 'none', direction: 'observation', hardwareSupport: 'declared', requirements: [] };
  const profile = { nativeChannels: [], resources: [{ key: 'out', channel: 'OUT1', kind: 'digital', modes: ['digital_output'] },
    { key: 'pin1', channel: 'IN1', kind: 'digital', modes: ['digital_input'] }] };
  const one = addChoice(profile, definition, []); const two = addChoice(profile, definition, [one]); two.mapping.channel = 'IN2'; two.mapping.resourceKey = 'pin2'; two.mapping.polarity = 'inverted';
  assert.equal(one.mapping.instance, 1); assert.equal(two.mapping.instance, 2); assert.equal(one.mapping.channel, 'IN1'); assert.equal(one.mapping.polarity, 'normal');
  assert.throws(() => addChoice(profile, definition, [one, two])); assert.throws(() => addChoice(profile, { ...definition, direction: 'command' }, []));
});
test('an IO requirement selects its exact declared pin instead of the first available input', () => {
  const definition = { semanticKey: 'ignition.acc', definitionVersion: 1, maxInstances: 1, valueKind: 'boolean', unit: 'none', direction: 'observation', hardwareSupport: 'declared',
    requirements: [{ kind: 'io', resourceKey: 'in2', mode: 'digital_input' }] };
  const profile = { nativeChannels: [], resources: [1, 2].map(n => ({ key: `in${n}`, channel: `IN${n}`, kind: 'digital', modes: ['digital_input'] })) };
  assert.equal(addChoice(profile, definition, []).mapping.resourceKey, 'in2');
  assert.throws(() => addChoice({ ...profile, resources: profile.resources.slice(0, 1) }, definition, []));
});
