import { envString, parseDuration, warnOnce } from "./env.js";
import type { PlatformName } from "./platform.js";
import type { RedisSubscriberClient } from "./redis-pubsub.js";
import { RedisSessionStore } from "./session-stores.js";
import type { RedisSessionClient } from "./session-stores.js";
import { MemorySessionStore, SessionManager } from "./sessions.js";
import type { SessionOptions } from "./sessions.js";

/** What the session defaults need from the application host. */
export interface SessionDefaultsContext {
  readonly env: unknown;
  readonly production: boolean;
  readonly prerendering: boolean;
  readonly platform: PlatformName;
  /** `name` of the project's package.json, for the default Redis prefix. */
  readonly appName?: string | undefined;
  /** Imports the project's `redis` package; absent when it is not installed or cannot run (Workers). */
  readonly loadRedis?: (() => Promise<unknown>) | undefined;
}

/** Sessions created by Meeko when `server/runtime.ts` omits them, and the resources to release. */
export interface SessionDefaults {
  readonly sessions: SessionManager<any>;
  readonly close?: () => Promise<void>;
}

/** The part of a node-redis client that the session defaults use. */
interface RedisConnection extends RedisSessionClient, RedisSubscriberClient {
  connect(): Promise<unknown>;
  duplicate(overrides?: Record<string, unknown>): RedisConnection;
  on(event: "error", listener: (error: unknown) => void): unknown;
  close?(): Promise<unknown>;
  destroy?(): unknown;
}

type CreateClient = (options: Record<string, unknown>) => RedisConnection;

const sessionEnvNames = ["MEEKO_SESSION_TTL", "MEEKO_SESSION_SAMESITE"] as const;

/** `MEEKO_SESSION_TTL` and `MEEKO_SESSION_SAMESITE`, validated at startup. */
export function sessionPolicy(env: unknown): Pick<SessionOptions<unknown>, "ttlMs" | "sameSite"> {
  const ttl = envString(env, "MEEKO_SESSION_TTL");
  const sameSite = envString(env, "MEEKO_SESSION_SAMESITE");
  let policySameSite: "Lax" | "Strict" | undefined;
  if (sameSite !== undefined) {
    const normalized = sameSite.toLowerCase();
    if (normalized === "lax") policySameSite = "Lax";
    else if (normalized === "strict") policySameSite = "Strict";
    else throw new TypeError(`MEEKO_SESSION_SAMESITE must be Lax or Strict, not ${JSON.stringify(sameSite)}`);
  }
  return {
    ...(ttl === undefined ? {} : { ttlMs: parseDuration(ttl, "MEEKO_SESSION_TTL") }),
    ...(policySameSite === undefined ? {} : { sameSite: policySameSite }),
  };
}

/** Warns once when the session variables are set but server/runtime.ts declares its own sessions. */
export function warnIgnoredSessionEnv(env: unknown): void {
  for (const name of sessionEnvNames) {
    if (envString(env, name) !== undefined) warnOnce(`session-env:${name}`, `[meeko] ${name} no se aplica: server/runtime.ts declara sus propias sesiones.`);
  }
}

/** Default Redis key prefix: `MEEKO_REDIS_PREFIX`, or `meeko:<package name>:<prod|dev>:`. */
export function redisPrefix(env: unknown, appName: string | undefined, production: boolean): string {
  const configured = envString(env, "MEEKO_REDIS_PREFIX");
  const prefix = configured ?? `meeko:${(appName ?? "app").replace(/\s+/g, "-")}:${production ? "prod" : "dev"}:`;
  if (!prefix.endsWith(":") || /\s/.test(prefix)) throw new TypeError("MEEKO_REDIS_PREFIX must contain no whitespace and end with ':'");
  return prefix;
}

let lastRedisReport = 0;

/** Redis errors repeat on every reconnection attempt: one line every ten seconds is enough. */
function reportRedisError(error: unknown): void {
  const now = Date.now();
  if (now - lastRedisReport < 10_000) return;
  lastRedisReport = now;
  const code = error && typeof error === "object" && "code" in error ? ` ${String((error as { code: unknown }).code)}` : "";
  try { console.error(`[meeko] Redis de las sesiones: ${error instanceof Error ? error.name : "Error"}${code}`); }
  catch { /* A broken console cannot stop the server. */ }
}

async function closeConnection(connection: RedisConnection | undefined): Promise<void> {
  if (!connection) return;
  try {
    if (typeof connection.close === "function") await connection.close();
    else await connection.quit?.();
  } catch {
    connection.destroy?.();
  }
}

/**
 * Sessions when `server/runtime.ts` does not declare them: memory in development and while
 * prerendering; in production, Redis from `MEEKO_REDIS_URL` with revocations across instances.
 * Production never starts without a persistent store.
 */
export async function createSessionDefaults(context: SessionDefaultsContext): Promise<SessionDefaults> {
  const policy = sessionPolicy(context.env);
  if (!context.production || context.prerendering) {
    return { sessions: new SessionManager({ store: new MemorySessionStore(), production: false, ...policy }) };
  }
  const url = envString(context.env, "MEEKO_REDIS_URL");
  if (url === undefined) {
    throw new Error("Production requires a persistent session store: set MEEKO_REDIS_URL (with the redis package installed), or return { sessions } with a persistent SessionStore from server/runtime.ts");
  }
  if (context.platform === "cloudflare") {
    throw new Error("MEEKO_REDIS_URL needs TCP connections, which Cloudflare Workers do not offer: return a SessionManager with SqlSessionStore(new D1SessionDriver(env.DB)), or RedisSessionStore over the Upstash REST API, from server/runtime.ts");
  }
  let protocol: string | undefined;
  try { protocol = new URL(url).protocol; }
  catch { protocol = undefined; }
  // The URL carries the password: it never appears in a message.
  if (protocol !== "redis:" && protocol !== "rediss:") throw new TypeError("MEEKO_REDIS_URL must be a redis:// or rediss:// URL");
  if (!context.loadRedis) {
    throw new Error("MEEKO_REDIS_URL is set but the project does not install the redis package: add it with npm install redis (or pnpm add redis) and build again");
  }
  let createClient: CreateClient | undefined;
  try {
    const module = await context.loadRedis() as { createClient?: unknown; default?: { createClient?: unknown } } | undefined;
    const candidate = module?.createClient ?? module?.default?.createClient;
    if (typeof candidate === "function") createClient = candidate as CreateClient;
  } catch (error) {
    throw new Error("MEEKO_REDIS_URL is set but the redis package could not be loaded: add it with npm install redis (or pnpm add redis)", { cause: error });
  }
  if (!createClient) throw new Error("The redis package does not export createClient; install node-redis 4 or later");
  const prefix = redisPrefix(context.env, context.appName, true);
  let connected = false;
  const client = createClient({
    url,
    // Without a connection, session reads fail at once instead of waiting: requests fail closed.
    disableOfflineQueue: true,
    socket: {
      // The first connection gives up after a few attempts so startup reports it; later drops retry forever.
      reconnectStrategy: (retries: number, cause: unknown) => !connected && retries >= 3 ? (cause instanceof Error ? cause : new Error("Redis connection failed")) : Math.min(2 ** retries * 50, 2000),
    },
  });
  client.on("error", reportRedisError);
  let subscriber: RedisConnection | undefined;
  try {
    await client.connect();
    // A subscribed connection cannot run other commands: revocations get their own.
    subscriber = client.duplicate({ disableOfflineQueue: false });
    subscriber.on("error", reportRedisError);
    await subscriber.connect();
    connected = true;
  } catch (error) {
    await closeConnection(subscriber);
    await closeConnection(client);
    throw new Error("Could not connect to the Redis server of MEEKO_REDIS_URL", { cause: error });
  }
  const store = new RedisSessionStore(client, { prefix, subscriber });
  const connections = { client, subscriber };
  return {
    sessions: new SessionManager({ store, production: true, ...policy }),
    close: async () => {
      // SessionManager.close() already stopped the revocation subscription.
      await closeConnection(connections.subscriber);
      await closeConnection(connections.client);
    },
  };
}
