import pg from 'pg'

/** A pool of connections to the documentation database. */
export type Database = pg.Pool

/** What runs a query: the pool or a client inside a transaction. */
export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>

let pool: pg.Pool | undefined

/**
 * Opens a pool to `connectionString`, or to `DATABASE_URL`. `searchPath` sets the schema where
 * unqualified tables live, such as the temporary schema of a test.
 */
export function createDatabase(options: { readonly connectionString?: string; readonly searchPath?: string } = {}): Database {
	const connectionString = options.connectionString ?? process.env.DATABASE_URL
	if (!connectionString?.trim()) throw new Error('DATABASE_URL is required for documentation storage')
	if (options.searchPath !== undefined && !/^[a-z_][a-z0-9_]*$/.test(options.searchPath)) throw new TypeError(`Invalid schema name: ${options.searchPath}`)
	return new pg.Pool({ connectionString, ...(options.searchPath ? { options: `-c search_path=${options.searchPath}` } : {}) })
}

/** The shared pool of the process, opened on first use from `DATABASE_URL`. */
export function database(): Database {
	return (pool ??= createDatabase())
}

/** Drains the shared pool, as a one-shot script does before it exits. */
export async function closePool(): Promise<void> {
	if (!pool) return
	const current = pool
	pool = undefined
	await current.end()
}

/**
 * Runs `task` in one transaction of a client of `db`: committed when it resolves, rolled back when
 * it throws. A client whose rollback fails is discarded instead of returned to the pool.
 */
export async function transaction<T>(db: Database, task: (client: pg.PoolClient) => Promise<T>): Promise<T> {
	const client = await db.connect()
	let open = false
	let discard = false
	try {
		await client.query('BEGIN')
		open = true
		const result = await task(client)
		await client.query('COMMIT')
		open = false
		return result
	} catch (error) {
		if (open) {
			try {
				await client.query('ROLLBACK')
			} catch {
				discard = true
			}
		}
		throw error
	} finally {
		client.release(discard)
	}
}

/**
 * Keys of the advisory locks of the documentation database, as the pair `(namespace, key)` of
 * `pg_advisory_xact_lock`. Publishing snapshots keeps the key it always had.
 *
 * `content` is the namespace of the content lock, which excludes a render of the site
 * (`publishDocumentation`, exclusive for its whole run) from the changes of what it renders
 * (publishing and archiving revisions, shared and only for their transaction). Its key is
 * {@link contentLockKey}: one lock per schema, because advisory locks belong to the whole database
 * and a render in the temporary schema of a test must not hold back the revisions of another.
 */
export const lockKeys = {
	namespace: 1735551795,
	snapshots: 1,
	migrations: 2,
	content: 1735551798,
} as const

/**
 * SQL of the key of the content lock in the namespace `lockKeys.content`: the schema of the tables.
 * `current_schema()` is null when no schema of the search path exists, and a null key takes no lock.
 */
export const contentLockKey = "hashtext(coalesce(current_schema(), ''))"
