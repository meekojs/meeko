// Store the pages of the repository (guides and reference of the site in Spanish and their English
// translations of docs/en, pages of apps/ui and apps/i18n) as the base sources of the dashboard.
// Revisions are never changed.
import { withContent } from './content.mjs'

await withContent(async (load) => {
	const { countTranslations, importRepositorySources, listTranslations } = await load('meeko-docs-content/db')
	const result = await importRepositorySources()
	console.log(`Imported documentation sources: ${result.inserted} new, ${result.updated} updated, ${result.unchanged} unchanged, ${result.removed} removed, ${result.restored} restored`)
	const english = countTranslations(await listTranslations(undefined, { locale: 'en' }))
	console.log(`English translations: ${english.translated} translated, ${english.outdated} outdated, ${english.missing} missing of ${english.total}`)
})
