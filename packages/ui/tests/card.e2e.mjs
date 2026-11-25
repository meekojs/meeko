import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

import { startDevServer } from '../../../scripts/test-support/dev-server.ts'

const demo = fileURLToPath(new URL('../../../apps/ui/', import.meta.url))
const output = fileURLToPath(new URL('../.meeko/', import.meta.url))

test('UICard hydrates snippets, changes variant and color and supports both themes and mobile', { timeout: 90_000 }, async (context) => {
	const cli = fileURLToPath(new URL('../../meeko/dist/cli.js', import.meta.url))
	const { origin, stop } = await startDevServer({ root: demo, cli, path: '/cards', startupTimeout: 30_000 })
	context.after(stop)
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const ssr = await browser.newPage({ javaScriptEnabled: false })
	await ssr.goto(`${origin}/cards`)
	// A card is the <section> that groups its parts for the table in its body: the demo, the four of the grid, the
	// two of the snippets, the frame of the preview and its four, and the three of the actions.
	assert.equal(await ssr.locator('section[class~="group/card"]').count(), 15)
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
	const body = await card.locator(':scope > div').elementHandle()
	await card.getByRole('button', { name: 'Guardar cambio' }).click()
	assert.match(await card.getByRole('status').innerText(), /1/)
	const styles = {}
	// The treatment and the color are two selects: each pair paints the root with the classes of the catalog.
	const backgrounds = { surface: 'bg-surface', soft: 'bg-control-hover', solid: 'bg-neutral-9', glass: 'bg-gray-a3', plain: null }
	for (const variant of Object.keys(backgrounds)) {
		await page.getByLabel('Variante', { exact: true }).selectOption(variant)
		const classes = (await card.getAttribute('class')).split(' ')
		if (backgrounds[variant]) assert.ok(classes.includes(backgrounds[variant]), variant)
		else assert.ok(!classes.some((name) => name.startsWith('bg-')), 'plain does not paint')
		styles[variant] = await card.evaluate((element) => {
			const css = globalThis.getComputedStyle(element)
			return { background: css.backgroundColor, color: css.color, shadow: css.boxShadow }
		})
	}
	await page.getByLabel('Variante', { exact: true }).selectOption('solid')
	await page.getByLabel('Color', { exact: true }).selectOption('primary')
	assert.ok((await card.getAttribute('class')).split(' ').includes('bg-primary-9'), 'solid primary')
	styles.primary = await card.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor)
	assert.notEqual(styles.primary, styles.solid.background, 'the color changes the solid')
	assert.notEqual(styles.surface.background, styles.soft.background)
	assert.notEqual(styles.surface.background, styles.solid.background)
	assert.notEqual(styles.surface.color, styles.solid.color)
	assert.equal(styles.plain.background, 'rgba(0, 0, 0, 0)')
	assert.equal(styles.surface.shadow, 'none')
	const elevated = await page.getByRole('region', { name: 'Elevation', exact: true }).evaluate((element) => globalThis.getComputedStyle(element).boxShadow)
	assert.notEqual(elevated, 'none', 'elevation adds a shadow')
	// A card does not react to the pointer: hovering keeps its background.
	await page.getByLabel('Color', { exact: true }).selectOption('neutral')
	await page.getByLabel('Variante', { exact: true }).selectOption('surface')
	await card.hover()
	assert.equal(await card.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor), styles.surface.background, 'no hover state')
	// The reading styles of the page's <UIProse> stop at the card: on a solid, the text must still be the card's.
	const solidText = await page
		.locator('section[class~="bg-primary-9"]')
		.last()
		.evaluate((element) => {
			const color = (selector) => globalThis.getComputedStyle(element.querySelector(selector)).color
			return { card: globalThis.getComputedStyle(element).color, description: color(':scope > header > p'), body: color(':scope > div p') }
		})
	assert.equal(solidText.description, solidText.card, 'the description of a solid card is readable')
	assert.equal(solidText.body, solidText.card, 'the content of a solid card is readable')
	assert.equal(await body.evaluate((element) => element.isConnected), true, 'variant updates retain hydrated content')
	assert.equal(await page.locator('.card-demo-custom > header h2').innerText(), 'Cabecera personalizada')
	assert.equal(await page.locator('.card-demo-minimal header, .card-demo-minimal footer').count(), 0)
	assert.equal(await page.locator('.card-demo-custom footer').count(), 0)
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

/** Where the actions of a card sit with respect to its title, and the width of its header. */
const actionsLayout = (card) =>
	card.evaluate((element) => {
		const box = (selector) => element.querySelector(selector).getBoundingClientRect()
		const [title, description, actions] = [box(':scope > header > h2'), box(':scope > header > p'), box(':scope > header > div')]
		const order = [...element.querySelector(':scope > header').children].map((child) => child.tagName)
		const header = element.querySelector(':scope > header')
		const css = globalThis.getComputedStyle(header)
		// The container query measures the content box of the header.
		return { title, description, actions, order, header: header.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) }
	})

test('UICard actionsWrap="auto" moves the actions under the title in a narrow card, not by the window', { timeout: 90_000 }, async (context) => {
	const cli = fileURLToPath(new URL('../../meeko/dist/cli.js', import.meta.url))
	const { origin, stop } = await startDevServer({ root: demo, cli, path: '/cards', startupTimeout: 30_000 })
	context.after(stop)
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const beside = (layout) => layout.actions.left >= layout.title.right && layout.actions.top < layout.title.bottom
	const below = (layout) => layout.actions.top >= layout.description.bottom && Math.abs(layout.actions.left - layout.title.left) < 1
	for (const javaScriptEnabled of [false, true]) {
		// Without JavaScript too: the server HTML already has its final layout.
		const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, javaScriptEnabled })
		await page.goto(`${origin}/cards`, { waitUntil: javaScriptEnabled ? 'networkidle' : 'load' })
		const wide = page.getByRole('region', { name: 'Pedidos', exact: true })
		const narrow = page.getByRole('region', { name: 'Facturas', exact: true })
		// A card of a wide window, made narrow by its own width: auto follows the card, not the window.
		await narrow.evaluate((element) => {
			element.style.width = '20rem'
		})
		const wideLayout = await actionsLayout(wide)
		const narrowLayout = await actionsLayout(narrow)
		assert.ok(wideLayout.header >= 384, `the wide card is wide: ${wideLayout.header}px`)
		assert.ok(beside(wideLayout), `a wide card keeps its actions beside the title: ${JSON.stringify(wideLayout)}`)
		assert.ok(narrowLayout.header < 384, `the narrowed card is narrow: ${narrowLayout.header}px`)
		assert.ok(below(narrowLayout), `a narrow card on a wide window puts its actions under the title: ${JSON.stringify(narrowLayout)}`)
		assert.ok(Math.abs(narrowLayout.title.width - narrowLayout.header) < 1, 'the empty column of the actions takes no width from the title')
		for (const layout of [wideLayout, narrowLayout]) assert.deepEqual(layout.order, ['H2', 'P', 'DIV'], 'the DOM order does not change')
		// It goes back beside the title when the card widens again.
		await narrow.evaluate((element) => {
			element.style.width = ''
		})
		assert.ok(beside(await actionsLayout(narrow)), 'the card of the grid, at its own width, has room for its actions')
		// below puts them underneath even in a wide card.
		assert.ok(below(await actionsLayout(page.getByRole('region', { name: 'Clientes', exact: true }))), 'below, at any width')
		await page.close()
	}
	// A narrow window narrows every card: all of them put their actions under the title, without horizontal scroll.
	const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
	await mobile.goto(`${origin}/cards`, { waitUntil: 'networkidle' })
	assert.ok(below(await actionsLayout(mobile.getByRole('region', { name: 'Pedidos', exact: true }))))
	assert.equal(await mobile.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	await mobile.close()
})
