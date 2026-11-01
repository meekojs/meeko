// The reads and actions of the dashboard against PostgreSQL. Every table lives in a temporary schema
// that the test drops at the end, as in packages/docs-content: the tables of the database it connects
// to are never read or written. Skipped without DATABASE_URL (apps/dashboard/.env is loaded).
import type { Database } from 'meeko-docs-content/db'

import { readGitFile } from 'meeko-docs-content/content/repository'
import { createDatabase, createRevision, getSource, importSources, migrate, publishRevision } from 'meeko-docs-content/db'
import { activateSnapshot, publishSnapshot } from 'meeko-docs-content/snapshots'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { databaseTask } from '../server/dashboard/errors'
import { readOverview, readSnapshots, readSourceDetail, readSources } from '../server/dashboard/reads'
import { createDashboard } from '../server/dashboard/services'

const app = fileURLToPath(new URL('../', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL
const schema = `dash_test_${process.pid}_${randomBytes(4).toString('hex')}`

describe('dashboard server', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	let admin: Database
	let db: Database
	const noJobs = { content: null, health: null }

	before(async () => {
		admin = createDatabase({ connectionString: url! })
		await admin.query(`CREATE SCHEMA ${schema}`)
		db = createDatabase({ connectionString: url!, searchPath: schema })
	})

	after(async () => {
		await db?.end()
		await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin?.end()
	})

	test('a schema without the tables is SCHEMA_MISSING, not a 500', async () => {
		await assert.rejects(
			databaseTask(() => readSources(db)),
			(error: Error & { code?: string; status?: number }) => error.code === 'SCHEMA_MISSING' && error.status === 503,
		)
	})

	test('the overview counts sources by web, kind and state, and the detail has the diff', async () => {
		await migrate(db)
		const doctor = readGitFile('docs/doctor.md')
		await importSources(
			db,
			[
				{ site: 'site', path: '/docs/doctor', kind: 'guide', title: 'Doctor', file: 'docs/doctor.md', markdown: doctor },
				{ site: 'site', path: '/docs/testing', kind: 'guide', title: 'Pruebas', file: 'docs/testing.md', markdown: '# Una versión antigua\n' },
				{ site: 'ui', path: '/installation', kind: 'page', title: 'Instalación', file: null, markdown: null },
			],
			['site', 'ui'],
		)
		const source = (await getSource(db, { site: 'site', path: '/docs/doctor' }))!
		const revision = await createRevision(db, { sourceId: source.id, markdown: `${doctor}\nUna línea editada desde el dashboard.\n`, author: 'test', note: 'prueba' })
		await publishRevision(db, revision.id)

		const overview = await readOverview(db, noJobs)
		const site = overview.sites.find((summary) => summary.site === 'site')!
		assert.deepEqual(site.kinds, { guide: 2, reference: 0, page: 0 })
		assert.equal(site.states.edited, 1)
		assert.equal(site.states.git, 1)
		assert.equal(site.importStale, 1, 'docs/testing.md differs from the imported Markdown')
		assert.equal(overview.sites.find((summary) => summary.site === 'ui')?.kinds.page, 1)
		assert.equal(overview.activeSnapshot, null)

		const rows = await readSources(db, { site: 'ui' })
		assert.deepEqual(
			rows.map((row) => [row.path, row.state]),
			[['/installation', null]],
		)

		const detail = await readSourceDetail(db, source.id)
		assert.equal(detail.source.state, 'edited')
		assert.equal(detail.revisions[0]?.status, 'published')
		assert.match(detail.diff, /^\+Una línea editada desde el dashboard\.$/m)
		assert.equal(detail.gitHash, source.baseHash)
		await assert.rejects(readSourceDetail(db, 999_999), (error: Error & { code?: string }) => error.code === 'SOURCE_NOT_FOUND')
	})

	test('snapshots are listed newest first and an older one can be activated', async () => {
		const first = await publishSnapshot([{ path: '/docs', payload: { title: 'uno' } }], { db, publishedBy: 'test' })
		const second = await publishSnapshot([{ path: '/docs', payload: { title: 'dos' } }], { db, publishedBy: 'test', note: 'segunda' })
		let snapshots = await readSnapshots(db)
		assert.deepEqual(
			snapshots.map((snapshot) => [snapshot.id, snapshot.active, snapshot.note]),
			[
				[second, true, 'segunda'],
				[first, false, null],
			],
		)
		await activateSnapshot(first, db)
		snapshots = await readSnapshots(db)
		assert.equal(snapshots.find((snapshot) => snapshot.active)?.id, first)
		assert.equal((await readOverview(db, noJobs)).activeSnapshot?.id, first)
	})

	test('the import job runs the real script in a child process, in the schema of the dashboard', { timeout: 240_000 }, async () => {
		const dashboard = createDashboard({ DATABASE_URL: url, DASHBOARD_DATABASE_SCHEMA: schema })
		try {
			assert.equal(dashboard.database().options.options, `-c search_path=${schema}`)
			dashboard.jobs.start({ kind: 'import' })
			await dashboard.jobs.settled('import')
			const job = dashboard.jobs.status().content!
			assert.equal(job.status, 'succeeded', job.output.join('\n'))
			assert.match(job.summary ?? '', /nuevas/)
			const overview = await readOverview(dashboard.database(), dashboard.jobs.status())
			assert.ok(
				overview.sites.every((summary) => summary.total > 0),
				'every web has imported sources',
			)
			// The revision of the previous test is still there: an import never touches revisions.
			assert.equal(overview.sites.find((summary) => summary.site === 'site')?.states.edited, 1)
		} finally {
			await dashboard.close()
		}
	})

	test('the scripts of the jobs are found from ServerRuntimeContext.root, not from the working directory', { timeout: 60_000 }, async () => {
		// A root without scripts/ makes the job fail although the working directory (apps/dashboard) has them.
		const elsewhere = createDashboard({ DATABASE_URL: url, DASHBOARD_DATABASE_SCHEMA: schema }, { root: join(app, 'tests', 'fixtures') })
		try {
			elsewhere.jobs.start({ kind: 'health' })
			await elsewhere.jobs.settled('health')
			const job = elsewhere.jobs.status().health!
			assert.equal(job.status, 'failed')
			assert.match(job.output.join('\n'), /content-job\.mjs/)
		} finally {
			await elsewhere.close()
		}
	})

	test('without DATABASE_URL the database is DATABASE_UNAVAILABLE', () => {
		const dashboard = createDashboard({ DATABASE_URL: '' })
		assert.throws(
			() => dashboard.database(),
			(error: Error & { code?: string; status?: number }) => error.code === 'DATABASE_UNAVAILABLE' && error.status === 503,
		)
		assert.throws(() => createDashboard({ DATABASE_URL: url, DASHBOARD_DATABASE_SCHEMA: 'x; drop' }), /not a schema name/)
		return dashboard.close()
	})
})
