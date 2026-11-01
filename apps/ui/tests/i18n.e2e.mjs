import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

/** Spanish interface texts of the shell and of this site that an /en/ page must never contain. */
const spanishInterface = ['Saltar al contenido', 'Buscar en la guía', 'Filtrar documentación', 'Ecosistema', 'Documentación', 'Menú', 'Paquete de Meeko', 'Licencia MIT', 'Destacado', 'No hay coincidencias', 'Copiar', 'Ejemplo .meeko', 'Propiedades', 'Tipo / valor inicial', 'Descripción', '¿Te sirvió', 'Añadir un comentario', 'Cerrar aviso', 'Cerrar modal', 'Cambiar tema', 'Tema:', 'Claro', 'Oscuro', 'Sistema', 'Idioma', 'Seguir en', 'Primeros pasos', 'Componentes', 'Integración con Meeko', 'Esta página no existe', 'Ver componentes', 'Quitar selección', 'Sin resultados', 'No hay datos']

const guides = ['/', '/installation', '/theming', '/components', '/container', '/buttons', '/links', '/badges', '/icons', '/forms', '/select', '/cards', '/tables', '/modals', '/popover', '/app', '/theme-toggle', '/transitions', '/transitions/project']

async function freePort() {
	const socket = createServer().listen(0, '127.0.0.1')
	await once(socket, 'listening')
	const port = socket.address().port
	await new Promise((done) => socket.close(done))
	return port
}

test('the English UI documentation has an English interface, hreflang, a switcher, /en links, an English 404 and sitemap', { timeout: 180_000 }, async (context) => {
	const port = await freePort()
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
	// A Spanish reader on the English site: the shell suggests Spanish, without redirecting.
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'es-ES' })
	const warnings = []
	page.on('console', (message) => {
		if (/\[meeko:i18n\]/.test(message.text())) warnings.push(message.text())
	})
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	// Visible text without code blocks, documented default values or content in another language, plus
	// accessible and placeholder texts.
	const interfaceTexts = () =>
		page.evaluate(() => {
			const body = globalThis.document.body.cloneNode(true)
			for (const element of body.querySelectorAll('pre, code, .api-default, [lang]:not([lang="en"])')) element.remove()
			const attributes = [...globalThis.document.querySelectorAll('[aria-label], [placeholder], [title]')].filter((element) => !element.closest('[lang]:not([lang="en"])')).flatMap((element) => ['aria-label', 'placeholder', 'title'].map((name) => element.getAttribute(name) ?? ''))
			return [body.innerText, ...attributes].join('\n')
		})
	for (const guide of guides) {
		const route = guide === '/' ? '/en' : '/en' + guide
		const response = await page.goto(origin + route, { waitUntil: 'networkidle' })
		assert.equal(response.status(), 200, route)
		assert.equal(await page.locator('html').getAttribute('lang'), 'en', route)
		assert.equal(await page.locator('main h1').count(), 1, route)
		assert.match(await page.title(), / · Meeko UI$/, route)
		const texts = await interfaceTexts()
		for (const spanish of spanishInterface) assert.ok(!texts.includes(spanish), `${route} shows the Spanish interface text «${spanish}»`)
		// Every page has its English prose: no untranslated notice and no Spanish prose marked as such.
		assert.equal(await page.locator('.doc-untranslated').count(), 0, route)
		assert.equal(await page.locator('main[lang]').count(), 0, route)
		assert.deepEqual(
			await page.locator('link[rel="alternate"][hreflang]').evaluateAll((links) => links.map((link) => `${link.getAttribute('hreflang')} ${link.href}`)),
			['es', 'en', 'x-default'].map((hreflang) => `${hreflang} https://ui.meekojs.com${hreflang === 'en' ? route : guide}`),
			route,
		)
		const internal = await page.locator('a[href^="/"]:not([hreflang])').evaluateAll((links) => links.map((link) => link.getAttribute('href')))
		for (const href of internal) assert.match(href, /^\/en(\/|$|\?|#)/, `${route} links to ${href}`)
	}
	await page.goto(origin + '/en/buttons', { waitUntil: 'networkidle' })
	const switcher = page.getByRole('navigation', { name: 'Language', exact: true })
	assert.deepEqual(await switcher.getByRole('link').evaluateAll((links) => links.map((link) => [link.getAttribute('href'), link.getAttribute('hreflang'), link.getAttribute('lang'), link.getAttribute('aria-current')])), [
		['/buttons', 'es', 'es', null],
		['/en/buttons', 'en', 'en', 'true'],
	])
	// The suggestion floats over the page and speaks the suggested language.
	const suggestion = page.getByRole('status', { name: 'Language suggestion', exact: true })
	await suggestion.waitFor()
	assert.equal(await suggestion.getByRole('link', { name: 'Leer esta página en español', exact: true }).getAttribute('href'), '/buttons')
	assert.equal(await suggestion.evaluate((element) => globalThis.getComputedStyle(element).position), 'fixed')
	await page.screenshot({ path: output + '/en-buttons-desktop.png' })
	await suggestion.getByRole('button', { name: 'Stay in English', exact: true }).click()
	await suggestion.waitFor({ state: 'detached' })
	await page.reload({ waitUntil: 'networkidle' })
	assert.equal(await suggestion.count(), 0, 'a remembered choice hides the suggestion')
	assert.match(await page.locator('.header-actions [data-meeko-theme-toggle] button').getAttribute('aria-label'), /^Theme: \w+\. Switch to \w+$/)
	// Same-locale navigation stays in the document and in English.
	await page.evaluate(() => {
		globalThis.uiDocumentMarker = 'same-locale'
	})
	await page.locator('#docs-navigation').getByRole('link', { name: 'Select', exact: true }).click()
	await page.waitForURL(origin + '/en/select')
	await page.getByRole('heading', { name: 'Select', level: 1 }).waitFor()
	assert.equal(await page.evaluate(() => globalThis.uiDocumentMarker), 'same-locale')
	assert.equal(await page.locator('#docs-navigation a[aria-current="page"]').getAttribute('href'), '/en/select')
	// The Spanish version of a page from the switcher is a full navigation that remembers the choice.
	await page.getByRole('navigation', { name: 'Language', exact: true }).getByRole('link', { name: 'Español', exact: true }).click()
	await page.waitForURL(origin + '/select')
	assert.equal(await page.locator('html').getAttribute('lang'), 'es')
	assert.match(await page.evaluate(() => globalThis.document.cookie), /meeko-locale=es/)
	assert.equal(await page.getByRole('navigation', { name: 'Idioma', exact: true }).getByRole('link', { name: 'English', exact: true }).getAttribute('href'), '/en/select')
	// The 404 page of an English URL is English.
	const missing = await page.goto(origin + '/en/does-not-exist')
	assert.equal(missing.status(), 404)
	assert.equal(await page.locator('html').getAttribute('lang'), 'en')
	assert.equal(await page.getByRole('heading', { name: 'This page does not exist', level: 1 }).count(), 1)
	assert.equal(await page.getByRole('link', { name: 'See components', exact: true }).getAttribute('href'), '/en/components')
	// The components bring their own texts: English pages pass none of them, also in dynamic states.
	await page.goto(origin + '/en/tables', { waitUntil: 'networkidle' })
	assert.equal(await page.getByRole('table', { name: 'Empty table', exact: true }).locator('.meeko-ui-table-empty').innerText(), 'No data.')
	await page.goto(origin + '/en/select', { waitUntil: 'networkidle' })
	// The page documents the same default text that the component shows.
	assert.equal(await page.getByText('Sin resultados').count(), 0, 'the English page does not quote the Spanish default')
	assert.equal(await page.locator('code', { hasText: /^No results$/ }).count(), 1)
	await page.locator('#topics').fill('zzzz')
	assert.equal(await page.locator('[data-meeko-popover]:popover-open [data-meeko-select-empty]').innerText(), 'No results')
	await page.keyboard.press('Escape')
	await page.locator('#owner').click()
	await page.locator('[data-meeko-popover]:popover-open [role="option"]:not([aria-disabled="true"])').first().click()
	assert.equal(await page.getByRole('button', { name: 'Clear selection', exact: true }).count(), 1)
	await page.goto(origin + '/en/modals', { waitUntil: 'networkidle' })
	const closeButtons = page.locator('.meeko-ui-modal-close')
	assert.deepEqual(await closeButtons.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))), ['Close modal'], 'the declarative modal, after hydration')
	await page.getByRole('button', { name: 'Open confirmation', exact: true }).click()
	// A modal opened by name, mounted later under UIApp, reads the same locale.
	const confirm = page.getByRole('dialog', { name: 'Confirm action', exact: true })
	await confirm.getByRole('button', { name: 'Close modal', exact: true }).waitFor()
	await page.keyboard.press('Escape')
	await confirm.waitFor({ state: 'detached' })
	await page.goto(origin + '/en/theme-toggle', { waitUntil: 'networkidle' })
	assert.match(await page.locator('#theme-cycle button').getAttribute('aria-label'), /^Theme: (light|dark|system)\. Switch to (light|dark|system)$/)
	assert.deepEqual(await page.locator('#theme-select').getByRole('radiogroup', { name: 'Theme', exact: true }).getByRole('radio').allInnerTexts(), ['Light', 'Dark', 'System'])
	// UILinkCard to: localized, and a navigation of the client that keeps the document.
	await page.goto(origin + '/en/links', { waitUntil: 'networkidle' })
	const card = page.locator('a.meeko-ui-link-card')
	assert.equal(await card.getAttribute('href'), '/en/theming')
	await page.evaluate(() => {
		globalThis.uiDocumentMarker = 'card'
	})
	await card.click()
	await page.waitForURL(origin + '/en/theming')
	assert.equal(await page.evaluate(() => globalThis.uiDocumentMarker), 'card')
	// The Spanish versions keep the Spanish texts and the route without a prefix.
	await page.goto(origin + '/tables', { waitUntil: 'networkidle' })
	assert.equal(await page.getByRole('table', { name: 'Tabla vacía', exact: true }).locator('.meeko-ui-table-empty').innerText(), 'No hay datos.')
	await page.goto(origin + '/links', { waitUntil: 'networkidle' })
	assert.equal(await page.locator('a.meeko-ui-link-card').getAttribute('href'), '/theming')
	// Mobile: the switcher stays in the header without horizontal scroll; the menu is English.
	await page.setViewportSize({ width: 360, height: 780 })
	await page.goto(origin + '/en/modals', { waitUntil: 'networkidle' })
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	assert.equal(await page.getByRole('navigation', { name: 'Language', exact: true }).isVisible(), true)
	await page.locator('.mobile-menu > summary').click()
	await page.getByRole('searchbox', { name: 'Search the guide', exact: true }).fill('table')
	await page.getByRole('navigation', { name: 'UI documentation', exact: true }).getByRole('link', { name: 'Table', exact: true }).click()
	await page.waitForURL(origin + '/en/tables')
	await page.screenshot({ path: output + '/en-tables-mobile.png' })
	// Without JavaScript the server already renders English links and texts.
	const ssr = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
	await ssr.goto(origin + '/en/installation')
	assert.equal(await ssr.getByRole('link', { name: 'all components', exact: true }).getAttribute('href'), '/en/components')
	assert.equal(await ssr.getByRole('link', { name: 'Skip to content', exact: true }).count(), 1)
	// The same texts the hydrated pages above show: SSR and the client choose the same ones.
	await ssr.goto(origin + '/en/tables')
	assert.equal(await ssr.locator('.meeko-ui-table-empty').first().innerText(), 'No data.')
	await ssr.goto(origin + '/en/modals')
	assert.equal(await ssr.locator('.meeko-ui-modal-close').first().getAttribute('aria-label'), 'Close modal')
	await ssr.goto(origin + '/en/theme-toggle')
	assert.equal(await ssr.locator('#theme-select [role="radiogroup"]').getAttribute('aria-label'), 'Theme')
	assert.equal(await ssr.locator('#theme-cycle button').getAttribute('aria-label'), 'Change theme')
	await ssr.goto(origin + '/en/links')
	assert.equal(await ssr.locator('a.meeko-ui-link-card').getAttribute('href'), '/en/theming')
	await ssr.close()
	const sitemap = await (await fetch(origin + '/sitemap.xml')).text()
	assert.match(sitemap, /<loc>https:\/\/ui\.meekojs\.com\/en\/buttons<\/loc>/)
	assert.match(sitemap, /<xhtml:link rel="alternate" hreflang="en" href="https:\/\/ui\.meekojs\.com\/en\/buttons"\s*\/>/)
	assert.match(sitemap, /<xhtml:link rel="alternate" hreflang="x-default" href="https:\/\/ui\.meekojs\.com\/buttons"\s*\/>/)
	assert.deepEqual(warnings, [])
	assert.deepEqual(errors, [])
})
