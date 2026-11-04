// A source whose Markdown file moves, in a temporary schema that the test drops. A source is keyed
// by site, language and path, so a new file is an update. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { Database } from '../src/db/pool'
import type { SourceEntry } from '../src/sources/discover'

import { migrate } from '../src/db/migrations'
import { createDatabase } from '../src/db/pool'
import { createRevision, listRevisions, publishedOverlay, publishRevision } from '../src/db/revisions'
import { importSources, listSources } from '../src/db/sources'
import { countTranslations, listTranslations } from '../src/db/translations'
import { contentHash } from '../src/sources/overlay'

const url = process.env.DATABASE_URL
const schema = `docs_test_${process.pid}_${randomBytes(4).toString('hex')}`

describe('a source whose file moved', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	let admin: Database
	let db: Database

	before(async () => {
		admin = createDatabase({ connectionString: url! })
		await admin.query(`CREATE SCHEMA ${schema}`)
		db = createDatabase({ connectionString: url!, searchPath: schema })
		await migrate(db)
	})

	after(async () => {
		await db?.end()
		await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin?.end()
	})

	const markdown = '# Guía\n\nTexto.\n'
	const entries = (file: string): SourceEntry[] => [
		{ site: 'site', path: '/docs/guia', kind: 'guide', title: 'Guía', file, markdown },
		{ site: 'site', locale: 'en', path: '/docs/guia', kind: 'guide', title: 'Guide', file: 'docs/en/guia.md', markdown: '# Guide\n\nText.\n', sourceHash: contentHash(markdown) },
	]

	test('keeps its identity, its revisions and the state of its translation', async () => {
		assert.deepEqual(await importSources(db, entries('packages/meeko/GUIA.md')), { inserted: 2, updated: 0, unchanged: 0, removed: 0, restored: 0 })
		const previous = await listSources(db)
		const original = previous.find((source) => source.locale === 'es')!
		const translation = previous.find((source) => source.locale === 'en')!
		const published = await createRevision(db, { sourceId: original.id, markdown: '# Guía\n\nPublicada.\n', author: 'test' })
		await publishRevision(db, published.id)
		const draft = await createRevision(db, { sourceId: original.id, markdown: '# Guía\n\nBorrador.\n', author: 'test' })
		assert.deepEqual([...(await publishedOverlay(db)).keys()], ['packages/meeko/GUIA.md'])

		assert.deepEqual(await importSources(db, entries('docs/guia.md')), { inserted: 0, updated: 1, unchanged: 1, removed: 0, restored: 0 })

		const moved = await listSources(db, { includeRemoved: true })
		assert.equal(moved.length, 2, 'no new source appears')
		const next = moved.find((source) => source.locale === 'es')!
		assert.equal(next.id, original.id)
		assert.equal(next.file, 'docs/guia.md')
		assert.equal(next.baseHash, original.baseHash)
		assert.equal(next.removedAt, null)
		assert.equal(next.publishedRevisionId, published.id)
		assert.equal(moved.find((source) => source.locale === 'en')?.id, translation.id)
		assert.equal(moved.find((source) => source.locale === 'en')?.sourceHash, translation.sourceHash)
		const revisions = await listRevisions(db, original.id)
		assert.deepEqual(
			revisions.map((revision) => revision.id).sort((a, b) => a - b),
			[published.id, draft.id],
		)
		assert.deepEqual([...(await publishedOverlay(db)).keys()], ['docs/guia.md'], 'the published text follows the file')
		assert.deepEqual(countTranslations(await listTranslations(db)), { translated: 1, outdated: 0, missing: 0, total: 1 })
	})
})
