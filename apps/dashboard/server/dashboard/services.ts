import type { Database } from 'meeko-docs-content/db'

import { ApiError } from '@meekojs/meeko/server'
import { createDatabase } from 'meeko-docs-content/db'
import { join } from 'node:path'

import { JobRunner } from './jobs'
import { PreviewRunner } from './preview'

/** The environment the dashboard reads. */
export interface DashboardEnv {
	readonly DATABASE_URL?: string | undefined
	/** Schema of the tables (`search_path`), such as the temporary schema of a test. */
	readonly DASHBOARD_DATABASE_SCHEMA?: string | undefined
	readonly [name: string]: string | undefined
}

/** The services of every request: the documentation database, the jobs and the preview. */
export interface Dashboard {
	/** The pool of the documentation database; `503 DATABASE_UNAVAILABLE` without `DATABASE_URL`. */
	database(): Database
	readonly jobs: JobRunner
	/** The worker that renders the preview of a draft. */
	readonly preview: PreviewRunner
	close(): Promise<void>
}

const schemaName = /^[a-z_][a-z0-9_]*$/

/**
 * Creates the dashboard's services from `env`. The pool opens on first use, so a missing or wrong
 * `DATABASE_URL` is an error state of the pages, not a server that cannot start.
 */
export function createDashboard(env: DashboardEnv, options: { readonly jobs?: JobRunner; readonly preview?: PreviewRunner; readonly root?: string } = {}): Dashboard {
	const schema = env.DASHBOARD_DATABASE_SCHEMA?.trim() || undefined
	if (schema !== undefined && !schemaName.test(schema)) throw new TypeError(`DASHBOARD_DATABASE_SCHEMA is not a schema name: ${schema}`)
	let pool: Database | undefined
	// The bundle of `meeko build` moves this module, so its scripts are found from the project's root
	// (`ServerRuntimeContext.root`, which `server/runtime.ts` passes), not import.meta.url. Without it
	// (a test, Cloudflare), the working directory, where `meeko dev` and `meeko start` run.
	const root = options.root ?? process.cwd()
	const jobs = options.jobs ?? new JobRunner({ script: join(root, 'scripts', 'content-job.mjs'), cwd: root, env: { ...process.env, ...env } })
	const preview = options.preview ?? new PreviewRunner({ script: join(root, 'scripts', 'preview-worker.mjs'), cwd: root, env: { ...process.env, ...env } })
	return {
		database() {
			const connectionString = env.DATABASE_URL?.trim()
			if (!connectionString) throw new ApiError('DATABASE_UNAVAILABLE', 503, 'DATABASE_URL is not set')
			if (!pool) {
				pool = createDatabase({ connectionString, ...(schema ? { searchPath: schema } : {}) })
				// An idle client that loses its connection must not take the process down.
				pool.on('error', (error) => console.error('[dashboard] database client error:', error.message))
			}
			return pool
		},
		jobs,
		preview,
		async close() {
			await Promise.all([jobs.close(), preview.close()])
			const current = pool
			pool = undefined
			await current?.end()
		},
	}
}
