import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionHandle } from "./sessions.js";
import { defaultPlatform } from "./platform.js";
import type { ServerPlatform } from "./platform.js";

/**
 * Contexto de una petición HTTP: sesión, servicios, plataforma y estado propios de esa petición,
 * nunca compartidos entre usuarios. Lo reciben los loaders, los handlers de API y RPC y los
 * canales Socket.
 *
 * @typeParam TServices Tipo de `services`.
 * @typeParam TEnv Tipo del entorno de la plataforma.
 * @example
 * ```ts
 * import { defineApiRoute } from "@meekojs/meeko/server";
 *
 * export default defineApiRoute({
 *   auth: "required",
 *   handler: async ({ context }) => {
 *     const response = await fetch("https://api.example.com/report", { signal: context.signal });
 *     return { requestId: context.requestId, report: await response.json() };
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#revocación-durante-una-petición
 */
export interface RequestContext<TServices = unknown, TEnv = unknown> {
  /** Petición HTTP original. */
  readonly request: Request;
  /** ID de la petición, que también va en `x-request-id` y llega a `onError`. */
  readonly requestId: string;
  /** Se aborta si el cliente se desconecta o, con `SessionRevokedError`, si se revoca la sesión. */
  readonly signal: AbortSignal;
  /** Servicios de `server/runtime.ts`. */
  readonly services: TServices;
  /** Sesión de la petición: leer, crear, rotar, revocar y verificar. */
  readonly session: SessionHandle;
  /** Estado propio de la petición; véase {@link useRequestState}. */
  readonly state: Map<string, unknown>;
  /** Runtime que atiende la petición, con su entorno y el soporte de trabajo en segundo plano. */
  readonly platform: ServerPlatform<TEnv>;
}

/**
 * Despacha una petición por el pipeline HTTP de la aplicación conservando el contexto de la
 * petición original. La crea {@link createLocalServerFetch} y la usan los clientes de servidor.
 *
 * @example
 * ```ts
 * import type { ServerFetch } from "@meekojs/meeko/server";
 *
 * const logged = (inner: ServerFetch): ServerFetch => async (request, context) => {
 *   const response = await inner(request, context);
 *   console.log(context.requestId, request.method, request.url, response.status);
 *   return response;
 * };
 * ```
 */
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
 * Crea el contexto de una petición para un host propio. Sin plataforma de adaptador recibe una
 * plataforma desacoplada con el entorno vacío. `signal` se aborta si el cliente se desconecta o, con
 * `SessionRevokedError`, si se revoca la familia de la sesión; se combina en el primer acceso.
 *
 * @param request Petición HTTP.
 * @param services Servicios de la petición.
 * @param session Sesión cargada con `SessionManager.load`.
 * @param platform Plataforma del adaptador.
 * @returns El contexto, con un `requestId` nuevo.
 * @example
 * ```ts
 * import { createRequestContext, dispatchApiRoute } from "@meekojs/meeko/server";
 * import usersRoute from "./server/api/users/index.get.js";
 *
 * const session = await sessions.load(request);
 * const context = createRequestContext(request, { db }, session);
 * const response = await dispatchApiRoute(usersRoute, context, sessions);
 * ```
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

/**
 * Devuelve el valor de `key` en el estado de la petición y lo crea con `factory()` la primera vez.
 * Sirve para compartir un valor entre middleware, loaders y handlers de una misma petición, como
 * una caché por petición.
 *
 * @param context Contexto de la petición.
 * @param key Clave del valor.
 * @param factory Crea el valor si no existe.
 * @returns El valor de la petición.
 * @example
 * ```ts
 * import { defineRpc, useRequestState } from "@meekojs/meeko/server";
 *
 * export default defineRpc({
 *   input: userParams,
 *   output: userSchema,
 *   handler: ({ input, context }) => {
 *     const cache = useRequestState(context, "users", () => new Map<string, { id: string; name: string }>());
 *     return cache.get(input.id) ?? { id: input.id, name: "Ada" };
 *   },
 * });
 * ```
 */
export function useRequestState<T>(context: RequestContext, key: string, factory: () => T): T {
  if (!context.state.has(key)) context.state.set(key, factory());
  return context.state.get(key) as T;
}
