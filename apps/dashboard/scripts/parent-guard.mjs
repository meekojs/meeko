// The child processes of the dashboard (scripts/content-job.mjs and scripts/preview-worker.mjs)
// must not outlive it. On Windows a child keeps running when its parent is killed, so the dashboard
// opens an IPC channel to each one and the child ends as soon as that channel closes: a crash, a
// kill or a closed terminal of the dashboard all close it.

/** Exit code of a child whose dashboard went away. */
export const parentGoneCode = 4

/**
 * Ends this process when the dashboard that started it disconnects. `keepAlive: false` (a job)
 * lets the process end by itself when its work is done; a worker that waits for messages keeps it.
 */
export function exitWithParent({ keepAlive = false } = {}) {
	if (!process.channel) return
	if (!keepAlive) process.channel.unref()
	process.once('disconnect', () => {
		console.error('El dashboard se cerró: este proceso se detiene.')
		process.exit(parentGoneCode)
	})
}
