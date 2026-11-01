// The public contract of the metrics screen: views per day, the most viewed pages, the searches and
// the «¿Te sirvió?» answers of a web in a range of UTC days, and the comments of the readers.
import * as v from 'valibot'

import { siteSchema } from './dashboard'

const id = v.pipe(v.number(), v.integer(), v.minValue(1))
/**
 * Whether `value` is a day of the calendar as `YYYY-MM-DD`: `2026-02-30` or `2026-99-99` have the
 * shape of a day but are not one.
 *
 * @example
 * ```ts
 * isCalendarDay('2026-10-31') // true
 * isCalendarDay('2026-02-30') // false
 * ```
 */
export function isCalendarDay(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
	const date = new Date(`${value}T00:00:00Z`)
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** A UTC day of the calendar as `YYYY-MM-DD`. */
const day = v.pipe(v.string(), v.check(isCalendarDay, 'La fecha no es válida.'))

/** Longest range the screen asks for, in days (meeko-docs-content `maxMetricsDays`). */
export const maxRangeDays = 366

/** A web and a range of UTC days, both included. */
export const metricsInput = v.pipe(
	v.object({ site: siteSchema, from: day, to: day }),
	v.check((input) => input.from <= input.to, 'La fecha inicial es posterior a la final.'),
	v.check((input) => (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000 < maxRangeDays, `El rango abarca como mucho ${maxRangeDays} días.`),
)

export const metricsSummarySchema = v.object({
	site: siteSchema,
	from: v.string(),
	to: v.string(),
	totals: v.object({ views: v.number(), searches: v.number(), emptySearches: v.number(), helpful: v.number(), unhelpful: v.number() }),
	daily: v.array(v.object({ day: v.string(), views: v.number() })),
	topPages: v.array(v.object({ path: v.string(), views: v.number() })),
	topSearches: v.array(v.object({ query: v.string(), count: v.number(), results: v.number() })),
	emptySearches: v.array(v.object({ query: v.string(), count: v.number() })),
	feedback: v.array(v.object({ path: v.string(), helpful: v.number(), unhelpful: v.number(), ratio: v.number(), comments: v.number() })),
})

export const feedbackStatusSchema = v.picklist(['all', 'pending', 'reviewed'])
export const feedbackAnswerSchema = v.picklist(['all', 'helpful', 'unhelpful'])

/** The comments of a web in a range, filtered and paged. */
export const feedbackListInput = v.pipe(
	v.object({
		site: siteSchema,
		from: day,
		to: day,
		status: v.optional(feedbackStatusSchema, 'all'),
		answer: v.optional(feedbackAnswerSchema, 'all'),
		path: v.optional(v.pipe(v.string(), v.maxLength(512)), ''),
		page: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(10_000)), 1),
	}),
	v.check((input) => input.from <= input.to, 'La fecha inicial es posterior a la final.'),
)

export const feedbackCommentSchema = v.object({
	id: v.number(),
	site: siteSchema,
	path: v.string(),
	helpful: v.boolean(),
	comment: v.string(),
	createdAt: v.string(),
	reviewedAt: v.nullable(v.string()),
	/** Who marked it as reviewed; `null` while it waits or for comments reviewed before F5. */
	reviewedBy: v.nullable(v.string()),
})

export const feedbackListSchema = v.object({
	items: v.array(feedbackCommentSchema),
	total: v.number(),
	page: v.number(),
	pageSize: v.number(),
})

export const feedbackReviewInput = v.object({ id, reviewed: v.boolean() })
export const feedbackIdInput = v.object({ id })
export const feedbackDeletedSchema = v.object({ id: v.number() })

export type MetricsInput = v.InferOutput<typeof metricsInput>
export type MetricsSummaryView = v.InferOutput<typeof metricsSummarySchema>
export type FeedbackListInput = v.InferOutput<typeof feedbackListInput>
export type FeedbackCommentRow = v.InferOutput<typeof feedbackCommentSchema>
export type FeedbackList = v.InferOutput<typeof feedbackListSchema>
