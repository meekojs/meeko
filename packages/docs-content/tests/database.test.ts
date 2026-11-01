// Integration with PostgreSQL: every table lives in a temporary schema that the test drops at the
// end, so it never touches the tables of the database it connects to. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { Database } from '../src/db/pool'
import type { SourceEntry } from '../src/sources/discover'

import { readGitFile } from '../src/content/repository'
import { revisionConflict } from '../src/db/conflict'
import { migrate, packageMigrations } from '../src/db/migrations'
import { createDatabase } from '../src/db/pool'
import { archiveRevision, createRevision, exportRevision, getRevision, listRevisions, publishedOverlay, publishRevision, RevisionError, sourceDivergence, updateDraft } from '../src/db/revisions'
import { activateSnapshot, activeSnapshot, activeSnapshotId, listPages, listSnapshots, publishSnapshot, readPage, searchPages, SnapshotConflictError } from '../src/db/snapshots'
import { getSource, importSources, listSources } from '../src/db/sources'
import { publishDocumentation } from '../src/publish'
import { findGitVersion } from '../src/sources/history'
import { contentHash } from '../src/sources/overlay'

const url = process.env.DATABASE_URL
const schema = `docs_test_${process.pid}_${randomBytes(4).toString('hex')}`

describe('documentation database', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	let admin: Database
	let db: Database

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

	test('migrations apply once, in one locked transaction', async () => {
		const [first, second] = await Promise.all([migrate(db), migrate(db)])
		assert.deepEqual([first.applied.length, second.applied.length].sort(), [0, packageMigrations().length], 'the lock lets one process apply them')
		assert.deepEqual((await migrate(db)).applied, [])
		const tables = await db.query<{ table_name: string }>('SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name', [schema])
		assert.deepEqual(
			tables.rows.map((row) => row.table_name),
			['dashboard_rate_limits', 'dashboard_sessions', 'docs_announcements', 'docs_feedback', 'docs_moderation', 'docs_page_views', 'docs_pages', 'docs_revisions', 'docs_schema_migrations', 'docs_searches', 'docs_snapshots', 'docs_sources'],
		)
	})

	const doctor = readGitFile('docs/doctor.md')
	const entries: SourceEntry[] = [
		{ site: 'site', path: '/docs/doctor', kind: 'guide', title: 'Doctor', file: 'docs/doctor.md', markdown: doctor },
		{ site: 'site', path: '/docs/reference/signal', kind: 'reference', title: 'signal', file: 'docs/reference/reactivity/signal.md', markdown: '---\ntitle: signal\n---\nCuerpo\n' },
		{ site: 'ui', path: '/installation', kind: 'page', title: 'Instalación', file: null, markdown: null },
	]

	test('sources are imported, updated and marked removed without losing rows', async () => {
		assert.deepEqual(await importSources(db, entries, ['site', 'ui']), { inserted: 3, updated: 0, unchanged: 0, removed: 0, restored: 0 })
		assert.deepEqual(await importSources(db, entries, ['site', 'ui']), { inserted: 0, updated: 0, unchanged: 3, removed: 0, restored: 0 })
		const changed = [{ ...entries[1]!, markdown: '---\ntitle: signal\n---\nOtro cuerpo\n' }, entries[2]!]
		assert.deepEqual(await importSources(db, changed, ['site', 'ui']), { inserted: 0, updated: 1, unchanged: 1, removed: 1, restored: 0 })
		assert.equal((await listSources(db)).length, 2)
		assert.equal((await listSources(db, { includeRemoved: true })).length, 3)
		assert.deepEqual(await importSources(db, entries, ['site', 'ui']), { inserted: 0, updated: 1, unchanged: 2, removed: 0, restored: 1 })
		const page = await getSource(db, { site: 'ui', path: '/installation' })
		assert.equal(page?.markdown, null)
		await assert.rejects(importSources(db, [{ ...entries[2]!, markdown: 'x' }], ['ui']), /a page has no Markdown/)
		await assert.rejects(db.query("INSERT INTO docs_sources (site, path, kind, title) VALUES ('ui', '/x', 'guide', 'x')"), /docs_sources_markdown/, 'the schema refuses a guide without Markdown')
	})

	test('revisions: drafts, one published per source, archive and export', async () => {
		const guide = (await getSource(db, { site: 'site', path: '/docs/doctor' }))!
		const page = (await getSource(db, { site: 'ui', path: '/installation' }))!
		await assert.rejects(createRevision(db, { sourceId: page.id, markdown: '# x', author: 'ana' }), /\.meeko page/)
		await assert.rejects(createRevision(db, { sourceId: guide.id, markdown: '  ', author: 'ana' }), /cannot be empty/)
		const reference = (await getSource(db, { site: 'site', path: '/docs/reference/signal' }))!
		await assert.rejects(createRevision(db, { sourceId: reference.id, markdown: 'sin frontmatter', author: 'ana' }), /frontmatter/)

		const first = await createRevision(db, { sourceId: guide.id, markdown: '# Doctor editado\r\n\r\nPrimera versión.', author: 'ana', note: 'tono' })
		assert.equal(first.status, 'draft')
		assert.equal(first.markdown, '# Doctor editado\n\nPrimera versión.')
		assert.equal(first.baseHash, guide.baseHash)
		assert.equal((await publishRevision(db, first.id)).status, 'published')
		const second = await createRevision(db, { sourceId: guide.id, markdown: '# Doctor editado\n\nSegunda versión.\n', author: 'luis' })
		await publishRevision(db, second.id)
		assert.equal((await getRevision(db, first.id))?.status, 'archived')
		assert.deepEqual(
			(await listRevisions(db, guide.id)).map((revision) => [revision.id, revision.status]),
			[
				[second.id, 'published'],
				[first.id, 'archived'],
			],
		)
		assert.equal((await getSource(db, guide.id))?.publishedRevisionId, second.id)
		// archived_at goes too: a published revision has none (CHECK docs_revisions_archived_at, 003).
		await assert.rejects(db.query("UPDATE docs_revisions SET status = 'published', published_at = now(), archived_at = NULL WHERE id = $1", [first.id]), /docs_revisions_one_published/, 'the partial unique index allows one published revision per source')
		await assert.rejects(db.query("UPDATE docs_revisions SET status = 'draft', published_at = NULL WHERE id = $1", [first.id]), /docs_revisions_archived_at/, 'only an archived revision has an archiving date')
		assert.ok((await getRevision(db, first.id))?.archivedAt instanceof Date, 'publishing the second archived the first with its date')

		assert.deepEqual([...(await publishedOverlay(db)).entries()], [['docs/doctor.md', '# Doctor editado\n\nSegunda versión.\n']])
		assert.deepEqual(await exportRevision(db, first.id), { file: 'docs/doctor.md', markdown: '# Doctor editado\n\nPrimera versión.\n', revisionId: first.id })

		const divergence = await sourceDivergence(db, guide.id)
		assert.equal(divergence.state, 'edited')
		assert.equal(divergence.importStale, false)
		assert.equal(divergence.revisionId, second.id)
		assert.match(divergence.diff, /^\+Segunda versión\.$/m)
	})

	test('a published revision reaches the rendered snapshot', async () => {
		const result = await publishDocumentation(db, { publishedBy: 'test' })
		assert.deepEqual(result.revisions, ['docs/doctor.md'])
		const page = await readPage<{ doc: { title: string; html: string } }>('/docs/doctor', db)
		assert.equal(page?.doc.title, 'Doctor editado')
		assert.match(page!.doc.html, /Segunda versión/)
		const llms = await readPage<{ text: string }>('/llms-full.txt', db)
		assert.match(llms!.text, /Segunda versión/)
		assert.equal((await listPages(db)).length, result.locales.es.pages, 'listPages reads Spanish by default')
		assert.equal((await listPages({ db, locale: 'en' })).length, result.locales.en.pages)
		assert.equal(result.pages, result.locales.es.pages + result.locales.en.pages, 'one snapshot holds both languages')
		assert.equal(result.locales.es.pages, result.locales.en.pages, 'English has every page, translated or as a fallback')

		// Archiving the published revision brings Git back in the next snapshot.
		const guide = (await getSource(db, { site: 'site', path: '/docs/doctor' }))!
		await archiveRevision(db, guide.publishedRevisionId!)
		assert.equal((await publishedOverlay(db)).size, 0)
		assert.equal((await sourceDivergence(db, guide.id)).state, 'git')
	})

	test('a reference revision the render rejects is not published and the published one stays', async () => {
		const source = (await getSource(db, { site: 'site', path: '/docs/reference/signal' }))!
		const valid = await createRevision(db, { sourceId: source.id, markdown: readGitFile(source.file!), author: 'ana' })
		await publishRevision(db, valid.id)
		const incomplete = await createRevision(db, { sourceId: source.id, markdown: '---\ntitle: signal\n---\nCuerpo\n', author: 'luis' })
		assert.equal(incomplete.status, 'draft', 'a draft may still lack fields')
		await assert.rejects(publishRevision(db, incomplete.id), new RegExp(`Revision ${incomplete.id} cannot be published: .*needs since`))
		const unknownKey = await createRevision(db, { sourceId: source.id, markdown: readGitFile(source.file!).replace(/^---\n/, '---\nauthor: luis\n'), author: 'luis' })
		await assert.rejects(publishRevision(db, unknownKey.id), /unknown frontmatter keys: author/)
		assert.equal((await getRevision(db, incomplete.id))?.status, 'draft')
		assert.equal((await getRevision(db, valid.id))?.status, 'published')
		assert.equal((await getSource(db, source.id))?.publishedRevisionId, valid.id)
		assert.deepEqual([...(await publishedOverlay(db)).keys()], [source.file])
		await archiveRevision(db, valid.id)
	})

	test('drafts are saved again in place, with typed errors for what is refused', async () => {
		const guide = (await getSource(db, { site: 'site', path: '/docs/doctor' }))!
		const draft = await createRevision(db, { sourceId: guide.id, markdown: '# Doctor\n\nBorrador uno.\n', author: 'ana', note: 'primera' })
		const saved = await updateDraft(db, draft.id, { markdown: '# Doctor\r\n\r\nBorrador dos.\r\n', author: 'luis', expectedHash: contentHash(draft.markdown) })
		assert.deepEqual([saved.id, saved.markdown, saved.author, saved.note, saved.baseHash, saved.status], [draft.id, '# Doctor\n\nBorrador dos.\n', 'luis', 'primera', draft.baseHash, 'draft'])
		assert.equal((await updateDraft(db, draft.id, { markdown: saved.markdown, author: 'luis', note: null })).note, null)
		const code = (expected: string) => (error: unknown) => error instanceof RevisionError && error.code === expected
		// Someone saved after the editor loaded the first text: nothing is written.
		await assert.rejects(updateDraft(db, draft.id, { markdown: '# Pisado\n', author: 'ana', expectedHash: contentHash(draft.markdown) }), code('changed'))
		assert.equal((await getRevision(db, draft.id))?.markdown, saved.markdown)
		await assert.rejects(updateDraft(db, draft.id, { markdown: ' ', author: 'ana' }), code('invalid'))
		await assert.rejects(updateDraft(db, 999_999, { markdown: '# x', author: 'ana' }), code('not-found'))
		await publishRevision(db, draft.id)
		await assert.rejects(updateDraft(db, draft.id, { markdown: '# x\n', author: 'ana' }), code('not-draft'))
		await archiveRevision(db, draft.id)
		await assert.rejects(updateDraft(db, draft.id, { markdown: '# x\n', author: 'ana' }), code('not-draft'))
		const page = (await getSource(db, { site: 'ui', path: '/installation' }))!
		await assert.rejects(createRevision(db, { sourceId: page.id, markdown: '# x', author: 'ana' }), code('not-editable'))
		await assert.rejects(createRevision(db, { sourceId: guide.id, markdown: '# x', author: 'ana', baseHash: 'no' }), code('invalid'))
		// A draft started from another Git keeps that base.
		const fromTree = await createRevision(db, { sourceId: guide.id, markdown: '# x\n', author: 'ana', baseHash: contentHash('# otra base\n') })
		assert.equal(fromTree.baseHash, contentHash('# otra base\n'))
		await archiveRevision(db, fromTree.id)
		// A rejected publication carries its reason.
		const reference = (await getSource(db, { site: 'site', path: '/docs/reference/signal' }))!
		const incomplete = await createRevision(db, { sourceId: reference.id, markdown: '---\ntitle: signal\n---\nCuerpo\n', author: 'ana' })
		await assert.rejects(publishRevision(db, incomplete.id), (error: unknown) => error instanceof RevisionError && error.code === 'rejected' && /needs since/.test(error.reason ?? ''))
		await archiveRevision(db, incomplete.id)
	})

	test('a revision written from an older Git shows the three sides and merges only when trivial', async () => {
		const file = 'docs/testing.md'
		const git = readGitFile(file)
		const lines = git.replace(/\n$/, '').split('\n')
		// The import is an older Git: its first heading differs from the working tree.
		const older = [`${lines[0]} (antes)`, ...lines.slice(1)].join('\n') + '\n'
		await importSources(db, [...entries, { site: 'site', path: '/docs/testing', kind: 'guide', title: 'Pruebas', file, markdown: older }], ['site', 'ui'])
		const source = (await getSource(db, { site: 'site', path: '/docs/testing' }))!
		const ending = `${older}\nLínea añadida por la revisión.\n`
		const clean = await createRevision(db, { sourceId: source.id, markdown: ending, author: 'ana' })
		const conflict = await revisionConflict(db, clean.id)
		assert.equal(conflict.state, 'conflict')
		assert.equal(conflict.gitHash, contentHash(git))
		assert.deepEqual(conflict.base?.origin, { kind: 'import' })
		assert.match(conflict.diffs.baseToGit, /^-.*\(antes\)$/m)
		assert.match(conflict.diffs.baseToRevision, /^\+Línea añadida por la revisión\.$/m)
		assert.match(conflict.diffs.gitToRevision, /^\+Línea añadida por la revisión\.$/m)
		assert.deepEqual(conflict.merge, { clean: true, markdown: `${git}\nLínea añadida por la revisión.\n` })

		// Both sides changed the first heading: only reported.
		const clash = await createRevision(db, { sourceId: source.id, markdown: [`${lines[0]} (revisión)`, ...lines.slice(1)].join('\n') + '\n', author: 'ana' })
		const report = await revisionConflict(db, clash.id)
		assert.equal(report.state, 'conflict')
		assert.deepEqual(report.merge, { clean: false, conflicts: 1 })

		// Written from the Git of now: current, without a merge.
		const current = await createRevision(db, { sourceId: source.id, markdown: `${git}x\n`, author: 'ana', baseHash: contentHash(git) })
		const same = await revisionConflict(db, current.id)
		assert.equal(same.state, 'current')
		assert.deepEqual(same.base?.origin, { kind: 'working-tree' })
		assert.equal(same.merge, null)

		// A base nobody has: Git and the revision only.
		const lost = await createRevision(db, { sourceId: source.id, markdown: '# x\n', author: 'ana', baseHash: contentHash('nunca existió\n') })
		const unknown = await revisionConflict(db, lost.id)
		assert.equal(unknown.base, null)
		assert.equal(unknown.merge, null)
		assert.equal(unknown.diffs.baseToGit, '')
		assert.notEqual(unknown.diffs.gitToRevision, '')
		await assert.rejects(revisionConflict(db, 999_999), (error: unknown) => error instanceof RevisionError && error.code === 'not-found')
		for (const revision of [clean, clash, current, lost]) await archiveRevision(db, revision.id)
		await importSources(db, entries, ['site', 'ui'])
	})

	test('findGitVersion finds a committed version of a file by its hash', () => {
		const head = spawnSync('git', ['--no-optional-locks', 'show', 'HEAD:docs/doctor.md'], { encoding: 'utf8', windowsHide: true })
		if (head.status !== 0) return
		const found = findGitVersion('docs/doctor.md', contentHash(head.stdout))
		assert.match(found?.commit ?? '', /^[0-9a-f]{40}$/)
		assert.equal(found?.text, head.stdout.replace(/\r\n?/g, '\n'))
		assert.equal(findGitVersion('docs/doctor.md', contentHash('nunca existió\n')), null)
		assert.throws(() => findGitVersion('../fuera.md', contentHash('x')), /cannot leave the repository/)
	})

	test('snapshots: retention, listing, rollback and search', async () => {
		const ids: number[] = []
		for (const title of ['Uno', 'Dos', 'Tres']) {
			ids.push(
				await publishSnapshot(
					[
						{ path: '/docs', payload: { sections: [] } },
						{ path: '/docs/prueba', payload: { doc: { title, html: `<p>Página ${title} sobre señales</p>` }, toc: [{ id: 'senales', text: 'Señales' }] } },
					],
					{ db, keep: 2, publishedBy: 'test', note: title },
				),
			)
		}
		const snapshots = await listSnapshots(db)
		assert.deepEqual(
			snapshots.map((snapshot) => [snapshot.id, snapshot.active, snapshot.pages, snapshot.note]),
			[
				[ids[2], true, 2, 'Tres'],
				[ids[1], false, 2, 'Dos'],
			],
			'keep: 2 leaves the new one and the one active before',
		)
		assert.equal((await readPage<{ doc: { title: string } }>('/docs/prueba', db))?.doc.title, 'Tres')
		await activateSnapshot(ids[1]!, db)
		assert.equal((await readPage<{ doc: { title: string } }>('/docs/prueba', db))?.doc.title, 'Dos')
		await assert.rejects(activateSnapshot(ids[0]!, db), /does not exist/)
		const [hit] = await searchPages('Página', 5, db)
		assert.equal(hit?.url, '/docs/prueba')
		assert.equal(hit?.title, 'Dos')
		await assert.rejects(publishSnapshot([{ path: '/../x', payload: {} }], { db }), /Invalid documentation URL path/)
	})

	const tiny = (title: string) => [{ path: '/docs/prueba', payload: { doc: { title, html: `<p>${title}</p>` } } }]

	test('two publications started from the same snapshot: the second is refused', async () => {
		const start = await activeSnapshotId(db)
		const before = (await listSnapshots(db)).length
		const first = await publishSnapshot(tiny('Primera'), { db, expectActive: start, keep: 10 })
		await assert.rejects(publishSnapshot(tiny('Segunda'), { db, expectActive: start, keep: 10 }), (error: unknown) => error instanceof SnapshotConflictError && error.expected === start && error.actual === first)
		assert.equal(await activeSnapshotId(db), first)
		assert.equal((await listSnapshots(db)).length, before + 1, 'nothing of the refused one is stored')
	})

	test('a rollback during a publication wins; one before or after it is respected', async () => {
		// Publish and roll back at once: the rollback commits while the publication renders.
		const rendered = await activeSnapshotId(db)
		const older = (await listSnapshots(db)).find((snapshot) => !snapshot.active)!.id
		let reached!: () => void
		const waiting = new Promise<void>((resolve) => {
			reached = resolve
		})
		let release!: () => void
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		// The publication opens its transaction only after rendering: hold it there. Its first
		// connection is the content lock (withContentLock), taken before reading anything.
		let connects = 0
		const held = new Proxy(db, {
			get(target, key) {
				if (key === 'connect')
					return async () => {
						if (++connects === 2) {
							reached()
							await gate
						}
						return target.connect()
					}
				const value: unknown = Reflect.get(target, key)
				return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
			},
		})
		const before = (await listSnapshots(db)).map((snapshot) => snapshot.id)
		const publishing = publishDocumentation(held, { publishedBy: 'test' })
		await waiting
		await activateSnapshot(older, db)
		release()
		await assert.rejects(publishing, (error: unknown) => error instanceof SnapshotConflictError && error.expected === rendered && error.actual === older)
		assert.equal(await activeSnapshotId(db), older, 'the rollback stays active')
		assert.deepEqual(
			(await listSnapshots(db)).map((snapshot) => snapshot.id),
			before,
			'the refused publication stored nothing',
		)

		// A rollback that committed before the publication started: the publication renders on it.
		const published = await publishDocumentation(db, { publishedBy: 'test', keep: 2 })
		assert.equal(await activeSnapshotId(db), published.snapshotId)
		assert.ok(
			(await listSnapshots(db)).some((snapshot) => snapshot.id === older),
			'the snapshot rolled back to is kept',
		)

		// A rollback after the publication committed is the later action and wins.
		await activateSnapshot(older, db)
		assert.equal(await activeSnapshotId(db), older)
	})

	test('a rollback and a return to the same snapshot during a publication is a conflict (ABA)', async () => {
		const held = (pool: Database) => {
			let reached!: () => void
			const waiting = new Promise<void>((resolve) => (reached = resolve))
			let release!: () => void
			const gate = new Promise<void>((resolve) => (release = resolve))
			// The second connection opens the transaction of the snapshot, after the content lock's.
			let connects = 0
			const proxy = new Proxy(pool, {
				get(target, key) {
					if (key === 'connect')
						return async () => {
							if (++connects === 2) {
								reached()
								await gate
							}
							return target.connect()
						}
					const value: unknown = Reflect.get(target, key)
					return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
				},
			})
			return { proxy, waiting, release }
		}
		// The active snapshot goes to an older one and back while the publication renders.
		const start = (await activeSnapshotId(db))!
		const other = (await listSnapshots(db)).find((snapshot) => !snapshot.active)!.id
		const before = (await listSnapshots(db)).map((snapshot) => snapshot.id)
		const first = held(db)
		const publishing = publishDocumentation(first.proxy, { publishedBy: 'test' })
		await first.waiting
		await activateSnapshot(other, db)
		await activateSnapshot(start, db)
		first.release()
		await assert.rejects(publishing, (error: unknown) => error instanceof SnapshotConflictError && error.expected === start && error.actual === start && /activated again/.test(error.message))
		assert.equal(await activeSnapshotId(db), start)
		assert.deepEqual(
			(await listSnapshots(db)).map((snapshot) => snapshot.id),
			before,
			'the refused publication stored nothing',
		)

		// Activating the active snapshot again is a later action too.
		const token = (await activeSnapshot(db))!
		assert.equal(token.id, start)
		await activateSnapshot(start, db)
		await assert.rejects(publishSnapshot(tiny('Tras reactivar'), { db, expectActive: token, keep: 10 }), SnapshotConflictError)
		// With the token read after the last activation, it publishes; an id alone keeps working.
		const fresh = (await activeSnapshot(db))!
		const published = await publishSnapshot(tiny('Con token'), { db, expectActive: fresh, keep: 10 })
		assert.equal(await activeSnapshotId(db), published)
		const byId = await publishSnapshot(tiny('Con id'), { db, expectActive: published, keep: 10 })
		assert.equal(await activeSnapshotId(db), byId)
		assert.notEqual((await activeSnapshot(db))!.generation, fresh.generation)
	})

	test('the metric and moderation tables enforce their rules', async () => {
		await db.query("INSERT INTO docs_moderation (site, path, action, author) VALUES ('site', '/docs/doctor', 'hide', 'ana')")
		await assert.rejects(db.query("INSERT INTO docs_moderation (site, path, action, author) VALUES ('site', '/docs/doctor', 'feature', 'ana')"), /docs_moderation_site_locale_path/)
		await assert.rejects(db.query("INSERT INTO docs_announcements (site, message, tone, author) VALUES ('ui', 'Aviso', 'loud', 'ana')"), /check constraint/)
		await assert.rejects(db.query("INSERT INTO docs_announcements (site, message, author, starts_at, ends_at) VALUES ('ui', 'Aviso', 'ana', now(), now() - interval '1 day')"), /docs_announcements_window/)
		await db.query("INSERT INTO docs_feedback (site, path, helpful, comment) VALUES ('i18n', '/plurals', true, NULL)")
		await assert.rejects(db.query("INSERT INTO docs_feedback (site, path, helpful) VALUES ('blog', '/x', true)"), /check constraint/)
		await db.query("INSERT INTO docs_page_views (site, path, day, views) VALUES ('site', '/docs', current_date, 1) ON CONFLICT (site, locale, path, day) DO UPDATE SET views = docs_page_views.views + 1")
		await db.query("INSERT INTO docs_page_views (site, path, day, views) VALUES ('site', '/docs', current_date, 1) ON CONFLICT (site, locale, path, day) DO UPDATE SET views = docs_page_views.views + 1")
		assert.equal((await db.query<{ views: string }>("SELECT views FROM docs_page_views WHERE site = 'site' AND path = '/docs'")).rows[0]?.views, '2')
		await assert.rejects(db.query("INSERT INTO docs_searches (site, query, results) VALUES ('site', 'x', -1)"), /check constraint/)
	})
})

describe('adopting a database that only has 001_docs', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	const snapshotRows = `SELECT s.id, s.published_at, s.active, p.path, p.payload, p.searchable_text
		FROM docs_snapshots AS s JOIN docs_pages AS p ON p.snapshot_id = s.id ORDER BY s.id, p.path`

	for (const legacy of [true, false]) {
		test(`001 applied by ${legacy ? 'the old site script' : 'the runner'}, with snapshots, then 002 keeps them`, async () => {
			const name = `${schema}_${legacy ? 'legacy' : 'runner'}`
			const admin = createDatabase({ connectionString: url! })
			await admin.query(`CREATE SCHEMA ${name}`)
			const db = createDatabase({ connectionString: url!, searchPath: name })
			try {
				const docs = packageMigrations()[0]!
				// The site applied the SQL as is, without the control table; the runner records it.
				if (legacy) await db.query(docs.sql)
				else
					assert.deepEqual(
						(await migrate(db, [docs])).applied.map((migration) => migration.version),
						[1],
					)
				const ids = await db.query<{ id: string }>('INSERT INTO docs_snapshots (active) VALUES (false), (true) RETURNING id')
				for (const [index, { id }] of ids.rows.entries()) {
					await db.query('INSERT INTO docs_pages (snapshot_id, path, payload, searchable_text) VALUES ($1, $2, $3::jsonb, $4), ($1, $5, $6::jsonb, $7)', [
						id,
						'/docs',
						JSON.stringify({ sections: [] }),
						'Docs',
						'/docs/prueba',
						JSON.stringify({ doc: { title: `Versión ${index}`, html: '<p>señales</p>' } }),
						`Versión ${index} señales`,
					])
				}
				const before = (await db.query(snapshotRows)).rows

				const result = await migrate(db)
				assert.deepEqual(
					result.applied.map((migration) => migration.version),
					packageMigrations()
						.map((migration) => migration.version)
						.filter((version) => version >= (legacy ? 1 : 2)),
				)
				assert.deepEqual((await db.query(snapshotRows)).rows, before, 'every snapshot and page is kept as it was')
				assert.equal((await readPage<{ doc: { title: string } }>('/docs/prueba', db))?.doc.title, 'Versión 1')
				assert.equal((await searchPages('señales', 5, db))[0]?.url, '/docs/prueba')
				assert.deepEqual(
					(await listSnapshots(db)).map((snapshot) => [snapshot.active, snapshot.pages, snapshot.publishedBy]),
					[
						[true, 2, null],
						[false, 2, null],
					],
				)
				const active = Number(ids.rows[1]!.id)
				const published = await publishSnapshot([{ path: '/docs/prueba', payload: { doc: { title: 'Nueva', html: '' } } }], { db, expectActive: active, publishedBy: 'test' })
				assert.equal(await activeSnapshotId(db), published)
				assert.deepEqual((await migrate(db)).applied, [])
			} finally {
				await db.end()
				await admin.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`)
				await admin.end()
			}
		})
	}
})
