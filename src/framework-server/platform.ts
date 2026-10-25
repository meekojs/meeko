/** JavaScript runtimes with a Meeko server adapter. */
export type PlatformName = "node" | "cloudflare" | "deno" | "bun";

/** Host facilities exposed to each request through `RequestContext.platform`. */
export interface ServerPlatform<Env = unknown> {
  readonly name: PlatformName;
  /** Environment variables or runtime bindings supplied by the adapter. */
  readonly env: Env;
  /** Keeps background work alive after the response when the host supports it. */
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
