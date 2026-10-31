const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FomSession, FomError, apiBase } = require('../.fom-test-build/session.js');
const base = 'https://fom.example.test';
const at = Date.parse('2026-10-31T20:00:00Z');
const tokens = (char = 'a', restricted = false) => ({ tokenType: 'Bearer', accessToken: char.repeat(43), refreshToken: char.toUpperCase().repeat(43),
  expiresAt: new Date(at + 900000).toISOString(), refreshExpiresAt: new Date(at + 86400000).toISOString(), mustChangePassword: restricted });
const identity = (restricted = false) => ({ user: { id: 'user-a', email: 'synthetic@example.test', displayName: 'Usuario sintético' },
  tenant: { id: 'tenant-a', name: 'Empresa sintética', role: 'supervisor' }, session: { id: 'session-a' }, mustChangePassword: restricted });
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function fixture(handler = () => null) {
  const storage = { value: null, async read() { return this.value; }, async write(v) { this.value = v; }, async clear() { this.value = null; } };
  const calls = []; let time = at;
  const http = async (url, init) => {
    const call = { path: new URL(url).pathname.replace('/api/v1/mobile', ''), init, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const custom = await handler(call, calls); if (custom) return custom;
    if (call.path === '/auth/login' || call.path === '/auth/tenant-selection') return reply(tokens());
    if (call.path === '/auth/me') return reply(identity());
    if (call.path === '/auth/logout') return reply({ revoked: true });
    return reply({ ok: true });
  };
  return { storage, calls, client: new FomSession(base, storage, http, () => time), time: value => { time = value; } };
}
test('only HTTPS origins and explicit loopback development HTTP; no credential/query fragments', () => {
  assert.equal(apiBase(base + '/'), base);
  for (const value of ['http://example.test', 'https://name:pass@example.test', base + '?token=x', base + '#fragment', 'not-a-url']) assert.throws(() => apiBase(value));
  assert.equal(apiBase('http://127.0.0.1:5192', true), 'http://127.0.0.1:5192');
  assert.throws(() => apiBase('http://10.20.30.10', true));
});
test('login confirms /me, derives role/tenant from server and persists one atomic pair without password', async () => {
  const f = fixture(); await f.client.signIn('synthetic@example.test', 'synthetic-only-password');
  assert.equal(f.client.state.phase, 'ready'); assert.equal(f.client.state.identity.tenant.id, 'tenant-a');
  assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['appVersion', 'deviceName', 'email', 'password', 'platform']);
  assert.equal(f.calls[0].init.headers.Authorization, undefined); assert.equal(f.calls[0].init.credentials, 'omit');
  assert.equal(f.calls[0].init.redirect, 'error'); assert.equal(f.calls[1].init.headers.Authorization, `Bearer ${tokens().accessToken}`);
  assert.deepEqual(JSON.parse(f.storage.value), { base, tokens: tokens() });
  assert.equal(f.storage.value.includes('synthetic-only-password'), false);
});

test('transport does not pass the session as receiver to a native browser fetch', async () => {
  const receivers = [];
  async function browserFetch(url) {
    'use strict';
    receivers.push(this);
    if (this !== undefined) throw new TypeError('Illegal invocation');
    return reply(url.endsWith('/auth/login') ? tokens() : identity());
  }
  const storage = { async read() { return null; }, async write() {}, async clear() {} };
  const client = new FomSession(base, storage, browserFetch, () => at);
  await client.signIn('synthetic@example.test', 'synthetic-only-password');
  assert.equal(client.state.phase, 'ready');
  assert.deepEqual(receivers, [undefined, undefined]);
});
test('multiempresa permits only challenge options, never resends password and rejects a consumed selection', async () => {
  const f = fixture(c => c.path === '/auth/login' ? reply({ code: 'tenant_selection_required', selectionToken: 'opaque-synthetic',
    selectionExpiresAt: new Date(at + 300000).toISOString(), tenants: [{ id: 'tenant-a', name: 'Empresa A' }] }, 409) : null);
  await f.client.signIn('synthetic@example.test', 'synthetic-only-password');
  assert.equal(f.client.state.phase, 'selection'); await assert.rejects(() => f.client.request('/gps-devices/page'));
  await assert.rejects(() => f.client.selectTenant('tenant-other')); assert.equal(f.calls.length, 1);
  await f.client.selectTenant('tenant-a');
  assert.deepEqual(f.calls.find(c => c.path === '/auth/tenant-selection').body, { selectionToken: 'opaque-synthetic', selectedTenantId: 'tenant-a' });
  await assert.rejects(() => f.client.selectTenant('tenant-a')); assert.equal(f.client.state.phase, 'ready');
});
test('restricted session cannot call GPS; initial password completion clears tokens and returns to login', async () => {
  const f = fixture(c => c.path === '/auth/login' ? reply(tokens('a', true)) : c.path === '/auth/me' ? reply(identity(true))
    : c.path === '/auth/password' ? reply({ changed: true, authenticated: false }) : null);
  await f.client.signIn('synthetic@example.test', 'synthetic-temporary');
  assert.equal(f.client.state.phase, 'restricted'); await assert.rejects(() => f.client.request('/gps-devices/page'));
  assert.equal(f.calls.some(c => c.path === '/gps-devices/page'), false);
  await f.client.changeInitialPassword('synthetic-temporary', 'new-synthetic-value');
  assert.equal(f.client.state.phase, 'signedOut'); assert.equal(f.storage.value, null);
});
test('an uncertain consumed tenant-selection challenge returns to login instead of hanging in restoring', async () => {
  const f = fixture(c => {
    if (c.path === '/auth/login') return reply({ code: 'tenant_selection_required', selectionToken: 'opaque-synthetic',
      selectionExpiresAt: new Date(at + 300000).toISOString(), tenants: [{ id: 'tenant-a', name: 'Empresa A' }] }, 409);
    if (c.path === '/auth/tenant-selection') throw Error('synthetic-connection-loss');
    return null;
  });
  await f.client.signIn('synthetic@example.test', 'synthetic-only-password');
  await assert.rejects(() => f.client.selectTenant('tenant-a'));
  assert.equal(f.client.state.phase, 'signedOut'); await assert.rejects(() => f.client.selectTenant('tenant-a'));
  assert.equal(f.calls.filter(c => c.path === '/auth/tenant-selection').length, 1);
});
test('concurrent calls share one rotation and use the newly stored pair', async () => {
  const f = fixture(async c => {
    if (c.path === '/auth/refresh') { await new Promise(resolve => setImmediate(resolve)); return reply(tokens('b')); }
    return null;
  });
  await f.client.signIn('synthetic@example.test', 'synthetic-only-password'); f.time(at + 880000);
  await Promise.all([f.client.request('/gps-devices/page'), f.client.request('/gps-capability-catalog')]);
  assert.equal(f.calls.filter(c => c.path === '/auth/refresh').length, 1);
  assert.equal(JSON.parse(f.storage.value).tokens.refreshToken, tokens('b').refreshToken);
  for (const c of f.calls.filter(c => c.path.startsWith('/gps-'))) assert.equal(c.init.headers.Authorization, `Bearer ${tokens('b').accessToken}`);
});
test('uncertain refresh is never replayed with the consumed token', async () => {
  const f = fixture(c => { if (c.path === '/auth/refresh') throw Error('synthetic-private-error-must-not-escape'); return null; });
  await f.client.signIn('synthetic@example.test', 'synthetic-only-password'); f.time(at + 880000);
  await assert.rejects(() => f.client.request('/gps-devices/page'), e => e instanceof FomError && !e.message.includes('synthetic-private'));
  assert.equal(f.client.state.phase, 'signedOut'); assert.equal(f.storage.value, null);
  await assert.rejects(() => f.client.request('/gps-devices/page'));
  assert.equal(f.calls.filter(c => c.path === '/auth/refresh').length, 1);
});
test('a late login after logout cannot revive the session or repersist tokens', async () => {
  let release; let entered; const started = new Promise(resolve => { entered = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  const f = fixture(c => { if (c.path === '/auth/login') { entered(); return delayed; } return null; });
  const login = f.client.signIn('synthetic@example.test', 'synthetic-only-password');
  await started; await f.client.signOut(); release(reply(tokens())); await assert.rejects(() => login);
  assert.equal(f.client.state.phase, 'signedOut'); assert.equal(f.storage.value, null);
});
test('concurrent login submissions retain only the last user operation', async () => {
  const f = fixture(); const first = f.client.signIn('first@example.test', 'synthetic-only-password');
  const second = f.client.signIn('second@example.test', 'synthetic-only-password');
  const results = await Promise.allSettled([first, second]);
  assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'fulfilled');
  assert.deepEqual(f.calls.filter(c => c.path === '/auth/login').map(c => c.body.email), ['second@example.test']);
});
test('restore rejects another environment and clears only its isolated storage entry', async () => {
  const f = fixture(); f.storage.value = JSON.stringify({ base: 'https://different.example.test', tokens: tokens() });
  f.storage.supabaseDemo = 'untouched'; await f.client.restore();
  assert.equal(f.client.state.phase, 'signedOut'); assert.equal(f.storage.value, null); assert.equal(f.storage.supabaseDemo, 'untouched');
  assert.equal(f.calls.length, 0);
});
test('permission denied does not refresh or turn a role into a manager', async () => {
  const f = fixture(c => c.path === '/gps-devices/page' ? reply({ message: 'private-untrusted-message' }, 403) : null);
  await f.client.signIn('synthetic@example.test', 'synthetic-only-password');
  await assert.rejects(() => f.client.request('/gps-devices/page'), e => e.status === 403 && e.message === 'request_rejected');
  assert.equal(f.calls.filter(c => c.path === '/auth/refresh').length, 0);
});
test('rotation cannot silently change user, session or tenant under an open screen', async () => {
  let refreshing = false;
  const f = fixture(c => {
    if (c.path === '/auth/refresh') { refreshing = true; return reply(tokens('b')); }
    if (c.path === '/auth/me' && refreshing) return reply({ ...identity(), tenant: { ...identity().tenant, id: 'tenant-other' } });
    return null;
  });
  await f.client.signIn('synthetic@example.test', 'synthetic-only-password'); f.time(at + 880000);
  await assert.rejects(() => f.client.request('/gps-devices/page'), e => e.code === 'identity_changed');
  assert.equal(f.client.state.phase, 'signedOut'); assert.equal(f.calls.some(c => c.path === '/gps-devices/page'), false);
});
test('logout still attempts remote revocation if local secure-storage deletion fails', async () => {
  const f = fixture(); await f.client.signIn('synthetic@example.test', 'synthetic-only-password');
  f.storage.clear = async () => { throw Error('synthetic-storage-failure'); };
  assert.equal(await f.client.signOut(), false); assert.equal(f.calls.filter(c => c.path === '/auth/logout').length, 1);
  assert.equal(f.client.state.phase, 'signedOut');
});

test('real loopback HTTP: session, manufacturer-specific inventory, uncertain configuration, exact report and independent logout read', async t => {
  const { startFixture } = require('./fixtures/fom-native-preview.cjs');
  const { GpsOperation } = require('../.fom-test-build/gps.js');
  const { randomUUID } = require('node:crypto');
  const f = await startFixture({ port: 0 }); t.after(() => f.stop());
  const storage = { value: null, async read() { return this.value; }, async write(v) { this.value = v; }, async clear() { this.value = null; } };
  const client = new FomSession(apiBase(f.url, true), storage);
  await client.signIn('manager@fixture.invalid', 'fixture-only-password');
  const devices = await client.request('/gps-devices/page?assignmentState=installed&limit=25&offset=0');
  const device = devices.items.find(d => d.manufacturer === 'Coban'); assert.notEqual(device.id, device.installationId);
  const page = await client.request('/gps-capability-catalog?manufacturer=Coban&limit=25&offset=0');
  assert.ok(page.items.length > 0 && page.items.every(p => p.manufacturer === 'Coban'));
  const before = await client.request(`/gps-installations/${device.installationId}/functions`);
  const op = new GpsOperation(device.installationId, 'configure', { expectedVersion: before.installationVersion,
    profileId: before.profileId, profileVersion: before.profileVersion, functions: before.items.map(i => ({ selected: i.selected, mapping: i.mapping })) }, randomUUID);
  await assert.rejects(() => op.run(client), e => e.status === 503);
  const confirmed = await op.run(client); assert.equal(confirmed.installationVersion, before.installationVersion + 1);
  const item = confirmed.items[0]; const range = new URLSearchParams({ from: new Date(Date.now() - 86400000).toISOString(), to: new Date().toISOString(), limit: '10', offset: '0' });
  const history = await client.request(`/gps-installations/${device.installationId}/functions/${item.functionId}/observations?${range}`);
  assert.ok(history.items.some(s => s.numericValue === 0));
  const report = new GpsOperation(device.installationId, 'report', { result: 'pass', inspectionAttested: true, reasonCode: null,
    observationIds: [history.items[0].observationId] }, randomUUID, item.functionId);
  assert.equal((await report.run(client)).source, 'operator_report');
  const after = await client.request(`/gps-installations/${device.installationId}/functions`);
  assert.equal(after.items[0].enabled, false); assert.equal(after.items[0].configurationStatus, 'requested');
  assert.equal(f.metrics.configurations, 1); assert.equal(f.metrics.configurationAttempts, 2); assert.equal(f.metrics.replayWrites, 1);
  assert.equal(f.metrics.reports, 1); assert.equal(f.metrics.reportReads, 1);
  assert.equal(await client.signOut(), true); assert.equal(storage.value, null);
});
test('real HTTP denies viewer data and rejects a foreign installation after explicit company selection', async t => {
  const { startFixture } = require('./fixtures/fom-native-preview.cjs');
  const f = await startFixture({ port: 0, failFirstWrite: false }); t.after(() => f.stop());
  const storage = { async read() { return null; }, async write() {}, async clear() {} };
  const client = new FomSession(apiBase(f.url, true), storage);
  await client.signIn('viewer@fixture.invalid', 'fixture-only-password');
  await assert.rejects(() => client.request('/gps-devices/page'), e => e.status === 403);
  await client.signIn('multi@fixture.invalid', 'fixture-only-password');
  await client.selectTenant(client.state.selection.tenants[1].id);
  const inventory = await client.request('/gps-devices/page'); assert.equal(inventory.items.length, 1);
  assert.equal(inventory.items[0].vehicleCode, 'ENSAYO-B');
  await assert.rejects(() => client.request('/gps-installations/726f0000-0000-4000-8000-000000000011/functions'), e => e.status === 404);
});
