import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

import { startDevServer } from '../../../scripts/test-support/dev-server.ts'

test('the appearance playground hydrates, copies its recipe and follows the theme', { timeout: 90_000 }, async (context) => {
	const root = fileURLToPath(new URL('../../../apps/ui/', import.meta.url))
	const cli = fileURLToPath(new URL('../../meeko/dist/cli.js', import.meta.url))
	const { origin, stop } = await startDevServer({ root, cli, path: '/theming', startupTimeout: 45_000 })
	context.after(stop)
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())

	const ssr = await browser.newPage({ javaScriptEnabled: false, colorScheme: 'light' })
	await ssr.goto(`${origin}/theming`)
	assert.match(await ssr.getByRole('button', { name: 'Botón de ejemplo' }).getAttribute('class'), /ui-neutral/)
	await ssr.close()

	const page = await browser.newPage({ colorScheme: 'light', reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 390, height: 844 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	const samples = [
		['buttons', '.ui-primary', '--ui-9'],
		['badges', '.ui-cyan', '--ui-9'],
		['forms', '.ui-primary', '--ui-2'],
		['cards', '.ui-primary', '--ui-2'],
	]
	for (const [route, selector, step] of samples) {
		await page.goto(`${origin}/${route}`)
		const sample = page.locator(`#appearance ~ * ${selector}`).first()
		const colors = await sample.evaluate((element, property) => {
			const style = globalThis.getComputedStyle(element)
			return { background: style.backgroundColor, step: style.getPropertyValue(property).trim() }
		}, step)
		assert.ok(colors.step, `${route} resolves ${step}`)
		assert.notEqual(colors.background, 'rgba(0, 0, 0, 0)', `${route} paints the preview`)
	}
	await page.goto(`${origin}/forms`)
	const fields = page.locator('#appearance ~ * input.ui-primary')
	assert.equal(await fields.count(), 4)
	for (const field of await fields.all()) {
		const styles = await field.evaluate((element) => {
			const css = globalThis.getComputedStyle(element)
			const placeholder = globalThis.getComputedStyle(element, '::placeholder')
			return { width: css.borderBottomWidth, border: css.borderBottomColor, placeholder: placeholder.opacity }
		})
		assert.notEqual(styles.width, '0px')
		assert.notEqual(styles.border, 'rgba(0, 0, 0, 0)')
		assert.equal(styles.placeholder, '1')
	}

	await page.goto(`${origin}/theming`, { waitUntil: 'networkidle' })

	assert.deepEqual(
		await page
			.locator('.appearance-variants li')
			.allTextContents()
			.then((items) => items.map((item) => item.trim())),
		[
			'solid',
			'soft',
			'outline',
			'ghost',
			'surface',
			'subtle',
			'link',
			'plain',
			'gradient',
			'glass',
		],
	)
	const playground = page.locator('.appearance-playground')
	const preview = playground.getByRole('button', { name: 'Botón de ejemplo' })
	const background = () => preview.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor)

	await playground.getByRole('radio', { name: 'Claro' }).click()
	await page.waitForFunction(() => globalThis.document.documentElement.dataset.theme === 'light')
	const neutral = await background()
	const color = playground.getByLabel('Color', { exact: true })
	assert.deepEqual(
		await color
			.locator('option')
			.allTextContents()
			.then((items) => items.map((item) => item.trim())),
		[
			'primary',
			'surface',
			'info',
			'success',
			'warning',
			'danger',
			'cyan',
			'orange',
			'pink',
		],
	)
	await color.selectOption('pink')
	const pink = await background()
	assert.notEqual(pink, neutral)
	await playground.getByLabel('Variante').selectOption('soft')
	const soft = await background()
	assert.notEqual(soft, pink)
	await playground.getByLabel('Radio').selectOption('full')
	assert.match(await preview.getAttribute('class'), /rounded-full/)
	await playground.getByRole('radio', { name: 'Oscuro' }).click()
	await page.waitForFunction(() => globalThis.document.documentElement.dataset.theme === 'dark')
	assert.notEqual(await background(), soft)

	const code = await playground.locator('pre code').textContent()
	assert.match(code, /"color": "pink"/)
	assert.match(code, /"variant": "soft"/)
	await playground.getByRole('button', { name: 'Copiar', exact: true }).click()
	await page.waitForFunction(async (expected) => (await globalThis.navigator.clipboard.readText()) === expected, code)
	assert.deepEqual(errors, [])
})
