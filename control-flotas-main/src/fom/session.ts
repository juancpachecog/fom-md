/** FOM-only transport/session. No imports from demo services or Supabase. */
export interface Tokens {
  tokenType: 'Bearer'; accessToken: string; refreshToken: string;
  expiresAt: string; refreshExpiresAt: string; mustChangePassword: boolean;
}
export interface Identity {
  user: { id: string; email: string; displayName: string };
  tenant: { id: string; name: string; role: string };
  session: { id: string }; mustChangePassword: boolean;
}
export interface Selection { selectionToken: string; selectionExpiresAt: string; tenants: { id: string; name: string }[] }
export type SessionState = { phase: 'signedOut' | 'restoring' | 'selection' | 'restricted' | 'ready' | 'unavailable';
  identity: Identity | null; selection: Selection | null };
export interface TokenStorage { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }
export class FomError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
const initial = (): SessionState => ({ phase: 'signedOut', identity: null, selection: null });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
export function validTokens(v: unknown): v is Tokens {
  return record(v) && v.tokenType === 'Bearer' && text(v.accessToken) && /^[A-Za-z0-9_-]{43,171}$/.test(v.accessToken)
    && text(v.refreshToken) && /^[A-Za-z0-9_-]{43,171}$/.test(v.refreshToken)
    && text(v.expiresAt) && Number.isFinite(Date.parse(v.expiresAt))
    && text(v.refreshExpiresAt) && Number.isFinite(Date.parse(v.refreshExpiresAt)) && typeof v.mustChangePassword === 'boolean';
}
function validIdentity(v: unknown): v is Identity {
  return record(v) && record(v.user) && text(v.user.id) && text(v.user.displayName) && text(v.user.email)
    && record(v.tenant) && text(v.tenant.id) && text(v.tenant.name) && text(v.tenant.role)
    && record(v.session) && text(v.session.id) && typeof v.mustChangePassword === 'boolean';
}
export function apiBase(raw: string, allowLoopbackHttp = false): string {
  try {
    const u = new URL(raw);
    if (u.username || u.password || u.search || u.hash || (u.protocol !== 'https:'
      && !(allowLoopbackHttp && u.protocol === 'http:' && ['127.0.0.1', 'localhost', '10.0.2.2'].includes(u.hostname)))) throw Error();
    return u.toString().replace(/\/$/, '');
  } catch { throw new FomError(0, 'configuration_required'); }
}
export class FomSession {
  state: SessionState = initial();
  private tokens: Tokens | null = null;
  private epoch = 0;
  private refreshing: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private persistence: Promise<void> = Promise.resolve();
  constructor(readonly base: string, private storage: TokenStorage, private http: typeof fetch = fetch,
    private now: () => number = Date.now, private platform = 'android') {}
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private publish(state: SessionState) { this.state = state; this.listeners.forEach(fn => fn()); }
  private assertEpoch(epoch: number) { if (epoch !== this.epoch) throw new FomError(0, 'session_changed'); }
  private persist(action: () => Promise<void>): Promise<void> {
    const next = this.persistence.catch(() => {}).then(action);
    this.persistence = next; return next;
  }
  private async invalidate(): Promise<void> {
    ++this.epoch; this.tokens = null; this.refreshing = null; this.publish(initial());
    await this.persist(() => this.storage.clear());
  }
  private async wire(path: string, init: { method?: string; body?: unknown; key?: string } = {}, token?: string): Promise<{ status: number; value: unknown }> {
    if (!this.base) throw new FomError(0, 'configuration_required');
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || path.includes('#')) throw new FomError(0, 'invalid_path');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
    try {
      // A stored browser fetch must not receive FomSession as its native receiver.
      const http = this.http;
      const response = await http(`${this.base}/api/v1/mobile${path}`, {
        method: init.method ?? 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.key ? { 'Idempotency-Key': init.key } : {}) },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      const value: unknown = await response.json().catch(() => null);
      return { status: response.status, value };
    } catch { throw new FomError(0, 'connection_uncertain'); }
    finally { clearTimeout(timer); }
  }
  private check(response: { status: number; value: unknown }): unknown {
    if (response.status < 200 || response.status >= 300) throw new FomError(response.status, 'request_rejected');
    return response.value;
  }
  private async accept(value: unknown, epoch: number, expectedIdentity?: Identity | null): Promise<void> {
    if (!validTokens(value)) throw new FomError(0, 'invalid_session_response');
    this.assertEpoch(epoch);
    const tokens = value;
    await this.persist(async () => { this.assertEpoch(epoch); await this.storage.write(JSON.stringify({ base: this.base, tokens })); });
    this.assertEpoch(epoch); this.tokens = tokens;
    const identity = this.check(await this.wire('/auth/me', {}, tokens.accessToken));
    this.assertEpoch(epoch);
    if (!validIdentity(identity)) throw new FomError(0, 'invalid_identity_response');
    if (expectedIdentity && (identity.user.id !== expectedIdentity.user.id || identity.tenant.id !== expectedIdentity.tenant.id
      || identity.session.id !== expectedIdentity.session.id)) throw new FomError(0, 'identity_changed');
    this.publish({ phase: tokens.mustChangePassword || identity.mustChangePassword ? 'restricted' : 'ready', identity, selection: null });
  }
  private async receiveAuth(path: string, body: unknown, epoch: number): Promise<void> {
    const response = await this.wire(path, { method: 'POST', body }); this.assertEpoch(epoch);
    if (response.status === 409 && record(response.value) && response.value.code === 'tenant_selection_required') {
      const v = response.value;
      if (!text(v.selectionToken) || !text(v.selectionExpiresAt) || !Number.isFinite(Date.parse(v.selectionExpiresAt)) || Date.parse(v.selectionExpiresAt) <= this.now()
        || !Array.isArray(v.tenants) || v.tenants.length === 0
        || v.tenants.some(t => !record(t) || !text(t.id) || !text(t.name))) throw new FomError(409, 'invalid_selection');
      this.publish({ phase: 'selection', identity: null, selection: v as unknown as Selection }); return;
    }
    try { await this.accept(this.check(response), epoch); }
    catch (error) { if (epoch === this.epoch) await this.invalidate(); throw error; }
  }
  async signIn(email: string, password: string): Promise<void> {
    const clearing = this.invalidate(); const epoch = this.epoch;
    await clearing; this.assertEpoch(epoch);
    await this.receiveAuth('/auth/login', { email, password, platform: this.platform, deviceName: 'App FOM', appVersion: '1.0.0' }, epoch);
  }
  async selectTenant(id: string): Promise<void> {
    const selection = this.state.selection;
    if (!selection || !selection.tenants.some(t => t.id === id) || Date.parse(selection.selectionExpiresAt) <= this.now()) {
      throw new FomError(409, 'selection_expired');
    }
    const epoch = this.epoch;
    this.publish({ ...initial(), phase: 'restoring' });
    try { await this.receiveAuth('/auth/tenant-selection', { selectionToken: selection.selectionToken, selectedTenantId: id }, epoch); }
    catch (error) { if (epoch === this.epoch) await this.invalidate(); throw error; }
  }
  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const epoch = this.epoch; const current = this.tokens; const expectedIdentity = this.state.identity;
    if (!current || Date.parse(current.refreshExpiresAt) <= this.now()) { await this.invalidate(); throw new FomError(401, 'session_expired'); }
    const operation = (async () => {
      try { await this.accept(this.check(await this.wire('/auth/refresh', { method: 'POST', body: { refreshToken: current.refreshToken } })), epoch, expectedIdentity); }
      catch (error) { if (epoch === this.epoch) await this.invalidate(); throw error; }
    })();
    this.refreshing = operation;
    try { await operation; } finally { if (this.refreshing === operation) this.refreshing = null; }
  }
  async restore(): Promise<void> {
    const epoch = ++this.epoch; this.tokens = null;
    this.publish({ ...initial(), phase: 'restoring' });
    try {
      await this.persistence.catch(() => {}); this.assertEpoch(epoch);
      const raw = await this.storage.read(); this.assertEpoch(epoch);
      if (!raw) { this.publish(initial()); return; }
      const saved: unknown = JSON.parse(raw);
      if (!record(saved) || saved.base !== this.base || !validTokens(saved.tokens)
        || Date.parse(saved.tokens.refreshExpiresAt) <= this.now()) { await this.invalidate(); return; }
      this.tokens = saved.tokens;
      if (Date.parse(saved.tokens.expiresAt) <= this.now() + 30000) { await this.refresh(); return; }
      const response = await this.wire('/auth/me', {}, saved.tokens.accessToken); this.assertEpoch(epoch);
      if (response.status === 401) { await this.refresh(); return; }
      const identity = this.check(response);
      if (!validIdentity(identity)) throw new FomError(0, 'invalid_identity_response');
      this.publish({ phase: saved.tokens.mustChangePassword || identity.mustChangePassword ? 'restricted' : 'ready', identity, selection: null });
    } catch (error) {
      if (epoch !== this.epoch) return;
      if (error instanceof SyntaxError) { await this.invalidate(); return; }
      this.tokens = null; this.publish({ ...initial(), phase: 'unavailable' });
    }
  }
  async request<T>(path: string, init: { method?: string; body?: unknown; key?: string } = {}): Promise<T> {
    const epoch = this.epoch;
    if (!this.tokens || this.state.phase !== 'ready') throw new FomError(401, 'session_required');
    if (Date.parse(this.tokens.expiresAt) <= this.now() + 30000) await this.refresh();
    this.assertEpoch(epoch);
    if (!this.tokens || this.state.phase !== 'ready') throw new FomError(403, 'password_change_required');
    let response = await this.wire(path, init, this.tokens.accessToken); this.assertEpoch(epoch);
    if (response.status === 401) {
      await this.refresh(); this.assertEpoch(epoch);
      if (!this.tokens || this.state.phase !== 'ready') throw new FomError(401, 'session_required');
      response = await this.wire(path, init, this.tokens.accessToken); this.assertEpoch(epoch);
      if (response.status === 401) await this.invalidate();
    }
    return this.check(response) as T;
  }
  async changeInitialPassword(currentPassword: string, newPassword: string): Promise<void> {
    if (!this.tokens || this.state.phase !== 'restricted') throw new FomError(403, 'restricted_session_required');
    const epoch = this.epoch;
    let response: { status: number; value: unknown };
    try { response = await this.wire('/auth/password', { method: 'POST', body: { currentPassword, newPassword } }, this.tokens.accessToken); }
    catch (error) { if (epoch === this.epoch) await this.invalidate(); throw error; }
    this.assertEpoch(epoch);
    if (response.status === 200 && record(response.value) && response.value.changed === true && response.value.authenticated === false) {
      await this.invalidate(); return;
    }
    if (response.status === 401 || response.status >= 500) await this.invalidate();
    this.check(response); throw new FomError(0, 'invalid_password_response');
  }
  async signOut(): Promise<boolean> {
    const token = this.tokens?.accessToken;
    let cleared = true;
    try { await this.invalidate(); } catch { cleared = false; }
    if (!token) return cleared;
    try {
      const response = await this.wire('/auth/logout', { method: 'POST' }, token);
      if (response.status !== 200 || !record(response.value) || response.value.revoked !== true) return false;
      const witness = await this.wire('/auth/me', {}, token);
      return cleared && witness.status === 401;
    }
    catch { return false; }
  }
}
