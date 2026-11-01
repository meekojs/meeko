// The site reads the active documentation snapshot; meeko-docs-content renders and stores it. The
// moderation of the dashboard applies on every read: a hidden page does not exist for the site
// (its page answers 404 and it leaves the sidebar, the indexes, the search and the sitemap), and a
// featured one is marked. Without a database the moderation is empty and the site keeps working.
import type { SiteModeration } from 'meeko-docs-content/moderation'
import type { SearchResult, SnapshotPage } from 'meeko-docs-content/snapshots'

import { isHiddenPath, moderateSnapshotPayload, pagePath, readSiteModeration } from 'meeko-docs-content/moderation'
import { listPages as listSnapshotPages, readPage as readSnapshotPage, searchPages as searchSnapshotPages } from 'meeko-docs-content/snapshots'

export type { SearchResult, SnapshotPage }

/** The moderation of the site, cached for 30 s; empty without a database. */
export function siteModeration(): Promise<SiteModeration> {
	return readSiteModeration('site')
}

/** The payload of a page of the active snapshot as its moderation shows it, or `null` when it does not exist or is hidden. */
export async function readPage<T>(path: string): Promise<T | null> {
	const [page, moderation] = await Promise.all([readSnapshotPage<T>(path), siteModeration()])
	if (page === null || isHiddenPath(moderation, path)) return null
	return moderateSnapshotPayload(page, moderation)
}

/** The pages of the active snapshot without the hidden ones, in URL order. */
export async function listPages<T = unknown>(): Promise<readonly { path: string; payload: T }[]> {
	const [pages, moderation] = await Promise.all([listSnapshotPages<T>(), siteModeration()])
	return moderation.hidden.length ? pages.filter((page) => !isHiddenPath(moderation, page.path)) : pages
}

/** {@link searchSnapshotPages} without the hidden pages: it asks for as many more results as pages are hidden, so `limit` still fills. */
export async function searchPages(query: string, limit: number): Promise<readonly SearchResult[]> {
	const moderation = await siteModeration()
	if (!moderation.hidden.length) return searchSnapshotPages(query, limit)
	const results = await searchSnapshotPages(query, limit + Math.min(moderation.hidden.length, 50))
	return results.filter((result) => !isHiddenPath(moderation, pagePath(result.url))).slice(0, limit)
}
