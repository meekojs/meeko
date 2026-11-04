// The translations of the site into English against PostgreSQL, in a temporary schema that the test
// drops at the end, and the catalogs of the interface: one status each, the detail with the changes
// of the original, and the stamp of `source-hash`. Skipped without DATABASE_URL.
import type { I18n } from '@meekojs/i18n'
import type { Database } from 'meeko-docs-content/db'

import { readGitFile } from 'meeko-docs-content/content/repository'
import { createDatabase, getSource, importSources, migrate } from 'meeko-docs-content/db'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { Failure } from '../app/utils/errors'

import { failureMessage, issueText } from '../app/utils/i18n'
import { readOverview, summarize } from '../server/dashboard/reads'
import { textHash } from '../server/dashboard/revisions'
import { originalOf, readTranslation, readTranslations, stampSource } from '../server/dashboard/translations'

const app = fileURLToPath(new URL('../', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL
const schema = `dash_tr_${process.pid}_${randomBytes(4).toString('hex')}`

const code = (expected: string, status: number) => (error: Error & { code?: string; status?: number }) => error.code === expected && error.status === status

/** The keys of a catalog, flattened as the module does; a plural or a selector is one message. */
function keysOf(value: unknown, prefix = ''): string[] {
	if (typeof value === 'string' || (typeof value === 'object' && value !== null && 'forms' in value)) return [prefix]
	return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key))
}

const catalog = (locale: string, name: string) => JSON.parse(readFileSync(join(app, 'app', 'locales', locale, `${name}.json`), 'utf8')) as unknown

describe('the catalogs of the interface', () => {
	const names = readdirSync(join(app, 'app', 'locales', 'es')).map((file) => file.replace(/\.json$/, ''))

	test('both languages have the same namespaces and keys, and no key is the Shell one', () => {
		assert.deepEqual(readdirSync(join(app, 'app', 'locales', 'en')).sort(), readdirSync(join(app, 'app', 'locales', 'es')).sort())
		const seen = new Set<string>()
		for (const name of names) {
			const keys = keysOf(catalog('es', name))
			assert.deepEqual(keysOf(catalog('en', name)).sort(), [...keys].sort(), name)
			for (const key of keys) {
				assert.equal(seen.has(key), false, `${key} is in two namespaces`)
				assert.equal(key.startsWith('shell.'), false, `${key}: the prefix shell. belongs to meeko-docs`)
				seen.add(key)
			}
		}
	})

	test('the messages that a datum names take no values: the page asks for them without any', () => {
		for (const locale of ['es', 'en']) {
			const common = catalog(locale, 'common') as Record<string, Record<string, unknown>>
			const named = [...Object.entries(common.errors!).filter(([key]) => /^[A-Z]/.test(key)), ...Object.entries(common.validation!), ...Object.entries(common.issues!)]
			assert.ok(named.length > 0)
			for (const [key, text] of named) assert.ok(typeof text === 'string' && !text.includes('{'), `${locale}: ${key}`)
		}
	})

	test('a code or a message outside the catalogs gets the safe fallback', () => {
		const common = new Set(keysOf(catalog('es', 'common')))
		const i18n = { has: (key: string) => common.has(key), t: (key: string, values?: object) => (values ? `${key} ${JSON.stringify(values)}` : key) } as unknown as I18n
		const failure = (code: string, requestId?: string) => ({ code, requestId }) as Failure
		assert.equal(failureMessage(i18n, failure('INVALID_CSRF')), 'errors.INVALID_CSRF')
		assert.equal(failureMessage(i18n, failure('NEW_CODE')), 'errors.unknownCode {"code":"NEW_CODE"}')
		assert.equal(failureMessage(i18n, failure('NEW_CODE', 'r1')), 'errors.unknownCodeRequest {"code":"NEW_CODE","request":"r1"}')
		// Other texts of `errors.*` exist too, and one needs values: a code never reaches them.
		for (const code of ['unknownCode', 'title', 'constructor']) assert.equal(failureMessage(i18n, failure(code)), `errors.unknownCode {"code":"${code}"}`)
		assert.equal(issueText(i18n, 'validation.username'), 'validation.username')
		assert.equal(issueText(i18n, 'issues.gitMissing'), 'issues.gitMissing')
		// A technical text, an unknown key and a key of another family come back as they are.
		for (const text of ['connect ECONNREFUSED', 'validation.nope', 'nav.sources', 'errors.UNKNOWN']) assert.equal(issueText(i18n, text), text)
		assert.equal(issueText(i18n, undefined), undefined)
	})

	test('the English catalogs have no Spanish left', () => {
		for (const name of names) {
			const text = JSON.stringify(catalog('en', name))
			assert.doesNotMatch(text, /[áéíóúñ¿¡]/, name)
		}
	})
})

describe('the translations of the site', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	let admin: Database
	let db: Database
	const doctor = readGitFile('docs/doctor.md')
	const testing = readGitFile('docs/testing.md')
	const changed = `${testing}\nUn parrafo nuevo del original.\n`
	const ids = { doctor: 0, testing: 0, testingEn: 0, api: 0 }

	before(async () => {
		admin = createDatabase({ connectionString: url! })
		await admin.query(`CREATE SCHEMA ${schema}`)
		db = createDatabase({ connectionString: url!, searchPath: schema })
		await migrate(db)
		await importSources(
			db,
			[
				{ site: 'site', path: '/docs/doctor', kind: 'guide', title: 'Doctor', file: 'docs/doctor.md', markdown: doctor },
				{ site: 'site', locale: 'en', sourceHash: textHash(doctor), path: '/docs/doctor', kind: 'guide', title: 'Doctor', file: 'docs/en/doctor.md', markdown: readGitFile('docs/en/doctor.md') },
				{ site: 'site', path: '/docs/testing', kind: 'guide', title: 'Pruebas', file: 'docs/testing.md', markdown: changed },
				{ site: 'site', locale: 'en', sourceHash: textHash(testing), path: '/docs/testing', kind: 'guide', title: 'Testing', file: 'docs/en/testing.md', markdown: readGitFile('docs/en/testing.md') },
				{ site: 'site', path: '/docs/api', kind: 'guide', title: 'API', file: 'docs/api.md', markdown: readGitFile('docs/api.md') },
			],
			['site'],
		)
		const id = async (path: string, locale: 'en' | 'es' = 'es') => (await getSource(db, { site: 'site', path, locale }))!.id
		ids.doctor = await id('/docs/doctor')
		ids.testing = await id('/docs/testing')
		ids.testingEn = await id('/docs/testing', 'en')
		ids.api = await id('/docs/api')
	})

	after(async () => {
		await db?.end()
		await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin?.end()
	})

	test('the list has one status per page and counters of the whole list', async () => {
		const list = await readTranslations(db)
		assert.deepEqual(list.counts, { translated: 1, outdated: 1, missing: 1, total: 3 })
		assert.deepEqual(Object.fromEntries(list.entries.map((entry) => [entry.original.path, entry.status])), { '/docs/api': 'missing', '/docs/doctor': 'translated', '/docs/testing': 'outdated' })
		const missing = list.entries.find((entry) => entry.status === 'missing')!
		assert.equal(missing.translation, null)
		assert.equal(missing.file, 'docs/en/api.md', 'where its translation goes')
		const filtered = await readTranslations(db, { status: 'outdated' })
		assert.deepEqual(
			filtered.entries.map((entry) => entry.original.path),
			['/docs/testing'],
		)
		assert.equal(filtered.counts.total, 3, 'the counters do not depend on the status filter')
	})

	test('the overview counts the originals and the translations apart', async () => {
		const overview = await readOverview(db, { content: null, health: null })
		assert.equal(overview.sites.find((summary) => summary.site === 'site')?.total, 3, 'the Spanish sources, not their translations')
		assert.deepEqual(overview.translations, { translated: 1, outdated: 1, missing: 1, total: 3 })
		assert.deepEqual(
			summarize([]).map((summary) => summary.total),
			[0, 0, 0],
		)
	})

	test('the detail compares both texts and shows what changed in the original', async () => {
		const outdated = await readTranslation(db, ids.testing)
		assert.equal(outdated.status, 'outdated')
		assert.equal(outdated.translation?.id, ids.testingEn)
		assert.equal(outdated.translatedFrom, 'working-tree')
		assert.match(outdated.originalChanges, /^\+Un parrafo nuevo del original\.$/m)
		assert.equal((await readTranslation(db, ids.testingEn)).original.id, ids.testing, 'by the id of the translation too')

		const translated = await readTranslation(db, ids.doctor)
		assert.deepEqual([translated.status, translated.originalChanges], ['translated', ''])
		const missing = await readTranslation(db, ids.api)
		assert.deepEqual([missing.status, missing.translation, missing.translationMarkdown], ['missing', null, null])
		await assert.rejects(readTranslation(db, 999_999), code('TRANSLATION_NOT_FOUND', 404))
	})

	test('marking a translation as translated writes the hash of the imported original', async () => {
		const stamped = await stampSource(db, ids.testingEn, '---\nsource-hash: old\n---\n\n# Testing\n')
		assert.equal(stamped.sourceHash, textHash(changed))
		assert.match(stamped.markdown, new RegExp(`^---\\nsource-hash: ${stamped.sourceHash}\\n---`))
		assert.deepEqual(await originalOf(db, { site: 'site', locale: 'en', path: '/docs/testing' }), { id: ids.testing, title: 'Pruebas', baseHash: textHash(changed) })
		// An original has no original.
		await assert.rejects(stampSource(db, ids.testing, '# Prueba\n'), code('SOURCE_NOT_EDITABLE', 409))
		assert.equal(await originalOf(db, { site: 'site', locale: 'es', path: '/docs/testing' }), null)
		await assert.rejects(stampSource(db, 999_999, '# x\n'), code('SOURCE_NOT_FOUND', 404))
	})
})
