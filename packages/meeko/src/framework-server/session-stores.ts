import { serializeJson } from "../server.js";
import { RedisChannelSubscriptions } from "./redis-pubsub.js";
import type { RedisSubscriberClient } from "./redis-pubsub.js";
import type { SessionRecord, SessionStore } from "./sessions.js";
import type { Unsubscribe } from "./socket.js";

/**
 * Interfaz mínima de un cliente Redis para {@link RedisSessionStore}: `get`, `set` con `PX`, `del` y
 * `eval`. node-redis 4 o posterior la cumple; también un adaptador sobre la API REST de Upstash.
 *
 * @example
 * ```ts
 * import type { RedisSessionClient } from "@meekojs/meeko/server";
 *
 * function upstashClient(url: string, token: string): RedisSessionClient {
 *   const command = async (...args: Array<string | number>): Promise<unknown> => {
 *     const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(args) });
 *     return ((await response.json()) as { result?: unknown }).result;
 *   };
 *   return {
 *     get: async (key) => (await command("GET", key)) as string | null,
 *     set: (key, value, { PX }) => command("SET", key, value, "PX", PX),
 *     del: (key) => command("DEL", key),
 *     eval: (script, { keys, arguments: args }) => command("EVAL", script, keys.length, ...keys, ...args),
 *   };
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#redis-mediante-la-api-rest-de-upstash
 */
export interface RedisSessionClient {
  /** Lee una clave, o `null` si no existe. */
  get(key: string): Promise<string | null>;
  /** Escribe una clave con caducidad en milisegundos. */
  set(key: string, value: string, options: { PX: number }): Promise<unknown>;
  /** Borra una clave. */
  del(key: string): Promise<unknown>;
  /** Ejecuta un script Lua de forma atómica. */
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  /** Cierra la conexión; sólo se usa con `closeClient`. */
  quit?(): Promise<unknown>;
}

/**
 * Opciones de {@link RedisSessionStore}.
 *
 * @example
 * ```ts
 * import type { RedisSessionStoreOptions } from "@meekojs/meeko/server";
 *
 * const options: RedisSessionStoreOptions = { prefix: "app:prod:session:", subscriber: redis.duplicate() };
 * ```
 */
export interface RedisSessionStoreOptions {
  /** Prefijo de las claves, único por aplicación y entorno; termina en `:` y no tiene espacios. */
  prefix: string;
  /** Cierra el cliente Redis al cerrar el store, cuando el store es dueño de la conexión. */
  closeClient?: boolean;
  /**
   * Conexión suscriptora dedicada (por ejemplo, `client.duplicate()`). Con ella el store recibe las
   * revocaciones que cualquier instancia publica en `<prefix>revoked`. La aplicación la abre y la cierra.
   */
  subscriber?: RedisSubscriberClient;
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

/**
 * Store de sesiones persistente en Redis: la caducidad la gestiona Redis, `replace` y
 * `revokeFamily` son scripts atómicos y un índice por familia localiza la sesión activa. La
 * aplicación abre y cierra el cliente salvo con `closeClient`.
 *
 * @typeParam T Datos de la aplicación en la sesión.
 * @example
 * ```ts
 * // server/runtime.ts
 * import { createClient } from "redis";
 * import { defineServerRuntime, RedisSessionStore, SessionManager } from "@meekojs/meeko/server";
 *
 * export default defineServerRuntime(async ({ env, production, prerendering }) => {
 *   const redis = createClient({ url: env.MEEKO_REDIS_URL });
 *   await redis.connect();
 *   const subscriber = redis.duplicate();
 *   await subscriber.connect();
 *   const store = new RedisSessionStore(redis, { prefix: "app:prod:session:", subscriber });
 *   return {
 *     sessions: new SessionManager({ store, production: production && !prerendering }),
 *     close: async () => { await subscriber.quit(); await redis.quit(); },
 *   };
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sesiones-y-seguridad
 */
export class RedisSessionStore<T = unknown> implements SessionStore<T> {
  readonly persistent = true;
  /** Sólo existe con un cliente `subscriber`. */
  readonly subscribeRevocations?: (listener: (familyId: string) => void) => Promise<Unsubscribe>;
  /**
   * @param client Cliente Redis conectado.
   * @param options Prefijo, propiedad del cliente y suscriptor.
   * @throws {TypeError} Si el prefijo está vacío, tiene espacios o no termina en `:`.
   */
  constructor(private readonly client: RedisSessionClient, private readonly options: RedisSessionStoreOptions) {
    if (!options.prefix || !options.prefix.endsWith(":") || /\s/.test(options.prefix)) throw new TypeError("Session Redis prefix must be nonempty, contain no whitespace, and end with ':'");
    const subscriber = options.subscriber;
    if (subscriber) {
      const subscriptions = new RedisChannelSubscriptions<(familyId: string) => void>(
        (channel, listener) => subscriber.subscribe(channel, listener),
        (channel, listener) => subscriber.unsubscribe(channel, listener),
        (familyId, listeners) => {
          if (!familyId) return;
          for (const listener of listeners) {
            try { listener(familyId); }
            catch (error) { console.error("[meeko] Session revocation listener failed", error); }
          }
        },
      );
      this.subscribeRevocations = (listener) => subscriptions.add(this.revocationChannel(), listener);
    }
  }
  private revocationChannel(): string { return `${this.options.prefix}revoked`; }
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
      "-- meeko:session:revoke-family\nlocal active = redis.call('GET', KEYS[1]) if active then redis.call('DEL', ARGV[1] .. active) redis.call('DEL', KEYS[1]) else redis.call('DEL', ARGV[1] .. ARGV[2]) end redis.call('PUBLISH', ARGV[3], ARGV[2]) return 1",
      { keys: [this.familyKey(familyId)], arguments: [this.options.prefix, familyId, this.revocationChannel()] },
    );
  }
  async close(): Promise<void> { if (this.options.closeClient) await this.client.quit?.(); }
}

/**
 * Fila de sesión que intercambian {@link SqlSessionStore} y su driver, con cualquier cliente y
 * dialecto SQL.
 *
 * @example
 * ```ts
 * import type { SqlSessionRow } from "@meekojs/meeko/server";
 *
 * const fromDatabase = (row: { id: string; family_id: string; csrf_token: string; data_json: string; created_at: number; expires_at: number }): SqlSessionRow => ({
 *   id: row.id, familyId: row.family_id, csrfToken: row.csrf_token,
 *   dataJson: row.data_json, createdAt: row.created_at, expiresAt: row.expires_at,
 * });
 * ```
 */
export interface SqlSessionRow {
  /** ID opaco de la sesión, clave primaria. */
  id: string;
  /** Familia de la sesión, con índice único. Migre las filas existentes con `family_id = id`. */
  familyId: string;
  /** Token CSRF. */
  csrfToken: string;
  /** Datos de la sesión serializados en JSON. */
  dataJson: string;
  /** Creación, en milisegundos desde la época. */
  createdAt: number;
  /** Caducidad, en milisegundos desde la época. */
  expiresAt: number;
}

/**
 * Driver SQL de {@link SqlSessionStore}: la aplicación escribe las sentencias con su cliente. `replace`
 * y `revokeFamily` deben ser atómicos. `D1SessionDriver` de `@meekojs/meeko/cloudflare` es una
 * implementación.
 *
 * @example
 * ```ts
 * import type { SqlSessionDriver } from "@meekojs/meeko/server";
 *
 * const driver: SqlSessionDriver = {
 *   read: (id) => db.get("SELECT * FROM sessions WHERE id = ?", id),
 *   write: (row) => db.run("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?, ?, ?, ?)", row.id, row.familyId, row.csrfToken, row.dataJson, row.createdAt, row.expiresAt),
 *   remove: (id) => db.run("DELETE FROM sessions WHERE id = ?", id),
 *   replace: (previousId, row, now) => db.transaction(() => replaceRow(previousId, row, now)),
 *   revokeFamily: (familyId) => db.run("DELETE FROM sessions WHERE family_id = ?", familyId),
 * };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sesiones-y-seguridad
 */
export interface SqlSessionDriver {
  /** Lee la fila con ese ID, o `undefined`. */
  read(id: string): Promise<SqlSessionRow | undefined>;
  /** Inserta o actualiza una fila por su ID opaco; debe imponer un único ID activo por familia. */
  write(row: SqlSessionRow): Promise<void>;
  /** Borra la fila con ese ID. */
  remove(id: string): Promise<void>;
  /** Sustituye en una transacción una fila no caducada de la misma familia; `false` si no existe. */
  replace(previousId: string, row: SqlSessionRow, now: number): Promise<boolean>;
  /** Borra en una operación atómica la fila activa de la familia, también desde un handle anterior. */
  revokeFamily(familyId: string): Promise<void>;
  /** Cierra la conexión; sólo se usa con `closeDriver`. */
  close?(): Promise<void>;
}

/**
 * Opciones de {@link SqlSessionStore}.
 *
 * @example
 * ```ts
 * import { SqlSessionStore } from "@meekojs/meeko/server";
 *
 * const store = new SqlSessionStore(driver, { closeDriver: true });
 * ```
 */
export interface SqlSessionStoreOptions {
  /** Cierra el driver al cerrar el store, cuando el store es dueño de la conexión. */
  closeDriver?: boolean;
}

/**
 * Store de sesiones SQL genérico y persistente: la aplicación aporta las sentencias mediante su
 * driver. Las filas caducadas se borran al leerlas. No notifica revocaciones a otras instancias.
 * La duración propia de cada sesión (`SessionRecord.ttlMs`) se deduce de `expiresAt - createdAt`,
 * sin columna adicional.
 *
 * @typeParam T Datos de la aplicación en la sesión.
 * @example
 * ```ts
 * import { defineServerRuntime, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";
 *
 * export default defineServerRuntime(({ production, prerendering }) => ({
 *   sessions: new SessionManager({ store: new SqlSessionStore(driver), production: production && !prerendering }),
 * }));
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sesiones-y-seguridad
 */
export class SqlSessionStore<T = unknown> implements SessionStore<T> {
  readonly persistent = true;
  /**
   * @param driver Driver con `replace` y `revokeFamily` atómicos.
   * @param options Propiedad de la conexión.
   * @throws {TypeError} Si el driver no implementa `replace` o `revokeFamily`.
   */
  constructor(private readonly driver: SqlSessionDriver, private readonly options: SqlSessionStoreOptions = {}) {
    if (typeof driver.replace !== "function" || typeof driver.revokeFamily !== "function") throw new TypeError("SQL session driver requires atomic replace and family revocation");
  }
  async get(id: string): Promise<SessionRecord<T> | undefined> {
    const row = await this.driver.read(id);
    if (!row) return undefined;
    if (row.id !== id || typeof row.dataJson !== "string" || typeof row.familyId !== "string" || !row.familyId) throw new Error("Session SQL schema requires a nonempty family_id column");
    // Rows have no TTL column: Meeko writes `expiresAt = createdAt + ttl`, so the session's own TTL
    // survives rotation without a schema change.
    const ttlMs = row.expiresAt - row.createdAt;
    const record = decodeRecord<T>(serializeJson({
      id: row.id, familyId: row.familyId, csrfToken: row.csrfToken, data: JSON.parse(row.dataJson) as unknown, createdAt: row.createdAt, expiresAt: row.expiresAt,
      ...(Number.isSafeInteger(ttlMs) && ttlMs > 0 ? { ttlMs } : {}),
    }), id);
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
