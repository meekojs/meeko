/**
 * Runtime de JavaScript con adaptador de servidor de Meeko. Puede ganar miembros en un minor.
 *
 * @example
 * ```ts
 * import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
 * import type { PlatformName } from "@meekojs/meeko/server";
 *
 * const edge: readonly PlatformName[] = ["cloudflare", "deno"];
 * export default defineServerRuntime(({ platform }) => ({
 *   sessions: new SessionManager({ store: new MemorySessionStore(), production: false }),
 *   services: { edge: edge.includes(platform) },
 * }));
 * ```
 */
export type PlatformName = "node" | "cloudflare" | "deno" | "bun";

/**
 * Servicios del host que recibe cada petición en `RequestContext.platform`.
 *
 * @typeParam Env Tipo de las variables o bindings del entorno.
 * @example
 * ```ts
 * import { defineApiRoute } from "@meekojs/meeko/server";
 *
 * export default defineApiRoute({
 *   handler: ({ context }) => {
 *     context.platform.waitUntil(fetch("https://metrics.example.com/hit", { method: "POST" }));
 *     return { platform: context.platform.name };
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#runtime-de-servidor
 */
export interface ServerPlatform<Env = unknown> {
  /** Runtime que ejecuta la aplicación. */
  readonly name: PlatformName;
  /** Variables de entorno o bindings del runtime que entrega el adaptador. */
  readonly env: Env;
  /** Mantiene vivo un trabajo en segundo plano tras la respuesta, cuando el host lo permite. */
  waitUntil(promise: Promise<unknown>): void;
}

/** Identifies the current runtime without importing runtime-specific modules. */
export function detectPlatformName(): PlatformName {
  const scope = globalThis as { Bun?: unknown; Deno?: unknown; navigator?: { userAgent?: unknown } };
  if (scope.Bun) return "bun";
  if (scope.Deno) return "deno";
  if (scope.navigator?.userAgent === "Cloudflare-Workers") return "cloudflare";
  return "node";
}

/** A platform for hosts that cannot extend a request beyond its response. */
export function createDetachedPlatform<Env>(env: Env, name: PlatformName = detectPlatformName()): ServerPlatform<Env> {
  return {
    name,
    env,
    waitUntil(promise) {
      void Promise.resolve(promise).catch((error: unknown) => {
        try { console.error("[meeko] background task failed", error instanceof Error ? error.name : typeof error); }
        catch { /* A broken console cannot surface as an unhandled rejection. */ }
      });
    },
  };
}

let detached: ServerPlatform | undefined;

/** Shared default for contexts created without an adapter. */
export function defaultPlatform(): ServerPlatform {
  detached ??= createDetachedPlatform<unknown>({});
  return detached;
}
