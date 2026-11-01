// The metrics of the i18n site (module meeko-docs), with `meeko dev`:
// 1. with a database that does not answer, every page renders and the widget still thanks the
//    reader, with and without JavaScript, while the server logs the failure once;
// 2. with DOCS_METRICS=off, nothing is counted and the widget is not shown;
// 3. against a temporary schema (dropped at the end), views (an alias counts as its page), the
//    local filter once it settles and «¿Te sirvió?» land in that schema. Skipped without DATABASE_URL.
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

const app = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../../../packages/meeko/dist/cli.js', import.meta.url))
const unreachable = 'postgresql://nobody:secret-e2e@127.0.0.1:9/none'

async function port() {
	const server = createNetServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const value = server.address().port
	await new Promise((done) => server.close(done))
	return value
}

/** Starts `meeko dev` with `env`, waits for its home page and for its log to be quiet for 3 s. */
async function start(context, env) {
	const httpPort = await port()
	const hmrPort = await port()
	const server = spawn(process.execPath, [cli, 'dev', app], {
		cwd: app,
		env: { ...process.env, DOCS_METRICS: 'all', ...env, PORT: String(httpPort), MEEKO_PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0', NODE_OPTIONS: '--max-old-space-size=8192' },
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	const state = { logs: '', base: `http://127.0.0.1:${httpPort}` }
	server.stdout.on('data', (chunk) => (state.logs += chunk))
	server.stderr.on('data', (chunk) => (state.logs += chunk))
	context.after(async () => {
		server.kill()
		if (server.exitCode === null) await once(server, 'exit')
	})
	const started = Date.now()
	while (true) {
		if (server.exitCode !== null || Date.now() - started > 90_000) throw new Error(state.logs)
		try {
			if ((await fetch(state.base)).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 100))
	}
	// `meeko dev` rewrites its generated entries right after it starts, which reloads open pages.
	for (let previous = '', quietSince = Date.now(); Date.now() - started < 120_000; await new Promise((done) => setTimeout(done, 250))) {
		if (state.logs !== previous) [previous, quietSince] = [state.logs, Date.now()]
		else if (Date.now() - quietSince >= 3000) break
	}
	return state
}

async function launch(context) {
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	return browser
}

/** Waits until `read` returns a truthy value, or fails with `message`. */
async function until(read, message, timeout = 15_000) {
	const started = Date.now()
	while (true) {
		const value = await read()
		if (value) return value
		if (Date.now() - started > timeout) throw new Error(message)
		await new Promise((done) => setTimeout(done, 150))
	}
}

test('with a database that does not answer, the pages and the widget keep working', { timeout: 180_000 }, async (context) => {
	const server = await start(context, { DATABASE_URL: unreachable })
	const browser = await launch(context)
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	const beacons = []
	page.on('request', (request) => request.url().endsWith('/api/docs/views') && beacons.push(request))
	for (const route of ['/messages', '/plurals']) assert.equal((await page.goto(server.base + route, { waitUntil: 'networkidle' })).status(), 200, route)
	await until(() => beacons.length >= 2, 'a beacon per page')
	const widget = page.locator('#docs-feedback')
	await widget.getByRole('button', { name: 'Sí' }).click()
	await widget.getByRole('status').filter({ hasText: 'Gracias por tu respuesta' }).waitFor()

	// Without JavaScript the native form goes back to the page with 303 and the same thanks.
	const plain = await browser.newContext({ javaScriptEnabled: false })
	context.after(() => plain.close())
	const noScript = await plain.newPage()
	await noScript.goto(server.base + '/messages')
	await noScript.locator('#docs-feedback').getByRole('button', { name: 'No' }).click()
	await noScript.waitForURL(`${server.base}/messages#docs-feedback`)
	assert.match(await noScript.locator('#docs-feedback').textContent(), /Gracias por tu respuesta/)

	await until(() => /\[docs-metrics\] cannot store a metric \(ECONNREFUSED\)/.test(server.logs), 'the failure is logged')
	assert.equal(server.logs.match(/\[docs-metrics\] cannot store/g)?.length, 1, 'logged once')
	assert.ok(!server.logs.includes('secret-e2e'), 'the password never reaches the log')
	assert.deepEqual(errors, [])
})

test('with DOCS_METRICS=off nothing is counted and the widget is not shown', { timeout: 180_000 }, async (context) => {
	const server = await start(context, { DATABASE_URL: unreachable, DOCS_METRICS: 'off' })
	const browser = await launch(context)
	const page = await browser.newPage()
	const collected = []
	page.on('request', (request) => request.url().includes('/api/docs/') && collected.push(request.url()))
	await page.goto(server.base + '/plurals', { waitUntil: 'networkidle' })
	await page.locator('#docs-search').fill('plurales')
	await new Promise((done) => setTimeout(done, 2000))
	assert.equal(await page.locator('#docs-feedback').count(), 0)
	assert.deepEqual(collected, [], 'no beacon')
	assert.match(await (await fetch(server.base + '/plurals')).text(), /<meta name="meeko-docs-metrics" content="off"/)
})

test('an automated browser is an evident bot: it sends no beacon unless DOCS_METRICS=all', { timeout: 180_000 }, async (context) => {
	// Other e2e suites start the sites with the real .env: their Chrome must never count.
	const server = await start(context, { DATABASE_URL: unreachable, DOCS_METRICS: '' })
	const browser = await launch(context)
	const page = await browser.newPage()
	const collected = []
	page.on('request', (request) => request.url().includes('/api/docs/') && collected.push(request.url()))
	await page.goto(server.base + '/plurals', { waitUntil: 'networkidle' })
	assert.equal(await page.evaluate(() => globalThis.navigator.webdriver), true)
	await page.locator('#docs-search').fill('plurales')
	await new Promise((done) => setTimeout(done, 2000))
	assert.deepEqual(collected, [], 'no beacon from a webdriver')
	assert.equal(await page.locator('#docs-feedback').count(), 1, 'the widget is still there for readers')
	assert.match(await (await fetch(server.base + '/plurals')).text(), /<meta name="meeko-docs-metrics" content="on"/)
})

if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL

test('views, the local filter and «¿Te sirvió?» land in the database', { skip: url ? false : 'DATABASE_URL is not set', timeout: 240_000 }, async (context) => {
	const vite = await createServer({ root: app, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	const { createDatabase, migrate } = await vite.ssrLoadModule('meeko-docs-content/db')
	const schema = `i18n_e2e_${process.pid}_${randomBytes(4).toString('hex')}`
	const admin = createDatabase({ connectionString: url })
	const db = createDatabase({ connectionString: url, searchPath: schema })
	context.after(async () => {
		try {
			await db.end()
			await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		} finally {
			await admin.end()
			await vite.close()
		}
	})
	await admin.query(`CREATE SCHEMA ${schema}`)
	await migrate(db)
	const target = new URL(url)
	target.searchParams.set('options', `-c search_path=${schema}`)
	const server = await start(context, { DATABASE_URL: target.href })
	const views = async () => Object.fromEntries((await db.query("SELECT path, sum(views)::int AS views FROM docs_page_views WHERE site = 'i18n' GROUP BY path")).rows.map((row) => [row.path, row.views]))

	const browser = await launch(context)
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto(server.base + '/plurals', { waitUntil: 'networkidle' })
	await page.goto(server.base + '/en/playground', { waitUntil: 'networkidle' })
	await until(async () => JSON.stringify(await views()) === JSON.stringify({ '/playground': 1, '/plurals': 1 }) || JSON.stringify(await views()) === JSON.stringify({ '/plurals': 1, '/playground': 1 }), `a view of /plurals and the alias counted as /playground: ${JSON.stringify(await views())}`)

	// The local filter: one row once the typing stops, with the pages it matched; no prefixes.
	await page.goto(server.base + '/plurals', { waitUntil: 'networkidle' })
	await page.locator('#docs-search').pressSequentially('Plurales', { delay: 60 })
	const searches = await until(async () => {
		const rows = (await db.query('SELECT site, query, results FROM docs_searches')).rows
		return rows.length ? rows : null
	}, 'the filter was stored')
	assert.deepEqual(searches, [{ site: 'i18n', query: 'plurales', results: 1 }])

	// «¿Te sirvió?» with JavaScript.
	await page.locator('#docs-search').fill('')
	const widget = page.locator('#docs-feedback')
	await widget.getByRole('button', { name: 'Sí' }).click()
	await widget.getByRole('status').filter({ hasText: 'Gracias por tu respuesta' }).waitFor()
	assert.deepEqual((await db.query('SELECT site, path, helpful, comment FROM docs_feedback')).rows, [{ site: 'i18n', path: '/plurals', helpful: true, comment: null }])
	assert.deepEqual(await page.context().cookies(server.base), [], 'no cookies')

	// Equivalent URLs, as a client could send them: an encoded segment, repeated slashes and an alias
	// with them count as the canonical page of the navigation; nothing else is stored.
	const agent = await page.evaluate(() => globalThis.navigator.userAgent)
	const post = (path, body) => fetch(server.base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': agent, origin: server.base }, body: JSON.stringify(body) })
	const before = await views()
	for (const path of ['/%70lurals', '//plurals/', '/en//playground', '/%65n/%70layground', '/en//nada']) assert.equal((await post('/api/docs/views', { path })).status, 204, path)
	assert.deepEqual(await views(), { ...before, '/plurals': before['/plurals'] + 2, '/playground': before['/playground'] + 2 })
	assert.deepEqual(await (await post('/api/docs/feedback', { path: '/en//playground', helpful: false })).json(), { saved: true })
	assert.deepEqual((await db.query('SELECT path, helpful FROM docs_feedback ORDER BY id DESC LIMIT 1')).rows, [{ path: '/playground', helpful: false }])
	assert.deepEqual(errors, [])
})
