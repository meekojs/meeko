// Apply the pending migrations of meeko-docs-content to the site's database, in one transaction.
import { withContent } from './content.mjs'

await withContent(async (load) => {
	const { migrate } = await load('meeko-docs-content/db')
	const { applied, current } = await migrate()
	for (const migration of applied) console.log(`Applied ${String(migration.version).padStart(3, '0')}_${migration.name}`)
	console.log(applied.length ? `Documentation schema is ready (${applied.length} applied)` : `Documentation schema is up to date (${current.length} applied before)`)
})
