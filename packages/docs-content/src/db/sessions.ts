import type { SqlRateLimitRow, SqlSessionDriver, SqlSessionRow } from '@meekojs/meeko/server'

import type { Queryable } from './pool'

/** Options of {@link dashboardSessionDriver}. */
export interface DashboardSessionOptions {
	/**
	 * Inactivity limit in milliseconds: a session that no request read for this long is gone, even
	 * before it expires. Each read of a live session counts as activity.
	 */
	readonly idleMs: number
	/** The clock, in milliseconds since the epoch; `Date.now` by default (tests pass their own). */
	readonly now?: () => number
}

interface SessionRow {
	id: string
	family_id: string
	csrf_token: string
	data_json: string
	created_at: string
	expires_at: string
}

const columns = 'id, family_id, csrf_token, data_json, created_at, expires_at'

function sessionRow(row: SessionRow): SqlSessionRow {
	return { id: row.id, familyId: row.family_id, csrfToken: row.csrf_token, dataJson: row.data_json, createdAt: Number(row.created_at), expiresAt: Number(row.expires_at) }
}

// One fixed window per key, as Meeko documents for PostgreSQL: both assignments read the previous
// row, so the reset of `count` and of `window_ends_at` coincide.
const rateLimitSql = `INSERT INTO dashboard_rate_limits AS r (key, window_ends_at, count) VALUES ($1, $2::bigint + $3::bigint, 1)
ON CONFLICT (key) DO UPDATE SET
	count = CASE WHEN r.window_ends_at <= $2 THEN 1 ELSE r.count + 1 END,
	window_ends_at = CASE WHEN r.window_ends_at <= $2 THEN EXCLUDED.window_ends_at ELSE r.window_ends_at END
RETURNING count, window_ends_at`

function assertIdle(idleMs: number): void {
	if (!Number.isSafeInteger(idleMs) || idleMs <= 0) throw new RangeError('The inactivity limit is a positive integer of milliseconds')
}

/**
 * The `SqlSessionDriver` of the dashboard's sessions, over `dashboard_sessions` and
 * `dashboard_rate_limits` (migration 005), for `SqlSessionStore` of `@meekojs/meeko/server`.
 *
 * Besides Meeko's contract it applies an inactivity limit, which `SessionManager` does not have: a
 * read refreshes `last_seen_at` of a live session in the same statement, and a session idle for
 * `idleMs` reads as missing and is deleted. The absolute expiry stays Meeko's (`expires_at`).
 * Every statement is atomic on its own, so rotation and revocation hold across instances.
 */
export function dashboardSessionDriver(db: Queryable, options: DashboardSessionOptions): SqlSessionDriver {
	assertIdle(options.idleMs)
	const idleMs = options.idleMs
	const clock = options.now ?? Date.now
	return {
		async read(id) {
			const now = clock()
			const touched = await db.query<SessionRow>(`UPDATE dashboard_sessions SET last_seen_at = $2 WHERE id = $1 AND expires_at > $2 AND last_seen_at > $2::bigint - $3::bigint RETURNING ${columns}`, [id, now, idleMs])
			const row = touched.rows[0]
			if (row) return sessionRow(row)
			// Idle or expired: it no longer exists for anyone.
			await db.query('DELETE FROM dashboard_sessions WHERE id = $1 AND (expires_at <= $2 OR last_seen_at <= $2::bigint - $3::bigint)', [id, now, idleMs])
			return undefined
		},
		async write(row) {
			await db.query(
				`INSERT INTO dashboard_sessions (id, family_id, csrf_token, data_json, created_at, expires_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7)
				ON CONFLICT (id) DO UPDATE SET csrf_token = EXCLUDED.csrf_token, data_json = EXCLUDED.data_json, expires_at = EXCLUDED.expires_at, last_seen_at = EXCLUDED.last_seen_at
				WHERE dashboard_sessions.family_id = EXCLUDED.family_id`,
				[row.id, row.familyId, row.csrfToken, row.dataJson, row.createdAt, row.expiresAt, clock()],
			)
		},
		async remove(id) {
			await db.query('DELETE FROM dashboard_sessions WHERE id = $1', [id])
		},
		async replace(previousId, row, now) {
			// `now` is Meeko's clock for the expiry; the inactivity uses the driver's, as `read` does.
			const result = await db.query(
				`UPDATE dashboard_sessions SET id = $1, csrf_token = $2, data_json = $3, created_at = $4, expires_at = $5, last_seen_at = $9
				WHERE id = $6 AND family_id = $7 AND expires_at > $8 AND last_seen_at > $9::bigint - $10::bigint`,
				[row.id, row.csrfToken, row.dataJson, row.createdAt, row.expiresAt, previousId, row.familyId, now, clock(), idleMs],
			)
			return result.rowCount === 1
		},
		async revokeFamily(familyId) {
			await db.query('DELETE FROM dashboard_sessions WHERE family_id = $1', [familyId])
		},
		async rateLimit(key, windowMs, now): Promise<SqlRateLimitRow> {
			const result = await db.query<{ count: number; window_ends_at: string }>(rateLimitSql, [Buffer.from(key), now, windowMs])
			const row = result.rows[0]!
			// bigint columns arrive as text.
			return { count: row.count, windowEndsAt: Number(row.window_ends_at) }
		},
	}
}

/**
 * Deletes the sessions that expired or went idle for `idleMs`, and the rate limit windows that
 * ended, as of `now`. Returns how many rows of each it deleted.
 */
export async function pruneDashboardSessions(db: Queryable, idleMs: number, now: number = Date.now()): Promise<{ readonly sessions: number; readonly rateLimits: number }> {
	assertIdle(idleMs)
	const sessions = await db.query('DELETE FROM dashboard_sessions WHERE expires_at <= $1 OR last_seen_at <= $1::bigint - $2::bigint', [now, idleMs])
	const rateLimits = await db.query('DELETE FROM dashboard_rate_limits WHERE window_ends_at <= $1', [now])
	return { sessions: sessions.rowCount ?? 0, rateLimits: rateLimits.rowCount ?? 0 }
}
