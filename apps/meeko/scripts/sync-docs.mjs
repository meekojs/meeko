// Materialize the documentation into one database snapshot: the repository's Markdown, JSDoc and
// taxonomy, with the revisions published from the dashboard over their files. The public server
// reads the published snapshot, never the Markdown sources.
import { withContent } from './content.mjs'

await withContent(async (load) => {
	const { publishDocumentation } = await load('meeko-docs-content/db')
	const result = await publishDocumentation(undefined, { publishedBy: 'docs:sync' })
	const revisions = result.revisions.length ? `, ${result.revisions.length} from published revisions` : ''
	console.log(`Published ${result.pages} documentation records as snapshot ${result.snapshotId}${revisions}`)
})
