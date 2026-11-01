import type { DivergenceState } from '../diff'
import type { Queryable } from './pool'
import type { SourceFilter, SourceRecord } from './sources'

import { gitFileExists, readGitFile } from '../content/repository'
import { divergence } from '../diff'
import { database } from './pool'
import { listSources } from './sources'

/** A source with how its published revision relates to Git now, without the diff. */
export interface SourceStatus extends SourceRecord {
	/** {@link DivergenceState} of a Markdown source, or `null` for a `.meeko` page, which has no text here. */
	readonly state: DivergenceState | null
	/** Git differs from the Markdown of the last import: import the sources again. */
	readonly importStale: boolean
	/** Lines the published revision adds to and removes from Git. */
	readonly added: number
	readonly removed: number
}

/**
 * The sources of {@link listSources} with their divergence, in one query for their published
 * revisions and one read of each Markdown file of Git: the overview of the dashboard, which
 * {@link sourceDivergence} would make one query per source. The diff itself stays in
 * `sourceDivergence`.
 */
export async function listSourceStatuses(db: Queryable = database(), filter: SourceFilter = {}): Promise<SourceStatus[]> {
	const sources = await listSources(db, filter)
	const ids = sources.filter((source) => source.publishedRevisionId !== null).map((source) => source.publishedRevisionId!)
	const published = new Map<number, { readonly markdown: string; readonly baseHash: string | null }>()
	if (ids.length) {
		const result = await db.query<{ id: string; markdown: string; base_hash: string | null }>('SELECT id, markdown, base_hash FROM docs_revisions WHERE id = ANY($1::bigint[])', [ids])
		for (const row of result.rows) published.set(Number(row.id), { markdown: row.markdown, baseHash: row.base_hash })
	}
	return sources.map((source): SourceStatus => {
		if (source.file === null) return { ...source, state: null, importStale: false, added: 0, removed: 0 }
		const git = gitFileExists(source.file) ? readGitFile(source.file) : null
		const revision = source.publishedRevisionId === null ? null : (published.get(source.publishedRevisionId) ?? null)
		const { state, importStale, added, removed } = divergence({ git, importedHash: source.baseHash, published: revision, file: source.file })
		return { ...source, state, importStale, added, removed }
	})
}
