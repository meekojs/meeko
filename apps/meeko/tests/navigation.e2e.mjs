// Client navigation between the two root layouts of the site, in Chrome, with the production build and
// the active snapshot of the development database (read only: the test writes nothing). Each root layout brings its own
// <UIApp>, and the tree that replaces them hydrates before the committed one is released. A 404 of a
// URL with a route hydrates the error page, inside another layout than that route's. Every link must
// navigate without a new document, into the right layout. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { execSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const app = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../../../packages/meeko/dist/cli.js', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))

async function port() {
	const server = createNetServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const value = server.address().port
	await new Promise((done) => server.close(done))
	return value
}

/** From, to and whether the destination is in the docs layout, with its navigation tree. */
const journeys = [
	['/docs/framework', '/', false],
	['/', '/docs/framework', true],
	['/docs/framework', '/docs/api', true],
	['/docs/no-such-page', '/', false],
	['/docs/no-such-page', '/docs/framework', true],
	['/no-such-page', '/', false],
	['/no-such-page', '/docs/framework', true],
	['/docs/framework', '/docs/no-such-page', false],
]

test('links navigate in the client between the root layouts, also from a 404', { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set', timeout: 240_000 }, async (context) => {
	// The production build: with `meeko dev`, import.meta.hot lets two <UIApp> overlap as an HMR handover.
	execSync('pnpm run build', { cwd: app, stdio: 'pipe', timeout: 180_000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } })
	const httpPort = await port()
	const server = spawn(process.execPath, [cli, 'start', app], {
		cwd: app,
		// DOCS_METRICS stays as in .env: an automated browser never counts views (meeko-docs/metrics).
		env: { ...process.env, PORT: String(httpPort), MEEKO_PORT: String(httpPort), NODE_OPTIONS: '--max-old-space-size=8192' },
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	context.after(async () => {
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
			if ((await fetch(base + '/docs/framework')).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 100))
	}

	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	for (const [from, to, docs] of journeys) {
		const journey = `${from} → ${to}`
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
		const problems = []
		page.on('pageerror', (error) => problems.push(error.message))
		page.on('console', (message) => {
			// The 404 page answers 404, which Chrome logs as a failed resource.
			if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) problems.push(message.text())
		})
		await page.goto(base + from, { waitUntil: 'networkidle' })
		await page.evaluate((target) => {
			globalThis.sameDocument = true
			const link = globalThis.document.createElement('a')
			link.href = target
			link.id = 'journey'
			link.textContent = 'go'
			link.style.cssText = 'position:fixed;top:0;left:0;z-index:99999'
			globalThis.document.body.append(link)
		}, to)
		await page.locator('#journey').click()
		await page.waitForFunction((target) => globalThis.location.pathname === target, to, { timeout: 15_000 }).catch(() => assert.fail(`${journey}: the URL did not change: ${problems.join(' | ')}`))
		await page.waitForFunction(() => !globalThis.document.querySelector('[data-meeko-navigating]'), undefined, { timeout: 15_000 })
		assert.equal(await page.evaluate(() => globalThis.sameDocument === true), true, `${journey} loaded a new document`)
		await page.locator('main').first().waitFor()
		assert.equal(await page.locator('header').first().isVisible(), true, `${journey}: header`)
		assert.equal((await page.locator('.meeko-ui-nav-tree').count()) > 0, docs, `${journey}: the layout of the destination`)
		assert.deepEqual(problems, [], journey)
		await page.close()
	}
})
