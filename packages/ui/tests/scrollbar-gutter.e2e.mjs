import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { startDemo } from './helpers/demo.mjs'
import { createNativeApp } from './helpers/native-app.mjs'

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
	palette: { route: '/overlays', open: (page) => page.locator('main button:has(+ dialog > div > input[type="search"][role="combobox"])').first().click() },
	modal: { route: '/modals', open: (page) => page.getByRole('button', { name: 'Modal declarativo', exact: true }).click() },
	'drawer at the end': { route: '/overlays', open: (page) => page.getByRole('button', { name: 'Abrir filtros', exact: true }).click() },
	// The contents of a narrow screen: its trigger only exists there, in the bar of UIPage just before the body that holds <main>.
	'drawer at the start': { narrow: true, route: '/overlays', open: (page) => page.locator('div:has(+ div > main) button[aria-haspopup="dialog"]').click() },
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

/** A browser that draws a classic scrollbar, 15 px wide, as a desktop does: the headless one hides it. */
async function classicBrowser(t) {
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
	t.after(() => browser.close())
	return browser
}

/** What the page says of the gutter: the measured width, its side, the padding of the root and where the body is. */
const frame = (page) =>
	page.evaluate(() => {
		const root = globalThis.document.documentElement
		const style = globalThis.getComputedStyle(root)
		const body = globalThis.document.body.getBoundingClientRect()
		return {
			gutter: style.getPropertyValue('--ui-scrollbar-gutter').trim(),
			side: root.getAttribute('data-meeko-ui-scrollbar-gutter'),
			padding: [style.paddingLeft, style.paddingRight],
			body: [Math.round(body.left), Math.round(body.right)],
			screen: globalThis.innerWidth,
		}
	})

const dark = (first, second) => first.reduce((sum, channel) => sum + channel, 0) < second.reduce((sum, channel) => sum + channel, 0) - 30

test('at 1280 px with a classic scrollbar, a drawer at the end, the modal and the palette reach the edge of the window, and closing them leaves nothing', { timeout: 300_000 }, async (t) => {
	const { origin } = await startDemo(t)
	const browser = await classicBrowser(t)
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
	const y = 560
	for (const direction of ['ltr', 'rtl']) {
		for (const name of ['drawer at the end', 'modal', 'palette']) {
			const dialog = dialogs[name]
			const page = await context.newPage()
			await page.goto(origin + dialog.route, { waitUntil: 'networkidle' })
			await page.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0)
			// Light: over a black page the backdrop would not show. The direction of every element that sets its own.
			await page.evaluate((value) => {
				const root = globalThis.document.documentElement
				root.setAttribute('data-theme', 'light')
				root.setAttribute('dir', value)
				for (const element of root.querySelectorAll('[dir]')) element.setAttribute('dir', value)
			}, direction)
			const before = await frame(page)
			assert.deepEqual({ gutter: before.gutter, side: before.side, body: before.body }, { gutter: '15px', side: 'right', body: [0, 1265] }, `${name}, ${direction}: the gutter is measured on <html>`)
			const [page1] = await pixels(context, await page.screenshot(), [[1277, y]])
			await dialog.open(page)
			await page.locator('dialog:modal').first().waitFor()
			await page.waitForTimeout(400)
			const open = await frame(page)
			assert.deepEqual(open.body, before.body, `${name}, ${direction}: the page does not move`)
			// Next to the gutter, inside the window: the drawer itself, or the backdrop over the page.
			const [gutter, inside] = await pixels(context, await page.screenshot(), [
				[1277, y],
				[1262, y],
			])
			assert.ok(close(gutter, inside), `${name}, ${direction}: ${gutter} in the gutter and ${inside} next to it`)
			if (name !== 'drawer at the end' || direction === 'rtl') assert.ok(dark(gutter, page1), `${name}, ${direction}: the backdrop darkens the gutter, ${page1} before and ${gutter} now`)
			if (name === 'drawer at the end') {
				const edge = await page.evaluate(() => Math.round(globalThis.document.querySelector('dialog:modal').getBoundingClientRect()[globalThis.document.documentElement.dir === 'rtl' ? 'left' : 'right']))
				assert.equal(edge, direction === 'rtl' ? 0 : 1280, `${direction}: the panel touches the edge of the window`)
				assert.deepEqual(open.padding, ['0px', '15px'], 'the root keeps the width of the gutter as padding')
			}
			await page.keyboard.press('Escape')
			await page.waitForFunction(() => !globalThis.document.querySelector('dialog:modal, dialog[data-meeko-ui-modal-state=closing]'))
			await page.waitForTimeout(400)
			const after = await frame(page)
			assert.deepEqual(after, before, `${name}, ${direction}: closed, the root is as it was`)
			const [page2] = await pixels(context, await page.screenshot(), [[1277, y]])
			assert.ok(close(page2, page1), `${name}, ${direction}: the gutter is the page again, ${page1} before and ${page2} now`)
			await page.close()
		}
	}
	await context.close()
})

test('a panel of the app with useScrollLock reaches the edge of the window, and leaves the page where it was', { timeout: 300_000 }, async (t) => {
	const sheet = `<script lang="ts">
	import { signal } from '@meekojs/meeko'
	import { useScrollLock } from '@meekojs/ui/runtime'

	const open = signal(false)
	useScrollLock(() => open.value)
</script>

<template>
	<main>
		<button id="sheet-toggle" type="button" on:click="() => (open.value = !open.value)">Hoja</button>
		<div style="block-size: 300vh"></div>
		<aside id="sheet" if:when="open.value" style="position: fixed; inset-block: 0; inset-inline-end: 0; inline-size: 20rem; background: rgb(200 30 30)"></aside>
	</main>
</template>
`
	const { origin } = await createNativeApp(t, { 'app/pages/sheet.meeko': sheet, 'app/pages/sheet.route.ts': "import { definePage } from '@meekojs/meeko/framework'\nexport const route = definePage({ render: 'prerender' })\n" })
	const browser = await classicBrowser(t)
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
	const page = await context.newPage()
	await page.goto(`${origin}/sheet`, { waitUntil: 'networkidle' })
	await page.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0)
	const before = await frame(page)
	assert.equal(before.gutter, '15px')
	const [page1] = await pixels(context, await page.screenshot(), [[1277, 400]])
	await page.locator('#sheet-toggle').click()
	await page.locator('#sheet').waitFor()
	const open = await frame(page)
	assert.deepEqual(open.body, before.body, 'the page does not move')
	assert.deepEqual(open.padding, ['0px', '15px'])
	const [gutter] = await pixels(context, await page.screenshot(), [[1277, 400]])
	assert.ok(close(gutter, [200, 30, 30]), `the panel paints the gutter: ${gutter}`)
	await page.locator('#sheet-toggle').click({ force: true, position: { x: 5, y: 5 } })
	await page.locator('#sheet').waitFor({ state: 'detached' })
	assert.deepEqual(await frame(page), before, 'unlocked, the root is as it was')
	const [page2] = await pixels(context, await page.screenshot(), [[1277, 400]])
	assert.ok(close(page2, page1), `the gutter is the page again: ${page1} before and ${page2} now`)
	await context.close()
})
