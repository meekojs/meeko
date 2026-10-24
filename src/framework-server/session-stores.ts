import { serializeJson } from "../server.js";
import type { SessionRecord, SessionStore } from "./sessions.js";

/** Small interface compatible with Redis clients that support SET PX. */
export interface RedisSessionClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { PX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  quit?(): Promise<unknown>;
}

export interface RedisSessionStoreOptions {
  /** Use a unique prefix for each application and environment. */
  prefix: string;
  /** Close the Redis client when this store owns its connection. */
  closeClient?: boolean;
}

function decodeRecord<T>(value: string, id: string): SessionRecord<T> {
  let record: unknown;
  try { record = JSON.parse(value) as unknown; }
  catch { throw new Error("Corrupt session record"); }
  if (!record || typeof record !== "object") throw new Error("Corrupt session record");
  const candidate = record as Partial<SessionRecord<T>>;
  if (candidate.id !== id || typeof candidate.csrfToken !== "string" || !Object.hasOwn(candidate, "data") ||
      typeof candidate.createdAt !== "number" || typeof candidate.expiresAt !== "number" ||
      !Number.isFinite(candidate.createdAt) || !Number.isFinite(candidate.expiresAt)) {
    throw new Error("Corrupt session record");
  }
  return candidate as SessionRecord<T>;
}

/** Persistent store with Redis-managed expiration and explicit connection ownership. */
export class RedisSessionStore<T = unknown> implements SessionStore<T> {
  readonly persistent = true;
  constructor(private readonly client: RedisSessionClient, private readonly options: RedisSessionStoreOptions) {
    if (!options.prefix || !options.prefix.endsWith(":") || /\s/.test(options.prefix)) throw new TypeError("Session Redis prefix must be nonempty, contain no whitespace, and end with ':'");
  }
  private key(id: string): string { return `${this.options.prefix}${id}`; }
  async get(id: string): Promise<SessionRecord<T> | undefined> {
    const value = await this.client.get(this.key(id));
    if (value === null) return undefined;
    const record = decodeRecord<T>(value, id);
    if (record.expiresAt > Date.now()) return record;
    await this.delete(id);
    return undefined;
  }
  async set(record: SessionRecord<T>): Promise<void> {
    const ttlMs = record.expiresAt - Date.now();
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new RangeError("Session must have a future expiration");
    await this.client.set(this.key(record.id), serializeJson(record), { PX: ttlMs });
  }
  async delete(id: string): Promise<void> { await this.client.del(this.key(id)); }
  async replace(previousId: string, record: SessionRecord<T>): Promise<boolean> {
    const ttlMs = record.expiresAt - Date.now();
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new RangeError("Session must have a future expiration");
    const result = await this.client.eval(
      "if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2]) redis.call('DEL', KEYS[1]) return 1",
      { keys: [this.key(previousId), this.key(record.id)], arguments: [serializeJson(record), String(ttlMs)] },
    );
    if (result !== 0 && result !== 1) throw new Error("Unexpected Redis rotation result");
    return result === 1;
  }
  async close(): Promise<void> { if (this.options.closeClient) await this.client.quit?.(); }
}

/** A driver can implement these operations using any SQL client and dialect. */
export interface SqlSessionRow {
  id: string;
  csrfToken: string;
  dataJson: string;
  createdAt: number;
  expiresAt: number;
}

export interface SqlSessionDriver {
  read(id: string): Promise<SqlSessionRow | undefined>;
  /** Insert or update one row, keyed by its opaque id. */
  write(row: SqlSessionRow): Promise<void>;
  remove(id: string): Promise<void>;
  /** Atomically replace an unexpired row in one transaction; return false if absent or expired. */
  replace(previousId: string, row: SqlSessionRow, now: number): Promise<boolean>;
  close?(): Promise<void>;
}

export interface SqlSessionStoreOptions {
  /** Close the SQL driver when this store owns its connection. */
  closeDriver?: boolean;
}

/** Generic SQL store. The application supplies SQL statements through its driver. */
export class SqlSessionStore<T = unknown> implements SessionStore<T> {
  readonly persistent = true;
  constructor(private readonly driver: SqlSessionDriver, private readonly options: SqlSessionStoreOptions = {}) {}
  async get(id: string): Promise<SessionRecord<T> | undefined> {
    const row = await this.driver.read(id);
    if (!row) return undefined;
    if (row.id !== id || typeof row.dataJson !== "string") throw new Error("Corrupt session record");
    const record = decodeRecord<T>(serializeJson({ id: row.id, csrfToken: row.csrfToken, data: JSON.parse(row.dataJson) as unknown, createdAt: row.createdAt, expiresAt: row.expiresAt }), id);
    if (record.expiresAt > Date.now()) return record;
    await this.delete(id);
    return undefined;
  }
  async set(record: SessionRecord<T>): Promise<void> {
    if (!Number.isSafeInteger(record.expiresAt) || record.expiresAt <= Date.now()) throw new RangeError("Session must have a future expiration");
    await this.driver.write({ id: record.id, csrfToken: record.csrfToken, dataJson: serializeJson(record.data), createdAt: record.createdAt, expiresAt: record.expiresAt });
  }
  async delete(id: string): Promise<void> { await this.driver.remove(id); }
  async replace(previousId: string, record: SessionRecord<T>): Promise<boolean> {
    if (!Number.isSafeInteger(record.expiresAt) || record.expiresAt <= Date.now()) throw new RangeError("Session must have a future expiration");
    return this.driver.replace(previousId, { id: record.id, csrfToken: record.csrfToken, dataJson: serializeJson(record.data), createdAt: record.createdAt, expiresAt: record.expiresAt }, Date.now());
  }
  async close(): Promise<void> { if (this.options.closeDriver) await this.driver.close?.(); }
}
