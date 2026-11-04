// The moderation screen's server against PostgreSQL, in a temporary schema that the test drops at
// the end: known pages, rules, announcements, the counters of the tabs and the public error codes.
// The tables of the database it connects to are never read or written. The input schemas run
// without a database. Skipped without DATABASE_URL (apps/dashboard/.env is loaded).
import type { Database } from 'meeko-docs-content/db'

import { createDatabase, importSources, migrate } from 'meeko-docs-content/db'
import { publishSnapshot } from 'meeko-docs-content/snapshots'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as v from 'valibot'

import { fromLocalInput, toLocalInput } from '../app/utils/moderation'
import { moderationTask, readModeration, removeAnnouncement, removeRule, saveAnnouncement, saveRule, switchAnnouncement } from '../server/dashboard/moderation'
import { announcementActiveInput, moderationIdInput, saveAnnouncementInput, saveRuleInput } from '../shared/schemas/moderation'

const app = fileURLToPath(new URL('../', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL
const schema = `dash_mod_${process.pid}_${randomBytes(4).toString('hex')}`

const code = (expected: string, status: number) => (error: Error & { code?: string; status?: number }) => error.code === expected && error.status === status

describe('moderation inputs', () => {
	test('the schemas trim, bound and order what the screen sends', () => {
		// F5: the author is the user of the session; one the screen sends never reaches the rule.
		const parsed = v.parse(saveRuleInput, { site: 'ui', path: '/buttons', action: 'hide', reason: '  x ', author: 'Mallory', id: null, version: null })
		assert.equal(parsed.reason, 'x')
		assert.equal('author' in parsed, false)
		assert.equal('author' in v.parse(saveAnnouncementInput, { site: 'site', message: 'Hola', tone: 'info', startsAt: null, endsAt: null, active: true, author: 'Mallory' }), false)
		assert.equal(v.safeParse(saveRuleInput, { site: 'ui', path: 'buttons', action: 'hide', author: 'Ana', id: null, version: null }).success, false)
		assert.equal(v.safeParse(saveRuleInput, { site: 'web', path: '/buttons', action: 'hide', author: 'Ana', id: null, version: null }).success, false)
		assert.equal(v.safeParse(saveRuleInput, { site: 'ui', path: '/buttons', action: 'hide', author: 'Ana' }).success, false, 'a rule names the version it read, or null')
		assert.equal(v.safeParse(saveRuleInput, { site: 'ui', path: '/buttons', action: 'hide', author: 'Ana', id: null, version: 2 }).success, false, 'a version names the id of its rule')
		assert.equal(v.safeParse(saveRuleInput, { site: 'ui', path: '/buttons', action: 'hide', author: 'Ana', id: 4, version: null }).success, false)
		assert.equal(v.safeParse(saveRuleInput, { site: 'ui', path: '/buttons', action: 'hide', author: 'Ana', id: 4, version: 2 }).success, true)
		assert.equal(v.safeParse(moderationIdInput, { id: 1 }).success, false, 'a delete names the version it read')
		assert.equal(v.safeParse(announcementActiveInput, { id: 1, version: 2, active: false }).success, true)
		assert.equal(v.safeParse(announcementActiveInput, { id: 1, version: 0, active: false }).success, false)
		const base = { site: 'site', message: 'Hola', tone: 'info', startsAt: null, endsAt: null, active: true, author: 'Ana' }
		assert.equal(v.safeParse(saveAnnouncementInput, base).success, true)
		assert.equal(v.safeParse(saveAnnouncementInput, { ...base, message: ' ' }).success, false)
		assert.equal(v.safeParse(saveAnnouncementInput, { ...base, message: 'x'.repeat(501) }).success, false)
		assert.equal(v.safeParse(saveAnnouncementInput, { ...base, startsAt: 'mañana' }).success, false)
		assert.equal(v.safeParse(saveAnnouncementInput, { ...base, startsAt: '2026-11-02T10:00:00.000Z', endsAt: '2026-11-01T10:00:00.000Z' }).success, false)
		assert.equal(v.safeParse(saveAnnouncementInput, { ...base, id: 3 }).success, false, 'a change names the version it read')
		assert.equal(v.safeParse(saveAnnouncementInput, { ...base, id: 3, version: 1 }).success, true)
	})

	test('the dates of the form round-trip through the browser time', () => {
		assert.equal(toLocalInput(null), '')
		assert.equal(fromLocalInput(''), null)
		assert.equal(fromLocalInput('no'), null)
		const iso = new Date(2026, 10, 2, 9, 30).toISOString()
		assert.equal(toLocalInput(iso), '2026-11-02T09:30')
		assert.equal(fromLocalInput('2026-11-02T09:30'), iso)
	})
})

describe('moderation of the dashboard', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	let admin: Database
	let db: Database

	before(async () => {
		admin = createDatabase({ connectionString: url! })
		await admin.query(`CREATE SCHEMA ${schema}`)
		db = createDatabase({ connectionString: url!, searchPath: schema })
		await migrate(db)
		await importSources(
			db,
			[
				{ site: 'site', path: '/docs/doctor', kind: 'guide', title: 'Doctor', file: 'docs/doctor.md', markdown: '# Doctor\n' },
				{ site: 'ui', path: '/', kind: 'page', title: 'Introducción', file: null, markdown: null },
				{ site: 'ui', path: '/buttons', kind: 'page', title: 'Button', file: null, markdown: null },
			],
			['site', 'ui'],
		)
		await publishSnapshot([{ path: '/docs/reference/signal', payload: { page: { name: 'signal' } } }], { db })
	})

	after(async () => {
		await db?.end()
		await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin?.end()
	})

	test('a web lists its known pages, its rules and its announcements, and the counters of all', async () => {
		const empty = await readModeration(db, 'site')
		assert.deepEqual(
			empty.pages.map((page) => [page.path, page.origin]),
			[
				['/docs/doctor', 'source'],
				['/docs/reference/signal', 'snapshot'],
			],
		)
		assert.deepEqual(empty.counts, { site: { rules: 0, live: 0 }, ui: { rules: 0, live: 0 }, i18n: { rules: 0, live: 0 } })

		const hidden = await moderationTask(() => saveRule(db, { site: 'ui', path: '/buttons', action: 'hide', reason: 'En revisión', author: 'Ana', id: null, version: null }))
		assert.deepEqual([hidden.title, hidden.action, hidden.reason], ['Button', 'hide', 'En revisión'])
		const live = await moderationTask(() => saveAnnouncement(db, { site: 'ui', message: 'Nueva versión', tone: 'success', startsAt: null, endsAt: null, active: true, author: 'Ana' }))
		const later = await moderationTask(() => saveAnnouncement(db, { site: 'ui', message: 'Mañana', tone: 'warning', startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: null, active: true, author: 'Ana' }))
		assert.deepEqual([live.state, later.state], ['live', 'scheduled'])

		const ui = await readModeration(db, 'ui')
		assert.deepEqual(
			ui.rules.map((rule) => rule.path),
			['/buttons'],
		)
		assert.deepEqual(
			ui.announcements.map((item) => item.message),
			['Mañana', 'Nueva versión'],
		)
		assert.deepEqual(ui.counts.ui, { rules: 1, live: 1 })
		assert.deepEqual((await readModeration(db, 'site')).rules, [], 'only the rules of that web')

		const edited = await moderationTask(() => saveAnnouncement(db, { id: later.id, version: later.version, site: 'ui', message: 'Mañana, a las 10', tone: 'warning', startsAt: null, endsAt: null, active: false, author: 'Diego' }))
		assert.deepEqual([edited.id, edited.message, edited.state, edited.author, edited.version], [later.id, 'Mañana, a las 10', 'inactive', 'Diego', later.version + 1])

		await moderationTask(() => removeRule(db, hidden.id, hidden.version))
		await moderationTask(() => removeAnnouncement(db, live.id, live.version))
		assert.deepEqual((await readModeration(db, 'ui')).counts.ui, { rules: 0, live: 0 })
	})

	test('rules and announcements of one language or of every language', async () => {
		const spanish = await moderationTask(() => saveRule(db, { site: 'site', path: '/docs/doctor', action: 'feature', author: 'Ana', id: null, version: null }))
		const english = await moderationTask(() => saveRule(db, { site: 'site', locale: 'en', path: '/docs/doctor', action: 'hide', reason: 'Translation in review', author: 'Ana', id: null, version: null }))
		const global = await moderationTask(() => saveRule(db, { site: 'site', locale: null, path: '/docs/reference/signal', action: 'hide', author: 'Ana', id: null, version: null }))
		// Without a language, Spanish, as before; the same page has one rule per language.
		assert.deepEqual([spanish.locale, english.locale, global.locale], ['es', 'en', null])
		const notice = await moderationTask(() => saveAnnouncement(db, { site: 'site', locale: null, message: 'For everyone', tone: 'info', startsAt: null, endsAt: null, active: true, author: 'Ana' }))
		const englishNotice = await moderationTask(() => saveAnnouncement(db, { site: 'site', locale: 'en', message: 'Only in English', tone: 'info', startsAt: null, endsAt: null, active: true, author: 'Ana' }))
		assert.deepEqual([notice.locale, englishNotice.locale], [null, 'en'])
		// A change without a language keeps the one it had.
		const kept = await moderationTask(() => saveAnnouncement(db, { id: englishNotice.id, version: englishNotice.version, site: 'site', message: 'Only in English, again', tone: 'info', startsAt: null, endsAt: null, active: true, author: 'Ana' }))
		assert.equal(kept.locale, 'en')

		const view = await readModeration(db, 'site')
		assert.deepEqual(view.rules.map((rule) => [rule.path, rule.locale, rule.action]).sort(), [
			['/docs/doctor', 'en', 'hide'],
			['/docs/doctor', 'es', 'feature'],
			['/docs/reference/signal', null, 'hide'],
		])
		assert.deepEqual(view.counts.site, { rules: 3, live: 2 })
		for (const rule of view.rules) await moderationTask(() => removeRule(db, rule.id, rule.version))
		for (const item of view.announcements) await moderationTask(() => removeAnnouncement(db, item.id, item.version))
	})

	test('two tabs: the old one gets 409 and the newer change stays', async () => {
		// Both tabs read the announcement at version 1. A fixes the message; B switches it off.
		const item = await moderationTask(() => saveAnnouncement(db, { site: 'ui', message: 'Mensaje con errata', tone: 'info', startsAt: null, endsAt: null, active: true, author: 'Ana' }))
		const fixed = await moderationTask(() => saveAnnouncement(db, { id: item.id, version: item.version, site: 'ui', message: 'Mensaje corregido', tone: 'info', startsAt: null, endsAt: null, active: true, author: 'Ana' }))
		await assert.rejects(
			moderationTask(() => switchAnnouncement(db, item.id, item.version, false)),
			code('MODERATION_CONFLICT', 409),
		)
		await assert.rejects(
			moderationTask(() => removeAnnouncement(db, item.id, item.version)),
			code('MODERATION_CONFLICT', 409),
		)
		// After reloading, B switches it off from the new version: only `active` changes.
		const off = await moderationTask(() => switchAnnouncement(db, fixed.id, fixed.version, false))
		assert.deepEqual([off.message, off.active, off.author, off.state], ['Mensaje corregido', false, 'Ana', 'inactive'])

		// Rules: A creates the one of /buttons while B still sees the page without a rule.
		const rule = await moderationTask(() => saveRule(db, { site: 'ui', path: '/buttons', action: 'feature', author: 'Ana', id: null, version: null }))
		await assert.rejects(
			moderationTask(() => saveRule(db, { site: 'ui', path: '/buttons', action: 'hide', author: 'Bea', id: null, version: null })),
			code('MODERATION_CONFLICT', 409),
		)
		const changed = await moderationTask(() => saveRule(db, { site: 'ui', path: '/buttons', action: 'hide', author: 'Ana', id: rule.id, version: rule.version }))
		await assert.rejects(
			moderationTask(() => removeRule(db, rule.id, rule.version)),
			code('MODERATION_CONFLICT', 409),
		)
		assert.deepEqual(
			(await readModeration(db, 'ui')).rules.map((row) => [row.action, row.version]),
			[['hide', changed.version]],
		)
		await moderationTask(() => removeRule(db, changed.id, changed.version))
		await assert.rejects(
			moderationTask(() => removeRule(db, changed.id, changed.version)),
			code('MODERATION_NOT_FOUND', 404),
		)
		// B deletes it and creates it again: version 1 again, another id. A, from the tab where it read
		// the first rule at version 1, cannot overwrite the new one.
		const first = await moderationTask(() => saveRule(db, { site: 'ui', path: '/buttons', action: 'feature', author: 'Ana', id: null, version: null }))
		await moderationTask(() => removeRule(db, first.id, first.version))
		const recreated = await moderationTask(() => saveRule(db, { site: 'ui', path: '/buttons', action: 'hide', reason: 'De Bea', author: 'Bea', id: null, version: null }))
		assert.equal(recreated.version, first.version)
		await assert.rejects(
			moderationTask(() => saveRule(db, { site: 'ui', path: '/buttons', action: 'feature', author: 'Ana', id: first.id, version: first.version })),
			code('MODERATION_CONFLICT', 409),
		)
		assert.deepEqual(
			(await readModeration(db, 'ui')).rules.map((row) => [row.id, row.action, row.reason, row.author]),
			[[recreated.id, 'hide', 'De Bea', 'Bea']],
		)
		await moderationTask(() => removeRule(db, recreated.id, recreated.version))
		await moderationTask(() => removeAnnouncement(db, off.id, off.version))
	})

	test('refusals become public codes', async () => {
		await assert.rejects(
			moderationTask(() => saveRule(db, { site: 'ui', path: '/nope', action: 'feature', author: 'Ana', id: null, version: null })),
			code('UNKNOWN_PAGE', 422),
		)
		await assert.rejects(
			moderationTask(() => saveRule(db, { site: 'ui', path: '/', action: 'hide', author: 'Ana', id: null, version: null })),
			code('INVALID_MODERATION', 422),
		)
		await assert.rejects(
			moderationTask(() => removeRule(db, 999_999, 1)),
			code('MODERATION_NOT_FOUND', 404),
		)
		await assert.rejects(
			moderationTask(() => saveAnnouncement(db, { id: 999_999, version: 1, site: 'ui', message: 'x', tone: 'info', startsAt: null, endsAt: null, active: true, author: 'Ana' })),
			code('MODERATION_NOT_FOUND', 404),
		)
		await assert.rejects(
			moderationTask(() => switchAnnouncement(db, 999_999, 1, true)),
			code('MODERATION_NOT_FOUND', 404),
		)
		const missing = createDatabase({ connectionString: url!, searchPath: 'dash_mod_missing' })
		try {
			await assert.rejects(
				moderationTask(() => readModeration(missing, 'site')),
				code('SCHEMA_MISSING', 503),
			)
		} finally {
			await missing.end()
		}
	})
})
