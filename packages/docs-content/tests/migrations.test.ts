import assert from 'node:assert/strict'
import { test } from 'node:test'

import { packageMigrations, parseMigrations, planMigrations } from '../src/db/migrations'
import { contentHash } from '../src/sources/overlay'

const files = [
	{ file: '002_dashboard.sql', sql: 'CREATE TABLE b ();\r\n' },
	{ file: '001_docs.sql', sql: 'CREATE TABLE a ();\n' },
]

test('migrations are parsed from NNN_name.sql and sorted by version', () => {
	const migrations = parseMigrations(files)
	assert.deepEqual(
		migrations.map(({ version, name }) => [version, name]),
		[
			[1, 'docs'],
			[2, 'dashboard'],
		],
	)
	// The checksum ignores CRLF, so a Windows checkout matches the one that applied it.
	assert.equal(migrations[1]!.checksum, contentHash('CREATE TABLE b ();\n'))
	assert.throws(() => parseMigrations([{ file: '3_bad.sql', sql: '' }]), /NNN_name\.sql/)
	assert.throws(() => parseMigrations([{ file: '000_zero.sql', sql: '' }]), /start at 1/)
	assert.throws(
		() =>
			parseMigrations([
				{ file: '001_a.sql', sql: '' },
				{ file: '001_b.sql', sql: '' },
			]),
		/Two migrations have version 1/,
	)
})

test('the plan applies what is missing and refuses a database that does not match the files', () => {
	const migrations = parseMigrations(files)
	const [first, second] = migrations as [(typeof migrations)[0], (typeof migrations)[0]]
	assert.deepEqual(planMigrations(migrations, []), migrations)
	assert.deepEqual(planMigrations(migrations, [first]), [second])
	assert.deepEqual(planMigrations(migrations, [first, second]), [])
	assert.throws(() => planMigrations(migrations, [{ ...first, checksum: contentHash('edited') }]), /changed after it was applied/)
	assert.throws(() => planMigrations(migrations, [first, second, { version: 3, name: 'future', checksum: contentHash('x') }]), /its file does not exist/)
	assert.throws(() => planMigrations(migrations, [second]), /older than the last applied/)
})

test('the package ships 001_docs unchanged and the dashboard tables in 002', () => {
	const migrations = packageMigrations()
	assert.deepEqual(
		migrations.map(({ version, name }) => `${version}_${name}`),
		['1_docs', '2_dashboard', '3_metrics', '4_moderation_versions', '5_dashboard_auth', '6_locales'],
	)
	assert.match(migrations[0]!.sql, /CREATE TABLE IF NOT EXISTS docs_snapshots/)
	for (const table of ['docs_sources', 'docs_revisions', 'docs_moderation', 'docs_announcements', 'docs_feedback', 'docs_page_views', 'docs_searches']) {
		assert.match(migrations[1]!.sql, new RegExp(`CREATE TABLE ${table} \\(`), table)
	}
	assert.match(migrations[1]!.sql, /CREATE UNIQUE INDEX docs_revisions_one_published ON docs_revisions \(source_id\) WHERE status = 'published'/)
	assert.doesNotMatch(migrations[1]!.sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|ALTER\s+COLUMN)\b/i, 'the dashboard migration is additive')
})

test('003 adds the review of the comments and the archiving date, and nothing else', () => {
	const metrics = packageMigrations()[2]!
	assert.match(metrics.sql, /ALTER TABLE docs_feedback ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;/)
	assert.match(metrics.sql, /ALTER TABLE docs_revisions ADD COLUMN IF NOT EXISTS archived_at timestamptz;/)
	assert.match(metrics.sql, /CHECK \(archived_at IS NULL OR status = 'archived'\)/)
	assert.doesNotMatch(metrics.sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|ALTER\s+COLUMN)\b/i, 'the metrics migration is additive')
	assert.doesNotMatch(metrics.sql, /ADD COLUMN[^;]*NOT NULL/i, 'its new columns are nullable')
})

test('004 adds the versions of the moderation with a default, and nothing else', () => {
	const versions = packageMigrations()[3]!
	for (const table of ['docs_moderation', 'docs_announcements']) assert.match(versions.sql, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1`), table)
	assert.doesNotMatch(versions.sql, /\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|ALTER\s+COLUMN)\b/i, 'the versions migration is additive')
})

test('005 adds the sessions and rate limits of the dashboard login, and who reviewed a comment', () => {
	const auth = packageMigrations()[4]!
	assert.match(auth.sql, /CREATE TABLE IF NOT EXISTS dashboard_sessions \(/)
	assert.match(auth.sql, /family_id text NOT NULL UNIQUE/, 'one active ID per family, as SqlSessionStore requires')
	assert.match(auth.sql, /CREATE UNLOGGED TABLE IF NOT EXISTS dashboard_rate_limits \(/)
	assert.match(auth.sql, /ALTER TABLE docs_feedback ADD COLUMN IF NOT EXISTS reviewed_by text/)
	assert.doesNotMatch(auth.sql, /(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|ALTER\s+COLUMN)/i, 'the auth migration is additive')
	assert.doesNotMatch(auth.sql, /ADD COLUMN[^;]*NOT NULL/i, 'its new column is nullable')
})

test('006 adds the languages: every existing row becomes Spanish and nothing is deleted', () => {
	const locales = packageMigrations()[5]!
	for (const table of ['docs_sources', 'docs_pages', 'docs_feedback', 'docs_page_views', 'docs_searches']) {
		assert.ok(locales.sql.includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en'));`), table)
	}
	// Moderation and announcements: NULL is every language, and the default keeps the old writers in Spanish.
	for (const table of ['docs_moderation', 'docs_announcements']) assert.ok(locales.sql.includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS locale text DEFAULT 'es' CHECK`), table)
	assert.match(locales.sql, /UNIQUE \(site, locale, path\)/)
	assert.match(locales.sql, /UNIQUE NULLS NOT DISTINCT \(site, locale, path\)/)
	assert.match(locales.sql, /PRIMARY KEY \(snapshot_id, locale, path\)/)
	assert.match(locales.sql, /PRIMARY KEY \(site, locale, path, day\)/)
	// It drops only constraints that it replaces with the language: no rows, tables or columns.
	assert.doesNotMatch(locales.sql, /\b(?:TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET|ALTER\s+COLUMN|DROP\s+(?:TABLE|COLUMN|INDEX))\b/i, 'the locales migration keeps every row')
	const dropped = [...locales.sql.matchAll(/DROP CONSTRAINT (\w+)/g)].map((match) => match[1])
	assert.deepEqual(dropped, ['docs_sources_site_path', 'docs_pages_pkey', 'docs_moderation_site_path', 'docs_page_views_pkey'])
})
