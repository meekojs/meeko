// What the pages read, shaped as the schemas of shared/schemas/dashboard.ts: plain JSON with dates
// as ISO strings.
import type { Queryable, SnapshotSummary, SourceRecord } from 'meeko-docs-content/db'
import type { SourceStatus } from 'meeko-docs-content/status'

import { ApiError } from '@meekojs/meeko/server'
import { gitFileExists, readGitFile } from 'meeko-docs-content/content/repository'
import { getSource, listRevisions, sourceDivergence } from 'meeko-docs-content/db'
import { listSnapshots } from 'meeko-docs-content/snapshots'
import { listSourceStatuses } from 'meeko-docs-content/status'

import type { DocsSite, Jobs, Overview, SiteSummary, SnapshotRow, SourceDetail, SourceKind, SourceRow } from '../../shared/schemas/dashboard'

import { activeSince, revisionRow, textHash } from './revisions'

/** The webs in the order of the dashboard. */
export const sites: readonly DocsSite[] = ['site', 'ui', 'i18n']

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null)

export function sourceRow(source: SourceStatus): SourceRow {
	return {
		id: source.id,
		site: source.site,
		path: source.path,
		kind: source.kind,
		title: source.title,
		file: source.file,
		baseHash: source.baseHash,
		importedAt: source.importedAt.toISOString(),
		removedAt: iso(source.removedAt),
		publishedRevisionId: source.publishedRevisionId,
		state: source.state,
		importStale: source.importStale,
		added: source.added,
		removed: source.removed,
	}
}

export function snapshotRow(snapshot: SnapshotSummary): SnapshotRow {
	return { id: snapshot.id, publishedAt: snapshot.publishedAt.toISOString(), active: snapshot.active, pages: snapshot.pages, publishedBy: snapshot.publishedBy, note: snapshot.note }
}

/** Counts of each web: sources by kind and by state, and its last import. Removed sources are counted apart. */
export function summarize(rows: readonly SourceRow[]): SiteSummary[] {
	return sites.map((site) => {
		const own = rows.filter((row) => row.site === site)
		const current = own.filter((row) => row.removedAt === null)
		const kinds: Record<SourceKind, number> = { guide: 0, reference: 0, page: 0 }
		const states: SiteSummary['states'] = { git: 0, same: 0, edited: 0, conflict: 0, missing: 0 }
		for (const row of current) {
			kinds[row.kind]++
			if (row.state) states[row.state]++
		}
		const lastImportedAt = own.reduce<string | null>((latest, row) => (latest === null || row.importedAt > latest ? row.importedAt : latest), null)
		return { site, total: current.length, kinds, states, importStale: current.filter((row) => row.importStale).length, removed: own.length - current.length, lastImportedAt }
	})
}

/** Every source, removed ones included, with its divergence. */
export async function readSources(db: Queryable, filter: { readonly site?: DocsSite | undefined; readonly kind?: SourceKind | undefined; readonly includeRemoved?: boolean | undefined } = {}): Promise<SourceRow[]> {
	const rows = await listSourceStatuses(db, { ...(filter.site ? { site: filter.site } : {}), ...(filter.kind ? { kind: filter.kind } : {}), includeRemoved: filter.includeRemoved ?? true })
	return rows.map(sourceRow)
}

export async function readSnapshots(db: Queryable): Promise<SnapshotRow[]> {
	return (await listSnapshots(db)).map(snapshotRow)
}

/** The Resumen: each web's counts and the active snapshot. */
export async function readOverview(db: Queryable, jobs: Jobs): Promise<Overview> {
	const [rows, snapshots] = await Promise.all([readSources(db), readSnapshots(db)])
	return { sites: summarize(rows), activeSnapshot: snapshots.find((snapshot) => snapshot.active) ?? null, snapshots: snapshots.length, jobs }
}

/** One source with its divergence, as the tables list it. */
export async function readSourceRow(db: Queryable, source: SourceRecord): Promise<SourceRow> {
	const [status] = (await listSourceStatuses(db, { site: source.site, kind: source.kind, includeRemoved: true })).filter((candidate) => candidate.id === source.id)
	if (!status) throw new ApiError('SOURCE_NOT_FOUND', 404, `Documentation source ${source.id} does not exist`)
	return sourceRow(status)
}

/** A source with its revisions and the diff from Git to its published revision. */
export async function readSourceDetail(db: Queryable, id: number): Promise<SourceDetail> {
	const source = await getSource(db, id)
	if (!source) throw new ApiError('SOURCE_NOT_FOUND', 404, `Documentation source ${id} does not exist`)
	const row = await readSourceRow(db, source)
	const gitHash = source.file !== null && gitFileExists(source.file) ? textHash(readGitFile(source.file)) : null
	const since = await activeSince(db)
	const revisions = (await listRevisions(db, id, { limit: 200 })).map((revision) => revisionRow(revision, gitHash, since, source.publishedRevisionId !== null))
	const editable = source.kind !== 'page' && source.removedAt === null && gitHash !== null
	if (source.file === null) return { source: row, revisions, diff: '', gitHash: null, editable }
	const divergence = await sourceDivergence(db, id)
	return { source: row, revisions, diff: divergence.diff, gitHash, editable }
}
