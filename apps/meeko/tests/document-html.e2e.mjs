// The first load of a guide carries its HTML once (`documentHtml`), in Chrome, in production and in
// `meeko dev`, against a temporary schema: the test copies the active snapshot of the development
// database into it (a read of the real tables, never a write), publishes there and drops it at the
// end. Everything a guide does must still work: hydration that rewrites nothing, client navigation
// and history, the table of contents, anchors, search and copy buttons, the language selector, the
// CSP and content published while an old document is cached. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { execSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
const guide = '/docs/framework'
const other = '/docs/api'
const article = 'main article[data-pagefind-body]'
const payloadScript = /<script id="meeko-payload" type="application\/json">([^<]*)<\/script>/

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

/** A temporary schema with a copy of the active snapshot, dropped when the test ends. */
async function temporarySnapshot(context) {
	const vite = await createServer({ root: app, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	const { createDatabase, migrate } = await vite.ssrLoadModule('meeko-docs-content/db')
	const schema = `guide_e2e_${process.pid}_${randomBytes(4).toString('hex')}`
	const admin = createDatabase({ connectionString: url })
	const db = createDatabase({ connectionString: url, searchPath: schema })
	context.after(async () => {
		await db.end()
		await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin.end()
		await vite.close()
	})
	const source = (await admin.query('SELECT current_schema() AS name')).rows[0].name
	await admin.query(`CREATE SCHEMA ${schema}`)
	await migrate(db)
	const active = (await admin.query(`SELECT id FROM ${source}.docs_snapshots WHERE active`)).rows[0]
	assert.ok(active, 'the development database has an active snapshot (run docs:sync)')
	const snapshot = (await db.query("INSERT INTO docs_snapshots (active, published_by) VALUES (true, 'e2e') RETURNING id")).rows[0].id
	await admin.query(`INSERT INTO ${schema}.docs_pages (snapshot_id, locale, path, payload, searchable_text, translation) SELECT $1, locale, path, payload, searchable_text, translation FROM ${source}.docs_pages WHERE snapshot_id = $2`, [snapshot, active.id])
	return { schema, db }
}

/** Starts the app with `command` and stops it when the test ends. */
async function serve(context, command, schema) {
	const httpPort = await port()
	const hmrPort = await port()
	const server = spawn(process.execPath, [cli, command, app], {
		cwd: app,
		env: { ...process.env, DATABASE_URL: inSchema(schema), DOCS_MODERATION_TTL_MS: '300', PORT: String(httpPort), MEEKO_PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0', NODE_OPTIONS: '--max-old-space-size=8192' },
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
		if (server.exitCode !== null || Date.now() - started > 120_000) throw new Error(logs)
		try {
			if ((await fetch(base + guide, { headers: { accept: 'text/html' } })).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 200))
	}
	return base
}

/**
 * A page that records what happens to the article from the moment the parser ends, before Meeko's
 * deferred module runs: its first heading and its content, and every change to them.
 */
async function watchedPage(browser, context) {
	const browserContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
	context.after(() => browserContext.close())
	const page = await browserContext.newPage()
	const problems = []
	page.on('pageerror', (error) => problems.push(error.message))
	page.on('console', (message) => {
		const text = message.text()
		if (message.type() === 'error' && !text.startsWith('Failed to load resource')) problems.push(text)
		if (/hydrat|mismatch/i.test(text)) problems.push(text)
	})
	await page.addInitScript(() => {
		globalThis.__violations = []
		globalThis.document.addEventListener('securitypolicyviolation', (event) => globalThis.__violations.push(`${event.violatedDirective} ${event.blockedURI}`))
		globalThis.document.addEventListener('readystatechange', () => {
			if (globalThis.document.readyState !== 'interactive') return
			const node = globalThis.document.querySelector('main article[data-pagefind-body]')
			if (!node) return
			globalThis.__article = { node, heading: node.querySelector('h2'), html: node.innerHTML, changes: 0 }
			new globalThis.MutationObserver((records) => (globalThis.__article.changes += records.length)).observe(node, { childList: true, subtree: true, characterData: true })
		})
	})
	return { page, problems }
}

/** Hydration, over once the network is idle, kept every node of the article and wrote nothing. */
async function assertAdopted(page, label) {
	const result = await page.evaluate((selector) => {
		const { node, heading, html, changes } = globalThis.__article
		return { sameNode: globalThis.document.querySelector(selector) === node, sameHeading: node.querySelector('h2') === heading, sameHtml: node.innerHTML === html, changes, length: html.length }
	}, article)
	assert.deepEqual(result, { sameNode: true, sameHeading: true, sameHtml: true, changes: 0, length: result.length }, `${label}: hydration rewrites nothing`)
	assert.ok(result.length > 1000, `${label}: the HTML of the server is there`)
}

/** What the article of the page shows is what a navigation payload of `path` says. */
async function assertArticleOf(page, path, label) {
	await page.waitForFunction((target) => globalThis.location.pathname === target, path)
	const same = await page.evaluate(
		async ({ path, selector }) => {
			const response = await fetch(path, { headers: { accept: 'application/meeko+json' } })
			const payload = await response.json()
			const holder = globalThis.document.createElement('template')
			holder.innerHTML = payload.props.data.doc.html
			const shown = globalThis.document.querySelector(selector)
			return holder.innerHTML === shown.innerHTML ? true : { expected: holder.innerHTML.length, shown: shown.innerHTML.length }
		},
		{ path, selector: article },
	)
	assert.equal(same, true, `${label}: the article of ${path}`)
}

/** Everything a reader does on a guide; `page` starts on no page at all. */
async function readerJourney(page, problems, base, label) {
	await page.goto(base + guide, { waitUntil: 'networkidle' })
	await assertAdopted(page, label)
	await page.evaluate(() => {
		globalThis.__e2eDocument = 'same'
	})

	// The table of contents and its anchors, which the browser resolves in the adopted HTML.
	const entry = page.locator('.meeko-ui-page-aside .meeko-ui-toc a').nth(2)
	const anchor = await entry.getAttribute('href')
	await entry.click()
	await page.waitForFunction((hash) => globalThis.location.hash === hash, anchor)
	const heading = page.locator(`${article} [id="${decodeURIComponent(anchor.slice(1))}"]`)
	assert.equal(await heading.count(), 1, `${label}: the anchor exists`)
	const box = await heading.boundingBox()
	assert.ok(box && box.y >= 0 && box.y < 1000, `${label}: the anchor scrolled into view`)

	// The copy button of the rendered Markdown.
	const copy = page.locator(`${article} button[data-copy]`).first()
	await copy.scrollIntoViewIfNeeded()
	await copy.click()
	await page.locator(`${article} button[data-copy][data-state]`).first().waitFor()

	// The search.
	await page.locator('.meeko-ui-command-trigger').first().click()
	await page.locator('dialog.meeko-ui-command input[type="search"]').fill('signal')
	await page.locator('dialog.meeko-ui-command .meeko-ui-command-row').first().waitFor()
	await page.keyboard.press('Escape')

	// Client navigation to another guide and through the history, in one document.
	await page.locator(`#docs-navigation a[href="${other}"]`).first().click()
	await assertArticleOf(page, other, `${label}: forward link`)
	await page.goBack()
	await assertArticleOf(page, guide, `${label}: back`)
	await page.goForward()
	await assertArticleOf(page, other, `${label}: forward`)
	await page.goBack()
	await assertArticleOf(page, guide, `${label}: back again`)

	assert.equal(await page.evaluate(() => globalThis.__e2eDocument), 'same', `${label}: no new document`)

	// The language selector, both ways: the i18n plugin loads the other language as a new document,
	// a first load that adopts its own HTML.
	await page.locator('header nav.meeko-ui-locale-switcher a[hreflang="en"]').click()
	await page.waitForURL((target) => target.pathname === `/en${guide}`, { waitUntil: 'networkidle' })
	assert.equal(await page.locator('html').getAttribute('lang'), 'en')
	await assertAdopted(page, `${label}: English`)
	await assertArticleOf(page, `/en${guide}`, `${label}: English`)
	await page.locator('header nav.meeko-ui-locale-switcher a[hreflang="es"]').click()
	await page.waitForURL((target) => target.pathname === guide, { waitUntil: 'networkidle' })
	assert.equal(await page.locator('html').getAttribute('lang'), 'es')
	await assertAdopted(page, `${label}: Spanish`)
	await assertArticleOf(page, guide, `${label}: Spanish`)

	assert.deepEqual(problems, [], `${label}: no errors or hydration warnings`)
	assert.deepEqual(await page.evaluate(() => globalThis.__violations), [], `${label}: no CSP violations`)
}

test('production: the HTML travels once and every feature of a guide still works', { skip: url ? false : 'DATABASE_URL is not set', timeout: 420_000 }, async (context) => {
	const { schema, db } = await temporarySnapshot(context)
	execSync('pnpm run build', { cwd: app, stdio: 'pipe', timeout: 240_000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } })
	const base = await serve(context, 'start', schema)

	const response = await fetch(base + guide, { headers: { accept: 'text/html' } })
	const documentHtml = await response.text()
	const payload = payloadScript.exec(documentHtml)[1]
	assert.ok(payload.length < documentHtml.length / 20, `the payload (${payload.length}) is a small part of the document (${documentHtml.length})`)
	const identities = JSON.parse(payload).documentHtml
	assert.equal(identities.length, 1, 'the document names the value it left out')
	const navigation = await (await fetch(base + guide, { headers: { accept: 'application/meeko+json' } })).json()
	assert.ok(navigation.props.data.doc.html.length > 1000, 'a navigation receives the whole HTML')
	assert.deepEqual(navigation.markedHtml, { [identities[0]]: ['props', 'data', 'doc', 'html'] }, 'and declares where it has that value')
	assert.ok(documentHtml.includes(navigation.props.data.doc.html.slice(0, 2000)), 'the document has the HTML, for readers and crawlers without JavaScript')
	// Nothing new in the policy: the payload is a data block, and scripts stay without unsafe-inline.
	const scripts = response.headers
		.get('content-security-policy')
		.split(';')
		.find((directive) => directive.trim().startsWith('script-src'))
	assert.ok(!scripts.includes("'unsafe-inline'"), scripts)

	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const { page, problems } = await watchedPage(browser, context)
	await readerJourney(page, problems, base, 'production')

	// A document cached before publishing: it shows the old content and hydrates clean, and the
	// content published meanwhile arrives with the next navigation, like a fresh load.
	const stale = await fetch(base + guide, { headers: { accept: 'text/html' } })
	const staleBody = await stale.text()
	const staleHeaders = Object.fromEntries(stale.headers)
	const marker = `publicado-${randomBytes(4).toString('hex')}`
	const openTab = await watchedPage(browser, context)
	await openTab.page.goto(base + guide, { waitUntil: 'networkidle' })
	await assertAdopted(openTab.page, 'an open tab')

	const {
		rows: [{ id: published }],
	} = await db.query("INSERT INTO docs_snapshots (active, published_by) VALUES (false, 'e2e') RETURNING id")
	await db.query(
		`INSERT INTO docs_pages (snapshot_id, locale, path, payload, searchable_text, translation)
		SELECT $1, locale, path,
			CASE WHEN path = $2 THEN jsonb_set(payload, '{doc,html}', to_jsonb('<p id="' || $3 || '">' || $3 || '</p>' || (payload->'doc'->>'html'))) ELSE payload END,
			searchable_text, translation
		FROM docs_pages WHERE snapshot_id = (SELECT id FROM docs_snapshots WHERE active)`,
		[published, guide, marker],
	)
	await db.query('UPDATE docs_snapshots SET active = (id = $1)', [published])

	const fresh = await fetch(base + guide, { headers: { accept: 'text/html' } })
	assert.ok((await fresh.text()).includes(`<p id="${marker}">`), 'a new document shows what was published')

	const cached = await watchedPage(browser, context)
	await cached.page.route(base + guide, (route) => (route.request().resourceType() === 'document' ? route.fulfill({ status: 200, headers: staleHeaders, body: staleBody }) : route.continue()))
	await cached.page.goto(base + guide, { waitUntil: 'networkidle' })
	await assertAdopted(cached.page, 'a cached document')
	assert.equal(await cached.page.locator(`[id="${marker}"]`).count(), 0, 'the cached document keeps its content')
	await cached.page.locator(`#docs-navigation a[href="${other}"]`).first().click()
	await assertArticleOf(cached.page, other, 'from a cached document')
	await cached.page.locator(`#docs-navigation a[href="${guide}"]`).first().click()
	await cached.page.locator(`${article} [id="${marker}"]`).waitFor()
	await assertArticleOf(cached.page, guide, 'back to the published guide')
	assert.deepEqual(cached.problems, [], 'a cached document hydrates without errors')

	// A tab that was already open reaches the published content the same way.
	await openTab.page.locator(`#docs-navigation a[href="${other}"]`).first().click()
	await assertArticleOf(openTab.page, other, 'from an open tab')
	await openTab.page.goBack()
	await openTab.page.locator(`${article} [id="${marker}"]`).waitFor()
	assert.deepEqual(openTab.problems, [], 'an open tab sees no errors')
})

test('meeko dev: hydration, every feature of a guide and a hot update that reads the value from the server', { skip: url ? false : 'DATABASE_URL is not set', timeout: 300_000 }, async (context) => {
	const { schema } = await temporarySnapshot(context)
	const base = await serve(context, 'dev', schema)
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const { page, problems } = await watchedPage(browser, context)
	await readerJourney(page, problems, base, 'meeko dev')

	// A hot update of a child paints it again with the props of the first load, which hold the
	// placeholder: its HTML comes back from the server, not from the DOM. (Editing the page itself
	// reloads the document, because of its <script server>, and that is a new first load.)
	const reference = '/docs/reference/html'
	const body = 'main .body'
	await page.goto(base + reference, { waitUntil: 'networkidle' })
	await page.evaluate(() => {
		globalThis.__e2eDocument = 'same'
	})
	assert.equal(await page.evaluate(() => JSON.parse(globalThis.document.getElementById('meeko-payload').textContent).props.data.written.body), '<!--meeko:document-html:0-->')
	const file = join(app, 'app/components/ReferenceArticle.meeko')
	const original = readFileSync(file, 'utf8')
	const requests = []
	page.on('request', (request) => {
		if (request.headers().accept === 'application/meeko+json') requests.push(new URL(request.url()).pathname)
	})
	try {
		writeFileSync(file, original.replace('class="body"', 'class="body" data-e2e-hot'))
		await page.locator(`${body}[data-e2e-hot]`).waitFor({ timeout: 60_000 })
		await page.waitForFunction((selector) => (globalThis.document.querySelector(selector)?.innerHTML.length ?? 0) > 1000, body)
		assert.equal(await page.evaluate(() => globalThis.__e2eDocument), 'same', 'a hot update, not a reload')
		assert.deepEqual(requests, [reference], 'the value comes from the server')
		const same = await page.evaluate(
			async ({ path, selector }) => {
				const payload = await (await fetch(path, { headers: { accept: 'application/meeko+json' } })).json()
				const holder = globalThis.document.createElement('template')
				holder.innerHTML = payload.props.data.written.body
				return holder.innerHTML === globalThis.document.querySelector(selector).innerHTML
			},
			{ path: reference, selector: body },
		)
		assert.equal(same, true, 'the HTML the server declared, whole')
	} finally {
		writeFileSync(file, original)
	}
	assert.deepEqual(problems, [], 'no errors in the hot update')
})
