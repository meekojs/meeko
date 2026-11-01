// The metrics of the public sites: pure functions without a database, the handlers with a fake
// writer, the degradation without a database, and the writes and aggregations in a temporary schema
// that the test drops (skipped without DATABASE_URL). No metric is written to the tables of the
// database it connects to.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import * as v from 'valibot'

import type { Queryable } from '../src/db/pool'
import type { MetricsWriter } from '../src/metrics/write'

import { deleteFeedback, listFeedbackComments, rangeDays, readMetricsSummary, setFeedbackReviewed } from '../src/db/metrics'
import { migrate } from '../src/db/migrations'
import { createDatabase, type Database } from '../src/db/pool'
import { feedbackHandler, searchHandler, viewHandler } from '../src/metrics/index'
import { feedbackInput, isBotRequest, isSensitiveQuery, metricPath, metricsEnabled, normalizeQuery, searchInput, storedQuery } from '../src/metrics/shared'
import { createMetricsWriter } from '../src/metrics/write'

const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const request = (headers: Record<string, string> = {}) => new Request('http://localhost/api/docs/views', { method: 'POST', headers: { 'user-agent': chrome, ...headers } })

/** A writer that records its calls instead of storing them. */
function fakeWriter(enabled = true): MetricsWriter & { calls: unknown[][] } {
	const calls: unknown[][] = []
	return {
		calls,
		enabled,
		async view(...args) {
			calls.push(['view', ...args])
			return true
		},
		async search(...args) {
			calls.push(['search', ...args])
			return true
		},
		async feedback(...args) {
			calls.push(['feedback', ...args])
			return true
		},
		async close() {},
	}
}

describe('metrics without a database', () => {
	test('queries are trimmed, collapsed, in lowercase and cut; paths lose query, fragment and slash', () => {
		assert.equal(normalizeQuery('  Define   MODEL\n'), 'define model')
		assert.equal(normalizeQuery('   '), '')
		assert.equal(normalizeQuery('x'.repeat(500)).length, 120)
		assert.equal(metricPath('/docs/signal/?a=1#uso'), '/docs/signal')
		assert.equal(metricPath('/'), '/')
		assert.equal(metricPath('https://otro.example/docs'), null)
		assert.equal(metricPath('docs/signal'), null)
		assert.equal(metricPath('/con espacio'), null)
		assert.equal(metricPath('/con%20espacio'), null)
		assert.equal(metricPath(`/${'x'.repeat(600)}`), null)
	})

	test('paths are read as the router reads them: encoded segments and repeated slashes name the same page', () => {
		for (const href of ['/buttons', '/%62uttons', '//buttons', '/buttons/', '///buttons//?x#y', '/%62%75ttons']) assert.equal(metricPath(href), '/buttons', href)
		assert.equal(metricPath('/en//playground'), '/en/playground')
		assert.equal(metricPath('/%65n/%70layground/'), '/en/playground')
		assert.equal(metricPath('/docs//%61pi'), '/docs/api')
		// The router matches nothing with these: nothing to count.
		for (const href of ['/%2Fbuttons', '/%5Cbuttons', '/%2e%2e', '/%', '/docs/%ZZ']) assert.equal(metricPath(href), null, href)
	})

	test('views and feedback of equivalent URLs count as their page, and an alias as the page it names', async () => {
		const writer = fakeWriter()
		// A knownPath like the one of a navigation: canonical pages and aliases.
		const pages = new Map([
			['/buttons', '/buttons'],
			['/playground', '/playground'],
			['/en/playground', '/playground'],
		])
		const knownPath = (path: string) => pages.get(path) ?? false
		const view = viewHandler({ site: 'i18n', knownPath, writer })
		for (const path of ['/%62uttons', '//buttons/', '/en//playground', '/%65n/playground', '/%70layground']) await view({ body: { path }, context: { request: request() } })
		assert.deepEqual(writer.calls, [
			['view', 'i18n', '/buttons'],
			['view', 'i18n', '/buttons'],
			['view', 'i18n', '/playground'],
			['view', 'i18n', '/playground'],
			['view', 'i18n', '/playground'],
		])
		writer.calls.length = 0
		const feedback = feedbackHandler({ site: 'i18n', knownPath, writer })
		assert.deepEqual(await feedback({ body: { path: '/%62uttons', helpful: true, comment: '' }, context: { request: request() } }), { saved: true })
		assert.deepEqual(await feedback({ body: { path: '/en//playground', helpful: false, comment: 'x' }, context: { request: request() } }), { saved: true })
		assert.deepEqual(await feedback({ body: { path: '/%2Fbuttons', helpful: true, comment: '' }, context: { request: request() } }), { saved: false })
		assert.deepEqual(writer.calls, [
			['feedback', 'i18n', { path: '/buttons', helpful: true, comment: '' }],
			['feedback', 'i18n', { path: '/playground', helpful: false, comment: 'x' }],
		])
	})

	test('a query with personal data or a secret is dropped before it is cut, searched, stored or logged', async () => {
		const email = 'ana.garcia@example.com'
		const token = 'Bearer sk_live_51HxExampleOnly0123456789abcdef'
		const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkVqZW1wbG8ifQ.c2lnbmF0dXJhLWRlLWVqZW1wbG8tc29sbw'
		const sensitive = [
			email,
			`como configuro ${email} en el formulario`,
			'ana [at] example [dot] com',
			token,
			'authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l',
			jwt,
			'+34 612 345 678',
			'(555) 123-4567',
			'612345678',
			'4111 1111 1111 1111',
			'https://usuario:clave@example.com/docs',
			'https://example.com/callback?code=abc&state=1',
			'ghp_ExampleOnly0123456789abcdefABCDEF',
			'AKIAIOSFODNN7EXAMPLE',
			'sk-proj-ExampleOnly0123456789abcd',
			'a3f9c2e17b4d8e6f0a1b2c3d4e5f6a7b',
			'550e8400-e29b-41d4-a716-446655440000',
			'x9Kp2LmQ7vRt4ZsW8yNb3HcJ',
			// The secret is past the 120 characters a query keeps: it is checked before cutting.
			`${'define model '.repeat(10)}${email}`,
		]
		for (const query of sensitive) {
			assert.equal(isSensitiveQuery(query), true, query)
			assert.equal(storedQuery(query), '', query)
		}
		const ordinary = ['define model', 'signal', 'useForm', 'createMetricsWriter', 'meeko@1.8.0', '@meekojs/ui', '1.8.0', '2026-10-31', 'token de csrf', 'basic usage', 'basic components', 'bearer', 'api key', 'http://localhost:3000/docs', 'h1 h2 h3', 'MEEK118', 'useState(key, factory)', 'tailwind 4.1', 'defineServerRouteMiddleware']
		for (const query of ordinary) assert.equal(isSensitiveQuery(query), false, query)
		assert.equal(storedQuery('  Define   Model '), 'define model')

		// The handler drops them before counting (the site searches its pages with the query).
		const writer = fakeWriter()
		const counted: string[] = []
		const search = searchHandler({ site: 'site', writer, count: async (query) => (counted.push(query), 1) })
		for (const q of [email, token, jwt]) await search({ body: { q }, context: { request: request() } })
		await searchHandler({ site: 'ui', writer })({ body: { q: jwt, results: 0 }, context: { request: request() } })
		assert.deepEqual([writer.calls, counted], [[], []])

		// The writer refuses them too, without touching the database or logging anything.
		const queries: unknown[][] = []
		const logs: string[] = []
		const fakeDb = { query: async (...args: unknown[]) => (queries.push(args), { rows: [], rowCount: 1 }) } as unknown as Queryable
		const direct = createMetricsWriter({ enabled: true, log: (message) => logs.push(message), db: () => fakeDb })
		for (const query of [email, token, jwt]) assert.equal(await direct.search('site', query, 0), false, query)
		assert.deepEqual([queries, logs], [[], []])
		assert.equal(await direct.search('site', 'Define Model', 2), true)
		assert.deepEqual(
			queries.map(([, values]) => values),
			[['site', 'define model', 2]],
		)
	})

	test('bots, empty user agents, HTTP clients and prefetches are not readers; a browser under test is', () => {
		const headers = (agent: string, extra: Record<string, string> = {}) => new Headers({ ...(agent ? { 'user-agent': agent } : {}), ...extra })
		for (const agent of ['', 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'curl/8.5.0', 'python-requests/2.32', 'facebookexternalhit/1.1', 'Mozilla/5.0 Chrome-Lighthouse']) assert.equal(isBotRequest(headers(agent)), true, agent)
		assert.equal(isBotRequest(headers(chrome)), false)
		assert.equal(isBotRequest(headers('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36')), false)
		assert.equal(isBotRequest(headers(chrome, { 'sec-purpose': 'prefetch;prerender' })), true)
		assert.equal(isBotRequest(headers(chrome, { purpose: 'prefetch' })), true)
	})

	test('DOCS_METRICS turns the collection off', () => {
		assert.equal(metricsEnabled({}), true)
		for (const value of ['off', 'OFF', '0', 'false', 'no']) assert.equal(metricsEnabled({ DOCS_METRICS: value }), false, value)
		assert.equal(metricsEnabled({ DOCS_METRICS: 'on' }), true)
	})

	test('the schemas accept the JSON of the widget and reject what the tables cannot hold', () => {
		assert.deepEqual(v.parse(feedbackInput, { path: '/docs/x', helpful: true }), { path: '/docs/x', helpful: true, comment: '' })
		assert.equal(v.safeParse(feedbackInput, { path: '/docs/x', helpful: true, comment: 'x'.repeat(2001) }).success, false)
		assert.equal(v.safeParse(feedbackInput, { path: 'docs/x', helpful: true }).success, false)
		assert.equal(v.safeParse(feedbackInput, { path: '/docs/x', helpful: 'yes' }).success, false)
		assert.equal(v.safeParse(searchInput, { q: 'x', results: -1 }).success, false)
		assert.equal(v.safeParse(searchInput, { q: 'x', results: 1.5 }).success, false)
	})

	test('the handlers drop bots, prefetches and unknown pages, and the site counts its own results', async () => {
		const writer = fakeWriter()
		const knownPath = (path: string) => path === '/docs/signal'
		const view = viewHandler({ site: 'site', knownPath, writer })
		await view({ body: { path: '/docs/signal#uso' }, context: { request: request() } })
		await view({ body: { path: '/docs/inventada' }, context: { request: request() } })
		await view({ body: { path: '/docs/signal' }, context: { request: request({ 'user-agent': 'Googlebot/2.1' }) } })
		await view({ body: { path: '/docs/signal' }, context: { request: request({ 'sec-purpose': 'prefetch' }) } })
		// A predicate that fails counts as an unknown page.
		await viewHandler({ site: 'site', knownPath: () => Promise.reject(new Error('down')), writer })({ body: { path: '/docs/signal' }, context: { request: request() } })
		assert.deepEqual(writer.calls, [['view', 'site', '/docs/signal']])

		writer.calls.length = 0
		await searchHandler({ site: 'site', writer, count: async (query) => (query === 'nada' ? 0 : 3) })({ body: { q: 'nada', results: 99 }, context: { request: request() } })
		await searchHandler({ site: 'ui', writer })({ body: { q: 'Botón', results: 2 }, context: { request: request() } })
		await searchHandler({ site: 'ui', writer })({ body: { q: 'sin cuenta' }, context: { request: request() } })
		await searchHandler({ site: 'ui', writer: fakeWriter(false) })({ body: { q: 'apagado', results: 1 }, context: { request: request() } })
		assert.deepEqual(writer.calls, [
			['search', 'site', 'nada', 0],
			['search', 'ui', 'Botón', 2],
		])

		writer.calls.length = 0
		const feedback = feedbackHandler({ site: 'i18n', knownPath: (path) => path === '/plurals', writer })
		assert.deepEqual(await feedback({ body: { path: '/plurals', helpful: false, comment: 'Falta un ejemplo' }, context: { request: request() } }), { saved: true })
		assert.deepEqual(await feedback({ body: { path: '/otra', helpful: true, comment: '' }, context: { request: request() } }), { saved: false })
		assert.deepEqual(await feedback({ body: { path: '/plurals', helpful: true, comment: '' }, context: { request: request({ 'user-agent': '' }) } }), { saved: false })
		assert.deepEqual(writer.calls, [['feedback', 'i18n', { path: '/plurals', helpful: false, comment: 'Falta un ejemplo' }]])
	})

	test('without a database, disabled or with one that refuses, the writer stores nothing and never throws', async () => {
		const previous = process.env.DATABASE_URL
		const logs: string[] = []
		try {
			delete process.env.DATABASE_URL
			const none = createMetricsWriter({ log: (message) => logs.push(message) })
			assert.equal(none.enabled, false)
			assert.equal(await none.view('site', '/docs/x'), false)
			assert.equal(await none.feedback('site', { path: '/docs/x', helpful: true }), false)

			process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:9/none'
			const off = createMetricsWriter({ enabled: false, log: (message) => logs.push(message) })
			assert.equal(off.enabled, false)
			assert.equal(await off.view('site', '/docs/x'), false)
			assert.equal(logs.length, 0, 'disabled metrics never touch the database')

			// Port 9 of loopback (discard) has nothing listening: the connection is refused at once.
			const refused = createMetricsWriter({ enabled: true, log: (message) => logs.push(message) })
			const started = Date.now()
			assert.equal(await refused.view('site', '/docs/x'), false)
			assert.equal(await refused.search('site', 'signal', 3), false)
			assert.equal(await refused.feedback('site', { path: '/docs/x', helpful: false, comment: 'x' }), false)
			assert.ok(Date.now() - started < 10_000)
			assert.equal(logs.length, 1, 'one line until the database answers again')
			assert.doesNotMatch(logs[0]!, /nothing@/, 'the password never reaches the log')
			await refused.close()
		} finally {
			if (previous === undefined) delete process.env.DATABASE_URL
			else process.env.DATABASE_URL = previous
		}
	})

	test('ranges are whole UTC days, ordered and at most a year', () => {
		assert.equal(rangeDays('2026-10-01', '2026-10-31'), 31)
		assert.equal(rangeDays('2026-10-31', '2026-10-31'), 1)
		assert.throws(() => rangeDays('2026-10-31', '2026-10-01'), /ends before/)
		assert.throws(() => rangeDays('2026-02-30', '2026-03-01'), /YYYY-MM-DD/)
		assert.throws(() => rangeDays('2024-01-01', '2026-01-01'), /at most 366/)
	})
})

const url = process.env.DATABASE_URL
const schema = `docs_test_${process.pid}_${randomBytes(4).toString('hex')}`

describe('metrics in the database', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	let admin: Database
	let db: Database
	let writer: MetricsWriter

	before(async () => {
		admin = createDatabase({ connectionString: url! })
		await admin.query(`CREATE SCHEMA ${schema}`)
		db = createDatabase({ connectionString: url!, searchPath: schema })
		await migrate(db)
		writer = createMetricsWriter({ db: () => db, enabled: true })
	})

	after(async () => {
		await db?.end()
		await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin?.end()
	})

	test('views are aggregated per page and UTC day; searches and feedback are one normalized row each', async () => {
		const today = (await db.query<{ day: string }>("SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day")).rows[0]!.day
		assert.equal(writer.enabled, true)
		for (let index = 0; index < 3; index++) assert.equal(await writer.view('site', '/docs/signal/'), true)
		await writer.view('ui', '/docs/signal')
		assert.equal(await writer.view('site', 'https://otro.example/'), false)
		const views = await db.query<{ site: string; path: string; day: string; views: string }>("SELECT site, path, to_char(day, 'YYYY-MM-DD') AS day, views FROM docs_page_views ORDER BY site")
		assert.deepEqual(
			views.rows.map((row) => [row.site, row.path, row.day, Number(row.views)]),
			[
				['site', '/docs/signal', today, 3],
				['ui', '/docs/signal', today, 1],
			],
		)

		assert.equal(await writer.search('site', '  SIGNAL  Effect ', 4), true)
		assert.equal(await writer.search('site', '   ', 4), false)
		for (const query of ['ana.garcia@example.com', 'Bearer sk_live_51HxExampleOnly0123456789abcdef', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJhLWRlLWVqZW1wbG8']) assert.equal(await writer.search('site', query, 0), false, query)
		assert.equal((await db.query('SELECT count(*)::int AS n FROM docs_searches')).rows[0].n, 1, 'only the ordinary query is stored')
		assert.equal((await db.query('SELECT query, results FROM docs_searches')).rows[0].query, 'signal effect')
		assert.equal(await writer.feedback('site', { path: '/docs/signal', helpful: true, comment: '   ' }), true)
		assert.equal(await writer.feedback('site', { path: '/docs/signal', helpful: false, comment: 'x'.repeat(2001) }), false)
		const feedback = await db.query('SELECT path, helpful, comment, reviewed_at FROM docs_feedback')
		assert.deepEqual(feedback.rows, [{ path: '/docs/signal', helpful: true, comment: null, reviewed_at: null }])
		await db.query('TRUNCATE docs_page_views, docs_searches, docs_feedback')
	})

	test('the summary fills the days, ranks pages, searches and answers, and keeps the sites apart', async () => {
		await db.query(`INSERT INTO docs_page_views (site, path, day, views) VALUES
			('site', '/docs/signal', '2026-10-01', 5), ('site', '/docs/signal', '2026-10-03', 2), ('site', '/docs/api', '2026-10-03', 4),
			('site', '/docs/old', '2026-09-30', 50), ('ui', '/buttons', '2026-10-02', 9)`)
		await db.query(`INSERT INTO docs_searches (site, query, results, created_at) VALUES
			('site', 'signal', 3, '2026-10-01T10:00:00Z'), ('site', 'signal', 4, '2026-10-02T10:00:00Z'), ('site', 'nada', 0, '2026-10-02T11:00:00Z'),
			('site', 'nada', 0, '2026-10-03T23:59:00Z'), ('site', 'otra', 0, '2026-10-01T09:00:00Z'), ('site', 'fuera', 0, '2026-10-04T00:00:00Z'), ('ui', 'nada', 0, '2026-10-02T00:00:00Z')`)
		await db.query(`INSERT INTO docs_feedback (site, path, helpful, comment, created_at) VALUES
			('site', '/docs/signal', true, NULL, '2026-10-01T10:00:00Z'), ('site', '/docs/signal', false, 'Falta un ejemplo', '2026-10-02T10:00:00Z'),
			('site', '/docs/signal', false, NULL, '2026-10-02T11:00:00Z'), ('site', '/docs/api', true, 'Muy clara', '2026-10-03T10:00:00Z'),
			('ui', '/buttons', false, 'De otra web', '2026-10-02T10:00:00Z')`)
		const summary = await readMetricsSummary(db, { site: 'site', from: '2026-10-01', to: '2026-10-03' })
		assert.deepEqual(summary.daily, [
			{ day: '2026-10-01', views: 5 },
			{ day: '2026-10-02', views: 0 },
			{ day: '2026-10-03', views: 6 },
		])
		assert.deepEqual(summary.totals, { views: 11, searches: 5, emptySearches: 3, helpful: 2, unhelpful: 2 })
		assert.deepEqual(summary.topPages, [
			{ path: '/docs/signal', views: 7 },
			{ path: '/docs/api', views: 4 },
		])
		assert.deepEqual(summary.topSearches, [
			{ query: 'nada', count: 2, results: 0 },
			{ query: 'signal', count: 2, results: 4 },
			{ query: 'otra', count: 1, results: 0 },
		])
		assert.deepEqual(summary.emptySearches, [
			{ query: 'nada', count: 2 },
			{ query: 'otra', count: 1 },
		])
		assert.deepEqual(summary.feedback, [
			{ path: '/docs/signal', helpful: 1, unhelpful: 2, ratio: 1 / 3, comments: 1 },
			{ path: '/docs/api', helpful: 1, unhelpful: 0, ratio: 1, comments: 1 },
		])
		const empty = await readMetricsSummary(db, { site: 'i18n', from: '2026-10-01', to: '2026-10-02' })
		assert.deepEqual([empty.totals.views, empty.daily.length, empty.topPages.length, empty.feedback.length], [0, 2, 0, 0])
		await assert.rejects(readMetricsSummary(db, { site: 'site', from: '2026-10-03', to: '2026-10-01' }), RangeError)
	})

	test('comments are filtered, reviewed, reopened and deleted', async () => {
		const range = { site: 'site' as const, from: '2026-10-01', to: '2026-10-31' }
		const all = await listFeedbackComments(db, range)
		assert.deepEqual(
			all.items.map((item) => [item.path, item.comment, item.reviewedAt]),
			[
				['/docs/api', 'Muy clara', null],
				['/docs/signal', 'Falta un ejemplo', null],
			],
		)
		assert.equal(all.total, 2)
		assert.deepEqual(
			(await listFeedbackComments(db, { ...range, helpful: false })).items.map((item) => item.comment),
			['Falta un ejemplo'],
		)
		assert.deepEqual(
			(await listFeedbackComments(db, { ...range, path: 'API' })).items.map((item) => item.comment),
			['Muy clara'],
		)
		assert.equal((await listFeedbackComments(db, { ...range, limit: 1 })).items.length, 1)

		const target = all.items[1]!
		const reviewed = await setFeedbackReviewed(db, target.id, true, ' ada ')
		assert.ok(reviewed?.reviewedAt instanceof Date)
		assert.equal(reviewed.reviewedBy, 'ada')
		const again = await setFeedbackReviewed(db, target.id, true, 'grace')
		assert.equal(again?.reviewedAt?.getTime(), reviewed.reviewedAt.getTime(), 'reviewing again keeps the date')
		assert.equal(again?.reviewedBy, 'ada', 'and who reviewed it')
		assert.deepEqual(
			(await listFeedbackComments(db, { ...range, status: 'reviewed' })).items.map((item) => item.id),
			[target.id],
		)
		assert.deepEqual(
			(await listFeedbackComments(db, { ...range, status: 'pending' })).items.map((item) => item.comment),
			['Muy clara'],
		)
		const reopened = await setFeedbackReviewed(db, target.id, false, 'grace')
		assert.deepEqual([reopened?.reviewedAt, reopened?.reviewedBy], [null, null])
		assert.equal(await setFeedbackReviewed(db, 999_999, true), null)

		assert.equal(await deleteFeedback(db, target.id), true)
		assert.equal(await deleteFeedback(db, target.id), false)
		assert.deepEqual(
			(await listFeedbackComments(db, range)).items.map((item) => item.comment),
			['Muy clara'],
		)
		await assert.rejects(listFeedbackComments(db, { ...range, limit: 0 }), RangeError)
	})
})
