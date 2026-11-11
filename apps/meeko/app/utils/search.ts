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

/** Keeps positions in the original text while comparing words without accents. */
function foldedText(value: string): { text: string; positions: number[] } {
	let text = ''
	const positions: number[] = []
	for (let index = 0; index < value.length;) {
		const character = String.fromCodePoint(value.codePointAt(index)!)
		const folded = character.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase()
		text += folded
		for (let offset = 0; offset < folded.length; offset++) positions.push(index)
		index += character.length
	}
	return { text, positions }
}

function excerptHtml(value: string, query: string): TrustedHtml {
	const needle = foldedText(query.trim().split(/\s+/)[0] ?? '').text
	const folded = foldedText(value)
	const at = needle ? folded.text.indexOf(needle) : -1
	if (at < 0) return trustHtml(escapeText(value))
	const start = folded.positions[at]!
	const end = folded.positions[at + needle.length] ?? value.length
	return trustHtml(`${escapeText(value.slice(0, start))}<mark>${escapeText(value.slice(start, end))}</mark>${escapeText(value.slice(end))}`)
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
