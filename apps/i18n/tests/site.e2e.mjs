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
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	for (const route of ['/', '/installation', '/messages', '/plurals', '/formatting', '/routing', '/namespaces', '/rtl', '/api', '/validation', '/playground', '/en/playground', '/ar/playground']) {
		const response = await page.goto(origin + route)
		assert.equal(response.status(), 200, route)
		assert.equal(await page.locator('main h1').count(), 1, route)
		assert.match(await page.title(), / · Meeko i18n$/, route)
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
	await page.goto(origin + '/playground?tab=demo#messages', { waitUntil: 'networkidle' })
	await page.evaluate(() => {
		globalThis.i18nDocumentMarker = 'before-switch'
	})
	await page.getByRole('button', { name: 'English', exact: true }).click()
	await page.waitForURL(origin + '/en/playground?tab=demo#messages')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="greeting"]')?.textContent?.trim() === 'Hello Meeko')
	assert.equal(await page.evaluate(() => globalThis.i18nDocumentMarker), undefined, 'changing locale performs a full navigation')
	assert.equal(await page.locator('html').getAttribute('lang'), 'en')
	await page.getByRole('textbox', { name: 'Nombre para traducir', exact: true }).fill('Ada')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="greeting"]')?.textContent?.trim() === 'Hello Ada')
	const range = page.getByRole('slider')
	await range.press('Home')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="plural"]')?.textContent?.trim() === 'Your cart is empty')
	await range.press('ArrowRight')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="plural"]')?.textContent?.trim() === '1 item in your cart')
	await range.press('ArrowRight')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="plural"]')?.textContent?.trim() === '2 items in your cart')
	await page.getByLabel('Permiso del usuario', { exact: true }).selectOption('viewer')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="select"]')?.textContent?.includes('you can view'))
	await page.getByLabel('Moneda', { exact: true }).selectOption('EUR')
	await page.waitForFunction(() => globalThis.document.querySelector('[data-output="number"]')?.textContent?.trim() === new Intl.NumberFormat('en', { style: 'currency', currency: 'EUR' }).format(12345.67))
	assert.equal(await page.locator('[data-output="date"]').innerText(), await page.evaluate(() => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 15, 12))))
	await page.getByRole('button', { name: 'العربية', exact: true }).click()
	await page.waitForURL(origin + '/ar/playground?tab=demo#messages')
	await page.waitForFunction(() => globalThis.document.documentElement.lang === 'ar')
	assert.equal(await page.locator('html').getAttribute('dir'), 'rtl')
	assert.equal(await page.getByRole('region', { name: 'Resultado traducido' }).getAttribute('lang'), 'ar')
	assert.equal(await page.getByRole('region', { name: 'Resultado traducido' }).evaluate((element) => globalThis.getComputedStyle(element).direction), 'rtl')
	assert.match(await page.locator('[data-output="plural"]').innerText(), /عنصران/)
	await page.screenshot({ path: output + '/rtl-desktop.png', fullPage: true })
	await page.setViewportSize({ width: 390, height: 844 })
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	await page.screenshot({ path: output + '/rtl-mobile.png', fullPage: true })
	await page.locator('.mobile-menu > summary').click()
	await page.getByRole('searchbox', { name: 'Buscar en la guía', exact: true }).fill('namespace')
	const navigation = page.getByRole('navigation', { name: 'Documentación de i18n', exact: true })
	await navigation.getByRole('link', { name: 'Namespaces', exact: true }).click()
	await page.waitForURL(origin + '/namespaces')
	await page.locator('[data-output="namespace"]').waitFor()
	assert.equal(await page.locator('[data-output="namespace"]').innerText(), 'Tu pedido tiene 3 productos.')
	assert.equal(await page.locator('.mobile-menu').getAttribute('open'), null)
	for (const locale of ['en', 'ar']) {
		const ssr = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
		await ssr.goto(origin + '/' + locale + '/playground')
		assert.match(await ssr.locator('[data-output="greeting"]').innerText(), locale === 'en' ? /Hello Meeko/ : /مرحبًا/)
		await ssr.locator('.mobile-menu > summary').click()
		await ssr.getByRole('navigation', { name: 'Documentación de i18n', exact: true }).getByRole('link', { name: 'Instalación', exact: true }).click()
		assert.equal(await ssr.getByRole('heading', { name: 'Instalación', level: 1 }).count(), 1)
		await ssr.close()
	}
	const missing = await page.goto(origin + '/fr/playground')
	assert.equal(missing.status(), 404)
	assert.equal(await page.getByRole('heading', { name: 'Esta página no existe', level: 1 }).count(), 1)
	await page.getByRole('link', { name: 'Ir a la instalación', exact: true }).click()
	await page.getByRole('heading', { name: 'Instalación', level: 1 }).waitFor()
	assert.deepEqual(errors, [])
})
