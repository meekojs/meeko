// The metrics screen: the readings of meeko-docs-content in the shapes of shared/schemas/metrics.ts,
// and the review and deletion of the comments. A comment that no longer exists is `404
// FEEDBACK_NOT_FOUND`; an invalid range is `422 INVALID_RANGE`.
import type { FeedbackComment, Queryable } from 'meeko-docs-content/db'

import { ApiError } from '@meekojs/meeko/server'
import { deleteFeedback, listFeedbackComments, readMetricsSummary, setFeedbackReviewed } from 'meeko-docs-content/db'

import type { FeedbackCommentRow, FeedbackList, FeedbackListInput, MetricsInput, MetricsSummaryView } from '../../shared/schemas/metrics'

import { databaseTask } from './errors'

/** Comments per page of the list. */
export const feedbackPageSize = 25

const row = (item: FeedbackComment): FeedbackCommentRow => ({
	id: item.id,
	site: item.site,
	locale: item.locale,
	path: item.path,
	helpful: item.helpful,
	comment: item.comment,
	createdAt: item.createdAt.toISOString(),
	reviewedAt: item.reviewedAt?.toISOString() ?? null,
	reviewedBy: item.reviewedBy,
})

/** Runs a reading of the metrics with an invalid range as `422 INVALID_RANGE`. */
export function metricsTask<T>(task: () => Promise<T>): Promise<T> {
	return databaseTask(async () => {
		try {
			return await task()
		} catch (error) {
			if (error instanceof RangeError) throw new ApiError('INVALID_RANGE', 422, { message: error.message, issues: [{ path: '', message: error.message }] })
			throw error
		}
	})
}

/** What the screen shows of a web in a range of UTC days, in one language or (without `locale`) all. */
export async function readMetrics(db: Queryable, input: MetricsInput): Promise<MetricsSummaryView> {
	const summary = await readMetricsSummary(db, { site: input.site, from: input.from, to: input.to, ...(input.locale ? { locale: input.locale } : {}) })
	return { ...summary, daily: [...summary.daily], topPages: [...summary.topPages], topSearches: [...summary.topSearches], emptySearches: [...summary.emptySearches], feedback: [...summary.feedback] }
}

/** A page of the comments of a web in a range, newest first. */
export async function readFeedback(db: Queryable, input: FeedbackListInput): Promise<FeedbackList> {
	const list = await listFeedbackComments(db, {
		site: input.site,
		from: input.from,
		to: input.to,
		...(input.locale ? { locale: input.locale } : {}),
		status: input.status,
		...(input.answer === 'all' ? {} : { helpful: input.answer === 'helpful' }),
		...(input.path.trim() ? { path: input.path } : {}),
		limit: feedbackPageSize,
		offset: (input.page - 1) * feedbackPageSize,
	})
	return { items: list.items.map(row), total: list.total, page: input.page, pageSize: feedbackPageSize }
}

/** Marks a comment as reviewed by `reviewer` (the user of the session), or as waiting again. */
export async function reviewFeedback(db: Queryable, id: number, reviewed: boolean, reviewer: string | null = null): Promise<FeedbackCommentRow> {
	const updated = await setFeedbackReviewed(db, id, reviewed, reviewer)
	if (!updated) throw new ApiError('FEEDBACK_NOT_FOUND', 404, `Feedback ${id} does not exist`)
	return row(updated)
}

/** Deletes a feedback answer with its comment. */
export async function removeFeedback(db: Queryable, id: number): Promise<{ id: number }> {
	if (!(await deleteFeedback(db, id))) throw new ApiError('FEEDBACK_NOT_FOUND', 404, `Feedback ${id} does not exist`)
	return { id }
}
