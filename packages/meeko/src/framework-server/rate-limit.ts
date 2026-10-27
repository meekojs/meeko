import { encodeBase64Url } from "./base64url.js";
import type { RequestContext } from "./context.js";
import { addressBucket, parseDuration, warnOnce } from "./env.js";

/**
 * Límite de peticiones de un endpoint de API o un procedimiento RPC (desde `1.2`): como mucho
 * `limit` peticiones por ventana fija de `window`. Por encima, la respuesta es
 * `429 RATE_LIMITED` con `Retry-After`, antes de validar la entrada y de ejecutar el handler.
 *
 * Sin `key`, cada IP de cliente tiene su contador (las IPv6 por su red /64) cuando Meeko la conoce:
 * la de la conexión o, con `MEEKO_TRUST_PROXY`, la de `X-Forwarded-For`. Si no la conoce, todos los
 * clientes comparten el contador de la ruta.
 *
 * @typeParam S Tipo de los servicios.
 * @since 1.2.0
 * @example
 * ```ts
 * import type { RateLimitOptions } from "@meekojs/meeko/server";
 *
 * const login: RateLimitOptions = { limit: 5, window: "5m" };
 * const perUser: RateLimitOptions = { limit: 100, window: "1h", key: ({ session }) => String(session.current?.id ?? "anon") };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#límite-de-peticiones-ratelimit
 */
export interface RateLimitOptions<S = unknown> {
  /** Peticiones permitidas en cada ventana; un entero positivo. */
  readonly limit: number;
  /** Duración de la ventana: milisegundos o un texto como `"30s"`, `"5m"`, `"1h"` o `"1d"`. */
  readonly window: number | string;
  /**
   * Clave del contador dentro de la ruta, en lugar de la IP del cliente; por ejemplo, el usuario de
   * la sesión. Se ejecuta antes de validar la entrada, así que no recibe el cuerpo.
   */
  readonly key?: (context: RequestContext<S>) => string | Promise<string>;
}

/**
 * Resultado de contar una petición en una ventana fija: el total de la ventana, incluida esta, y
 * los milisegundos que faltan para que empiece la siguiente. Lo devuelve
 * `SessionStore.rateLimit`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { RateLimitHit } from "@meekojs/meeko/server";
 *
 * const hit: RateLimitHit = await store.rateLimit("login:203.0.113.7", 300_000);
 * if (hit.count > 5) console.warn(`bloqueado ${Math.ceil(hit.resetInMs / 1000)} s`);
 * ```
 */
export interface RateLimitHit {
  /** Peticiones contadas en la ventana actual, incluida esta. */
  readonly count: number;
  /** Milisegundos hasta que empieza la siguiente ventana. */
  readonly resetInMs: number;
}

/** Entries kept by an in-memory counter before the oldest are dropped. */
const maxMemoryWindows = 100_000;

/** Fixed-window counters in memory, for development and stores without `rateLimit`. */
export class MemoryRateCounter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private sweepAt = 1024;
  hit(key: string, windowMs: number): RateLimitHit {
    const now = Date.now();
    let entry = this.windows.get(key);
    if (!entry || entry.resetAt <= now) {
      this.windows.delete(key);
      entry = { count: 0, resetAt: now + windowMs };
      this.windows.set(key, entry);
      if (this.windows.size >= this.sweepAt) this.sweep(now);
    }
    entry.count++;
    return { count: entry.count, resetInMs: entry.resetAt - now };
  }
  private sweep(now: number): void {
    for (const [key, entry] of this.windows) if (entry.resetAt <= now) this.windows.delete(key);
    // Insertion order is creation order: past the cap, the oldest windows go first.
    for (const key of this.windows.keys()) {
      if (this.windows.size <= maxMemoryWindows) break;
      this.windows.delete(key);
    }
    this.sweepAt = Math.max(1024, this.windows.size * 2);
  }
  clear(): void { this.windows.clear(); }
}

/** Shared by session managers whose store cannot count, such as `SqlSessionStore`. */
const fallbackCounter = new MemoryRateCounter();

/** Counts one hit for a manager or store that may lack `rateLimit`; the store's own errors propagate. */
export async function countRateLimit(source: { rateLimit?(key: string, windowMs: number): Promise<RateLimitHit> } | undefined, key: string, windowMs: number, production: boolean): Promise<RateLimitHit> {
  if (source && typeof source.rateLimit === "function") {
    const hit = await source.rateLimit(key, windowMs);
    if (!hit || !Number.isSafeInteger(hit.count) || hit.count < 1 || typeof hit.resetInMs !== "number" || !Number.isFinite(hit.resetInMs)) {
      throw new TypeError("SessionStore.rateLimit must resolve { count, resetInMs }");
    }
    return hit;
  }
  if (production) warnOnce("rate-limit:memory", "[meeko] El store de sesiones no implementa rateLimit: los límites de rateLimit se cuentan en la memoria de cada instancia.");
  return fallbackCounter.hit(key, windowMs);
}

/** A rejected request: `429 RATE_LIMITED`, with the seconds to wait in `Retry-After`. */
export function retryAfterSeconds(resetInMs: number): number {
  return Math.max(1, Math.ceil(resetInMs / 1000));
}

/** The validated limit and window of a route, or `undefined` when they are invalid. */
export function rateLimitSettings(options: RateLimitOptions<never>): { limit: number; windowMs: number } | undefined {
  if (!options || typeof options !== "object" || !Number.isSafeInteger(options.limit) || options.limit < 1) return undefined;
  try { return { limit: options.limit, windowMs: parseDuration(options.window, "rateLimit.window") }; }
  catch { return undefined; }
}

/** Store key of a counter: a digest, so neither addresses nor app keys are stored in clear. */
export async function rateLimitKey(route: string, subject: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${route}\0${subject}`));
  return encodeBase64Url(new Uint8Array(digest));
}

/** The counter subject of a request: the app's key, the client's network, or the shared route bucket. */
export async function rateLimitSubject<S>(options: RateLimitOptions<S>, context: RequestContext<S>): Promise<string | undefined> {
  if (options.key) {
    const key = await options.key(context);
    return typeof key === "string" && key.length > 0 ? `key:${key}` : undefined;
  }
  const address = context.clientAddress;
  return address ? `ip:${addressBucket(address)}` : "global";
}
