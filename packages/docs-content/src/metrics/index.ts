// The collection of metrics on the public sites: views, searches and «¿Te sirvió?». It loads `pg`
// and nothing of the render, like `./snapshots`; the readings of the dashboard live in
// `meeko-docs-content/db`. Each site declares its three endpoints with `defineApiRoute` and these
// handlers, so Meeko checks their Origin, their rate limit and their body.
import type { DocsLocale } from '../locale'
import type { FeedbackInput, MetricsSite, SearchInput, ViewInput } from './shared'
import type { MetricsWriter } from './write'

import { isBotRequest, isSensitiveQuery, metricLocalePath, metricPath } from './shared'
import { metricsWriter } from './write'

export type { FeedbackInput, FeedbackSaved, MetricsSite, SearchInput, ViewInput } from './shared'
export type { FeedbackRecord, MetricsWriter, MetricsWriterOptions } from './write'

export { feedbackInput, feedbackSaved, isBotRequest, isSensitiveQuery, metricLocalePath, metricPath, metricsEnabled, metricsLimits, metricsSites, normalizeQuery, searchInput, storedQuery, viewInput } from './shared'
export { createMetricsWriter, metricsWriter } from './write'

/**
 * Rate limits of the collection endpoints, per client IP and route (Meeko keeps only a SHA-256 of
 * them, in memory with `MemorySessionStore`; nothing reaches the database). A reader who browses
 * fast stays far below them; a script that floods an endpoint gets `429`.
 */
export const metricsRateLimits = Object.freeze({
	view: Object.freeze({ limit: 120, window: '1m' }),
	search: Object.freeze({ limit: 30, window: '1m' }),
	feedback: Object.freeze({ limit: 10, window: '10m' }),
})

/** What the handlers of a site need. */
export interface CollectOptions {
	readonly site: MetricsSite
	/**
	 * Whether the site has its pages in several languages, with the English ones under `/en/`:
	 * then a path under `/en/` counts as English, without the prefix. `false` by default, as
	 * before: every path is Spanish as it arrives.
	 */
	readonly localized?: boolean
	/**
	 * Whether `path` is a page of the site, so a request cannot fill the tables with made-up paths:
	 * `true`, or the path of the page it is an alias of (`/en/playground` → `/playground`), which is
	 * the one counted. It receives the path as the router reads it ({@link metricPath}: `/%62uttons`
	 * and `//buttons` arrive as `/buttons`) and, with `localized`, without the language prefix and
	 * with its language. A failure counts as unknown.
	 */
	readonly knownPath: (path: string, locale: DocsLocale) => boolean | string | Promise<boolean | string>
	/** The writer; the one of the process ({@link metricsWriter}) by default. */
	readonly writer?: MetricsWriter
}

interface HandlerArgs<Body> {
	readonly body: Body
	readonly context: { readonly request: Request }
}

async function known(options: CollectOptions, href: string): Promise<{ readonly locale: DocsLocale; readonly path: string } | null> {
	const page = metricLocalePath(href, options.localized)
	if (page === null) return null
	try {
		const answer = await options.knownPath(page.path, page.locale)
		if (answer === true) return page
		const alias = typeof answer === 'string' ? metricPath(answer) : null
		return alias === null ? null : { locale: page.locale, path: alias }
	} catch {
		return null
	}
}

/**
 * Handler of `POST /api/docs/views`: one view of a known page, unless the request is a bot's or a
 * prefetch. Answers `204` in every case, so a beacon never learns whether it was counted.
 *
 * @example
 * ```ts
 * // server/api/docs/views.post.ts
 * export default defineApiRoute({ body: viewInput, status: 204, rateLimit: metricsRateLimits.view, handler: viewHandler({ site: 'ui', knownPath }) })
 * ```
 */
export function viewHandler(options: CollectOptions): (args: HandlerArgs<ViewInput>) => Promise<void> {
	return async ({ body, context }) => {
		if (isBotRequest(context.request.headers)) return
		const page = await known(options, body.path)
		if (page !== null) await (options.writer ?? metricsWriter()).view(options.site, page.path, page.locale)
	}
}

/**
 * Handler of `POST /api/docs/search`: one confirmed search, in the language of `body.locale`
 * (Spanish by default). `count` gives the results of the site's own search in that language; without it, the `results` the browser counted in its local filter are stored. A query
 * that looks like personal data or a secret ({@link isSensitiveQuery}) is dropped here, before it is
 * cut, searched or stored, and nothing about it is logged.
 */
export function searchHandler(options: Omit<CollectOptions, 'knownPath' | 'localized'> & { readonly count?: (query: string, locale: DocsLocale) => Promise<number> }): (args: HandlerArgs<SearchInput>) => Promise<void> {
	return async ({ body, context }) => {
		if (isBotRequest(context.request.headers) || isSensitiveQuery(body.q)) return
		const writer = options.writer ?? metricsWriter()
		if (!writer.enabled) return
		const locale = body.locale ?? 'es'
		let results = body.results
		if (options.count) {
			try {
				results = await options.count(body.q, locale)
			} catch {
				return
			}
		}
		if (results !== undefined) await writer.search(options.site, body.q, results, locale)
	}
}

/**
 * Handler of `POST /api/docs/feedback`, for JSON and for the native form (`303` back to the page):
 * stores the answer about a known page. `saved` is `false` when it was not stored (metrics disabled,
 * no database, a bot or an unknown page), and the widget still thanks the reader.
 */
export function feedbackHandler(options: CollectOptions): (args: HandlerArgs<FeedbackInput>) => Promise<{ saved: boolean }> {
	return async ({ body, context }) => {
		if (isBotRequest(context.request.headers)) return { saved: false }
		const page = await known(options, body.path)
		if (page === null) return { saved: false }
		return { saved: await (options.writer ?? metricsWriter()).feedback(options.site, { path: page.path, locale: page.locale, helpful: body.helpful, comment: body.comment }) }
	}
}
