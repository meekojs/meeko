import pg from 'pg'

/** La ruta del endpoint de salud de las webs y del dashboard. */
export const livenessPath = '/healthz'

/**
 * Estado de la base de documentación que publica `/healthz`: `up` responde, `down` no responde a
 * tiempo o rechaza la conexión, `unconfigured` no hay `DATABASE_URL`.
 */
export type LivenessDatabase = 'down' | 'unconfigured' | 'up'

/** Cuerpo de `/healthz`. El proceso vive aunque la base esté caída: las webs degradan sin ella. */
export interface LivenessReport {
	/** Siempre `ok` mientras el proceso atiende peticiones. */
	readonly status: 'ok'
	/** Estado de la base, sin la URL, el host ni el error. */
	readonly database: LivenessDatabase
}

/** Opciones de {@link createLivenessChecker}. */
export interface LivenessCheckerOptions {
	/** URL de PostgreSQL. Por defecto, `DATABASE_URL` del entorno en el momento de comprobar. */
	readonly connectionString?: string | undefined
	/** Durante cuánto tiempo se reutiliza el último resultado. Por defecto, 5 s. */
	readonly ttlMs?: number
	/** Límite de la conexión y de la consulta. Por defecto, 2 s. */
	readonly timeoutMs?: number
	/** Destino del único aviso cuando la base pasa a `down`. Por defecto, `console.warn`. */
	readonly log?: (message: string) => void
}

/** Comprobador de salud con su propio pool de una conexión. */
export interface LivenessChecker {
	/** El estado actual; nunca lanza. Dos llamadas a la vez comparten la consulta. */
	check(): Promise<LivenessReport>
	/** Cierra el pool, si se abrió. */
	close(): Promise<void>
}

/**
 * Crea un comprobador de `/healthz`. Un healthcheck frecuente o una ráfaga de peticiones cuestan
 * como mucho una consulta `SELECT 1` cada `ttlMs`, en un pool de una sola conexión que abandona a
 * los `timeoutMs`; así la salud nunca compite con las páginas por las conexiones de la base.
 *
 * @example
 * ```ts
 * const liveness = createLivenessChecker({ ttlMs: 1000 })
 * const report = await liveness.check() // { status: 'ok', database: 'up' }
 * await liveness.close()
 * ```
 */
export function createLivenessChecker(options: LivenessCheckerOptions = {}): LivenessChecker {
	const ttl = options.ttlMs ?? 5000
	const timeout = options.timeoutMs ?? 2000
	const log = options.log ?? ((message: string) => console.warn(message))
	let pool: pg.Pool | undefined
	let poolUrl: string | undefined
	let cached: { readonly at: number; readonly report: LivenessReport } | undefined
	let pending: Promise<LivenessReport> | undefined
	let last: LivenessDatabase | undefined

	const openPool = (connectionString: string): pg.Pool => {
		if (pool && poolUrl === connectionString) return pool
		void pool?.end().catch(() => undefined)
		poolUrl = connectionString
		pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: timeout, query_timeout: timeout, idleTimeoutMillis: 30_000, allowExitOnIdle: true })
		pool.on('error', () => undefined)
		return pool
	}

	const probe = async (): Promise<LivenessDatabase> => {
		const connectionString = (options.connectionString ?? process.env.DATABASE_URL)?.trim()
		if (!connectionString) return 'unconfigured'
		try {
			await openPool(connectionString).query('SELECT 1')
			return 'up'
		} catch {
			return 'down'
		}
	}

	const run = async (): Promise<LivenessReport> => {
		const database = await probe()
		if (database === 'down' && last !== 'down') log('[healthz] the documentation database does not answer')
		last = database
		const report: LivenessReport = { status: 'ok', database }
		cached = { at: Date.now(), report }
		return report
	}

	return {
		check() {
			if (cached && Date.now() - cached.at < ttl) return Promise.resolve(cached.report)
			pending ??= run().finally(() => {
				pending = undefined
			})
			return pending
		},
		async close() {
			const current = pool
			pool = undefined
			poolUrl = undefined
			cached = undefined
			await current?.end()
		},
	}
}

let shared: LivenessChecker | undefined

/**
 * La respuesta de `/healthz` para `GET` y `HEAD`, o `undefined` para cualquier otra petición, que
 * sigue su camino. Responde siempre `200` con {@link LivenessReport} en JSON, sin caché: el proceso
 * está vivo aunque la base no responda, porque las webs degradan sin ella. No incluye URL, host,
 * versión ni el error.
 *
 * @example
 * ```ts
 * // server/middleware/05-healthz.ts
 * import { defineServerMiddleware } from '@meekojs/meeko/server'
 * import { livenessResponse } from 'meeko-docs-content/liveness'
 *
 * export default defineServerMiddleware((request, next) => livenessResponse(request) ?? next(request))
 * ```
 */
export function livenessResponse(request: Request, checker: LivenessChecker = (shared ??= createLivenessChecker())): Promise<Response> | undefined {
	if (request.method !== 'GET' && request.method !== 'HEAD') return undefined
	if (new URL(request.url).pathname !== livenessPath) return undefined
	return checker.check().then(
		(report) =>
			new Response(request.method === 'HEAD' ? null : JSON.stringify(report), {
				status: 200,
				headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
			}),
	)
}
