import { ApiError } from '@meekojs/meeko/server'

/** SQLSTATE and Node codes of a database that cannot be reached or used. */
const unavailable = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET', '3D000', '28P01', '28000', '57P03'])

/**
 * Runs a read or an action of the database, with its failures as public codes: the client only
 * receives the code, so the pages explain each one. `42P01` (a missing table) means the schema has
 * not been migrated.
 */
export async function databaseTask<T>(task: () => Promise<T>): Promise<T> {
	try {
		return await task()
	} catch (error) {
		if (error instanceof ApiError) throw error
		const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
		if (code === '42P01') throw new ApiError('SCHEMA_MISSING', 503, { message: 'The documentation tables do not exist: run db:migrate' })
		if (unavailable.has(code)) throw new ApiError('DATABASE_UNAVAILABLE', 503, { message: `The documentation database is unavailable (${code})` })
		throw error
	}
}

/** `409 JOB_RUNNING` while an import or a publication runs. */
export function assertNoContentJob(jobs: { status(): { readonly content: { readonly status: string } | null } }): void {
	if (jobs.status().content?.status === 'running') throw new ApiError('JOB_RUNNING', 409, 'An import or a publication is running')
}
