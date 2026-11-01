// A job of the dashboard, in its own process: `node scripts/content-job.mjs import|publish|health`.
// The modules of meeko-docs-content are TypeScript with extensionless imports, so Vite loads them
// as `meeko build` does, without a server (as apps/meeko/scripts/content.mjs). Its last line is the
// result as JSON after the marker of server/dashboard/jobs.ts.
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
		console.log('Comprobando la referencia, los exports y los enlaces del repositorio…')
		const { documentationHealth } = await load('meeko-docs-content/health')
		const health = await documentationHealth()
		result = { summary: `${health.pendingReferences.length} referencias pendientes, ${health.undocumentedExports.length} exports sin página y ${health.brokenLinks.length} enlaces rotos en ${health.checked.links} enlaces`, health }
	} else if (kind === 'import') {
		console.log('Importando las fuentes de Git (site, ui e i18n)…')
		db = await openDatabase()
		const { importRepositorySources } = await load('meeko-docs-content/db')
		const imported = await importRepositorySources(db)
		console.log(JSON.stringify(imported))
		result = { summary: `${imported.inserted} nuevas, ${imported.updated} actualizadas, ${imported.unchanged} sin cambios, ${imported.removed} retiradas y ${imported.restored} restauradas` }
	} else {
		const publishedBy = process.env.DASHBOARD_PUBLISHED_BY?.trim() || 'dashboard'
		const note = process.env.DASHBOARD_PUBLISH_NOTE?.trim() || undefined
		console.log(`Renderizando la documentación con las revisiones publicadas (por ${publishedBy})…`)
		db = await openDatabase()
		const { publishDocumentation } = await load('meeko-docs-content/db')
		// After this line a rollback or another publication makes this one a conflict (the e2e waits for it).
		const onRender = ({ activeSnapshotId, revisions }) => console.log(`Sobre el snapshot activo ${activeSnapshotId === null ? '(ninguno)' : '#' + activeSnapshotId}, con ${revisions} ${revisions === 1 ? 'revisión publicada' : 'revisiones publicadas'}.`)
		const published = await publishDocumentation(db, { publishedBy, onRender, ...(note ? { note } : {}) })
		const revisions = published.revisions.length ? `, ${published.revisions.length} con revisiones publicadas` : ''
		result = { summary: `Snapshot ${published.snapshotId} publicado y activo con ${published.pages} páginas${revisions}` }
	}
	console.log(`Terminado en ${((Date.now() - started) / 1000).toFixed(1)} s.`)
	console.log(marker + JSON.stringify(result))
} catch (error) {
	if (error instanceof Error && error.name === 'SnapshotConflictError') {
		// A rollback or another publication changed the active snapshot during the render: nothing
		// was stored, and the dashboard offers to publish again over the new state.
		const from = error.expected === null ? 'ninguno' : `#${error.expected}`
		const to = error.actual === null ? 'ninguno' : `#${error.actual}`
		// The same id on both sides: a rollback to another snapshot and back, or a new activation of it.
		const change = error.expected === error.actual ? `el snapshot ${from} se volvió a activar` : `el snapshot activo cambió de ${from} a ${to}`
		console.error(error.message)
		console.log(marker + JSON.stringify({ summary: `Conflicto: ${change} mientras se renderizaba. No se guardó nada; vuelve a publicar.`, conflict: true }))
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
