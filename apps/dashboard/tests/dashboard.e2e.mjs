// The dashboard in Chrome against a temporary schema: the test creates it, imports three sources,
// publishes a revision and two tiny snapshots there, and starts `meeko dev` with
// DASHBOARD_DATABASE_SCHEMA. Activating a snapshot happens in that schema only: the real tables of
// the development database are never read or written. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

import { adminEnv, login, testAdmin } from './fixtures/auth.mjs'

const app = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../../../packages/meeko/dist/cli.js', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL

async function port() {
	const server = createNetServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const value = server.address().port
	await new Promise((done) => server.close(done))
	return value
}

/** Creates the temporary schema with its data, and returns the ids the test checks. */
async function seed(load, schema) {
	const { createDatabase, createRevision, getSource, importSources, migrate, publishRevision } = await load('meeko-docs-content/db')
	const { publishSnapshot } = await load('meeko-docs-content/snapshots')
	const { readGitFile } = await load('meeko-docs-content/content/repository')
	const admin = createDatabase({ connectionString: url })
	await admin.query(`CREATE SCHEMA ${schema}`)
	await admin.end()
	const db = createDatabase({ connectionString: url, searchPath: schema })
	try {
		await migrate(db)
		const doctor = readGitFile('docs/doctor.md')
		await importSources(
			db,
			[
				{ site: 'site', path: '/docs/doctor', kind: 'guide', title: 'Doctor', file: 'docs/doctor.md', markdown: doctor },
				{ site: 'site', path: '/docs/testing', kind: 'guide', title: 'Pruebas y CI', file: 'docs/testing.md', markdown: '# Una versión antigua\n' },
				{ site: 'ui', path: '/installation', kind: 'page', title: 'Instalación', file: null, markdown: null },
			],
			['site', 'ui'],
		)
		const source = await getSource(db, { site: 'site', path: '/docs/doctor' })
		const revision = await createRevision(db, { sourceId: source.id, markdown: `${doctor}\nUna línea editada desde el dashboard.\n`, author: 'e2e' })
		await publishRevision(db, revision.id)
		const first = await publishSnapshot([{ path: '/docs', payload: { title: 'uno' } }], { db, publishedBy: 'e2e', note: 'primero' })
		const second = await publishSnapshot([{ path: '/docs', payload: { title: 'dos' } }], { db, publishedBy: 'e2e' })
		return { first, second }
	} finally {
		await db.end()
	}
}

test('the dashboard shows the overview, filters the sources, opens a detail and rolls back a snapshot', { skip: url ? false : 'DATABASE_URL is not set', timeout: 180_000 }, async (context) => {
	const vite = await createServer({ root: app, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	const load = (id) => vite.ssrLoadModule(id)
	const { createDatabase } = await load('meeko-docs-content/db')
	const schema = `dash_e2e_${process.pid}_${randomBytes(4).toString('hex')}`
	// One cleanup, in order: the browser and the server first, then the schema, then Vite.
	const cleanups = []
	context.after(async () => {
		for (const cleanup of cleanups.reverse()) await cleanup()
		const admin = createDatabase({ connectionString: url })
		try {
			await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		} finally {
			await admin.end()
			await vite.close()
		}
	})
	const { first, second } = await seed(load, schema)

	const httpPort = await port()
	const hmrPort = await port()
	const account = await testAdmin()
	const server = spawn(process.execPath, [cli, 'dev', app], {
		cwd: app,
		env: { ...process.env, ...adminEnv(account), DASHBOARD_DATABASE_SCHEMA: schema, PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0', NODE_OPTIONS: '--max-old-space-size=8192' },
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	cleanups.push(() => server.kill())
	let logs = ''
	server.stdout.on('data', (chunk) => (logs += chunk))
	server.stderr.on('data', (chunk) => (logs += chunk))
	const origin = `http://127.0.0.1:${httpPort}`
	const started = Date.now()
	while (true) {
		if (server.exitCode !== null || Date.now() - started > 60_000) throw new Error(logs)
		try {
			if ((await fetch(origin)).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 100))
	}

	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	cleanups.push(() => browser.close())
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
	await login(page, origin, account)
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	// Under load the first compile of a page by Vite can take longer than the 30 s default.
	const hydrated = () => page.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 60_000 })

	// Resumen: counts of the temporary schema, and its link to the edited sources.
	await page.goto(origin, { waitUntil: 'networkidle' })
	await hydrated()
	assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Resumen')
	const framework = page.getByRole('row', { name: /^Framework/ }).first()
	assert.match((await framework.textContent()) ?? '', /2/)
	assert.match((await page.getByRole('region', { name: 'Publicación' }).textContent()) ?? '', new RegExp(`#${second}`))
	await page.getByRole('link', { name: /fuentes de Framework: Editada/ }).click()
	await page.waitForURL(/\/sources\?site=site&state=edited/)
	await hydrated()
	await page.getByRole('status').filter({ hasText: '1 de 3 fuentes' }).waitFor()

	// Fuentes: clear the filters, choose a web in the select, then search by text.
	await page.getByRole('button', { name: 'Quitar filtros' }).click()
	await page.getByRole('status').filter({ hasText: '3 de 3 fuentes' }).waitFor()
	await page.getByRole('combobox', { name: 'Web' }).click()
	await page.getByRole('option', { name: 'UI', exact: true }).click()
	await page.getByRole('status').filter({ hasText: '1 de 3 fuentes' }).waitFor()
	assert.equal(await page.getByRole('link', { name: 'Instalación' }).count(), 1)
	assert.match(page.url(), /site=ui/)
	await page.getByRole('combobox', { name: 'Web' }).click()
	await page.getByRole('option', { name: 'Todas' }).click()
	// Every state is waited for by its own text: the list said «1 de 3» with UI already, so waiting
	// for it again after the search passed at once, before «Todas» applied, and under load the link
	// of Doctor (another web) was clicked while the list still showed only UI.
	await page.getByRole('status').filter({ hasText: '3 de 3 fuentes' }).waitFor()
	assert.doesNotMatch(page.url(), /site=/)
	await page.getByRole('searchbox', { name: 'Buscar' }).fill('doctor')
	await page.getByRole('status').filter({ hasText: '1 de 3 fuentes' }).waitFor()
	await page.getByRole('link', { name: 'Doctor' }).waitFor()

	// Detalle: the published revision and its diff with Git.
	await page.getByRole('link', { name: 'Doctor' }).click()
	await page.waitForURL(/\/sources\/\d+$/)
	await page.getByRole('heading', { level: 1, name: 'Doctor' }).waitFor()
	assert.equal(await page.getByRole('cell', { name: 'Publicada' }).count(), 1)
	assert.match((await page.locator('.meeko-ui-diff-line[data-kind="add"]').allTextContents()).join('\n'), /Una línea editada desde el dashboard/)

	// Snapshots: roll back to the first one, in the temporary schema, after confirming.
	await page.goto(`${origin}/snapshots`, { waitUntil: 'networkidle' })
	await hydrated()
	await page.getByRole('button', { name: `Volver al #${first}` }).click()
	const dialog = page.getByRole('dialog')
	await dialog.waitFor({ state: 'visible' })
	assert.match(((await dialog.textContent()) ?? '').replace(/\s+/g, ' '), new RegExp(`Sustituye a ?#${second}`))
	await dialog.getByRole('button', { name: 'Activar snapshot' }).click()
	await dialog.waitFor({ state: 'hidden' })
	await page
		.getByRole('status')
		.filter({ hasText: `El snapshot #${first} es ahora el activo` })
		.waitFor()
	assert.equal(await page.getByRole('button', { name: `Activar el #${second}` }).count(), 1)

	// Narrow screens: no page overflows sideways.
	await page.setViewportSize({ width: 390, height: 844 })
	for (const path of ['/', '/sources', '/snapshots']) {
		await page.goto(origin + path, { waitUntil: 'networkidle' })
		assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth), true, `${path} overflows at 390 px`)
	}

	// On a phone the sections and the account are in the menu of the header.
	await page.getByRole('button', { name: 'Menú' }).click()
	await page.getByRole('navigation', { name: 'Menú' }).getByRole('link', { name: 'Fuentes' }).waitFor()
	await page.getByRole('button', { name: 'Cerrar sesión' }).waitFor()

	// Another origin cannot start a job: no session, so `origin: 'required'` is the guard.
	const refused = await fetch(`${origin}/_meeko/rpc/jobs/start`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ kind: 'import' }) })
	assert.equal(refused.status, 403)

	assert.deepEqual(errors, [])
})
