// List the documentation snapshots or activate one (the rollback of `docs:sync`), as the dashboard
// does: `node scripts/snapshots.mjs list` or `node scripts/snapshots.mjs activate <id>`. Activating
// takes the snapshot lock and swaps the active row in one transaction; the pages change on the next
// request of each web.
import { withContent } from './content.mjs'

const [command, value] = process.argv.slice(2)
if (command !== 'list' && command !== 'activate') {
	console.error('Usage: node scripts/snapshots.mjs list | activate <id>')
	process.exit(2)
}

await withContent(async (load) => {
	const { activateSnapshot, listSnapshots } = await load('meeko-docs-content/db')
	if (command === 'activate') {
		const id = Number(value)
		await activateSnapshot(id)
		console.log(`Activated documentation snapshot ${id}`)
	}
	for (const snapshot of await listSnapshots()) {
		const when = snapshot.publishedAt instanceof Date ? snapshot.publishedAt.toISOString() : String(snapshot.publishedAt)
		console.log(`${snapshot.active ? '*' : ' '} ${snapshot.id}\t${when}\t${snapshot.pages} pages\t${snapshot.publishedBy ?? ''}`)
	}
})
