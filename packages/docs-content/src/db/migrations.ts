import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Database } from './pool'

import { contentHash, normalizeText } from '../sources/overlay'
import { database, lockKeys, transaction } from './pool'

/** A migration of the package: `migrations/<version>_<name>.sql`. */
export interface Migration {
	/** The number of its file name, such as `2` for `002_dashboard.sql`. */
	readonly version: number
	/** Its file name without the number and `.sql`, such as `dashboard`. */
	readonly name: string
	readonly sql: string
	/** SHA-256 of its SQL with `\n` line endings, so a checkout with CRLF has the same one. */
	readonly checksum: string
}

/** A migration recorded in `docs_schema_migrations`. */
export interface AppliedMigration {
	readonly version: number
	readonly name: string
	readonly checksum: string
}

/** What {@link migrate} did. */
export interface MigrationResult {
	/** Migrations applied by this call, in order. */
	readonly applied: readonly Migration[]
	/** Versions that were already applied. */
	readonly current: readonly number[]
}

const fileName = /^(\d{3,})_([a-z0-9][a-z0-9_-]*)\.sql$/

/** Folder of the SQL files of the package. */
export const migrationsFolder = fileURLToPath(new URL('../../migrations/', import.meta.url))

/**
 * Parses migration files `{ file, sql }` into migrations sorted by version. Throws for a file name
 * that is not `NNN_name.sql`, for a repeated version and for a version below 1.
 */
export function parseMigrations(files: Iterable<{ readonly file: string; readonly sql: string }>): Migration[] {
	const migrations: Migration[] = []
	for (const { file, sql } of files) {
		const match = fileName.exec(file)
		if (!match) throw new TypeError(`Migration file names are NNN_name.sql: ${file}`)
		const version = Number(match[1])
		if (version < 1) throw new TypeError(`Migration versions start at 1: ${file}`)
		const text = normalizeText(sql)
		migrations.push({ version, name: match[2]!, sql: text, checksum: contentHash(text) })
	}
	migrations.sort((a, b) => a.version - b.version)
	for (let index = 1; index < migrations.length; index++) {
		if (migrations[index]!.version === migrations[index - 1]!.version) throw new TypeError(`Two migrations have version ${migrations[index]!.version}`)
	}
	return migrations
}

/** The migrations of the package, read from {@link migrationsFolder}. */
export function packageMigrations(folder: string = migrationsFolder): Migration[] {
	return parseMigrations(
		readdirSync(folder)
			.filter((file) => file.endsWith('.sql'))
			.map((file) => ({ file, sql: readFileSync(join(folder, file), 'utf8') })),
	)
}

/**
 * The migrations still to apply, in order. Throws when the database does not match the files: an
 * applied migration whose file changed or no longer exists, or a pending one older than the last
 * applied (a branch that added a migration below one already deployed).
 */
export function planMigrations(available: readonly Migration[], applied: readonly AppliedMigration[]): Migration[] {
	const byVersion = new Map(available.map((migration) => [migration.version, migration]))
	for (const record of applied) {
		const migration = byVersion.get(record.version)
		if (!migration) throw new Error(`Migration ${record.version} (${record.name}) is applied but its file does not exist`)
		if (migration.checksum !== record.checksum) throw new Error(`Migration ${record.version} (${record.name}) changed after it was applied; add a new migration instead`)
	}
	const done = new Set(applied.map((record) => record.version))
	const last = Math.max(0, ...done)
	const pending = available.filter((migration) => !done.has(migration.version))
	const late = pending.find((migration) => migration.version < last)
	if (late) throw new Error(`Migration ${late.version} (${late.name}) is older than the last applied one (${last}); renumber it`)
	return pending
}

const controlTable = `CREATE TABLE IF NOT EXISTS docs_schema_migrations (
	version integer PRIMARY KEY CHECK (version > 0),
	name text NOT NULL,
	checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
	applied_at timestamptz NOT NULL DEFAULT now()
)`

/**
 * Applies the pending migrations in one transaction, under an advisory lock that serializes every
 * process migrating the same database: all of them or none. Running it again applies nothing.
 */
export async function migrate(db: Database = database(), migrations: readonly Migration[] = packageMigrations()): Promise<MigrationResult> {
	return transaction(db, async (client) => {
		await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockKeys.namespace, lockKeys.migrations])
		await client.query(controlTable)
		const recorded = await client.query<{ version: number; name: string; checksum: string }>('SELECT version, name, checksum FROM docs_schema_migrations ORDER BY version')
		const pending = planMigrations(migrations, recorded.rows)
		for (const migration of pending) {
			try {
				await client.query(migration.sql)
			} catch (error) {
				throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
			}
			await client.query('INSERT INTO docs_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [migration.version, migration.name, migration.checksum])
		}
		return { applied: pending, current: recorded.rows.map((row) => row.version) }
	})
}
