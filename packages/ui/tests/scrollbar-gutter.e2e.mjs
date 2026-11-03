import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { startDemo } from './helpers/demo.mjs'

/** Two pixels of a screenshot: the colors a reader sees, not the ones the styles declare. */
async function pixels(context, buffer, points) {
	const decoder = await context.newPage()
	const colors = await decoder.evaluate(
		async ({ data, points }) => {
			const image = new globalThis.Image()
			image.src = `data:image/png;base64,${data}`
			await image.decode()
			const canvas = globalThis.document.createElement('canvas')
			canvas.width = image.width
			canvas.height = image.height
			const drawing = canvas.getContext('2d')
			drawing.drawImage(image, 0, 0)
			return points.map(([x, y]) => [...drawing.getImageData(x, y, 1, 1).data].slice(0, 3))
		},
		{ data: buffer.toString('base64'), points },
	)
	await decoder.close()
	return colors
}

const close = (first, second) => first.every((channel, index) => Math.abs(channel - second[index]) <= 2)

const dialogs = {
	palette: { route: '/overlays', open: (page) => page.locator('main .meeko-ui-command-trigger').first().click() },
	modal: { route: '/modals', open: (page) => page.getByRole('button', { name: 'Modal declarativo', exact: true }).click() },
	'drawer at the end': { route: '/overlays', open: (page) => page.getByRole('button', { name: 'Abrir filtros', exact: true }).click() },
	// The contents of a narrow screen: its trigger only exists there.
	'drawer at the start': { narrow: true, route: '/overlays', open: (page) => page.locator('.meeko-ui-page-bar .meeko-ui-drawer-trigger').click() },
}

async function measure(context, page, origin, dialog, theme, height) {
	await page.goto(origin + dialog.route, { waitUntil: 'networkidle' })
	await page.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0)
	await page.evaluate((value) => globalThis.document.documentElement.setAttribute('data-theme', value), theme)
	await dialog.open(page)
	await page.locator('dialog:modal').first().waitFor()
	// Past the entrance of the backdrop and of the root.
	await page.waitForTimeout(350)
	const box = await page.evaluate(() => ({ page: Math.round(globalThis.document.body.getBoundingClientRect().right), screen: globalThis.innerWidth }))
	assert.ok(box.screen > box.page, `there is no gutter to measure: ${JSON.stringify(box)}`)
	// Far from the top: the thumb of a classic scrollbar is there, and it is not part of the gutter.
	const y = Math.round(height * 0.7)
	const [inside, gutter] = await pixels(context, await page.screenshot(), [
		[box.page - 3, y],
		[box.screen - 3, y],
	])
	return { gutter, inside }
}

test('the gutter of the scrollbar takes the color of what an open dialog leaves next to it', { timeout: 300_000 }, async (t) => {
	const { browser, origin } = await startDemo(t)
	const classic = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
	t.after(() => classic.close())
	for (const [scrollbar, engine] of [
		['hidden', browser],
		['classic', classic],
	]) {
		for (const [width, height] of [
			[390, 844],
			[1440, 900],
			[2560, 1300],
		]) {
			for (const theme of ['light', 'dark']) {
				const context = await engine.newContext({ viewport: { width, height } })
				for (const [name, dialog] of Object.entries(dialogs)) {
					if (dialog.narrow && width > 390) continue
					const page = await context.newPage()
					const { gutter, inside } = await measure(context, page, origin, dialog, theme, height)
					assert.ok(close(gutter, inside), `${name}, ${scrollbar} scrollbar, ${width}, ${theme}: ${gutter} in the gutter and ${inside} next to it`)
					await page.close()
				}
				await context.close()
			}
		}
	}
})

test('without the dialog the gutter is the page again, and a short body does not darken the root twice', { timeout: 120_000 }, async (t) => {
	const { browser, origin } = await startDemo(t)
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	const page = await context.newPage()
	const dialog = dialogs.palette
	const { inside } = await measure(context, page, origin, dialog, 'light', 900)
	// A body with nothing that holds its height: below it there is only the root, under the backdrop.
	await page.addStyleTag({ content: 'body *:not(dialog, dialog *):not(:has(dialog[open])) { display: none !important; } body * { min-height: 0 !important; }' })
	const edge = await page.evaluate(() => Math.round(globalThis.document.body.getBoundingClientRect().right))
	const [short] = await pixels(context, await page.screenshot(), [[edge - 3, 630]])
	assert.ok(close(short, inside), `${short} below a short body and ${inside} over the page`)
	await page.keyboard.press('Escape')
	await page.waitForFunction(() => !globalThis.document.querySelector('dialog:modal'))
	const background = await page.evaluate(() => globalThis.getComputedStyle(globalThis.document.documentElement).backgroundColor)
	const body = await page.evaluate(() => globalThis.getComputedStyle(globalThis.document.body).backgroundColor)
	assert.equal(background, body, 'the root takes the color of the page again')
	await context.close()
})
