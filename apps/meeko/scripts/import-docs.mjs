// Store the pages of the repository (guides and reference of the site, pages of apps/ui and
// apps/i18n) as the base sources of the dashboard. Revisions are never changed.
import { withContent } from './content.mjs'

await withContent(async (load) => {
	const { importRepositorySources } = await load('meeko-docs-content/db')
	const result = await importRepositorySources()
	console.log(`Imported documentation sources: ${result.inserted} new, ${result.updated} updated, ${result.unchanged} unchanged, ${result.removed} removed, ${result.restored} restored`)
})
