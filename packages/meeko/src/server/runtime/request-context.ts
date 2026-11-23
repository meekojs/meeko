import { AsyncLocalStorage } from 'node:async_hooks'

import type { DataKey } from '../../framework'
import type { RequestCookies, ResponseHeaders } from './cookies'
import type { ContextServices } from './definition'
import type { ServerPlatform } from './platform'
import type { SessionData, SessionHandle } from './sessions'

import { checkDataKey } from '../../shared/invalidation'
import { ResponseState } from './cookies'
import { clientAddressOf, requestEnvironmentOf } from './env'
import { defaultPlatform } from './platform'
import { takeScopedRequestId } from './process-errors'
import { disabledSessionError, isDisabledSession } from './sessions'

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
export interface RequestContext<out TServices = unknown, TEnv = unknown> {
	// `out`: a context compares by its services type, so one with any services still goes where a
	// `RequestContext` (services `unknown`, read as AppServices) is expected, as before 1.7.
	/** Petición HTTP original. */
	readonly request: Request
	/** ID de la petición, que también va en `x-request-id` y llega a `onError`. */
	readonly requestId: string
	/** Se aborta si el cliente se desconecta o, con `SessionRevokedError`, si se revoca la sesión. */
	readonly signal: AbortSignal
	/**
	 * Servicios de `server/runtime.ts`. Sin `TServices` (o con `unknown`), desde `1.7` su tipo es
	 * `AppServices`, el que Meeko infiere de `server/runtime.ts`.
	 */
	readonly services: ContextServices<TServices>
	/**
	 * Sesión de la petición: leer, crear, rotar, revocar y verificar. Sus datos tienen el tipo de
	 * `MeekoSession` cuando la aplicación lo declara (desde `1.2`), o `unknown`. Desde `1.10`, si
	 * `server/runtime.ts` devuelve `sessions: false`, leerla lanza un error que lo explica.
	 */
	readonly session: SessionHandle<SessionData>
	/**
	 * Cookies de la petición (desde `1.10`): lee las del navegador y escribe las de la respuesta, con
	 * `HttpOnly`, `SameSite=Lax`, `Path=/` y `Secure` por defecto. Véase {@link RequestCookies}.
	 */
	readonly cookies: RequestCookies
	/**
	 * Cabeceras que esta petición añade a su respuesta (desde `1.10`), sea cual sea: JSON, una
	 * redirección, un error o una página. Véase {@link ResponseHeaders}.
	 */
	readonly responseHeaders: ResponseHeaders
	/**
	 * Marca claves de datos como cambiadas por esta escritura (desde `1.10`), además de las de
	 * `invalidates`, como `` context.invalidate(`orders.${id}`) ``. Sólo viajan, en la cabecera
	 * `x-meeko-invalidate`, con la respuesta correcta de una mutación de API o RPC; un error no
	 * invalida nada.
	 */
	readonly invalidate: (...keys: DataKey[]) => void
	/** Estado propio de la petición; véase {@link useRequestState}. */
	readonly state: Map<string, unknown>
	/** Runtime que atiende la petición, con su entorno y el soporte de trabajo en segundo plano. */
	readonly platform: ServerPlatform<TEnv>
	/**
	 * Clave de idempotencia de la cabecera `Idempotency-Key` (borrador del IETF), validada como UUID
	 * y en minúsculas; `undefined` si no llegó o no es un UUID. La envían las mutaciones `retrySafe`
	 * y es la misma en cada reintento de una intención. Meeko no deduplica: guárdela con el resultado
	 * (por ejemplo, en una columna única) y responda lo mismo cuando se repita. Desde `1.2`.
	 */
	readonly idempotencyKey?: string | undefined
	/**
	 * IP del cliente (desde `1.2`): la de la conexión que entrega el adaptador o, con
	 * `MEEKO_TRUST_PROXY`, la que añadió a `X-Forwarded-For` el proxy de confianza más externo o
	 * (con `cloudflare`, desde `1.8`) la de `CF-Connecting-IP`. `undefined` si no se conoce. Sin
	 * `MEEKO_TRUST_PROXY`, `X-Forwarded-For` nunca se lee, porque cualquier cliente puede enviarlo. La usa `rateLimit` y sirve para registros y auditoría. Fuera
	 * de un contexto, como en un middleware de servidor, la misma IP la da {@link clientAddress}.
	 */
	readonly clientAddress?: string | undefined
}

/**
 * IP del cliente de una petición (desde `1.7`), con la misma política que `context.clientAddress`
 * y `rateLimit`: la de la conexión que entrega el adaptador (el socket en Node, Bun y Deno;
 * `CF-Connecting-IP` en Workers) o, con `MEEKO_TRUST_PROXY`, la entrada de `X-Forwarded-For` que
 * añadió el proxy de confianza más externo (la `n`-ésima desde la derecha), sin su puerto. Sin
 * `MEEKO_TRUST_PROXY`, `X-Forwarded-For` nunca se lee, porque cualquier cliente puede enviarlo.
 *
 * Con `MEEKO_TRUST_PROXY=cloudflare` (desde `1.8`), tras Cloudflare Tunnel (`cloudflared`) y un
 * proxy como Traefik, es la IP de `CF-Connecting-IP` (o, si falta, de `True-Client-IP`), pero sólo
 * si la conexión y cada salto de `X-Forwarded-For` vienen de las redes de `MEEKO_TRUSTED_PROXIES`
 * (por defecto, loopback y redes privadas). Si un salto viene de fuera, ese salto es el cliente; si
 * la conexión viene de fuera o la cabecera no es una única IP, la de la conexión.
 * Sirve donde no hay `RequestContext`, como en `defineServerMiddleware` o en el handler de
 * `addServerHandler` de un módulo; en el resto, use `context.clientAddress`.
 *
 * Sin `env`, aplica el `MEEKO_TRUST_PROXY` del entorno (`platform.env`) de la aplicación que atiende
 * la petición, también en la petición nueva que un middleware pasa a `next()`. Una petición que no
 * atiende un `ServerApp` sólo usa la IP de la conexión, salvo que reciba `env`.
 *
 * @param request Petición que recibe el middleware o el handler.
 * @param env Entorno del que leer `MEEKO_TRUST_PROXY` y `MEEKO_TRUSTED_PROXIES`, como
 * `process.env`; por defecto, el de la aplicación que atiende la petición.
 * @returns La IP normalizada (IPv6 en minúsculas, IPv4 mapeada como IPv4), o `undefined` si no se
 * conoce.
 * @throws {TypeError} Si `MEEKO_TRUST_PROXY` o `MEEKO_TRUSTED_PROXIES` no son válidas.
 * @since 1.7.0
 * @example
 * ```ts
 * // server/middleware/10-visitor.ts
 * import { clientAddress, defineServerMiddleware } from "@meekojs/meeko/server";
 *
 * export default defineServerMiddleware((request, next) => {
 *   // Tras Traefik con MEEKO_TRUST_PROXY=1, la IP del cliente y no la del proxy.
 *   const ip = clientAddress(request) ?? "desconocida";
 *   console.log(`${request.method} ${new URL(request.url).pathname} desde ${ip}`);
 *   return next();
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#ip-del-cliente-tras-un-proxy
 */
export function clientAddress(request: Request, env?: unknown): string | undefined {
	return clientAddressOf(request, env === undefined ? requestEnvironmentOf(request)?.env : env)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The `Idempotency-Key` of a request, as a lowercase UUID. The IETF draft defines the header as a
 * Structured Field string (`"…"`); a bare value is accepted too.
 */
export function idempotencyKeyOf(request: Request): string | undefined {
	const header = request.headers.get('idempotency-key')?.trim()
	if (!header) return undefined
	const value = header.length > 1 && header.startsWith('"') && header.endsWith('"') ? header.slice(1, -1) : header
	return UUID.test(value) ? value.toLowerCase() : undefined
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
export type ServerFetch = (request: Request, context: RequestContext) => Promise<Response>
interface ActiveRequest {
	readonly context: RequestContext
	readonly serverFetch?: ServerFetch
}
const activeRequest = new AsyncLocalStorage<ActiveRequest>()

/** Binds automatic server clients to the current request across async work. */
export function withRequestContext<T>(context: RequestContext, serverFetch: ServerFetch | undefined, run: () => T): T {
	return activeRequest.run({ context, ...(serverFetch ? { serverFetch } : {}) }, run)
}

export function currentRequest(): ActiveRequest {
	const active = activeRequest.getStore()
	if (!active) throw new Error('Automatic server clients require an active Meeko request context')
	return active
}

/** The active request of this async flow, if any (no error). */
export function activeRequestOf(): ActiveRequest | undefined {
	return activeRequest.getStore()
}

/**
 * Devuelve el contexto de la petición en curso desde cualquier función de servidor, sin recibirlo
 * como argumento: el `<script server>` y el `load` de una página, el middleware de ruta y los
 * handlers de `defineRpc` y `defineApiRoute`, también tras un `await`. Es el mismo objeto que
 * reciben esas piezas como `context`. Fuera de una petición (al cargar un módulo, en un
 * `setTimeout` que sobrevive a la petición o en `defineServerMiddleware`, que corre antes de crear
 * el contexto) lanza un error.
 *
 * @since 1.10.0
 * @returns El contexto de la petición en curso.
 * @throws {Error} Si no hay ninguna petición en curso.
 * @example
 * ```ts
 * import { getRequestContext, useRequestState } from "@meekojs/meeko/server";
 *
 * export function currentUserId(): string | undefined {
 *   const context = getRequestContext();
 *   return useRequestState(context, "user:id", () => context.cookies.get("uid"));
 * }
 * ```
 */
export function getRequestContext<TServices = unknown, TEnv = unknown>(): RequestContext<TServices, TEnv> {
	const active = activeRequest.getStore()
	if (!active) throw new Error('getRequestContext() sólo funciona durante una petición: en una página, un loader, un middleware de ruta o un handler de API o RPC.')
	return active.context as RequestContext<TServices, TEnv>
}

/** Combined signal of each request signal and session revocation signal, built once per pair. */
const combinedSignals = new WeakMap<AbortSignal, WeakMap<AbortSignal, AbortSignal>>()
/**
 * `AbortSignal.any` holds its sources weakly. Each combined signal keeps its
 * revocation signal, and through it the session's controller, alive so that a
 * callback retaining only `context.signal` still observes the revocation.
 */
const revocationSources = new WeakMap<AbortSignal, AbortSignal>()

function combinedSignal(request: AbortSignal, revocation: AbortSignal): AbortSignal {
	let byRevocation = combinedSignals.get(request)
	if (!byRevocation) {
		byRevocation = new WeakMap()
		combinedSignals.set(request, byRevocation)
	}
	let signal = byRevocation.get(revocation)
	if (!signal) {
		signal = AbortSignal.any([request, revocation])
		byRevocation.set(revocation, signal)
		revocationSources.set(signal, revocation)
	}
	return signal
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
	return buildRequestContext(request, services, session, platform)
}

/** The handle of a context, also when `context.session` throws (`sessions: false`). Internal. */
export const contextSession: unique symbol = Symbol.for('meeko.context.session') as never
/** The cookies and response headers of a context, shared by the contexts derived from it. Internal. */
export const contextResponse: unique symbol = Symbol.for('meeko.context.response') as never

type InternalContext = RequestContext<unknown, unknown> & { readonly [contextSession]?: SessionHandle<any>; readonly [contextResponse]?: ResponseState }

/** The session handle of a context for Meeko's own reads: it never throws, also with `sessions: false`. */
export function sessionOf(context: RequestContext<unknown, unknown>): SessionHandle<any> {
	return (context as InternalContext)[contextSession] ?? context.session
}

/** The cookies and response headers of a context, if Meeko created it. */
export function responseStateOf(context: RequestContext<unknown, unknown>): ResponseState | undefined {
	return (context as InternalContext)[contextResponse]
}

/** The data keys a request invalidated, shared by the contexts derived from it. */
const invalidatedKeys = new WeakMap<object, Set<string>>()

/** The set of data keys a request invalidated, created on first use. Internal. */
export function invalidatedKeysOf(context: RequestContext<unknown, unknown>): Set<string> {
	const owner: object = responseStateOf(context) ?? context
	let keys = invalidatedKeys.get(owner)
	if (!keys) invalidatedKeys.set(owner, (keys = new Set()))
	return keys
}

/** Adds what the request wrote with `cookies` and `responseHeaders` to a response's headers. */
export function applyResponseState(headers: Headers, context: RequestContext<unknown, unknown>): void {
	responseStateOf(context)?.applyTo(headers)
}

/**
 * A copy of `context` with some fields replaced, such as the request of a local API call. Unlike a
 * spread, it keeps the getters, so `session` still throws with `sessions: false`; the cookies and
 * response headers stay those of the original request.
 */
export function deriveContext<TServices, TEnv>(context: RequestContext<TServices, TEnv>, fields: Partial<Pick<RequestContext<TServices, TEnv>, 'request' | 'signal' | 'idempotencyKey'>>): RequestContext<TServices, TEnv> {
	const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(context)
	for (const key of Reflect.ownKeys(descriptors)) descriptors[key as string] = { ...descriptors[key as string], configurable: true }
	const derived = Object.defineProperties({}, descriptors) as RequestContext<TServices, TEnv>
	for (const [key, value] of Object.entries(fields)) Object.defineProperty(derived, key, { value, enumerable: true, configurable: true, writable: false })
	return derived
}

/** Options of {@link buildRequestContext}. */
export interface RequestContextInit {
	/** The cookies and headers of this request, already given to the services factory. */
	readonly response?: ResponseState | undefined
	/** Default `Secure` of new cookies; `true` when absent. */
	readonly secureCookies?: boolean | undefined
	/** A Socket handshake: cookies and headers can only be read. */
	readonly readOnly?: boolean | undefined
}

/** {@link createRequestContext} with the response state Meeko's hosts share with their services. */
export function buildRequestContext<TServices, TEnv = unknown>(request: Request, services: TServices, session: SessionHandle<any>, platform?: ServerPlatform<TEnv>, init: RequestContextInit = {}): RequestContext<TServices, TEnv> {
	const revocation = (session as Partial<SessionHandle> | undefined)?.signal
	let signal: AbortSignal | undefined
	const resolvedPlatform = platform ?? (defaultPlatform() as ServerPlatform<TEnv>)
	let address: { readonly value: string | undefined } | undefined
	const response = init.response ?? new ResponseState(request, { secure: init.secureCookies ?? true, sessionCookieName: sessionCookieNameOf(session), readOnly: init.readOnly })
	const context = {
		// The first context of a ServerApp request takes the ID its process failures carry.
		// `services` is the written type unless it is `unknown`, which ContextServices resolves.
		request,
		requestId: takeScopedRequestId() ?? crypto.randomUUID(),
		services: services as ContextServices<TServices>,
		session,
		state: new Map(),
		get signal() {
			return (signal ??= revocation ? combinedSignal(request.signal, revocation) : request.signal)
		},
		platform: resolvedPlatform,
		idempotencyKey: idempotencyKeyOf(request),
		get clientAddress() {
			return (address ??= { value: clientAddressOf(request, resolvedPlatform.env) }).value
		},
		cookies: response.cookies,
		responseHeaders: response.headers,
		invalidate: (...keys: DataKey[]): void => {
			const target = invalidatedKeysOf(context)
			for (const key of keys) target.add(checkDataKey(key, 'context.invalidate()'))
		},
		[contextSession]: session,
		[contextResponse]: response,
	}
	// Without Meeko sessions, any use of context.session explains why instead of reading undefined.
	// Not enumerable, so spreading the context does not throw.
	if (isDisabledSession(session)) {
		Object.defineProperty(context, 'session', {
			get() {
				throw disabledSessionError()
			},
			enumerable: false,
			configurable: true,
		})
	}
	return context
}

/** The Meeko session cookie of a handle, which `context.cookies` reads but never writes. */
function sessionCookieNameOf(session: SessionHandle<unknown> | undefined): string | undefined {
	if (isDisabledSession(session)) return undefined
	const manager = (session as unknown as { readonly manager?: { readonly cookieName?: unknown } } | undefined)?.manager
	return typeof manager?.cookieName === 'string' ? manager.cookieName : undefined
}
