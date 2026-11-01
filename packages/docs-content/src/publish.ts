import type { Database } from './db/pool'

import { contentLockKey, database, lockKeys } from './db/pool'
import { publishedOverlay } from './db/revisions'
import { activeSnapshot, publishSnapshot } from './db/snapshots'
import { buildSnapshotPages } from './snapshot'

/** Options of {@link publishDocumentation}. */
export interface PublishDocumentationOptions {
	/** Who or what publishes, such as `docs:sync` or the user of the dashboard. */
	readonly publishedBy?: string
	readonly note?: string
	/** Snapshots kept after publishing: see {@link PublishSnapshotOptions.keep}. */
	readonly keep?: number
	/**
	 * Called once the publication has read the active snapshot it builds on and the published
	 * revisions, right before the render: from then on, a rollback or another publication that
	 * commits makes it fail with {@link SnapshotConflictError}. A job reports it as progress.
	 */
	readonly onRender?: (state: { readonly activeSnapshotId: number | null; readonly revisions: number }) => void
}

/** What {@link publishDocumentation} published. */
export interface PublishedDocumentation {
	readonly snapshotId: number
	readonly pages: number
	/** Files rendered from a published revision instead of Git, from the repository root. */
	readonly revisions: readonly string[]
}

/**
 * Runs `task` holding the exclusive side of the content lock of the database: while it runs, no
 * revision is published or archived ({@link publishRevision} and {@link archiveRevision} throw
 * `busy`), in this process or another. It waits for the changes that already hold the shared side
 * to commit, so `task` reads them. The lock lives in a connection of its own that `task` does not
 * use: the database drops it if the process dies.
 */
export async function withContentLock<T>(db: Database, task: () => Promise<T>): Promise<T> {
	const client = await db.connect()
	let locked = false
	let discard = false
	try {
		// The connection has the search path of `db`: the key is the schema whose revisions it renders.
		await client.query(`SELECT pg_advisory_lock($1, ${contentLockKey})`, [lockKeys.content])
		locked = true
		return await task()
	} finally {
		if (locked) {
			try {
				await client.query(`SELECT pg_advisory_unlock($1, ${contentLockKey})`, [lockKeys.content])
			} catch {
				// A connection that may still hold the lock never goes back to the pool.
				discard = true
			}
		}
		client.release(discard)
	}
}

/**
 * Renders every page of the site with the published revisions over the files of Git and activates
 * the result as a new snapshot. Until it commits, readers see the previous snapshot; when the
 * render fails nothing is stored.
 *
 * From before it reads the revisions until the snapshot commits it holds the content lock
 * ({@link withContentLock}): the snapshot has exactly the revisions that were published when it
 * started, and a revision published or archived after it is pending for the next one. Two
 * publications wait for each other.
 *
 * It never undoes what committed while it rendered: if a rollback ({@link activateSnapshot}) or
 * another publication changed the active snapshot after it started, even back to the same one, it
 * throws {@link SnapshotConflictError}, stores nothing and leaves that snapshot active. Publish again to
 * render from the new state. A rollback that commits after it does wins, as the later action.
 */
export async function publishDocumentation(db: Database = database(), options: PublishDocumentationOptions = {}): Promise<PublishedDocumentation> {
	return withContentLock(db, async () => {
		// The id and its activation generation: a rollback and a return to this snapshot is a change too.
		const expectActive = await activeSnapshot(db)
		const overlay = await publishedOverlay(db)
		options.onRender?.({ activeSnapshotId: expectActive?.id ?? null, revisions: overlay.size })
		const pages = await buildSnapshotPages({ overlay })
		const snapshotId = await publishSnapshot(pages, {
			db,
			expectActive,
			...(options.publishedBy === undefined ? {} : { publishedBy: options.publishedBy }),
			...(options.note === undefined ? {} : { note: options.note }),
			...(options.keep === undefined ? {} : { keep: options.keep }),
		})
		return { snapshotId, pages: pages.length, revisions: [...overlay.keys()] }
	})
}
