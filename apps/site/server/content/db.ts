import pg from 'pg'

const { Pool } = pg

export interface SnapshotPage {
	readonly path: string
	readonly payload: unknown
}

export interface SearchResult {
	readonly url: string
	readonly title: string
	readonly excerpt: string
	readonly sections: readonly { readonly url: string; readonly title: string; readonly excerpt: string }[]
}

const docsPath = /^\/docs\/[^/?#\s]+(?:\/[^/?#\s]+)*$/
let pool: pg.Pool | undefined

function validatePath(path: string): void {
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

function database(): pg.Pool {
	if (pool) return pool
	const connectionString = process.env.DATABASE_URL
	if (!connectionString?.trim()) throw new Error('DATABASE_URL is required for documentation storage')
	return (pool = new Pool({ connectionString }))
}

function searchableText(path: string, payload: unknown): string {
	const chunks: string[] = []
	const visit = (value: unknown): void => {
		if (typeof value === 'string') {
			const text = value
				.replace(/<[^>]*>/g, ' ')
				.replace(
					/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g,
					(entity) =>
						({
							'&nbsp;': ' ',
							'&amp;': '&',
							'&lt;': '<',
							'&gt;': '>',
							'&quot;': '"',
							'&apos;': "'",
							'&#39;': "'",
						})[entity] ?? entity,
				)
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

/** Replace the published set in one transaction; keep the previous version for rollback. */
export async function publishSnapshot(pages: readonly { path: string; payload: unknown }[]): Promise<void> {
	if (pages.length === 0) throw new TypeError('A documentation snapshot must contain at least one page')

	const seen = new Set<string>()
	const serialized = pages.map(({ path, payload }) => {
		validatePath(path)
		if (seen.has(path)) throw new TypeError(`Duplicate documentation URL path: ${path}`)
		seen.add(path)
		const json: string | undefined = JSON.stringify(payload)
		if (json === undefined) throw new TypeError(`Page payload is not JSON serializable: ${path}`)
		return { path, json, text: searchableText(path, JSON.parse(json) as unknown) }
	})

	const client = await database().connect()
	let transactionStarted = false
	let discardClient = false
	try {
		await client.query('BEGIN')
		transactionStarted = true
		// Serialize publishers across processes. Readers still use one MVCC snapshot per query.
		await client.query('SELECT pg_advisory_xact_lock(1735551795, 1)')
		const previous = await client.query<{ id: string }>('SELECT id FROM docs_snapshots WHERE active')
		const previousId = previous.rows[0]?.id ?? null
		const inserted = await client.query<{ id: string }>('INSERT INTO docs_snapshots DEFAULT VALUES RETURNING id')
		const snapshotId = inserted.rows[0]?.id
		if (snapshotId === undefined) throw new Error('Failed to create documentation snapshot')

		for (const page of serialized) {
			await client.query('INSERT INTO docs_pages (snapshot_id, path, payload, searchable_text) VALUES ($1, $2, $3::jsonb, $4)', [snapshotId, page.path, page.json, page.text])
		}

		await client.query('UPDATE docs_snapshots SET active = false WHERE active')
		await client.query('UPDATE docs_snapshots SET active = true WHERE id = $1', [snapshotId])
		// Keep the version that was active before this publication, even after a manual rollback.
		await client.query('DELETE FROM docs_snapshots WHERE id <> $1 AND ($2::bigint IS NULL OR id <> $2::bigint)', [snapshotId, previousId])
		await client.query('COMMIT')
		transactionStarted = false
	} catch (error) {
		if (transactionStarted) {
			try {
				await client.query('ROLLBACK')
			} catch {
				discardClient = true
			}
		}
		throw error
	} finally {
		client.release(discardClient)
	}
}

/** Return a page from the active snapshot, or null when that URL is absent. */
export async function readPage<T>(path: string): Promise<T | null> {
	validatePath(path)
	const result = await database().query<{ payload: T }>('SELECT p.payload FROM docs_pages AS p JOIN docs_snapshots AS s ON s.id = p.snapshot_id WHERE s.active AND p.path = $1', [path])
	return result.rows[0]?.payload ?? null
}

/** List the active snapshot in URL order. */
export async function listPages<T = unknown>(): Promise<readonly { path: string; payload: T }[]> {
	const result = await database().query<{ path: string; payload: T }>('SELECT p.path, p.payload FROM docs_pages AS p JOIN docs_snapshots AS s ON s.id = p.snapshot_id WHERE s.active ORDER BY p.path')
	return result.rows
}

/** Search only published documentation pages. Excerpts are plain text for the client to escape. */
export async function searchPages(query: string, limit: number): Promise<readonly SearchResult[]> {
	const term = query.trim()
	if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('Search limit must be a positive integer')
	if (term.length === 0) return []
	if (term.length > 200) throw new RangeError('Search query is too long')
	const result = await database().query<{ url: string; title: string; excerpt: string; payload: unknown }>(
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
		const toc = payload && typeof payload === 'object' && 'toc' in payload && Array.isArray(payload.toc) ? payload.toc as unknown[] : []
		const sections = toc.filter((item): item is { id: string; text: string } => !!item && typeof item === 'object' && 'id' in item && 'text' in item && typeof item.id === 'string' && typeof item.text === 'string')
			.filter((item) => item.text.toLocaleLowerCase().includes(term.toLocaleLowerCase()))
			.slice(0, 3)
			.map((item) => ({ url: `${url}#${encodeURIComponent(item.id)}`, title: item.text, excerpt: item.text }))
		return { url, title, excerpt, sections }
	})
}

/** Drain the pool when a one-shot sync process exits. */
export async function closePool(): Promise<void> {
	if (!pool) return
	const current = pool
	pool = undefined
	await current.end()
}
