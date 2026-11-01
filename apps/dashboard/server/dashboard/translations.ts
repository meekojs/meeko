// The translations of the site into English (meeko-docs-content/db), in the shapes of
// shared/schemas/dashboard.ts. Each English source is a source of its own (`docs/en/**`), so its
// revisions, editor and preview are those of any source; this module only pairs it with its original.
import type { Queryable, TranslationEntry } from 'meeko-docs-content/db'

import { ApiError } from '@meekojs/meeko/server'
import { stampTranslation } from 'meeko-docs-content/content/i18n'
import { countTranslations, getSource, listTranslations, translationDetail } from 'meeko-docs-content/db'
import { listSourceStatuses } from 'meeko-docs-content/status'

import type { SourceRow, TranslationDetailView, TranslationList } from '../../shared/schemas/dashboard'

import { sourceRow } from './reads'

/** The rows of the site's sources by id, with their divergence: the original and its translation. */
async function rowsById(db: Queryable): Promise<Map<number, SourceRow>> {
	return new Map((await listSourceStatuses(db, { site: 'site', includeRemoved: true })).map((status) => [status.id, sourceRow(status)]))
}

function rowOf(rows: ReadonlyMap<number, SourceRow>, id: number): SourceRow {
	const row = rows.get(id)
	if (!row) throw new ApiError('SOURCE_NOT_FOUND', 404, `Documentation source ${id} does not exist`)
	return row
}

/** Every guide and written reference page of the site with its English translation and counters. */
export async function readTranslations(db: Queryable, filter: { readonly kind?: 'guide' | 'reference' | undefined; readonly status?: TranslationEntry['status'] | undefined } = {}): Promise<TranslationList> {
	const [all, rows] = await Promise.all([listTranslations(db, { locale: 'en', ...(filter.kind ? { kind: filter.kind } : {}) }), rowsById(db)])
	// The counters are of the kind chosen, whatever the status filter.
	const entries = filter.status ? all.filter((entry) => entry.status === filter.status) : all
	return {
		counts: countTranslations(all),
		entries: entries.map((entry) => ({
			original: rowOf(rows, entry.original.id),
			translation: entry.translation ? rowOf(rows, entry.translation.id) : null,
			status: entry.status,
			sourceHash: entry.sourceHash,
			file: entry.file,
		})),
	}
}

/** An original and its translation side by side, with what changed in the original since it was translated. */
export async function readTranslation(db: Queryable, id: number): Promise<TranslationDetailView> {
	const detail = await translationDetail(db, id, { locale: 'en' })
	if (!detail) throw new ApiError('TRANSLATION_NOT_FOUND', 404, `Source ${id} is not a Markdown source of the site`)
	const rows = await rowsById(db)
	return {
		original: rowOf(rows, detail.original.id),
		translation: detail.translation ? rowOf(rows, detail.translation.id) : null,
		status: detail.status,
		sourceHash: detail.sourceHash,
		file: detail.file,
		originalMarkdown: detail.originalMarkdown,
		translationMarkdown: detail.translationMarkdown,
		translationRevisionId: detail.translationRevisionId,
		translatedFrom: detail.translatedFrom?.origin.kind ?? null,
		originalChanges: detail.originalChanges,
	}
}

/**
 * The original of an English source, for its editor: what «mark as translated» stamps. `null` for
 * a Spanish source.
 */
export async function originalOf(db: Queryable, source: { readonly site: string; readonly locale: string; readonly path: string }): Promise<{ id: number; title: string; baseHash: string | null } | null> {
	if (source.locale === 'es' || source.site !== 'site') return null
	const original = await getSource(db, { site: 'site', path: source.path })
	return original ? { id: original.id, title: original.title, baseHash: original.baseHash } : null
}

/**
 * The Markdown of an English source with the hash of its original in the last import as
 * `source-hash`: the translation says it was made from the original that Git has now.
 */
export async function stampSource(db: Queryable, sourceId: number, markdown: string): Promise<{ markdown: string; sourceHash: string }> {
	const source = await getSource(db, sourceId)
	if (!source) throw new ApiError('SOURCE_NOT_FOUND', 404, `Documentation source ${sourceId} does not exist`)
	const original = await originalOf(db, source)
	if (!original?.baseHash) throw new ApiError('SOURCE_NOT_EDITABLE', 409, { message: 'Only a translation with an imported original can be stamped', issues: [{ path: '', message: 'issues.notTranslation' }] })
	return { markdown: stampTranslation(markdown, original.baseHash), sourceHash: original.baseHash }
}
