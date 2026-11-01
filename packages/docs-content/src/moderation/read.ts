import pg from 'pg'

import type { Queryable } from '../db/pool'
import type { AnnouncementTone, ModerationSite, PublicAnnouncement, SiteModeration } from './shared'

import { emptyModeration } from './shared'

/** Options of {@link createModerationReader}. */
export interface ModerationReaderOptions {
	/**
	 * The database to read, or `undefined` when there is none: then every read is
	 * {@link emptyModeration}. By default, a small pool of `DATABASE_URL` opened on first use.
	 */
	readonly db?: () => Queryable | undefined
	/** How long a read of a site is reused, in milliseconds; 30 s by default. */
	readonly ttlMs?: number | undefined
	/** How long a failed read keeps serving no moderation before trying again; 10 s by default. */
	readonly retryMs?: number | undefined
	/** The clock of the dates of the announcements and of the cache. */
	readonly now?: () => number
	/** Where a failure is reported, once until the database answers again; `console.warn` by default. */
	readonly log?: (message: string) => void
}

/** Reads the moderation of the public sites through a short in-memory cache. */
export interface ModerationReader {
	/**
	 * The moderation of `site`: never throws. Without a database, or when it fails, it is
	 * {@link emptyModeration} and the failure is logged, so the site keeps serving its pages.
	 */
	read(site: ModerationSite): Promise<SiteModeration>
	/** Forgets the cached moderation of `site`, or of every site, so the next read queries again. */
	invalidate(site?: ModerationSite): void
	/** Closes the pool this reader opened, if any. */
	close(): Promise<void>
}

interface AnnouncementRow {
	readonly id: string
	readonly message: string
	readonly tone: AnnouncementTone
	readonly starts_at: Date | null
	readonly ends_at: Date | null
	readonly created_at: Date
}

interface Cached {
	readonly expires: number
	readonly hidden: readonly string[]
	readonly featured: readonly string[]
	readonly announcements: readonly AnnouncementRow[]
}

/** Announcements a site shows at most at once. */
const maxAnnouncements = 3

/**
 * Rows of each kind a read keeps: the newest announcements already in force, and the ones that
 * start soonest. Kept apart, many scheduled announcements cannot push out one in force, and one
 * that starts while the read is cached still shows on time.
 */
const announcementRows = 20

/**
 * A pool for the public sites: two connections that give up after 3 s, so a database that does not
 * answer delays a page by 3 s once per retry instead of hanging it. An idle client that loses its
 * connection is logged, never thrown.
 */
function sitePool(connectionString: string, log: (message: string) => void): pg.Pool {
	const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30_000, query_timeout: 3000, allowExitOnIdle: true })
	pool.on('error', (error) => log(`[docs-moderation] database client error: ${error.message}`))
	return pool
}

/** The announcements of `rows` in force at `now`, newest first, as many as a site shows. */
function inForce(rows: readonly AnnouncementRow[], now: number): PublicAnnouncement[] {
	return rows
		.filter((row) => (row.starts_at === null || row.starts_at.getTime() <= now) && (row.ends_at === null || row.ends_at.getTime() > now))
		.sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || Number(b.id) - Number(a.id))
		.slice(0, maxAnnouncements)
		.map((row) => ({ id: Number(row.id), message: row.message, tone: row.tone }))
}

/**
 * Creates a reader of the moderation of the public sites: its rules and its active announcements,
 * cached per site for `ttlMs`. Two reads at once share one query. An announcement that starts or
 * ends while cached appears or leaves on time, because its dates are applied on every read.
 *
 * @example
 * ```ts
 * const reader = createModerationReader({ ttlMs: 30_000 })
 * const { hidden, featured, announcements } = await reader.read('ui')
 * ```
 */
export function createModerationReader(options: ModerationReaderOptions = {}): ModerationReader {
	const ttl = options.ttlMs ?? 30_000
	const retry = options.retryMs ?? 10_000
	const now = options.now ?? Date.now
	const log = options.log ?? ((message: string) => console.warn(message))
	const cache = new Map<ModerationSite, Cached>()
	const pending = new Map<ModerationSite, Promise<Cached>>()
	let pool: pg.Pool | undefined
	let failing = false
	let warnedMissing = false

	const database = (): Queryable | undefined => {
		if (options.db) return options.db()
		const connectionString = process.env.DATABASE_URL?.trim()
		if (!connectionString) return undefined
		return (pool ??= sitePool(connectionString, log))
	}

	const query = async (site: ModerationSite): Promise<Cached> => {
		const db = database()
		if (!db) {
			if (!warnedMissing) log('[docs-moderation] DATABASE_URL is not set: serving the pages without moderation or announcements')
			warnedMissing = true
			return { expires: Number.POSITIVE_INFINITY, hidden: [], featured: [], announcements: [] }
		}
		try {
			// The limit applies to the announcements in force and, apart, to the scheduled ones, after
			// their dates: a limit before them let twenty scheduled announcements hide one in force.
			const [rules, live, scheduled] = await Promise.all([
				db.query<{ path: string; action: 'feature' | 'hide' }>('SELECT path, action FROM docs_moderation WHERE site = $1 ORDER BY path', [site]),
				db.query<AnnouncementRow>(
					`SELECT id, message, tone, starts_at, ends_at, created_at FROM docs_announcements
					WHERE site = $1 AND active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
					ORDER BY created_at DESC, id DESC LIMIT $2`,
					[site, announcementRows],
				),
				db.query<AnnouncementRow>(
					`SELECT id, message, tone, starts_at, ends_at, created_at FROM docs_announcements
					WHERE site = $1 AND active AND starts_at > now()
					ORDER BY starts_at, id LIMIT $2`,
					[site, announcementRows],
				),
			])
			if (failing) log('[docs-moderation] the database answers again')
			failing = false
			return {
				expires: now() + ttl,
				hidden: rules.rows.filter((row) => row.action === 'hide').map((row) => row.path),
				featured: rules.rows.filter((row) => row.action === 'feature').map((row) => row.path),
				announcements: [...live.rows, ...scheduled.rows],
			}
		} catch (error) {
			if (!failing) log(`[docs-moderation] cannot read the moderation (${describe(error)}): serving the pages without it`)
			failing = true
			return { expires: now() + retry, hidden: [], featured: [], announcements: [] }
		}
	}

	return {
		async read(site) {
			let entry = cache.get(site)
			if (!entry || entry.expires <= now()) {
				let running = pending.get(site)
				if (!running) {
					running = query(site).finally(() => pending.delete(site))
					pending.set(site, running)
				}
				entry = await running
				cache.set(site, entry)
			}
			if (!entry.hidden.length && !entry.featured.length && !entry.announcements.length) return emptyModeration
			return { hidden: entry.hidden, featured: entry.featured, announcements: inForce(entry.announcements, now()) }
		},
		invalidate(site) {
			if (site) cache.delete(site)
			else cache.clear()
		},
		async close() {
			cache.clear()
			const current = pool
			pool = undefined
			await current?.end()
		},
	}
}

/** The code or the message of a failure, without the connection string. */
function describe(error: unknown): string {
	if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code
	return error instanceof Error ? error.message : String(error)
}

let shared: ModerationReader | undefined

/**
 * A duration of the environment in milliseconds, between 0 and `max`; `undefined` when unset or
 * malformed. The end-to-end tests shorten the cache with it; it can never make it longer.
 */
function durationFromEnv(name: string, max: number): number | undefined {
	const value = process.env[name]?.trim()
	if (!value || !/^\d+$/.test(value)) return undefined
	return Math.min(Number(value), max)
}

/**
 * The reader of the process, from `DATABASE_URL`, with a 30 s cache. `DOCS_MODERATION_TTL_MS` and
 * `DOCS_MODERATION_RETRY_MS` shorten the cache and the retry (the end-to-end tests do).
 */
function reader(): ModerationReader {
	return (shared ??= createModerationReader({ ttlMs: durationFromEnv('DOCS_MODERATION_TTL_MS', 30_000), retryMs: durationFromEnv('DOCS_MODERATION_RETRY_MS', 10_000) }))
}

/**
 * The moderation of `site` from `DATABASE_URL`, cached for 30 s: the rules and the announcements
 * in force. Never throws: without a database it returns {@link emptyModeration} and logs once.
 *
 * @example
 * ```ts
 * const moderation = await readSiteModeration('site')
 * if (isHiddenPath(moderation, url.pathname)) notFound()
 * ```
 */
export function readSiteModeration(site: ModerationSite): Promise<SiteModeration> {
	return reader().read(site)
}

/** Forgets the cached moderation of `site`, or of every site, in this process. */
export function invalidateModeration(site?: ModerationSite): void {
	shared?.invalidate(site)
}
