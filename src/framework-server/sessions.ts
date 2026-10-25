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
  close?(): Promise<void>;
}

export class MemorySessionStore<T = unknown> implements SessionStore<T> {
  readonly developmentOnly = true;
  readonly persistent = false;
  private readonly records = new Map<string, SessionRecord<T>>();
  private readonly families = new Map<string, string>();
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

export class SessionHandle<T = unknown> {
  private pendingCookie?: string;
  constructor(private readonly manager: SessionManager<T>, public current?: SessionRecord<T>) {}
  get cookieHeader(): string | undefined { return this.pendingCookie; }
  async create(data: T): Promise<SessionRecord<T>> {
    const previous = this.current;
    const now = Date.now();
    const record = { id: token(), familyId: previous?.familyId ?? previous?.id ?? token(), csrfToken: token(), data, createdAt: now, expiresAt: now + this.manager.ttlMs };
    if (previous) {
      if (!this.manager.store.replace) throw new Error("Session storage does not support atomic rotation");
      if (!(await this.manager.store.replace(previous.id, record))) throw new Error("Session has expired or been revoked");
    } else await this.manager.store.set(record);
    this.current = record;
    this.pendingCookie = this.manager.serializeCookie(record.id, this.manager.ttlMs);
    return record;
  }
  async rotate(): Promise<SessionRecord<T>> {
    if (!this.current) throw new Error("No active session to rotate");
    return this.create(this.current.data);
  }
  async revoke(): Promise<void> {
    if (this.current) {
      if (!this.manager.store.revokeFamily) throw new Error("Session storage does not support atomic family revocation");
      await this.manager.store.revokeFamily(this.current.familyId ?? this.current.id);
    }
    this.current = undefined;
    this.pendingCookie = this.manager.serializeCookie("", 0);
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
  async load(request: Request): Promise<SessionHandle<T>> {
    const id = cookieValue(request.headers.get("cookie"), this.cookieName);
    const record = id ? await this.store.get(id) : undefined;
    if (record && record.expiresAt <= Date.now()) {
      await this.store.delete(record.id);
      return new SessionHandle(this);
    }
    return new SessionHandle(this, record);
  }
  async close(): Promise<void> { await this.store.close?.(); }
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
