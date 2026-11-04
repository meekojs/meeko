// How a real build of @meekojs/i18n requests its catalogs, in Chrome: the catalogs of a document or a navigation
// are held until all of them have been requested, so a catalog that waits for another one times out here. SSR,
// hydration, client navigation, the language switch and the document that loses a catalog.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

/** The namespace of a catalog chunk: `_meeko-i18n_catalog_es_common-<hash>.js` gives `es/common`. */
const catalogOf = (url) => /_meeko-i18n_catalog_([a-z]+)_([A-Za-z0-9-]+?)-[^/]+\.js$/.exec(new URL(url).pathname)?.slice(1).join('/')

/**
 * Holds the catalogs of the page until every one of `expected` has been requested, and records them.
 * Resolves with the list requested; `release` lets through whatever arrives afterwards.
 */
async function holdCatalogs(page, expected) {
	const requested = []
	const held = []
	let open = false
	const release = () => {
		open = true
		for (const route of held.splice(0)) void route.continue()
	}
	await page.route(
		(url) => catalogOf(url.href) !== undefined,
		(route) => {
			requested.push(catalogOf(route.request().url()))
			if (open) return void route.continue()
			held.push(route)
			if (expected.every((name) => requested.includes(name))) release()
		},
	)
	return { requested, stop: () => (release(), page.unroute((url) => catalogOf(url.href) !== undefined)) }
}

const hydrated = (page) => page.waitForFunction(() => performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 15_000 })

test('catalogs arrive together, in SSR, hydration, client navigation and the language switch', { timeout: 120_000 }, async (context) => {
	const socket = createServer().listen(0, '127.0.0.1')
	await once(socket, 'listening')
	const port = socket.address().port
	await new Promise((done) => socket.close(done))
	const root = fileURLToPath(new URL('../', import.meta.url))
	const cli = fileURLToPath(new URL('../../../packages/meeko/dist/cli.js', import.meta.url))
	const server = spawn(process.execPath, [cli, 'start', root], { cwd: root, env: { ...process.env, PORT: String(port), MEEKO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
	context.after(() => server.kill())
	let logs = ''
	server.stdout.on('data', (chunk) => (logs += chunk))
	server.stderr.on('data', (chunk) => (logs += chunk))
	const origin = `http://127.0.0.1:${port}`
	const started = Date.now()
	for (;;) {
		if (server.exitCode !== null || Date.now() - started > 30_000) throw new Error(logs)
		try {
			if ((await fetch(origin)).ok) break
		} catch {
			/* The server is starting. */
		}
		await new Promise((done) => setTimeout(done, 50))
	}
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const text = '[data-output="namespace"]'

	// SSR: the namespaces of the route are in the document, also those of /namespaces only.
	const ssr = (await (await fetch(`${origin}/namespaces`)).text()).replace(/<!--[^]*?-->/g, '')
	assert.match(ssr, /Tu pedido tiene 3 productos\./)
	assert.match((await (await fetch(`${origin}/en/namespaces`)).text()).replace(/<!--[^]*?-->/g, ''), /<html[^>]* lang="en"/)

	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'es-ES' })
	const problems = []
	page.on('pageerror', (error) => problems.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error' || message.text().includes('[meeko:i18n]')) problems.push(message.text())
	})

	// Hydration of a route with its own namespace: all four at once, one request each.
	const direct = await holdCatalogs(page, ['es/common', 'es/site', 'es/shell', 'es/checkout'])
	await page.goto(`${origin}/namespaces`)
	await hydrated(page)
	assert.deepEqual(direct.requested.toSorted(), ['es/checkout', 'es/common', 'es/shell', 'es/site'])
	assert.equal(await page.locator(text).innerText(), 'Tu pedido tiene 3 productos.')
	await direct.stop()

	// Client navigation: only what the new route lacks, in the same document.
	const home = await holdCatalogs(page, ['es/common', 'es/site', 'es/shell'])
	await page.goto(`${origin}/installation`)
	await hydrated(page)
	assert.deepEqual(home.requested.toSorted(), ['es/common', 'es/shell', 'es/site'], 'a route without namespaces does not request checkout')
	await home.stop()
	await page.evaluate(() => {
		globalThis.sameDocument = true
	})
	const navigation = await holdCatalogs(page, ['es/checkout'])
	await page.getByRole('navigation', { name: 'Documentación de i18n', exact: true }).getByRole('link', { name: 'Namespaces', exact: true }).click()
	await page.waitForURL(`${origin}/namespaces`)
	await page.locator(text).waitFor()
	assert.equal(await page.locator(text).innerText(), 'Tu pedido tiene 3 productos.')
	assert.equal(await page.evaluate(() => globalThis.sameDocument), true)
	assert.deepEqual(navigation.requested, ['es/checkout'])
	await navigation.stop()

	// The language switch loads the other document, with the catalogs of its language at once.
	const english = await holdCatalogs(page, ['en/common', 'en/site', 'en/shell', 'en/checkout'])
	await page.getByRole('navigation', { name: 'Idioma', exact: true }).getByRole('link', { name: 'English', exact: true }).click()
	await page.waitForURL(`${origin}/en/namespaces`)
	await hydrated(page)
	assert.equal(await page.locator('html').getAttribute('lang'), 'en')
	assert.equal(await page.evaluate(() => globalThis.sameDocument), undefined)
	assert.ok(
		['en/common', 'en/site', 'en/shell', 'en/checkout'].every((name) => english.requested.includes(name)),
		english.requested.join(),
	)
	assert.equal(
		english.requested.some((name) => name.startsWith('es/')),
		false,
		english.requested.join(),
	)
	assert.match(await page.locator(text).innerText(), /Your order has 3 products/)
	await english.stop()
	assert.deepEqual(problems, [])

	// A document that loses a catalog does not hydrate and keeps its server HTML, as before: the error is the catalog's.
	const failed = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'es-ES' })
	const errors = []
	failed.on('pageerror', (error) => errors.push(error.message))
	await failed.route(
		(url) => catalogOf(url.href) === 'es/shell',
		(route) => route.abort(),
	)
	await failed.goto(`${origin}/namespaces`, { waitUntil: 'load' })
	await failed.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => entry.name.includes('_meeko-i18n_catalog_es_checkout') && entry.responseEnd > 0))
	await failed.waitForTimeout(500)
	assert.equal(await failed.locator(text).innerText(), 'Tu pedido tiene 3 productos.')
	assert.equal(await failed.evaluate(() => performance.getEntriesByName('meeko-hydration').length), 0)
	assert.equal(errors.length, 1, errors.join('\n'))
	assert.match(errors[0], /catalog_es_shell/)
})
