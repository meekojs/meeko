import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionHandle } from "./sessions.js";
import { defaultPlatform } from "./platform.js";
import type { ServerPlatform } from "./platform.js";

/** State belongs to one HTTP request and is never shared between users. */
export interface RequestContext<TServices = unknown, TEnv = unknown> {
  readonly request: Request;
  readonly requestId: string;
  /** Aborts when the client disconnects or, with `SessionRevokedError`, when the session is revoked. */
  readonly signal: AbortSignal;
  readonly services: TServices;
  readonly session: SessionHandle;
  readonly state: Map<string, unknown>;
  /** Runtime hosting this request, with its environment and background work support. */
  readonly platform: ServerPlatform<TEnv>;
}

export type ServerFetch = (request: Request, context: RequestContext) => Promise<Response>;
interface ActiveRequest { readonly context: RequestContext; readonly serverFetch?: ServerFetch }
const activeRequest = new AsyncLocalStorage<ActiveRequest>();

/** Binds automatic server clients to the current request across async work. */
export function withRequestContext<T>(context: RequestContext, serverFetch: ServerFetch | undefined, run: () => T): T {
  return activeRequest.run({ context, ...(serverFetch ? { serverFetch } : {}) }, run);
}

export function currentRequest(): ActiveRequest {
  const active = activeRequest.getStore();
  if (!active) throw new Error("Automatic server clients require an active Meeko request context");
  return active;
}

/** Combined signal of each request signal and session revocation signal, built once per pair. */
const combinedSignals = new WeakMap<AbortSignal, WeakMap<AbortSignal, AbortSignal>>();
/**
 * `AbortSignal.any` holds its sources weakly. Each combined signal keeps its
 * revocation signal, and through it the session's controller, alive so that a
 * callback retaining only `context.signal` still observes the revocation.
 */
const revocationSources = new WeakMap<AbortSignal, AbortSignal>();

function combinedSignal(request: AbortSignal, revocation: AbortSignal): AbortSignal {
  let byRevocation = combinedSignals.get(request);
  if (!byRevocation) { byRevocation = new WeakMap(); combinedSignals.set(request, byRevocation); }
  let signal = byRevocation.get(revocation);
  if (!signal) {
    signal = AbortSignal.any([request, revocation]);
    byRevocation.set(revocation, signal);
    revocationSources.set(signal, revocation);
  }
  return signal;
}

/**
 * Without an adapter platform, the context receives a detached platform with an
 * empty environment. `signal` aborts when the client disconnects or, with
 * `SessionRevokedError`, when the session's family is revoked; it is combined
 * on first access.
 */
export function createRequestContext<TServices, TEnv = unknown>(request: Request, services: TServices, session: SessionHandle, platform?: ServerPlatform<TEnv>): RequestContext<TServices, TEnv> {
  const revocation = (session as Partial<SessionHandle> | undefined)?.signal;
  let signal: AbortSignal | undefined;
  return {
    request, requestId: crypto.randomUUID(), services, session, state: new Map(),
    get signal() { return signal ??= revocation ? combinedSignal(request.signal, revocation) : request.signal; },
    platform: platform ?? defaultPlatform() as ServerPlatform<TEnv>,
  };
}

export function useRequestState<T>(context: RequestContext, key: string, factory: () => T): T {
  if (!context.state.has(key)) context.state.set(key, factory());
  return context.state.get(key) as T;
}
