import type { TrustedHtml } from '@meekojs/meeko'

import { trustHtml } from '@meekojs/meeko'

export interface SearchSection {
	readonly url: string
	readonly title: string
	readonly excerpt: TrustedHtml
}

export interface SearchResult {
	readonly url: string
	readonly title: string
	readonly excerpt: TrustedHtml
	readonly sections: readonly SearchSection[]
}

interface SearchRow {
	readonly url: string
	readonly title: string
	readonly excerpt: string
	readonly sections: readonly { url: string; title: string; excerpt: string }[]
}

function escapeText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function excerptHtml(value: string, query: string): TrustedHtml {
	const needle = query.trim().split(/\s+/)[0]?.toLocaleLowerCase() ?? ''
	const at = needle ? value.toLocaleLowerCase().indexOf(needle) : -1
	if (at < 0) return trustHtml(escapeText(value))
	return trustHtml(`${escapeText(value.slice(0, at))}<mark>${escapeText(value.slice(at, at + needle.length))}</mark>${escapeText(value.slice(at + needle.length))}`)
}

/** Searches the documentation of `locale`; the result URLs of English carry `/en`. */
export async function searchDocs(query: string, locale: 'en' | 'es' = 'es', limit = 8): Promise<SearchResult[]> {
	const params = new URLSearchParams({ q: query.trim() })
	if (locale === 'en') params.set('locale', 'en')
	const response = await fetch(`/api/docs/search?${params}`)
	if (!response.ok) throw new Error(`Documentation search failed (${response.status})`)
	const rows = (await response.json()) as SearchRow[]
	return rows.slice(0, limit).map((row) => ({
		url: row.url,
		title: row.title,
		excerpt: excerptHtml(row.excerpt, query),
		sections: row.sections.map((section) => ({ ...section, excerpt: excerptHtml(section.excerpt, query) })),
	}))
}
