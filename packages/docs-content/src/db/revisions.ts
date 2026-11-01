import type { Divergence } from '../diff'
import type { SourceOverlay } from '../sources/overlay'
import type { Database, Queryable } from './pool'
import type { SourceDetail } from './sources'

import { parseFrontmatter, parseWrittenPage } from '../content/reference'
import { gitFileExists, readGitFile } from '../content/repository'
import { divergence } from '../diff'
import { contentHash, createOverlay, normalizeText } from '../sources/overlay'
import { contentLockKey, database, lockKeys, transaction } from './pool'
import { getSource } from './sources'

/** Where a revision is in its life: being written, shown by the site, or kept as history. */
export type RevisionStatus = 'archived' | 'draft' | 'published'

/** A row of `docs_revisions`, without its Markdown. */
export interface RevisionRecord {
	readonly id: number
	readonly sourceId: number
	readonly author: string
	readonly status: RevisionStatus
	readonly note: string | null
	/** Hash of the source's Markdown of Git when it was written. */
	readonly baseHash: string | null
	readonly createdAt: Date
	readonly publishedAt: Date | null
	/**
	 * When it was last archived, or `null` (not archived, or archived before migration 003). Archiving
	 * the published revision after the active snapshot is a change the site does not show yet.
	 */
	readonly archivedAt: Date | null
}

/** A revision with its Markdown. */
export interface Revision extends RevisionRecord {
	readonly markdown: string
}

/** Input of {@link createRevision}. */
export interface NewRevision {
	readonly sourceId: number
	readonly markdown: string
	readonly author: string
	readonly note?: string
	/**
	 * Hash ({@link contentHash}) of the Git text the draft was written from. The last import's by
	 * default; a draft started from the working tree, or merged with it, passes that text's hash, so
	 * its divergence compares with the Git it saw.
	 */
	readonly baseHash?: string
}

/** Input of {@link updateDraft}. */
export interface DraftUpdate {
	readonly markdown: string
	/** Who saves it; it becomes the draft's author. */
	readonly author: string
	/** The draft's note; `null` removes it, and leaving it out keeps it. */
	readonly note?: string | null
	/**
	 * {@link contentHash} of the Markdown the editor loaded. When the stored draft has another text,
	 * someone saved it meanwhile: {@link RevisionError} `changed`, and nothing is written.
	 */
	readonly expectedHash?: string
}

/**
 * Why an operation on a revision was refused:
 *
 * - `not-found`: the revision or its source does not exist.
 * - `not-editable`: the source is a `.meeko` page or Git no longer has its file.
 * - `invalid`: the Markdown, the author or the frontmatter cannot be stored.
 * - `not-draft`: only a draft changes; published and archived revisions are history.
 * - `changed`: the draft changed since the editor loaded it.
 * - `rejected`: the render would refuse the revision, so it is not published (`reason` says why).
 * - `busy`: a publication of the documentation ({@link publishDocumentation}) is rendering, in this
 *   process or another; publishing or archiving the published revision waits until it ends.
 */
export type RevisionErrorCode = 'busy' | 'changed' | 'invalid' | 'not-draft' | 'not-editable' | 'not-found' | 'rejected'

/** An operation on a revision that was refused, with its {@link RevisionErrorCode}. */
export class RevisionError extends Error {
	override readonly name = 'RevisionError'
	readonly code: RevisionErrorCode
	/** For `rejected`, what the render reported, without the revision's prefix. */
	readonly reason: string | undefined

	constructor(code: RevisionErrorCode, message: string, options: { readonly cause?: unknown; readonly reason?: string } = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause })
		this.code = code
		this.reason = options.reason
	}
}

/** A revision as the `.md` file of its source. */
export interface ExportedRevision {
	/** Path of the file from the repository root, such as `docs/api.md`. */
	readonly file: string
	/** The file's text, ending with one newline. */
	readonly markdown: string
	readonly revisionId: number
}

/** The divergence of a source, with the source it describes. */
export interface SourceDivergence extends Divergence {
	readonly source: SourceDetail
	readonly revisionId: number | null
}

/** Longest Markdown a revision can hold, in characters. */
export const maxRevisionLength = 1_000_000

interface RevisionRow {
	id: string
	source_id: string
	author: string
	status: RevisionStatus
	note: string | null
	base_hash: string | null
	created_at: Date
	published_at: Date | null
	archived_at: Date | null
	markdown?: string
}

const columns = 'id, source_id, author, status, note, base_hash, created_at, published_at, archived_at'

function record(row: RevisionRow): RevisionRecord {
	return {
		id: Number(row.id),
		sourceId: Number(row.source_id),
		author: row.author,
		status: row.status,
		note: row.note,
		baseHash: row.base_hash,
		createdAt: row.created_at,
		publishedAt: row.published_at,
		archivedAt: row.archived_at,
	}
}

function revision(row: RevisionRow): Revision {
	return { ...record(row), markdown: row.markdown ?? '' }
}

/** A source that can be edited: one with Markdown that Git still has. */
async function editableSource(db: Queryable, sourceId: number): Promise<SourceDetail & { readonly file: string }> {
	const source = await getSource(db, sourceId)
	if (!source) throw new RevisionError('not-found', `Documentation source ${sourceId} does not exist`)
	if (source.file === null || source.markdown === null) throw new RevisionError('not-editable', `${source.site} ${source.path} is a .meeko page; its text is edited in the repository`)
	if (source.removedAt) throw new RevisionError('not-editable', `${source.site} ${source.path} no longer exists in the repository`)
	return { ...source, file: source.file }
}

/** The Markdown and author of a revision as they are stored, or {@link RevisionError} `invalid`. */
function checkedText(input: { readonly markdown: string; readonly author: string }, source: { readonly kind: string; readonly file: string }): { markdown: string; author: string } {
	const markdown = normalizeText(input.markdown)
	if (!markdown.trim()) throw new RevisionError('invalid', 'A revision cannot be empty')
	if (markdown.length > maxRevisionLength) throw new RevisionError('invalid', `A revision holds at most ${maxRevisionLength} characters`)
	const author = input.author.trim()
	if (!author || author.length > 200) throw new RevisionError('invalid', 'A revision needs an author of up to 200 characters')
	if (source.kind === 'reference') {
		try {
			parseFrontmatter(markdown, source.file)
		} catch (error) {
			throw new RevisionError('invalid', error instanceof Error ? error.message : String(error), { cause: error })
		}
	}
	return { markdown, author }
}

const hashPattern = /^[0-9a-f]{64}$/

/**
 * Stores a draft of a source's Markdown. The frontmatter of a reference page must parse, but a
 * draft may still lack fields: {@link publishRevision} checks it as the render does.
 */
export async function createRevision(db: Database, input: NewRevision): Promise<Revision> {
	if (input.baseHash !== undefined && !hashPattern.test(input.baseHash)) throw new RevisionError('invalid', 'The base hash must be a SHA-256 in hexadecimal')
	const source = await editableSource(db, input.sourceId)
	const { markdown, author } = checkedText(input, source)
	const result = await db.query<RevisionRow>(`INSERT INTO docs_revisions (source_id, markdown, author, note, base_hash) VALUES ($1, $2, $3, $4, $5) RETURNING ${columns}, markdown`, [
		source.id,
		markdown,
		author,
		input.note?.trim() || null,
		input.baseHash ?? source.baseHash,
	])
	return revision(result.rows[0]!)
}

/**
 * Saves a draft again with new Markdown: drafts are the only revisions that change. With
 * `expectedHash`, a draft that someone else saved after the editor loaded it is not overwritten
 * ({@link RevisionError} `changed`). Its base hash stays the one it was written from.
 */
export async function updateDraft(db: Database, id: number, input: DraftUpdate): Promise<Revision> {
	if (input.expectedHash !== undefined && !hashPattern.test(input.expectedHash)) throw new RevisionError('invalid', 'The expected hash must be a SHA-256 in hexadecimal')
	return transaction(db, async (client) => {
		const found = await client.query<RevisionRow>(`SELECT ${columns}, markdown FROM docs_revisions WHERE id = $1 FOR UPDATE`, [id])
		const row = found.rows[0]
		if (!row) throw new RevisionError('not-found', `Revision ${id} does not exist`)
		if (row.status !== 'draft') throw new RevisionError('not-draft', `Revision ${id} is ${row.status}; only a draft changes`)
		if (input.expectedHash !== undefined && contentHash(row.markdown ?? '') !== input.expectedHash) throw new RevisionError('changed', `Revision ${id} changed since it was loaded`)
		const source = await editableSource(client, Number(row.source_id))
		const { markdown, author } = checkedText(input, source)
		const note = input.note === undefined ? row.note : input.note?.trim() || null
		const result = await client.query<RevisionRow>(`UPDATE docs_revisions SET markdown = $2, author = $3, note = $4 WHERE id = $1 RETURNING ${columns}, markdown`, [id, markdown, author, note])
		return revision(result.rows[0]!)
	})
}

/** The revisions of a source, newest first, without their Markdown. */
export async function listRevisions(db: Queryable, sourceId: number, options: { readonly status?: RevisionStatus; readonly limit?: number } = {}): Promise<RevisionRecord[]> {
	const limit = options.limit ?? 100
	if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('The limit must be a positive integer')
	const result = await db.query<RevisionRow>(`SELECT ${columns} FROM docs_revisions WHERE source_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY created_at DESC, id DESC LIMIT $3`, [sourceId, options.status ?? null, Math.min(limit, 1000)])
	return result.rows.map(record)
}

/** A revision with its Markdown, or `null` when it does not exist. */
export async function getRevision(db: Queryable, id: number): Promise<Revision | null> {
	const result = await db.query<RevisionRow>(`SELECT ${columns}, markdown FROM docs_revisions WHERE id = $1`, [id])
	const row = result.rows[0]
	return row ? revision(row) : null
}

/**
 * Throws unless the render accepts `markdown` as the text of `source`: a reference page needs the
 * complete frontmatter that the site renders its title, symbols and links from.
 */
export function assertPublishable(source: { readonly kind: string; readonly file: string }, markdown: string): void {
	if (source.kind === 'reference') parseWrittenPage(normalizeText(markdown), source.file)
}

/**
 * Locks a revision for the rest of the transaction, after its source: every change of the published
 * revision of a source takes the source first and then the revision, so two of them never wait for
 * each other in opposite orders. {@link updateDraft} only takes the revision. Returns the row as it is
 * under the lock, with its Markdown.
 */
async function lockRevision(client: Queryable, id: number): Promise<RevisionRow> {
	// A revision never moves to another source, so its source can be read before locking anything.
	const head = await client.query<{ source_id: string }>('SELECT source_id FROM docs_revisions WHERE id = $1', [id])
	const sourceId = head.rows[0]?.source_id
	if (sourceId === undefined) throw new RevisionError('not-found', `Revision ${id} does not exist`)
	await client.query('SELECT id FROM docs_sources WHERE id = $1 FOR UPDATE', [sourceId])
	const found = await client.query<RevisionRow>(`SELECT ${columns}, markdown FROM docs_revisions WHERE id = $1 FOR UPDATE`, [id])
	const row = found.rows[0]
	if (!row) throw new RevisionError('not-found', `Revision ${id} does not exist`)
	return row
}

/**
 * Takes the shared side of the content lock until the transaction ends, or throws
 * {@link RevisionError} `busy` while a render of the site holds it ({@link publishDocumentation}).
 * It never waits, so it cannot deadlock with the row locks taken before it: a render reads the
 * revisions either before this change or after it commits, never in the middle.
 */
async function lockContent(client: Queryable, id: number): Promise<void> {
	const result = await client.query<{ locked: boolean }>(`SELECT pg_try_advisory_xact_lock_shared($1, ${contentLockKey}) AS locked`, [lockKeys.content])
	if (result.rows[0]?.locked !== true) throw new RevisionError('busy', `Revision ${id} cannot change while the documentation is being published; try again when it ends`)
}

/**
 * Makes a revision the published text of its source, archiving the one that was published. The
 * site shows it from the next snapshot ({@link publishDocumentation}). A revision the render would
 * reject, such as a reference page without `since`, is refused and the published one stays.
 *
 * The Markdown it checks is the one it publishes: it locks the source and the revision, reads the
 * text under that lock and checks it in the same transaction, so a draft saved meanwhile is either
 * saved before (and checked) or waits until the publication commits (and is then refused, because
 * it is no longer a draft). While a publication of the documentation renders it throws
 * {@link RevisionError} `busy` and changes nothing.
 *
 * A draft or an archived revision can be published: publishing an archived one restores that text,
 * with a new publication date, so it is pending until the next snapshot. Publishing the published
 * one again keeps its date.
 */
export async function publishRevision(db: Database, id: number): Promise<Revision> {
	return transaction(db, async (client) => {
		const row = await lockRevision(client, id)
		await lockContent(client, id)
		const source = await editableSource(client, Number(row.source_id))
		try {
			assertPublishable(source, row.markdown ?? '')
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error)
			throw new RevisionError('rejected', `Revision ${id} cannot be published: ${reason}`, { cause: error, reason })
		}
		await client.query("UPDATE docs_revisions SET status = 'archived', archived_at = clock_timestamp() WHERE source_id = $1 AND status = 'published' AND id <> $2", [row.source_id, id])
		// The time of this statement, not of the transaction's start: it runs under the content lock, so
		// it is later than every snapshot that did not read it and earlier than every one that did.
		const result = await client.query<RevisionRow>(
			`UPDATE docs_revisions SET status = 'published', archived_at = NULL, published_at =CASE WHEN status = 'published' THEN published_at ELSE clock_timestamp() END
			WHERE id = $1 RETURNING ${columns}, markdown`,
			[id],
		)
		return revision(result.rows[0]!)
	})
}

/**
 * Archives a revision. Archiving the published one makes the site show Git again from the next
 * snapshot, so, as {@link publishRevision}, it throws {@link RevisionError} `busy` while a
 * publication of the documentation renders; a draft or an archived revision is archived at once.
 */
export async function archiveRevision(db: Database, id: number): Promise<Revision> {
	return transaction(db, async (client) => {
		const row = await lockRevision(client, id)
		if (row.status === 'published') await lockContent(client, id)
		const result = await client.query<RevisionRow>(`UPDATE docs_revisions SET status = 'archived', archived_at = CASE WHEN status = 'archived' THEN archived_at ELSE clock_timestamp() END WHERE id = $1 RETURNING ${columns}, markdown`, [id])
		return revision(result.rows[0]!)
	})
}

/** The published revisions of the site's current sources, as the overlay of a render. */
export async function publishedOverlay(db: Queryable = database()): Promise<SourceOverlay> {
	const result = await db.query<{ file: string; markdown: string }>(
		`SELECT s.source_file AS file, r.markdown
		FROM docs_revisions AS r JOIN docs_sources AS s ON s.id = r.source_id
		WHERE r.status = 'published' AND s.site = 'site' AND s.source_file IS NOT NULL AND s.removed_at IS NULL
		ORDER BY s.source_file`,
	)
	return createOverlay(result.rows)
}

/** How the published revision of a source relates to its file in Git now. */
export async function sourceDivergence(db: Queryable, sourceId: number): Promise<SourceDivergence> {
	const source = await getSource(db, sourceId)
	if (!source) throw new Error(`Documentation source ${sourceId} does not exist`)
	if (source.file === null) throw new Error(`${source.site} ${source.path} is a .meeko page without Markdown`)
	const published = source.publishedRevisionId === null ? null : await getRevision(db, source.publishedRevisionId)
	const git = gitFileExists(source.file) ? readGitFile(source.file) : null
	return {
		...divergence({ git, importedHash: source.baseHash, published: published && { markdown: published.markdown, baseHash: published.baseHash }, file: source.file }),
		source,
		revisionId: published?.id ?? null,
	}
}

/**
 * A revision as the text of its `.md` file, to commit to the repository by hand. Nothing is written
 * to disk.
 */
export async function exportRevision(db: Queryable, id: number): Promise<ExportedRevision> {
	const found = await getRevision(db, id)
	if (!found) throw new RevisionError('not-found', `Revision ${id} does not exist`)
	const source = await getSource(db, found.sourceId)
	if (!source?.file) throw new RevisionError('not-editable', `Revision ${id} belongs to a source without a Markdown file`)
	return { file: source.file, markdown: `${normalizeText(found.markdown).replace(/\n*$/, '')}\n`, revisionId: found.id }
}
