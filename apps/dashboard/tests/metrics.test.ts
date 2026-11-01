// The metrics screen: the schemas of its RPC without a database, and its service in a temporary
// schema that the test drops at the end (skipped without DATABASE_URL; apps/dashboard/.env is
// loaded). The tables of the database it connects to are never read or written.
import type { Database } from 'meeko-docs-content/db'

import { createDatabase, migrate } from 'meeko-docs-content/db'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import * as v from 'valibot'

import { defaultRange, formatRange, pageWithin, rangeFailure } from '../app/utils/metrics'
import { feedbackPageSize, metricsTask, readFeedback, readMetrics, removeFeedback, reviewFeedback } from '../server/dashboard/metrics'
import { feedbackListInput, isCalendarDay, metricsInput } from '../shared/schemas/metrics'

const app = fileURLToPath(new URL('../', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL
const schema = `dash_met_${process.pid}_${randomBytes(4).toString('hex')}`
const code = (expected: string, status: number) => (error: Error & { code?: string; status?: number }) => error.code === expected && error.status === status

test('the range of the metrics is two ordered days of at most a year', () => {
	assert.equal(v.safeParse(metricsInput, { site: 'site', from: '2026-10-01', to: '2026-10-31' }).success, true)
	assert.equal(v.safeParse(metricsInput, { site: 'site', from: '2026-10-31', to: '2026-10-01' }).success, false)
	assert.equal(v.safeParse(metricsInput, { site: 'site', from: '2025-01-01', to: '2026-10-31' }).success, false)
	assert.equal(v.safeParse(metricsInput, { site: 'web', from: '2026-10-01', to: '2026-10-31' }).success, false)
	assert.equal(v.safeParse(metricsInput, { site: 'site', from: '1/10/2026', to: '2026-10-31' }).success, false)
	assert.deepEqual(v.parse(feedbackListInput, { site: 'ui', from: '2026-10-01', to: '2026-10-31' }), { site: 'ui', from: '2026-10-01', to: '2026-10-31', status: 'all', answer: 'all', path: '', page: 1 })
})

test('a range of the URL with days that are not in the calendar is an error state, not a broken render', () => {
	assert.equal(isCalendarDay('2026-10-31'), true)
	assert.equal(isCalendarDay('2024-02-29'), true)
	for (const value of ['2026-99-99', '2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29', '26-10-01', '']) assert.equal(isCalendarDay(value), false, value)
	assert.equal(v.safeParse(metricsInput, { site: 'site', from: '2026-99-99', to: '2026-99-99' }).success, false)
	assert.equal(v.safeParse(feedbackListInput, { site: 'site', from: '2026-02-30', to: '2026-03-01' }).success, false)
	// The URL of the report: the range is kept so the page says why, and its label does not throw.
	const range = defaultRange('2026-99-99', '2026-99-99')
	assert.deepEqual(range, { from: '2026-99-99', to: '2026-99-99' })
	assert.equal(formatRange(range), 'Rango no válido')
	assert.doesNotThrow(() => formatRange({ from: '2026-10-01', to: '2026-02-30' }))
	assert.deepEqual(rangeFailure('site', range), { code: 'INVALID_RANGE', message: rangeFailure('site', { from: '2026-10-31', to: '2026-10-01' })!.message, detail: 'La fecha no es válida.' })
	assert.equal(rangeFailure('site', { from: '2026-10-31', to: '2026-10-01' })?.code, 'INVALID_RANGE')
	assert.equal(rangeFailure('site', { from: '2026-10-01', to: '2026-10-31' }), null)
	assert.equal(formatRange({ from: '2026-10-01', to: '2026-10-31' }), '1 oct 2026 – 31 oct 2026')
})

test('after a mutation the list of comments shows the last page that still exists', () => {
	// 26 pending, 25 per page: reviewing (or reopening, with «Revisados») the only one of page 2.
	assert.equal(pageWithin(2, 25, 25), 1)
	assert.equal(pageWithin(2, 26, 25), 2)
	assert.equal(pageWithin(3, 51, 25), 3)
	assert.equal(pageWithin(4, 51, 25), 3)
	assert.equal(pageWithin(2, 0, 25), 1)
	assert.equal(pageWithin(0, 10, 25), 1)
})

test('an invalid range that reaches the service is 422 INVALID_RANGE', async () => {
	await assert.rejects(
		metricsTask(() => Promise.reject(new RangeError('The range ends before it starts'))),
		code('INVALID_RANGE', 422),
	)
})

describe('the metrics service', { skip: url ? false : 'DATABASE_URL is not set' }, () => {
	let admin: Database
	let db: Database
	const range = { site: 'site' as const, from: '2026-10-01', to: '2026-10-31' }

	before(async () => {
		admin = createDatabase({ connectionString: url! })
		await admin.query(`CREATE SCHEMA ${schema}`)
		db = createDatabase({ connectionString: url!, searchPath: schema })
		await migrate(db)
		await db.query("INSERT INTO docs_page_views (site, path, day, views) VALUES ('site', '/docs/signal', '2026-10-30', 7)")
		// More comments than a page of the list.
		await db.query(
			`INSERT INTO docs_feedback (site, path, helpful, comment, created_at)
			SELECT 'site', '/docs/signal', n % 2 = 0, 'Comentario ' || n, '2026-10-02T00:00:00Z'::timestamptz + n * interval '1 minute'
			FROM generate_series(1, ${feedbackPageSize + 3}) AS n`,
		)
	})

	after(async () => {
		await db?.end()
		await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin?.end()
	})

	test('the summary and the pages of comments', async () => {
		const summary = await readMetrics(db, range)
		assert.equal(summary.daily.length, 31)
		assert.equal(summary.totals.views, 7)
		assert.equal(summary.totals.helpful + summary.totals.unhelpful, feedbackPageSize + 3)
		const first = await readFeedback(db, { ...range, status: 'all', answer: 'all', path: '', page: 1 })
		assert.deepEqual([first.items.length, first.total, first.pageSize], [feedbackPageSize, feedbackPageSize + 3, feedbackPageSize])
		assert.equal(first.items[0]?.comment, `Comentario ${feedbackPageSize + 3}`, 'newest first')
		const second = await readFeedback(db, { ...range, status: 'all', answer: 'all', path: '', page: 2 })
		assert.equal(second.items.length, 3)
		const unhelpful = await readFeedback(db, { ...range, status: 'all', answer: 'unhelpful', path: 'SIGNAL', page: 1 })
		assert.ok(unhelpful.items.every((item) => !item.helpful) && unhelpful.total > 0)
	})

	test('review, reopen and delete, and a comment that no longer exists is 404', async () => {
		const [item] = (await readFeedback(db, { ...range, status: 'pending', answer: 'all', path: '', page: 1 })).items
		assert.ok(item)
		const reviewed = await reviewFeedback(db, item.id, true, 'admin')
		assert.equal(typeof reviewed.reviewedAt, 'string')
		assert.equal(reviewed.reviewedBy, 'admin', 'signed by the user of the session')
		assert.equal((await readFeedback(db, { ...range, status: 'reviewed', answer: 'all', path: '', page: 1 })).items[0]?.id, item.id)
		assert.equal((await reviewFeedback(db, item.id, false)).reviewedAt, null)
		assert.deepEqual(await removeFeedback(db, item.id), { id: item.id })
		await assert.rejects(removeFeedback(db, item.id), code('FEEDBACK_NOT_FOUND', 404))
		await assert.rejects(reviewFeedback(db, item.id, true), code('FEEDBACK_NOT_FOUND', 404))
	})
})
