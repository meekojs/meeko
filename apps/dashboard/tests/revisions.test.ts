// The editing of the site's Markdown against PostgreSQL, in a temporary schema that the test drops
// at the end: drafts, publication, the frontmatter that is refused, archiving, conflicts with Git,
// the export and the preview in the real worker. The tables of the database it connects to are never
// read or written. Skipped without DATABASE_URL (apps/dashboard/.env is loaded).
import type { Database } from 'meeko-docs-content/db'

import { readGitFile } from 'meeko-docs-content/content/repository'
import { createDatabase, createRevision, getSource, importSources, migrate } from 'meeko-docs-content/db'
import { publishSnapshot } from 'meeko-docs-content/snapshots'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { readSourceDetail, readSourceRow } from '../server/dashboard/reads'
import { archive, compare, exportFile, mergeWithGit, publish, readConflict, readEditor, readPending, revisionTask, saveDraft, textHash } from '../server/dashboard/revisions'
import { createDashboard } from '../server/dashboard/services'

const app = fileURLToPath(new URL('../', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL
const schema = `dash_rev_${process.pid}_${randomBytes(4).toString('hex')}`

const code = (expected: string, status?: number) => (error: Error & { code?: string; status?: number; issues?: readonly { message: string }[] }) => error.code === expected && (status === undefined || error.status === status)

describe('editing revisions', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	let admin: Database
	let db: Database
	const doctor = readGitFile('docs/doctor.md')
	const signalFile = 'docs/reference/reactivity/signal.md'
	const signal = readGitFile(signalFile)
	const ids = { doctor: 0, signal: 0, page: 0, testing: 0 }
	const statusOf = (source: Parameters<typeof readSourceRow>[1]) => readSourceRow(db, source)

	before(async () => {
		admin = createDatabase({ connectionString: url! })
		await admin.query(`CREATE SCHEMA ${schema}`)
		db = createDatabase({ connectionString: url!, searchPath: schema })
		await migrate(db)
		const testing = readGitFile('docs/testing.md')
		await importSources(
			db,
			[
				{ site: 'site', path: '/docs/doctor', kind: 'guide', title: 'Doctor', file: 'docs/doctor.md', markdown: doctor },
				{ site: 'site', path: '/docs/reference/signal', kind: 'reference', title: 'signal', file: signalFile, markdown: signal },
				// An older Git: the import has another first line than the working tree.
				{ site: 'site', path: '/docs/testing', kind: 'guide', title: 'Pruebas', file: 'docs/testing.md', markdown: testing.replace(/^.*\n/, '# Pruebas (versión antigua)\n') },
				{ site: 'ui', path: '/installation', kind: 'page', title: 'Instalación', file: null, markdown: null },
			],
			['site', 'ui'],
		)
		for (const [key, path] of [
			['doctor', '/docs/doctor'],
			['signal', '/docs/reference/signal'],
			['testing', '/docs/testing'],
		] as const)
			ids[key] = (await getSource(db, { site: 'site', path }))!.id
		ids.page = (await getSource(db, { site: 'ui', path: '/installation' }))!.id
	})

	after(async () => {
		await db?.end()
		await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin?.end()
	})

	test('the editor starts from Git, a draft is created and saved again, and a stale save is refused', async () => {
		const editor = await readEditor(db, ids.doctor, undefined, statusOf)
		assert.deepEqual([editor.start.from, editor.start.revisionId, editor.start.baseHash, editor.revision], ['git', null, textHash(doctor), null])
		assert.equal(editor.start.markdown, doctor)
		await assert.rejects(
			revisionTask(() => readEditor(db, ids.page, undefined, statusOf)),
			code('SOURCE_NOT_EDITABLE', 409),
		)

		const created = await revisionTask(() => saveDraft(db, { sourceId: ids.doctor, markdown: `${doctor}\nBorrador uno.\n`, author: 'Ana', note: 'primera', baseHash: editor.start.baseHash! }))
		assert.deepEqual([created.status, created.baseHash, created.conflict, created.pending], ['draft', textHash(doctor), false, false])
		const saved = await revisionTask(() => saveDraft(db, { sourceId: ids.doctor, revisionId: created.id, markdown: `${doctor}\nBorrador dos.\n`, author: 'Luis', expectedHash: textHash(created.markdown) }))
		assert.deepEqual([saved.id, saved.author, saved.note], [created.id, 'Luis', null])
		await assert.rejects(
			revisionTask(() => saveDraft(db, { sourceId: ids.doctor, revisionId: created.id, markdown: '# Pisado\n', author: 'Ana', expectedHash: textHash(created.markdown) })),
			code('DRAFT_CHANGED', 409),
		)
		// The editor reopens the draft as it was saved.
		const reopened = await readEditor(db, ids.doctor, created.id, statusOf)
		assert.deepEqual([reopened.start.from, reopened.revision?.id], ['draft', created.id])
		assert.match(reopened.start.markdown, /Borrador dos/)
		// A revision of another source is not this source's.
		await assert.rejects(
			revisionTask(() => readEditor(db, ids.signal, created.id, statusOf)),
			code('REVISION_NOT_FOUND', 404),
		)
	})

	test('publish, compare, pending until a snapshot, export and archive', async () => {
		const draft = (await readSourceDetail(db, ids.doctor)).revisions[0]!
		const published = await revisionTask(() => publish(db, draft.id))
		assert.deepEqual([published.status, published.pending], ['published', true], 'without an active snapshot it is pending')
		assert.deepEqual(
			(await readPending(db)).revisions.map((revision) => [revision.id, revision.path]),
			[[draft.id, '/docs/doctor']],
		)
		const snapshot = await publishSnapshot([{ path: '/docs', payload: { title: 'x' } }], { db, publishedBy: 'test' })
		const pending = await readPending(db)
		assert.deepEqual([pending.activeSnapshotId, pending.revisions.length], [snapshot, 0])
		assert.equal((await readSourceDetail(db, ids.doctor)).revisions[0]?.pending, false)

		const comparison = await revisionTask(() => compare(db, ids.doctor, { kind: 'git' }, { kind: 'revision', id: draft.id }))
		assert.deepEqual([comparison.added, comparison.removed, comparison.fromLabel, comparison.toLabel], [2, 0, 'Git ahora', `Revisión #${draft.id}`])
		assert.match(comparison.diff, /^\+Borrador dos\.$/m)
		const other = await createRevision(db, { sourceId: ids.doctor, markdown: `${doctor}\nOtra.\n`, author: 'Ana' })
		assert.match((await compare(db, ids.doctor, { kind: 'revision', id: draft.id }, { kind: 'revision', id: other.id })).diff, /^-Borrador dos\.$/m)

		const exported = await revisionTask(() => exportFile(db, draft.id))
		assert.deepEqual([exported.file, exported.filename], ['docs/doctor.md', 'doctor.md'])
		assert.match(exported.markdown, /Borrador dos\.\n$/)
		assert.equal(readGitFile('docs/doctor.md'), doctor, 'exporting never writes to docs/')

		// Archiving the published revision that the active snapshot shows is pending until the next one:
		// the site goes back to Git only then.
		const archived = await revisionTask(() => archive(db, draft.id))
		assert.deepEqual([archived.status, archived.pending, typeof archived.archivedAt], ['archived', true, 'string'])
		assert.equal((await readSourceDetail(db, ids.doctor)).source.publishedRevisionId, null)
		assert.equal((await readSourceDetail(db, ids.doctor)).revisions.find((revision) => revision.id === draft.id)?.pending, true)
		assert.deepEqual(
			(await readPending(db)).revisions.map((revision) => [revision.id, revision.change, revision.archivedAt === archived.archivedAt]),
			[[draft.id, 'archived', true]],
		)
		// A draft archived after the snapshot changes nothing the site shows.
		await revisionTask(() => archive(db, other.id))
		assert.equal((await readPending(db)).revisions.length, 1)
		await publishSnapshot([{ path: '/docs', payload: { title: 'y' } }], { db, publishedBy: 'test' })
		assert.deepEqual((await readPending(db)).revisions, [], 'the next snapshot has Git again')
		assert.equal((await readSourceDetail(db, ids.doctor)).revisions.find((revision) => revision.id === draft.id)?.pending, false)
		await assert.rejects(
			revisionTask(() => saveDraft(db, { sourceId: ids.doctor, revisionId: draft.id, markdown: '# x\n', author: 'Ana' })),
			code('REVISION_NOT_DRAFT', 409),
		)
		await assert.rejects(
			revisionTask(() => archive(db, 999_999)),
			code('REVISION_NOT_FOUND', 404),
		)
	})

	test('a reference revision with an incomplete frontmatter is saved as a draft and refused on publish', async () => {
		const draft = await revisionTask(() => saveDraft(db, { sourceId: ids.signal, markdown: signal.replace(/^since:.*\n/m, ''), author: 'Ana' }))
		await assert.rejects(
			revisionTask(() => publish(db, draft.id)),
			(error: Error & { code?: string; status?: number; issues?: readonly { message: string }[] }) => error.code === 'REVISION_REJECTED' && error.status === 422 && /needs since/.test(error.issues?.[0]?.message ?? ''),
		)
		assert.equal((await readSourceDetail(db, ids.signal)).revisions[0]?.status, 'draft')
		// A frontmatter that does not even parse cannot be saved.
		await assert.rejects(
			revisionTask(() => saveDraft(db, { sourceId: ids.signal, markdown: 'sin frontmatter\n', author: 'Ana' })),
			(error: Error & { code?: string; issues?: readonly { message: string }[] }) => error.code === 'INVALID_REVISION' && /frontmatter/.test(error.issues?.[0]?.message ?? ''),
		)
	})

	test('while a publication renders in any process, publishing and archiving are 409 JOB_RUNNING; an archived revision can be published again', async () => {
		const first = await revisionTask(() => saveDraft(db, { sourceId: ids.doctor, markdown: `${doctor}\nPrimera.\n`, author: 'Ana' }))
		const second = await revisionTask(() => saveDraft(db, { sourceId: ids.doctor, markdown: `${doctor}\nSegunda.\n`, author: 'Ana' }))
		await revisionTask(() => publish(db, first.id))
		// Another process (docs:sync or a job of another dashboard) holds the content lock while it
		// renders: lockKeys.content and contentLockKey of meeko-docs-content/src/db/pool.ts.
		const render = await db.connect()
		try {
			await render.query("SELECT pg_advisory_lock($1, hashtext(coalesce(current_schema(), '')))", [1735551798])
			await assert.rejects(
				revisionTask(() => publish(db, second.id)),
				code('JOB_RUNNING', 409),
			)
			await assert.rejects(
				revisionTask(() => archive(db, first.id)),
				code('JOB_RUNNING', 409),
			)
			assert.equal((await readSourceDetail(db, ids.doctor)).source.publishedRevisionId, first.id, 'nothing changed')
		} finally {
			await render.query("SELECT pg_advisory_unlock($1, hashtext(coalesce(current_schema(), '')))", [1735551798])
			render.release()
		}
		await revisionTask(() => publish(db, second.id))
		// Publishing the archived one restores its text and makes it pending again.
		const restored = await revisionTask(() => publish(db, first.id))
		assert.deepEqual([restored.status, restored.pending], ['published', true])
		assert.ok((await readPending(db)).revisions.some((revision) => revision.id === first.id))
		await revisionTask(() => archive(db, first.id))
		await revisionTask(() => archive(db, second.id))
	})

	test('a revision written from an older Git shows the three sides and becomes a new draft when the merge is trivial', async () => {
		const source = (await getSource(db, ids.testing))!
		// Written from the import (the older Git), it adds a line at the end.
		const revision = await createRevision(db, { sourceId: ids.testing, markdown: `${source.markdown}\nLínea de la revisión.\n`, author: 'Ana' })
		assert.equal((await readSourceDetail(db, ids.testing)).revisions[0]?.conflict, true)
		const conflict = await revisionTask(() => readConflict(db, revision.id))
		assert.deepEqual([conflict.state, conflict.baseOrigin, conflict.merge], ['conflict', 'import', { clean: true, conflicts: 0 }])
		assert.match(conflict.diffs.baseToGit, /^-# Pruebas \(versión antigua\)$/m)
		assert.match(conflict.diffs.baseToRevision, /^\+Línea de la revisión\.$/m)
		const merged = await revisionTask(() => mergeWithGit(db, revision.id, 'Ana', undefined))
		const git = readGitFile('docs/testing.md')
		assert.deepEqual([merged.status, merged.baseHash, merged.conflict, merged.markdown], ['draft', textHash(git), false, `${git}\nLínea de la revisión.\n`])
		await assert.rejects(
			revisionTask(() => mergeWithGit(db, merged.id, 'Ana', undefined)),
			code('NO_CONFLICT', 409),
		)
		// The same first line changed on both sides: only reported.
		const clash = await createRevision(db, { sourceId: ids.testing, markdown: source.markdown!.replace(/^.*\n/, '# Pruebas (de la revisión)\n'), author: 'Ana' })
		assert.deepEqual((await readConflict(db, clash.id)).merge, { clean: false, conflicts: 1 })
		await assert.rejects(
			revisionTask(() => mergeWithGit(db, clash.id, 'Ana', undefined)),
			code('MERGE_NOT_TRIVIAL', 409),
		)
	})

	test('the preview renders drafts in one real worker that stops with the dashboard', { timeout: 120_000 }, async () => {
		const dashboard = createDashboard({ DATABASE_URL: url, DASHBOARD_DATABASE_SCHEMA: schema })
		try {
			const preview = await dashboard.preview.render({ file: signalFile, kind: 'reference', markdown: signal.replace(/^since:.*\n/m, '') })
			assert.equal(preview.complete, false)
			assert.deepEqual(
				preview.issues.map((issue) => issue.kind),
				['frontmatter'],
			)
			const guide = await dashboard.preview.render({ file: 'docs/doctor.md', kind: 'guide', markdown: `${doctor}\nVista previa del borrador.\n` })
			assert.match(guide.html, /Vista previa del borrador/)
			assert.equal(dashboard.preview.started, 1, 'one worker for both')
		} finally {
			await dashboard.close()
		}
		assert.equal(dashboard.preview.pid, null, 'closing the dashboard stops the worker')
	})
})
