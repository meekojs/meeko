import { sitemapXml } from '@meekojs/meeko/framework'
import { defineServerMiddleware } from '@meekojs/meeko/server'
import { siteOrigin as origin } from 'meeko-docs-content/content/repository'
import { localizedPath, splitLocalePath } from 'meeko-docs-content/locale'
import { moderateLlmsFull, moderateLlmsIndex, revalidatedDocument } from 'meeko-docs-content/moderation'

import type { DocsLocale } from '../content/db'

import { listPages, readPage, searchPages, siteModeration } from '../content/db'

/** The pages of the sitemap: the home page and the documentation. */
const inSitemap = (path: string): boolean => path === '/' || path === '/docs' || path.startsWith('/docs/')

/**
 * `sitemap.xml` with both languages: one `<url>` per version of each page, each with its
 * alternates (`es`, `en` and `x-default`, the Spanish one) when both languages have it.
 */
async function sitemap(): Promise<string | null> {
	const [es, en] = await Promise.all([listPages('es'), listPages('en')])
	if (es.length === 0) return null
	const versions = new Map<string, Partial<Record<DocsLocale, string>>>()
	for (const [locale, pages] of [
		['es', es],
		['en', en],
	] as const) {
		for (const page of pages) if (inSitemap(page.path)) versions.set(page.path, { ...versions.get(page.path), [locale]: localizedPath(page.path, locale) })
	}
	const urls = [...versions.values()].flatMap((version) => {
		const alternates =
			version.es && version.en
				? [
						{ hreflang: 'es', pathname: version.es },
						{ hreflang: 'en', pathname: version.en },
						{ hreflang: 'x-default', pathname: version.es },
					]
				: []
		return [version.es, version.en].filter((pathname): pathname is string => pathname !== undefined).map((pathname) => ({ pathname, alternates }))
	})
	return sitemapXml(origin, urls)
}

/** Public text endpoints backed by the same snapshot as the documentation pages, in both languages. */
export default defineServerMiddleware(async (request, next) => {
	const url = new URL(request.url)
	if (request.method !== 'GET' && request.method !== 'HEAD') return next(request)
	// `/en/llms.txt` is the English version of `/llms.txt`; the sitemap and robots.txt are one for both.
	const { locale, path } = splitLocalePath(url.pathname)

	if (path === '/llms.txt' || path === '/llms-full.txt') {
		const document = await readPage<{ text: string }>(path, locale)
		if (!document) return new Response('Not found', { status: 404 })
		// Without the pages that the dashboard hides. The English text already links /en/… URLs, so
		// both languages compare them with the bare origin.
		const moderation = await siteModeration(locale)
		const text = path === '/llms.txt' ? moderateLlmsIndex(document.text, origin, moderation) : moderateLlmsFull(document.text, origin, moderation)
		// Revalidated on every use: a hidden page leaves within the 30 s of the moderation reader.
		return revalidatedDocument(request, text, 'text/plain; charset=utf-8')
	}

	if (url.pathname === '/sitemap.xml') {
		const xml = await sitemap()
		if (xml === null) return new Response('Documentation unavailable', { status: 503 })
		return revalidatedDocument(request, xml, 'application/xml; charset=utf-8')
	}

	if (url.pathname === '/robots.txt') {
		return new Response(
			request.method === 'HEAD'
				? null
				: `User-agent: *
Allow: /
Sitemap: ${origin}/sitemap.xml
`,
			{
				headers: { 'content-type': 'text/plain; charset=utf-8' },
			},
		)
	}

	if (url.pathname === '/api/docs/search') {
		const query = url.searchParams.get('q')?.trim() ?? ''
		if (query.length > 120) return new Response('Query too long', { status: 400 })
		// The dialog of an English page asks with `locale=en`; anything else searches in Spanish.
		const results = query ? await searchPages(query, 8, url.searchParams.get('locale') === 'en' ? 'en' : 'es') : []
		return Response.json(results, { headers: { 'cache-control': 'no-store' } })
	}

	return next(request)
})
