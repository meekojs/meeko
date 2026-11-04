import type { RequestContext } from '@meekojs/meeko/server'

import { ApiError } from '@meekojs/meeko/server'
import { localizedPath, splitLocalePath } from 'meeko-docs-content/locale'

/** The variables of the administrator login (F5). See the README, «F5: autenticación». */
export interface AuthEnv {
	/** The administrator's user name. */
	readonly ADMIN_USERNAME?: string | undefined
	/** The `scrypt$…` hash of `meeko auth hash`. */
	readonly ADMIN_PASSWORD_HASH?: string | undefined
	/** Absolute lifetime of a session from the login (`12h` by default). */
	readonly DASHBOARD_SESSION_TTL?: string | undefined
	/** A session without requests for this long ends (`30m` by default). */
	readonly DASHBOARD_SESSION_IDLE?: string | undefined
	/** `Strict` (default) or `Lax`. */
	readonly DASHBOARD_SESSION_SAMESITE?: string | undefined
	/** Login attempts per client IP and window (`20` by default). */
	readonly DASHBOARD_LOGIN_IP_LIMIT?: string | undefined
	/** Login attempts per user name and window (`5` by default). */
	readonly DASHBOARD_LOGIN_USER_LIMIT?: string | undefined
	/** The window of both limits (`15m` by default). */
	readonly DASHBOARD_LOGIN_WINDOW?: string | undefined
	readonly [name: string]: string | undefined
}

/** The account that may log in. */
export interface AdminAccount {
	readonly username: string
	readonly passwordHash: string
}

/** The login configuration, parsed and checked once per process. */
export interface AuthConfig {
	/** `null` when `ADMIN_USERNAME` or `ADMIN_PASSWORD_HASH` is missing: nobody can log in. */
	readonly admin: AdminAccount | null
	readonly ttlMs: number
	readonly idleMs: number
	readonly sameSite: 'Lax' | 'Strict'
	readonly ipLimit: number
	readonly userLimit: number
	readonly windowMs: number
}

/** What the session of the dashboard keeps: who logged in. */
export interface DashboardSession {
	readonly user: string
}

const units: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** Milliseconds of a duration such as `30m`, `12h`, `45s` or `1d`; throws `TypeError` for another text. */
export function parseDuration(text: string, name: string): number {
	const match = /^(\d+)(ms|s|m|h|d)$/.exec(text.trim())
	const value = match ? Number(match[1]) * units[match[2]!]! : Number.NaN
	if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a duration such as 30m, 12h or 7d: ${text}`)
	return value
}

function positive(text: string | undefined, fallback: number, name: string): number {
	if (text === undefined || text.trim() === '') return fallback
	const value = Number(text.trim())
	if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer: ${text}`)
	return value
}

// The format of `meeko auth hash` and `hashPassword`: scrypt$N$r$p$salt$key, both in base64url.
const hashFormat = /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/

/**
 * Parses the login variables of `env`. Throws `TypeError` for a value that is set but not valid, so
 * a misconfigured server does not start: a hash that `meeko auth hash` did not write (a `$` lost to
 * the shell or to a variable interpolation is the usual cause), a duration or a limit.
 */
export function authConfig(env: AuthEnv): AuthConfig {
	const username = env.ADMIN_USERNAME?.trim() ?? ''
	const passwordHash = env.ADMIN_PASSWORD_HASH?.trim() ?? ''
	if (passwordHash && !hashFormat.test(passwordHash)) throw new TypeError('ADMIN_PASSWORD_HASH is not a hash of `meeko auth hash` (scrypt$N$r$p$salt$key); check that no $ was lost')
	if (username.length > 200) throw new TypeError('ADMIN_USERNAME has more than 200 characters')
	const ttlMs = parseDuration(env.DASHBOARD_SESSION_TTL?.trim() || '12h', 'DASHBOARD_SESSION_TTL')
	const idleMs = parseDuration(env.DASHBOARD_SESSION_IDLE?.trim() || '30m', 'DASHBOARD_SESSION_IDLE')
	const sameSite = env.DASHBOARD_SESSION_SAMESITE?.trim() || 'Strict'
	if (sameSite !== 'Strict' && sameSite !== 'Lax') throw new TypeError(`DASHBOARD_SESSION_SAMESITE must be Strict or Lax: ${sameSite}`)
	return {
		admin: username && passwordHash ? { username, passwordHash } : null,
		ttlMs,
		idleMs,
		sameSite,
		ipLimit: positive(env.DASHBOARD_LOGIN_IP_LIMIT, 20, 'DASHBOARD_LOGIN_IP_LIMIT'),
		userLimit: positive(env.DASHBOARD_LOGIN_USER_LIMIT, 5, 'DASHBOARD_LOGIN_USER_LIMIT'),
		windowMs: parseDuration(env.DASHBOARD_LOGIN_WINDOW?.trim() || '15m', 'DASHBOARD_LOGIN_WINDOW'),
	}
}

/** The language of a path of the dashboard: `/en/…` is English, any other path Spanish. */
export function pathLocale(pathname: string): 'en' | 'es' {
	return splitLocalePath(pathname).locale
}

/** Whether `pathname` is the login page, in any language (`/login`, `/en/login`). */
export function isLoginPath(pathname: string): boolean {
	return splitLocalePath(pathname).path === '/login'
}

/**
 * Where to go after the login: `next` when it is a path of this dashboard, or the overview in
 * `locale` (`/`, `/en`). Only a relative path that starts with one `/` passes, so
 * `//other.example`, `/\other.example`, `https://…`, `javascript:` and control characters cannot
 * send the browser to another site (open redirect). The login page itself, in any language, goes
 * to the overview of its language. `next` keeps its language prefix: an English page goes back
 * to English.
 */
export function safeNext(next: unknown, locale: 'en' | 'es' = 'es'): string {
	const home = localizedPath('/', locale)
	if (typeof next !== 'string' || next.length > 2048) return home
	if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\u0000-\u001f\u007f]/.test(next)) return home
	let url: URL
	try {
		url = new URL(next, 'http://dashboard.invalid')
	} catch {
		return home
	}
	if (url.origin !== 'http://dashboard.invalid' || url.pathname.startsWith('//')) return home
	if (isLoginPath(url.pathname)) return localizedPath('/', pathLocale(url.pathname))
	return `${url.pathname}${url.search}${url.hash}`
}

/**
 * The login page in the language of `pathname` that sends the browser back to it (with its query)
 * afterwards: `/en/sources` gives `/en/login?next=%2Fen%2Fsources`.
 */
export function loginLocation(pathname: string, search = ''): string {
	const locale = pathLocale(pathname)
	const login = localizedPath('/login', locale)
	const next = safeNext(`${pathname}${search}`, locale)
	return next === localizedPath('/', locale) ? login : `${login}?next=${encodeURIComponent(next)}`
}

/** The user of the session of a request; `401 UNAUTHENTICATED` without one. */
export function sessionUser(context: Pick<RequestContext, 'session'>): string {
	const user = (context.session.current?.data as Partial<DashboardSession> | undefined)?.user
	if (typeof user !== 'string' || !user) throw new ApiError('UNAUTHENTICATED', 401)
	return user
}

/**
 * Refuses to serve production without a login: the build listens on every interface there (see
 * `meeko.config.ts`), so a dashboard without an account would be open to whoever reaches it.
 * Also needs the database, where the sessions live. Throws an `Error` that says what to set.
 */
export function assertProductionAuth(config: AuthConfig, env: { readonly DATABASE_URL?: string | undefined }): void {
	const missing = [!config.admin && 'ADMIN_USERNAME y ADMIN_PASSWORD_HASH', !env.DATABASE_URL?.trim() && 'DATABASE_URL (las sesiones viven en PostgreSQL)'].filter(Boolean)
	if (missing.length) throw new Error(`El dashboard no arranca en producción sin login: define ${missing.join(' y ')}. Véase apps/dashboard/README.md, «F5: autenticación».`)
}

/** The minimum duration of a failed login, so a failure takes the same time whatever failed. */
export const failedLoginMs = 1000

/**
 * Runs `task` and, if it throws, waits until `failedLoginMs` passed since `started` before
 * rethrowing: a wrong user, a wrong password and a rate limit answer after the same time.
 */
export async function withConstantFailure<T>(task: () => Promise<T>, started: number = performance.now(), minimumMs: number = failedLoginMs): Promise<T> {
	try {
		return await task()
	} catch (error) {
		const left = minimumMs - (performance.now() - started)
		if (left > 0) await new Promise((done) => setTimeout(done, left))
		throw error
	}
}

/**
 * The login page after a logout, in the language of the page it was sent from (`referer`, a page
 * of this `origin`): `/en/login` from an English page, `/login` from any other or without one.
 */
export function logoutLocation(referer: string | null, origin: string): string {
	let pathname = '/'
	try {
		const url = referer ? new URL(referer) : null
		if (url?.origin === origin) pathname = url.pathname
	} catch {
		// An unreadable Referer is a Spanish page.
	}
	return localizedPath('/login', pathLocale(pathname))
}
