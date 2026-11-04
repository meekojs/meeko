import type { Queryable } from './pool'
import type { Revision } from './revisions'
import type { SourceDetail } from './sources'

import { gitFileExists, readGitFile } from '../content/repository'
import { mergeThreeWay, unifiedDiff } from '../diff'
import { findGitVersion } from '../sources/history'
import { contentHash } from '../sources/overlay'
import { getRevision, RevisionError } from './revisions'
import { getSource } from './sources'

/**
 * Where the base text of a revision was found: the Markdown of the last import, the working tree,
 * a commit of the file's history, or nowhere (`null`).
 */
export type BaseOrigin = { readonly kind: 'import' } | { readonly kind: 'working-tree' } | { readonly kind: 'commit'; readonly commit: string }

/** How a revision relates to the Git it was written from and the Git of now. */
export interface RevisionConflict {
	readonly revision: Revision
	readonly source: SourceDetail
	/**
	 * - `current`: the revision was written from the Git of now (or has no base hash).
	 * - `conflict`: Git changed after the revision was written.
	 * - `missing`: Git no longer has the file.
	 */
	readonly state: 'conflict' | 'current' | 'missing'
	/** {@link contentHash} of the file in Git now, or `null` when it no longer exists. */
	readonly gitHash: string | null
	/** The text the revision was written from, when it can be found. */
	readonly base: { readonly markdown: string; readonly origin: BaseOrigin } | null
	/** The file in Git now. */
	readonly git: string | null
	/** Unified diffs between the three sides; empty when a side is missing or they are equal. */
	readonly diffs: { readonly baseToGit: string; readonly baseToRevision: string; readonly gitToRevision: string }
	/**
	 * The revision's changes over the Git of now, when the merge is trivial (see
	 * {@link mergeThreeWay}); `null` without a conflict or a base, and `{ clean: false }` when both
	 * sides changed the same lines.
	 */
	readonly merge: { readonly clean: true; readonly markdown: string } | { readonly clean: false; readonly conflicts: number } | null
}

/** The base text of a revision whose hash is `hash`: from the import, the working tree or the history. */
export function findBase(source: SourceDetail & { readonly file: string }, hash: string, git: string | null): RevisionConflict['base'] {
	if (source.markdown !== null && source.baseHash === hash) return { markdown: source.markdown, origin: { kind: 'import' } }
	if (git !== null && contentHash(git) === hash) return { markdown: git, origin: { kind: 'working-tree' } }
	const found = findGitVersion(source.file, hash)
	return found ? { markdown: found.text, origin: { kind: 'commit', commit: found.commit } } : null
}

/**
 * The three sides of a revision: the Git text it was written from (its base hash), the file in Git
 * now and the revision. A revision is in conflict when its base is not the Git of now. The base is
 * looked up in the last import, the working tree and the file's history; a base that never reached
 * a commit cannot be found, and then only Git and the revision are compared, without a merge.
 */
export async function revisionConflict(db: Queryable, id: number): Promise<RevisionConflict> {
	const revision = await getRevision(db, id)
	if (!revision) throw new RevisionError('not-found', `Revision ${id} does not exist`)
	const source = await getSource(db, revision.sourceId)
	if (!source?.file) throw new RevisionError('not-editable', `Revision ${id} belongs to a source without a Markdown file`)
	const file = source.file
	const git = gitFileExists(file) ? readGitFile(file) : null
	const gitHash = git === null ? null : contentHash(git)
	const state = git === null ? 'missing' : revision.baseHash === null || revision.baseHash === gitHash ? 'current' : 'conflict'
	const base = revision.baseHash === null ? null : findBase({ ...source, file }, revision.baseHash, git)
	const names = { base: `base/${file}`, git: `git/${file}`, revision: `revision-${id}/${file}` }
	const diffs = {
		baseToGit: base && git !== null ? safeDiff(base.markdown, git, names.base, names.git) : '',
		baseToRevision: base ? safeDiff(base.markdown, revision.markdown, names.base, names.revision) : '',
		gitToRevision: git === null ? '' : safeDiff(git, revision.markdown, names.git, names.revision),
	}
	let merge: RevisionConflict['merge'] = null
	if (state === 'conflict' && base && git !== null) {
		const result = mergeThreeWay(base.markdown, git, revision.markdown)
		merge = result.clean ? { clean: true, markdown: result.text } : { clean: false, conflicts: result.conflicts }
	}
	return { revision, source, state, gitHash, base, git, diffs, merge }
}

/** A unified diff, or a one-line note when the texts are too different to compare line by line. */
function safeDiff(before: string, after: string, from: string, to: string): string {
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
