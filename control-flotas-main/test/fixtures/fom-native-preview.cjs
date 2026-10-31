/** Loopback-only, synthetic memory API for client/visual QA. No nominal credentials or database. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const id = n => `726f0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = value => JSON.parse(JSON.stringify(value));
const definition = (semanticKey, valueKind, unit, interpretationSupport, maxInstances = 1) => ({ semanticKey, definitionVersion: 1,
  valueKind, unit, dimension: semanticKey === 'navigation.speed' ? 'speed' : semanticKey === 'navigation.heading' ? 'angle' : null,
  maxInstances, direction: 'observation', hardwareSupport: interpretationSupport === 'implemented' ? 'unknown' : 'declared', interpretationSupport,
  requirements: [{ kind: 'evidence', reference: 'installation.function.test', resourceKey: null, mode: null }] });
const profiles = [
  { profileId: 'synthetic.coban', profileVersion: 1, manufacturer: 'Coban', model: 'Perfil sintético Coban', firmwareLabel: null,
    functions: [definition('navigation.heading', 'numeric', 'degree', 'implemented'), definition('navigation.speed', 'numeric', 'kph', 'implemented')], resources: [],
    nativeChannels: [{ semanticKey: 'navigation.heading', definitionVersion: 1, channel: 'gps.heading_deg' }, { semanticKey: 'navigation.speed', definitionVersion: 1, channel: 'gps.speed_kph' }] },
  { profileId: 'synthetic.meitrack', profileVersion: 1, manufacturer: 'Meitrack', model: 'Perfil sintético Meitrack', firmwareLabel: 'declarado, sin certificar',
    functions: [definition('door.open', 'boolean', 'none', 'not_implemented', 5), definition('ignition.acc', 'boolean', 'none', 'not_implemented'),
      definition('input.digital.active', 'boolean', 'none', 'not_implemented', 5), definition('input.voltage', 'numeric', 'volt', 'not_implemented', 2)],
    resources: [{ key: 'in1', channel: 'in1.digital', kind: 'digital', modes: ['digital_input'], exclusionGroup: 'pin1' }], nativeChannels: [] },
];
const paginate = (items, url) => {
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 25)));
  const offset = Math.min(10000, Math.max(0, Number(url.searchParams.get('offset') ?? 0)));
  const selected = items.slice(offset, offset + limit); return { items: selected, page: { limit, offset, count: selected.length, total: items.length } };
};
async function startFixture({ port = 5192, staticDir = path.resolve(__dirname, '../../.fom-preview-dev'), failFirstWrite = true } = {}) {
  const sessions = new Map(), refreshes = new Map(), selections = new Map(), receipts = new Map(), reports = new Map(), observations = new Map();
  const metrics = { fixtureOnly: true, loginAttempts: 0, configurationAttempts: 0, configurations: 0, reportAttempts: 0, reports: 0, replayWrites: 0, reportReads: 0, uncertainResponse: false };
  const devices = [
    { id: id(10), installationId: id(11), tenant: id(1), manufacturer: 'Coban', model: 'Coban · equipo sintético', vehicleCode: 'ENSAYO-01', assignmentState: 'installed' },
    { id: id(20), installationId: id(21), tenant: id(1), manufacturer: 'Meitrack', model: 'Meitrack · equipo sintético', vehicleCode: 'ENSAYO-02', assignmentState: 'installed' },
    { id: id(30), installationId: id(31), tenant: id(2), manufacturer: 'Coban', model: 'Coban · empresa B sintética', vehicleCode: 'ENSAYO-B', assignmentState: 'installed' },
  ];
  function configured(device, profile, version, choices) {
    return { assignmentId: device.installationId, isCurrent: true, installationVersion: version, profileId: profile.profileId, profileVersion: 1,
      items: [...choices].sort((a, b) => a.mapping.semanticKey.localeCompare(b.mapping.semanticKey) || a.mapping.instance - b.mapping.instance).map((choice, slot) => {
        const d = profile.functions.find(d => d.semanticKey === choice.mapping.semanticKey);
        return { ...d, ...clone(choice), functionId: `${version}-${slot + 1}`, instance: choice.mapping.instance,
          configurationStatus: 'requested', enabled: false, verification: 'pending', verificationSource: 'snapshot_pending', freshness: 'missing', lastObservation: null };
      }) };
  }
  const configurations = new Map(devices.map(device => {
    const profile = profiles.find(p => p.manufacturer === device.manufacturer);
    const choices = profile.nativeChannels.map(n => ({ selected: true, mapping: { semanticKey: n.semanticKey, definitionVersion: 1,
      instance: 1, source: 'native', channel: n.channel, inputUnit: n.semanticKey === 'navigation.speed' ? 'kph' : 'degree', polarity: 'not_applicable', scale: 1, offset: 0 } }));
    return [device.installationId, configured(device, profile, 1, choices)];
  }));
  function issue(session) {
    const accessToken = randomBytes(32).toString('base64url'), refreshToken = randomBytes(32).toString('base64url');
    sessions.set(accessToken, session); refreshes.set(refreshToken, { session, accessToken });
    return { tokenType: 'Bearer', accessToken, refreshToken, expiresAt: new Date(Date.now() + 900000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(), mustChangePassword: session.restricted };
  }
  const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
  const reject = (res, status) => json(res, status, { code: 'synthetic_rejection' });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/__fixture/status') { json(res, 200, metrics); return; }
      if (!url.pathname.startsWith('/api/v1/mobile/')) {
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index';
        const candidate = path.resolve(staticDir, relative);
        if (!candidate.startsWith(path.resolve(staticDir) + path.sep)) { reject(res, 404); return; }
        const file = [candidate, candidate + '.html'].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
        if (!file) { reject(res, 404); return; }
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }); fs.createReadStream(file).pipe(res); return;
      }
      const route = url.pathname.replace('/api/v1/mobile', '');
      let body = {}; if (req.method !== 'GET') {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) { reject(res, 413); return; } }
        if (raw) body = JSON.parse(raw);
      }
      if (route === '/auth/login' && req.method === 'POST') {
        metrics.loginAttempts++;
        if (!/^(manager|viewer|multi|initial)@fixture\.invalid$/.test(body.email) || body.password !== 'fixture-only-password') { reject(res, 401); return; }
        const session = { id: randomUUID(), userId: id(100), tenantId: id(1), role: body.email.startsWith('viewer') ? 'viewer' : 'supervisor', restricted: body.email.startsWith('initial'), revoked: false };
        if (body.email.startsWith('multi')) {
          const token = randomBytes(32).toString('base64url'); selections.set(token, session);
          json(res, 409, { code: 'tenant_selection_required', selectionToken: token, selectionExpiresAt: new Date(Date.now() + 300000).toISOString(),
            tenants: [{ id: id(1), name: 'Empresa A · sintética' }, { id: id(2), name: 'Empresa B · sintética' }] }); return;
        }
        json(res, 201, issue(session)); return;
      }
      if (route === '/auth/tenant-selection' && req.method === 'POST') {
        const session = selections.get(body.selectionToken);
        if (!session || ![id(1), id(2)].includes(body.selectedTenantId)) { reject(res, 401); return; }
        selections.delete(body.selectionToken); session.tenantId = body.selectedTenantId; json(res, 201, issue(session)); return;
      }
      if (route === '/auth/refresh' && req.method === 'POST') {
        const prior = refreshes.get(body.refreshToken); if (!prior || prior.session.revoked) { reject(res, 401); return; }
        refreshes.delete(body.refreshToken); sessions.delete(prior.accessToken); json(res, 200, issue(prior.session)); return;
      }
      const session = sessions.get(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (!session || session.revoked) { reject(res, 401); return; }
      if (route === '/auth/me') { json(res, 200, { user: { id: session.userId, displayName: 'Gestor sintético', email: 'fixture@fixture.invalid' },
        tenant: { id: session.tenantId, name: session.tenantId === id(1) ? 'Empresa A · sintética' : 'Empresa B · sintética', role: session.role },
        session: { id: session.id }, mustChangePassword: session.restricted }); return; }
      if (route === '/auth/logout') { session.revoked = true; json(res, 200, { revoked: true }); return; }
      if (route === '/auth/password' && session.restricted) { session.revoked = true; json(res, 200, { changed: true, authenticated: false }); return; }
      if (session.restricted || session.role !== 'supervisor') { reject(res, 403); return; }
      if (route === '/gps-devices/page') { json(res, 200, paginate(devices.filter(d => d.tenant === session.tenantId).map(({ tenant, ...d }) => d), url)); return; }
      if (route === '/gps-capability-catalog') {
        const manufacturer = url.searchParams.get('manufacturer');
        json(res, 200, paginate(profiles.filter(p => !manufacturer || p.manufacturer.toLowerCase() === manufacturer.trim().toLowerCase()), url)); return;
      }
      const profile = profiles.find(p => route === `/gps-capability-catalog/${p.profileId}/versions/1`);
      if (profile) { json(res, 200, profile); return; }
      const match = route.match(/^\/gps-installations\/([^/]+)\/functions(?:\/([^/]+)\/(observations|test-reports)(?:\/([^/]+))?)?$/);
      if (!match) { reject(res, 404); return; }
      const [, installation, functionId, resource, reportId] = match;
      const device = devices.find(d => d.installationId === installation && d.tenant === session.tenantId);
      if (!device) { reject(res, 404); return; }
      const config = configurations.get(installation); const item = config.items.find(i => i.functionId === functionId);
      if (req.method === 'GET') {
        if (!resource) { json(res, 200, config); return; }
        if (resource === 'test-reports') {
          const report = reports.get(reportId); metrics.reportReads++;
          if (!report || report.assignmentId !== installation || report.functionId !== functionId) { reject(res, 404); return; }
          json(res, 200, report); return;
        }
        if (!item) { reject(res, 404); return; }
        const key = `${installation}/${functionId}`;
        if (!observations.has(key)) observations.set(key, [0, 1].map(n => ({ observationId: randomUUID(), valueKind: item.valueKind, quality: 'valid',
          receivedAt: new Date(Date.now() - 5000 - n * 1000).toISOString(), observedAt: null, booleanValue: item.valueKind === 'boolean' ? n === 0 : null,
          numericValue: item.valueKind === 'numeric' ? n * 10 : null, enumValue: null })));
        const range = observations.get(key).filter(s => s.receivedAt >= url.searchParams.get('from') && s.receivedAt < url.searchParams.get('to'));
        json(res, 200, paginate(range, url)); return;
      }
      const configure = req.method === 'PUT' && !resource;
      const report = req.method === 'POST' && resource === 'test-reports' && !reportId;
      if (!configure && !report) { reject(res, 405); return; }
      if (configure) metrics.configurationAttempts++; else metrics.reportAttempts++;
      const key = req.headers['idempotency-key']; if (!/^[0-9a-f-]{36}$/i.test(key ?? '')) { reject(res, 400); return; }
      const scope = `${session.userId}/${session.tenantId}/${configure ? 'configure' : 'report'}/${key}`;
      const fingerprint = JSON.stringify({ installation, functionId, body });
      const prior = receipts.get(scope);
      if (prior) {
        if (prior.fingerprint !== fingerprint) { reject(res, 409); return; }
        metrics.replayWrites++; json(res, 200, { ...prior.receipt, ...(report ? { replayed: true } : {}) }); return;
      }
      let receipt;
      if (configure) {
        const chosen = profiles.find(p => p.profileId === body.profileId && p.profileVersion === body.profileVersion && p.manufacturer === device.manufacturer);
        if (!chosen || body.expectedVersion !== config.installationVersion || !Array.isArray(body.functions) || body.functions.length > 32) { reject(res, 409); return; }
        const version = config.installationVersion + 1; configurations.set(installation, configured(device, chosen, version, body.functions));
        receipt = { assignmentId: installation, version }; metrics.configurations++;
      } else {
        const available = observations.get(`${installation}/${functionId}`) ?? [];
        if (!item || !['pass', 'fail'].includes(body.result) || !Array.isArray(body.observationIds) || body.observationIds.length > 8
          || body.observationIds.some(id => !available.some(s => s.observationId === id))
          || (body.result === 'pass' && (!body.inspectionAttested || item.interpretationSupport !== 'implemented' || body.observationIds.length === 0))) { reject(res, 409); return; }
        const id = randomUUID(), recordedAt = new Date().toISOString();
        receipt = { assignmentId: installation, functionId, reportId: id, recordedAt, result: body.result, replayed: false };
        reports.set(id, { ...receipt, ...clone(body), source: 'operator_report' }); metrics.reports++;
        Object.assign(item, { verification: body.result, verificationSource: 'operator_report' });
      }
      receipts.set(scope, { fingerprint, receipt });
      if (failFirstWrite && !metrics.uncertainResponse) { metrics.uncertainResponse = true; json(res, 503, { code: 'synthetic_failure_after_storage' }); return; }
      json(res, 200, receipt);
    } catch { if (!res.headersSent) reject(res, 500); else res.end(); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}`, metrics, stop: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
module.exports = { startFixture };
if (require.main === module) startFixture().then(f => {
  console.log(`FIXTURE_ONLY=YES URL=${f.url} NO_NOMINAL_AUTH_OR_DATA=YES`);
  process.once('SIGINT', () => f.stop().then(() => process.exit(0))); process.once('SIGTERM', () => f.stop().then(() => process.exit(0)));
});
