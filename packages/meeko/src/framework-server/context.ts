import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionData, SessionHandle } from "./sessions.js";
import { clientAddressOf } from "./env.js";
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
  /**
   * Sesión de la petición: leer, crear, rotar, revocar y verificar. Sus datos tienen el tipo de
   * `MeekoSession` cuando la aplicación lo declara (desde `1.2`), o `unknown`.
   */
  readonly session: SessionHandle<SessionData>;
  /** Estado propio de la petición; véase {@link useRequestState}. */
  readonly state: Map<string, unknown>;
  /** Runtime que atiende la petición, con su entorno y el soporte de trabajo en segundo plano. */
  readonly platform: ServerPlatform<TEnv>;
  /**
   * Clave de idempotencia de la cabecera `Idempotency-Key` (borrador del IETF), validada como UUID
   * y en minúsculas; `undefined` si no llegó o no es un UUID. La envían las mutaciones `retrySafe`
   * y es la misma en cada reintento de una intención. Meeko no deduplica: guárdela con el resultado
   * (por ejemplo, en una columna única) y responda lo mismo cuando se repita. Desde `1.2`.
   */
  readonly idempotencyKey?: string | undefined;
  /**
   * IP del cliente (desde `1.2`): la de la conexión que entrega el adaptador o, con
   * `MEEKO_TRUST_PROXY`, la que añadió a `X-Forwarded-For` el proxy de confianza más externo.
   * `undefined` si no se conoce. Sin `MEEKO_TRUST_PROXY`, `X-Forwarded-For` nunca se lee, porque
   * cualquier cliente puede enviarlo. La usa `rateLimit` y sirve para registros y auditoría.
   */
  readonly clientAddress?: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `Idempotency-Key` of a request, as a lowercase UUID. The IETF draft defines the header as a
 * Structured Field string (`"…"`); a bare value is accepted too.
 */
export function idempotencyKeyOf(request: Request): string | undefined {
  const header = request.headers.get("idempotency-key")?.trim();
  if (!header) return undefined;
  const value = header.length > 1 && header.startsWith('"') && header.endsWith('"') ? header.slice(1, -1) : header;
  return UUID.test(value) ? value.toLowerCase() : undefined;
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
export function createRequestContext<TServices, TEnv = unknown>(request: Request, services: TServices, session: SessionHandle<any>, platform?: ServerPlatform<TEnv>): RequestContext<TServices, TEnv> {
  const revocation = (session as Partial<SessionHandle> | undefined)?.signal;
  let signal: AbortSignal | undefined;
  const resolvedPlatform = platform ?? defaultPlatform() as ServerPlatform<TEnv>;
  let address: { readonly value: string | undefined } | undefined;
  return {
    request, requestId: crypto.randomUUID(), services, session, state: new Map(),
    get signal() { return signal ??= revocation ? combinedSignal(request.signal, revocation) : request.signal; },
    platform: resolvedPlatform,
    idempotencyKey: idempotencyKeyOf(request),
    get clientAddress() { return (address ??= { value: clientAddressOf(request, resolvedPlatform.env) }).value; },
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
