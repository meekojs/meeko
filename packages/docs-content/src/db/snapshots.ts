import type { Database, Queryable } from './pool'

import { database, lockKeys, transaction } from './pool'

/** A page of a snapshot: its URL path and the data its route renders. */
export interface SnapshotPage {
	readonly path: string
	readonly payload: unknown
}

/** A result of {@link searchPages}. Excerpts are plain text for the client to escape. */
export interface SearchResult {
	readonly url: string
	readonly title: string
	readonly excerpt: string
	readonly sections: readonly { readonly url: string; readonly title: string; readonly excerpt: string }[]
}

/** A stored snapshot, without its pages. */
export interface SnapshotSummary {
	readonly id: number
	readonly publishedAt: Date
	readonly active: boolean
	readonly pages: number
	readonly publishedBy: string | null
	readonly note: string | null
}

/** Options of {@link publishSnapshot}. */
export interface PublishSnapshotOptions {
	/** Database to write; the shared pool of `DATABASE_URL` by default. */
	readonly db?: Database
	/** Who or what published it, such as `docs:sync` or the user of the dashboard. */
	readonly publishedBy?: string
	readonly note?: string
	/**
	 * Snapshots kept after publishing, the new one included (5 by default, at least 2). The one
	 * that was active before is kept too, even after a rollback to an older one.
	 */
	readonly keep?: number
	/**
	 * The snapshot that must still be active to publish, `null` for none: the one a render started
	 * from. When another publication or a rollback changed it meanwhile, {@link publishSnapshot}
	 * throws {@link SnapshotConflictError} and stores nothing. Without it, the new snapshot always
	 * replaces the active one.
	 *
	 * Pass the {@link ActiveSnapshot} that {@link activeSnapshot} returned, not only its id: then an
	 * activation that returned to the same snapshot meanwhile (a rollback to another one and back) is
	 * a conflict too. An id alone only notices that another snapshot is active.
	 */
	readonly expectActive?: ActiveSnapshot | number | null
}

/**
 * The active snapshot and its activation generation: a token that changes every time a
 * transaction activates it, even the same snapshot again. It is the row's `xmin`, the transaction
 * that last wrote it, so it needs no column of its own.
 */
export interface ActiveSnapshot {
	readonly id: number
	readonly generation: string
}

/**
 * The active snapshot changed while a publication rendered: a rollback or another publication
 * committed first. Nothing was stored; render again from the new state to publish.
 */
export class SnapshotConflictError extends Error {
	override readonly name = 'SnapshotConflictError'
	/** The snapshot that was active when the publication started, or `null` for none. */
	readonly expected: number | null
	/**
	 * The snapshot that is active now, or `null` for none. Equal to `expected` when that snapshot
	 * was activated again meanwhile, such as a rollback and a return to it.
	 */
	readonly actual: number | null

	constructor(expected: number | null, actual: number | null) {
		super(expected === actual ? `The documentation snapshot ${expected ?? 'none'} was activated again while publishing; nothing was stored` : `The active documentation snapshot changed from ${expected ?? 'none'} to ${actual ?? 'none'} while publishing; nothing was stored`)
		this.expected = expected
		this.actual = actual
	}
}

/**
 * The active snapshot with its activation generation, or `null` when none is active: what a
 * publication passes as `expectActive`.
 */
export async function activeSnapshot(db: Queryable = database()): Promise<ActiveSnapshot | null> {
	const result = await db.query<{ id: string; generation: string }>('SELECT id, xmin::text AS generation FROM docs_snapshots WHERE active')
	const row = result.rows[0]
	return row ? { id: Number(row.id), generation: row.generation } : null
}

/** Whether `current` is still the snapshot that `expected` names. */
function stillActive(expected: ActiveSnapshot | number | null, current: ActiveSnapshot | null): boolean {
	if (expected === null) return current === null
	if (typeof expected === 'number') return current?.id === expected
	return current !== null && current.id === expected.id && current.generation === expected.generation
}

/** The id of the active snapshot, or `null` when none is active. */
export async function activeSnapshotId(db: Queryable = database()): Promise<number | null> {
	const result = await db.query<{ id: string }>('SELECT id FROM docs_snapshots WHERE active')
	const id = result.rows[0]?.id
	return id === undefined ? null : Number(id)
}

const docsPath = /^\/docs\/[^/?#\s]+(?:\/[^/?#\s]+)*$/

/** Throws unless `path` is a URL the snapshot can hold: `/`, `/docs`, `/docs/…` or the llms files. */
export function validatePath(path: string): void {
	if (path === '/' || path === '/docs' || path === '/llms.txt' || path === '/llms-full.txt') return
	if (
		!docsPath.test(path) ||
		path
			.slice(6)
			.split('/')
			.some((segment) => segment === '.' || segment === '..')
	) {
		throw new TypeError(`Invalid documentation URL path: ${path}`)
	}
}

const entities: Readonly<Record<string, string>> = {
	'&nbsp;': ' ',
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&apos;': "'",
	'&#39;': "'",
}

/** The text that full-text search indexes for a page: its content, without the navigation. */
export function searchableText(path: string, payload: unknown): string {
	const chunks: string[] = []
	const visit = (value: unknown): void => {
		if (typeof value === 'string') {
			const text = value
				.replace(/<[^>]*>/g, ' ')
				.replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g, (entity) => entities[entity] ?? entity)
				.replace(/\s+/g, ' ')
				.trim()
			if (text) chunks.push(text)
		} else if (Array.isArray(value)) {
			for (const item of value) visit(item)
		} else if (value !== null && typeof value === 'object') {
			for (const item of Object.values(value)) visit(item)
		}
	}
	if (path === '/' || path === '/llms.txt' || path === '/llms-full.txt') return ''
	if (!payload || typeof payload !== 'object') return ''
	const record = payload as Record<string, unknown>
	// Navigation and pager are repeated on every page and would make unrelated pages match.
	for (const field of ['doc', 'written', 'page', 'sections', 'groups', 'head']) visit(record[field])
	return chunks.join(' ')
}

/**
 * Stores `pages` as a new snapshot and activates it in one transaction; readers see the previous
 * one until it commits. Older snapshots beyond `keep` are deleted, except the one that was active.
 * With `expectActive`, it refuses to replace a snapshot activated after the render started. Returns
 * the id of the new snapshot.
 */
export async function publishSnapshot(pages: readonly SnapshotPage[], options: PublishSnapshotOptions = {}): Promise<number> {
	if (pages.length === 0) throw new TypeError('A documentation snapshot must contain at least one page')
	const keep = options.keep ?? 5
	if (!Number.isSafeInteger(keep) || keep < 2) throw new RangeError('A documentation database keeps at least 2 snapshots')

	const seen = new Set<string>()
	const serialized = pages.map(({ path, payload }) => {
		validatePath(path)
		if (seen.has(path)) throw new TypeError(`Duplicate documentation URL path: ${path}`)
		seen.add(path)
		const json: string | undefined = JSON.stringify(payload)
		if (json === undefined) throw new TypeError(`Page payload is not JSON serializable: ${path}`)
		return { path, json, text: searchableText(path, JSON.parse(json) as unknown) }
	})

	return transaction(options.db ?? database(), async (client) => {
		// Serialize publishers across processes. Readers still use one MVCC snapshot per query.
		await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockKeys.namespace, lockKeys.snapshots])
		const current = await activeSnapshot(client)
		const previousId = current?.id ?? null
		const expected = options.expectActive
		if (expected !== undefined && !stillActive(expected, current)) throw new SnapshotConflictError(typeof expected === 'object' && expected !== null ? expected.id : expected, previousId)
		const inserted = await client.query<{ id: string }>('INSERT INTO docs_snapshots (published_by, note) VALUES ($1, $2) RETURNING id', [options.publishedBy ?? null, options.note ?? null])
		const snapshotId = inserted.rows[0]?.id
		if (snapshotId === undefined) throw new Error('Failed to create documentation snapshot')

		for (const page of serialized) {
			await client.query('INSERT INTO docs_pages (snapshot_id, path, payload, searchable_text) VALUES ($1, $2, $3::jsonb, $4)', [snapshotId, page.path, page.json, page.text])
		}

		await client.query('UPDATE docs_snapshots SET active = false WHERE active')
		await client.query('UPDATE docs_snapshots SET active = true WHERE id = $1', [snapshotId])
		await client.query(
			`DELETE FROM docs_snapshots
			WHERE id <> $1 AND ($2::bigint IS NULL OR id <> $2::bigint)
				AND id NOT IN (SELECT id FROM docs_snapshots ORDER BY id DESC LIMIT $3)`,
			[snapshotId, previousId, keep],
		)
		return Number(snapshotId)
	})
}

/** The stored snapshots, newest first, with their number of pages. */
export async function listSnapshots(db: Queryable = database()): Promise<SnapshotSummary[]> {
	const result = await db.query<{ id: string; published_at: Date; active: boolean; pages: string; published_by: string | null; note: string | null }>(
		`SELECT s.id, s.published_at, s.active, s.published_by, s.note, (SELECT count(*) FROM docs_pages AS p WHERE p.snapshot_id = s.id) AS pages
		FROM docs_snapshots AS s ORDER BY s.id DESC`,
	)
	return result.rows.map((row) => ({
		id: Number(row.id),
		publishedAt: row.published_at,
		active: row.active,
		pages: Number(row.pages),
		publishedBy: row.published_by,
		note: row.note,
	}))
}

/**
 * Makes a stored snapshot the visible one, such as an earlier version to roll back to. Readers
 * switch atomically when the transaction commits.
 */
export async function activateSnapshot(id: number, db: Database = database()): Promise<void> {
	if (!Number.isSafeInteger(id) || id < 1) throw new RangeError(`Invalid snapshot id: ${id}`)
	await transaction(db, async (client) => {
		await client.query('SELECT pg_advisory_xact_lock($1, $2)', [lockKeys.namespace, lockKeys.snapshots])
		const found = await client.query<{ pages: string }>('SELECT (SELECT count(*) FROM docs_pages AS p WHERE p.snapshot_id = s.id) AS pages FROM docs_snapshots AS s WHERE s.id = $1', [id])
		const row = found.rows[0]
		if (!row) throw new Error(`Documentation snapshot ${id} does not exist`)
		if (Number(row.pages) === 0) throw new Error(`Documentation snapshot ${id} has no pages`)
		await client.query('UPDATE docs_snapshots SET active = false WHERE active AND id <> $1', [id])
		await client.query('UPDATE docs_snapshots SET active = true WHERE id = $1', [id])
	})
}

/** Return a page from the active snapshot, or null when that URL is absent. */
export async function readPage<T>(path: string, db: Queryable = database()): Promise<T | null> {
	validatePath(path)
	const result = await db.query<{ payload: T }>('SELECT p.payload FROM docs_pages AS p JOIN docs_snapshots AS s ON s.id = p.snapshot_id WHERE s.active AND p.path = $1', [path])
	return result.rows[0]?.payload ?? null
}

/** List the active snapshot in URL order. */
export async function listPages<T = unknown>(db: Queryable = database()): Promise<readonly { path: string; payload: T }[]> {
	const result = await db.query<{ path: string; payload: T }>('SELECT p.path, p.payload FROM docs_pages AS p JOIN docs_snapshots AS s ON s.id = p.snapshot_id WHERE s.active ORDER BY p.path')
	return result.rows
}

/** Search only published documentation pages. Excerpts are plain text for the client to escape. */
export async function searchPages(query: string, limit: number, db: Queryable = database()): Promise<readonly SearchResult[]> {
	const term = query.trim()
	if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Search limit must be a positive integer')
	if (term.length === 0) return []
	if (term.length > 200) throw new RangeError('Search query is too long')
	const result = await db.query<{ url: string; title: string; excerpt: string; payload: unknown }>(
		`SELECT p.path AS url,
			p.payload,
			COALESCE(p.payload #>> '{head,title}', p.payload #>> '{doc,title}', p.payload #>> '{written,title}', p.payload #>> '{page,name}',
				CASE WHEN p.path = '/docs' THEN 'Documentación' ELSE p.path END) AS title,
			substring(p.searchable_text FROM greatest(1, strpos(lower(p.searchable_text), lower(split_part($1, ' ', 1))) - 80) FOR 240) AS excerpt
		FROM docs_pages AS p
		JOIN docs_snapshots AS s ON s.id = p.snapshot_id
		WHERE s.active AND (p.path = '/docs' OR p.path LIKE '/docs/%')
			AND to_tsvector('simple', p.searchable_text) @@ plainto_tsquery('simple', $1)
		ORDER BY CASE
			WHEN lower(p.path) = '/docs/reference/' || lower($1) THEN 0
			WHEN lower(p.path) LIKE '%' || lower($1) || '%' THEN 1
			ELSE 2 END,
			ts_rank(to_tsvector('simple', p.searchable_text), plainto_tsquery('simple', $1)) DESC, p.path
		LIMIT $2`,
		[term, Math.min(limit, 50)],
	)
	return result.rows.map(({ url, title, excerpt, payload }) => {
		const toc = payload && typeof payload === 'object' && 'toc' in payload && Array.isArray(payload.toc) ? (payload.toc as unknown[]) : []
		const sections = toc
			.filter((item): item is { id: string; text: string } => !!item && typeof item === 'object' && 'id' in item && 'text' in item && typeof item.id === 'string' && typeof item.text === 'string')
			.filter((item) => item.text.toLocaleLowerCase().includes(term.toLocaleLowerCase()))
			.slice(0, 3)
			.map((item) => ({ url: `${url}#${encodeURIComponent(item.id)}`, title: item.text, excerpt: item.text }))
		return { url, title, excerpt, sections }
	})
}
