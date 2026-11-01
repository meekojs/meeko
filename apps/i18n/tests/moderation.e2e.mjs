// The moderation of the dashboard on the i18n site, with `meeko dev`:
// 1. with a database that does not answer, every page still renders, with the whole navigation and
//    no announcement, and the server logs why;
// 2. against a temporary schema (dropped at the end) with a `hide` rule, a `feature` rule and an
//    announcement, the shared shell applies them. The server starts before the schema exists, as
//    after starting without a database: once it exists, the next client navigation shows its
//    moderation without a reload, and later changes arrive the same way. Equivalent URLs of a
//    hidden page (encoded, repeated slashes, aliases, query, trailing slash) answer 404, in SSR and
//    in the navigation payload. Skipped without DATABASE_URL.
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
const output = join(app, '.meeko', 'screenshots')

async function port() {
	const server = createNetServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const value = server.address().port
	await new Promise((done) => server.close(done))
	return value
}

/** Starts `meeko dev` with `env` and waits for its home page. */
async function start(context, env) {
	const httpPort = await port()
	const hmrPort = await port()
	const server = spawn(process.execPath, [cli, 'dev', app], {
		cwd: app,
		env: { ...process.env, ...env, PORT: String(httpPort), MEEKO_PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0', NODE_OPTIONS: '--max-old-space-size=8192' },
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
	return state
}

async function launch(context) {
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	return browser
}

test('without a database the site works with its whole navigation and no announcement', { timeout: 180_000 }, async (context) => {
	// Port 9 of loopback has nothing listening: every connection is refused.
	const server = await start(context, { DATABASE_URL: 'postgresql://nobody:secret-e2e@127.0.0.1:9/none' })
	const browser = await launch(context)
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	for (const route of ['/', '/playground', '/en/playground', '/messages']) {
		const response = await page.goto(server.base + route, { waitUntil: 'networkidle' })
		assert.equal(response.status(), 200, route)
	}
	assert.equal(await page.locator('#docs-navigation a[href="/playground"]').count(), 1)
	assert.equal(await page.locator('.docs-announcement').count(), 0)
	assert.equal(await page.locator('.nav-featured').count(), 0)
	assert.match(server.logs, /\[docs-moderation\] cannot read the moderation \(ECONNREFUSED\)/)
	assert.equal(server.logs.match(/\[docs-moderation\] cannot read/g)?.length, 1, 'logged once')
	assert.ok(!server.logs.includes('secret-e2e'), 'the password never reaches the log')
	assert.deepEqual(errors, [])
})

if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL

test('the shell hides, features and announces what the dashboard moderates', { skip: url ? false : 'DATABASE_URL is not set', timeout: 240_000 }, async (context) => {
	const vite = await createServer({ root: app, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	const { createAnnouncement, createDatabase, migrate, saveModerationRule } = await vite.ssrLoadModule('meeko-docs-content/db')
	const schema = `i18n_e2e_${process.pid}_${randomBytes(4).toString('hex')}`
	const admin = createDatabase({ connectionString: url })
	context.after(async () => {
		try {
			await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		} finally {
			await admin.end()
			await vite.close()
		}
	})
	// The server starts first, against a schema that does not exist yet: it serves no moderation.
	const target = new URL(url)
	target.searchParams.set('options', `-c search_path=${schema}`)
	const server = await start(context, { DATABASE_URL: target.href, DOCS_MODERATION_TTL_MS: '300', DOCS_MODERATION_RETRY_MS: '300' })
	const browser = await launch(context)
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	const nav = page.locator('#docs-navigation')
	const wait = () => new Promise((done) => setTimeout(done, 700))
	await page.goto(server.base + '/installation', { waitUntil: 'networkidle' })
	assert.equal(await nav.locator('a[href="/playground"]').count(), 1, 'nothing hidden without the tables')
	assert.match(server.logs, /\[docs-moderation\] cannot read the moderation/)
	// A reload of the document would hide a stale state behind a fresh SSR: the mark detects it.
	await page.evaluate(() => {
		globalThis.__e2eSession = 'same document'
	})

	await admin.query(`CREATE SCHEMA ${schema}`)
	const db = createDatabase({ connectionString: url, searchPath: schema })
	let notice
	try {
		await migrate(db)
		await saveModerationRule(db, { site: 'i18n', path: '/playground', action: 'hide', author: 'e2e' }, { allowUnknown: true })
		await saveModerationRule(db, { site: 'i18n', path: '/messages', action: 'feature', author: 'e2e' }, { allowUnknown: true })
		await saveModerationRule(db, { site: 'ui', path: '/messages', action: 'hide', author: 'e2e' }, { allowUnknown: true })
		notice = await createAnnouncement(db, { site: 'i18n', message: 'Aviso de prueba de i18n.', tone: 'info', active: true, author: 'e2e' })
	} finally {
		await db.end()
	}
	await wait()

	// The database answers now: the next client navigation brings its moderation, without a reload.
	assert.equal(await nav.locator('a[href="/playground"]').count(), 1, 'nothing changes before a navigation')
	await nav.locator('a[href="/messages"]').first().click()
	await page.waitForURL(server.base + '/messages')
	await nav.locator('a[href="/playground"]').waitFor({ state: 'detached', timeout: 10_000 })
	await page.getByRole('status').filter({ hasText: notice.message }).waitFor({ timeout: 10_000 })
	assert.equal(await page.evaluate(() => globalThis.__e2eSession), 'same document', 'it arrived without a reload')
	assert.match(server.logs, /\[docs-moderation\] the database answers again/)

	// A rule removed and an announcement added later arrive on the next navigation too.
	const later = createDatabase({ connectionString: url, searchPath: schema })
	let second
	try {
		await later.query("DELETE FROM docs_moderation WHERE site = 'i18n' AND path = '/playground'")
		second = await createAnnouncement(later, { site: 'i18n', message: 'Segundo aviso de la sesión.', tone: 'warning', active: true, author: 'e2e' })
	} finally {
		await later.end()
	}
	await wait()
	await nav.locator('a[href="/installation"]').first().click()
	await page.waitForURL(server.base + '/installation')
	await nav.locator('a[href="/playground"]').first().waitFor({ timeout: 10_000 })
	await page.getByRole('status').filter({ hasText: second.message }).waitFor({ timeout: 10_000 })
	assert.equal(await page.evaluate(() => globalThis.__e2eSession), 'same document')
	const again = createDatabase({ connectionString: url, searchPath: schema })
	try {
		await saveModerationRule(again, { site: 'i18n', path: '/playground', action: 'hide', author: 'e2e' }, { allowUnknown: true })
		await again.query('DELETE FROM docs_announcements WHERE id = $1', [second.id])
	} finally {
		await again.end()
	}
	await wait()

	// Equivalent URLs of the hidden page and of its aliases: 404 as a document and as the payload of
	// a client navigation, as the router of Meeko would resolve them.
	const variants = ['/playground', '/en/playground', '/ar/playground', '/%70layground', '/%70%6Cayground', '//playground', '/playground/', '/playground?x=1', '///playground//?y#z', '/en//playground', '/%65n/playground', '//es//playground/', '/es/%70layground?x']
	for (const variant of variants) {
		assert.equal((await fetch(server.base + variant)).status, 404, variant)
		assert.equal((await fetch(server.base + variant, { headers: { accept: 'application/meeko+json' } })).status, 404, `${variant} (navigation payload)`)
	}
	assert.equal((await fetch(server.base + '/messages', { headers: { accept: 'application/meeko+json' } })).status, 200, 'a visible page keeps its payload')
	for (const route of ['/playground', '/en/playground', '/ar/playground']) assert.equal((await page.goto(server.base + route)).status(), 404, route)
	assert.equal((await page.goto(server.base + '/messages', { waitUntil: 'networkidle' })).status(), 200, 'a rule of another site does not apply')
	assert.equal(await nav.locator('a[href="/playground"]').count(), 0, 'not in the navigation')
	assert.equal((await nav.locator('a[href="/messages"] .nav-featured').textContent())?.trim(), 'Destacado')
	const status = page.getByRole('status').filter({ hasText: notice.message })
	await status.waitFor()
	await page.screenshot({ path: join(output, 'moderation-desktop.png') })
	await status.getByRole('button', { name: 'Cerrar aviso' }).click()
	await status.waitFor({ state: 'detached' })
	await page.waitForFunction(() => globalThis.document.activeElement?.id === 'contenido')
	const html = await page.goto(server.base + '/installation').then((response) => response.text())
	assert.ok(!html.includes(notice.message), 'the closed announcement is not rendered again')
	assert.deepEqual(errors, [])
})
