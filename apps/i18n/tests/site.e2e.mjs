import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

test('production i18n documentation renders guides, translates, switches locale and supports RTL, mobile and no JavaScript', { timeout: 120_000 }, async (context) => {
	const socket = createServer().listen(0, '127.0.0.1')
	await once(socket, 'listening')
	const port = socket.address().port
	await new Promise((done) => socket.close(done))
	const root = fileURLToPath(new URL('../', import.meta.url))
	const cli = fileURLToPath(new URL('../../../packages/meeko/dist/cli.js', import.meta.url))
	const output = fileURLToPath(new URL('../.meeko/screenshots/', import.meta.url))
	await mkdir(output, { recursive: true })
	const server = spawn(process.execPath, [cli, 'start', root], { cwd: root, env: { ...process.env, PORT: String(port), MEEKO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
	context.after(() => server.kill())
	let logs = ''
	server.stdout.on('data', (chunk) => {
		logs += chunk
	})
	server.stderr.on('data', (chunk) => {
		logs += chunk
	})
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
	// An English browser: the Spanish pages suggest English, without redirecting.
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	const guides = ['/', '/installation', '/messages', '/plurals', '/formatting', '/routing', '/namespaces', '/rtl', '/api', '/validation', '/playground']
	for (const route of [...guides, ...guides.map((guide) => (guide === '/' ? '/en' : '/en' + guide)), '/ar/playground']) {
		const response = await page.goto(origin + route)
		assert.equal(response.status(), 200, route)
		assert.equal(await page.locator('main h1').count(), 1, route)
		assert.match(await page.title(), / · Meeko i18n$/, route)
		assert.equal(await page.locator('.meeko-ui-code-block:has(pre:not(.shiki))').count(), 0, route)
		assert.ok(await page.locator('meta[name="description"]').getAttribute('content'), route)
	}
	await page.goto(origin + '/installation')
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
	await page.getByRole('button', { name: 'Copiar código' }).first().click()
	await page.getByRole('status').filter({ hasText: 'Copiado' }).waitFor()
	assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'pnpm add @meekojs/i18n')
	await page.goto(origin, { waitUntil: 'networkidle' })
	await page.getByRole('textbox', { name: 'Tu nombre', exact: true }).fill('Ada')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="greeting"]')?.textContent?.trim() === 'Hola Ada')
	await page.screenshot({ path: output + '/home-desktop.png', fullPage: true })
	// The generated /en and /ar routes reuse the pages; each localized page declares its versions.
	const alternates = async () => page.locator('link[rel="alternate"][hreflang]').evaluateAll((links) => links.map((link) => `${link.getAttribute('hreflang')} ${new URL(link.href).pathname}`))
	await page.goto(origin + '/routing')
	assert.equal(await page.locator('html').getAttribute('lang'), 'es')
	assert.deepEqual(await alternates(), ['es /routing', 'en /en/routing', 'x-default /routing'])
	await page.goto(origin + '/en/routing')
	assert.equal(await page.locator('html').getAttribute('lang'), 'en')
	assert.deepEqual(await alternates(), ['es /routing', 'en /en/routing', 'x-default /routing'])
	for (const route of ['/es/playground', '/ar/routing']) assert.equal((await page.goto(origin + route)).status(), 404, route)
	// The locale suggestion comes from the browser languages and never redirects.
	await page.goto(origin + '/playground?tab=demo#messages', { waitUntil: 'networkidle' })
	assert.equal(new URL(page.url()).pathname, '/playground')
	assert.deepEqual(await alternates(), ['es /playground', 'en /en/playground', 'ar /ar/playground', 'x-default /playground'])
	// The shell offers it in the suggested language, floating over the page (no layout shift).
	const suggestion = page.getByRole('complementary', { name: 'Language suggestion', exact: true })
	await suggestion.waitFor()
	assert.equal(await suggestion.getByRole('link', { name: 'Read this page in English', exact: true }).getAttribute('href'), '/en/playground?tab=demo#messages')
	assert.equal(await suggestion.evaluate((element) => globalThis.getComputedStyle(element).position), 'fixed')
	await suggestion.getByRole('button', { name: 'Seguir en español', exact: true }).click()
	await suggestion.waitFor({ state: 'detached' })
	await page.reload({ waitUntil: 'networkidle' })
	assert.equal(await suggestion.count(), 0, 'a remembered choice hides the suggestion')
	const lab = page.getByRole('navigation', { name: 'Idioma del ejemplo', exact: true })
	assert.equal(await lab.getByRole('link', { name: 'Español', exact: true }).getAttribute('aria-current'), 'page')
	// The shell's language switcher keeps the page, its query and its fragment.
	const switcher = page.getByRole('navigation', { name: 'Idioma', exact: true })
	assert.deepEqual(await switcher.getByRole('link').evaluateAll((links) => links.map((link) => [link.getAttribute('hreflang'), link.getAttribute('href'), link.getAttribute('aria-current')])), [
		['es', '/playground?tab=demo#messages', 'page'],
		['en', '/en/playground?tab=demo#messages', null],
		['ar', '/ar/playground?tab=demo#messages', null],
	])
	await page.evaluate(() => {
		globalThis.i18nDocumentMarker = 'before-switch'
	})
	await lab.getByRole('link', { name: 'English', exact: true }).click()
	await page.waitForURL(origin + '/en/playground?tab=demo#messages')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="greeting"]')?.textContent?.trim() === 'Hello Meeko')
	assert.equal(await page.evaluate(() => globalThis.i18nDocumentMarker), undefined, 'changing locale performs a full navigation')
	assert.equal(await page.locator('html').getAttribute('lang'), 'en')
	// app/pages/en/playground.meeko replaces the generated route with English prose.
	assert.equal(await page.getByRole('heading', { name: 'Playground', level: 1 }).count(), 1)
	// <MeekoLink to="/routing"> follows the document's locale; hreflang forces another one.
	assert.equal(await page.getByRole('link', { name: 'languages and routes', exact: true }).getAttribute('href'), '/en/routing')
	assert.equal(await page.getByRole('link', { name: 'the Spanish version', exact: true }).getAttribute('href'), '/routing')
	assert.match(await page.evaluate(() => globalThis.document.cookie), /meeko-locale=en/)
	await page.getByRole('textbox', { name: 'Name to translate', exact: true }).fill('Ada')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="greeting"]')?.textContent?.trim() === 'Hello Ada')
	const range = page.getByRole('slider')
	await range.press('Home')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="plural"]')?.textContent?.trim() === 'Your cart is empty')
	await range.press('ArrowRight')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="plural"]')?.textContent?.trim() === '1 item in your cart')
	await range.press('ArrowRight')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="plural"]')?.textContent?.trim() === '2 items in your cart')
	await page.getByRole('combobox', { name: 'User permission', exact: true }).selectOption({ label: 'View' })
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="select"]')?.textContent?.includes('you can view'))
	await page.getByRole('combobox', { name: 'Currency', exact: true }).selectOption({ label: 'EUR' })
	const formats = page.getByRole('region', { name: 'Translated result', exact: true }).locator('dd')
	await page.waitForFunction((euros) => globalThis.document.querySelector('[aria-live] dd')?.textContent?.trim() === euros, new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(12345.67))
	assert.equal(await formats.nth(1).innerText(), await page.evaluate(() => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 15, 12))))
	await page.getByRole('navigation', { name: 'Language of the example', exact: true }).getByRole('link', { name: 'العربية', exact: true }).click()
	await page.waitForURL(origin + '/ar/playground?tab=demo#messages')
	await page.waitForFunction(() => globalThis.document.documentElement.lang === 'ar')
	assert.equal(await page.locator('html').getAttribute('dir'), 'rtl')
	assert.equal(await page.getByRole('region', { name: 'Resultado traducido' }).getAttribute('lang'), 'ar')
	// The demo locale keeps the Spanish shell (its catalog), marked as Spanish and LTR.
	assert.equal(await page.getByRole('banner').evaluate((element) => [element.closest('[lang]').getAttribute('lang'), globalThis.getComputedStyle(element).direction].join(' ')), 'es ltr')
	assert.equal(await page.locator('.docs-untranslated').count(), 0, 'a demo locale shows the original without the notice')
	// Arabic only has the playground (partial): its links point to the default version.
	assert.equal(await page.getByRole('link', { name: 'idiomas y rutas', exact: true }).getAttribute('href'), '/routing')
	assert.equal(await page.getByRole('region', { name: 'Resultado traducido' }).evaluate((element) => globalThis.getComputedStyle(element).direction), 'rtl')
	assert.match(await page.locator('[data-output="plural"]').innerText(), /عنصران/)
	await page.screenshot({ path: output + '/rtl-desktop.png', fullPage: true })
	await page.setViewportSize({ width: 390, height: 844 })
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	await page.screenshot({ path: output + '/rtl-mobile.png', fullPage: true })
	await page.getByRole('button', { name: 'Contenidos', exact: true }).click()
	await page.getByRole('searchbox', { name: 'Buscar en la guía', exact: true }).fill('namespace')
	const navigation = page.getByRole('navigation', { name: 'Documentación de i18n', exact: true })
	await navigation.getByRole('link', { name: 'Namespaces', exact: true }).click()
	await page.waitForURL(origin + '/namespaces')
	await page.locator('[data-output="namespace"]').waitFor()
	assert.equal(await page.locator('[data-output="namespace"]').innerText(), 'Tu pedido tiene 3 productos.')
	assert.equal(await page.locator('dialog.meeko-ui-drawer:modal').count(), 0)
	for (const locale of ['en', 'ar']) {
		const ssr = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
		await ssr.goto(origin + '/' + locale + '/playground')
		assert.match(await ssr.locator('[data-output="greeting"]').innerText(), locale === 'en' ? /Hello Meeko/ : /مرحبًا/)
		// The server renders the localized href, without JavaScript.
		if (locale === 'en') assert.equal(await ssr.getByRole('link', { name: 'languages and routes', exact: true }).getAttribute('href'), '/en/routing')
		const english = locale === 'en'
		await ssr.getByRole('button', { name: english ? 'Contents' : 'Contenidos', exact: true }).click()
		await ssr
			.getByRole('navigation', { name: english ? 'i18n documentation' : 'Documentación de i18n', exact: true })
			.getByRole('link', { name: english ? 'Installation' : 'Instalación', exact: true })
			.click()
		assert.equal(await ssr.getByRole('heading', { name: english ? 'Installation' : 'Instalación', level: 1 }).count(), 1)
		assert.equal(new URL(ssr.url()).pathname, english ? '/en/installation' : '/installation')
		await ssr.close()
	}
	// A localized link in the same locale navigates in the client, keeping the document.
	await page.goto(origin + '/en/playground', { waitUntil: 'networkidle' })
	await page.evaluate(() => {
		globalThis.i18nDocumentMarker = 'same-locale'
	})
	await page.getByRole('link', { name: 'languages and routes', exact: true }).click()
	await page.waitForURL(origin + '/en/routing')
	await page.waitForFunction(() => globalThis.document.querySelector('main h1')?.textContent?.trim() !== 'Playground')
	assert.equal(await page.evaluate(() => globalThis.i18nDocumentMarker), 'same-locale', 'a link in the same locale is a client navigation')
	assert.equal(await page.locator('html').getAttribute('lang'), 'en')
	const missing = await page.goto(origin + '/fr/playground')
	assert.equal(missing.status(), 404)
	assert.equal(await page.getByRole('heading', { name: 'Esta página no existe', level: 1 }).count(), 1)
	assert.equal(await page.title(), 'Esta página no existe · Meeko i18n')
	await page.getByRole('link', { name: 'Ir a la instalación', exact: true }).click()
	await page.getByRole('heading', { name: 'Instalación', level: 1 }).waitFor()
	// A client navigation brings the highlighted code too, with the colors of the documentation of the site in each theme.
	const keyword = page.locator('.meeko-ui-code-block .shiki span', { hasText: /^import$/ }).first()
	const keywordColor = (theme) =>
		keyword.evaluate((span, value) => {
			globalThis.document.documentElement.dataset.theme = value
			return globalThis.getComputedStyle(span).color
		}, theme)
	assert.equal(await keywordColor('dark'), 'rgb(195, 171, 245)')
	assert.equal(await keywordColor('light'), 'rgb(106, 63, 196)')
	assert.deepEqual(errors, [])
})

/** Spanish interface texts of the shell and of this site that an /en/ page must never contain. */
const spanishInterface = ['Saltar al contenido', 'Buscar en la guía', 'Filtrar documentación', 'Ecosistema', 'Documentación', 'Menú', 'Paquete de Meeko', 'Licencia MIT', 'Destacado', 'No hay coincidencias', 'Copiar', 'Ejemplo .meeko', 'Propiedades', 'Tipo / valor inicial', 'Descripción', '¿Te sirvió', 'Añadir un comentario', 'Cerrar aviso', 'Cambiar tema', 'Tema:', 'Claro', 'Oscuro', 'Sistema', 'Idioma', 'Seguir en', 'Primeros pasos', 'Guías', 'Referencia', 'Nombre para traducir', 'Permiso del usuario', 'Moneda', 'Resultado traducido', 'Esta página no existe', 'Ir a la instalación']

test('the English site has an English interface, hreflang, a switcher, /en links and an English sitemap', { timeout: 120_000 }, async (context) => {
	const socket = createServer().listen(0, '127.0.0.1')
	await once(socket, 'listening')
	const port = socket.address().port
	await new Promise((done) => socket.close(done))
	const root = fileURLToPath(new URL('../', import.meta.url))
	const cli = fileURLToPath(new URL('../../../packages/meeko/dist/cli.js', import.meta.url))
	const server = spawn(process.execPath, [cli, 'start', root], { cwd: root, env: { ...process.env, PORT: String(port), MEEKO_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
	context.after(() => server.kill())
	let logs = ''
	server.stdout.on('data', (chunk) => {
		logs += chunk
	})
	server.stderr.on('data', (chunk) => {
		logs += chunk
	})
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
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'es-ES' })
	const warnings = []
	page.on('console', (message) => {
		if (/\[meeko:i18n\]/.test(message.text())) warnings.push(message.text())
	})
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	// Visible text without code blocks, plus the accessible and placeholder texts of the page.
	const interfaceTexts = () =>
		page.evaluate(() => {
			const body = globalThis.document.body.cloneNode(true)
			for (const code of body.querySelectorAll('pre, code, [lang]:not([lang="en"])')) code.remove()
			const attributes = [...globalThis.document.querySelectorAll('[aria-label], [placeholder], [title]')].filter((element) => !element.closest('[lang]:not([lang="en"])')).flatMap((element) => ['aria-label', 'placeholder', 'title'].map((name) => element.getAttribute(name) ?? ''))
			return [body.innerText, ...attributes].join('\n')
		})
	for (const route of ['/en', '/en/installation', '/en/messages', '/en/plurals', '/en/formatting', '/en/routing', '/en/namespaces', '/en/rtl', '/en/api', '/en/validation', '/en/playground']) {
		const response = await page.goto(origin + route, { waitUntil: 'networkidle' })
		assert.equal(response.status(), 200, route)
		assert.equal(await page.locator('html').getAttribute('lang'), 'en', route)
		const texts = await interfaceTexts()
		for (const spanish of spanishInterface) assert.ok(!texts.includes(spanish), `${route} shows the Spanish interface text «${spanish}»`)
		// Every page has its English prose: no untranslated notice.
		assert.equal(await page.locator('.docs-untranslated').count(), 0, route)
		const base = route === '/en' ? '/' : route.slice(3)
		assert.deepEqual(
			await page.locator('link[rel="alternate"][hreflang]').evaluateAll((links) => links.map((link) => `${link.getAttribute('hreflang')} ${link.href}`)),
			// Arabic (partial) only has the playground.
			[...(base === '/playground' ? ['es', 'en', 'ar'] : ['es', 'en']), 'x-default'].map((hreflang) => `${hreflang} https://i18n.meekojs.com${hreflang === 'en' ? route : hreflang === 'ar' ? '/ar' + base : base}`),
			route,
		)
		// Internal links of the shell keep /en (the Arabic playground link of the lab is the exception).
		const internal = await page.locator('header.meeko-ui-header a[href^="/"]:not([hreflang]), #docs-navigation a[href^="/"], main a[href^="/"]:not([hreflang])').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
		for (const href of internal) assert.match(href, /^\/en(\/|$|\?)/, `${route} links to ${href}`)
	}
	await page.goto(origin + '/en/routing')
	const switcher = page.getByRole('navigation', { name: 'Language', exact: true })
	assert.deepEqual(await switcher.getByRole('link').evaluateAll((links) => links.map((link) => [link.textContent.replace(/\s+/g, ''), link.getAttribute('href'), link.getAttribute('hreflang'), link.getAttribute('lang'), link.getAttribute('aria-current')])), [
		['ESEspañol', '/routing', 'es', 'es', null],
		['ENEnglish', '/en/routing', 'en', 'en', 'page'],
	])
	// The selector keeps its width: the active language does not move the header.
	const widths = await switcher.getByRole('link').evaluateAll((links) => links.map((link) => link.getBoundingClientRect().width))
	assert.equal(widths[0], widths[1])
	await switcher.getByRole('link', { name: 'Español', exact: true }).click()
	await page.waitForURL(origin + '/routing')
	assert.equal(await page.locator('html').getAttribute('lang'), 'es')
	assert.match(await page.evaluate(() => globalThis.document.cookie), /meeko-locale=es/)
	// The theme switcher of the shell speaks English under /en.
	await page.goto(origin + '/en/installation', { waitUntil: 'networkidle' })
	assert.match(await page.getByRole('banner').locator('[data-meeko-theme-toggle] button').getAttribute('aria-label'), /^Theme: \w+\. Switch to \w+$/)
	await page.getByRole('button', { name: 'Copy code' }).first().click()
	// The 404 page of an English URL is English.
	const missing = await page.goto(origin + '/en/does-not-exist')
	assert.equal(missing.status(), 404)
	assert.equal(await page.locator('html').getAttribute('lang'), 'en')
	assert.equal(await page.getByRole('heading', { name: 'This page does not exist', level: 1 }).count(), 1)
	assert.equal(await page.title(), 'This page does not exist · Meeko i18n')
	assert.equal(await page.getByRole('link', { name: 'Go to installation', exact: true }).getAttribute('href'), '/en/installation')
	// Mobile: the switcher stays in the header without horizontal scroll.
	await page.setViewportSize({ width: 360, height: 780 })
	await page.goto(origin + '/en/playground')
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	assert.equal(await page.getByRole('navigation', { name: 'Language', exact: true }).isVisible(), true)
	const sitemap = await (await fetch(origin + '/sitemap.xml')).text()
	assert.match(sitemap, /<loc>https:\/\/i18n\.meekojs\.com\/en\/routing<\/loc>/)
	assert.match(sitemap, /<xhtml:link rel="alternate" hreflang="en" href="https:\/\/i18n\.meekojs\.com\/en\/routing"\s*\/>/)
	assert.match(sitemap, /<xhtml:link rel="alternate" hreflang="x-default" href="https:\/\/i18n\.meekojs\.com\/routing"\s*\/>/)
	assert.deepEqual(warnings, [])
	assert.deepEqual(errors, [])
})
