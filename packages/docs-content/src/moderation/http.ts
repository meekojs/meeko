import { createHash } from 'node:crypto'

import type { DocsLocale } from '../locale'
import type { ModerationSite } from './shared'

import { readSiteModeration } from './read'
import { withoutDismissed } from './shared'

/**
 * A moderated text document (`/sitemap.xml`, `/llms.txt`, `/llms-full.txt`) that a browser or a CDN
 * may keep but must revalidate on every use (`no-cache`), with a weak `ETag` of its body: a
 * revalidation that finds the same body answers `304` without it. So the only stale time is the
 * one of the moderation reader (30 s), never that plus an HTTP freshness on top.
 *
 * @example
 * ```ts
 * return revalidatedDocument(request, text, 'text/plain; charset=utf-8')
 * ```
 */
export function revalidatedDocument(request: Request, body: string, contentType: string): Response {
	const etag = `W/"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`
	const headers = { 'content-type': contentType, 'cache-control': 'public, no-cache', etag }
	const known = request.headers.get('if-none-match')
	if (known !== null && known.split(',').some((tag) => tag.trim() === etag || tag.trim() === '*')) return new Response(null, { status: 304, headers })
	return new Response(request.method === 'HEAD' ? null : body, { headers })
}

/**
 * The answer of the moderation endpoint of a site in a language ({@link moderationEndpoint}; Spanish
 * by default): its moderation as JSON, without the announcements that the cookie of `request` closed, never stored by a cache. The
 * browser asks for it after every navigation, so a long session sees the rules and announcements of
 * the dashboard within the 30 s of the reader. Never throws: without a database it is the empty
 * moderation.
 *
 * @example
 * ```ts
 * if (url.pathname === moderationEndpoint('site')) return moderationResponse('site', request)
 * ```
 */
export async function moderationResponse(site: ModerationSite, request: Request, options: { readonly locale?: DocsLocale } = {}): Promise<Response> {
	const moderation = withoutDismissed(await readSiteModeration(site, options), request.headers.get('cookie'))
	return Response.json(moderation, { headers: { 'cache-control': 'no-store' } })
}
