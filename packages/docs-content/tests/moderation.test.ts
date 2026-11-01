// The moderation of the public sites: pure functions without a database, the reader with a fake one,
// and the writes and reads in a temporary schema that the test drops (skipped without DATABASE_URL).
import { createRouteManifest, matchRoute } from '@meekojs/meeko/framework'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { Database, Queryable } from '../src/db/pool'
import type { SiteModeration } from '../src/moderation/shared'

import { migrate } from '../src/db/migrations'
import { announcementState, createAnnouncement, deleteAnnouncement, deleteModerationRule, listAnnouncements, listKnownPages, listModerationRules, ModerationError, saveModerationRule, setAnnouncementActive, updateAnnouncement } from '../src/db/moderation'
import { createDatabase } from '../src/db/pool'
import { publishSnapshot } from '../src/db/snapshots'
import { importSources } from '../src/db/sources'
import { moderateLlmsFull, moderateLlmsIndex, moderateSnapshotPayload } from '../src/moderation/apply'
import { createModerationReader } from '../src/moderation/read'
import { announcementRole, dismissCookie, dismissedAnnouncements, emptyModeration, isFeaturedPath, isHiddenPath, pagePath, routePath, withoutDismissed } from '../src/moderation/shared'

const here = dirname(fileURLToPath(import.meta.url))
const rules = (hidden: string[], featured: string[] = []): SiteModeration => ({ hidden, featured, announcements: [] })

describe('moderation rules applied to pages', () => {
	test('paths ignore query, fragment and trailing slash; aliases name their page', () => {
		assert.equal(pagePath('/docs/api/?x=1#uso'), '/docs/api')
		assert.equal(pagePath('/'), '/')
		assert.equal(pagePath('https://meekojs.com/docs/api#x'), '/docs/api')
		const moderation = rules(['/playground'], ['/messages'])
		assert.equal(isHiddenPath(moderation, '/playground/'), true)
		assert.equal(isHiddenPath(moderation, '/en/playground'), false)
		assert.equal(isHiddenPath(moderation, '/en/playground', new Map([['/en/playground', '/playground']])), true)
		assert.equal(isFeaturedPath(moderation, '/messages#x'), true)
		assert.equal(isHiddenPath(emptyModeration, '/x'), false)
	})

	test('a page is named as the router of Meeko reads its URL: decoded segments, no empty ones', () => {
		// The router of Meeko is the reference: routePath must reach the page matchRoute reaches.
		const routes = createRouteManifest(['/', '/buttons', '/playground', '/en/playground', '/docs/api', '/docs/[...slug]', '/users/[id]'].map((id) => ({ id, file: `${id}.meeko`, layouts: [] })))
		const samples = ['/', '//', '///', '/buttons', '/%62uttons', '/%62%75ttons', '//buttons', '/buttons/', '/buttons//', '/Buttons', '/%2Fbuttons', '/%5Cbuttons', '/%2e', '/%2e%2e', '/%', '/%E0%A4%A', '/en//playground', '/%65n/%70layground', '/en/playground/', '/docs//api', '/docs/%61pi', '/docs/a%2Fb', '/docs/a/b', '/docs/%E2%9C%93', '/docs/%ZZ', '/users/%31', '/users//1//', '/users/a%20b']
		for (const sample of samples) {
			const match = matchRoute(routes, sample)
			const expected = match === undefined ? null : match.route.id.includes('[') ? match.route.id.replace(/\[(?:\.\.\.)?(\w+)\]/, (_, name: string) => String(match.params[name])) : match.route.id
			const actual = routePath(sample)
			if (expected === null) assert.ok(actual === null || !matchRoute(routes, actual), `${sample}: the router matches nothing, routePath gives ${actual}`)
			else assert.equal(actual, expected, sample)
		}
		assert.equal(routePath('/en//playground/?x=1#uso'), '/en/playground')
		assert.equal(routePath('https://meekojs.com//docs/%61pi?x'), '/docs/api')
		assert.equal(routePath('relative/path'), null)
	})

	test('hide cannot be dodged with an equivalent URL, also through an alias', () => {
		const moderation = rules(['/buttons', '/playground'])
		const aliases = new Map([
			['/en/playground', '/playground'],
			['/es/playground', '/playground'],
		])
		for (const href of ['/buttons', '/%62uttons', '//buttons', '/buttons/', '/buttons?x=1', '/buttons#a', '///buttons//', '/%70layground', '/playground/?x', '/en/playground', '/en//playground', '/%65n/playground', '/en/%70layground/', '//es//playground?y#z']) assert.equal(isHiddenPath(moderation, href, aliases), true, href)
		for (const href of ['/Buttons', '/buttonsx', '/%2Fbuttons', '/fr/playground', '/en', '/']) assert.equal(isHiddenPath(moderation, href, aliases), false, href)
		// A rule or an alias written with another spelling names the same page.
		assert.equal(isHiddenPath(rules(['/buttons/']), '/%62uttons'), true)
		assert.equal(isHiddenPath(rules(['/playground']), '/en//playground', new Map([['/en/playground/', '/playground/']])), true)
		assert.equal(isFeaturedPath(rules([], ['/buttons']), '//%62uttons/'), true)
	})

	test('a snapshot payload loses hidden links, marks featured ones and fixes its pager', () => {
		const payload = {
			doc: { title: 'API', html: '<a href="/docs/oculta">x</a>' },
			current: '/docs/api',
			nav: [
				{
					title: 'Guías',
					links: [
						{ href: '/docs/inicio', label: 'Inicio' },
						{ href: '/docs/oculta', label: 'Oculta' },
						{ href: '/docs/api', label: 'API' },
						{ href: '/docs/otra', label: 'Otra' },
					],
				},
				{ title: 'Solo oculta', links: [{ href: '/docs/sola', label: 'Sola' }] },
			],
			pages: { previous: { href: '/docs/oculta', label: 'Oculta' }, next: { href: '/docs/otra', label: 'Otra' } },
			groups: [
				{
					anchor: 'a',
					href: '/docs/sola',
					entries: [
						{ name: 'x', href: '/docs/sola' },
						{ name: 'y', href: '/docs/otra' },
					],
				},
			],
		}
		const moderated = moderateSnapshotPayload(payload, rules(['/docs/oculta', '/docs/sola'], ['/docs/otra']))
		assert.deepEqual(
			moderated.nav.map((section) => section.title),
			['Guías'],
			'a section without pages leaves',
		)
		assert.deepEqual(
			moderated.nav[0]!.links.map((link) => [link.href, 'featured' in link]),
			[
				['/docs/inicio', false],
				['/docs/api', false],
				['/docs/otra', true],
			],
		)
		assert.deepEqual(moderated.pages, { previous: { href: '/docs/inicio', label: 'Inicio' }, next: { href: '/docs/otra', label: 'Otra' } })
		assert.equal(moderated.groups.length, 1, 'a group keeps its place while it has pages')
		assert.deepEqual(
			moderated.groups[0]!.entries.map((entry) => entry.href),
			['/docs/otra'],
		)
		assert.equal(moderated.doc.html, payload.doc.html, 'the HTML of the article is not rewritten')
		assert.equal(payload.nav[0]!.links.length, 4, 'the stored payload is not mutated')
		assert.equal(moderateSnapshotPayload(payload, emptyModeration), payload)
	})

	test('the reference index loses the links to a hidden /exports and counts what is left', () => {
		const index = {
			groups: [
				{ anchor: 'componentes', title: 'Componentes', entries: [{ name: 'MeekoLink', href: '/docs/reference/components/meekolink' }] },
				{
					anchor: 'macros',
					title: 'Macros',
					entries: [
						{ name: 'defineProps', href: '/docs/reference/macros/defineprops' },
						{ name: 'definePage', href: '/docs/reference/macros/definepage' },
					],
				},
			],
			total: 3,
			modules: [
				{ id: 'meeko', label: '@meekojs/meeko', href: '/docs/reference/exports#meeko', code: true },
				{ id: 'framework', label: '@meekojs/meeko/framework', href: '/docs/reference/exports#framework', code: true },
			],
			exportsIcon: 'M0 0',
			exportsLink: '/docs/reference/exports',
			nav: [
				{
					title: 'Referencia',
					links: [
						{ href: '/docs/reference', label: 'Índice' },
						{ href: '/docs/reference/exports', label: 'Todos los exports' },
						{ href: '/docs/reference/macros/defineprops', label: 'defineProps' },
					],
				},
			],
			current: '/docs/reference',
			toc: [
				{ id: 'componentes', text: 'Componentes', level: 2 },
				{ id: 'macros', text: 'Macros', level: 2 },
				{ id: 'todos-los-exports', text: 'Todos los exports', level: 2 },
			],
			pages: { previous: { href: '/docs/api', label: 'API' }, next: { href: '/docs/reference/components/meekolink', label: 'MeekoLink' } },
		}
		const moderated = moderateSnapshotPayload(index, rules(['/docs/reference/exports', '/docs/reference/components/meekolink', '/docs/reference/macros/definepage']))
		assert.equal(moderated.exportsLink, null, 'the card and the section of every export leave')
		assert.deepEqual(moderated.modules, [])
		assert.deepEqual(
			moderated.groups.map((group) => [group.anchor, group.entries.map((entry) => entry.name)]),
			[['macros', ['defineProps']]],
		)
		assert.equal(moderated.total, 1)
		assert.deepEqual(
			moderated.toc.map((entry) => entry.id),
			['macros'],
		)
		assert.deepEqual(
			moderated.nav[0]!.links.map((link) => link.href),
			['/docs/reference', '/docs/reference/macros/defineprops'],
		)
		assert.deepEqual(moderated.pages.next, { href: '/docs/reference/macros/defineprops', label: 'defineProps' }, 'the pager skips the hidden first entry')
		const visible = JSON.stringify(moderated)
		for (const hidden of ['/docs/reference/exports', 'meekolink', 'definepage']) assert.doesNotMatch(visible, new RegExp(hidden), `${hidden} leaves the whole index`)

		// Hiding only a module anchor's page keeps the rest; nothing hidden keeps the payload.
		const kept = moderateSnapshotPayload(index, rules(['/docs/reference/macros/definepage']))
		assert.equal(kept.exportsLink, '/docs/reference/exports')
		assert.equal(kept.modules.length, 2)
		assert.equal(kept.total, 2)
		assert.deepEqual(
			kept.toc.map((entry) => entry.id),
			['componentes', 'macros', 'todos-los-exports'],
		)
	})

	test('the index of /exports drops emptied sections and groups and recounts its kinds', () => {
		const exportsPage = {
			groups: [
				{
					id: 'meeko',
					specifier: '@meekojs/meeko',
					sections: [
						{
							title: 'Reactividad',
							items: [
								{ name: 'signal', kind: 'function', href: '/docs/reference/signal' },
								{ name: 'Signal', kind: 'type', href: '/docs/reference/signal-type' },
							],
						},
					],
				},
				{ id: 'framework', specifier: '@meekojs/meeko/framework', sections: [{ title: 'Rutas', items: [{ name: 'matchRoute', kind: 'function', href: '/docs/reference/matchroute' }] }] },
			],
			total: 3,
			kinds: [
				{ kind: 'function', label: 'Funciones', count: 2 },
				{ kind: 'type', label: 'Tipos', count: 1 },
			],
			toc: [
				{ id: 'meeko', text: '@meekojs/meeko', level: 2 },
				{ id: 'framework', text: '@meekojs/meeko/framework', level: 2 },
			],
		}
		const moderated = moderateSnapshotPayload(exportsPage, rules(['/docs/reference/matchroute', '/docs/reference/signal-type']))
		assert.deepEqual(
			moderated.groups.map((group) => group.id),
			['meeko'],
		)
		assert.equal(moderated.total, 1)
		assert.deepEqual(moderated.kinds, [{ kind: 'function', label: 'Funciones', count: 1 }])
		assert.deepEqual(
			moderated.toc.map((entry) => entry.id),
			['meeko'],
		)
	})

	test('llms.txt and llms-full.txt lose the hidden pages', () => {
		const origin = 'https://meeko.example'
		const index = `# Meeko\n\n## Guías\n\n- [A](${origin}/docs/a): uno\n- [B](${origin}/docs/b)\n- [Fuera](https://otro.example/docs/b)\n`
		assert.equal(moderateLlmsIndex(index, origin, rules(['/docs/b'])), `# Meeko\n\n## Guías\n\n- [A](${origin}/docs/a): uno\n- [Fuera](https://otro.example/docs/b)\n`)
		const full = `# Todo\n\nFuente.\n\n---\n\n<!-- ${origin}/docs/a -->\n\nTexto A\n\n---\n\n<!-- ${origin}/docs/b -->\n\nTexto B\n`
		assert.equal(moderateLlmsFull(full, origin, rules(['/docs/b'])), `# Todo\n\nFuente.\n\n---\n\n<!-- ${origin}/docs/a -->\n\nTexto A\n`)
		assert.equal(moderateLlmsFull(full, origin, rules(['/docs/a'])), `# Todo\n\nFuente.\n\n---\n\n<!-- ${origin}/docs/b -->\n\nTexto B\n`)
		assert.equal(moderateLlmsFull(full, origin, emptyModeration), full)
	})

	test('closed announcements live in a cookie the server reads', () => {
		assert.deepEqual(dismissedAnnouncements('a=1; meeko-docs-notices=4.2.x.-1; b=2'), [4, 2])
		assert.deepEqual(dismissedAnnouncements(undefined), [])
		const cookie = dismissCookie('meeko-docs-notices=2', 7, true)
		assert.match(cookie, /^meeko-docs-notices=7\.2; Path=\/; Max-Age=31536000; SameSite=Lax; Secure$/)
		const moderation: SiteModeration = {
			hidden: [],
			featured: [],
			announcements: [
				{ id: 7, message: 'a', tone: 'info' },
				{ id: 8, message: 'b', tone: 'danger' },
			],
		}
		assert.deepEqual(
			withoutDismissed(moderation, 'meeko-docs-notices=7').announcements.map((item) => item.id),
			[8],
		)
		assert.equal(announcementRole('danger'), 'alert')
		assert.equal(announcementRole('warning'), 'status')
	})

	test('the read module loads pg and nothing of the render', () => {
		const seen = new Set<string>()
		const external = new Set<string>()
		const visit = (file: string): void => {
			if (seen.has(file)) return
			seen.add(file)
			for (const [, specifier] of readFileSync(file, 'utf8').matchAll(/^(?:import|export)[^'"]*from '([^']+)'/gm)) {
				if (specifier!.startsWith('.')) visit(resolve(dirname(file), `${specifier}.ts`))
				else external.add(specifier!)
			}
		}
		visit(join(here, '../src/moderation/index.ts'))
		assert.deepEqual([...external].sort(), ['node:crypto', 'pg'])
		const shared = readFileSync(join(here, '../src/moderation/shared.ts'), 'utf8')
		assert.doesNotMatch(shared, /^import /m, 'the module the browser loads imports nothing')
	})
})

/** A database that answers the reader's two queries from memory and counts them. */
interface FakeAnnouncement {
	id: string
	message: string
	tone: 'info'
	starts_at: Date | null
	ends_at: Date | null
	created_at?: Date
}

/**
 * A database that answers the queries of the reader as PostgreSQL would: the announcements in
 * force and the scheduled ones apart, each with its order and its `LIMIT`, at the clock `now`.
 */
function fakeDatabase(state: { rules: { path: string; action: 'feature' | 'hide' }[]; announcements: FakeAnnouncement[]; fail?: boolean }, now: () => number = Date.now) {
	const counter = { queries: 0 }
	const db: Queryable = {
		query: (async (text: string, values: unknown[] = []) => {
			counter.queries++
			if (state.fail) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
			if (text.includes('docs_moderation')) return { rows: state.rules }
			const limit = Number(values[1] ?? 20)
			const rows = state.announcements.map((row, index) => ({ ...row, created_at: row.created_at ?? new Date(index) }))
			const ended = (row: FakeAnnouncement) => row.ends_at !== null && row.ends_at.getTime() <= now()
			if (text.includes('starts_at > now()'))
				return {
					rows: rows
						.filter((row) => row.starts_at !== null && row.starts_at.getTime() > now() && !ended(row))
						.sort((a, b) => a.starts_at!.getTime() - b.starts_at!.getTime())
						.slice(0, limit),
				}
			return {
				rows: rows
					.filter((row) => (row.starts_at === null || row.starts_at.getTime() <= now()) && !ended(row))
					.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
					.slice(0, limit),
			}
		}) as unknown as Queryable['query'],
	}
	return { db, counter }
}

describe('moderation reader', () => {
	test('caches each site, shares a query and applies the dates on every read', async () => {
		let clock = 1_000_000
		const state = {
			rules: [
				{ path: '/a', action: 'hide' as const },
				{ path: '/b', action: 'feature' as const },
			],
			announcements: [{ id: '3', message: 'Hola', tone: 'info' as const, starts_at: null, ends_at: new Date(clock + 5_000) }],
		}
		const { db, counter } = fakeDatabase(state, () => clock)
		const reader = createModerationReader({ db: () => db, ttlMs: 30_000, now: () => clock, log: () => {} })
		const [first, second] = await Promise.all([reader.read('ui'), reader.read('ui')])
		assert.deepEqual(first, { hidden: ['/a'], featured: ['/b'], announcements: [{ id: 3, message: 'Hola', tone: 'info' }] })
		assert.deepEqual(second, first)
		assert.equal(counter.queries, 3, 'one query of rules and two of announcements for both reads')
		state.rules = []
		assert.deepEqual((await reader.read('ui')).hidden, ['/a'], 'cached')
		clock += 6_000
		assert.deepEqual((await reader.read('ui')).announcements, [], 'an announcement leaves when it ends, cached or not')
		reader.invalidate('ui')
		assert.deepEqual(await reader.read('ui'), emptyModeration)
		clock += 31_000
		await reader.read('site')
		assert.equal(counter.queries, 9)
	})

	test('scheduled announcements never push out one in force, and start on time while cached', async () => {
		let clock = 10_000_000
		const old = { id: '1', message: 'Vigente', tone: 'info' as const, starts_at: null, ends_at: null, created_at: new Date(0) }
		const scheduled = Array.from({ length: 20 }, (_, index) => ({ id: String(index + 2), message: `Programado ${index}`, tone: 'info' as const, starts_at: new Date(clock + 3_600_000 + index), ends_at: null, created_at: new Date(1_000 + index) }))
		const soon = { id: '30', message: 'En 10 s', tone: 'info' as const, starts_at: new Date(clock + 10_000), ends_at: null, created_at: new Date(500) }
		const { db } = fakeDatabase({ rules: [], announcements: [old, ...scheduled, soon] }, () => clock)
		const reader = createModerationReader({ db: () => db, ttlMs: 30_000, now: () => clock, log: () => {} })
		assert.deepEqual(
			(await reader.read('site')).announcements.map((item) => item.message),
			['Vigente'],
		)
		clock += 11_000
		assert.deepEqual(
			(await reader.read('site')).announcements.map((item) => item.message),
			['En 10 s', 'Vigente'],
			'the one that starts first is kept although twenty more are scheduled, and shows from the cache',
		)
	})

	test('without a database or with a failing one, it serves no moderation and logs once', async () => {
		const logs: string[] = []
		const none = createModerationReader({ db: () => undefined, log: (message) => logs.push(message) })
		assert.deepEqual(await none.read('site'), emptyModeration)
		assert.deepEqual(await none.read('ui'), emptyModeration)
		assert.equal(logs.length, 1)
		assert.match(logs[0]!, /DATABASE_URL is not set/)

		let clock = 0
		const state = { rules: [{ path: '/a', action: 'hide' as const }], announcements: [], fail: true }
		const { db, counter } = fakeDatabase(state, () => clock)
		logs.length = 0
		const failing = createModerationReader({ db: () => db, retryMs: 10_000, now: () => clock, log: (message) => logs.push(message) })
		assert.deepEqual(await failing.read('site'), emptyModeration)
		assert.deepEqual(await failing.read('site'), emptyModeration)
		assert.equal(counter.queries, 3, 'a failure is reused until the retry')
		clock += 10_000
		await failing.read('site')
		assert.equal(logs.length, 1, 'logged once while it keeps failing')
		assert.match(logs[0]!, /ECONNREFUSED/)
		assert.doesNotMatch(logs[0]!, /postgres:\/\//)
		state.fail = false
		clock += 10_000
		assert.deepEqual((await failing.read('site')).hidden, ['/a'])
		assert.match(logs[1]!, /answers again/)
	})

	test('a database that does not answer gives up instead of hanging the page', async () => {
		// Port 9 of loopback (discard) has nothing listening: the connection is refused at once.
		const logs: string[] = []
		const previous = process.env.DATABASE_URL
		process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:9/none'
		try {
			const reader = createModerationReader({ log: (message) => logs.push(message) })
			const started = Date.now()
			assert.deepEqual(await reader.read('i18n'), emptyModeration)
			assert.ok(Date.now() - started < 5_000)
			assert.equal(logs.length, 1)
			assert.doesNotMatch(logs[0]!, /nothing@/, 'the password never reaches the log')
			await reader.close()
		} finally {
			if (previous === undefined) delete process.env.DATABASE_URL
			else process.env.DATABASE_URL = previous
		}
	})
})

const url = process.env.DATABASE_URL
const schema = `docs_test_${process.pid}_${randomBytes(4).toString('hex')}`

describe('moderation in the database', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
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
		await publishSnapshot(
			[
				{ path: '/docs/doctor', payload: { doc: { title: 'Doctor' } } },
				{ path: '/docs/reference/signal', payload: { page: { name: 'signal' } } },
				{ path: '/llms.txt', payload: { text: '' } },
			],
			{ db },
		)
	})

	after(async () => {
		await db?.end()
		await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin?.end()
	})

	test('known pages join the sources and the active snapshot', async () => {
		assert.deepEqual(await listKnownPages(db, 'site'), [
			{ path: '/docs/doctor', title: 'Doctor', origin: 'source' },
			{ path: '/docs/reference/signal', title: 'signal', origin: 'snapshot' },
		])
		assert.deepEqual(
			(await listKnownPages(db, 'ui')).map((page) => page.path),
			['/', '/buttons'],
		)
	})

	test('rules are saved per page, replaced, validated and deleted', async () => {
		const hidden = await saveModerationRule(db, { site: 'ui', path: '/buttons/', action: 'hide', reason: '  En revisión ', author: ' Diego ' })
		assert.deepEqual([hidden.path, hidden.action, hidden.reason, hidden.author], ['/buttons', 'hide', 'En revisión', 'Diego'])
		const featured = await saveModerationRule(db, { site: 'ui', path: '/buttons', action: 'feature', author: 'Ana' })
		assert.equal(featured.id, hidden.id, 'one rule per page')
		assert.deepEqual([featured.action, featured.reason, featured.author], ['feature', null, 'Ana'])
		await saveModerationRule(db, { site: 'site', path: '/docs/reference/signal', action: 'hide', author: 'Diego' })
		assert.deepEqual(
			(await listModerationRules(db)).map((rule) => `${rule.site}${rule.path}`),
			['site/docs/reference/signal', 'ui/buttons'],
		)
		assert.equal((await listModerationRules(db, 'ui')).length, 1)
		const refused = async (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof ModerationError && error.code === code)
		await refused(saveModerationRule(db, { site: 'ui', path: '/nope', action: 'hide', author: 'x' }), 'unknown-page')
		await refused(saveModerationRule(db, { site: 'ui', path: '/', action: 'hide', author: 'x' }), 'invalid')
		await refused(saveModerationRule(db, { site: 'ui', path: '/buttons', action: 'hide', author: '  ' }), 'invalid')
		await refused(saveModerationRule(db, { site: 'web' as 'ui', path: '/buttons', action: 'hide', author: 'x' }), 'invalid')
		await refused(saveModerationRule(db, { site: 'ui', path: '/buttons', action: 'hide', author: 'x', reason: 'x'.repeat(2001) }), 'invalid')
		assert.equal((await saveModerationRule(db, { site: 'ui', path: '/nueva', action: 'feature', author: 'x' }, { allowUnknown: true })).path, '/nueva')
		await deleteModerationRule(db, featured.id)
		await refused(deleteModerationRule(db, featured.id), 'not-found')
	})

	test('announcements are created, edited, validated and read only while in force', async () => {
		const reader = createModerationReader({ db: () => db, log: () => {} })
		const now = Date.now()
		const live = await createAnnouncement(db, { site: 'site', message: ' Nueva versión ', tone: 'success', active: true, author: 'Diego' })
		assert.equal(live.message, 'Nueva versión')
		const later = await createAnnouncement(db, { site: 'site', message: 'Mañana', tone: 'warning', startsAt: new Date(now + 3_600_000), active: true, author: 'Diego' })
		await createAnnouncement(db, { site: 'site', message: 'Terminado', tone: 'info', startsAt: new Date(now - 7_200_000), endsAt: new Date(now - 3_600_000), active: true, author: 'Diego' })
		const off = await createAnnouncement(db, { site: 'site', message: 'Apagado', tone: 'danger', active: false, author: 'Diego' })
		await createAnnouncement(db, { site: 'ui', message: 'Otra web', tone: 'info', active: true, author: 'Diego' })
		assert.deepEqual(
			(await reader.read('site')).announcements.map((item) => item.message),
			['Nueva versión'],
		)
		assert.deepEqual(
			(await listAnnouncements(db, 'site')).map((item) => announcementState(item)),
			['inactive', 'ended', 'scheduled', 'live'],
		)
		const edited = await updateAnnouncement(db, off.id, { site: 'site', message: 'Corte de servicio', tone: 'danger', active: true, author: 'Ana' })
		assert.deepEqual([edited.author, edited.active, edited.createdAt.getTime()], ['Ana', true, off.createdAt.getTime()])
		reader.invalidate()
		assert.deepEqual(
			(await reader.read('site')).announcements.map((item) => [item.message, item.tone]),
			[
				['Corte de servicio', 'danger'],
				['Nueva versión', 'success'],
			],
		)
		const refused = async (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof ModerationError && error.code === code)
		await refused(createAnnouncement(db, { site: 'site', message: '  ', tone: 'info', active: true, author: 'x' }), 'invalid')
		await refused(createAnnouncement(db, { site: 'site', message: 'x'.repeat(501), tone: 'info', active: true, author: 'x' }), 'invalid')
		await refused(createAnnouncement(db, { site: 'site', message: 'x', tone: 'loud' as 'info', active: true, author: 'x' }), 'invalid')
		await refused(createAnnouncement(db, { site: 'site', message: 'x', tone: 'info', startsAt: new Date(now), endsAt: new Date(now), active: true, author: 'x' }), 'invalid')
		await refused(updateAnnouncement(db, 999_999, { site: 'site', message: 'x', tone: 'info', active: true, author: 'x' }), 'not-found')
		await deleteAnnouncement(db, later.id)
		await refused(deleteAnnouncement(db, later.id), 'not-found')
		await reader.close()
	})

	test('two editors: a rule changed or deleted from an old tab is refused, not overwritten', async () => {
		const refused = async (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof ModerationError && error.code === code)
		// Both tabs read the page without a rule; A creates it first.
		const a = await saveModerationRule(db, { site: 'ui', path: '/buttons', action: 'hide', reason: 'A', author: 'A' }, { expectedVersion: null })
		assert.equal(a.version, 1)
		await refused(saveModerationRule(db, { site: 'ui', path: '/buttons', action: 'feature', reason: 'B', author: 'B' }, { expectedVersion: null }), 'conflict')
		// A changes it again; B, still on version 1, can neither change nor delete it.
		const a2 = await saveModerationRule(db, { site: 'ui', path: '/buttons', action: 'hide', reason: 'A2', author: 'A' }, { expectedId: a.id, expectedVersion: 1 })
		assert.equal(a2.version, 2)
		await refused(saveModerationRule(db, { site: 'ui', path: '/buttons', action: 'feature', author: 'B' }, { expectedId: a.id, expectedVersion: 1 }), 'conflict')
		// A version without the id of the rule it belongs to is refused before writing.
		await refused(saveModerationRule(db, { site: 'ui', path: '/buttons', action: 'feature', author: 'B' }, { expectedVersion: 2 }), 'invalid')
		await refused(deleteModerationRule(db, a.id, { expectedVersion: 1 }), 'conflict')
		const kept = (await listModerationRules(db, 'ui')).find((rule) => rule.path === '/buttons')!
		assert.deepEqual([kept.action, kept.reason, kept.version], ['hide', 'A2', 2], 'the newer change survives')
		// After reloading, B deletes from version 2. Deleting again is not-found; changing the deleted
		// rule from its old version is a conflict and does not create it again.
		await deleteModerationRule(db, a.id, { expectedVersion: 2 })
		await refused(deleteModerationRule(db, a.id, { expectedVersion: 2 }), 'not-found')
		await refused(saveModerationRule(db, { site: 'ui', path: '/buttons', action: 'hide', author: 'B' }, { expectedId: a.id, expectedVersion: 2 }), 'conflict')
		assert.deepEqual(
			(await listModerationRules(db, 'ui')).filter((rule) => rule.path === '/buttons'),
			[],
			'an old tab cannot bring a deleted rule back',
		)
	})

	test('two editors: a rule deleted and created again is another rule, even at the same version', async () => {
		const refused = async (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof ModerationError && error.code === code)
		// A reads the rule of /inputs at version 1.
		const old = await saveModerationRule(db, { site: 'ui', path: '/inputs', action: 'hide', reason: 'Antigua', author: 'A' }, { expectedVersion: null, allowUnknown: true })
		// B deletes it and creates a new rule for the same page: version 1 again, another id.
		await deleteModerationRule(db, old.id, { expectedVersion: 1 })
		const recreated = await saveModerationRule(db, { site: 'ui', path: '/inputs', action: 'feature', reason: 'Nueva', author: 'B' }, { expectedVersion: null, allowUnknown: true })
		assert.equal(recreated.version, old.version)
		assert.notEqual(recreated.id, old.id)
		// A saves from its old tab: id and version do not name the rule of the page now.
		await refused(saveModerationRule(db, { site: 'ui', path: '/inputs', action: 'hide', reason: 'Pisada', author: 'A' }, { expectedId: old.id, expectedVersion: 1, allowUnknown: true }), 'conflict')
		await refused(deleteModerationRule(db, old.id, { expectedVersion: 1 }), 'not-found')
		const kept = (await listModerationRules(db, 'ui')).filter((rule) => rule.path === '/inputs')
		assert.deepEqual(
			kept.map((rule) => [rule.id, rule.action, rule.reason, rule.version]),
			[[recreated.id, 'feature', 'Nueva', 1]],
			'the rule of B survives',
		)
		// After reloading, A writes over the rule it now sees.
		const fixed = await saveModerationRule(db, { site: 'ui', path: '/inputs', action: 'hide', reason: 'A sabiendas', author: 'A' }, { expectedId: recreated.id, expectedVersion: 1, allowUnknown: true })
		assert.deepEqual([fixed.id, fixed.version], [recreated.id, 2])
		await deleteModerationRule(db, fixed.id)
	})

	test('two editors: an announcement edited, switched or deleted from an old tab is refused', async () => {
		const refused = async (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof ModerationError && error.code === code)
		const created = await createAnnouncement(db, { site: 'i18n', message: 'Original', tone: 'info', active: true, author: 'A' })
		assert.equal(created.version, 1)
		// A fixes the message; B, from its old tab, switches it off: refused, and the fix stays.
		const fixed = await updateAnnouncement(db, created.id, { site: 'i18n', message: 'Corregido', tone: 'warning', active: true, author: 'A' }, { expectedVersion: 1 })
		assert.equal(fixed.version, 2)
		await refused(setAnnouncementActive(db, created.id, false, { expectedVersion: 1 }), 'conflict')
		await refused(updateAnnouncement(db, created.id, { site: 'i18n', message: 'Original', tone: 'info', active: false, author: 'B' }, { expectedVersion: 1 }), 'conflict')
		await refused(deleteAnnouncement(db, created.id, { expectedVersion: 1 }), 'conflict')
		// Switching it off changes only `active`: the message, tone and author of A stay.
		const off = await setAnnouncementActive(db, created.id, false, { expectedVersion: 2 })
		assert.deepEqual([off.active, off.message, off.tone, off.author, off.version], [false, 'Corregido', 'warning', 'A', 3])
		await refused(setAnnouncementActive(db, created.id, true, { expectedVersion: 2 }), 'conflict')
		await deleteAnnouncement(db, created.id, { expectedVersion: 3 })
		await refused(setAnnouncementActive(db, created.id, true, { expectedVersion: 3 }), 'not-found')
		await refused(updateAnnouncement(db, created.id, { site: 'i18n', message: 'x', tone: 'info', active: true, author: 'B' }, { expectedVersion: 3 }), 'not-found')
		// An announcement created again gets another id: the old tab still names the deleted one.
		const again = await createAnnouncement(db, { site: 'i18n', message: 'Otra vez', tone: 'info', active: true, author: 'B' })
		assert.equal(again.version, 1)
		assert.notEqual(again.id, created.id)
		await refused(updateAnnouncement(db, created.id, { site: 'i18n', message: 'Pisado', tone: 'info', active: true, author: 'A' }, { expectedVersion: 1 }), 'not-found')
		await refused(setAnnouncementActive(db, created.id, false, { expectedVersion: 1 }), 'not-found')
		assert.deepEqual(
			(await listAnnouncements(db, 'i18n')).map((item) => [item.id, item.message, item.active]),
			[[again.id, 'Otra vez', true]],
		)
		await deleteAnnouncement(db, again.id)
	})

	test('twenty newer scheduled announcements do not hide an older one in force (SQL of the reader)', async () => {
		const reader = createModerationReader({ db: () => db, log: () => {} })
		const live = await createAnnouncement(db, { site: 'ui', message: 'Vigente antiguo', tone: 'info', active: true, author: 'x' })
		const start = new Date(Date.now() + 3_600_000)
		for (let index = 0; index < 20; index++) await createAnnouncement(db, { site: 'ui', message: `Programado ${index}`, tone: 'info', startsAt: start, active: true, author: 'x' })
		const shown = (await reader.read('ui')).announcements.map((item) => item.message)
		assert.ok(shown.includes('Vigente antiguo'), `shown: ${shown.join(', ')}`)
		assert.ok(!shown.some((message) => message.startsWith('Programado')))
		await db.query("DELETE FROM docs_announcements WHERE site = 'ui'")
		assert.equal(live.version, 1)
		await reader.close()
	})
})
