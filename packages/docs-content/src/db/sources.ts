import type { DocsLocale } from '../locale'
import type { DocsSite, SourceEntry, SourceKind } from '../sources/discover'
import type { Database, Queryable } from './pool'

import { checkLocale } from '../locale'
import { collectRepositorySources } from '../sources/discover'
import { contentHash, normalizeSourcePath, normalizeText } from '../sources/overlay'
import { database, transaction } from './pool'

/** A row of `docs_sources`, without its Markdown. */
export interface SourceRecord {
	readonly id: number
	readonly site: DocsSite
	/** Its language: `es` for an original, `en` for a translation of `docs/en/**`. */
	readonly locale: DocsLocale
	/** Its URL path without the language prefix: a translation has the path of its original. */
	readonly path: string
	readonly kind: SourceKind
	readonly title: string
	/** Its Markdown file from the repository root, or `null` for a `.meeko` page. */
	readonly file: string | null
	readonly baseHash: string | null
	/**
	 * For a translation, the hash of the Spanish original it was made from (its `source-hash` in
	 * Git at the last import), or `null` when it does not declare one; always `null` in Spanish.
	 */
	readonly sourceHash: string | null
	readonly importedAt: Date
	/** When the last import stopped finding it, or `null` while it exists. */
	readonly removedAt: Date | null
	/** Its published revision, or `null` when the site shows Git. */
	readonly publishedRevisionId: number | null
}

/** A source with the Markdown of Git it was imported from. */
export interface SourceDetail extends SourceRecord {
	readonly markdown: string | null
}

/** What {@link importSources} changed. */
export interface ImportResult {
	readonly inserted: number
	readonly updated: number
	readonly unchanged: number
	/** Sources of the imported sites that Git no longer has; marked removed, never deleted. */
	readonly removed: number
	/** Removed sources that Git has again. */
	readonly restored: number
}

/** Filter of {@link listSources}. */
export interface SourceFilter {
	readonly site?: DocsSite
	/** Only the sources of this language; every language by default. */
	readonly locale?: DocsLocale
	readonly kind?: SourceKind
	/** Include sources that Git no longer has. */
	readonly includeRemoved?: boolean
}

interface SourceRow {
	id: string
	site: DocsSite
	locale: DocsLocale
	path: string
	kind: SourceKind
	title: string
	source_file: string | null
	base_hash: string | null
	source_hash: string | null
	imported_at: Date
	removed_at: Date | null
	published_revision_id: string | null
	base_markdown?: string | null
}

const columns = `s.id, s.site, s.locale, s.path, s.kind, s.title, s.source_file, s.base_hash, s.source_hash, s.imported_at, s.removed_at,
	(SELECT r.id FROM docs_revisions AS r WHERE r.source_id = s.id AND r.status = 'published') AS published_revision_id`

function record(row: SourceRow): SourceRecord {
	return {
		id: Number(row.id),
		site: row.site,
		locale: row.locale,
		path: row.path,
		kind: row.kind,
		title: row.title,
		file: row.source_file,
		baseHash: row.base_hash,
		sourceHash: row.source_hash,
		importedAt: row.imported_at,
		removedAt: row.removed_at,
		publishedRevisionId: row.published_revision_id === null ? null : Number(row.published_revision_id),
	}
}

/** Checks an entry before it is stored, with its Markdown normalized to `\n`. */
function prepare(entry: SourceEntry): SourceEntry & { readonly locale: DocsLocale; readonly sourceHash: string | null; readonly hash: string | null } {
	if (!['site', 'ui', 'i18n'].includes(entry.site)) throw new TypeError(`Unknown site: ${entry.site}`)
	const locale = checkLocale(entry.locale)
	const sourceHash = entry.sourceHash ?? null
	if (locale === 'es' && sourceHash !== null) throw new TypeError(`${entry.site} ${entry.path}: only a translation has a source hash`)
	if (sourceHash !== null && !/^[0-9a-f]{64}$/.test(sourceHash)) throw new TypeError(`${entry.site} ${locale} ${entry.path}: the source hash must be a SHA-256 in hexadecimal`)
	if (locale !== 'es' && (entry.site !== 'site' || entry.kind === 'page')) throw new TypeError(`${entry.site} ${locale} ${entry.path}: only the guides and reference pages of the site are translated`)
	if (!entry.path.startsWith('/') || /[?#\s]/.test(entry.path)) throw new TypeError(`Invalid source path: ${entry.path}`)
	if (!entry.title.trim()) throw new TypeError(`${entry.site} ${entry.path}: the title is empty`)
	const page = entry.kind === 'page'
	if (page !== (entry.markdown === null) || page !== (entry.file === null)) {
		throw new TypeError(`${entry.site} ${entry.path}: a page has no Markdown or file, and a guide or reference page has both`)
	}
	if (!page && entry.site !== 'site') throw new TypeError(`${entry.site} ${entry.path}: only the site has Markdown sources`)
	const markdown = entry.markdown === null ? null : normalizeText(entry.markdown)
	const file = entry.file === null ? null : normalizeSourcePath(entry.file)
	return { ...entry, locale, sourceHash, file, markdown, hash: markdown === null ? null : contentHash(markdown) }
}

/**
 * Stores the pages of Git as the base of the dashboard: new ones are inserted, changed ones get
 * their new title and Markdown, and those of the imported sites that Git no longer has are marked
 * removed. Revisions are never touched. `sites` are the sites `entries` cover entirely (those of
 * the entries by default), in every language: a translation that Git no longer has is removed too,
 * and its page is `missing` again. A source is keyed by site, language and path.
 */
export async function importSources(db: Database, entries: readonly SourceEntry[], sites: readonly DocsSite[] = [...new Set(entries.map((entry) => entry.site))]): Promise<ImportResult> {
	const prepared = entries.map(prepare)
	const keys = new Set<string>()
	for (const entry of prepared) {
		const key = `${entry.site}\0${entry.locale}\0${entry.path}`
		if (keys.has(key)) throw new TypeError(`Two sources for ${entry.site} ${entry.locale} ${entry.path}`)
		if (!sites.includes(entry.site)) throw new TypeError(`${entry.site} ${entry.path} is outside the imported sites`)
		keys.add(key)
	}
	return transaction(db, async (client) => {
		const existing = await client.query<{ id: string; site: DocsSite; locale: DocsLocale; path: string; kind: SourceKind; title: string; source_file: string | null; base_hash: string | null; source_hash: string | null; removed_at: Date | null }>('SELECT id, site, locale, path, kind, title, source_file, base_hash, source_hash, removed_at FROM docs_sources WHERE site = ANY($1::text[]) FOR UPDATE', [sites])
		const rows = new Map(existing.rows.map((row) => [`${row.site}\0${row.locale}\0${row.path}`, row]))
		let removed = 0
		// Removals first, so a file that moved to another URL can take its place in the unique index.
		for (const [key, row] of rows) {
			if (keys.has(key) || row.removed_at) continue
			await client.query('UPDATE docs_sources SET removed_at = now() WHERE id = $1', [row.id])
			removed++
		}
		let inserted = 0
		let updated = 0
		let unchanged = 0
		let restored = 0
		for (const entry of prepared) {
			const row = rows.get(`${entry.site}\0${entry.locale}\0${entry.path}`)
			if (!row) {
				await client.query('INSERT INTO docs_sources (site, locale, path, kind, title, source_file, base_markdown, base_hash, source_hash) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
					entry.site,
					entry.locale,
					entry.path,
					entry.kind,
					entry.title,
					entry.file,
					entry.markdown,
					entry.hash,
					entry.sourceHash,
				])
				inserted++
				continue
			}
			const changed = row.kind !== entry.kind || row.title !== entry.title || row.source_file !== entry.file || row.base_hash !== entry.hash || row.source_hash !== entry.sourceHash
			if (row.removed_at) restored++
			if (changed) {
				await client.query('UPDATE docs_sources SET kind = $2, title = $3, source_file = $4, base_markdown = $5, base_hash = $6, source_hash = $7, imported_at = now(), removed_at = NULL WHERE id = $1', [
					row.id,
					entry.kind,
					entry.title,
					entry.file,
					entry.markdown,
					entry.hash,
					entry.sourceHash,
				])
				updated++
			} else {
				if (row.removed_at) await client.query('UPDATE docs_sources SET removed_at = NULL WHERE id = $1', [row.id])
				unchanged++
			}
		}
		return { inserted, updated, unchanged, removed, restored }
	})
}

/** Imports every page of the repository's three sites: see {@link collectRepositorySources}. */
export async function importRepositorySources(db: Database = database(), sites: readonly DocsSite[] = ['site', 'ui', 'i18n']): Promise<ImportResult> {
	return importSources(db, await collectRepositorySources(sites), sites)
}

/** The sources, by site, path and language (Spanish first), without their Markdown. */
export async function listSources(db: Queryable = database(), filter: SourceFilter = {}): Promise<SourceRecord[]> {
	const result = await db.query<SourceRow>(
		`SELECT ${columns} FROM docs_sources AS s
		WHERE ($1::text IS NULL OR s.site = $1) AND ($2::text IS NULL OR s.kind = $2) AND ($3 OR s.removed_at IS NULL) AND ($4::text IS NULL OR s.locale = $4)
		ORDER BY s.site, s.path, s.locale = 'es' DESC, s.locale`,
		[filter.site ?? null, filter.kind ?? null, filter.includeRemoved ?? false, filter.locale === undefined ? null : checkLocale(filter.locale)],
	)
	return result.rows.map(record)
}

/**
 * A source with its Markdown of Git, by id or by site, path and language (Spanish by default);
 * `null` when it does not exist.
 */
export async function getSource(db: Queryable, key: number | { readonly site: DocsSite; readonly path: string; readonly locale?: DocsLocale }): Promise<SourceDetail | null> {
	const result = typeof key === 'number' ? await db.query<SourceRow>(`SELECT ${columns}, s.base_markdown FROM docs_sources AS s WHERE s.id = $1`, [key]) : await db.query<SourceRow>(`SELECT ${columns}, s.base_markdown FROM docs_sources AS s WHERE s.site = $1 AND s.path = $2 AND s.locale = $3`, [key.site, key.path, checkLocale(key.locale)])
	const row = result.rows[0]
	return row ? { ...record(row), markdown: row.base_markdown ?? null } : null
}
