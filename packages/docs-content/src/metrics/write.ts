import pg from 'pg'

import type { Queryable } from '../db/pool'
import type { DocsLocale } from '../locale'
import type { MetricsSite } from './shared'

import { isDocsLocale } from '../locale'
import { metricPath, metricsEnabled, metricsLimits, storedQuery } from './shared'

/** Options of {@link createMetricsWriter}. */
export interface MetricsWriterOptions {
	/**
	 * The database to write, or `undefined` when there is none: then nothing is stored. By default, a
	 * small pool of `DATABASE_URL` opened on first use.
	 */
	readonly db?: () => Queryable | undefined
	/** Whether to store anything; by default `metricsEnabled(process.env)`. */
	readonly enabled?: boolean
	/** Where a failure is reported, once until the database answers again; `console.warn` by default. */
	readonly log?: (message: string) => void
}

/** A feedback answer to store. */
export interface FeedbackRecord {
	/** The path of the page without the language prefix. */
	readonly path: string
	/** The language of the page; Spanish by default. */
	readonly locale?: DocsLocale | undefined
	readonly helpful: boolean
	/** Optional; trimmed, and an empty one is not stored. */
	readonly comment?: string | undefined
}

/**
 * Writes the metrics of the public sites. Every method resolves `true` when it stored the row and
 * `false` when it did not (metrics disabled, no database, invalid input or a failing database):
 * none throws, so a page or an endpoint never breaks because of its metrics.
 */
export interface MetricsWriter {
	/** Whether the writer stores anything: metrics enabled and a database configured. */
	readonly enabled: boolean
	/**
	 * Adds one view of `path` (without the language prefix) in `locale` (Spanish by default) today
	 * (UTC) to its aggregated row of `docs_page_views`.
	 */
	view(site: MetricsSite, path: string, locale?: DocsLocale): Promise<boolean>
	/**
	 * Stores a search with its normalized query and how many results it had. An empty query, or one
	 * that looks like personal data or a secret (`isSensitiveQuery`), is skipped without a trace.
	 * `locale` is the language of the page that searched (Spanish by default).
	 */
	search(site: MetricsSite, query: string, results: number, locale?: DocsLocale): Promise<boolean>
	/** Stores a «¿Te sirvió?» answer. */
	feedback(site: MetricsSite, record: FeedbackRecord): Promise<boolean>
	/** Closes the pool this writer opened, if any. */
	close(): Promise<void>
}

/**
 * A pool for the public sites: two connections that give up after 3 s, so a database that does not
 * answer delays a collection request, never a page. An idle client that loses its connection is
 * logged, never thrown.
 */
function sitePool(connectionString: string, log: (message: string) => void): pg.Pool {
	const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30_000, query_timeout: 3000, allowExitOnIdle: true })
	pool.on('error', (error) => log(`[docs-metrics] database client error: ${error.message}`))
	return pool
}

/** The code or the message of a failure, without the connection string. */
function describe(error: unknown): string {
	if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code
	return error instanceof Error ? error.message : String(error)
}

const sites = new Set<string>(['site', 'ui', 'i18n'])

/**
 * Creates a writer of the metrics of the public sites. Views are aggregated per page and UTC day
 * with one `INSERT … ON CONFLICT DO UPDATE`; searches and feedback are one row each. Nothing about
 * the reader is stored: no IP, cookie, user agent or identifier.
 *
 * @example
 * ```ts
 * const metrics = createMetricsWriter()
 * await metrics.view('site', '/docs/signal')
 * ```
 */
export function createMetricsWriter(options: MetricsWriterOptions = {}): MetricsWriter {
	const log = options.log ?? ((message: string) => console.warn(message))
	const enabled = options.enabled ?? metricsEnabled(process.env)
	let pool: pg.Pool | undefined
	let failing = false

	const database = (): Queryable | undefined => {
		if (!enabled) return undefined
		if (options.db) return options.db()
		const connectionString = process.env.DATABASE_URL?.trim()
		if (!connectionString) return undefined
		return (pool ??= sitePool(connectionString, log))
	}

	const write = async (site: MetricsSite, sql: string, values: readonly unknown[]): Promise<boolean> => {
		if (!sites.has(site)) return false
		const db = database()
		if (!db) return false
		try {
			await db.query(sql, [site, ...values])
			if (failing) log('[docs-metrics] the database answers again')
			failing = false
			return true
		} catch (error) {
			if (!failing) log(`[docs-metrics] cannot store a metric (${describe(error)}): it is ignored`)
			failing = true
			return false
		}
	}

	return {
		get enabled() {
			return enabled && (options.db ? options.db() !== undefined : Boolean(process.env.DATABASE_URL?.trim()))
		},
		view(site, href, locale = 'es') {
			const path = metricPath(href)
			if (path === null || !isDocsLocale(locale)) return Promise.resolve(false)
			return write(
				site,
				`INSERT INTO docs_page_views (site, path, day, views, locale) VALUES ($1, $2, (now() AT TIME ZONE 'UTC')::date, 1, $3)
				ON CONFLICT (site, locale, path, day) DO UPDATE SET views = docs_page_views.views + 1`,
				[path, locale],
			)
		},
		search(site, text, results, locale = 'es') {
			const query = storedQuery(text)
			if (!query || !Number.isSafeInteger(results) || results < 0 || !isDocsLocale(locale)) return Promise.resolve(false)
			return write(site, 'INSERT INTO docs_searches (site, query, results, locale) VALUES ($1, $2, $3, $4)', [query, Math.min(results, metricsLimits.results), locale])
		},
		feedback(site, record) {
			const path = metricPath(record.path)
			const locale = record.locale ?? 'es'
			const comment = record.comment?.trim() || null
			if (path === null || !isDocsLocale(locale) || typeof record.helpful !== 'boolean' || (comment !== null && comment.length > metricsLimits.comment)) return Promise.resolve(false)
			return write(site, 'INSERT INTO docs_feedback (site, path, helpful, comment, locale) VALUES ($1, $2, $3, $4, $5)', [path, record.helpful, comment, locale])
		},
		async close() {
			const current = pool
			pool = undefined
			await current?.end()
		},
	}
}

let shared: MetricsWriter | undefined

/** The writer of the process, from `DATABASE_URL` and `DOCS_METRICS`. */
export function metricsWriter(): MetricsWriter {
	return (shared ??= createMetricsWriter())
}
