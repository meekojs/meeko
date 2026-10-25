import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionHandle } from "./sessions.js";
import { defaultPlatform } from "./platform.js";
import type { ServerPlatform } from "./platform.js";

/** State belongs to one HTTP request and is never shared between users. */
export interface RequestContext<TServices = unknown, TEnv = unknown> {
  readonly request: Request;
  readonly requestId: string;
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

/** Without an adapter platform, the context receives a detached platform with an empty environment. */
export function createRequestContext<TServices, TEnv = unknown>(request: Request, services: TServices, session: SessionHandle, platform?: ServerPlatform<TEnv>): RequestContext<TServices, TEnv> {
  return {
    request, requestId: crypto.randomUUID(), signal: request.signal, services, session, state: new Map(),
    platform: platform ?? defaultPlatform() as ServerPlatform<TEnv>,
  };
}

export function useRequestState<T>(context: RequestContext, key: string, factory: () => T): T {
  if (!context.state.has(key)) context.state.set(key, factory());
  return context.state.get(key) as T;
}
