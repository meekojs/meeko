// Materialize the documentation into one database snapshot, in Spanish and in English: the
// repository's Markdown, JSDoc and taxonomy and the translations of docs/en, with the revisions
// published from the dashboard over their files. The public server reads the published snapshot,
// never the Markdown sources.
import { withContent } from './content.mjs'

await withContent(async (load) => {
	const { publishDocumentation } = await load('meeko-docs-content/db')
	const result = await publishDocumentation(undefined, { publishedBy: 'docs:sync' })
	const revisions = result.revisions.length ? `, ${result.revisions.length} from published revisions` : ''
	console.log(`Published ${result.pages} documentation records as snapshot ${result.snapshotId}${revisions}`)
	for (const [locale, { pages, translation }] of Object.entries(result.locales)) {
		const status = locale === 'es' ? '' : `: ${translation.translated} translated, ${translation.outdated} outdated, ${translation.missing} in Spanish (fallback)`
		console.log(`  ${locale}: ${pages} pages${status}`)
	}
})
