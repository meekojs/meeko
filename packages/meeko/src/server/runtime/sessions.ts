import type { Unsubscribe } from '../socket/runtime'
import type { DevAllowedHosts } from './dev-hosts'
import type { RateLimitHit } from './rate-limit'
import type { RequestContext } from './request-context'

import { ApiError, SessionRevokedError, SessionSecurityError } from '../errors'
import { encodeBase64Url } from './base64url'
import { isDevOriginAllowed, rejectedDevOriginMessage } from './dev-hosts'
import { warnOnce } from './env'
import { countRateLimit, MemoryRateCounter } from './rate-limit'

/**
 * Forma de los datos de sesión de la aplicación (desde `1.2`). Está vacía: la aplicación la
 * declara una vez con una aumentación de módulo y, a partir de ahí, `context.session.current.data`
 * y `context.session.create(data)` quedan tipados en páginas, API, RPC, Socket, `authorize` y
 * `locals`. Sin declaración, los datos son `unknown`. El tipo no valida en ejecución.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * // server/types/session.d.ts
 * import type {} from "@meekojs/meeko/server";
 * declare module "@meekojs/meeko/server" {
 *   interface MeekoSession { user: string; role: "owner" | "staff" }
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#tipos-de-la-sesión-meekosession
 */
// Empty on purpose: applications add their fields through module augmentation.
export interface MeekoSession {}

/**
 * Datos de la sesión de la aplicación (desde `1.2`): {@link MeekoSession} si la aplicación la
 * declara, o `unknown` si no. Es el tipo de `RequestContext.session.current.data`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { SessionData } from "@meekojs/meeko/server";
 *
 * export function ownerOf(data: SessionData): string | undefined {
 *   return data.role === "owner" ? data.user : undefined;
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#tipos-de-la-sesión-meekosession
 */
export type SessionData = [keyof MeekoSession] extends [never] ? unknown : MeekoSession

/**
 * Registro de una sesión en el store. El ID es opaco y aleatorio; `familyId` se conserva al rotar.
 *
 * @typeParam T Datos de la aplicación en la sesión.
 * @example
 * ```ts
 * const handle = context.session;
 * const record = await handle.create({ userId: "u_123" });
 * console.log(record.id !== record.familyId, new Date(record.expiresAt));
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sesiones-y-seguridad
 */
export interface SessionRecord<T = unknown> {
	/** ID opaco de la sesión, el valor de la cookie. */
	id: string
	/** Linaje opaco y estable para revocar de forma atómica tras una o varias rotaciones. */
	familyId?: string
	/** Token CSRF de la sesión; cambia en cada rotación. */
	csrfToken: string
	/** Datos de la aplicación. */
	data: T
	/** Fecha de creación, en milisegundos desde la época. */
	createdAt: number
	/** Fecha de caducidad, en milisegundos desde la época. */
	expiresAt: number
	/**
	 * Duración propia de la sesión en milisegundos, fijada con `create(data, { ttlMs })`; `rotate()`
	 * la conserva. Sin ella, la sesión usa `SessionManager.ttlMs`.
	 * @since 1.2.0
	 */
	ttlMs?: number
}

/**
 * Opciones de `SessionHandle.create`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { SessionCreateOptions } from "@meekojs/meeko/server";
 *
 * const staff: SessionCreateOptions = { ttlMs: 12 * 60 * 60 * 1000 };
 * await context.session.create({ userId: "u_123", role: "staff" }, staff);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#duración-de-cada-sesión
 */
export interface SessionCreateOptions {
	/**
	 * Duración de esta sesión en milisegundos, un entero positivo. Fija la caducidad en el store y el
	 * `Max-Age` de la cookie, y se conserva al rotar. Por defecto, `SessionManager.ttlMs`.
	 */
	readonly ttlMs?: number
}

function validTtl(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * @internal The hosts of `dev.allowedHosts` and `MEEKO_ALLOWED_HOSTS`, which `createServerApp`
 * gives the app's manager outside production (`ServerAppOptions.devAllowedHosts`). Read it from
 * the manager; a production manager never has it.
 */
export const devAllowedHosts: unique symbol = Symbol.for('meeko.session.devAllowedHosts') as never

/** @internal Sets {@link devAllowedHosts} on a manager that is not in production. */
export const allowDevHosts: unique symbol = Symbol.for('meeko.session.allowDevHosts') as never

/**
 * Whether `Origin` is the request's own origin (the public origin behind `createServerApp`) or
 * one of `allowedOrigins`. A missing Origin is never allowed. With `dev` (only `meeko dev` passes
 * it), an origin that `dev.allowedHosts` names also passes, and a refusal warns once per origin
 * with the option that allows it.
 */
export function isAllowedOrigin(request: Request, allowedOrigins: readonly string[], dev?: DevAllowedHosts): boolean {
	const origin = request.headers.get('origin')
	if (origin !== null && (origin === new URL(request.url).origin || allowedOrigins.includes(origin))) return true
	if (dev === undefined) return false
	if (origin !== null && isDevOriginAllowed(origin, request.url, dev)) return true
	warnOnce(`dev-origin:${origin ?? ''}`, rejectedDevOriginMessage(origin))
	return false
}

/**
 * Whether a mutation may run: {@link isAllowedOrigin} with the allowed origins of a manager, and its
 * dev hosts if it has them. Since 1.10 Fetch Metadata comes first: when the browser marks the
 * request `cross-site` or `same-site` (`Sec-Fetch-Site`), only an origin the application lists
 * (`allowedOrigins`, or `dev.allowedHosts` in `meeko dev`) passes, whatever `Origin` claims.
 * `same-origin`, `none` and a request without the header (an older browser, a script, the SSR
 * clients) are decided by `Origin` alone, as before.
 */
export function isSessionOriginAllowed(request: Request, sessions: Pick<SessionManager, 'allowedOrigins'>): boolean {
	const allowed = sessions.allowedOrigins ?? []
	const dev = (sessions as { [devAllowedHosts]?: DevAllowedHosts })[devAllowedHosts]
	const site = request.headers.get('sec-fetch-site')?.trim().toLowerCase()
	if (site === 'cross-site' || site === 'same-site') {
		const origin = request.headers.get('origin')
		if (origin !== null && allowed.includes(origin)) return true
		if (dev !== undefined && origin !== null && isDevOriginAllowed(origin, request.url, dev)) return true
		if (dev !== undefined) warnOnce(`fetch-site:${origin ?? ''}`, `[meeko] Mutación rechazada (403 INVALID_ORIGIN): el navegador la marca Sec-Fetch-Site: ${site} y su Origin (${origin ?? 'ninguno'}) no está en allowedOrigins.`)
		return false
	}
	return isAllowedOrigin(request, allowed, dev)
}

/**
 * Almacén de sesiones. En producción `SessionManager` exige `persistent: true`, `replace` atómico y
 * `revokeFamily`. Meeko incluye `MemorySessionStore` (desarrollo), `RedisSessionStore` y
 * `SqlSessionStore`.
 *
 * @typeParam T Datos de la aplicación en la sesión.
 * @example
 * ```ts
 * import type { SessionRecord, SessionStore } from "@meekojs/meeko/server";
 *
 * class LoggingStore<T> implements SessionStore<T> {
 *   readonly persistent = true;
 *   constructor(private readonly inner: Required<SessionStore<T>>) {}
 *   get(id: string) { return this.inner.get(id); }
 *   set(record: SessionRecord<T>) { return this.inner.set(record); }
 *   delete(id: string) { return this.inner.delete(id); }
 *   replace(previousId: string, record: SessionRecord<T>) { return this.inner.replace(previousId, record); }
 *   async revokeFamily(familyId: string) { console.info("revoke", familyId); await this.inner.revokeFamily(familyId); }
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sesiones-y-seguridad
 */
export interface SessionStore<T = unknown> {
	/** Declara de forma explícita que los registros sobreviven a los reinicios del proceso. */
	readonly persistent?: boolean
	/** Lee la sesión activa con ese ID, o `undefined` si no existe, caducó o ya no es la activa de su familia. */
	get(id: string): Promise<SessionRecord<T> | undefined>
	/** Guarda una sesión nueva. */
	set(record: SessionRecord<T>): Promise<void>
	/** Borra una sesión. */
	delete(id: string): Promise<void>
	/** Sustituye de forma atómica un ID existente de la misma familia; `false` si ya no existe. */
	replace?(previousId: string, record: SessionRecord<T>): Promise<boolean>
	/** Revoca de forma atómica el ID activo de la familia, aunque el handle sea anterior a una rotación. */
	revokeFamily?(familyId: string): Promise<void>
	/**
	 * Notifica las llamadas a `revokeFamily` de todas las instancias que comparten el store, para que
	 * se detengan las peticiones en curso y los sockets de esa familia. Se resuelve cuando las
	 * notificaciones ya llegan.
	 */
	subscribeRevocations?(listener: (familyId: string) => void): Unsubscribe | Promise<Unsubscribe>
	/**
	 * Cuenta una petición en la ventana fija `key` de `windowMs` milisegundos y devuelve el total de
	 * la ventana y cuánto falta para la siguiente (desde `1.2`). Lo usa la opción `rateLimit` de API y
	 * RPC; debe ser atómico entre instancias y rechazar si el almacenamiento falla, para que la
	 * petición se rechace. Sin él, los límites se cuentan en la memoria de cada instancia.
	 */
	rateLimit?(key: string, windowMs: number): Promise<RateLimitHit>
	/** Libera los recursos propios del store. */
	close?(): Promise<void>
}

/**
 * Store de sesiones en memoria, sólo para desarrollo: no es persistente y `SessionManager` lo
 * rechaza en producción. Avisa de las revocaciones a los gestores del mismo proceso.
 *
 * @typeParam T Datos de la aplicación en la sesión.
 * @example
 * ```ts
 * import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
 *
 * export default defineServerRuntime(({ production, prerendering }) => ({
 *   sessions: new SessionManager({ store: new MemorySessionStore(), production: production && !prerendering }),
 * }));
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sesiones-y-seguridad
 */
export class MemorySessionStore<T = unknown> implements SessionStore<T> {
	/** Marca el store como exclusivo de desarrollo. */
	readonly developmentOnly = true
	readonly persistent = false
	private readonly records = new Map<string, SessionRecord<T>>()
	private readonly families = new Map<string, string>()
	private readonly revocationListeners = new Set<(familyId: string) => void>()
	async get(id: string): Promise<SessionRecord<T> | undefined> {
		const record = this.records.get(id)
		if (record && record.expiresAt <= Date.now()) {
			await this.delete(id)
			return undefined
		}
		if (record && this.families.get(record.familyId ?? record.id) !== id) return undefined
		return record
	}
	async set(record: SessionRecord<T>): Promise<void> {
		const familyId = record.familyId ?? record.id
		const existing = this.records.get(record.id)
		if (existing && (existing.familyId ?? existing.id) !== familyId) throw new Error('Session id cannot change family')
		const active = this.families.get(familyId)
		if (active && active !== record.id) throw new Error('Session family already has an active id')
		this.records.set(record.id, { ...record, familyId })
		this.families.set(familyId, record.id)
	}
	async delete(id: string): Promise<void> {
		const record = this.records.get(id)
		this.records.delete(id)
		if (record && this.families.get(record.familyId ?? record.id) === id) this.families.delete(record.familyId ?? record.id)
	}
	async replace(previousId: string, record: SessionRecord<T>): Promise<boolean> {
		const previous = this.records.get(previousId)
		if (!previous || previous.expiresAt <= Date.now()) {
			await this.delete(previousId)
			return false
		}
		const familyId = previous.familyId ?? previous.id
		if (record.familyId !== familyId || this.families.get(familyId) !== previousId) return false
		this.records.set(record.id, record)
		this.families.set(familyId, record.id)
		this.records.delete(previousId)
		return true
	}
	async revokeFamily(familyId: string): Promise<void> {
		const active = this.families.get(familyId)
		if (active) this.records.delete(active)
		this.families.delete(familyId)
		for (const listener of [...this.revocationListeners]) {
			try {
				listener(familyId)
			} catch (error) {
				console.error('[meeko] Session revocation listener failed', error)
			}
		}
	}
	/** Avisa a los gestores que comparten este store dentro del mismo proceso. */
	subscribeRevocations(listener: (familyId: string) => void): Unsubscribe {
		this.revocationListeners.add(listener)
		return () => {
			this.revocationListeners.delete(listener)
		}
	}
	private readonly counters = new MemoryRateCounter()
	/** Cuenta en memoria del proceso; las ventanas caducadas se liberan solas. */
	async rateLimit(key: string, windowMs: number): Promise<RateLimitHit> {
		return this.counters.hit(key, windowMs)
	}
	async close(): Promise<void> {
		this.records.clear()
		this.families.clear()
		this.counters.clear()
	}
}

/**
 * Opciones de {@link SessionManager}.
 *
 * @typeParam T Datos de la aplicación en la sesión.
 * @example
 * ```ts
 * import { SessionManager } from "@meekojs/meeko/server";
 * import type { SessionOptions } from "@meekojs/meeko/server";
 *
 * const options: SessionOptions<{ userId: string }> = {
 *   store,
 *   production: true,
 *   ttlMs: 24 * 60 * 60 * 1000,
 *   sameSite: "Strict",
 *   allowedOrigins: ["https://admin.example.com"],
 * };
 * const sessions = new SessionManager(options);
 * ```
 */
export interface SessionOptions<T> {
	/** Store de las sesiones. */
	store: SessionStore<T>
	/** Exige un store persistente con `replace` y `revokeFamily`. */
	production?: boolean
	/**
	 * Duración de la sesión en milisegundos; 7 días por defecto. Una sesión creada con
	 * `create(data, { ttlMs })` usa la suya.
	 */
	ttlMs?: number
	/** Cookie `Secure`; `true` por defecto. */
	secure?: boolean
	/** Atributo `SameSite` de la cookie; `"Lax"` por defecto. `"None"` exige `secure`. */
	sameSite?: 'Lax' | 'Strict' | 'None'
	/** Nombre de la cookie; por defecto `__Host-meeko.sid`, o `meeko.sid` sin `secure`. */
	cookieName?: string
	/**
	 * Orígenes adicionales aceptados en las mutaciones de API y RPC (desde `1.8`, también sin sesión)
	 * y en los formularios nativos.
	 */
	allowedOrigins?: readonly string[]
}

export { encodeBase64Url }

function token(): string {
	return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)))
}

function cookieValue(header: string | null, name: string): string | undefined {
	for (const cookie of (header ?? '').split(';')) {
		const separator = cookie.indexOf('=')
		if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue
		const value = cookie.slice(separator + 1).trim()
		return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined
	}
	return undefined
}

const recentRevocationMs = 60_000
const recentRevocationLimit = 4096
/** Registered handles before the first sweep of collected ones. */
const minimumSweep = 1024

/**
 * Handles of each session family on this instance, held weakly so a finished
 * request leaves nothing behind. Families revoked in the last minute stay
 * remembered: a revoked family never becomes active again, and a handle
 * loaded just before the notification arrived is aborted on registration.
 */
class RevocationRegistry {
	private readonly families = new Map<string, Set<WeakRef<AbortController>>>()
	private readonly recent = new Map<string, number>()
	private readonly finalizer = new FinalizationRegistry<{ readonly familyId: string; readonly ref: WeakRef<AbortController> }>(({ familyId, ref }) => this.forget(familyId, ref))
	/** Handles currently registered, and the count that triggers the next sweep. */
	private size = 0
	private sweepAt = minimumSweep
	track(familyId: string, controller: AbortController): WeakRef<AbortController> | undefined {
		const revokedAt = this.recent.get(familyId)
		if (revokedAt !== undefined && Date.now() - revokedAt < recentRevocationMs) {
			controller.abort(new SessionRevokedError())
			return undefined
		}
		const ref = new WeakRef(controller)
		let handles = this.families.get(familyId)
		if (!handles) {
			handles = new Set()
			this.families.set(familyId, handles)
		}
		handles.add(ref)
		this.size++
		this.finalizer.register(controller, { familyId, ref }, ref)
		if (this.size >= this.sweepAt) this.sweep()
		return ref
	}
	/** Handles still registered, collected or not; for tests. */
	get handleCount(): number {
		return this.size
	}
	/**
	 * Drops handles whose controllers were collected. Finalizers may run late or
	 * never, and handles that are never untracked (such as the connections of an
	 * evicted Durable Object) would otherwise accumulate for the instance's life.
	 */
	private sweep(): void {
		for (const [familyId, handles] of this.families) {
			for (const ref of handles) {
				if (ref.deref()) continue
				this.finalizer.unregister(ref)
				handles.delete(ref)
				this.size--
			}
			if (!handles.size) this.families.delete(familyId)
		}
		// Amortized: the next sweep waits for as many new handles as are live now.
		this.sweepAt = Math.max(minimumSweep, this.size * 2)
	}
	untrack(familyId: string, ref: WeakRef<AbortController> | undefined): void {
		if (!ref) return
		this.finalizer.unregister(ref)
		this.forget(familyId, ref)
	}
	revoke(familyId: string): void {
		this.remember(familyId)
		const handles = this.families.get(familyId)
		this.families.delete(familyId)
		this.size -= handles?.size ?? 0
		for (const ref of handles ?? []) {
			this.finalizer.unregister(ref)
			ref.deref()?.abort(new SessionRevokedError())
		}
	}
	private forget(familyId: string, ref: WeakRef<AbortController>): void {
		const handles = this.families.get(familyId)
		if (!handles?.delete(ref)) return
		this.size--
		if (!handles.size) this.families.delete(familyId)
	}
	private remember(familyId: string): void {
		const now = Date.now()
		this.recent.delete(familyId)
		this.recent.set(familyId, now)
		for (const [family, revokedAt] of this.recent) {
			if (this.recent.size <= recentRevocationLimit && now - revokedAt < recentRevocationMs) break
			this.recent.delete(family)
		}
	}
}

const registries = new WeakMap<SessionManager<unknown>, RevocationRegistry>()

function revocationRegistry(manager: SessionManager<unknown>): RevocationRegistry {
	let registry = registries.get(manager)
	if (!registry) {
		registry = new RevocationRegistry()
		registries.set(manager, registry)
	}
	return registry
}

/**
 * The registry holds controllers weakly, and a signal does not reference its
 * controller. This keeps each controller alive while its signal is reachable,
 * so code that retains only `SessionHandle.signal` still sees the revocation.
 */
const signalControllers = new WeakMap<AbortSignal, AbortController>()

/**
 * @internal Fixes the cookie of a response whose headers are about to be sent:
 * waits for create/rotate/revoke calls in flight, then makes later calls fail
 * with `SESSION_LOCKED` before they touch the store.
 */
export const lockSessionCookie = Symbol('meeko.session.lockCookie')

/** @internal Ties a handle to its request, so `create` can check the request's Origin. */
export const bindSessionRequest = Symbol('meeko.session.bindRequest')
/**
 * @internal Records how a guard settled the Origin of the request: `"verified"` after the
 * default Origin check of a mutation (since 1.8) or the CSRF check of an authenticated one,
 * `"exempt"` with `origin: "none"`.
 */
export const settleSessionOrigin = Symbol('meeko.session.settleOrigin')

const safeMethods: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Managers created with `production: true`, which skip the development hints. */
const productionManagers = new WeakSet<SessionManager<unknown>>()

function sessionLockedError(): ApiError {
	return new ApiError('SESSION_LOCKED', 500, 'SESSION_LOCKED: the session cookie was already sent with the response headers; create, rotate or revoke the session in the loader, before any deferred work')
}

/** Revocation handles a manager still holds, including collected ones not yet swept. Internal; for tests. */
export function trackedSessionHandles(manager: SessionManager<unknown>): number {
	return registries.get(manager)?.handleCount ?? 0
}

/**
 * Sesión de una petición, en `RequestContext.session`: lee la sesión actual y la crea, rota o
 * revoca. Los cambios se envían en la cookie de la respuesta. Tras el primer byte de una respuesta
 * en streaming, `create`, `rotate` y `revoke` fallan con `SESSION_LOCKED`.
 *
 * @typeParam T Datos de la aplicación en la sesión; por defecto, {@link SessionData}.
 * @example
 * ```ts
 * // server/rpc/auth/login.ts
 * import { defineRpc } from "@meekojs/meeko/server";
 *
 * export default defineRpc({
 *   input: loginInput,
 *   output: loginOutput,
 *   handler: async ({ input, context }) => {
 *     const user = await verifyPassword(input.email, input.password);
 *     // Sustituye la sesión anónima, si la hay, con un ID y un token CSRF nuevos.
 *     await context.session.create({ userId: user.id });
 *     return { ok: true };
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sesiones-y-seguridad
 */
export class SessionHandle<T = SessionData> {
	private pendingCookie?: string
	private cookieLocked = false
	/** Settled forms of the create/rotate/revoke calls still writing the store. */
	private readonly mutations = new Set<Promise<void>>()
	private readonly revocation = new AbortController()
	private watched: { readonly familyId: string; readonly ref: WeakRef<AbortController> | undefined } | undefined
	/** The request that `SessionManager.load` read, and whether its Origin was already checked. */
	private request: Request | undefined
	private origin: 'unchecked' | 'verified' | 'exempt' = 'unchecked'
	/**
	 * @param manager Gestor que creó el handle.
	 * @param current Sesión activa, si la petición trae una válida.
	 */
	constructor(
		private readonly manager: SessionManager<T>,
		public current?: SessionRecord<T>,
	) {
		signalControllers.set(this.revocation.signal, this.revocation)
		this.watch()
	}
	/** @internal */
	[bindSessionRequest](request: Request): this {
		this.request = request
		return this
	}
	/** @internal */
	[settleSessionOrigin](state: 'verified' | 'exempt'): void {
		if (this.origin !== 'exempt') this.origin = state
	}
	/**
	 * Login CSRF: a cross-site form or script must not plant a session in the victim's browser.
	 * A mutating request creates a session only when a guard verified its Origin, or when its
	 * Origin is allowed now. Safe methods pass, for OAuth callbacks and magic links.
	 */
	private assertCreateOrigin(): void {
		const request = this.request
		if (!request || this.origin !== 'unchecked' || safeMethods.has(request.method)) return
		if (isSessionOriginAllowed(request, this.manager)) {
			this.origin = 'verified'
			return
		}
		// In `meeko dev` the refusal already warned, with the option that allows the origin.
		if (!productionManagers.has(this.manager) && this.manager[devAllowedHosts] === undefined) {
			warnOnce('session:create-origin', '[meeko] session.create() rechazó una petición sin un Origin permitido (403 INVALID_ORIGIN): los navegadores lo envían, pero un script o una app nativa debe enviar Origin, o la ruta declarar origin: "none" (inseguro frente al login CSRF).')
		}
		throw new SessionSecurityError('INVALID_ORIGIN')
	}
	/** Cabecera `Set-Cookie` pendiente tras crear, rotar o revocar, o `undefined`. */
	get cookieHeader(): string | undefined {
		return this.pendingCookie
	}
	/**
	 * Se aborta con `SessionRevokedError` cuando otra petición u otra instancia revoca la familia de
	 * esta sesión. `RequestContext.signal` la incluye.
	 */
	get signal(): AbortSignal {
		return this.revocation.signal
	}
	/**
	 * Crea una sesión nueva con `data`, con ID, familia y token CSRF aleatorios, y prepara la cookie.
	 * Si ya hay una sesión, la sustituye de forma atómica conservando su familia. `options.ttlMs`
	 * (desde `1.2`) fija la duración de esta sesión; por defecto, la del gestor.
	 *
	 * Desde `1.2`, en una petición `POST`, `PUT`, `PATCH` o `DELETE` sólo crea la sesión si su
	 * `Origin` está permitido (el de la aplicación o uno de `SessionManager.allowedOrigins`); si no,
	 * rechaza con `INVALID_ORIGIN` (`403`) sin tocar el store. Así, otra web no puede iniciar sesión
	 * en el navegador de la víctima (*login CSRF*). Las rutas con `origin: "none"` lo omiten.
	 * @throws {RangeError} Si `options.ttlMs` no es un entero positivo.
	 * @throws {SessionSecurityError} `INVALID_ORIGIN` en una mutación sin un `Origin` permitido.
	 */
	async create(data: T, options: SessionCreateOptions = {}): Promise<SessionRecord<T>> {
		if (options.ttlMs !== undefined && !validTtl(options.ttlMs)) throw new RangeError('Invalid session TTL')
		this.assertCreateOrigin()
		return this.mutate(() => this.write(data, options.ttlMs))
	}
	/**
	 * Cambia el ID y el token CSRF de la sesión actual conservando sus datos, su familia y su
	 * duración, por ejemplo tras iniciar sesión. La nueva caducidad se cuenta desde la rotación.
	 * @throws {Error} Si no hay sesión, ha caducado o fue revocada.
	 */
	async rotate(): Promise<SessionRecord<T>> {
		return this.mutate(async () => {
			if (!this.current) throw new Error('No active session to rotate')
			// Records written before 1.2, or whose TTL is not valid, use the manager's.
			const ttlMs = this.current.ttlMs
			return this.write(this.current.data, validTtl(ttlMs) ? ttlMs : undefined)
		})
	}
	/**
	 * Revoca toda la familia de la sesión, también en las demás peticiones e instancias, y vacía la
	 * cookie. La petición que llama no se aborta.
	 * @throws {Error} Si el store no implementa `revokeFamily`.
	 */
	async revoke(): Promise<void> {
		return this.mutate(async () => {
			if (this.current) {
				if (!this.manager.store.revokeFamily) throw new Error('Session storage does not support atomic family revocation')
				const familyId = this.current.familyId ?? this.current.id
				// The revoking request keeps running so that it can clear the cookie.
				this.unwatch()
				try {
					await this.manager.store.revokeFamily(familyId)
				} catch (error) {
					this.watch()
					throw error
				}
				revocationRegistry(this.manager).revoke(familyId)
			}
			this.current = undefined
			this.pendingCookie = this.manager.serializeCookie('', 0)
		})
	}
	/** @internal Resolves once no session change is in flight; later changes fail with `SESSION_LOCKED`. */
	async [lockSessionCookie](): Promise<void> {
		this.cookieLocked = true
		while (this.mutations.size) await Promise.all(this.mutations)
	}
	/** Runs one store change unless the cookie is locked, and tracks it until it settles. */
	private mutate<R>(work: () => Promise<R>): Promise<R> {
		if (this.cookieLocked) return Promise.reject(sessionLockedError())
		const running = work()
		const settled = running.then(
			() => {},
			() => {},
		)
		this.mutations.add(settled)
		void settled.then(() => {
			this.mutations.delete(settled)
		})
		return running
	}
	/** `ttlMs` is the session's own TTL, stored on the record; without it the manager's applies. */
	private async write(data: T, ttlMs: number | undefined): Promise<SessionRecord<T>> {
		const previous = this.current
		const now = Date.now()
		const lifetime = ttlMs ?? this.manager.ttlMs
		const record: SessionRecord<T> = {
			id: token(),
			familyId: previous?.familyId ?? previous?.id ?? token(),
			csrfToken: token(),
			data,
			createdAt: now,
			expiresAt: now + lifetime,
			...(ttlMs === undefined ? {} : { ttlMs }),
		}
		if (previous) {
			if (!this.manager.store.replace) throw new Error('Session storage does not support atomic rotation')
			if (!(await this.manager.store.replace(previous.id, record))) throw new Error('Session has expired or been revoked')
		} else await this.manager.store.set(record)
		this.current = record
		this.watch()
		this.pendingCookie = this.manager.serializeCookie(record.id, lifetime)
		return record
	}
	/**
	 * Relee el store y lanza `SessionRevokedError` (`401 SESSION_REVOKED`) si esta sesión fue
	 * revocada, sustituida por una rotación o caducó. Llámelo antes de efectos irreversibles; sin
	 * sesión no hace nada.
	 */
	async verify(): Promise<void> {
		if (this.revocation.signal.aborted) throw new SessionRevokedError()
		const current = this.current
		if (!current) return
		const stored = await this.manager.store.get(current.id)
		if (!stored || stored.id !== current.id || stored.expiresAt <= Date.now()) throw new SessionRevokedError()
	}
	private watch(): void {
		const familyId = this.current ? (this.current.familyId ?? this.current.id) : undefined
		if (familyId === this.watched?.familyId) return
		this.unwatch()
		if (familyId !== undefined) this.watched = { familyId, ref: revocationRegistry(this.manager).track(familyId, this.revocation) }
	}
	private unwatch(): void {
		if (this.watched) revocationRegistry(this.manager).untrack(this.watched.familyId, this.watched.ref)
		this.watched = undefined
	}
}

/**
 * Gestor de sesiones de la aplicación: cookies opacas `HttpOnly`, host-only y `Secure` por defecto,
 * rotación y revocación por familia, y comprobación de Origin y CSRF en las mutaciones
 * autenticadas. Se declara en `server/runtime.ts`.
 *
 * @typeParam T Datos de la aplicación en la sesión.
 * @example
 * ```ts
 * // server/runtime.ts
 * import { createClient } from "redis";
 * import { defineServerRuntime, RedisSessionStore, SessionManager } from "@meekojs/meeko/server";
 *
 * export default defineServerRuntime(async ({ env, production, prerendering }) => {
 *   const redis = createClient({ url: env.MEEKO_REDIS_URL });
 *   await redis.connect();
 *   return {
 *     sessions: new SessionManager({ store: new RedisSessionStore(redis, { prefix: "app:prod:session:" }), production: production && !prerendering }),
 *     close: async () => { await redis.quit(); },
 *   };
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sesiones-y-seguridad
 */
export class SessionManager<T = unknown> {
	/** Store de las sesiones. */
	readonly store: SessionStore<T>
	/** Duración por defecto de las sesiones en milisegundos; `create(data, { ttlMs })` la sustituye. */
	readonly ttlMs: number
	/** Nombre de la cookie de sesión. */
	readonly cookieName: string
	/** Orígenes adicionales aceptados en las mutaciones de API y RPC, con o sin sesión, y en los formularios nativos. */
	readonly allowedOrigins: readonly string[];
	/** @internal Hosts that `meeko dev` accepts (`dev.allowedHosts`); `undefined` outside `meeko dev`. */
	[devAllowedHosts]?: DevAllowedHosts
	private readonly secure: boolean
	private readonly sameSite: 'Lax' | 'Strict' | 'None'
	private readonly production: boolean
	/**
	 * @param options Store, modo producción y política de la cookie.
	 * @throws {Error} En producción con un store no persistente o sin `replace` y `revokeFamily`, o con
	 * una combinación de cookie inválida (`SameSite=None` o `__Host-` sin `Secure`).
	 * @throws {RangeError} Si `ttlMs` no es un entero positivo.
	 * @throws {TypeError} Si el nombre de la cookie no es válido.
	 */
	constructor(options: SessionOptions<T>) {
		if (options.production && (options.store.persistent !== true || !options.store.replace || !options.store.revokeFamily)) throw new Error('Persistent session storage with atomic rotation and family revocation is required in production')
		this.store = options.store
		this.ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1000
		if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) throw new RangeError('Invalid session TTL')
		this.secure = options.secure ?? true
		this.sameSite = options.sameSite ?? 'Lax'
		if (this.sameSite === 'None' && !this.secure) throw new Error('SameSite=None requires Secure')
		this.cookieName = options.cookieName ?? (this.secure ? '__Host-meeko.sid' : 'meeko.sid')
		if (!/^[A-Za-z0-9_.-]+$/.test(this.cookieName)) throw new TypeError('Invalid cookie name')
		if (this.cookieName.startsWith('__Host-') && !this.secure) throw new Error('__Host- cookies require Secure')
		this.allowedOrigins = options.allowedOrigins ?? []
		this.production = options.production === true
		if (this.production) productionManagers.add(this)
	}
	/**
	 * @internal Accepts the Origins of `dev.allowedHosts` in this manager's checks. Only
	 * `createServerApp` calls it, outside production; a production manager ignores it.
	 */
	[allowDevHosts](hosts: DevAllowedHosts): void {
		if (this.production) return
		this[devAllowedHosts] = hosts
	}
	/** Serializa la cabecera `Set-Cookie` de la sesión con la política del gestor; `ttlMs` 0 la borra. */
	serializeCookie(value: string, ttlMs: number): string {
		const parts = [`${this.cookieName}=${value}`, 'Path=/', 'HttpOnly', `SameSite=${this.sameSite}`, `Max-Age=${Math.floor(ttlMs / 1000)}`]
		if (this.secure) parts.push('Secure')
		return parts.join('; ')
	}
	private revocations: Promise<Unsubscribe> | undefined
	/** Subscribes once to the store's revocations; a failed attempt is retried by the next load. */
	private listenForRevocations(): Promise<Unsubscribe> | undefined {
		const store = this.store
		if (!store.subscribeRevocations) return undefined
		const registry = revocationRegistry(this)
		const subscription = (this.revocations ??= Promise.resolve()
			.then(() => store.subscribeRevocations!((familyId) => registry.revoke(familyId)))
			.catch((error: unknown) => {
				if (this.revocations === subscription) this.revocations = undefined
				throw error
			}))
		return subscription
	}
	/**
	 * Lee la cookie de la petición y devuelve su {@link SessionHandle}, sin sesión si falta, no es
	 * válida o caducó. La primera llamada se suscribe a las revocaciones del store y espera la
	 * confirmación; si falla, rechaza y la siguiente lo reintenta.
	 */
	async load(request: Request): Promise<SessionHandle<T>> {
		// Revocations from other instances must be flowing before a request is authenticated.
		await this.listenForRevocations()
		const id = cookieValue(request.headers.get('cookie'), this.cookieName)
		const record = id ? await this.store.get(id) : undefined
		if (record && record.expiresAt <= Date.now()) {
			await this.store.delete(record.id)
			return new SessionHandle(this)[bindSessionRequest](request)
		}
		return new SessionHandle(this, record)[bindSessionRequest](request)
	}
	/**
	 * Cuenta una petición en la ventana fija `key` (desde `1.2`): con `SessionStore.rateLimit` si el
	 * store lo tiene, o en la memoria de esta instancia, con un aviso en producción. Un fallo del
	 * store rechaza, de modo que la petición limitada no pasa.
	 */
	rateLimit(key: string, windowMs: number): Promise<RateLimitHit> {
		return countRateLimit(this.store, key, windowMs, this.production)
	}
	/** Cancela la suscripción a revocaciones y cierra el store; no cierra clientes externos como Redis. */
	async close(): Promise<void> {
		const subscription = this.revocations
		this.revocations = undefined
		const failures: unknown[] = []
		// A subscription that never started was already reported by `load`.
		const unsubscribe = subscription ? await subscription.catch(() => undefined) : undefined
		if (unsubscribe) {
			try {
				await unsubscribe()
			} catch (error) {
				failures.push(error)
			}
		}
		try {
			await this.store.close?.()
		} catch (error) {
			failures.push(error)
		}
		if (failures.length === 1) throw failures[0]
		if (failures.length > 1) throw new AggregateError(failures, 'Session revocation unsubscribe and store close failed')
	}
	/**
	 * Comprueba Origin y el token `x-meeko-csrf` en las mutaciones autenticadas con cookie. Las
	 * peticiones sin sesión o de lectura pasan.
	 * @throws {SessionSecurityError} `INVALID_ORIGIN` o `INVALID_CSRF`.
	 */
	assertMutationAllowed(request: Request, session: SessionHandle<T>, mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)): void {
		if (!session.current || !mutating) return
		if (!isSessionOriginAllowed(request, this)) throw new SessionSecurityError('INVALID_ORIGIN')
		if (request.headers.get('x-meeko-csrf') !== session.current.csrfToken) throw new SessionSecurityError('INVALID_CSRF')
		// This request may now replace its session: Origin and CSRF were both verified.
		session[settleSessionOrigin]?.('verified')
	}
}

/** Handles of a manager that stands for `sessions: false`: `context.session` throws on use. */
const disabledHandles = new WeakSet<SessionHandle<unknown>>()
const disabledManagers = new WeakSet<SessionManager<unknown>>()

/** Whether `handle` belongs to an application that disables Meeko sessions. */
export function isDisabledSession(handle: unknown): boolean {
	return typeof handle === 'object' && handle !== null && disabledHandles.has(handle as SessionHandle<unknown>)
}

/** Whether `sessions` stands for `sessions: false`. */
export function sessionsDisabled(sessions: unknown): boolean {
	return typeof sessions === 'object' && sessions !== null && disabledManagers.has(sessions as SessionManager<unknown>)
}

/** The error of every use of `context.session` in an application without Meeko sessions. */
export function disabledSessionError(): Error {
	return new Error('context.session is not available: server/runtime.ts disables Meeko sessions with sessions: false. Read the user from your own authentication (context.services, context.cookies), or declare isAuthenticated in server/runtime.ts for auth: "required".')
}

function disabledStore(): SessionStore<never> {
	const fail = (): never => {
		throw disabledSessionError()
	}
	return { persistent: false, get: async () => fail(), set: async () => fail(), delete: async () => fail() }
}

/**
 * The manager of `sessions: false`: it keeps the Origin checks of every mutation (with the
 * runtime's `allowedOrigins`) and counts `rateLimit` in memory, but never reads a session cookie,
 * so each request gets a handle without a session that `context.session` refuses to expose.
 */
class DisabledSessionManager extends SessionManager<unknown> {
	constructor(
		allowedOrigins: readonly string[],
		private readonly serving: boolean,
	) {
		super({ store: disabledStore(), production: false, allowedOrigins })
		disabledManagers.add(this)
	}
	override async load(request: Request): Promise<SessionHandle<unknown>> {
		const handle = new SessionHandle<unknown>(this)[bindSessionRequest](request)
		disabledHandles.add(handle)
		return handle
	}
	override rateLimit(key: string, windowMs: number): Promise<RateLimitHit> {
		if (this.serving) warnOnce('rate-limit:memory-disabled', '[meeko] Sin sesiones de Meeko (sessions: false), los límites de rateLimit se cuentan en la memoria de cada instancia.')
		return countRateLimit(undefined, key, windowMs, false)
	}
}

/**
 * @internal The manager of an application whose `server/runtime.ts` returns `sessions: false`.
 * `serving` is production outside prerendering, for the memory rate limit warning.
 */
export function createDisabledSessions(allowedOrigins: readonly string[], serving: boolean): SessionManager<unknown> {
	return new DisabledSessionManager(allowedOrigins, serving)
}

/** What `auth: "required"` asks when the application declares `isAuthenticated`. */
export type Authenticator = (context: RequestContext<unknown, unknown>) => boolean | Promise<boolean>

const authenticators = new WeakMap<SessionManager<unknown>, Authenticator>()

/** @internal Gives `auth: "required"` of the API, RPC and Socket of `sessions` the application's check. */
export function setAuthenticator(sessions: SessionManager<unknown>, authenticator: Authenticator): void {
	authenticators.set(sessions, authenticator)
}

/** Whether the application declares its own `isAuthenticated` for these sessions. */
export function hasAuthenticator(sessions: SessionManager<unknown>): boolean {
	return authenticators.has(sessions)
}

/**
 * `auth: "required"`: the application's `isAuthenticated` if it declares one, or a current Meeko
 * session. Without both, it is a configuration error, never a silent `401`.
 */
export async function isAuthenticated(context: RequestContext<unknown, unknown> | undefined, session: SessionHandle<unknown>, sessions: SessionManager<unknown>): Promise<boolean> {
	const authenticator = authenticators.get(sessions)
	if (authenticator) {
		if (!context) throw new Error('isAuthenticated needs a request context')
		return (await authenticator(context)) === true
	}
	if (sessionsDisabled(sessions) || isDisabledSession(session)) throw new Error('auth: "required" has no way to know the user: server/runtime.ts disables Meeko sessions (sessions: false) and does not declare isAuthenticated. Declare isAuthenticated, or use authorize.')
	return session.current !== undefined
}
