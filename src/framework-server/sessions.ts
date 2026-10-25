import { ApiError, SessionRevokedError } from "./contracts.js";
import type { Unsubscribe } from "./socket.js";

export interface SessionRecord<T = unknown> {
  id: string;
  /** Stable opaque lineage for atomic revocation after one or more rotations. */
  familyId?: string;
  csrfToken: string;
  data: T;
  createdAt: number;
  expiresAt: number;
}

export interface SessionStore<T = unknown> {
  /** Explicitly acknowledge that records survive application process restarts. */
  readonly persistent?: boolean;
  get(id: string): Promise<SessionRecord<T> | undefined>;
  set(record: SessionRecord<T>): Promise<void>;
  delete(id: string): Promise<void>;
  /** Atomically replace an existing id; false means it no longer exists. */
  replace?(previousId: string, record: SessionRecord<T>): Promise<boolean>;
  /** Atomically revoke the currently active id in this family, even from a stale handle. */
  revokeFamily?(familyId: string): Promise<void>;
  /**
   * Notifies `revokeFamily` calls from every instance sharing the store, so
   * in-flight requests and live sockets of that family stop. Resolves once
   * notifications are flowing.
   */
  subscribeRevocations?(listener: (familyId: string) => void): Unsubscribe | Promise<Unsubscribe>;
  close?(): Promise<void>;
}

export class MemorySessionStore<T = unknown> implements SessionStore<T> {
  readonly developmentOnly = true;
  readonly persistent = false;
  private readonly records = new Map<string, SessionRecord<T>>();
  private readonly families = new Map<string, string>();
  private readonly revocationListeners = new Set<(familyId: string) => void>();
  async get(id: string): Promise<SessionRecord<T> | undefined> {
    const record = this.records.get(id);
    if (record && record.expiresAt <= Date.now()) {
      await this.delete(id);
      return undefined;
    }
    if (record && this.families.get(record.familyId ?? record.id) !== id) return undefined;
    return record;
  }
  async set(record: SessionRecord<T>): Promise<void> {
    const familyId = record.familyId ?? record.id;
    const existing = this.records.get(record.id);
    if (existing && (existing.familyId ?? existing.id) !== familyId) throw new Error("Session id cannot change family");
    const active = this.families.get(familyId);
    if (active && active !== record.id) throw new Error("Session family already has an active id");
    this.records.set(record.id, { ...record, familyId });
    this.families.set(familyId, record.id);
  }
  async delete(id: string): Promise<void> {
    const record = this.records.get(id);
    this.records.delete(id);
    if (record && this.families.get(record.familyId ?? record.id) === id) this.families.delete(record.familyId ?? record.id);
  }
  async replace(previousId: string, record: SessionRecord<T>): Promise<boolean> {
    const previous = this.records.get(previousId);
    if (!previous || previous.expiresAt <= Date.now()) {
      await this.delete(previousId);
      return false;
    }
    const familyId = previous.familyId ?? previous.id;
    if (record.familyId !== familyId || this.families.get(familyId) !== previousId) return false;
    this.records.set(record.id, record);
    this.families.set(familyId, record.id);
    this.records.delete(previousId);
    return true;
  }
  async revokeFamily(familyId: string): Promise<void> {
    const active = this.families.get(familyId);
    if (active) this.records.delete(active);
    this.families.delete(familyId);
    for (const listener of [...this.revocationListeners]) {
      try { listener(familyId); }
      catch (error) { console.error("[meeko] Session revocation listener failed", error); }
    }
  }
  /** Notifies managers sharing this store within the same process. */
  subscribeRevocations(listener: (familyId: string) => void): Unsubscribe {
    this.revocationListeners.add(listener);
    return () => { this.revocationListeners.delete(listener); };
  }
  async close(): Promise<void> { this.records.clear(); this.families.clear(); }
}

export interface SessionOptions<T> {
  store: SessionStore<T>;
  production?: boolean;
  ttlMs?: number;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  cookieName?: string;
  allowedOrigins?: readonly string[];
}

const base64UrlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url, identical to Node's encoding, without depending on Buffer. */
export function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const value = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
    output += base64UrlAlphabet[value >> 18]! + base64UrlAlphabet[(value >> 12) & 63]! + base64UrlAlphabet[(value >> 6) & 63]! + base64UrlAlphabet[value & 63]!;
  }
  const remaining = bytes.length - index;
  if (remaining === 1) {
    const value = bytes[index]! << 16;
    output += base64UrlAlphabet[value >> 18]! + base64UrlAlphabet[(value >> 12) & 63]!;
  } else if (remaining === 2) {
    const value = (bytes[index]! << 16) | (bytes[index + 1]! << 8);
    output += base64UrlAlphabet[value >> 18]! + base64UrlAlphabet[(value >> 12) & 63]! + base64UrlAlphabet[(value >> 6) & 63]!;
  }
  return output;
}

function token(): string { return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32))); }

function cookieValue(header: string | null, name: string): string | undefined {
  for (const cookie of (header ?? "").split(";")) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    const value = cookie.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
  }
  return undefined;
}

const recentRevocationMs = 60_000;
const recentRevocationLimit = 4096;
/** Registered handles before the first sweep of collected ones. */
const minimumSweep = 1024;

/**
 * Handles of each session family on this instance, held weakly so a finished
 * request leaves nothing behind. Families revoked in the last minute stay
 * remembered: a revoked family never becomes active again, and a handle
 * loaded just before the notification arrived is aborted on registration.
 */
class RevocationRegistry {
  private readonly families = new Map<string, Set<WeakRef<AbortController>>>();
  private readonly recent = new Map<string, number>();
  private readonly finalizer = new FinalizationRegistry<{ readonly familyId: string; readonly ref: WeakRef<AbortController> }>(
    ({ familyId, ref }) => this.forget(familyId, ref),
  );
  /** Handles currently registered, and the count that triggers the next sweep. */
  private size = 0;
  private sweepAt = minimumSweep;
  track(familyId: string, controller: AbortController): WeakRef<AbortController> | undefined {
    const revokedAt = this.recent.get(familyId);
    if (revokedAt !== undefined && Date.now() - revokedAt < recentRevocationMs) {
      controller.abort(new SessionRevokedError());
      return undefined;
    }
    const ref = new WeakRef(controller);
    let handles = this.families.get(familyId);
    if (!handles) { handles = new Set(); this.families.set(familyId, handles); }
    handles.add(ref);
    this.size++;
    this.finalizer.register(controller, { familyId, ref }, ref);
    if (this.size >= this.sweepAt) this.sweep();
    return ref;
  }
  /** Handles still registered, collected or not; for tests. */
  get handleCount(): number { return this.size; }
  /**
   * Drops handles whose controllers were collected. Finalizers may run late or
   * never, and handles that are never untracked (such as the connections of an
   * evicted Durable Object) would otherwise accumulate for the instance's life.
   */
  private sweep(): void {
    for (const [familyId, handles] of this.families) {
      for (const ref of handles) {
        if (ref.deref()) continue;
        this.finalizer.unregister(ref);
        handles.delete(ref);
        this.size--;
      }
      if (!handles.size) this.families.delete(familyId);
    }
    // Amortized: the next sweep waits for as many new handles as are live now.
    this.sweepAt = Math.max(minimumSweep, this.size * 2);
  }
  untrack(familyId: string, ref: WeakRef<AbortController> | undefined): void {
    if (!ref) return;
    this.finalizer.unregister(ref);
    this.forget(familyId, ref);
  }
  revoke(familyId: string): void {
    this.remember(familyId);
    const handles = this.families.get(familyId);
    this.families.delete(familyId);
    this.size -= handles?.size ?? 0;
    for (const ref of handles ?? []) {
      this.finalizer.unregister(ref);
      ref.deref()?.abort(new SessionRevokedError());
    }
  }
  private forget(familyId: string, ref: WeakRef<AbortController>): void {
    const handles = this.families.get(familyId);
    if (!handles?.delete(ref)) return;
    this.size--;
    if (!handles.size) this.families.delete(familyId);
  }
  private remember(familyId: string): void {
    const now = Date.now();
    this.recent.delete(familyId);
    this.recent.set(familyId, now);
    for (const [family, revokedAt] of this.recent) {
      if (this.recent.size <= recentRevocationLimit && now - revokedAt < recentRevocationMs) break;
      this.recent.delete(family);
    }
  }
}

const registries = new WeakMap<SessionManager<any>, RevocationRegistry>();

function revocationRegistry(manager: SessionManager<any>): RevocationRegistry {
  let registry = registries.get(manager);
  if (!registry) { registry = new RevocationRegistry(); registries.set(manager, registry); }
  return registry;
}

/**
 * The registry holds controllers weakly, and a signal does not reference its
 * controller. This keeps each controller alive while its signal is reachable,
 * so code that retains only `SessionHandle.signal` still sees the revocation.
 */
const signalControllers = new WeakMap<AbortSignal, AbortController>();

/**
 * @internal Fixes the cookie of a response whose headers are about to be sent:
 * waits for create/rotate/revoke calls in flight, then makes later calls fail
 * with `SESSION_LOCKED` before they touch the store.
 */
export const lockSessionCookie = Symbol("meeko.session.lockCookie");

function sessionLockedError(): ApiError {
  return new ApiError("SESSION_LOCKED", 500, "SESSION_LOCKED: the session cookie was already sent with the response headers; create, rotate or revoke the session in the loader, before any deferred work");
}

/** Revocation handles a manager still holds, including collected ones not yet swept. Internal; for tests. */
export function trackedSessionHandles(manager: SessionManager<any>): number {
  return registries.get(manager)?.handleCount ?? 0;
}

export class SessionHandle<T = unknown> {
  private pendingCookie?: string;
  private cookieLocked = false;
  /** Settled forms of the create/rotate/revoke calls still writing the store. */
  private readonly mutations = new Set<Promise<void>>();
  private readonly revocation = new AbortController();
  private watched: { readonly familyId: string; readonly ref: WeakRef<AbortController> | undefined } | undefined;
  constructor(private readonly manager: SessionManager<T>, public current?: SessionRecord<T>) {
    signalControllers.set(this.revocation.signal, this.revocation);
    this.watch();
  }
  get cookieHeader(): string | undefined { return this.pendingCookie; }
  /**
   * Aborts with `SessionRevokedError` when another request or instance revokes
   * this session's family. `RequestContext.signal` includes it.
   */
  get signal(): AbortSignal { return this.revocation.signal; }
  async create(data: T): Promise<SessionRecord<T>> {
    return this.mutate(() => this.write(data));
  }
  async rotate(): Promise<SessionRecord<T>> {
    return this.mutate(async () => {
      if (!this.current) throw new Error("No active session to rotate");
      return this.write(this.current.data);
    });
  }
  async revoke(): Promise<void> {
    return this.mutate(async () => {
      if (this.current) {
        if (!this.manager.store.revokeFamily) throw new Error("Session storage does not support atomic family revocation");
        const familyId = this.current.familyId ?? this.current.id;
        // The revoking request keeps running so that it can clear the cookie.
        this.unwatch();
        try { await this.manager.store.revokeFamily(familyId); }
        catch (error) {
          this.watch();
          throw error;
        }
        revocationRegistry(this.manager).revoke(familyId);
      }
      this.current = undefined;
      this.pendingCookie = this.manager.serializeCookie("", 0);
    });
  }
  /** @internal Resolves once no session change is in flight; later changes fail with `SESSION_LOCKED`. */
  async [lockSessionCookie](): Promise<void> {
    this.cookieLocked = true;
    while (this.mutations.size) await Promise.all(this.mutations);
  }
  /** Runs one store change unless the cookie is locked, and tracks it until it settles. */
  private mutate<R>(work: () => Promise<R>): Promise<R> {
    if (this.cookieLocked) return Promise.reject(sessionLockedError());
    const running = work();
    const settled = running.then(() => {}, () => {});
    this.mutations.add(settled);
    void settled.then(() => { this.mutations.delete(settled); });
    return running;
  }
  private async write(data: T): Promise<SessionRecord<T>> {
    const previous = this.current;
    const now = Date.now();
    const record = { id: token(), familyId: previous?.familyId ?? previous?.id ?? token(), csrfToken: token(), data, createdAt: now, expiresAt: now + this.manager.ttlMs };
    if (previous) {
      if (!this.manager.store.replace) throw new Error("Session storage does not support atomic rotation");
      if (!(await this.manager.store.replace(previous.id, record))) throw new Error("Session has expired or been revoked");
    } else await this.manager.store.set(record);
    this.current = record;
    this.watch();
    this.pendingCookie = this.manager.serializeCookie(record.id, this.manager.ttlMs);
    return record;
  }
  /**
   * Re-reads the store and throws `SessionRevokedError` (`401 SESSION_REVOKED`)
   * when this session was revoked, replaced by a rotation or expired. Call it
   * before irreversible side effects; without a session it does nothing.
   */
  async verify(): Promise<void> {
    if (this.revocation.signal.aborted) throw new SessionRevokedError();
    const current = this.current;
    if (!current) return;
    const stored = await this.manager.store.get(current.id);
    if (!stored || stored.id !== current.id || stored.expiresAt <= Date.now()) throw new SessionRevokedError();
  }
  private watch(): void {
    const familyId = this.current ? this.current.familyId ?? this.current.id : undefined;
    if (familyId === this.watched?.familyId) return;
    this.unwatch();
    if (familyId !== undefined) this.watched = { familyId, ref: revocationRegistry(this.manager).track(familyId, this.revocation) };
  }
  private unwatch(): void {
    if (this.watched) revocationRegistry(this.manager).untrack(this.watched.familyId, this.watched.ref);
    this.watched = undefined;
  }
}

export class SessionManager<T = unknown> {
  readonly store: SessionStore<T>;
  readonly ttlMs: number;
  readonly cookieName: string;
  readonly allowedOrigins: readonly string[];
  private readonly secure: boolean;
  private readonly sameSite: "Lax" | "Strict" | "None";
  constructor(options: SessionOptions<T>) {
    if (options.production && (options.store.persistent !== true || !options.store.replace || !options.store.revokeFamily)) throw new Error("Persistent session storage with atomic rotation and family revocation is required in production");
    this.store = options.store;
    this.ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) throw new RangeError("Invalid session TTL");
    this.secure = options.secure ?? true;
    this.sameSite = options.sameSite ?? "Lax";
    if (this.sameSite === "None" && !this.secure) throw new Error("SameSite=None requires Secure");
    this.cookieName = options.cookieName ?? (this.secure ? "__Host-meeko.sid" : "meeko.sid");
    if (!/^[A-Za-z0-9_.-]+$/.test(this.cookieName)) throw new TypeError("Invalid cookie name");
    if (this.cookieName.startsWith("__Host-") && !this.secure) throw new Error("__Host- cookies require Secure");
    this.allowedOrigins = options.allowedOrigins ?? [];
  }
  serializeCookie(value: string, ttlMs: number): string {
    const parts = [`${this.cookieName}=${value}`, "Path=/", "HttpOnly", `SameSite=${this.sameSite}`, `Max-Age=${Math.floor(ttlMs / 1000)}`];
    if (this.secure) parts.push("Secure");
    return parts.join("; ");
  }
  private revocations: Promise<Unsubscribe> | undefined;
  /** Subscribes once to the store's revocations; a failed attempt is retried by the next load. */
  private listenForRevocations(): Promise<Unsubscribe> | undefined {
    const store = this.store;
    if (!store.subscribeRevocations) return undefined;
    const registry = revocationRegistry(this);
    const subscription = this.revocations ??= Promise.resolve()
      .then(() => store.subscribeRevocations!((familyId) => registry.revoke(familyId)))
      .catch((error: unknown) => {
        if (this.revocations === subscription) this.revocations = undefined;
        throw error;
      });
    return subscription;
  }
  async load(request: Request): Promise<SessionHandle<T>> {
    // Revocations from other instances must be flowing before a request is authenticated.
    await this.listenForRevocations();
    const id = cookieValue(request.headers.get("cookie"), this.cookieName);
    const record = id ? await this.store.get(id) : undefined;
    if (record && record.expiresAt <= Date.now()) {
      await this.store.delete(record.id);
      return new SessionHandle(this);
    }
    return new SessionHandle(this, record);
  }
  async close(): Promise<void> {
    const subscription = this.revocations;
    this.revocations = undefined;
    const failures: unknown[] = [];
    // A subscription that never started was already reported by `load`.
    const unsubscribe = subscription ? await subscription.catch(() => undefined) : undefined;
    if (unsubscribe) {
      try { await unsubscribe(); }
      catch (error) { failures.push(error); }
    }
    try { await this.store.close?.(); }
    catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Session revocation unsubscribe and store close failed");
  }
  /** Apply both Origin and token checks to authenticated cookie mutations. */
  assertMutationAllowed(request: Request, session: SessionHandle<T>, mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method)): void {
    if (!session.current || !mutating) return;
    const origin = request.headers.get("origin");
    const expected = new URL(request.url).origin;
    if (!origin || (origin !== expected && !this.allowedOrigins.includes(origin))) throw new SessionSecurityError("INVALID_ORIGIN");
    if (request.headers.get("x-meeko-csrf") !== session.current.csrfToken) throw new SessionSecurityError("INVALID_CSRF");
  }
}

export class SessionSecurityError extends Error {
  constructor(public readonly code: "INVALID_ORIGIN" | "INVALID_CSRF") { super(code); }
}
