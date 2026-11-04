import type { DocsLocale } from '../locale'
import type { MetricsSite } from '../metrics/shared'
import type { Queryable } from './pool'

import { checkLocale } from '../locale'

/** A range of UTC days, both included, as `YYYY-MM-DD`. */
export interface MetricsRange {
	readonly site: MetricsSite
	readonly from: string
	readonly to: string
	/** Only the metrics of this language; every language by default. */
	readonly locale?: DocsLocale | undefined
}

/** The views of one UTC day; days without views are `0`. */
export interface DailyViews {
	readonly day: string
	readonly views: number
}

/** A query and how often it was searched in the range. */
export interface SearchCount {
	readonly query: string
	readonly count: number
	/** Results of its latest search. */
	readonly results: number
}

/** The «¿Te sirvió?» answers of one page in the range. */
export interface PageFeedback {
	readonly path: string
	readonly locale: DocsLocale
	readonly helpful: number
	readonly unhelpful: number
	/** Share of «Sí» among the answers, from 0 to 1. */
	readonly ratio: number
	readonly comments: number
}

/** What the dashboard shows of a site in a range. */
export interface MetricsSummary {
	readonly site: MetricsSite
	readonly from: string
	readonly to: string
	/** The language it is limited to, or `null` for every language. */
	readonly locale: DocsLocale | null
	readonly totals: { readonly views: number; readonly searches: number; readonly emptySearches: number; readonly helpful: number; readonly unhelpful: number }
	readonly daily: readonly DailyViews[]
	/** By page and language: a page viewed in both languages appears twice. */
	readonly topPages: readonly { readonly path: string; readonly locale: DocsLocale; readonly views: number }[]
	readonly topSearches: readonly SearchCount[]
	/** The queries that found nothing, most frequent first. */
	readonly emptySearches: readonly { readonly query: string; readonly count: number }[]
	readonly feedback: readonly PageFeedback[]
}

/** Which comments to list: waiting for review, reviewed or all. */
export type FeedbackStatus = 'all' | 'pending' | 'reviewed'

/** Filter of {@link listFeedbackComments}. */
export interface FeedbackFilter extends MetricsRange {
	readonly status?: FeedbackStatus
	/** Only answers that said it helped (`true`) or did not (`false`). */
	readonly helpful?: boolean
	/** Text the path must contain. */
	readonly path?: string
	readonly limit?: number
	readonly offset?: number
}

/** A comment of a reader with its answer and page. */
export interface FeedbackComment {
	readonly id: number
	readonly site: MetricsSite
	readonly locale: DocsLocale
	readonly path: string
	readonly helpful: boolean
	readonly comment: string
	readonly createdAt: Date
	readonly reviewedAt: Date | null
	/** Who marked it as reviewed (migration 005); `null` while it waits or when nobody signed it. */
	readonly reviewedBy: string | null
}

/** Longest range of {@link readMetricsSummary}, in days. */
export const maxMetricsDays = 366

const dayPattern = /^\d{4}-\d{2}-\d{2}$/

/** The number of days of a range, or throws `RangeError` for an invalid one. */
export function rangeDays(from: string, to: string): number {
	if (!dayPattern.test(from) || !dayPattern.test(to)) throw new RangeError('A range is two days as YYYY-MM-DD')
	const start = Date.parse(`${from}T00:00:00Z`)
	const end = Date.parse(`${to}T00:00:00Z`)
	if (Number.isNaN(start) || Number.isNaN(end) || new Date(start).toISOString().slice(0, 10) !== from || new Date(end).toISOString().slice(0, 10) !== to) throw new RangeError('A range is two days as YYYY-MM-DD')
	const days = Math.round((end - start) / 86_400_000) + 1
	if (days < 1) throw new RangeError('The range ends before it starts')
	if (days > maxMetricsDays) throw new RangeError(`A range spans at most ${maxMetricsDays} days`)
	return days
}

const listLimit = 20

/**
 * The metrics of a site in a range of UTC days, in one language or in all (`range.locale`): views per day (every day, `0` without views), the
 * most viewed pages, the most frequent searches and those without results, and the «¿Te sirvió?»
 * answers per page, with the least useful first among the pages with most answers.
 */
export async function readMetricsSummary(db: Queryable, range: MetricsRange): Promise<MetricsSummary> {
	rangeDays(range.from, range.to)
	const locale = range.locale === undefined ? null : checkLocale(range.locale)
	const values = [range.site, range.from, range.to, locale]
	// Searches and feedback are stored with their instant; a day of the range is a UTC day. `$4` is
	// the language, or NULL for all of them.
	const window = `created_at >= $2::date AT TIME ZONE 'UTC' AND created_at < ($3::date + 1) AT TIME ZONE 'UTC' AND ($4::text IS NULL OR locale = $4)`
	const [daily, pages, searches, empty, feedback, totals] = await Promise.all([
		db.query<{ day: string; views: string }>(
			`SELECT to_char(d.day, 'YYYY-MM-DD') AS day, coalesce(sum(v.views), 0) AS views
			FROM generate_series($2::date, $3::date, interval '1 day') AS d(day)
			LEFT JOIN docs_page_views AS v ON v.site = $1 AND v.day = d.day::date AND ($4::text IS NULL OR v.locale = $4)
			GROUP BY d.day ORDER BY d.day`,
			values,
		),
		db.query<{ path: string; locale: DocsLocale; views: string }>(
			`SELECT path, locale, sum(views) AS views FROM docs_page_views WHERE site = $1 AND day BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR locale = $4)
			GROUP BY path, locale ORDER BY sum(views) DESC, path, locale LIMIT ${listLimit}`,
			values,
		),
		db.query<{ query: string; count: string; results: number }>(
			`SELECT query, count(*) AS count, (array_agg(results ORDER BY created_at DESC, id DESC))[1] AS results
			FROM docs_searches WHERE site = $1 AND ${window} GROUP BY query ORDER BY count(*) DESC, query LIMIT ${listLimit}`,
			values,
		),
		db.query<{ query: string; count: string }>(`SELECT query, count(*) AS count FROM docs_searches WHERE site = $1 AND results = 0 AND ${window} GROUP BY query ORDER BY count(*) DESC, query LIMIT ${listLimit}`, values),
		db.query<{ path: string; locale: DocsLocale; helpful: string; unhelpful: string; comments: string }>(
			`SELECT path, locale, count(*) FILTER (WHERE helpful) AS helpful, count(*) FILTER (WHERE NOT helpful) AS unhelpful, count(comment) AS comments
			FROM docs_feedback WHERE site = $1 AND ${window} GROUP BY path, locale
			ORDER BY count(*) DESC, count(*) FILTER (WHERE helpful)::float / count(*), path, locale LIMIT 50`,
			values,
		),
		db.query<{ searches: string; empty: string; helpful: string; unhelpful: string }>(
			`SELECT (SELECT count(*) FROM docs_searches WHERE site = $1 AND ${window}) AS searches,
				(SELECT count(*) FROM docs_searches WHERE site = $1 AND results = 0 AND ${window}) AS empty,
				(SELECT count(*) FROM docs_feedback WHERE site = $1 AND helpful AND ${window}) AS helpful,
				(SELECT count(*) FROM docs_feedback WHERE site = $1 AND NOT helpful AND ${window}) AS unhelpful`,
			values,
		),
	])
	const days = daily.rows.map((row) => ({ day: row.day, views: Number(row.views) }))
	const total = totals.rows[0]!
	return {
		site: range.site,
		from: range.from,
		to: range.to,
		locale,
		totals: { views: days.reduce((sum, row) => sum + row.views, 0), searches: Number(total.searches), emptySearches: Number(total.empty), helpful: Number(total.helpful), unhelpful: Number(total.unhelpful) },
		daily: days,
		topPages: pages.rows.map((row) => ({ path: row.path, locale: row.locale, views: Number(row.views) })),
		topSearches: searches.rows.map((row) => ({ query: row.query, count: Number(row.count), results: Number(row.results) })),
		emptySearches: empty.rows.map((row) => ({ query: row.query, count: Number(row.count) })),
		feedback: feedback.rows.map((row) => {
			const helpful = Number(row.helpful)
			const unhelpful = Number(row.unhelpful)
			return { path: row.path, locale: row.locale, helpful, unhelpful, ratio: helpful / (helpful + unhelpful), comments: Number(row.comments) }
		}),
	}
}

interface CommentRow {
	id: string
	site: MetricsSite
	locale: DocsLocale
	path: string
	helpful: boolean
	comment: string
	created_at: Date
	reviewed_at: Date | null
	reviewed_by: string | null
}

function comment(row: CommentRow): FeedbackComment {
	return { id: Number(row.id), site: row.site, locale: row.locale, path: row.path, helpful: row.helpful, comment: row.comment, createdAt: row.created_at, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by }
}

const commentColumns = 'id, site, locale, path, helpful, comment, created_at, reviewed_at, reviewed_by'

/** The comments of a site in a range, newest first, with how many match the filter in total. */
export async function listFeedbackComments(db: Queryable, filter: FeedbackFilter): Promise<{ readonly items: readonly FeedbackComment[]; readonly total: number }> {
	rangeDays(filter.from, filter.to)
	const limit = filter.limit ?? 50
	const offset = filter.offset ?? 0
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new RangeError('The limit is an integer from 1 to 200')
	if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('The offset is a non-negative integer')
	const status = filter.status ?? 'all'
	const pathText = filter.path?.trim().toLowerCase() || null
	const where = `site = $1 AND comment IS NOT NULL
		AND created_at >= $2::date AT TIME ZONE 'UTC' AND created_at < ($3::date + 1) AT TIME ZONE 'UTC'
		AND ($4::text = 'all' OR ($4 = 'pending' AND reviewed_at IS NULL) OR ($4 = 'reviewed' AND reviewed_at IS NOT NULL))
		AND ($5::boolean IS NULL OR helpful = $5)
		AND ($6::text IS NULL OR strpos(lower(path), $6) > 0)
		AND ($7::text IS NULL OR locale = $7)`
	const values = [filter.site, filter.from, filter.to, status, filter.helpful ?? null, pathText, filter.locale === undefined ? null : checkLocale(filter.locale)]
	const [rows, count] = await Promise.all([
		db.query<CommentRow>(`SELECT ${commentColumns} FROM docs_feedback WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, values),
		db.query<{ total: string }>(`SELECT count(*) AS total FROM docs_feedback WHERE ${where}`, values),
	])
	return { items: rows.rows.map(comment), total: Number(count.rows[0]!.total) }
}

/**
 * Marks a comment as reviewed by `reviewer`, or as waiting again; `null` when it does not exist. A
 * comment already reviewed keeps its date and who reviewed it.
 */
export async function setFeedbackReviewed(db: Queryable, id: number, reviewed: boolean, reviewer: string | null = null): Promise<FeedbackComment | null> {
	const by = reviewer?.trim().slice(0, 200) || null
	// Both assignments read the row before the update, so a second review changes neither.
	const result = await db.query<CommentRow>(
		`UPDATE docs_feedback SET reviewed_at = CASE WHEN $2 THEN coalesce(reviewed_at, now()) ELSE NULL END,
			reviewed_by = CASE WHEN $2 THEN CASE WHEN reviewed_at IS NULL THEN $3 ELSE reviewed_by END ELSE NULL END
		WHERE id = $1 AND comment IS NOT NULL RETURNING ${commentColumns}`,
		[id, reviewed, by],
	)
	const row = result.rows[0]
	return row ? comment(row) : null
}

/** Deletes a feedback answer with its comment; `false` when it did not exist. */
export async function deleteFeedback(db: Queryable, id: number): Promise<boolean> {
	const result = await db.query('DELETE FROM docs_feedback WHERE id = $1', [id])
	return (result.rowCount ?? 0) > 0
}
