import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

import { startDevServer } from '../../../scripts/test-support/dev-server.ts'

const demo = fileURLToPath(new URL('../../../apps/ui/', import.meta.url))
const output = fileURLToPath(new URL('../.meeko/', import.meta.url))

test('UICard hydrates snippets, changes variants and supports both themes and mobile', { timeout: 90_000 }, async (context) => {
	const cli = fileURLToPath(new URL('../../meeko/dist/cli.js', import.meta.url))
	const { origin, stop } = await startDevServer({ root: demo, cli, path: '/cards', startupTimeout: 30_000 })
	context.after(stop)
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const ssr = await browser.newPage({ javaScriptEnabled: false })
	await ssr.goto(`${origin}/cards`)
	assert.equal(await ssr.locator('.meeko-ui-card').count(), 7)
	assert.equal(await ssr.getByRole('region', { name: 'Tu espacio de trabajo', exact: true }).getByRole('button', { name: 'Guardar cambio' }).count(), 1)
	await ssr.close()
	const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	await page.goto(`${origin}/cards`, { waitUntil: 'networkidle' })
	const card = page.getByRole('region', { name: 'Tu espacio de trabajo', exact: true })
	const body = await card.locator('.meeko-ui-card-body').elementHandle()
	await card.getByRole('button', { name: 'Guardar cambio' }).click()
	assert.match(await card.getByRole('status').innerText(), /1/)
	const styles = {}
	for (const variant of ['outline', 'soft', 'solid', 'elevated']) {
		await page.getByLabel('Variante', { exact: true }).selectOption(variant)
		assert.equal(await card.getAttribute('data-variant'), variant)
		styles[variant] = await card.evaluate((element) => {
			const css = globalThis.getComputedStyle(element)
			return { background: css.backgroundColor, color: css.color, shadow: css.boxShadow }
		})
	}
	assert.notEqual(styles.outline.background, styles.soft.background)
	assert.notEqual(styles.outline.background, styles.solid.background)
	assert.notEqual(styles.outline.color, styles.solid.color)
	assert.equal(styles.outline.shadow, 'none')
	assert.notEqual(styles.elevated.shadow, 'none')
	// The reading styles of the page's <UIProse> stop at the card: on a solid, the text must still be the card's.
	const solidText = await page
		.locator('.meeko-ui-card[data-variant="solid"]')
		.last()
		.evaluate((element) => {
			const color = (selector) => globalThis.getComputedStyle(element.querySelector(selector)).color
			return { card: globalThis.getComputedStyle(element).color, description: color('.meeko-ui-card-description'), body: color('.meeko-ui-card-body p') }
		})
	assert.equal(solidText.description, solidText.card, 'the description of a solid card is readable')
	assert.equal(solidText.body, solidText.card, 'the content of a solid card is readable')
	assert.equal(await body.evaluate((element) => element.isConnected), true, 'variant updates retain hydrated content')
	assert.equal(await page.locator('.card-demo-custom .meeko-ui-card-header h2').innerText(), 'Cabecera personalizada')
	assert.equal(await page.locator('.card-demo-minimal header, .card-demo-minimal footer').count(), 0)
	assert.equal(await page.locator('.card-demo-custom footer').count(), 0)
	await page.getByLabel('Variante', { exact: true }).selectOption('outline')
	await mkdir(output, { recursive: true })
	await page.screenshot({ path: output + '/card-desktop.png', fullPage: true })
	await page.setViewportSize({ width: 390, height: 844 })
	await page.evaluate(() => {
		globalThis.document.documentElement.dataset.theme = 'dark'
	})
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	await page.screenshot({ path: output + '/card-mobile-dark.png', fullPage: true })
	assert.deepEqual(errors, [])
})
