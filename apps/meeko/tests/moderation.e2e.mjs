// The moderation of the dashboard on the site, in Chrome, against a temporary schema: the test
// migrates it, copies the active snapshot of the development database into it (a read of the real
// tables, never a write), adds a `hide` rule, a `feature` rule and two announcements there, and
// starts `meeko dev` with DATABASE_URL pointed at that schema and a moderation cache of 300 ms
// (DOCS_MODERATION_TTL_MS), so rules added during the test apply at once. The schema is dropped at
// the end. Skipped without DATABASE_URL.
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
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL
const origin = 'https://meekojs.com'
const hidden = '/docs/doctor'
const featured = '/docs/testing'
const exportsIndex = '/docs/reference/exports'
/** Hidden only in English: its Spanish page stays. */
const hiddenInEnglish = '/docs/benchmarks'
/** Hidden in every language (locale null): both URLs leave the site. */
const hiddenEverywhere = '/docs/roadmap'
/** Longer than the moderation cache of the server under test. */
const cacheWait = () => new Promise((done) => setTimeout(done, 600))

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

/** Migrates the schema, copies the active snapshot into it and adds the moderation. */
async function seed(load, schema) {
	const { createAnnouncement, createDatabase, migrate, saveModerationRule } = await load('meeko-docs-content/db')
	const admin = createDatabase({ connectionString: url })
	try {
		const source = (await admin.query('SELECT current_schema() AS name')).rows[0].name
		await admin.query(`CREATE SCHEMA ${schema}`)
		const db = createDatabase({ connectionString: url, searchPath: schema })
		try {
			await migrate(db)
			const active = (await admin.query(`SELECT id FROM ${source}.docs_snapshots WHERE active`)).rows[0]
			assert.ok(active, 'the development database has an active snapshot (run docs:sync)')
			const snapshot = (await db.query("INSERT INTO docs_snapshots (active, published_by) VALUES (true, 'e2e') RETURNING id")).rows[0].id
			await admin.query(`INSERT INTO ${schema}.docs_pages (snapshot_id, locale, path, payload, searchable_text, translation) SELECT $1, locale, path, payload, searchable_text, translation FROM ${source}.docs_pages WHERE snapshot_id = $2`, [snapshot, active.id])
			const paths = (await db.query("SELECT path FROM docs_pages WHERE locale = 'es' AND path = ANY($1)", [[hidden, featured, exportsIndex, hiddenInEnglish, hiddenEverywhere]])).rows.map((row) => row.path)
			assert.deepEqual(paths.sort(), [hidden, featured, exportsIndex, hiddenInEnglish, hiddenEverywhere].sort(), 'the snapshot has the pages the test moderates')
			// A translation older than its original, whatever the state of the development snapshot.
			await db.query(`UPDATE docs_pages SET payload = jsonb_set(payload, '{i18n,status}', '"outdated"') WHERE locale = 'en' AND path = $1`, [featured])
			await saveModerationRule(db, { site: 'site', path: hidden, action: 'hide', reason: 'e2e', author: 'e2e' })
			await saveModerationRule(db, { site: 'site', path: featured, action: 'feature', author: 'e2e' })
			const warning = await createAnnouncement(db, { site: 'site', message: 'Aviso de prueba: mantenimiento el sábado.', tone: 'warning', active: true, author: 'e2e' })
			const danger = await createAnnouncement(db, { site: 'site', message: 'Incidencia de prueba en la búsqueda.', tone: 'danger', active: true, author: 'e2e' })
			await createAnnouncement(db, { site: 'ui', message: 'Aviso de otra web', tone: 'info', active: true, author: 'e2e' })
			// English: a rule of its own and an announcement for every language (locale null).
			await saveModerationRule(db, { site: 'site', locale: 'en', path: hiddenInEnglish, action: 'hide', author: 'e2e' })
			await saveModerationRule(db, { site: 'site', locale: null, path: hiddenEverywhere, action: 'hide', author: 'e2e' })
			const everywhere = await createAnnouncement(db, { site: 'site', locale: null, message: 'Global test notice in every language.', tone: 'info', active: true, author: 'e2e' })
			return { warning, danger, everywhere }
		} finally {
			await db.end()
		}
	} finally {
		await admin.end()
	}
}

/** Runs `change` on the schema under test, as the dashboard would, and returns what it returns. */
async function moderate(load, schema, change) {
	const module = await load('meeko-docs-content/db')
	const db = module.createDatabase({ connectionString: url, searchPath: schema })
	try {
		return await change(db, module)
	} finally {
		await db.end()
	}
}

test('the site hides, features and announces what the dashboard moderates', { skip: url ? false : 'DATABASE_URL is not set', timeout: 240_000 }, async (context) => {
	const vite = await createServer({ root: app, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	const load = (id) => vite.ssrLoadModule(id)
	const { createDatabase } = await load('meeko-docs-content/db')
	const schema = `site_e2e_${process.pid}_${randomBytes(4).toString('hex')}`
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
	const { warning, danger, everywhere } = await seed(load, schema)

	const httpPort = await port()
	const hmrPort = await port()
	const server = spawn(process.execPath, [cli, 'dev', app], {
		cwd: app,
		env: { ...process.env, DATABASE_URL: inSchema(schema), DOCS_MODERATION_TTL_MS: '300', PORT: String(httpPort), MEEKO_PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0', NODE_OPTIONS: '--max-old-space-size=8192' },
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
			if ((await fetch(base + '/docs')).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 100))
	}

	// The server log goes into the failure: a crash of the server is otherwise a refused connection.
	try {
		// Text endpoints: the hidden page leaves the sitemap, llms.txt, llms-full.txt and the search.
		const sitemap = await (await fetch(base + '/sitemap.xml')).text()
		assert.ok(!sitemap.includes(`${origin}${hidden}<`), 'not in the sitemap')
		assert.ok(sitemap.includes(`${origin}${featured}<`))
		const llms = await (await fetch(base + '/llms.txt')).text()
		assert.ok(!llms.includes(`(${origin}${hidden})`), 'not in llms.txt')
		assert.ok(llms.includes(`(${origin}${featured})`))
		const full = await (await fetch(base + '/llms-full.txt')).text()
		assert.ok(!full.includes(`<!-- ${origin}${hidden} -->`), 'not in llms-full.txt')
		assert.ok(full.includes(`<!-- ${origin}${featured} -->`))
		const results = await (await fetch(base + '/api/docs/search?q=doctor')).json()
		assert.ok(results.length > 0, 'the search still answers')
		assert.ok(!results.some((result) => result.url.split('#')[0] === hidden), 'not in the search')

		// English has its own moderation: the Spanish rule does not hide /en/docs/doctor, the English
		// one hides /en/docs/benchmarks (and only there), and the announcements are the English and
		// global ones, also in the endpoint that the banner reads after each navigation.
		assert.equal((await fetch(base + '/en' + hidden)).status, 200, 'a Spanish rule leaves the English page')
		assert.equal((await fetch(base + '/en' + hiddenInEnglish)).status, 404, 'hidden in English')
		assert.equal((await fetch(base + hiddenInEnglish)).status, 200, 'not in Spanish')
		assert.ok(!sitemap.includes(`${origin}/en${hiddenInEnglish}<`) && sitemap.includes(`${origin}${hiddenInEnglish}<`), 'the sitemap per language')
		// A global rule (locale null) hides the page in both languages: answers, sitemap, moderation.
		for (const path of [hiddenEverywhere, '/en' + hiddenEverywhere]) {
			assert.equal((await fetch(base + path)).status, 404, `a global rule hides ${path}`)
			assert.equal((await fetch(base + path, { headers: { accept: 'application/meeko+json' } })).status, 404, `a global rule hides ${path} (navigation)`)
			assert.ok(!sitemap.includes(`${origin}${path}<`) && !sitemap.includes(`href="${origin}${path}"`), `a global rule takes ${path} out of the sitemap`)
		}
		const spanishModeration = await (await fetch(base + '/_meeko-docs/moderation/site')).json()
		assert.ok(spanishModeration.hidden.includes(hiddenEverywhere), 'in the moderation of the Spanish site')
		assert.ok((await (await fetch(base + '/_meeko-docs/moderation/site/en')).json()).hidden.includes('/en' + hiddenEverywhere), 'and of the English site')
		const englishResults = await (await fetch(base + '/api/docs/search?q=benchmarks&locale=en')).json()
		assert.ok(!englishResults.some((result) => result.url.split('#')[0] === '/en' + hiddenInEnglish), 'not in the English search')
		const englishModeration = await (await fetch(base + '/_meeko-docs/moderation/site/en')).json()
		assert.ok(englishModeration.hidden.includes('/en' + hiddenInEnglish))
		assert.deepEqual(
			englishModeration.announcements.map((item) => item.message),
			[everywhere.message],
		)
		const englishHtml = await (await fetch(base + '/en/docs')).text()
		assert.ok(englishHtml.includes(everywhere.message) && !englishHtml.includes(warning.message), 'English and global announcements only')
		assert.ok(!englishHtml.includes('Cerrar aviso') && englishHtml.includes('Close notice'))
		// The rest of the test counts the Spanish announcements alone.
		await moderate(load, schema, async (db, { deleteAnnouncement }) => deleteAnnouncement(db, everywhere.id))
		await cacheWait()

		// An equivalent URL of the hidden page is hidden too, in SSR and in the navigation payload.
		for (const variant of [hidden, '/docs//doctor', '/docs/%64octor', '//docs/doctor/', `${hidden}?x=1`]) {
			assert.equal((await fetch(base + variant)).status, 404, variant)
			assert.equal((await fetch(base + variant, { headers: { accept: 'application/meeko+json' } })).status, 404, `${variant} (navigation)`)
		}

		// HTTP caches revalidate the moderated documents every time: no freshness is added to the 30 s
		// of the reader. The same body answers 304; a new rule changes it at once.
		const indexed = await fetch(base + '/sitemap.xml')
		assert.equal(indexed.headers.get('cache-control'), 'public, no-cache')
		const etag = indexed.headers.get('etag')
		assert.match(etag ?? '', /^W\/"/)
		assert.ok((await indexed.text()).includes(`${origin}${exportsIndex}<`))
		assert.equal((await fetch(base + '/sitemap.xml', { headers: { 'if-none-match': etag } })).status, 304)
		const llmsTag = (await fetch(base + '/llms.txt')).headers.get('etag')
		assert.equal((await fetch(base + '/llms.txt', { headers: { 'if-none-match': llmsTag } })).status, 304)
		await moderate(load, schema, async (db, { saveModerationRule }) => saveModerationRule(db, { site: 'site', path: exportsIndex, action: 'hide', author: 'e2e' }))
		await cacheWait()
		const revalidated = await fetch(base + '/sitemap.xml', { headers: { 'if-none-match': etag } })
		assert.equal(revalidated.status, 200, 'a cached sitemap that the rule changed is not reused')
		assert.ok(!(await revalidated.text()).includes(`${origin}${exportsIndex}<`))

		// The reference index loses every link to the hidden /exports: its card, its section and the
		// links of its modules, with the table of contents.
		const reference = await (await fetch(base + '/docs/reference')).text()
		assert.ok(!reference.includes(`href="${exportsIndex}`), 'no link to /exports in the reference index')
		assert.ok(!reference.includes('id="todos-los-exports"'), 'no section of every export')
		assert.ok(!reference.includes('#todos-los-exports'), 'not in the table of contents')
		assert.equal((await fetch(base + exportsIndex)).status, 404)

		const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
		cleanups.push(() => browser.close())
		const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
		const errors = []
		page.on('pageerror', (error) => errors.push(error.message))

		// A translation older than its original stays published, with a warning and a link to the original.
		await page.goto(base + '/en' + featured, { waitUntil: 'networkidle' })
		const outdated = page.locator('.docs-untranslated')
		assert.equal((await outdated.locator('.meeko-ui-alert-title').textContent())?.trim(), 'This translation may be out of date')
		assert.equal(await outdated.locator('a').getAttribute('href'), featured)
		assert.equal(await outdated.locator('a').getAttribute('hreflang'), 'es')
		assert.equal(await page.locator('main article').evaluate((element) => element.closest('[lang]')?.getAttribute('lang')), 'en', 'its text is the translation')

		// The hidden page answers 404 with the error page.
		const missing = await page.goto(base + hidden)
		assert.equal(missing.status(), 404)

		// The sidebar and the index: no hidden page, one featured badge.
		const guide = await page.goto(base + '/docs/framework', { waitUntil: 'networkidle' })
		assert.equal(guide.status(), 200)
		const sidebar = page.locator('#docs-navigation')
		assert.equal(await sidebar.locator(`a[href="${hidden}"]`).count(), 0, 'not in the sidebar')
		assert.equal((await sidebar.locator(`a[href="${featured}"] .meeko-ui-badge`).textContent())?.trim(), 'Destacado')
		await page.goto(base + '/docs', { waitUntil: 'networkidle' })
		assert.equal(await page.locator(`main a[href="${hidden}"]`).count(), 0, 'not in /docs')
		assert.equal(await page.locator(`main a[href="${featured}"] .featured`).count(), 1)

		// Client navigation to the hidden page shows the error page too.
		await page.goto(base + '/docs/framework', { waitUntil: 'networkidle' })
		await page.evaluate((target) => {
			const link = globalThis.document.createElement('a')
			link.href = target
			link.textContent = 'oculta'
			link.id = 'e2e-hidden'
			globalThis.document.querySelector('main')?.append(link)
		}, hidden)
		await page.click('#e2e-hidden')
		await page.waitForFunction(() => globalThis.document.title.includes('404') || /no existe|no encontrada|404/i.test(globalThis.document.querySelector('main')?.textContent ?? ''))

		// A new announcement during the session shows after the next client navigation, without a reload.
		// The mark is set before the announcement exists: a reload of the document (which would render
		// it in SSR and hide the bug) removes the mark and fails the test.
		await page.goto(base + '/docs/framework', { waitUntil: 'networkidle' })
		await page.evaluate(() => {
			globalThis.__e2eSession = 'same document'
		})
		const fresh = await moderate(load, schema, async (db, { createAnnouncement }) => createAnnouncement(db, { site: 'site', message: 'Aviso nuevo durante la sesión.', tone: 'success', active: true, author: 'e2e' }))
		await cacheWait()
		assert.equal(await page.getByRole('status').filter({ hasText: fresh.message }).count(), 0, 'not before a navigation')
		await page.locator(`#docs-navigation a[href="${featured}"]`).first().click()
		await page.waitForURL(base + featured)
		await page.getByRole('status').filter({ hasText: fresh.message }).waitFor({ timeout: 10_000 })
		assert.equal(await page.evaluate(() => globalThis.__e2eSession), 'same document', 'it arrived without a reload')
		// And it leaves on the next navigation once the dashboard deletes it.
		await moderate(load, schema, async (db, { deleteAnnouncement }) => deleteAnnouncement(db, fresh.id))
		await cacheWait()
		await page.locator('#docs-navigation a[href="/docs/framework"]').first().click()
		await page.waitForURL(base + '/docs/framework')
		await page.getByRole('status').filter({ hasText: fresh.message }).waitFor({ state: 'detached', timeout: 10_000 })
		assert.equal(await page.evaluate(() => globalThis.__e2eSession), 'same document')

		// The announcements: in the SSR HTML, status and alert by tone, closed and remembered.
		const html = await (await fetch(base + '/docs')).text()
		assert.ok(html.includes(warning.message) && html.includes(danger.message), 'painted by the server')
		assert.ok(!html.includes('Aviso de otra web'), 'only the announcements of the site')
		await page.goto(base + '/docs', { waitUntil: 'networkidle' })
		const status = page.getByRole('status').filter({ hasText: warning.message })
		const alert = page.getByRole('alert').filter({ hasText: danger.message })
		await status.waitFor()
		await alert.waitFor()
		await page.screenshot({ path: join(app, '.meeko', 'screenshots', 'moderation-desktop.png') })
		await status.getByRole('button', { name: 'Cerrar aviso' }).click()
		await status.waitFor({ state: 'detached' })
		// The focus stays in the banner, on the close button of the next announcement.
		await page.waitForFunction(() => globalThis.document.activeElement?.getAttribute('aria-label') === 'Cerrar aviso')
		const cookies = await page.context().cookies(base)
		assert.equal(cookies.find((cookie) => cookie.name === 'meeko-docs-notices')?.value, String(warning.id))
		const reloaded = await page.goto(base + '/docs', { waitUntil: 'networkidle' })
		const again = await reloaded.text()
		assert.ok(!again.includes(warning.message), 'a closed announcement is not rendered again')
		assert.ok(again.includes(danger.message))

		// Small screens: the banner wraps without a horizontal scroll.
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(base + '/docs/framework', { waitUntil: 'networkidle' })
		await alert.waitFor()
		assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), 'no horizontal scroll at 390 px')
		await page.screenshot({ path: join(app, '.meeko', 'screenshots', 'moderation-mobile.png') })
		await alert.getByRole('button', { name: 'Cerrar aviso' }).click()
		await alert.waitFor({ state: 'detached' })
		// After the last one, the focus goes to the content.
		await page.waitForFunction(() => globalThis.document.activeElement?.id === 'contenido')
		assert.deepEqual(errors, [])
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.stack : error}

Server:
${logs.slice(-6000)}`,
			{ cause: error },
		)
	}
})
