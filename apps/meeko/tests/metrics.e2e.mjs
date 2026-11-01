// The metrics of the site, in Chrome, against a temporary schema: the test migrates it, copies the
// active snapshot of the development database into it (a read of the real tables, never a write)
// and starts `meeko dev` with DATABASE_URL pointed at that schema. A page view (also after a client
// navigation), a search without results and the «¿Te sirvió?» answers, with and without JavaScript,
// must land in that schema; bots, prefetches, made-up pages and requests without the site's Origin
// must not. The schema is dropped at the end. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const app = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../../../packages/meeko/dist/cli.js', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL
const first = '/docs/framework'
const second = '/docs/testing'
const nothing = 'zzqx sin resultados'
const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

async function port() {
	const server = createNetServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const value = server.address().port
	await new Promise((done) => server.close(done))
	return value
}

/** The connection string of `url` with `schema` as its search path, for the server under test. */
function inSchema(schema) {
	const target = new URL(url)
	target.searchParams.set('options', `-c search_path=${schema}`)
	return target.href
}

/** Waits until `read` returns a truthy value, or fails with `message` after `timeout` ms. */
async function until(read, message, timeout = 15_000) {
	const started = Date.now()
	while (true) {
		const value = await read()
		if (value) return value
		if (Date.now() - started > timeout) throw new Error(message)
		await new Promise((done) => setTimeout(done, 150))
	}
}

test('the site counts views, confirmed searches and «¿Te sirvió?» without cookies', { skip: url ? false : 'DATABASE_URL is not set', timeout: 300_000 }, async (context) => {
	const vite = await createServer({ root: app, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	const load = (id) => vite.ssrLoadModule(id)
	const { createDatabase, migrate } = await load('meeko-docs-content/db')
	const schema = `site_e2e_${process.pid}_${randomBytes(4).toString('hex')}`
	const admin = createDatabase({ connectionString: url })
	const cleanups = []
	context.after(async () => {
		for (const cleanup of cleanups.reverse()) await cleanup()
		try {
			await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		} finally {
			await admin.end()
			await vite.close()
		}
	})

	// The schema, with a copy of the active snapshot of the development database.
	const source = (await admin.query('SELECT current_schema() AS name')).rows[0].name
	await admin.query(`CREATE SCHEMA ${schema}`)
	const db = createDatabase({ connectionString: url, searchPath: schema })
	cleanups.push(() => db.end())
	await migrate(db)
	const active = (await admin.query(`SELECT id FROM ${source}.docs_snapshots WHERE active`)).rows[0]
	assert.ok(active, 'the development database has an active snapshot (run docs:sync)')
	const snapshot = (await db.query("INSERT INTO docs_snapshots (active, published_by) VALUES (true, 'e2e') RETURNING id")).rows[0].id
	await admin.query(`INSERT INTO ${schema}.docs_pages (snapshot_id, path, payload, searchable_text) SELECT $1, path, payload, searchable_text FROM ${source}.docs_pages WHERE snapshot_id = $2`, [snapshot, active.id])
	const views = async (path) => Number((await db.query('SELECT coalesce(sum(views), 0) AS views FROM docs_page_views WHERE site = $1 AND path = $2', ['site', path])).rows[0].views)

	const httpPort = await port()
	const hmrPort = await port()
	const server = spawn(process.execPath, [cli, 'dev', app], {
		cwd: app,
		env: { ...process.env, DATABASE_URL: inSchema(schema), DOCS_METRICS: 'all', PORT: String(httpPort), MEEKO_PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0', NODE_OPTIONS: '--max-old-space-size=8192' },
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	cleanups.push(async () => {
		server.kill()
		if (server.exitCode === null) await once(server, 'exit')
	})
	let logs = ''
	server.stdout.on('data', (chunk) => (logs += chunk))
	server.stderr.on('data', (chunk) => (logs += chunk))
	const base = `http://127.0.0.1:${httpPort}`
	const started = Date.now()
	while (true) {
		if (server.exitCode !== null || Date.now() - started > 90_000) throw new Error(logs)
		try {
			if ((await fetch(base + first)).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 100))
	}
	// `meeko dev` rewrites its generated entries right after it starts, which reloads open pages (a
	// legitimate second view): the browser waits until the log has been quiet for 3 s.
	for (let previous = '', quietSince = Date.now(); Date.now() - started < 120_000; await new Promise((done) => setTimeout(done, 250))) {
		if (logs !== previous) [previous, quietSince] = [logs, Date.now()]
		else if (Date.now() - quietSince >= 3000) break
	}

	try {
		// The collection endpoints by hand: Origin of the site required, strict body, bots and
		// made-up pages ignored with the same 204.
		const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': chrome, origin: base, ...headers }, body: JSON.stringify(body) })
		assert.equal((await post('/api/docs/views', { path: first }, { origin: '' })).status, 403, 'a view without Origin')
		assert.equal((await post('/api/docs/feedback', { path: first, helpful: true }, { origin: 'https://otro.example' })).status, 403, 'feedback from another site')
		assert.equal((await post('/api/docs/feedback', { path: first, helpful: true, comment: 'x'.repeat(2001) })).status, 400, 'a comment longer than 2000 characters')
		assert.equal((await post('/api/docs/views', { path: '/docs/inventada' })).status, 204)
		assert.equal((await post('/api/docs/views', { path: first }, { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' })).status, 204)
		assert.equal((await post('/api/docs/views', { path: first }, { 'sec-purpose': 'prefetch' })).status, 204)
		assert.equal((await db.query('SELECT count(*) AS count FROM docs_page_views')).rows[0].count, '0', 'nothing counted yet')
		assert.match((await (await fetch(base + first)).text()).replace(/\s+/g, ' '), /<meta name="meeko-docs-metrics" content="all"/)

		const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
		cleanups.push(() => browser.close())
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
		const errors = []
		page.on('pageerror', (error) => errors.push(error.message))

		// One view on load, one more after a client navigation, none for a hash change.
		await page.goto(base + first, { waitUntil: 'networkidle' })
		await until(async () => (await views(first)) === 1, `one view of ${first}`)
		await page.evaluate(() => {
			globalThis.__e2eDocument = 'same'
		})
		await page.locator(`#docs-nav a[href="${second}"]`).first().click()
		await page.waitForURL(base + second)
		await until(async () => (await views(second)) === 1, `one view of ${second} after a client navigation`)
		assert.equal(await page.evaluate(() => globalThis.__e2eDocument), 'same', 'it was a client navigation')
		await page.evaluate(() => {
			globalThis.location.hash = 'algo'
		})
		await new Promise((done) => setTimeout(done, 1000))
		assert.equal(await page.evaluate(() => globalThis.__e2eDocument), 'same', 'the page did not reload')
		assert.deepEqual([await views(first), await views(second)], [1, 1], 'a hash change is not a view')

		// A search without results is stored once, normalized, after it settles; its prefixes are not.
		await page.keyboard.press('/')
		const input = page.getByLabel('Texto de búsqueda')
		await input.pressSequentially(nothing.toUpperCase(), { delay: 40 })
		await page.getByText(`Sin resultados para «${nothing.toUpperCase()}».`).waitFor()
		const searches = await until(async () => {
			const rows = (await db.query('SELECT query, results FROM docs_searches ORDER BY id')).rows
			return rows.length ? rows : null
		}, 'the search was stored')
		await new Promise((done) => setTimeout(done, 1500))
		assert.deepEqual((await db.query('SELECT query, results FROM docs_searches ORDER BY id')).rows, [{ query: nothing, results: 0 }], 'one row, without its prefixes')
		assert.deepEqual(searches, [{ query: nothing, results: 0 }])
		await page.locator('dialog.search').getByRole('button', { name: 'Esc' }).click()
		await page.locator('dialog.search').waitFor({ state: 'hidden' })

		// «¿Te sirvió?» with JavaScript: «No» with a comment, then thanks.
		const widget = page.locator('#docs-feedback')
		await widget.getByText('Añadir un comentario').click()
		await widget.getByLabel(/Comentario opcional/).fill('Falta un ejemplo de pruebas e2e.')
		mkdirSync(join(app, '.meeko', 'screenshots'), { recursive: true })
		await widget.screenshot({ path: join(app, '.meeko', 'screenshots', 'feedback-desktop.png') })
		await widget.getByRole('button', { name: 'No' }).click()
		await widget.getByRole('status').filter({ hasText: 'Gracias por tu respuesta' }).waitFor()
		assert.deepEqual((await db.query('SELECT site, path, helpful, comment FROM docs_feedback')).rows, [{ site: 'site', path: second, helpful: false, comment: 'Falta un ejemplo de pruebas e2e.' }])
		await page.setViewportSize({ width: 390, height: 844 })
		assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), 'no horizontal scroll at 390 px')
		await page.goto(base + first, { waitUntil: 'networkidle' })
		await widget.scrollIntoViewIfNeeded()
		await widget.screenshot({ path: join(app, '.meeko', 'screenshots', 'feedback-mobile.png') })
		assert.deepEqual(errors, [])
		assert.deepEqual(await page.context().cookies(base), [], 'no cookies')

		// Without JavaScript: the native form answers 303 back to the widget, which thanks.
		const plain = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } })
		cleanups.push(() => plain.close())
		const noScript = await plain.newPage()
		await noScript.goto(base + first)
		const form = noScript.locator('#docs-feedback')
		await form.getByText('Añadir un comentario').click()
		await form.getByLabel(/Comentario opcional/).fill('Sin JavaScript también.')
		const [redirect] = await Promise.all([noScript.waitForResponse((response) => response.url().endsWith('/api/docs/feedback')), form.getByRole('button', { name: 'Sí' }).click()])
		assert.equal(redirect.status(), 303)
		await noScript.waitForURL(`${base}${first}#docs-feedback`)
		assert.match(await form.textContent(), /Gracias por tu respuesta/)
		assert.equal(await form.locator('form').count(), 0, 'the form is replaced by the thanks')
		const stored = (await db.query('SELECT path, helpful, comment FROM docs_feedback ORDER BY id')).rows
		assert.deepEqual(stored.at(-1), { path: first, helpful: true, comment: 'Sin JavaScript también.' })
		// Without JavaScript nothing counts a view (the page was shown twice with it: load and 390 px).
		assert.equal(await views(first), 2)

		// Equivalent URLs of a page (an encoded segment, repeated slashes) are the page the router
		// shows: their views and feedback count as its canonical path, never as another one.
		for (const path of ['/docs/%66ramework', '/docs//framework/', '//docs/framework']) assert.equal((await post('/api/docs/views', { path })).status, 204, path)
		assert.equal(await views(first), 5)
		assert.deepEqual((await db.query('SELECT DISTINCT path FROM docs_page_views ORDER BY path')).rows, [{ path: first }, { path: second }])
		assert.deepEqual(await (await post('/api/docs/feedback', { path: '/docs/%66ramework', helpful: false })).json(), { saved: true })
		assert.deepEqual((await db.query('SELECT path, helpful FROM docs_feedback ORDER BY id DESC LIMIT 1')).rows, [{ path: first, helpful: false }])

		// A query with personal data or a secret is dropped by the server, even from a client that
		// sends it: nothing reaches docs_searches.
		const searchesBefore = (await db.query('SELECT count(*)::int AS n FROM docs_searches')).rows[0].n
		const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJhLWRlLWVqZW1wbG8'
		for (const q of ['ana.garcia@example.com', 'Bearer sk_live_51HxExampleOnly0123456789abcdef', jwt]) assert.equal((await post('/api/docs/search', { q })).status, 204, q)
		assert.equal((await db.query('SELECT count(*)::int AS n FROM docs_searches')).rows[0].n, searchesBefore)
		assert.equal((await db.query("SELECT count(*)::int AS n FROM docs_searches WHERE query LIKE '%@%' OR query LIKE '%sk_live%' OR query LIKE 'eyj%'")).rows[0].n, 0)
	} catch (error) {
		throw new Error(`${error instanceof Error ? error.stack : String(error)}\n\nServer log:\n${logs}`, { cause: error })
	}
})
