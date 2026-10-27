import { errorResponse, observeServerError } from "./contracts.js";
import { copySocketAddress } from "./env.js";
import type { ServerApp } from "./app.js";
import type { ServerPlatform } from "./platform.js";

/** Normalizes a configured public origin to `scheme://host[:port]`. */
export function publicOriginOf(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new TypeError(`Invalid publicOrigin: ${value}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("publicOrigin must use HTTP or HTTPS");
  return url.origin;
}

/** Host part of a local URL; wildcard interfaces are reachable through loopback. */
export function visibleHost(host: string): string {
  const visible = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return visible.includes(":") && !visible.startsWith("[") ? `[${visible}]` : visible;
}

/** Moves a request onto the public origin; the Host header never decides policy. */
export function rebaseRequest(request: Request, origin: string | undefined): Request {
  if (!origin) return request;
  const url = new URL(request.url);
  if (url.origin === origin) return request;
  return copySocketAddress(request, new Request(new URL(url.pathname + url.search, origin), request));
}

/** Validates a positive integer adapter option. */
export function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`Invalid ${label}`);
  return value;
}

/** Serves one request through the application; a thrown failure becomes a JSON error response. */
export async function fetchApp(app: ServerApp, request: Request, platform: ServerPlatform, report: (error: unknown, requestId: string) => void): Promise<Response> {
  try { return await app.fetch(request, platform); }
  catch (error) {
    const requestId = crypto.randomUUID();
    observeServerError(error, requestId, report);
    return errorResponse(error, requestId);
  }
}

/** Tracks `waitUntil` work so a graceful shutdown can wait for it. */
export function createTrackedPlatform<Env>(name: ServerPlatform["name"], env: Env, onError: (error: unknown) => void): ServerPlatform<Env> & { settle(): Promise<void> } {
  const pending = new Set<Promise<unknown>>();
  return {
    name,
    env,
    waitUntil(promise) {
      const tracked: Promise<unknown> = Promise.resolve(promise)
        .catch((error: unknown) => onError(error))
        .finally(() => pending.delete(tracked));
      pending.add(tracked);
    },
    async settle() { while (pending.size) await Promise.allSettled([...pending]); },
  };
}
