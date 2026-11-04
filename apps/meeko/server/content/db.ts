// The site reads the active documentation snapshot; meeko-docs-content renders and stores it. The
// moderation of the dashboard applies on every read: a hidden page does not exist for the site
// (its page answers 404 and it leaves the sidebar, the indexes, the search and the sitemap), and a
// featured one is marked. Without a database the moderation is empty and the site keeps working.
//
// Every read names its language. Paths are stored without prefix (`/docs/api`) for both languages;
// what the site links or compares with the requested URL carries it (`/en/docs/api`): the English
// payloads, the search results and the English moderation (its hidden and featured URLs).
import type { DocsLocale } from 'meeko-docs-content/locale'
import type { SiteModeration } from 'meeko-docs-content/moderation'
import type { SearchResult, SnapshotPage } from 'meeko-docs-content/snapshots'

import { localizedPath, splitLocalePath } from 'meeko-docs-content/locale'
import { isHiddenPath, moderateSnapshotPayload, pagePath, readSiteModeration } from 'meeko-docs-content/moderation'
import { listPages as listSnapshotPages, readPage as readSnapshotPage, searchPages as searchSnapshotPages } from 'meeko-docs-content/snapshots'

export type { DocsLocale, SearchResult, SnapshotPage }

/** The language of a public URL of the site: `/en/…` is English, any other path Spanish. */
export function urlLocale(url: URL | string): DocsLocale {
	return splitLocalePath(typeof url === 'string' ? url : url.pathname).locale
}

/** The moderation of the site in `locale` (its rules and the global ones), cached for 30 s; empty without a database. */
export function siteModeration(locale: DocsLocale = 'es'): Promise<SiteModeration> {
	return readSiteModeration('site', { locale })
}

/**
 * The payload of a page of the active snapshot in `locale` as its moderation shows it, or `null`
 * when it does not exist or is hidden. `path` has no language prefix.
 */
export async function readPage<T>(path: string, locale: DocsLocale = 'es'): Promise<T | null> {
	const [page, moderation] = await Promise.all([readSnapshotPage<T>(path, { locale }), siteModeration(locale)])
	if (page === null || isHiddenPath(moderation, localizedPath(path, locale))) return null
	return moderateSnapshotPayload(page, moderation)
}

/** The pages of the active snapshot in `locale` without the hidden ones, in URL order; paths without prefix. */
export async function listPages<T = unknown>(locale: DocsLocale = 'es'): Promise<readonly { path: string; payload: T }[]> {
	const [pages, moderation] = await Promise.all([listSnapshotPages<T>({ locale }), siteModeration(locale)])
	return moderation.hidden.length ? pages.filter((page) => !isHiddenPath(moderation, localizedPath(page.path, locale))) : pages
}

/**
 * {@link searchSnapshotPages} in `locale` without the hidden pages: it asks for as many more
 * results as pages are hidden, so `limit` still fills. The URLs of the results carry the prefix.
 */
export async function searchPages(query: string, limit: number, locale: DocsLocale = 'es'): Promise<readonly SearchResult[]> {
	const moderation = await siteModeration(locale)
	if (!moderation.hidden.length) return searchSnapshotPages(query, limit, { locale })
	const results = await searchSnapshotPages(query, limit + Math.min(moderation.hidden.length, 50), { locale })
	return results.filter((result) => !isHiddenPath(moderation, pagePath(result.url))).slice(0, limit)
}
