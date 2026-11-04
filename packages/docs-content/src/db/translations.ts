import type { DocsLocale, TranslationStatus } from '../locale'
import type { BaseOrigin } from './conflict'
import type { Queryable } from './pool'
import type { SourceDetail, SourceRecord } from './sources'

import { readTranslation, translationFile } from '../content/i18n'
import { gitFileExists, readGitFile } from '../content/repository'
import { unifiedDiff } from '../diff'
import { checkLocale, translationStatus } from '../locale'
import { contentHash } from '../sources/overlay'
import { findBase } from './conflict'
import { database } from './pool'
import { getRevision } from './revisions'
import { getSource, listSources } from './sources'

/** A Markdown source of the site and its translation into a language, with the status of that translation. */
export interface TranslationEntry {
	/** The language of the translation. */
	readonly locale: DocsLocale
	/** The Spanish original. */
	readonly original: SourceRecord
	/** Its translation, or `null` when it has none (`missing`). */
	readonly translation: SourceRecord | null
	readonly status: TranslationStatus
	/**
	 * The hash of the original the translation says it was made from: the `source-hash` of its
	 * published revision when it has one (the site shows that text), or of its file in Git.
	 */
	readonly sourceHash: string | null
	/** Where the translation of the original goes, from the repository root (`docs/en/api.md`). */
	readonly file: string | null
}

/** Filter of {@link listTranslations}. */
export interface TranslationFilter {
	/** The language of the translations; English by default. */
	readonly locale?: DocsLocale
	readonly kind?: 'guide' | 'reference'
	/** Only the translations in this status. */
	readonly status?: TranslationStatus
}

/** How many translations of a language are in each status. */
export interface TranslationCounts {
	readonly translated: number
	readonly outdated: number
	readonly missing: number
	readonly total: number
}

/**
 * Every Markdown source of the site (the guides and the written reference) with its translation
 * into `locale` and the status of that translation: `translated` when it was made from the
 * original that Git has now, `outdated` when the original changed after it, and `missing` without
 * one, whose page the site publishes in Spanish as a fallback. Sorted by path; the sources that Git
 * no longer has are left out.
 */
export async function listTranslations(db: Queryable = database(), filter: TranslationFilter = {}): Promise<TranslationEntry[]> {
	const locale = checkLocale(filter.locale ?? 'en')
	if (locale === 'es') throw new TypeError('Spanish is the original; it has no translations')
	const sources = await listSources(db, { site: 'site', ...(filter.kind ? { kind: filter.kind } : {}) })
	const originals = sources.filter((source) => source.locale === 'es' && source.file !== null)
	const translations = new Map(sources.filter((source) => source.locale === locale).map((source) => [source.path, source]))
	const hashes = await publishedSourceHashes(db, [...translations.values()])
	const entries = originals.map((original): TranslationEntry => {
		const translation = translations.get(original.path) ?? null
		// A published revision speaks for itself, also when it has lost its hash: the imported one only
		// counts without a revision, as in `translationDetail` and the render.
		const sourceHash = translation ? (hashes.has(translation.id) ? hashes.get(translation.id)! : translation.sourceHash) : null
		return {
			locale,
			original,
			translation,
			status: translationStatus(translation && { sourceHash }, original.baseHash),
			sourceHash,
			file: translation?.file ?? translationFile(original.file!, locale),
		}
	})
	return filter.status ? entries.filter((entry) => entry.status === filter.status) : entries
}

/** How many of `entries` are in each status. */
export function countTranslations(entries: readonly Pick<TranslationEntry, 'status'>[]): TranslationCounts {
	const counts = { translated: 0, outdated: 0, missing: 0, total: entries.length }
	for (const entry of entries) counts[entry.status]++
	return counts
}

/** The `source-hash` of the published revisions of `translations`, by source id. */
async function publishedSourceHashes(db: Queryable, translations: readonly SourceRecord[]): Promise<Map<number, string | null>> {
	const ids = translations.filter((source) => source.publishedRevisionId !== null).map((source) => source.publishedRevisionId!)
	const hashes = new Map<number, string | null>()
	if (!ids.length) return hashes
	const result = await db.query<{ source_id: string; markdown: string }>('SELECT source_id, markdown FROM docs_revisions WHERE id = ANY($1::bigint[])', [ids])
	for (const row of result.rows) hashes.set(Number(row.source_id), readTranslation(row.markdown).sourceHash)
	return hashes
}

/** A translation compared with its original, for the dashboard. */
export interface TranslationDetail extends Omit<TranslationEntry, 'original' | 'translation'> {
	readonly original: SourceDetail
	readonly translation: SourceDetail | null
	/** The text of the original at its last import: the one its status compares with. */
	readonly originalMarkdown: string | null
	/** The text of the translation the site shows: its published revision, or its file in Git. */
	readonly translationMarkdown: string | null
	/** The published revision of the translation, if any. */
	readonly translationRevisionId: number | null
	/**
	 * The text of the original the translation was made from (its `source-hash`), found in the last
	 * import, the working tree or the history of Git, or `null` when it cannot be found.
	 */
	readonly translatedFrom: { readonly markdown: string; readonly origin: BaseOrigin } | null
	/**
	 * What changed in the original since it was translated: a unified diff from `translatedFrom` to
	 * `originalMarkdown`. Empty when it is `translated` or when that text cannot be found.
	 */
	readonly originalChanges: string
}

/**
 * A source of the site compared with its translation into `locale`: by the id of the original or
 * of the translation, or by its path. It gives both texts, the status and, for an outdated
 * translation, the diff of the original since it was translated, which is what the translation
 * must take in. `null` when the source does not exist or is not a Markdown source of the site.
 */
export async function translationDetail(db: Queryable, key: number | { readonly path: string }, options: { readonly locale?: DocsLocale } = {}): Promise<TranslationDetail | null> {
	const locale = checkLocale(options.locale ?? 'en')
	if (locale === 'es') throw new TypeError('Spanish is the original; it has no translations')
	const found = typeof key === 'number' ? await getSource(db, key) : await getSource(db, { site: 'site', path: key.path })
	if (!found || found.site !== 'site' || found.file === null) return null
	const original = found.locale === 'es' ? found : await getSource(db, { site: 'site', path: found.path })
	if (!original?.file) return null
	const translation = found.locale === locale ? found : await getSource(db, { site: 'site', path: original.path, locale })
	const current = translation && !translation.removedAt ? translation : null
	const revision = current?.publishedRevisionId ? await getRevision(db, current.publishedRevisionId) : null
	const translationMarkdown = revision?.markdown ?? current?.markdown ?? null
	const sourceHash = translationMarkdown === null ? null : readTranslation(translationMarkdown).sourceHash
	const originalMarkdown = original.markdown
	const git = gitFileExists(original.file) ? readGitFile(original.file) : null
	const status = translationStatus(current && { sourceHash }, original.baseHash)
	const translatedFrom = sourceHash === null ? null : findBase({ ...original, file: original.file }, sourceHash, git)
	const originalChanges = status === 'outdated' && translatedFrom && originalMarkdown !== null && contentHash(originalMarkdown) !== sourceHash ? changes(translatedFrom.markdown, originalMarkdown, original.file) : ''
	return {
		locale,
		original,
		translation: current,
		status,
		sourceHash,
		file: current?.file ?? translationFile(original.file, locale),
		originalMarkdown,
		translationMarkdown,
		translationRevisionId: revision?.id ?? null,
		translatedFrom,
		originalChanges,
	}
}

/** The unified diff of an original since it was translated, or a one-line note when it changed too much to compare. */
function changes(before: string, after: string, file: string): string {
	const from = `translated/${file}`
	const to = `git/${file}`
	try {
		return unifiedDiff(before, after, { from, to })
	} catch (error) {
		if (error instanceof RangeError)
			return `--- ${from}
+++ ${to}
@@ the texts differ in too many lines to compare @@
`
		throw error
	}
}
