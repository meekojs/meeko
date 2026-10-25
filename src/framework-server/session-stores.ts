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
      !Number.isFinite(candidate.createdAt) || !Number.isFinite(candidate.expiresAt) ||
      (candidate.familyId !== undefined && (typeof candidate.familyId !== "string" || candidate.familyId.length === 0))) {
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
  private familyKey(id: string): string { return `${this.options.prefix}family:${id}`; }
  async get(id: string): Promise<SessionRecord<T> | undefined> {
    const value = await this.client.get(this.key(id));
    if (value === null) return undefined;
    const record = decodeRecord<T>(value, id);
    if (record.expiresAt > Date.now()) {
      // Older records without a family id are migrated by the first rotation.
      if (!record.familyId || await this.client.get(this.familyKey(record.familyId)) === id) return record;
      await this.delete(id);
      return undefined;
    }
    await this.delete(id);
    return undefined;
  }
  async set(record: SessionRecord<T>): Promise<void> {
    const ttlMs = record.expiresAt - Date.now();
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new RangeError("Session must have a future expiration");
    const familyId = record.familyId ?? record.id;
    const result = await this.client.eval(
      "-- meeko:session:set\nlocal prior = redis.call('GET', KEYS[1]) if prior then local old = cjson.decode(prior) if (old.familyId or old.id) ~= ARGV[4] then return 0 end end local active = redis.call('GET', KEYS[2]) if active and active ~= ARGV[2] then return 0 end redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3]) redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3]) return 1",
      { keys: [this.key(record.id), this.familyKey(familyId)], arguments: [serializeJson({ ...record, familyId }), record.id, String(ttlMs), familyId] },
    );
    if (result !== 1) throw new Error("Session family already has an active id");
  }
  async delete(id: string): Promise<void> {
    const value = await this.client.get(this.key(id));
    if (value === null) return;
    const record = decodeRecord<T>(value, id);
    await this.client.eval(
      "-- meeko:session:delete\nlocal raw = redis.call('GET', KEYS[1]) if not raw then return 0 end local active = redis.call('GET', KEYS[2]) redis.call('DEL', KEYS[1]) if active == ARGV[1] then redis.call('DEL', KEYS[2]) end return 1",
      { keys: [this.key(id), this.familyKey(record.familyId ?? id)], arguments: [id] },
    );
  }
  async replace(previousId: string, record: SessionRecord<T>): Promise<boolean> {
    const ttlMs = record.expiresAt - Date.now();
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new RangeError("Session must have a future expiration");
    if (!record.familyId) throw new Error("Rotated session requires a family id");
    const result = await this.client.eval(
      "-- meeko:session:replace\nlocal raw = redis.call('GET', KEYS[1]) if not raw then return 0 end local previous = cjson.decode(raw) local family = previous.familyId or previous.id if family ~= ARGV[3] or previous.expiresAt <= tonumber(ARGV[4]) then return 0 end local active = redis.call('GET', KEYS[3]) if active and active ~= ARGV[2] then return 0 end redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[5]) redis.call('SET', KEYS[3], ARGV[6], 'PX', ARGV[5]) redis.call('DEL', KEYS[1]) return 1",
      { keys: [this.key(previousId), this.key(record.id), this.familyKey(record.familyId)], arguments: [serializeJson(record), previousId, record.familyId, String(Date.now()), String(ttlMs), record.id] },
    );
    if (result !== 0 && result !== 1) throw new Error("Unexpected Redis rotation result");
    return result === 1;
  }
  async revokeFamily(familyId: string): Promise<void> {
    await this.client.eval(
      "-- meeko:session:revoke-family\nlocal active = redis.call('GET', KEYS[1]) if active then redis.call('DEL', ARGV[1] .. active) redis.call('DEL', KEYS[1]) else redis.call('DEL', ARGV[1] .. ARGV[2]) end return 1",
      { keys: [this.familyKey(familyId)], arguments: [this.options.prefix, familyId] },
    );
  }
  async close(): Promise<void> { if (this.options.closeClient) await this.client.quit?.(); }
}

/** A driver can implement these operations using any SQL client and dialect. */
export interface SqlSessionRow {
  id: string;
  /** Migrate existing rows by setting family_id = id before deploying this driver. */
  familyId: string;
  csrfToken: string;
  dataJson: string;
  createdAt: number;
  expiresAt: number;
}

export interface SqlSessionDriver {
  read(id: string): Promise<SqlSessionRow | undefined>;
  /** Insert or update one row, keyed by its opaque id; enforce one active id per family. */
  write(row: SqlSessionRow): Promise<void>;
  remove(id: string): Promise<void>;
  /** Atomically replace an unexpired row of the same family in one transaction. */
  replace(previousId: string, row: SqlSessionRow, now: number): Promise<boolean>;
  /** Delete the active row for this family in one atomic operation, including stale-handle logout. */
  revokeFamily(familyId: string): Promise<void>;
  close?(): Promise<void>;
}

export interface SqlSessionStoreOptions {
  /** Close the SQL driver when this store owns its connection. */
  closeDriver?: boolean;
}

/** Generic SQL store. The application supplies SQL statements through its driver. */
export class SqlSessionStore<T = unknown> implements SessionStore<T> {
  readonly persistent = true;
  constructor(private readonly driver: SqlSessionDriver, private readonly options: SqlSessionStoreOptions = {}) {
    if (typeof driver.replace !== "function" || typeof driver.revokeFamily !== "function") throw new TypeError("SQL session driver requires atomic replace and family revocation");
  }
  async get(id: string): Promise<SessionRecord<T> | undefined> {
    const row = await this.driver.read(id);
    if (!row) return undefined;
    if (row.id !== id || typeof row.dataJson !== "string" || typeof row.familyId !== "string" || !row.familyId) throw new Error("Session SQL schema requires a nonempty family_id column");
    const record = decodeRecord<T>(serializeJson({ id: row.id, familyId: row.familyId, csrfToken: row.csrfToken, data: JSON.parse(row.dataJson) as unknown, createdAt: row.createdAt, expiresAt: row.expiresAt }), id);
    if (record.expiresAt > Date.now()) return record;
    await this.delete(id);
    return undefined;
  }
  async set(record: SessionRecord<T>): Promise<void> {
    if (!Number.isSafeInteger(record.expiresAt) || record.expiresAt <= Date.now()) throw new RangeError("Session must have a future expiration");
    await this.driver.write({ id: record.id, familyId: record.familyId ?? record.id, csrfToken: record.csrfToken, dataJson: serializeJson(record.data), createdAt: record.createdAt, expiresAt: record.expiresAt });
  }
  async delete(id: string): Promise<void> { await this.driver.remove(id); }
  async replace(previousId: string, record: SessionRecord<T>): Promise<boolean> {
    if (!Number.isSafeInteger(record.expiresAt) || record.expiresAt <= Date.now()) throw new RangeError("Session must have a future expiration");
    if (!record.familyId) throw new Error("Rotated session requires a family id");
    return this.driver.replace(previousId, { id: record.id, familyId: record.familyId, csrfToken: record.csrfToken, dataJson: serializeJson(record.data), createdAt: record.createdAt, expiresAt: record.expiresAt }, Date.now());
  }
  async revokeFamily(familyId: string): Promise<void> { await this.driver.revokeFamily(familyId); }
  async close(): Promise<void> { if (this.options.closeDriver) await this.driver.close?.(); }
}
