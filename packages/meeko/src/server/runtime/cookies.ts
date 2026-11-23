import { ApiError } from '../errors'

/** Whether a Cookie header includes a cookie by name, regardless of its value. */
export function cookieNamed(header: string | null, name: string): boolean {
	return (header ?? '').split(';').some((cookie) => {
		const separator = cookie.indexOf('=')
		return separator > 0 && cookie.slice(0, separator).trim() === name
	})
}

/**
 * Atributos de una cookie que se escribe con `context.cookies.set` (desde `1.10`). Los que faltan
 * toman los valores seguros por defecto: `Path=/`, `HttpOnly`, `SameSite=Lax` y `Secure` en
 * producción (y en desarrollo sobre HTTPS). Acepta también la forma de `CookieSerializeOptions` del
 * paquete `cookie` (`sameSite: "lax"`, `priority: "high"`), que usan SDK como `@supabase/ssr`; las
 * claves que no conoce, como `encode`, se ignoran.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * import type { CookieOptions } from "@meekojs/meeko/server";
 *
 * const remember: CookieOptions = { maxAge: 30 * 24 * 60 * 60, sameSite: "Strict" };
 * context.cookies.set("theme-choice", "dark", remember);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework-auth.md#cookies-de-la-petición
 */
export interface CookieOptions {
	/** Ruta de la cookie; empieza por `/`. Por defecto, `/`. */
	readonly path?: string | undefined
	/** Dominio de la cookie. Por defecto ninguno: la cookie es sólo de este host. */
	readonly domain?: string | undefined
	/** Segundos de vida (`Max-Age`); `0` o menos la borra. Sin él ni `expires`, dura la sesión del navegador. */
	readonly maxAge?: number | undefined
	/** Fecha de caducidad (`Expires`). */
	readonly expires?: Date | undefined
	/** `HttpOnly`, que oculta la cookie a JavaScript. Por defecto, `true`. */
	readonly httpOnly?: boolean | undefined
	/** `Secure`. Por defecto, `true` en producción y en las peticiones HTTPS. */
	readonly secure?: boolean | undefined
	/**
	 * `SameSite`. Por defecto, `"Lax"`. `"None"` exige `secure`. `true` equivale a `"Strict"` y
	 * `false` omite el atributo, como en el paquete `cookie`.
	 */
	readonly sameSite?: 'Lax' | 'Strict' | 'None' | 'lax' | 'strict' | 'none' | boolean | undefined
	/** `Partitioned` (CHIPS); exige `secure`. */
	readonly partitioned?: boolean | undefined
	/** `Priority` (Chromium). */
	readonly priority?: 'Low' | 'Medium' | 'High' | 'low' | 'medium' | 'high' | undefined
}

/**
 * Una cookie de la petición, con su valor ya decodificado.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * import type { RequestCookie } from "@meekojs/meeko/server";
 *
 * const names = (cookies: readonly RequestCookie[]) => cookies.map((cookie) => cookie.name);
 * ```
 */
export interface RequestCookie {
	/** Nombre de la cookie. */
	readonly name: string
	/** Valor decodificado. */
	readonly value: string
}

/**
 * Cookies de la petición, en `RequestContext.cookies` (desde `1.10`): lee las que envió el
 * navegador y escribe las de la respuesta. Una lectura ve lo escrito antes en la misma petición (un
 * middleware que renueva un token y un RPC que lo lee después). Las escrituras se añaden como
 * `Set-Cookie` a la respuesta que se produzca, sea JSON, una redirección, un error, el `303` de un
 * formulario, una página o el `Response` propio de un handler, sin quitar las suyas. Los valores
 * se codifican con `encodeURIComponent` al escribirlos y se decodifican al leerlos, como el paquete
 * `cookie`.
 *
 * La cookie de sesión de Meeko se lee aquí, pero se escribe sólo con `context.session`. En una
 * página `render: "stream"`, escribir después del primer byte lanza `RESPONSE_LOCKED`; en el
 * handshake de Socket, las cookies son de sólo lectura.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * // server/rpc/preferences/save.ts
 * export default defineRpc({
 *   input: preferencesInput,
 *   output: okResult,
 *   handler: ({ input, context }) => {
 *     context.cookies.set("currency", input.currency, { maxAge: 365 * 24 * 60 * 60 });
 *     return { ok: true };
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework-auth.md#cookies-de-la-petición
 */
export interface RequestCookies {
	/** Valor de la cookie, o `undefined` si no existe o se borró en esta petición. */
	get(name: string): string | undefined
	/** Todas las cookies visibles, con lo escrito en esta petición. */
	getAll(): RequestCookie[]
	/** Si la cookie existe. */
	has(name: string): boolean
	/**
	 * Escribe la cookie en la respuesta y la deja visible para las lecturas siguientes. Otra escritura
	 * con el mismo nombre, ruta y dominio sustituye a la anterior.
	 * @throws {TypeError} Si el nombre, la ruta, el dominio o los atributos no son válidos, si el nombre
	 * es el de la cookie de sesión de Meeko o si las cookies son de sólo lectura.
	 * @throws {RangeError} Si la cookie supera 4096 bytes.
	 * @throws {ApiError} `RESPONSE_LOCKED` (`500`) si la respuesta ya empezó a enviarse.
	 */
	set(name: string, value: string, options?: CookieOptions): void
	/**
	 * Borra la cookie en el navegador (`Max-Age=0`). Pase la misma `path` y `domain` con que se
	 * escribió.
	 * @throws {TypeError} Como `set`.
	 * @throws {ApiError} `RESPONSE_LOCKED` (`500`) si la respuesta ya empezó a enviarse.
	 */
	delete(name: string, options?: CookieOptions): void
}

/**
 * Cabeceras que la petición añade a su respuesta, en `RequestContext.responseHeaders` (desde
 * `1.10`). Se aplican a la respuesta que se produzca, como las cookies, y sustituyen a la cabecera
 * del mismo nombre. Las que gestiona Meeko (`set-cookie`, que se escribe con `cookies`,
 * `content-type`, `content-length`, `content-security-policy`, `location`, `x-request-id`,
 * `x-meeko-csrf-token` y las de la conexión) se rechazan.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * export default defineServerRouteMiddleware(({ context }) => {
 *   context.responseHeaders.set("cache-control", "private, max-age=60");
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework-server.md#cabeceras-de-la-respuesta
 */
export interface ResponseHeaders {
	/** Fija la cabecera, sustituyendo el valor anterior. */
	set(name: string, value: string): void
	/** Añade un valor a la cabecera. */
	append(name: string, value: string): void
	/** Quita la cabecera de las que añade la petición. */
	delete(name: string): void
	/** Valor de la cabecera que añade la petición, o `null`. */
	get(name: string): string | null
	/** Si la petición añade esa cabecera. */
	has(name: string): boolean
}

const tokenPattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const pathPattern = /^\/[^\u0000-\u001f\u007f;]*$/
const domainPattern = /^\.?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/
const maxCookieBytes = 4096

/** Headers that Meeko writes itself or that belong to the connection. */
const reservedHeaders: ReadonlySet<string> = new Set(['set-cookie', 'content-type', 'content-length', 'content-encoding', 'content-security-policy', 'location', 'x-request-id', 'x-meeko-csrf-token', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade'])

function decodeValue(value: string): string {
	if (!value.includes('%')) return value
	try {
		return decodeURIComponent(value)
	} catch {
		return value
	}
}

function parseCookieHeader(header: string | null): Map<string, string> {
	const values = new Map<string, string>()
	for (const part of (header ?? '').split(';')) {
		const separator = part.indexOf('=')
		if (separator <= 0) continue
		const name = part.slice(0, separator).trim()
		// A browser sends the most specific path first: the first value of a name wins.
		if (!name || values.has(name)) continue
		let value = part.slice(separator + 1).trim()
		if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
		values.set(name, decodeValue(value))
	}
	return values
}

function sameSiteOf(value: CookieOptions['sameSite']): 'Lax' | 'Strict' | 'None' | undefined {
	if (value === undefined) return 'Lax'
	if (value === true) return 'Strict'
	if (value === false) return undefined
	const normalized = String(value).toLowerCase()
	if (normalized === 'lax') return 'Lax'
	if (normalized === 'strict') return 'Strict'
	if (normalized === 'none') return 'None'
	throw new TypeError(`Invalid cookie SameSite: ${String(value)}`)
}

function priorityOf(value: CookieOptions['priority']): string | undefined {
	if (value === undefined) return undefined
	const normalized = String(value).toLowerCase()
	if (normalized === 'low' || normalized === 'medium' || normalized === 'high') return normalized[0]!.toUpperCase() + normalized.slice(1)
	throw new TypeError(`Invalid cookie Priority: ${String(value)}`)
}

/** What a request's cookies and response headers need from their host. */
export interface ResponseStateOptions {
	/** Default of `Secure` for the cookies the request writes. */
	readonly secure: boolean
	/** The Meeko session cookie: readable, never written through `cookies`. */
	readonly sessionCookieName?: string | undefined
	/** A Socket handshake: cookies can be read, never written. */
	readonly readOnly?: boolean | undefined
}

/**
 * The cookies a request reads and writes and the headers it adds to its response. One state per
 * request: the contexts derived for its local API and RPC calls share it, so a page's response
 * carries what they wrote.
 */
export class ResponseState {
	readonly cookies: RequestCookies
	readonly headers: ResponseHeaders
	private values: Map<string, string> | undefined
	/** Pending `Set-Cookie` values by name, path and domain, in write order. */
	private readonly pending = new Map<string, string>()
	private readonly added = new Map<string, string[]>()
	private locked: string | undefined
	constructor(
		private readonly request: Request,
		private readonly options: ResponseStateOptions,
	) {
		this.cookies = {
			get: (name) => this.view().get(name),
			getAll: () => [...this.view()].map(([name, value]) => ({ name, value })),
			has: (name) => this.view().has(name),
			set: (name, value, options) => this.setCookie(name, value, options ?? {}),
			delete: (name, options) => this.setCookie(name, '', { ...options, maxAge: 0, expires: new Date(0) }),
		}
		this.headers = {
			set: (name, value) => {
				const key = this.writableHeader(name, value)
				this.added.set(key, [value])
			},
			append: (name, value) => {
				const key = this.writableHeader(name, value)
				this.added.set(key, [...(this.added.get(key) ?? []), value])
			},
			delete: (name) => {
				this.added.delete(this.writableHeader(name, ''))
			},
			get: (name) => this.added.get(name.toLowerCase())?.join(', ') ?? null,
			has: (name) => this.added.has(name.toLowerCase()),
		}
	}
	/** Whether the request wrote a cookie. */
	get wroteCookies(): boolean {
		return this.pending.size > 0
	}
	/** The `Set-Cookie` values to send, in write order. */
	get setCookies(): readonly string[] {
		return [...this.pending.values()]
	}
	/** Later writes throw `RESPONSE_LOCKED` with `reason`: the response headers are on their way. */
	lock(reason: string): void {
		this.locked ??= reason
	}
	/** Adds the cookies and headers of the request to `headers`, keeping the cookies already there. */
	applyTo(headers: Headers): void {
		for (const [name, values] of this.added) {
			headers.delete(name)
			for (const value of values) headers.append(name, value)
		}
		for (const cookie of this.pending.values()) headers.append('set-cookie', cookie)
	}
	private view(): Map<string, string> {
		return (this.values ??= parseCookieHeader(this.request.headers.get('cookie')))
	}
	private assertWritable(): void {
		if (this.locked !== undefined) throw new ApiError('RESPONSE_LOCKED', 500, `RESPONSE_LOCKED: ${this.locked}`)
	}
	private writableHeader(name: string, value: string): string {
		if (this.options.readOnly) throw new TypeError('Response headers cannot be set during a Socket handshake')
		if (typeof name !== 'string' || !tokenPattern.test(name)) throw new TypeError(`Invalid header name: ${JSON.stringify(name)}`)
		if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new TypeError(`Invalid value for header ${name}`)
		const key = name.toLowerCase()
		if (reservedHeaders.has(key)) throw new TypeError(`The ${key} header is written by Meeko${key === 'set-cookie' ? '; use context.cookies' : ''}`)
		this.assertWritable()
		return key
	}
	private setCookie(name: string, value: string, options: CookieOptions): void {
		if (this.options.readOnly) throw new TypeError('Cookies cannot be set during a Socket handshake')
		if (typeof name !== 'string' || !tokenPattern.test(name)) throw new TypeError(`Invalid cookie name: ${JSON.stringify(name)}`)
		if (name === this.options.sessionCookieName) throw new TypeError(`${name} is the Meeko session cookie: change it with context.session`)
		if (typeof value !== 'string') throw new TypeError(`The value of cookie ${name} must be a string`)
		const path = options.path ?? '/'
		if (typeof path !== 'string' || !pathPattern.test(path)) throw new TypeError(`Invalid path for cookie ${name}`)
		const domain = options.domain
		if (domain !== undefined && (typeof domain !== 'string' || !domainPattern.test(domain))) throw new TypeError(`Invalid domain for cookie ${name}`)
		const secure = options.secure ?? this.options.secure
		const sameSite = sameSiteOf(options.sameSite)
		const priority = priorityOf(options.priority)
		if (sameSite === 'None' && !secure) throw new TypeError(`Cookie ${name}: SameSite=None requires Secure`)
		if (options.partitioned && !secure) throw new TypeError(`Cookie ${name}: Partitioned requires Secure`)
		if (name.startsWith('__Secure-') && !secure) throw new TypeError(`Cookie ${name}: the __Secure- prefix requires Secure`)
		if (name.startsWith('__Host-') && (!secure || path !== '/' || domain !== undefined)) throw new TypeError(`Cookie ${name}: the __Host- prefix requires Secure, Path=/ and no Domain`)
		let maxAge: number | undefined
		if (options.maxAge !== undefined) {
			if (typeof options.maxAge !== 'number' || !Number.isFinite(options.maxAge)) throw new TypeError(`Invalid maxAge for cookie ${name}`)
			maxAge = Math.trunc(options.maxAge)
		}
		const expires = options.expires
		if (expires !== undefined && !(expires instanceof Date && Number.isFinite(expires.getTime()))) throw new TypeError(`Invalid expires for cookie ${name}`)
		const encoded = encodeURIComponent(value)
		if (name.length + encoded.length + 1 > maxCookieBytes) throw new RangeError(`Cookie ${name} is larger than ${maxCookieBytes} bytes`)
		this.assertWritable()
		const parts = [`${name}=${encoded}`, `Path=${path}`]
		if (domain !== undefined) parts.push(`Domain=${domain}`)
		if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`)
		if (expires !== undefined) parts.push(`Expires=${expires.toUTCString()}`)
		if (options.httpOnly ?? true) parts.push('HttpOnly')
		if (secure) parts.push('Secure')
		if (sameSite !== undefined) parts.push(`SameSite=${sameSite}`)
		if (options.partitioned) parts.push('Partitioned')
		if (priority !== undefined) parts.push(`Priority=${priority}`)
		const key = `${name}\u0000${path}\u0000${domain?.toLowerCase() ?? ''}`
		// The last write of a cookie is the one sent, at the position of that write.
		this.pending.delete(key)
		this.pending.set(key, parts.join('; '))
		const removed = (maxAge !== undefined && maxAge <= 0) || (expires !== undefined && expires.getTime() <= Date.now())
		if (removed) this.view().delete(name)
		else this.view().set(name, value)
	}
}
