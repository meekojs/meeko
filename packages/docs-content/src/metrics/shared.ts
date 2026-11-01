// What the public sites and the dashboard share about the metrics of the documentation: the limits,
// the normalization of a query and of a path, the detection of evident bots and the schemas of the
// collection endpoints. It depends on Valibot only, so the browser imports it too.
import * as v from 'valibot'

import type { DocsLocale } from '../locale'

import { docsLocales, splitLocalePath } from '../locale'
import { routePath } from '../moderation/shared'

/** A public site whose metrics are collected. */
export type MetricsSite = 'i18n' | 'site' | 'ui'

/** The sites in display order. */
export const metricsSites: readonly MetricsSite[] = ['site', 'ui', 'i18n']

/**
 * Limits of what is stored, the same as the CHECK constraints of `docs_feedback`, `docs_searches` and
 * `docs_page_views`: a query is cut to `query` characters, a comment holds at most `comment`.
 */
export const metricsLimits = Object.freeze({ query: 120, comment: 2000, path: 512, results: 10_000 })

/**
 * A search query as it is stored and counted: trimmed, its whitespace collapsed, in lowercase and cut
 * to {@link metricsLimits}.query characters. `''` when nothing is left, which is never stored.
 *
 * @example
 * ```ts
 * normalizeQuery('  Define   Model ') // 'define model'
 * ```
 */
export function normalizeQuery(query: string): string {
	return query.replace(/\s+/g, ' ').trim().toLocaleLowerCase('es').slice(0, metricsLimits.query).trim()
}

/** Things a reader may paste by mistake into a search box that are personal data or secrets. */
const sensitivePatterns: readonly RegExp[] = [
	// An email address (a top-level domain of letters, so `meeko@1.8.0` is not one), also as `[at]`.
	/[^\s@]+@[^\s@]+\.[a-z]{2,}(?![\w-])/i,
	/[\w.+-]+\s*[[(]\s*at\s*[\])]\s*[\w-]+\s*(?:\.|[[(]\s*dot\s*[\])])/i,
	// A URL with credentials (`https://user:pass@host`) or with a secret in its query.
	/[a-z][a-z0-9+.-]*:\/\/[^\s/@]+@/i,
	/[?&](?:access_token|api_?key|auth|client_secret|code|key|password|passwd|pwd|secret|sig|signature|token)=/i,
	// An authorization header or its value: `Bearer …`, or `Basic`/`Token` with a key that has digits.
	/\bauthorization\s*:/i,
	/\bbearer\s+\S{8,}/i,
	/\b(?:basic|token)\s+(?=[\w+/=.~-]*\d)[\w+/=.~-]{12,}/i,
	// A JSON Web Token: three base64url parts, the first one a JSON object (`eyJ`).
	/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/,
	// Keys of well-known providers.
	/\b(?:sk|pk|rk)[-_](?:(?:live|test|proj)[-_])?[A-Za-z0-9]{12,}/,
	/\b(?:ghp|gho|ghu|ghs|ghr|github_pat|npm|hf)_[A-Za-z0-9_]{16,}/,
	/\b(?:glpat|xox[abposr])-[\w-]{10,}/,
	/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
	/\bAIza[\w-]{30,}/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

/** Shannon entropy, in bits per character, of `text`. */
function entropy(text: string): number {
	const counts = new Map<string, number>()
	for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1)
	let bits = 0
	for (const count of counts.values()) {
		const share = count / text.length
		bits -= share * Math.log2(share)
	}
	return bits
}

/**
 * Whether a word looks like a secret: at least 20 characters of a key alphabet (letters, digits and
 * `_-+/=.`), with letters and digits mixed and a high entropy. Names of the API (`createMetricsWriter`)
 * have no digits; a version or a date is short.
 */
function randomLooking(word: string): boolean {
	if (word.length < 20 || !/^[\w+/=.~-]+$/.test(word) || !/\d/.test(word) || !/[a-z]/i.test(word)) return false
	return entropy(word) >= (/^[\da-f-]+$/i.test(word) ? 3 : 3.5)
}

/**
 * Whether a search query looks like personal data or a secret pasted by mistake, so it must not be
 * stored: an email, a phone number, a URL with credentials or with a secret in its query, a Bearer
 * or Basic token, an API key, a JWT, a private key or any long string of high entropy. It is checked
 * on the whole query, before {@link normalizeQuery} cuts it, and nothing about it is logged.
 *
 * @example
 * ```ts
 * isSensitiveQuery('define model') // false
 * isSensitiveQuery('ana@example.com') // true
 * isSensitiveQuery('Bearer abc123def456ghi789') // true
 * ```
 */
export function isSensitiveQuery(query: string): boolean {
	if (sensitivePatterns.some((pattern) => pattern.test(query))) return true
	// A phone or card number: a run of digits, spaces, dots, dashes and parentheses with nine digits
	// or more, or seven with a `+` or the spaces and parentheses of a phone. A date or a version
	// (`2026-10-31`, `1.8.0`) is not one.
	for (const run of query.match(/\+?[\d(][\d\s().-]{5,}\d/g) ?? []) {
		const digits = run.replace(/\D/g, '').length
		if (digits >= 9 || (digits >= 7 && /^\+|[\s()]/.test(run))) return true
	}
	return query.split(/[\s"'`,;:<>()[\]{}]+/).some(randomLooking)
}

/**
 * The query to store for `query`, or `''` when nothing must be stored: empty, or personal data or a
 * secret ({@link isSensitiveQuery}, checked before the query is cut).
 *
 * @example
 * ```ts
 * storedQuery('  Define Model ') // 'define model'
 * storedQuery('ana@example.com') // ''
 * ```
 */
export function storedQuery(query: string): string {
	return isSensitiveQuery(query) ? '' : normalizeQuery(query)
}

/**
 * Whether the metrics are collected according to `env`: always, unless `DOCS_METRICS` is `off`,
 * `0`, `false` or `no`. Without `DATABASE_URL` nothing is stored anyway.
 *
 * @example
 * ```ts
 * metricsEnabled({ DOCS_METRICS: 'off' }) // false
 * ```
 */
export function metricsEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
	const value = env.DOCS_METRICS?.trim().toLowerCase()
	return !(value === 'off' || value === '0' || value === 'false' || value === 'no')
}

const pathPattern = /^\/[^?#\s]*$/

/**
 * The page that `href` reaches as the metrics name it: the path the router of Meeko matches, with
 * its normalization ({@link routePath} of the moderation), so `/docs/api/?x#y`, `/docs//api` and
 * `/docs/%61pi` are all `/docs/api`. `null` when it is not a path of the site (`https://…`, a
 * relative path), the router matches nothing with it, it has spaces or it is longer than
 * {@link metricsLimits}.path.
 *
 * @example
 * ```ts
 * metricPath('/docs/signal/#uso') // '/docs/signal'
 * metricPath('/en//playground') // '/en/playground'
 * metricPath('https://otro.example/') // null
 * ```
 */
export function metricPath(href: string): string | null {
	if (!href.startsWith('/') || href.length > metricsLimits.path * 2) return null
	const path = routePath(href)
	if (path === null || !pathPattern.test(path) || path.length > metricsLimits.path) return null
	return path
}

/**
 * User agents that are evidently not a reader: crawlers, link previews, monitors and HTTP clients.
 * A browser driven by a test (Playwright's Chrome) is a reader for this purpose.
 */
const botAgent = /bot\b|bot\/|crawl|spider|slurp|scrap|archiver|facebookexternalhit|embedly|preview|lighthouse|pingdom|uptime|monitor|curl\/|wget\/|python-|httpclient|go-http-client|node-fetch|axios\/|okhttp|java\//i

/**
 * Whether a request is evidently not a reader's: an empty or bot user agent, or a prefetch or
 * prerender that nobody may ever see (`Sec-Purpose`, `Purpose`, `X-Moz`).
 *
 * @example
 * ```ts
 * isBotRequest(new Headers({ 'user-agent': 'Googlebot/2.1' })) // true
 * ```
 */
export function isBotRequest(headers: { get(name: string): string | null }): boolean {
	const agent = headers.get('user-agent')?.trim() ?? ''
	if (!agent || botAgent.test(agent)) return true
	const purpose = `${headers.get('sec-purpose') ?? ''} ${headers.get('purpose') ?? ''} ${headers.get('x-moz') ?? ''}`.toLowerCase()
	return /prefetch|prerender/.test(purpose)
}

/**
 * The page that `href` reaches and its language: with `localized`, a public URL under `/en/` is
 * English and its path loses the prefix (`/en/docs/api` → `en`, `/docs/api`); otherwise, and for any
 * other URL, it is Spanish. The path is normalized as {@link metricPath} does; `null` when it is not
 * a path of the site.
 */
export function metricLocalePath(href: string, localized = false): { readonly locale: DocsLocale; readonly path: string } | null {
	const path = metricPath(href)
	if (path === null) return null
	if (!localized) return { locale: 'es', path }
	return splitLocalePath(path)
}

const path = v.pipe(v.string(), v.maxLength(metricsLimits.path * 2), v.startsWith('/'))

/** Body of `POST /api/docs/views`: the page shown. */
export const viewInput = v.object({ path })

/**
 * Body of `POST /api/docs/search`: the query, the language of the page (Spanish by default) and,
 * for the local filter of ui and i18n, how many pages it matched. The site counts the results of its own search and ignores `results`.
 */
export const searchInput = v.object({
	q: v.pipe(v.string(), v.maxLength(1000)),
	/** The language of the page that searched; Spanish when absent. */
	locale: v.optional(v.picklist(docsLocales)),
	results: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(metricsLimits.results))),
})

/**
 * Body of `POST /api/docs/feedback`, as JSON or as a native form (`helpful` arrives as `"true"`):
 * the page, whether it helped and an optional comment of up to 2000 characters.
 */
export const feedbackInput = v.object({
	path,
	helpful: v.boolean('Elige «Sí» o «No».'),
	comment: v.optional(v.pipe(v.string(), v.maxLength(metricsLimits.comment, `Usa como mucho ${metricsLimits.comment} caracteres.`)), ''),
})

/** Answer of `POST /api/docs/feedback`: whether it was stored (`false` without a database). */
export const feedbackSaved = v.object({ saved: v.boolean() })

export type ViewInput = v.InferOutput<typeof viewInput>
export type SearchInput = v.InferOutput<typeof searchInput>
export type FeedbackInput = v.InferOutput<typeof feedbackInput>
export type FeedbackSaved = v.InferOutput<typeof feedbackSaved>
