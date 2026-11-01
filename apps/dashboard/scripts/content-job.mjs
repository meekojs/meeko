// A job of the dashboard, in its own process: `node scripts/content-job.mjs import|publish|health`.
// The modules of meeko-docs-content are TypeScript with extensionless imports, so Vite loads them
// as `meeko build` does, without a server (as apps/meeko/scripts/content.mjs). Its last line is the
// result as JSON after the marker of server/dashboard/jobs.ts: a technical summary in English and the
// facts, which the dashboard says in the language of its page. The log itself is English.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

import { exitWithParent } from './parent-guard.mjs'

// Started by the dashboard with an IPC channel: end with it, even in the middle of a render.
exitWithParent()

const marker = '@@dashboard-result '
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const kind = process.argv[2]
if (!['import', 'publish', 'health'].includes(kind)) {
	console.error(`Unknown job: ${kind}. Use import, publish or health.`)
	process.exit(2)
}

const envFile = join(app, '.env')
if (existsSync(envFile) && !process.env.DATABASE_URL) process.loadEnvFile(envFile)

const vite = await createServer({
	root: app,
	configFile: false,
	logLevel: 'error',
	appType: 'custom',
	// No HMR WebSocket: with only `hmr: false` Vite still opens one, on a port another server may hold.
	server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	optimizeDeps: { noDiscovery: true, include: [] },
})
const load = (id) => vite.ssrLoadModule(id)

/** The database of the job, in the schema of DASHBOARD_DATABASE_SCHEMA when it is set. */
async function openDatabase() {
	const { createDatabase } = await load('meeko-docs-content/db')
	const schema = process.env.DASHBOARD_DATABASE_SCHEMA?.trim()
	return createDatabase(schema ? { searchPath: schema } : {})
}

let db
try {
	const started = Date.now()
	let result
	if (kind === 'health') {
		console.log('Checking the reference, the exports and the links of the repository…')
		const { documentationHealth } = await load('meeko-docs-content/health')
		const health = await documentationHealth()
		const facts = { kind: 'health', pending: health.pendingReferences.length, exports: health.undocumentedExports.length, broken: health.brokenLinks.length, links: health.checked.links }
		result = { summary: `${facts.pending} pending references, ${facts.exports} exports without a page and ${facts.broken} broken links out of ${facts.links} links`, facts, health }
	} else if (kind === 'import') {
		console.log('Importing the sources from Git (site, ui and i18n, with docs/en)…')
		db = await openDatabase()
		const { importRepositorySources } = await load('meeko-docs-content/db')
		const imported = await importRepositorySources(db)
		console.log(JSON.stringify(imported))
		const facts = { kind: 'import', inserted: imported.inserted, updated: imported.updated, unchanged: imported.unchanged, removed: imported.removed, restored: imported.restored }
		result = { summary: `${facts.inserted} new, ${facts.updated} updated, ${facts.unchanged} unchanged, ${facts.removed} removed and ${facts.restored} restored`, facts }
	} else {
		const publishedBy = process.env.DASHBOARD_PUBLISHED_BY?.trim() || 'dashboard'
		const note = process.env.DASHBOARD_PUBLISH_NOTE?.trim() || undefined
		console.log(`Rendering the documentation in Spanish and English with the published revisions (by ${publishedBy})…`)
		db = await openDatabase()
		const { publishDocumentation } = await load('meeko-docs-content/db')
		// After this line a rollback or another publication makes this one a conflict (the e2e waits for it).
		const onRender = ({ activeSnapshotId, revisions }) => console.log(`Over the active snapshot ${activeSnapshotId === null ? '(none)' : '#' + activeSnapshotId}, with ${revisions} published ${revisions === 1 ? 'revision' : 'revisions'}.`)
		const published = await publishDocumentation(db, { publishedBy, onRender, ...(note ? { note } : {}) })
		const english = published.locales?.en ?? { pages: 0, translation: { translated: 0, outdated: 0, missing: 0 } }
		const facts = {
			kind: 'publish',
			snapshotId: published.snapshotId,
			pages: published.pages,
			revisions: published.revisions.length,
			locales: { es: published.locales?.es?.pages ?? published.pages, en: english.pages },
			translation: { translated: english.translation.translated, outdated: english.translation.outdated, missing: english.translation.missing },
		}
		const revisions = facts.revisions ? `, ${facts.revisions} with published revisions` : ''
		result = { summary: `Snapshot ${facts.snapshotId} published and active with ${facts.pages} pages (${facts.locales.es} es, ${facts.locales.en} en)${revisions}`, facts }
	}
	console.log(`Finished in ${((Date.now() - started) / 1000).toFixed(1)} s.`)
	console.log(marker + JSON.stringify(result))
} catch (error) {
	if (error instanceof Error && error.name === 'SnapshotConflictError') {
		// A rollback or another publication changed the active snapshot during the render: nothing
		// was stored, and the dashboard offers to publish again over the new state.
		const from = error.expected === null ? 'none' : `#${error.expected}`
		const to = error.actual === null ? 'none' : `#${error.actual}`
		// The same id on both sides: a rollback to another snapshot and back, or a new activation of it.
		const change = error.expected === error.actual ? `snapshot ${from} was activated again` : `the active snapshot changed from ${from} to ${to}`
		console.error(error.message)
		const facts = { kind: 'conflict', expected: error.expected ?? null, actual: error.actual ?? null }
		console.log(marker + JSON.stringify({ summary: `Conflict: ${change} while rendering. Nothing was stored; publish again.`, facts, conflict: true }))
		process.exitCode = 3
	} else {
		console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
		process.exitCode = 1
	}
} finally {
	try {
		await db?.end()
	} finally {
		await vite.close()
	}
}
