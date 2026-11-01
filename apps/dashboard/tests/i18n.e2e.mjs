// The dashboard in English under /en/… against a temporary schema: the login and its CSRF keep the
// language, every page is in English with hreflang and the language switch, and the translations,
// moderation and metrics work per language. The real tables of the development database are never
// read or written. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

import { adminEnv, sessionHeaders, startDashboard, testAdmin } from './fixtures/auth.mjs'

const app = fileURLToPath(new URL('../', import.meta.url))
const repository = fileURLToPath(new URL('../../../', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL

const gitText = (file) => readFileSync(join(repository, file), 'utf8').replace(/\r\n?/g, '\n')
const hash = (text) => createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex')

/** Text a page of /en must never contain: the Spanish of the interface. */
const spanish = /[áéíóúñ¿¡]|\b(Resumen|Fuentes?|Traducciones|Moderación|Métricas|Salud|Cerrar|Saltar|Buscar|Todas?|Todos|Revisiones|Publicar|Importar|Guardad[oa]s?|Página|Web de|Estado|Acciones|Autor|Sin |Nota|Enlace|Idioma|Avisos?)\b/

/** The translations of the temporary schema: one in each status. */
async function seed(load, schema) {
	const { createDatabase, importSources, migrate } = await load('meeko-docs-content/db')
	const { publishSnapshot } = await load('meeko-docs-content/snapshots')
	const admin = createDatabase({ connectionString: url })
	await admin.query(`CREATE SCHEMA ${schema}`)
	await admin.end()
	const db = createDatabase({ connectionString: url, searchPath: schema })
	try {
		await migrate(db)
		const doctor = gitText('docs/doctor.md')
		const testing = gitText('docs/testing.md')
		await importSources(
			db,
			[
				// Translated: its source-hash is the hash of the imported original.
				{ site: 'site', path: '/docs/doctor', kind: 'guide', title: 'Doctor', file: 'docs/doctor.md', markdown: doctor },
				{ site: 'site', locale: 'en', sourceHash: hash(doctor), path: '/docs/doctor', kind: 'guide', title: 'Doctor', file: 'docs/en/doctor.md', markdown: gitText('docs/en/doctor.md') },
				// Outdated: the original gained a paragraph after the text the translation names (the working tree).
				{ site: 'site', path: '/docs/testing', kind: 'guide', title: 'Testing', file: 'docs/testing.md', markdown: `${testing}\nNuevo parrafo del original.\n` },
				{ site: 'site', locale: 'en', sourceHash: hash(testing), path: '/docs/testing', kind: 'guide', title: 'Testing', file: 'docs/en/testing.md', markdown: gitText('docs/en/testing.md') },
				// Missing: no translation.
				{ site: 'site', path: '/docs/api', kind: 'guide', title: 'API', file: 'docs/api.md', markdown: gitText('docs/api.md') },
				{ site: 'ui', path: '/installation', kind: 'page', title: 'Installation', file: null, markdown: null },
			],
			['site', 'ui'],
		)
		const snapshot = await publishSnapshot(
			[
				{ path: '/docs', payload: { title: 'one' } },
				{ path: '/docs', locale: 'en', payload: { title: 'one' } },
			],
			{ db, publishedBy: 'e2e' },
		)
		await db.query(`INSERT INTO docs_page_views (site, locale, path, day, views) VALUES ('site', 'en', '/docs/doctor', current_date, 5), ('site', 'es', '/docs/testing', current_date, 3)`)
		const ids = await db.query(`SELECT id, path, locale FROM docs_sources WHERE site = 'site'`)
		const id = (path, locale) => Number(ids.rows.find((row) => row.path === path && row.locale === locale).id)
		return { snapshot, doctor: id('/docs/doctor', 'es'), testing: id('/docs/testing', 'es'), testingEn: id('/docs/testing', 'en'), api: id('/docs/api', 'es') }
	} finally {
		await db.end()
	}
}

test('the dashboard in English: login, pages, language switch, translations, moderation and metrics', { skip: url ? false : 'DATABASE_URL is not set', timeout: 420_000 }, async (context) => {
	const vite = await createServer({ root: app, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	const load = (id) => vite.ssrLoadModule(id)
	const { createDatabase } = await load('meeko-docs-content/db')
	const schema = `dash_i18n_${process.pid}_${randomBytes(4).toString('hex')}`
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
	const ids = await seed(load, schema)
	const account = await testAdmin()
	const server = await startDashboard({ ...adminEnv(account), DASHBOARD_DATABASE_SCHEMA: schema })
	cleanups.push(() => server.stop())
	const { origin } = server

	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	cleanups.push(() => browser.close())
	// A reader whose browser prefers English; the context of the suggestion prefers it on a Spanish page.
	const browserContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
	const page = await browserContext.newPage()
	const errors = []
	const missing = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
		if (message.text().includes('[meeko:i18n]')) missing.push(message.text())
	})
	const hydrated = () => page.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 60_000 })
	const open = async (path) => {
		await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' })
		try {
			await hydrated()
		} catch (error) {
			throw new Error(
				`${path} did not hydrate: ${errors.join(' | ')}
${server.logs().slice(-2000)}`,
				{ cause: error },
			)
		}
	}

	// Without a session /en goes to the English login and back ------------------------------------

	await open('/en/sources?site=ui')
	assert.equal(new URL(page.url()).pathname, '/en/login')
	assert.equal(new URL(page.url()).searchParams.get('next'), '/en/sources?site=ui')
	assert.equal(await page.getAttribute('html', 'lang'), 'en')
	assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Sign in')

	// The validation and the failure of the login, in English.
	await page.getByRole('button', { name: 'Sign in' }).click()
	await page.getByText('Enter your user name.').waitFor({ timeout: 30_000 })
	await page.getByLabel('User name').fill(account.username)
	await page.getByLabel('Password').fill('not-the-password')
	await page.getByRole('button', { name: 'Sign in' }).click()
	await page.getByText('The user name or the password is not correct.').waitFor({ timeout: 30_000 })

	// The native form without JavaScript: an error comes back to the English page, with `next`.
	const native = await fetch(`${origin}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
		body: new URLSearchParams({ username: account.username, password: 'wrong', next: '/en/metrics', return: '/en/login?next=%2Fen%2Fmetrics' }),
		redirect: 'manual',
	})
	assert.equal(native.status, 303)
	assert.equal(native.headers.get('location'), '/en/login?next=%2Fen%2Fmetrics')

	await page.getByLabel('Password').fill(account.password)
	await Promise.all([page.waitForURL((address) => address.pathname === '/en/sources', { timeout: 60_000 }), page.getByRole('button', { name: 'Sign in' }).click()])
	assert.equal(new URL(page.url()).search, '?site=ui', 'the login goes back to the English page, with its query')
	await hydrated()

	// CSRF: a mutation of an English page with the session's token; without it, 403.
	const headers = await sessionHeaders(page, origin)
	const rpc = (name, body, extra = headers) => fetch(`${origin}/_meeko/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) })
	assert.equal((await rpc('moderation/rules/save', { site: 'site', locale: 'en', path: '/docs/doctor', action: 'hide', id: null, version: null }, { origin, cookie: headers.cookie })).status, 403)

	// Every page in English, without a word of the Spanish interface ------------------------------

	const pages = ['/en', '/en/sources', `/en/sources/${ids.testing}`, `/en/sources/${ids.testingEn}/edit`, '/en/translations', `/en/translations/${ids.testing}`, '/en/moderation', '/en/metrics', '/en/health', '/en/snapshots']
	for (const path of pages) {
		await open(path)
		assert.equal(await page.getAttribute('html', 'lang'), 'en', path)
		const report = await page.evaluate(() => {
			// The content of the documentation is data: the originals in Spanish are marked with lang="es".
			const clone = globalThis.document.body.cloneNode(true)
			for (const node of clone.querySelectorAll('[lang="es"], script, style, code, pre, textarea, iframe')) node.remove()
			const attributes = [...globalThis.document.querySelectorAll('[aria-label], [title], [placeholder]')].filter((node) => !node.closest('[lang="es"]')).flatMap((node) => ['aria-label', 'title', 'placeholder'].map((name) => node.getAttribute(name) ?? ''))
			return {
				text: clone.textContent ?? '',
				attributes,
				title: globalThis.document.title,
				alternates: [...globalThis.document.querySelectorAll('link[rel="alternate"][hreflang]')].map((link) => [link.getAttribute('hreflang'), new URL(link.href).pathname]),
				links: [...globalThis.document.querySelectorAll('a[href^="/"]:not([hreflang])')].map((link) => link.getAttribute('href')),
				selector: [...globalThis.document.querySelectorAll('.dash-locale a')].map((link) => [link.getAttribute('hreflang'), new URL(link.href).pathname, link.getAttribute('aria-current')]),
			}
		})
		assert.doesNotMatch(report.text, spanish, `${path}: Spanish text in the page`)
		for (const value of [...report.attributes, report.title]) assert.doesNotMatch(value, spanish, `${path}: Spanish in an attribute: ${value}`)
		const pathname = new URL(page.url()).pathname
		const base = pathname.replace(/^\/en/, '') || '/'
		assert.deepEqual(new Map(report.alternates).get('en'), pathname, `${path}: hreflang en`)
		assert.deepEqual(new Map(report.alternates).get('es'), base, `${path}: hreflang es`)
		assert.deepEqual(new Map(report.alternates).get('x-default'), base, `${path}: x-default`)
		assert.deepEqual(report.selector, [
			['es', base, null],
			['en', pathname, 'true'],
		])
		// Every internal link keeps /en, except the assets of the page.
		for (const href of report.links) assert.ok(href === '/en' || href.startsWith('/en/') || href.startsWith('/brand/'), `${path}: link without /en: ${href}`)
	}

	// The HTML of the server, before any JavaScript, is in English too.
	const html = await (await fetch(`${origin}/en/translations`, { headers: { cookie: headers.cookie } })).text()
	assert.match(html, /<html[^>]* lang="en"/)
	assert.match(html, /<h1[^>]*>(?:<!--[^>]*-->)*Translations/)
	assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''), /Cerrar sesión|Saltar al contenido|Traducciones/)

	// A page that does not exist: 404 in the language of the address; /es/ is not an address.
	assert.equal((await fetch(`${origin}/es/sources`, { headers: { cookie: headers.cookie }, redirect: 'manual' })).status, 404)
	await page.goto(`${origin}/en/nope`, { waitUntil: 'networkidle' })
	await page.getByRole('heading', { level: 1, name: 'This page does not exist' }).waitFor({ timeout: 30_000 })
	assert.equal(await page.getAttribute('html', 'lang'), 'en')

	// The language switch keeps the page and its query --------------------------------------------

	await open('/en/sources?site=ui')
	await page.locator('.dash-locale a[hreflang="es"]').click()
	await page.waitForURL((address) => address.pathname === '/sources' && address.search === '?site=ui', { timeout: 60_000 })
	await hydrated()
	assert.equal(await page.getAttribute('html', 'lang'), 'es')
	assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Fuentes')
	assert.equal((await browserContext.cookies(origin)).find((cookie) => cookie.name === 'meeko-dashboard-locale')?.value, 'es', 'the choice is remembered')
	await page.locator('.dash-locale a[hreflang="en"]').click()
	await page.waitForURL((address) => address.pathname === '/en/sources', { timeout: 60_000 })
	await hydrated()

	// The sources list both languages, and a filter by language.
	await open('/en/sources?lang=en')
	await page.getByText('docs/en/testing.md').waitFor({ timeout: 30_000 })
	assert.equal(await page.getByText('docs/api.md').count(), 0)

	// Translations --------------------------------------------------------------------------------

	await open('/en/translations')
	const tabs = page.getByRole('navigation', { name: 'Translations by status' })
	for (const [name, count] of [
		['All', 3],
		['Translated', 1],
		['Outdated', 1],
		['Not translated', 1],
	]) {
		assert.match((await tabs.getByRole('link', { name: new RegExp(`^${name}`) }).textContent()) ?? '', new RegExp(`${count}`), name)
	}
	await tabs.getByRole('link', { name: /^Not translated/ }).click()
	await page.getByText('1 of 3 pages').waitFor({ timeout: 30_000 })
	assert.equal(new URL(page.url()).searchParams.get('status'), 'missing')
	assert.equal(await page.getByRole('link', { name: 'API', exact: true }).count(), 1)
	assert.equal(await page.getByRole('link', { name: 'Testing', exact: true }).count(), 0)

	// The missing one says where its file goes; the outdated one shows what changed in the Spanish.
	await open(`/en/translations/${ids.api}`)
	await page.getByText('docs/en/api.md', { exact: false }).first().waitFor({ timeout: 30_000 })
	assert.equal(await page.getByRole('link', { name: 'Edit the translation' }).count(), 0)
	await open(`/en/translations/${ids.testing}`)
	await page.getByText('+Nuevo parrafo del original.').waitFor({ timeout: 30_000 })
	assert.ok((await page.locator('.dash-translation-status').textContent())?.includes('Outdated'))
	assert.equal(await page.locator('pre.dash-markdown[lang="es"]').count(), 1)
	assert.equal(await page.locator('pre.dash-markdown[lang="en"]').count(), 1)

	// The editor of a translation: English preview, and marking it as translated writes the current hash.
	await page.getByRole('link', { name: 'Edit the translation' }).click()
	await page.waitForURL((address) => address.pathname === `/en/sources/${ids.testingEn}/edit`, { timeout: 60_000 })
	await hydrated()
	await page.getByRole('button', { name: 'Mark as translated' }).click()
	const original = `${gitText('docs/testing.md')}\nNuevo parrafo del original.\n`
	await page.waitForFunction((expected) => globalThis.document.querySelector('#frontmatter-source-hash')?.value === expected, hash(original), { timeout: 30_000 })
	await page.getByRole('button', { name: 'Create draft' }).click()
	await page
		.locator('.dash-notice')
		.filter({ hasText: /Draft #\d+ created\./ })
		.waitFor({ timeout: 30_000 })

	// Moderation per language ----------------------------------------------------------------------

	const save = await rpc('moderation/rules/save', { site: 'site', locale: 'en', path: '/docs/doctor', action: 'hide', reason: 'In review', id: null, version: null })
	assert.equal(save.status, 200)
	const announcement = await rpc('moderation/announcements/save', { site: 'site', locale: null, message: 'For every language', tone: 'info', startsAt: null, endsAt: null, active: true })
	assert.equal(announcement.status, 200)
	await open('/en/moderation')
	const rules = page.getByRole('table', { name: 'Rules of Framework' })
	await rules.getByText('Hidden').waitFor({ timeout: 30_000 })
	assert.equal(await rules.locator('.dash-locale-tag[data-locale="en"]').count(), 1)
	const notices = page.getByRole('table', { name: /^Announcements of Framework/ })
	assert.equal(await notices.locator('.dash-locale-tag[data-locale="all"]').count(), 1)
	// The English preview renders the Shell's own component, with its catalog.
	assert.ok(await page.locator('.dash-announcement-frame').count())

	// Metrics per language --------------------------------------------------------------------------

	await open('/en/metrics?lang=en')
	assert.equal(await page.getByRole('navigation', { name: 'Language' }).last().getByRole('link', { name: 'English' }).getAttribute('aria-current'), 'true')
	await page.getByText('/en/docs/doctor', { exact: true }).waitFor({ timeout: 30_000 })
	assert.equal(await page.getByText('/docs/testing', { exact: true }).count(), 0)
	await open('/en/metrics?lang=es')
	await page.getByText('/docs/testing', { exact: true }).waitFor({ timeout: 30_000 })
	assert.equal(await page.getByText('/en/docs/doctor', { exact: true }).count(), 0)

	// The suggestion of the browser's language: only a notice, never a redirect ---------------------

	const suggesting = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'en-US' })
	cleanups.push(() => suggesting.close())
	const visitor = await suggesting.newPage()
	await visitor.goto(`${origin}/login`, { waitUntil: 'networkidle' })
	assert.equal(new URL(visitor.url()).pathname, '/login', 'no redirect')
	assert.equal(await visitor.getAttribute('html', 'lang'), 'es')
	const suggestion = visitor.locator('.dash-locale-suggestion')
	await suggestion.waitFor({ timeout: 60_000 })
	assert.equal(await suggestion.getByRole('link', { name: 'English' }).getAttribute('href'), '/en/login')
	// On a phone the header fits: no horizontal scroll with the switch and the logout.
	assert.equal(await visitor.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth), true)
	await suggestion.getByRole('button', { name: 'Seguir en español' }).click()
	await suggestion.waitFor({ state: 'detached', timeout: 10_000 })
	await visitor.reload({ waitUntil: 'networkidle' })
	await visitor.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 60_000 })
	assert.equal(await suggestion.count(), 0, 'the choice to stay is remembered')

	// The logout of an English page goes to the English login, with the session's CSRF --------------

	await open('/en/health')
	await Promise.all([page.waitForURL((address) => address.pathname === '/en/login', { timeout: 60_000 }), page.getByRole('button', { name: 'Sign out' }).click()])
	await hydrated()
	assert.equal(await page.getAttribute('html', 'lang'), 'en')

	assert.deepEqual(missing, [], 'no message is missing in the browser')
	assert.doesNotMatch(server.logs(), /\[meeko:i18n\] Missing message/, 'no message is missing in the server')
	assert.deepEqual(
		errors.filter((text) => !/401|403|Failed to load resource/.test(text)),
		[],
	)
})
