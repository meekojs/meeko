import type { Database } from 'meeko-docs-content/db'

import { MemorySessionStore, SessionManager, SqlSessionStore } from '@meekojs/meeko/server'
import { dashboardSessionDriver, pruneDashboardSessions } from 'meeko-docs-content/db'

import type { AuthConfig, DashboardSession } from './auth'

/** The sessions of the dashboard and the timer that prunes them. */
export interface DashboardSessions {
	readonly manager: SessionManager<DashboardSession>
	/** Whether they live in PostgreSQL (`dashboard_sessions`) or, without a database in development, in memory. */
	readonly persistent: boolean
	/** Stops pruning; `SessionManager.close()` is Meeko's. */
	stop(): void
}

/** How often the expired sessions and the ended rate limit windows are deleted. */
const pruneEveryMs = 10 * 60_000

/**
 * The `SessionManager` of the dashboard: `SqlSessionStore` over `dashboard_sessions` of the
 * documentation database (migration 005), with the inactivity limit of its driver, or a
 * `MemorySessionStore` in development without `DATABASE_URL`. In production the cookie is
 * `__Host-meeko-dashboard.sid` with `Secure`; always `HttpOnly`, host-only and with the
 * `SameSite` of the configuration.
 */
export function createDashboardSessions(config: AuthConfig, database: Database | null, production: boolean): DashboardSessions {
	const store = database ? new SqlSessionStore<DashboardSession>(dashboardSessionDriver(database, { idleMs: config.idleMs })) : new MemorySessionStore<DashboardSession>()
	const manager = new SessionManager<DashboardSession>({
		store,
		production,
		ttlMs: config.ttlMs,
		sameSite: config.sameSite,
		// Secure needs HTTPS: the production origin is, `meeko dev` on 127.0.0.1 is not.
		secure: production,
		cookieName: production ? '__Host-meeko-dashboard.sid' : 'meeko-dashboard.sid',
	})
	let timer: NodeJS.Timeout | undefined
	if (database) {
		timer = setInterval(() => {
			pruneDashboardSessions(database, config.idleMs).catch((error: unknown) => {
				// A missing table (no migration 005 yet) or a lost connection: the next round retries.
				console.error('[dashboard] pruning the sessions failed:', error instanceof Error ? error.message : error)
			})
		}, pruneEveryMs)
		timer.unref()
	}
	return {
		manager,
		persistent: database !== null,
		stop: () => clearInterval(timer),
	}
}
