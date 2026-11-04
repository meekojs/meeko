// The English site under /en/…, in Chrome, against the active snapshot of the development database
// (read only: the test writes nothing). It checks what a reader of each language gets: the document
// language, hreflang and x-default, an interface without Spanish text in English pages, the
// language selector, links and client navigation that keep /en, the «not translated» notice of a
// page shown in Spanish, the bilingual sitemap and llms.txt, and the suggestion of the reader's
// language without any redirect. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const app = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../../../packages/meeko/dist/cli.js', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const origin = 'https://meekojs.com'
/** A guide translated into English. */
const guide = '/docs/framework'
/** A reference page generated from the JSDoc: English shows its Spanish text with the notice. */
const fallback = '/docs/reference/appmanifest'

async function port() {
	const server = createNetServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const value = server.address().port
	await new Promise((done) => server.close(done))
	return value
}

/** Every string of a catalog, also the forms of plurals and selects. */
function leaves(value, out = []) {
	if (typeof value === 'string') out.push(value)
	else if (value && typeof value === 'object') for (const item of Object.values(value)) leaves(item, out)
	return out
}

/**
 * The Spanish interface texts: each string of the Spanish catalogs that English writes differently,
 * as its longest piece without parameters, when it is a word or more (not «API» or «Props»).
 */
function spanishInterface() {
	const file = (locale, name) => join(app, name === 'shell' ? `node_modules/meeko-docs/locales/${locale}/shell.json` : `app/locales/${locale}/${name}.json`)
	const texts = new Set()
	for (const name of ['common', 'docs', 'home', 'shell']) {
		const english = new Set(leaves(JSON.parse(readFileSync(file('en', name), 'utf8'))))
		for (const text of leaves(JSON.parse(readFileSync(file('es', name), 'utf8')))) {
			const piece = text
				.split(/\{[^}]+\}|<\/?[\w-]+\/?>/)
				.sort((a, b) => b.length - a.length)[0]
				.trim()
			if (!english.has(text) && piece.length >= 4 && /\p{Ll}/u.test(piece)) texts.add(piece)
		}
	}
	return [...texts]
}

/**
 * The interface text of the page in the browser: its visible text and its accessible names, without
 * what comes from the documentation itself (the article, code, the titles of the sidebar, the cards of
 * the documentation index and the reference indexes, which the snapshot brings in each language).
 */
function interfaceText() {
	const page = globalThis.document.body.cloneNode(true)
	for (const element of page.querySelectorAll('pre, code, script, style, main article, .meeko-ui-nav-tree, .meeko-ui-toc ul, .meeko-ui-page-nav span, .start .meeko-ui-prose, .docs-index ul')) element.remove()
	const names = [...page.querySelectorAll('[aria-label], [title], [placeholder], [alt]')].flatMap((element) => ['aria-label', 'title', 'placeholder', 'alt'].map((name) => element.getAttribute(name) ?? ''))
	return [page.textContent ?? '', ...names].join('\n')
}

test('the English site: language, hreflang, interface, selector, links, fallback notice and suggestion', { skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set', timeout: 240_000 }, async (context) => {
	const httpPort = await port()
	const hmrPort = await port()
	const server = spawn(process.execPath, [cli, 'dev', app], {
		cwd: app,
		// DOCS_METRICS stays as in .env: an automated browser never counts views (meeko-docs/metrics).
		env: { ...process.env, PORT: String(httpPort), MEEKO_PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0', NODE_OPTIONS: '--max-old-space-size=8192' },
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	const cleanups = []
	context.after(async () => {
		for (const cleanup of cleanups.reverse()) await cleanup()
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
			if ((await fetch(base + '/en/docs')).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 100))
	}

	try {
		// Routes: Spanish without prefix, English under /en; /es/… does not exist.
		for (const path of ['/', guide, fallback, '/docs/reference', '/docs/reference/exports']) {
			assert.equal((await fetch(base + path)).status, 200, path)
			assert.equal((await fetch(base + '/en' + (path === '/' ? '' : path))).status, 200, `/en${path}`)
		}
		assert.equal((await fetch(base + '/es/docs')).status, 404)
		assert.equal((await fetch(base + '/en/docs/no-such-page')).status, 404)

		// The SSR HTML: <html lang>, and hreflang with x-default on the Spanish URL.
		const english = await (await fetch(base + '/en' + guide)).text()
		assert.match(english, /<html[^>]* lang="en"/)
		assert.ok(english.includes(`href="${origin}${guide}" hreflang="es"`), 'alternate es')
		assert.ok(english.includes(`href="${origin}/en${guide}" hreflang="en"`), 'alternate en')
		assert.ok(english.includes(`href="${origin}${guide}" hreflang="x-default"`), 'x-default')
		// Open Graph comes from the module, one tag each, with the other version as the alternate.
		assert.equal(english.match(/<meta property="og:locale" content="en_US"/g)?.length, 1)
		assert.equal(english.match(/<meta property="og:locale:alternate" content="es_ES"/g)?.length, 1)
		const spanishGuide = await (await fetch(base + guide)).text()
		assert.match(spanishGuide, /<html[^>]* lang="es"/)
		assert.equal(spanishGuide.match(/<meta property="og:locale" content="es_ES"/g)?.length, 1)
		assert.equal(spanishGuide.match(/<meta property="og:locale:alternate" content="en_US"/g)?.length, 1)
		// A message with markup: the sentence reads whole in each language, with its element inside.
		const withoutMarkers = (html) =>
			html
				.replace(/<!--[^]*?-->/g, '')
				.replace(/ data-meeko(?:-\w+)?="[^"]*"/g, '')
				.replace(/ data-v-\w+(?:="")?/g, '')
		assert.match(withoutMarkers(english), /every page of this site is a prerendered\s*<code[^>]*>\.meeko<\/code> component\./)
		assert.match(withoutMarkers(spanishGuide), /es un componente\s*<code[^>]*>\.meeko<\/code> prerenderizado\./)
		// The word order is the catalog's, and a tag can close the sentence without a stray space.
		const referenceHtml = withoutMarkers(await (await fetch(base + '/en/docs/reference')).text())
		assert.match(referenceHtml, /in the\s<a[^>]*>index by module<\/a>\./)

		// The sitemap lists both versions of each page with their alternates; llms.txt has an English twin.
		const sitemap = await (await fetch(base + '/sitemap.xml')).text()
		assert.ok(sitemap.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'))
		assert.ok(sitemap.includes(`<loc>${origin}/en${guide}</loc>`) && sitemap.includes(`<loc>${origin}${guide}</loc>`))
		assert.ok(sitemap.includes(`<xhtml:link rel="alternate" hreflang="en" href="${origin}/en${guide}"/>`))
		assert.ok(sitemap.includes(`<xhtml:link rel="alternate" hreflang="x-default" href="${origin}${guide}"/>`))
		assert.ok(sitemap.includes(`<loc>${origin}/en${fallback}</loc>`), 'an untranslated page also has its English URL')
		const llms = await (await fetch(base + '/en/llms.txt')).text()
		assert.ok(llms.includes(`${origin}/en/docs/`) && llms.includes('Documentation in English'), 'English llms.txt')
		assert.equal((await fetch(base + '/en/llms-full.txt')).status, 200)
		const results = await (await fetch(base + '/api/docs/search?q=signal&locale=en')).json()
		assert.ok(results.length > 0 && results.every((result) => result.url.startsWith('/en/')), 'English search results link /en')

		const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
		cleanups.push(() => browser.close())
		// An English reader, to see the suggestion on the Spanish pages.
		const browserContext = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } })
		const page = await browserContext.newPage()
		const problems = []
		page.on('pageerror', (error) => problems.push(error.message))
		page.on('console', (message) => {
			// The 404 page of the test answers 404, which Chrome logs as a failed resource.
			if (message.text().includes('[meeko:i18n]') || (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))) problems.push(message.text())
		})

		// No Spanish interface text in English pages: home, documentation index, a guide, the
		// reference, an untranslated page and the error page.
		const spanish = spanishInterface()
		for (const path of ['/en', '/en/docs', '/en' + guide, '/en/docs/reference', '/en/docs/reference/exports', '/en' + fallback, '/en/docs/no-such-page']) {
			await page.goto(base + path, { waitUntil: 'networkidle' })
			const text = await page.evaluate(interfaceText)
			const found = spanish.filter((piece) => new RegExp(`(?<!\\p{L})${piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'u').test(text))
			assert.deepEqual(found, [], `Spanish interface text in ${path}`)
			assert.equal(await page.getAttribute('html', 'lang'), 'en', path)
		}
		assert.equal(await page.title(), 'This page does not exist · Meeko', 'the title of the error page, the last one of the list')

		// The cards of the documentation index open their guide in the language of the index, with or
		// without JavaScript: every link answers, and a click reaches the page of the catalog.
		for (const [index, prefix] of [
			['/en/docs', '/en'],
			['/docs', ''],
		]) {
			await page.goto(base + index, { waitUntil: 'networkidle' })
			const cards = page.locator('.docs-index ul a')
			const links = await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('href')))
			assert.ok(links.length > 0, `cards of ${index}`)
			for (const link of links) {
				assert.match(link, new RegExp(`^${prefix}/docs/[^/%]+$`), `card ${link} of ${index}`)
				assert.equal((await fetch(base + link)).status, 200, link)
			}
			const card = cards.and(page.locator(`[href="${prefix}/docs/api"]`))
			await card.click()
			await page.waitForURL(`${base}${prefix}/docs/api`)
			await page.locator('main article h1').first().waitFor()
		}

		// <I18nT> after hydration: a new value updates the sentence in place, and a value is only text.
		await page.goto(base + '/en/docs/reference/exports', { waitUntil: 'networkidle' })
		const filter = page.locator('#api-filter')
		const attack = '<img src=x onerror=globalThis.__xss=1>'
		await filter.fill(attack)
		const empty = page.locator('.meeko-ui-empty-title')
		await empty.waitFor()
		assert.equal((await empty.textContent())?.replace(/\s+/g, ' ').trim(), `No symbol matches “${attack}”. The / key opens the search across the whole documentation.`)
		assert.equal(await empty.locator('img').count(), 0, 'a value never becomes markup')
		assert.equal(await empty.locator('kbd').textContent(), '/')
		const kbd = await empty.locator('kbd').elementHandle()
		await filter.fill('zzz-none')
		await page.waitForFunction(() => globalThis.document.querySelector('.meeko-ui-empty-title')?.textContent?.includes('zzz-none'))
		assert.equal(await kbd.evaluate((node) => node.isConnected), true, 'the snippet keeps its nodes when a value changes')
		assert.equal(await page.evaluate(() => globalThis.__xss), undefined)
		await filter.fill('')

		// The selector: real links to the same page in each language, the current one marked.
		await page.goto(base + '/en' + guide, { waitUntil: 'networkidle' })
		const selector = page.locator('header nav.meeko-ui-locale-switcher')
		assert.equal(await selector.getAttribute('aria-label'), 'Language')
		assert.equal(await selector.locator('a[hreflang="es"]').getAttribute('href'), guide)
		assert.equal(await selector.locator('a[hreflang="en"]').getAttribute('href'), '/en' + guide)
		assert.equal(await selector.locator('a[hreflang="en"]').getAttribute('aria-current'), 'page')

		// Links keep /en: header, footer, sidebar, pager; client navigation stays in the same document.
		for (const href of await page.locator('header nav.meeko-ui-header-nav a[href^="/"], footer a[href^="/"], #docs-navigation a, .meeko-ui-page-nav a').evaluateAll((links) => links.map((link) => link.getAttribute('href')))) {
			assert.ok(href === '/en' || href.startsWith('/en/'), `link ${href} keeps /en`)
		}
		await page.evaluate(() => {
			globalThis.__e2eDocument = 'same'
		})
		// The shell of the snapshot, the first site that gives it all of this: index, pager and edit link.
		const firstHeading = page.locator('.meeko-ui-page-aside .meeko-ui-toc a').first()
		const anchor = await firstHeading.getAttribute('href')
		assert.equal(await page.locator(`main article [id="${decodeURIComponent(anchor.slice(1))}"]`).count(), 1, 'the index links a heading of the article')
		const pager = page.locator('.meeko-ui-page-nav')
		assert.deepEqual(await pager.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('rel'))), ['prev', 'next'])
		const edit = page.locator('main a[href*="/edit/"]')
		assert.equal((await edit.textContent())?.trim(), 'Edit on GitHub: docs/framework.md')
		// A click on a copy button of the rendered Markdown: <UIProse> copies, once hydrated.
		const copy = page.locator('main article button[data-copy]').first()
		await copy.click()
		await page.locator('main article button[data-copy][data-state]').first().waitFor()
		// The shell stays mounted between the pages of the snapshot.
		const sidebarNode = await page.locator('#docs-navigation').elementHandle()
		await page.locator('#docs-navigation a[href="/en/docs/api"]').first().click()
		await page.waitForURL(base + '/en/docs/api')
		assert.equal(await page.evaluate(() => globalThis.__e2eDocument), 'same', 'client navigation within English')
		assert.equal(await sidebarNode.evaluate((node) => node.isConnected), true, 'the layout keeps the sidebar')
		await page.locator('#docs-navigation a[aria-current="page"][href="/en/docs/api"]').first().waitFor()

		// The search dialog: the shortcut, a query, the arrows and Enter, which go through the router.
		await page.keyboard.press('/')
		const dialog = page.locator('dialog.meeko-ui-command')
		await dialog.waitFor()
		assert.equal(await page.evaluate(() => globalThis.document.activeElement?.id), 'meeko-search')
		assert.equal((await dialog.getByRole('status').locator('kbd').count()) > 0, true, 'the hint names its keys')
		await page.keyboard.type('signal')
		const rows = dialog.getByRole('option')
		await rows.first().waitFor()
		assert.ok(
			(await rows.evaluateAll((links) => links.map((link) => link.getAttribute('href')))).every((link) => link.startsWith('/en/')),
			'the results keep /en',
		)
		assert.equal(await rows.first().getAttribute('aria-selected'), 'true')
		await page.keyboard.press('ArrowDown')
		await dialog.locator('[role="option"][aria-selected="true"]').nth(0).waitFor()
		assert.equal(await rows.nth(1).getAttribute('aria-selected'), 'true')
		const chosen = await rows.nth(1).getAttribute('href')
		await page.keyboard.press('Enter')
		await page.waitForURL((url) => url.href.startsWith(base + chosen.split('#')[0]))
		await dialog.waitFor({ state: 'hidden' })
		assert.equal(await page.evaluate(() => globalThis.__e2eDocument), 'same', 'a result navigates on the client')
		assert.equal(
			await page
				.locator('.meeko-ui-drawer-trigger')
				.textContent()
				.then((text) => text?.trim()),
			'Contents',
		)

		// An untranslated page: the notice, a link to the Spanish version and the article marked Spanish.
		await page.goto(base + '/en' + fallback, { waitUntil: 'networkidle' })
		const notice = page.locator('.docs-untranslated')
		assert.equal((await notice.locator('.meeko-ui-alert-title').textContent())?.trim(), 'Not translated yet')
		assert.equal(await notice.locator('a').getAttribute('href'), fallback)
		assert.equal(await notice.locator('a').getAttribute('hreflang'), 'es')
		// Only the article is Spanish: the notice, the pager and the edit link of the English shell are not.
		const language = (selector) =>
			page
				.locator(selector)
				.first()
				.evaluate((element) => element.closest('[lang]')?.getAttribute('lang'))
		assert.equal(await language('main article'), 'es')
		assert.equal(await language('.docs-untranslated'), 'en')
		assert.equal(await language('main a[href*="/edit/"]'), 'en')
		assert.equal(await page.locator('main article[lang], main[lang]').count(), 0, 'the mark is around the article, not on <main>')
		assert.equal(await page.locator('main').getAttribute('id'), 'contenido')
		// A translated one has no notice; the Spanish page never has one.
		await page.goto(base + '/en' + guide, { waitUntil: 'networkidle' })
		assert.equal(await page.locator('.docs-untranslated').count(), 0)
		await page.goto(base + fallback, { waitUntil: 'networkidle' })
		assert.equal(await page.locator('.docs-untranslated').count(), 0)

		// The suggestion: a Spanish page for an English reader offers the English version without
		// redirecting; «stay» remembers Spanish in the cookie, and it does not come back.
		const suggestion = page.locator('aside.meeko-ui-locale-suggestion')
		await suggestion.waitFor()
		assert.equal(page.url(), base + fallback, 'no redirect')
		assert.equal(await suggestion.getAttribute('lang'), 'en')
		assert.equal(await suggestion.locator('a').getAttribute('href'), '/en' + fallback)
		// In the language it offers, on a Spanish document, without a message of another catalog missing.
		assert.equal(await suggestion.getAttribute('aria-label'), 'Language suggestion')
		assert.equal((await suggestion.locator('p').textContent())?.trim(), 'This page is also available in English.')
		assert.equal((await suggestion.locator('a').textContent())?.trim(), 'Read this page in English')
		assert.equal((await suggestion.locator('button').textContent())?.trim(), 'Seguir en español')
		await page.screenshot({ path: join(app, '.meeko', 'screenshots', 'i18n-suggestion-desktop.png') })
		await suggestion.locator('button').click()
		await suggestion.waitFor({ state: 'detached' })
		assert.equal((await browserContext.cookies(base)).find((cookie) => cookie.name === 'meeko-locale')?.value, 'es')
		await page.reload({ waitUntil: 'networkidle' })
		await page.waitForTimeout(300)
		assert.equal(await suggestion.count(), 0, 'dismissed for good')
		// An English page for that reader suggests nothing (the cookie says Spanish, so it offers Spanish).
		await browserContext.clearCookies()
		await page.goto(base + '/en' + guide, { waitUntil: 'networkidle' })
		await page.waitForTimeout(300)
		assert.equal(await suggestion.count(), 0, 'the reader already reads their language')

		// Choosing a language with the selector stores it and loads the other document.
		await page.locator('header nav.meeko-ui-locale-switcher a[hreflang="es"]').click()
		await page.waitForURL(base + guide)
		assert.equal(await page.getAttribute('html', 'lang'), 'es')
		assert.equal((await browserContext.cookies(base)).find((cookie) => cookie.name === 'meeko-locale')?.value, 'es')

		// Small screens: the selector stays in the bar, without a horizontal scroll.
		await page.setViewportSize({ width: 390, height: 844 })
		for (const path of ['/en', '/en' + guide, '/en' + fallback]) {
			await page.goto(base + path, { waitUntil: 'networkidle' })
			assert.ok(await page.locator('header nav.meeko-ui-locale-switcher').isVisible(), `selector visible at 390 px in ${path}`)
			assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), `no horizontal scroll at 390 px in ${path}`)
		}
		await page.screenshot({ path: join(app, '.meeko', 'screenshots', 'i18n-fallback-mobile.png') })
		// The drawer of the small screens: the sidebar opens in it, and a chosen page closes it. The
		// narrow-screen index folds, and it is there instead of the side column.
		await page.goto(base + '/en' + guide, { waitUntil: 'networkidle' })
		assert.ok(await page.locator('.meeko-ui-toc-collapsible').isVisible(), 'the collapsible index at 390 px')
		assert.ok(!(await page.locator('.meeko-ui-page-aside').isVisible()), 'no side column at 390 px')
		await page.locator('.meeko-ui-drawer-trigger').click()
		const drawer = page.locator('dialog.meeko-ui-drawer')
		await drawer.waitFor()
		await drawer.locator('a[href="/en/docs/api"]').first().click()
		await page.waitForURL(base + '/en/docs/api')
		await drawer.waitFor({ state: 'hidden' })
		// The home page has no sidebar and no bar, and it is still one <main> and one <h1>.
		await page.goto(base + '/en', { waitUntil: 'networkidle' })
		assert.equal(await page.locator('.meeko-ui-page-sidebar, .meeko-ui-page-bar').count(), 0)
		assert.equal(await page.locator('main#contenido').count(), 1)
		assert.equal(await page.locator('h1').count(), 1)
		assert.deepEqual(problems, [])
	} catch (error) {
		throw new Error(
			`${error instanceof Error ? error.stack : error}

Server:
${logs.slice(-6000)}`,
			{ cause: error },
		)
	}
})
