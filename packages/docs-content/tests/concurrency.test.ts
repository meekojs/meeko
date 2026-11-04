// Concurrency of revisions and publications with real PostgreSQL connections: two sessions, and
// explicit barriers that wait until one of them is blocked by the other (pg_blocking_pids). Every
// table lives in a temporary schema that the test drops. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { Database } from '../src/db/pool'

import { readGitFile } from '../src/content/repository'
import { migrate } from '../src/db/migrations'
import { contentLockKey, createDatabase, lockKeys } from '../src/db/pool'
import { archiveRevision, createRevision, getRevision, publishedOverlay, publishRevision, RevisionError, updateDraft } from '../src/db/revisions'
import { listSnapshots } from '../src/db/snapshots'
import { getSource, importSources } from '../src/db/sources'
import { publishDocumentation, withContentLock } from '../src/publish'

const url = process.env.DATABASE_URL
const schema = `docs_test_${process.pid}_${randomBytes(4).toString('hex')}`

const code = (expected: string) => (error: unknown) => error instanceof RevisionError && error.code === expected

describe('concurrent revisions and publications', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	let admin: Database
	let db: Database
	/** A second pool: its client is the other session of each race. */
	let other: Database

	/** Resolves when some session is blocked by the backend `pid`, the barrier of every race here. */
	async function blockedBy(pid: number): Promise<void> {
		const deadline = Date.now() + 15_000
		while (Date.now() < deadline) {
			const found = await admin.query<{ count: string }>('SELECT count(*) AS count FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])
			if (Number(found.rows[0]!.count) > 0) return
			await new Promise((done) => setTimeout(done, 20))
		}
		throw new Error(`No session waited for backend ${pid}`)
	}

	/** The backend that `pid` blocks: the call in the middle of each race. */
	async function waiterOf(pid: number): Promise<number> {
		await blockedBy(pid)
		const found = await admin.query<{ pid: number }>('SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))', [pid])
		return Number(found.rows[0]!.pid)
	}

	/** A session of `other` with an open transaction, and its backend. */
	async function session() {
		const client = await other.connect()
		await client.query('BEGIN')
		const pid = Number((await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid)
		return {
			client,
			pid,
			async end(action: 'COMMIT' | 'ROLLBACK') {
				try {
					await client.query(action)
				} finally {
					client.release()
				}
			},
		}
	}

	const signal = readGitFile('docs/reference/reactivity/signal.md')
	const withoutSince = signal.replace(/^since:.*\n/m, '')

	before(async () => {
		admin = createDatabase({ connectionString: url! })
		await admin.query(`CREATE SCHEMA ${schema}`)
		db = createDatabase({ connectionString: url!, searchPath: schema })
		other = createDatabase({ connectionString: url!, searchPath: schema })
		await migrate(db)
		await importSources(
			db,
			[
				{ site: 'site', path: '/docs/doctor', kind: 'guide', title: 'Doctor', file: 'docs/doctor.md', markdown: readGitFile('docs/doctor.md') },
				{ site: 'site', path: '/docs/reference/signal', kind: 'reference', title: 'signal', file: 'docs/reference/reactivity/signal.md', markdown: signal },
			],
			['site'],
		)
	})

	after(async () => {
		await other?.end()
		await db?.end()
		await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin?.end()
	})

	test('a publication checks the Markdown it publishes, even when a save commits in the middle', async () => {
		assert.notEqual(withoutSince, signal, 'the fixture has a since to remove')
		const reference = (await getSource(db, { site: 'site', path: '/docs/reference/signal' }))!
		const valid = await createRevision(db, { sourceId: reference.id, markdown: signal, author: 'ana' })
		await publishRevision(db, valid.id)

		// The interleaving of the review: the publication is past its first read when a save without
		// `since` commits. Here the other session holds the source, so the publication waits there;
		// the real updateDraft takes only the revision and commits meanwhile.
		const draft = await createRevision(db, { sourceId: reference.id, markdown: signal, author: 'luis' })
		const holder = await session()
		await holder.client.query('SELECT id FROM docs_sources WHERE id = $1 FOR UPDATE', [reference.id])
		const publishing = publishRevision(db, draft.id).then(
			() => null,
			(error: unknown) => error,
		)
		await blockedBy(holder.pid)
		await updateDraft(db, draft.id, { markdown: withoutSince, author: 'luis' })
		await holder.end('COMMIT')
		const refused = await publishing
		assert.ok(code('rejected')(refused), `the text saved meanwhile is the one checked: ${String(refused)}`)
		assert.match((refused as RevisionError).reason ?? '', /needs since/)
		assert.equal((await getRevision(db, draft.id))?.status, 'draft')
		assert.equal((await getRevision(db, valid.id))?.status, 'published', 'the valid revision stays published')

		// A save in flight holds the revision: the publication waits for it and checks what it saved.
		const fixed = await updateDraft(db, draft.id, { markdown: signal, author: 'luis' })
		const saving = await session()
		await saving.client.query('SELECT id FROM docs_revisions WHERE id = $1 FOR UPDATE', [fixed.id])
		await saving.client.query('UPDATE docs_revisions SET markdown = $2 WHERE id = $1', [fixed.id, withoutSince])
		const second = publishRevision(db, fixed.id).then(
			() => null,
			(error: unknown) => error,
		)
		await blockedBy(saving.pid)
		await saving.end('COMMIT')
		assert.ok(code('rejected')(await second))
		assert.equal((await getRevision(db, valid.id))?.status, 'published')

		// A save that commits after the publication: it is no longer a draft and is refused.
		await updateDraft(db, fixed.id, { markdown: signal, author: 'luis' })
		await publishRevision(db, fixed.id)
		await assert.rejects(updateDraft(db, fixed.id, { markdown: withoutSince, author: 'luis' }), code('not-draft'))
		assert.equal((await getRevision(db, fixed.id))?.markdown, signal)
		await archiveRevision(db, fixed.id)
		await archiveRevision(db, draft.id)
	})

	test('an archived revision can be published again: it restores its text with a new date', async () => {
		const guide = (await getSource(db, { site: 'site', path: '/docs/doctor' }))!
		const first = await createRevision(db, { sourceId: guide.id, markdown: '# Doctor\n\nPrimera.\n', author: 'ana' })
		const firstPublished = await publishRevision(db, first.id)
		const second = await createRevision(db, { sourceId: guide.id, markdown: '# Doctor\n\nSegunda.\n', author: 'ana' })
		await publishRevision(db, second.id)
		assert.equal((await getRevision(db, first.id))?.status, 'archived')
		const restored = await publishRevision(db, first.id)
		assert.equal(restored.status, 'published')
		assert.ok(restored.publishedAt! > firstPublished.publishedAt!, 'a new publication date: pending until the next snapshot')
		assert.equal((await getRevision(db, second.id))?.status, 'archived')
		assert.equal((await publishRevision(db, first.id)).publishedAt?.getTime(), restored.publishedAt?.getTime(), 'publishing the published one keeps its date')
		await archiveRevision(db, first.id)
	})

	test('while a render holds the content lock, revisions that change the site are refused', async () => {
		const guide = (await getSource(db, { site: 'site', path: '/docs/doctor' }))!
		const published = await createRevision(db, { sourceId: guide.id, markdown: '# Doctor\n\nPublicada.\n', author: 'ana' })
		await publishRevision(db, published.id)
		const draft = await createRevision(db, { sourceId: guide.id, markdown: '# Doctor\n\nBorrador.\n', author: 'ana' })

		// Another process renders: it holds the exclusive side for its whole run.
		const render = await other.connect()
		try {
			await render.query(`SELECT pg_advisory_lock($1, ${contentLockKey})`, [lockKeys.content])
			await assert.rejects(publishRevision(db, draft.id), code('busy'))
			await assert.rejects(archiveRevision(db, published.id), code('busy'))
			assert.equal((await getRevision(db, published.id))?.status, 'published', 'nothing changed')
			assert.equal((await getRevision(db, draft.id))?.status, 'draft')
			// Saving a draft does not change what the site renders.
			await updateDraft(db, draft.id, { markdown: '# Doctor\n\nBorrador dos.\n', author: 'ana' })
		} finally {
			await render.query(`SELECT pg_advisory_unlock($1, ${contentLockKey})`, [lockKeys.content])
			render.release()
		}
		// A render in another schema (another test, another environment of the same database) holds
		// its own lock: advisory locks belong to the whole database, so the key is the schema.
		const elsewhere = await admin.connect()
		try {
			await elsewhere.query('SELECT pg_advisory_lock($1, hashtext($2))', [lockKeys.content, `${schema}_otro`])
			await publishRevision(db, draft.id)
		} finally {
			await elsewhere.query('SELECT pg_advisory_unlock($1, hashtext($2))', [lockKeys.content, `${schema}_otro`])
			elsewhere.release()
		}
		assert.equal((await getRevision(db, published.id))?.status, 'archived')
		await archiveRevision(db, draft.id)
	})

	test('a render that starts while a revision is being published waits for it and includes it', async () => {
		const guide = (await getSource(db, { site: 'site', path: '/docs/doctor' }))!
		const old = await createRevision(db, { sourceId: guide.id, markdown: '# Doctor\n\nAnterior.\n', author: 'ana' })
		await publishRevision(db, old.id)
		const next = await createRevision(db, { sourceId: guide.id, markdown: '# Doctor\n\nIncluida en el snapshot.\n', author: 'ana' })

		// The publication of `next` holds the content lock (shared) and waits to archive `old`,
		// which the other session holds: it is in the middle of its transaction.
		const holder = await session()
		await holder.client.query('SELECT id FROM docs_revisions WHERE id = $1 FOR UPDATE', [old.id])
		const publishing = publishRevision(db, next.id)
		const publisher = await waiterOf(holder.pid)

		// A render starts now: it waits for the content lock before reading anything.
		let read = false
		const rendering = withContentLock(db, async () => {
			read = true
			return [...(await publishedOverlay(db)).entries()]
		})
		await blockedBy(publisher)
		assert.equal(read, false, 'the render did not read the revisions while the publication was open')
		await holder.end('COMMIT')
		await publishing
		assert.deepEqual(await rendering, [['docs/doctor.md', '# Doctor\n\nIncluida en el snapshot.\n']])

		// The real publication of the documentation takes the same lock: a revision being published
		// keeps it waiting, and the snapshot has that revision and is later than its date.
		const last = await createRevision(db, { sourceId: guide.id, markdown: '# Doctor\n\nÚltima.\n', author: 'ana' })
		const second = await session()
		await second.client.query('SELECT id FROM docs_revisions WHERE id = $1 FOR UPDATE', [next.id])
		const publishingLast = publishRevision(db, last.id)
		const waiting = await waiterOf(second.pid)
		const documentation = publishDocumentation(db, { publishedBy: 'test' })
		await blockedBy(waiting)
		await second.end('COMMIT')
		const lastPublished = await publishingLast
		const published = await documentation
		assert.deepEqual(published.revisions, ['docs/doctor.md'])
		const snapshot = (await listSnapshots(db)).find((item) => item.id === published.snapshotId)!
		assert.ok(lastPublished.publishedAt! < snapshot.publishedAt, 'included revisions are older than their snapshot')

		// After the render, a publication has a later date: pending for the next snapshot.
		await archiveRevision(db, last.id)
		const later = await publishRevision(db, last.id)
		assert.ok(later.publishedAt! > snapshot.publishedAt)
		await archiveRevision(db, last.id)
	})
})
