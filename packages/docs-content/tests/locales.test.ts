// The languages of the documentation: the helpers, the render in English with its fallback and,
// with DATABASE_URL, migration 006 over existing data and every table by language, in temporary
// schemas that the tests drop at the end.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'

import type { Database } from '../src/db/pool'
import type { SourceEntry } from '../src/sources/discover'

import { catalogEntry } from '../src/content/catalog'
import { originalFile, readTranslation, stampTranslation, translationFile } from '../src/content/i18n'
import { renderSource } from '../src/content/markdown'
import { gitFileExists, pageLocale, readGitFile, withSourceOverlay } from '../src/content/repository'
import { listFeedbackComments, readMetricsSummary } from '../src/db/metrics'
import { migrate, packageMigrations } from '../src/db/migrations'
import { createAnnouncement, listAnnouncements, listModerationRules, saveModerationRule, updateAnnouncement } from '../src/db/moderation'
import { createDatabase } from '../src/db/pool'
import { createRevision, publishRevision } from '../src/db/revisions'
import { activateSnapshot, listPages, listSnapshots, publishSnapshot, readPage, searchPages } from '../src/db/snapshots'
import { getSource, importSources, listSources } from '../src/db/sources'
import { countTranslations, listTranslations, translationDetail } from '../src/db/translations'
import { localizedPath, splitLocalePath, translationStatus } from '../src/locale'
import { createMetricsWriter } from '../src/metrics/write'
import { createModerationReader } from '../src/moderation/read'
import { moderationEndpoint } from '../src/moderation/shared'
import { buildSnapshotPages, localizePayload } from '../src/snapshot'
import { contentHash, createOverlay } from '../src/sources/overlay'

test('URLs of a language: Spanish without prefix, English under /en', () => {
	assert.equal(localizedPath('/docs/api#x', 'en'), '/en/docs/api#x')
	assert.equal(localizedPath('/', 'en'), '/en')
	assert.equal(localizedPath('/?q=1', 'en'), '/en?q=1')
	assert.equal(localizedPath('/docs/api', 'es'), '/docs/api')
	assert.deepEqual(splitLocalePath('/en/docs/api?x'), { locale: 'en', path: '/docs/api?x' })
	assert.deepEqual(splitLocalePath('/en'), { locale: 'en', path: '/' })
	assert.deepEqual(splitLocalePath('/en#top'), { locale: 'en', path: '/#top' })
	assert.deepEqual(splitLocalePath('/english/docs'), { locale: 'es', path: '/english/docs' })
	assert.equal(moderationEndpoint('site'), '/_meeko-docs/moderation/site')
	assert.equal(moderationEndpoint('ui', 'en'), '/_meeko-docs/moderation/ui/en')
})

test('a translation lives in docs/en and declares the hash of its original', () => {
	assert.equal(translationFile('docs/api.md', 'en'), 'docs/en/api.md')
	assert.equal(translationFile('docs/reference/reactivity/signal.md', 'en'), 'docs/en/reference/reactivity/signal.md')
	assert.equal(translationFile('docs/inicio-rapido.md', 'en'), 'docs/en/inicio-rapido.md')
	assert.equal(translationFile('packages/meeko/CHANGELOG.md', 'en'), 'docs/en/changelog.md')
	assert.equal(translationFile('packages/meeko/README.md', 'en'), null)
	assert.equal(translationFile('docs/api.md', 'es'), null)
	assert.equal(translationFile('docs/en/api.md', 'en'), null)
	assert.equal(originalFile('docs/en/inicio-rapido.md'), 'docs/inicio-rapido.md')
	assert.equal(originalFile('docs/en/changelog.md'), 'packages/meeko/CHANGELOG.md')
	assert.equal(originalFile('docs/en/reference/utils/x.md'), 'docs/reference/utils/x.md')
	assert.equal(originalFile('docs/api.md'), null)

	const hash = 'a'.repeat(64)
	const guide = stampTranslation('# Title\n\nText.\n', hash)
	assert.equal(guide, `---\nsource-hash: ${hash}\n---\n\n# Title\n\nText.\n`)
	assert.deepEqual(readTranslation(guide), { text: '# Title\n\nText.\n', sourceHash: hash }, 'a guide loses the frontmatter that only held the hash')
	const reference = stampTranslation('---\ntitle: signal\nsince: 1.0.0\n---\nBody\n', hash)
	assert.equal(reference, `---\ntitle: signal\nsince: 1.0.0\nsource-hash: ${hash}\n---\nBody\n`)
	assert.deepEqual(readTranslation(reference), { text: '---\ntitle: signal\nsince: 1.0.0\n---\nBody\n', sourceHash: hash })
	assert.equal(stampTranslation(reference, 'b'.repeat(64)), reference.replace(hash, 'b'.repeat(64)), 'stamping again replaces the hash')
	assert.deepEqual(readTranslation('---\nsource-hash: nope\n---\n# T\n'), { text: '# T\n', sourceHash: null })
	assert.equal(translationStatus(null, hash), 'missing')
	assert.equal(translationStatus({ sourceHash: hash }, hash), 'translated')
	assert.equal(translationStatus({ sourceHash: hash }, 'b'.repeat(64)), 'outdated')
	assert.equal(translationStatus({ sourceHash: null }, hash), 'outdated')
})

test('the links of a payload get the prefix of its language; other links do not', () => {
	const payload = {
		current: '/docs/api',
		home: '/',
		llms: '/llms.txt',
		html: '<a href="/docs/x#y">x</a> <a href="https://github.com/meekojs/meeko">gh</a> <a href="#local">l</a> <a href="/">home</a> <a href="/docsx">no</a>',
		file: 'docs/api.md',
		nested: [{ href: '/docs/reference/signal' }],
	}
	assert.equal(localizePayload(payload, 'es'), payload)
	assert.deepEqual(localizePayload(payload, 'en'), {
		current: '/en/docs/api',
		home: '/en',
		llms: '/en/llms.txt',
		html: '<a href="/en/docs/x#y">x</a> <a href="https://github.com/meekojs/meeko">gh</a> <a href="#local">l</a> <a href="/en">home</a> <a href="/docsx">no</a>',
		file: 'docs/api.md',
		nested: [{ href: '/en/docs/reference/signal' }],
	})
})

const doctor = 'docs/doctor.md'
const doctorHash = contentHash(readGitFile(doctor))
const doctorEn = `---\nsource-hash: ${doctorHash}\n---\n\n# Doctor in English\n\nIt checks the [API](./api.md) and the [framework](../framework.md#señales).\n\n## What it checks\n`

test('the title of the quick start follows the language of the render', async () => {
	const readme = '# Meeko\n\n<p align="center">\n\t<img src="logo.png" alt="Meeko">\n</p>\n\nBody.\n'
	const transform = catalogEntry('inicio-rapido')?.transform
	assert.ok(transform)
	const english = await withSourceOverlay(createOverlay([]), async () => transform(readme), 'en')
	assert.equal(english, '# Quick start\n\nBody.\n')
	const spanish = await withSourceOverlay(createOverlay([]), async () => transform(readme), 'es')
	assert.equal(spanish, '# Inicio rápido\n\nBody.\n')
})

test('in English a guide is read from its translation, and falls back to Spanish without one', async () => {
	const overlay = createOverlay([{ file: 'docs/en/doctor.md', markdown: doctorEn }])
	const english = await withSourceOverlay(overlay, async () => ({ doc: await renderSource(doctor), locale: pageLocale(doctor), generated: pageLocale(null) }), 'en')
	assert.equal(english.doc.title, 'Doctor in English')
	assert.equal(english.doc.editUrl, 'https://github.com/meekojs/meeko/edit/main/docs/en/doctor.md')
	assert.match(english.doc.html, /href="\/docs\/api"/, 'a relative link of the translation goes to the page of its original')
	assert.deepEqual(english.locale, { locale: 'en', status: 'translated', fallback: false })
	assert.deepEqual(english.generated, { locale: 'en', status: 'missing', fallback: true }, 'a page generated from the JSDoc is Spanish in English')
	const stale = createOverlay([{ file: 'docs/en/doctor.md', markdown: doctorEn.replace(doctorHash, 'f'.repeat(64)) }])
	assert.equal(await withSourceOverlay(stale, async () => pageLocale(doctor).status, 'en'), 'outdated')
	assert.deepEqual(await withSourceOverlay(overlay, async () => pageLocale(doctor)), { locale: 'es', status: null, fallback: false }, 'Spanish never reads a translation')
	if (!gitFileExists('docs/en/changelog.md')) {
		const changelog = await withSourceOverlay(createOverlay([]), async () => ({ doc: await renderSource('CHANGELOG.md'), locale: pageLocale('CHANGELOG.md') }), 'en')
		assert.deepEqual(changelog.locale, { locale: 'en', status: 'missing', fallback: true })
		assert.equal(changelog.doc.title, (await renderSource('CHANGELOG.md')).title, 'the fallback is the Spanish page')
	}
})

test('the English render prefixes its links, marks each page and keeps Spanish as it was', async () => {
	const signalEs = readGitFile('docs/reference/reactivity/signal.md')
	const titles: Record<string, string> = { Uso: 'Usage', Parámetros: 'Parameters', 'Valor devuelto': 'Return value', Ejemplos: 'Examples', 'Errores comunes': 'Common mistakes', Notas: 'Notes' }
	const signalEn = stampTranslation(
		signalEs.replace(/^## (.+)$/gm, (line, title: string) => (titles[title] ? `## ${titles[title]}` : line)),
		contentHash(signalEs),
	)
	const overlay = createOverlay([
		{ file: 'docs/en/doctor.md', markdown: doctorEn },
		{ file: 'docs/en/reference/reactivity/signal.md', markdown: signalEn },
	])
	const pages = await buildSnapshotPages({ overlay, locales: ['en'] })
	assert.ok(pages.every((page) => page.locale === 'en'))
	const at = <T>(path: string) => pages.find((page) => page.path === path) as { payload: T; translation: string | null }
	const guide = at<{ doc: { title: string; html: string }; current: string; nav: { links: { href: string }[] }[]; i18n: unknown }>('/docs/doctor')
	assert.equal(guide.translation, 'translated')
	assert.equal(guide.payload.doc.title, 'Doctor in English')
	assert.equal(guide.payload.current, '/en/docs/doctor')
	assert.match(guide.payload.doc.html, /href="\/en\/docs\/api"/)
	assert.ok(guide.payload.nav.flatMap((section) => section.links).every((link) => link.href.startsWith('/en/')))
	assert.deepEqual(guide.payload.i18n, { locale: 'en', status: 'translated', fallback: false })
	const reference = at<{ written: { body: string; editPath: string } }>('/docs/reference/signal')
	assert.equal(reference.translation, 'translated')
	assert.match(reference.payload.written.body, /<h2 id="type">/, 'the generated «Type» follows «Usage»')
	assert.match(reference.payload.written.body, /<h2 id="related">/)
	assert.match(reference.payload.written.body, /class="type-block"/)
	assert.equal(reference.payload.written.editPath, 'docs/en/reference/reactivity/signal.md')
	const home = at<{ head: { title: string }; i18n: unknown }>('/')
	assert.equal(home.translation, null)
	assert.match(home.payload.head.title, /Typed \.meeko components/)
	assert.match(at<{ text: string }>('/llms.txt').payload.text, /\(https:\/\/meekojs\.com\/en\/docs\/doctor\)/)
	const fallbacks = pages.filter((page) => page.translation === 'missing')
	assert.ok(fallbacks.length > 0)
	for (const page of fallbacks) assert.deepEqual((page.payload as { i18n: unknown }).i18n, { locale: 'en', status: 'missing', fallback: true }, page.path)
	assert.ok(!pages.some((page) => /href=\\?"\/docs/.test(JSON.stringify(page.payload))), 'no internal link is left without the prefix')
})

const url = process.env.DATABASE_URL

describe('languages in the database', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	const schemas: string[] = []
	let admin: Database
	const databases: Database[] = []

	const schemaDb = async (): Promise<Database> => {
		const schema = `docs_test_${process.pid}_${randomBytes(4).toString('hex')}`
		await admin.query(`CREATE SCHEMA ${schema}`)
		schemas.push(schema)
		const db = createDatabase({ connectionString: url!, searchPath: schema })
		databases.push(db)
		return db
	}

	before(() => {
		admin = createDatabase({ connectionString: url! })
	})

	after(async () => {
		for (const db of databases) await db.end()
		for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin?.end()
	})

	test('006 keeps every existing row, in Spanish, and lets English share the paths', async () => {
		const db = await schemaDb()
		await migrate(
			db,
			packageMigrations().filter((migration) => migration.version <= 5),
		)
		const hash = contentHash('# Doctor\n')
		await db.query(`INSERT INTO docs_sources (site, path, kind, title, source_file, base_markdown, base_hash) VALUES ('site', '/docs/doctor', 'guide', 'Doctor', 'docs/doctor.md', '# Doctor\n', $1), ('ui', '/installation', 'page', 'Instalación', NULL, NULL, NULL)`, [hash])
		await db.query(`INSERT INTO docs_revisions (source_id, markdown, author) SELECT id, '# Doctor editado\n', 'ana' FROM docs_sources WHERE path = '/docs/doctor'`)
		await db.query(`INSERT INTO docs_snapshots (active) VALUES (true)`)
		await db.query(`INSERT INTO docs_pages (snapshot_id, path, payload, searchable_text) SELECT id, '/docs/doctor', '{"doc":{"title":"Doctor"}}', 'señales del doctor' FROM docs_snapshots`)
		await db.query(`INSERT INTO docs_moderation (site, path, action, author) VALUES ('site', '/docs/doctor', 'feature', 'ana')`)
		await db.query(`INSERT INTO docs_announcements (site, message, author) VALUES ('site', 'Aviso', 'ana')`)
		await db.query(`INSERT INTO docs_feedback (site, path, helpful) VALUES ('site', '/docs/doctor', true)`)
		await db.query(`INSERT INTO docs_page_views (site, path, day, views) VALUES ('site', '/docs/doctor', '2026-10-01', 3)`)
		await db.query(`INSERT INTO docs_searches (site, query, results) VALUES ('site', 'doctor', 1)`)
		const tables = ['docs_sources', 'docs_revisions', 'docs_snapshots', 'docs_pages', 'docs_moderation', 'docs_announcements', 'docs_feedback', 'docs_page_views', 'docs_searches']
		const count = async (): Promise<number[]> => Promise.all(tables.map(async (table) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`)).rows[0]!.n)))
		const before = await count()

		assert.deepEqual(
			(await migrate(db)).applied.map((migration) => migration.version),
			[6],
		)
		assert.deepEqual(await count(), before, 'no row is lost')
		for (const table of tables.filter((name) => !['docs_revisions', 'docs_snapshots'].includes(name))) {
			const locales = await db.query<{ locale: string }>(`SELECT DISTINCT locale FROM ${table}`)
			assert.deepEqual(
				locales.rows.map((row) => row.locale),
				['es'],
				table,
			)
		}
		// The old readers still find the Spanish page; English can now have the same path.
		assert.deepEqual(await readPage<{ doc: { title: string } }>('/docs/doctor', db), { doc: { title: 'Doctor' } })
		await db.query(`INSERT INTO docs_sources (site, locale, path, kind, title, source_file, base_markdown, base_hash, source_hash) VALUES ('site', 'en', '/docs/doctor', 'guide', 'Doctor', 'docs/en/doctor.md', '# Doctor\n', $1, $1)`, [hash])
		await assert.rejects(db.query(`INSERT INTO docs_sources (site, locale, path, kind, title) VALUES ('ui', 'en', '/installation', 'page', 'Installation')`), /docs_sources_translation/, 'only the Markdown of the site is translated')
		await assert.rejects(db.query(`UPDATE docs_sources SET source_hash = $1 WHERE locale = 'es' AND path = '/docs/doctor'`, [hash]), /docs_sources_source_hash/)
		await db.query(`INSERT INTO docs_page_views (site, locale, path, day, views) VALUES ('site', 'en', '/docs/doctor', '2026-10-01', 1)`)
		await db.query(`INSERT INTO docs_moderation (site, locale, path, action, author) VALUES ('site', NULL, '/docs/doctor', 'hide', 'ana')`)
		await assert.rejects(db.query(`INSERT INTO docs_moderation (site, locale, path, action, author) VALUES ('site', NULL, '/docs/doctor', 'hide', 'ana')`), /docs_moderation_site_locale_path/, 'one global rule per page')
		await assert.rejects(db.query(`INSERT INTO docs_pages (snapshot_id, locale, path, payload, searchable_text, translation) SELECT id, 'es', '/docs', '{}', '', 'missing' FROM docs_snapshots`), /docs_pages_translation/)
	})

	describe('one schema with every migration', () => {
		let db: Database
		before(async () => {
			db = await schemaDb()
			await migrate(db)
		})

		const original = (path: string, file: string, markdown: string): SourceEntry => ({ site: 'site', path, kind: 'guide', title: path, file, markdown })
		const english = (entry: SourceEntry, markdown: string, sourceHash: string | null): SourceEntry => ({ ...entry, locale: 'en', file: translationFile(entry.file!, 'en'), markdown, sourceHash })

		test('sources are imported in both languages and each translation has its status', async () => {
			const git = readGitFile(doctor)
			// The import of Spanish has a section that Git does not have yet: the translation was made from Git.
			const doctorEs = original('/docs/doctor', doctor, `${git}\n## Sección nueva\n\nTexto nuevo.\n`)
			const apiEs = original('/docs/api', 'docs/api.md', '# API\n')
			const toolingEs = original('/docs/tooling', 'docs/tooling.md', '# Tooling\n')
			const page: SourceEntry = { site: 'ui', path: '/installation', kind: 'page', title: 'Instalación', file: null, markdown: null }
			const entries = [doctorEs, apiEs, toolingEs, page, english(doctorEs, doctorEn, doctorHash), english(apiEs, `---\nsource-hash: ${contentHash('# API\n')}\n---\n\n# API\n`, contentHash('# API\n'))]
			assert.deepEqual(await importSources(db, entries, ['site', 'ui']), { inserted: 6, updated: 0, unchanged: 0, removed: 0, restored: 0 })
			assert.deepEqual(await importSources(db, entries, ['site', 'ui']), { inserted: 0, updated: 0, unchanged: 6, removed: 0, restored: 0 })
			await assert.rejects(importSources(db, [{ ...page, locale: 'en' }], ['ui']), /only the guides and reference pages of the site are translated/)
			await assert.rejects(importSources(db, [{ ...apiEs, sourceHash: doctorHash }], ['site']), /only a translation has a source hash/)

			const en = (await getSource(db, { site: 'site', path: '/docs/doctor', locale: 'en' }))!
			assert.deepEqual([en.locale, en.file, en.sourceHash], ['en', 'docs/en/doctor.md', doctorHash])
			assert.equal((await getSource(db, { site: 'site', path: '/docs/doctor' }))?.locale, 'es', 'Spanish by default')
			assert.equal((await listSources(db, { locale: 'en' })).length, 2)
			assert.equal((await listSources(db)).length, 6)

			const translations = await listTranslations(db)
			assert.deepEqual(
				translations.map((entry) => [entry.original.path, entry.status, entry.file]),
				[
					['/docs/api', 'translated', 'docs/en/api.md'],
					['/docs/doctor', 'outdated', 'docs/en/doctor.md'],
					['/docs/tooling', 'missing', 'docs/en/tooling.md'],
				],
			)
			assert.deepEqual(countTranslations(translations), { translated: 1, outdated: 1, missing: 1, total: 3 })
			assert.deepEqual(
				(await listTranslations(db, { status: 'missing' })).map((entry) => entry.original.path),
				['/docs/tooling'],
			)

			const detail = (await translationDetail(db, en.id))!
			assert.equal(detail.status, 'outdated')
			assert.equal(detail.translatedFrom?.origin.kind, 'working-tree', 'the Spanish text it was translated from is found')
			assert.match(detail.originalChanges, /^\+## Sección nueva$/m, 'the diff shows what the translation must take in')
			assert.equal(detail.translationMarkdown, doctorEn)
			assert.equal((await translationDetail(db, { path: '/docs/tooling' }))?.status, 'missing')
			assert.equal((await translationDetail(db, { path: '/docs/api' }))?.originalChanges, '')

			// A published revision of the translation is what the site shows, and its hash decides the status.
			const revision = await createRevision(db, { sourceId: en.id, markdown: doctorEn.replace(doctorHash, contentHash(doctorEs.markdown!)), author: 'ana' })
			await publishRevision(db, revision.id)
			assert.equal((await translationDetail(db, en.id))?.status, 'translated')
			assert.equal((await listTranslations(db)).find((entry) => entry.original.path === '/docs/doctor')?.status, 'translated')

			// A published revision that lost its hash, or has an invalid one, is `outdated` everywhere, even
			// when the imported file says `translated`: the list, its filter and counts, the detail and the render.
			const apiEn = (await getSource(db, { site: 'site', path: '/docs/api', locale: 'en' }))!
			const apiHash = contentHash('# API\n')
			assert.equal(apiEn.sourceHash, apiHash)
			const publishApi = async (markdown: string) => {
				await publishRevision(db, (await createRevision(db, { sourceId: apiEn.id, markdown, author: 'ana' })).id)
				const entries = await listTranslations(db)
				return { entry: entries.find((entry) => entry.original.path === '/docs/api')!, entries, detail: (await translationDetail(db, apiEn.id))! }
			}
			for (const markdown of ['# API\n', '---\nsource-hash: not-a-hash\n---\n\n# API\n']) {
				const { entry, entries, detail } = await publishApi(markdown)
				assert.deepEqual([entry.status, entry.sourceHash], ['outdated', null], markdown)
				assert.deepEqual([detail.status, detail.sourceHash], ['outdated', null], markdown)
				assert.deepEqual(countTranslations(entries), { translated: 1, outdated: 1, missing: 1, total: 3 }, markdown)
				assert.ok(!(await listTranslations(db, { status: 'translated' })).some((candidate) => candidate.original.path === '/docs/api'), markdown)
				assert.ok(
					(await listTranslations(db, { status: 'outdated' })).some((candidate) => candidate.original.path === '/docs/api'),
					markdown,
				)
			}
			// A valid hash in the revision makes it `translated` again.
			const stamped = await publishApi(`---\nsource-hash: ${apiHash}\n---\n\n# API\n`)
			assert.deepEqual([stamped.entry.status, stamped.entry.sourceHash, stamped.detail.status], ['translated', apiHash, 'translated'])

			// Deleting the translation from Git marks it removed: the page is missing again.
			assert.equal((await importSources(db, entries.slice(0, 5), ['site', 'ui'])).removed, 1)
			assert.equal((await listTranslations(db)).find((entry) => entry.original.path === '/docs/api')?.status, 'missing')
		})

		test('a snapshot holds both languages; reads and search go by language', async () => {
			const fallback = { locale: 'en', status: 'missing', fallback: true }
			const id = await publishSnapshot(
				[
					{ path: '/docs', payload: { sections: [] } },
					{ path: '/docs/signal', payload: { doc: { title: 'Señales', html: '<p>Las señales guardan estado reactivo.</p>' }, toc: [{ id: 'señal-derivada', text: 'Señal derivada' }] } },
					{ path: '/docs', locale: 'en', payload: { sections: [] } },
					{ path: '/docs/signal', locale: 'en', translation: 'translated', payload: { doc: { title: 'Signals', html: '<p>Signals hold reactive state and notify their readers.</p>' }, toc: [] } },
					{ path: '/docs/doctor', locale: 'en', translation: 'missing', payload: { doc: { title: 'Doctor', html: '<p>El doctor revisa el entorno.</p>' }, i18n: fallback } },
				],
				{ db },
			)
			await assert.rejects(publishSnapshot([{ path: '/docs', payload: {}, translation: 'missing' }], { db }), /Invalid translation status/)
			// jsonb cannot hold a NUL: one that slipped into a translation does not stop the publication.
			const nul = await publishSnapshot([{ path: '/docs', payload: { doc: { title: 'a\0b' } } }], { db, keep: 10 })
			assert.deepEqual(await db.query('SELECT payload FROM docs_pages WHERE snapshot_id = $1', [nul]).then((result) => result.rows[0]), { payload: { doc: { title: 'a�b' } } })
			await activateSnapshot(id, db)
			await assert.rejects(
				publishSnapshot(
					[
						{ path: '/docs', locale: 'en', payload: {} },
						{ path: '/docs', locale: 'en', payload: {} },
					],
					{ db },
				),
				/Duplicate documentation URL path: en \/docs/,
			)
			assert.deepEqual((await listSnapshots(db)).find((snapshot) => snapshot.id === id)?.pagesByLocale, { es: 2, en: 3 })
			assert.equal((await readPage<{ doc: { title: string } }>('/docs/signal', db))?.doc.title, 'Señales')
			assert.equal((await readPage<{ doc: { title: string } }>('/docs/signal', { db, locale: 'en' }))?.doc.title, 'Signals')
			assert.equal(await readPage('/docs/doctor', db), null, 'Spanish has no such page')
			assert.deepEqual((await readPage<{ i18n: unknown }>('/docs/doctor', { db, locale: 'en' }))?.i18n, fallback)
			assert.deepEqual(
				(await listPages({ db, locale: 'en' })).map((page) => page.path),
				['/docs', '/docs/doctor', '/docs/signal'],
			)

			// Stemming of each language: «señal» finds «señales», «signal» finds «signals».
			assert.deepEqual(
				(await searchPages('señal', 5, db)).map((result) => result.url),
				['/docs/signal'],
			)
			const [found] = await searchPages('señal', 5, { db })
			assert.deepEqual(found?.sections, [{ url: '/docs/signal#se%C3%B1al-derivada', title: 'Señal derivada', excerpt: 'Señal derivada' }], 'sections still match the literal text')
			const english = await searchPages('signal', 5, { db, locale: 'en' })
			assert.deepEqual(
				english.map((result) => [result.url, result.title]),
				[['/en/docs/signal', 'Signals']],
			)
			assert.deepEqual(
				(await searchPages('notifying', 5, { db, locale: 'en' })).map((result) => result.url),
				['/en/docs/signal'],
			)
			assert.deepEqual(
				(await searchPages('entorno', 5, { db, locale: 'en' })).map((result) => result.url),
				['/en/docs/doctor'],
				'a fallback page is searched with its Spanish text too',
			)
			assert.deepEqual(await searchPages('signals', 5, db), [], 'English is not searched in Spanish')
		})

		test('moderation and announcements apply to their language or to every one', async () => {
			await saveModerationRule(db, { site: 'site', path: '/docs/signal', action: 'hide', author: 'ana' })
			await saveModerationRule(db, { site: 'site', locale: 'en', path: '/docs/doctor', action: 'hide', author: 'ana' })
			await saveModerationRule(db, { site: 'site', locale: null, path: '/docs', action: 'feature', author: 'ana' })
			// A rule of the language wins over the global one of the same page.
			await saveModerationRule(db, { site: 'site', locale: null, path: '/docs/doctor', action: 'feature', author: 'ana' })
			const rules = await listModerationRules(db, 'site')
			assert.deepEqual(
				rules.map((rule) => [rule.path, rule.locale, rule.action]),
				[
					['/docs', null, 'feature'],
					['/docs/doctor', null, 'feature'],
					['/docs/doctor', 'en', 'hide'],
					['/docs/signal', 'es', 'hide'],
				],
			)
			assert.deepEqual(
				(await listModerationRules(db, 'site', { locale: 'en' })).map((rule) => rule.path),
				['/docs', '/docs/doctor', '/docs/doctor'],
			)
			assert.deepEqual(
				(await listModerationRules(db, 'site', { locale: null })).map((rule) => rule.path),
				['/docs', '/docs/doctor'],
			)
			const saved = await saveModerationRule(db, { site: 'site', locale: 'en', path: '/docs/doctor', action: 'feature', author: 'luis' })
			assert.equal(saved.version, 2, 'the rule of that language is replaced, not the others')
			await saveModerationRule(db, { site: 'site', locale: 'en', path: '/docs/doctor', action: 'hide', author: 'luis' })

			await createAnnouncement(db, { site: 'site', message: 'Aviso en español', tone: 'info', active: true, author: 'ana' })
			const englishNotice = await createAnnouncement(db, { site: 'site', locale: 'en', message: 'English notice', tone: 'info', active: true, author: 'ana' })
			await createAnnouncement(db, { site: 'site', locale: null, message: 'Global', tone: 'warning', active: true, author: 'ana' })
			assert.deepEqual(
				(await listAnnouncements(db, 'site', { locale: 'en' })).map((item) => item.message),
				['Global', 'English notice'],
			)
			const kept = await updateAnnouncement(db, englishNotice.id, { site: 'site', message: 'English notice, edited', tone: 'info', active: true, author: 'luis' })
			assert.equal(kept.locale, 'en', 'a change without locale keeps its language')

			const reader = createModerationReader({ db: () => db })
			const es = await reader.read('site')
			const en = await reader.read('site', 'en')
			assert.deepEqual([es.hidden, es.featured], [['/docs/signal'], ['/docs', '/docs/doctor']])
			assert.deepEqual([en.hidden, en.featured], [['/en/docs/doctor'], ['/en/docs']], 'English paths are its public URLs')
			assert.deepEqual(
				es.announcements.map((item) => item.message),
				['Global', 'Aviso en español'],
			)
			assert.deepEqual(
				en.announcements.map((item) => item.message),
				['Global', 'English notice, edited'],
			)
			await reader.close()
		})

		test('metrics keep the language of each view, search and answer', async () => {
			const writer = createMetricsWriter({ enabled: true, db: () => db, log: () => undefined })
			assert.equal(await writer.view('site', '/docs/signal'), true)
			assert.equal(await writer.view('site', '/docs/signal', 'en'), true)
			assert.equal(await writer.view('site', '/docs/signal', 'en'), true)
			assert.equal(await writer.search('site', 'signal', 1, 'en'), true)
			assert.equal(await writer.search('site', 'señal', 1), true)
			assert.equal(await writer.feedback('site', { path: '/docs/signal', locale: 'en', helpful: false, comment: 'Missing an example' }), true)
			assert.equal(await writer.feedback('site', { path: '/docs/signal', helpful: true, comment: 'Gracias' }), true)
			const today = new Date().toISOString().slice(0, 10)
			const range = { site: 'site' as const, from: today, to: today }
			const all = await readMetricsSummary(db, range)
			assert.equal(all.locale, null)
			assert.deepEqual(all.topPages, [
				{ path: '/docs/signal', locale: 'en', views: 2 },
				{ path: '/docs/signal', locale: 'es', views: 1 },
			])
			const english = await readMetricsSummary(db, { ...range, locale: 'en' })
			assert.deepEqual([english.totals.views, english.totals.searches, english.totals.helpful, english.totals.unhelpful], [2, 1, 0, 1])
			assert.deepEqual(
				english.topSearches.map((search) => search.query),
				['signal'],
			)
			assert.deepEqual(
				(await listFeedbackComments(db, { ...range, locale: 'en' })).items.map((item) => [item.comment, item.locale]),
				[['Missing an example', 'en']],
			)
			assert.equal((await listFeedbackComments(db, range)).total, 2)
			await writer.close()
		})
	})
})
