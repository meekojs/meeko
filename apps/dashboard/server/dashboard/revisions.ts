// The editing of the site's Markdown: drafts, publication and archiving of revisions, comparisons,
// conflicts with Git and the export to `.md`. Every function takes the database and returns the
// shapes of shared/schemas/dashboard.ts; the failures of meeko-docs-content become public codes.
import type { Database, Queryable, Revision, RevisionRecord, SourceDetail as StoredSource } from 'meeko-docs-content/db'

import { ApiError } from '@meekojs/meeko/server'
import { gitFileExists, readGitFile } from 'meeko-docs-content/content/repository'
import { archiveRevision, createRevision, exportRevision, getRevision, getSource, listSnapshots, publishRevision, revisionConflict, RevisionError, updateDraft } from 'meeko-docs-content/db'
import { diffLines, unifiedDiff } from 'meeko-docs-content/diff'
import { createHash } from 'node:crypto'

import type { CompareSide, Comparison, Conflict, Editor, ExportedFile, PendingList, RevisionDetail, RevisionRow, SaveDraft } from '../../shared/schemas/dashboard'

import { maxMarkdownBytes } from '../../shared/schemas/dashboard'
import { databaseTask } from './errors'

/** {@link contentHash} of meeko-docs-content: SHA-256 of the text with `\n` line endings. */
export const textHash = (text: string): string => createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('hex')

/** The text of a source's file in Git now, or `null` when Git no longer has it. */
export function gitText(file: string | null): string | null {
	return file !== null && gitFileExists(file) ? readGitFile(file) : null
}

/** When the active snapshot was published, or `null` without one: later publications are pending. */
export async function activeSince(db: Queryable): Promise<Date | null> {
	return (await listSnapshots(db)).find((snapshot) => snapshot.active)?.publishedAt ?? null
}

/**
 * Whether the site does not show a revision's state yet, compared with the active snapshot published
 * at `since`: a revision published after it, or the published one that the snapshot has and that
 * was archived after it without another taking its place (`sourceHasPublished`), so the next
 * snapshot brings Git back. Without an active snapshot, every published revision is pending and no
 * archived one is.
 */
export function isPending(revision: Pick<RevisionRecord, 'archivedAt' | 'publishedAt' | 'status'>, since: Date | null, sourceHasPublished: boolean): boolean {
	if (revision.status === 'published') return revision.publishedAt !== null && (since === null || revision.publishedAt > since)
	return revision.status === 'archived' && !sourceHasPublished && since !== null && revision.publishedAt !== null && revision.publishedAt <= since && revision.archivedAt !== null && revision.archivedAt > since
}

/**
 * A revision as the pages list it, with its conflict with Git and whether the site shows it yet
 * ({@link isPending}; `sourceHasPublished` says whether its source has a published revision now).
 */
export function revisionRow(revision: RevisionRecord, gitHash: string | null, since: Date | null, sourceHasPublished = false): RevisionRow {
	return {
		id: revision.id,
		author: revision.author,
		status: revision.status,
		note: revision.note,
		baseHash: revision.baseHash,
		createdAt: revision.createdAt.toISOString(),
		publishedAt: revision.publishedAt?.toISOString() ?? null,
		archivedAt: revision.archivedAt?.toISOString() ?? null,
		conflict: gitHash !== null && revision.baseHash !== null && revision.baseHash !== gitHash,
		pending: isPending(revision, since, sourceHasPublished),
	}
}

function revisionDetail(revision: Revision, gitHash: string | null, since: Date | null, sourceHasPublished = false): RevisionDetail {
	return { ...revisionRow(revision, gitHash, since, sourceHasPublished), sourceId: revision.sourceId, markdown: revision.markdown }
}

/**
 * Runs an operation on revisions with its failures as public codes. The public message of a
 * refusal, such as the frontmatter that the render rejects, travels as an issue of the form.
 */
export function revisionTask<T>(task: () => Promise<T>): Promise<T> {
	return databaseTask(async () => {
		try {
			return await task()
		} catch (error) {
			if (!(error instanceof RevisionError)) throw error
			const issue = (message: string) => ({ message: error.message, issues: [{ path: '', message }] })
			switch (error.code) {
				case 'not-found':
					throw new ApiError(/^Documentation source/.test(error.message) ? 'SOURCE_NOT_FOUND' : 'REVISION_NOT_FOUND', 404, error.message)
				case 'not-editable':
					throw new ApiError('SOURCE_NOT_EDITABLE', 409, issue(error.message))
				case 'invalid':
					throw new ApiError('INVALID_REVISION', 422, issue(error.message))
				case 'not-draft':
					throw new ApiError('REVISION_NOT_DRAFT', 409, error.message)
				case 'changed':
					throw new ApiError('DRAFT_CHANGED', 409, error.message)
				case 'rejected':
					throw new ApiError('REVISION_REJECTED', 422, issue(error.reason ?? error.message))
				case 'busy':
					// A publication of the documentation renders, from this dashboard or another process.
					throw new ApiError('JOB_RUNNING', 409, error.message)
			}
		}
	})
}

/** A source that the editor can change: a guide or reference page whose file Git still has. */
async function editable(db: Queryable, sourceId: number): Promise<StoredSource & { readonly file: string }> {
	const source = await getSource(db, sourceId)
	if (!source) throw new ApiError('SOURCE_NOT_FOUND', 404, `Documentation source ${sourceId} does not exist`)
	if (source.file === null || source.kind === 'page') throw new ApiError('SOURCE_NOT_EDITABLE', 409, { message: 'A .meeko page is edited in the repository', issues: [{ path: '', message: 'issues.meekoPage' }] })
	if (source.removedAt !== null || !gitFileExists(source.file)) throw new ApiError('SOURCE_NOT_EDITABLE', 409, { message: 'Git no longer has the file', issues: [{ path: '', message: 'issues.gitMissing' }] })
	return { ...source, file: source.file }
}

/** A revision of `sourceId`, or `404 REVISION_NOT_FOUND`. */
async function revisionOf(db: Queryable, sourceId: number, id: number): Promise<Revision> {
	const revision = await getRevision(db, id)
	if (!revision || revision.sourceId !== sourceId) throw new ApiError('REVISION_NOT_FOUND', 404, `Revision ${id} is not a revision of source ${sourceId}`)
	return revision
}

/**
 * What the editor opens: a draft to edit, or the text a new draft starts from. With `revisionId`
 * of a draft, that draft; of another revision, a new draft from its text and its base. Without it,
 * a new draft from the published revision when there is one, or else from Git now.
 */
export async function readEditor(db: Queryable, sourceId: number, revisionId: number | undefined, statusOf: (source: StoredSource) => Promise<Editor['source']>): Promise<Omit<Editor, 'original'>> {
	const source = await editable(db, sourceId)
	const git = gitText(source.file)
	const gitHash = git === null ? null : textHash(git)
	const since = await activeSince(db)
	const base = { source: await statusOf(source), gitHash, maxBytes: maxMarkdownBytes }
	const chosen = revisionId === undefined ? (source.publishedRevisionId === null ? null : await getRevision(db, source.publishedRevisionId)) : await revisionOf(db, sourceId, revisionId)
	if (chosen?.status === 'draft') return { ...base, revision: revisionDetail(chosen, gitHash, since), start: { markdown: chosen.markdown, from: 'draft', revisionId: chosen.id, baseHash: chosen.baseHash } }
	if (chosen) return { ...base, revision: null, start: { markdown: chosen.markdown, from: 'revision', revisionId: chosen.id, baseHash: chosen.baseHash } }
	return { ...base, revision: null, start: { markdown: git ?? source.markdown ?? '', from: 'git', revisionId: null, baseHash: gitHash } }
}

/** Creates a draft, or saves one again with `revisionId`, signed by `input.author` (the user of the session). */
export async function saveDraft(db: Database, input: SaveDraft & { readonly author: string }): Promise<RevisionDetail> {
	const source = await editable(db, input.sourceId)
	const gitHash = textHash(readGitFile(source.file))
	const since = await activeSince(db)
	if (input.revisionId !== undefined) {
		await revisionOf(db, input.sourceId, input.revisionId)
		const saved = await updateDraft(db, input.revisionId, { markdown: input.markdown, author: input.author, note: input.note ?? null, ...(input.expectedHash ? { expectedHash: input.expectedHash } : {}) })
		return revisionDetail(saved, gitHash, since)
	}
	const created = await createRevision(db, { sourceId: input.sourceId, markdown: input.markdown, author: input.author, ...(input.note ? { note: input.note } : {}), ...(input.baseHash ? { baseHash: input.baseHash } : {}) })
	return revisionDetail(created, gitHash, since)
}

/** Publishes a revision: the site shows it from the next snapshot. */
export async function publish(db: Database, id: number): Promise<RevisionDetail> {
	const revision = await publishRevision(db, id)
	const source = await getSource(db, revision.sourceId)
	const git = gitText(source?.file ?? null)
	return revisionDetail(revision, git === null ? null : textHash(git), await activeSince(db))
}

/** Archives a revision; archiving the published one brings Git back from the next snapshot. */
export async function archive(db: Database, id: number): Promise<RevisionDetail> {
	const revision = await archiveRevision(db, id)
	const source = await getSource(db, revision.sourceId)
	const git = gitText(source?.file ?? null)
	return revisionDetail(revision, git === null ? null : textHash(git), await activeSince(db), (source?.publishedRevisionId ?? null) !== null)
}

/** The unified diff between two sides of a source: two revisions, or a revision and Git now. */
export async function compare(db: Queryable, sourceId: number, from: CompareSide, to: CompareSide): Promise<Comparison> {
	const source = await getSource(db, sourceId)
	if (!source?.file) throw new ApiError('SOURCE_NOT_FOUND', 404, `Documentation source ${sourceId} has no Markdown`)
	const side = async (choice: CompareSide): Promise<{ text: string; label: string }> => {
		if (choice.kind === 'git') {
			const git = gitText(source.file)
			if (git === null) throw new ApiError('SOURCE_NOT_EDITABLE', 409, { message: 'Git no longer has the file', issues: [{ path: '', message: 'issues.gitMissing' }] })
			// Technical labels of the diff header; the screen names the sides in its language.
			return { text: git, label: 'git' }
		}
		return { text: (await revisionOf(db, sourceId, choice.id)).markdown, label: `revision-${choice.id}` }
	}
	const [a, b] = [await side(from), await side(to)]
	try {
		const lines = diffLines(a.text, b.text)
		return {
			diff: unifiedDiff(a.text, b.text, { from: a.label, to: b.label }),
			added: lines.filter((line) => line.type === 'add').length,
			removed: lines.filter((line) => line.type === 'remove').length,
			fromLabel: a.label,
			toLabel: b.label,
			tooLarge: false,
		}
	} catch (error) {
		if (error instanceof RangeError) return { diff: '', added: 0, removed: 0, fromLabel: a.label, toLabel: b.label, tooLarge: true }
		throw error
	}
}

/** The three sides of a revision against the Git of now, with the trivial merge when there is one. */
export async function readConflict(db: Queryable, id: number): Promise<Conflict> {
	const found = await revisionConflict(db, id)
	return {
		revisionId: id,
		state: found.state,
		gitHash: found.gitHash,
		baseHash: found.revision.baseHash,
		baseOrigin: found.base?.origin.kind ?? null,
		baseCommit: found.base?.origin.kind === 'commit' ? found.base.origin.commit : null,
		diffs: found.diffs,
		merge: found.merge && (found.merge.clean ? { clean: true, conflicts: 0 } : { clean: false, conflicts: found.merge.conflicts }),
	}
}

/**
 * A new draft with the Git of now and the revision's changes, written from that Git. Only a
 * trivial merge: `409 MERGE_NOT_TRIVIAL` when both sides changed the same lines or the base text
 * cannot be found.
 */
export async function mergeWithGit(db: Database, id: number, author: string, note: string | undefined): Promise<RevisionDetail> {
	const found = await revisionConflict(db, id)
	if (found.state !== 'conflict') throw new ApiError('NO_CONFLICT', 409, `Revision ${id} was written from the Git of now`)
	if (!found.merge?.clean || found.gitHash === null) throw new ApiError('MERGE_NOT_TRIVIAL', 409, `Revision ${id} cannot be merged with Git automatically`)
	const created = await createRevision(db, { sourceId: found.revision.sourceId, markdown: found.merge.markdown, author, note: note || `Current Git + changes of revision #${id}`, baseHash: found.gitHash })
	return revisionDetail(created, found.gitHash, await activeSince(db))
}

/** A revision as the text of its `.md` file, for the browser to download. Nothing is written. */
export async function exportFile(db: Queryable, id: number): Promise<ExportedFile> {
	const exported = await exportRevision(db, id)
	const name = exported.file.split('/').pop() ?? 'revision.md'
	return { file: exported.file, filename: name, markdown: exported.markdown, revisionId: exported.revisionId }
}

/**
 * The changes of revisions that the active snapshot does not have yet, the next publication's
 * ({@link isPending}): revisions published after it, and published revisions it has that were
 * archived after it without another one published in their place, whose page goes back to Git.
 */
export async function readPending(db: Queryable): Promise<PendingList> {
	const active = (await listSnapshots(db)).find((snapshot) => snapshot.active) ?? null
	const result = await db.query<{ id: string; source_id: string; title: string; path: string; locale: 'en' | 'es'; author: string; status: 'archived' | 'published'; published_at: Date; archived_at: Date | null }>(
		`SELECT r.id, r.source_id, s.title, s.path, s.locale, r.author, r.status, r.published_at, r.archived_at
		FROM docs_revisions AS r JOIN docs_sources AS s ON s.id = r.source_id
		WHERE s.removed_at IS NULL AND (
			(r.status = 'published' AND ($1::timestamptz IS NULL OR r.published_at > $1))
			OR (r.status = 'archived' AND $1::timestamptz IS NOT NULL AND r.published_at <= $1 AND r.archived_at > $1
				AND NOT EXISTS (SELECT 1 FROM docs_revisions AS p WHERE p.source_id = r.source_id AND p.status = 'published'))
		)
		ORDER BY coalesce(r.archived_at, r.published_at) DESC, r.id DESC`,
		[active?.publishedAt ?? null],
	)
	return {
		activeSnapshotId: active?.id ?? null,
		revisions: result.rows.map((row) => ({
			id: Number(row.id),
			sourceId: Number(row.source_id),
			title: row.title,
			path: row.path,
			locale: row.locale,
			author: row.author,
			change: row.status,
			publishedAt: row.published_at.toISOString(),
			archivedAt: row.archived_at?.toISOString() ?? null,
		})),
	}
}
