import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { startDemo } from './helpers/demo.mjs'

test('Container preserves semantics and fits mobile, 4K, wider and nested layouts with logical gutters', { timeout: 90_000 }, async (context) => {
	const { browser, origin, output } = await startDemo(context)
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto(origin + '/container', { waitUntil: 'networkidle' })
	const preview = page.getByRole('region', { name: 'Vista previa del contenedor', exact: true })
	assert.equal(await preview.evaluate((element) => element.tagName), 'SECTION')
	await page.getByLabel('Ancho máximo', { exact: true }).selectOption('4k')
	await page.waitForFunction(() => globalThis.document.querySelector('.container-example')?.getAttribute('data-size') === '4k')
	assert.match(await preview.innerText(), /size=4k/)
	const ssr = await browser.newPage({ javaScriptEnabled: false })
	await ssr.goto(origin + '/container')
	const html = await ssr.locator('.container-example').evaluate((element) => element.outerHTML)
	assert.match(html, /data-size="xl"/)
	const sheets = await Promise.all(['tokens.css', 'deprecated.css', 'container.css'].map((name) => readFile(new URL(`../src/app/styles/${name}`, import.meta.url), 'utf8')))
	const stylesheet = sheets.join('\n')
	// Exercise the shipped SSR markup and stylesheet outside the documentation's constrained column.
	const isolated = await browser.newPage()
	await isolated.setContent('<!doctype html><html><head><style>html{font-size:16px}body{margin:0}' + stylesheet + '</style></head><body>' + html + '</body></html>')
	const measure = () =>
		isolated.locator('.meeko-ui-container').evaluate((element) => {
			const bounds = element.getBoundingClientRect()
			const css = globalThis.getComputedStyle(element)
			return { x: bounds.x, width: bounds.width, start: parseFloat(css.paddingInlineStart), end: parseFloat(css.paddingInlineEnd), viewport: globalThis.innerWidth, scroll: globalThis.document.documentElement.scrollWidth }
		})
	for (const width of [320, 390, 768, 1280, 1920, 2560, 3840, 5120]) {
		await isolated.setViewportSize({ width, height: 900 })
		await isolated.locator('.meeko-ui-container').evaluate((element) => {
			element.dataset.size = '4k'
		})
		const actual = await measure()
		assert.equal(actual.width, Math.min(width, 3840), `4k width at ${width}`)
		assert.equal(actual.x, Math.max(0, (width - 3840) / 2), `centering at ${width}`)
		assert.ok(Math.abs(actual.start - Math.min(64, Math.max(16, width * 0.02))) < 0.1)
		assert.equal(actual.start, actual.end)
		assert.ok(actual.scroll <= actual.viewport, `no overflow at ${width}`)
	}
	await isolated.setViewportSize({ width: 3840, height: 2160 })
	for (const [size, expected] of Object.entries({ sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536, '3xl': 1920, '4k': 3840, full: 3840 })) {
		await isolated.locator('.meeko-ui-container').evaluate((element, value) => {
			element.dataset.size = value
		}, size)
		assert.equal((await measure()).width, expected, size)
	}
	for (const [gutter, expected] of Object.entries({ none: 0, sm: 24, md: 64, lg: 96 })) {
		await isolated.locator('.meeko-ui-container').evaluate((element, value) => {
			element.dataset.gutter = value
		}, gutter)
		assert.equal((await measure()).start, expected, gutter)
	}
	await isolated.setViewportSize({ width: 5120, height: 2160 })
	assert.equal((await measure()).width, 5120, 'full does not inherit the 4k cap')
	await isolated.evaluate(() => {
		globalThis.document.documentElement.dir = 'rtl'
		const container = globalThis.document.querySelector('.meeko-ui-container')
		container.dataset.size = '4k'
		container.dataset.gutter = 'md'
		const parent = globalThis.document.createElement('div')
		parent.style.width = '900px'
		globalThis.document.body.append(parent)
		parent.append(container)
	})
	assert.equal((await measure()).width, 900, 'the parent constrains even a 4k container')
	assert.equal((await measure()).start, (await measure()).end, 'RTL uses logical symmetric padding')
	await isolated.locator('.meeko-ui-container').evaluate((element) => {
		element.style.setProperty('--ui-container-max-width', '600px')
		element.style.setProperty('--ui-container-gutter', '24px')
	})
	assert.equal((await measure()).width, 600, 'custom maximum overrides the selected preset')
	assert.equal((await measure()).start, 24, 'custom gutters override the selected preset')
	await isolated.locator('.meeko-ui-container').evaluate((element) => {
		element.style.removeProperty('--ui-container-max-width')
		element.style.removeProperty('--ui-container-gutter')
		element.style.setProperty('--meeko-ui-container-max-width', '500px')
		element.style.setProperty('--meeko-ui-container-gutter', '20px')
	})
	assert.equal((await measure()).width, 500, 'the deprecated maximum still works')
	assert.equal((await measure()).start, 20, 'the deprecated gutter still works')
	await page.setViewportSize({ width: 3840, height: 2160 })
	// 96rem, the width of UIPage, on the fluid root of 20.8px at this size.
	assert.ok(Math.abs((await page.locator('.meeko-ui-page-body').evaluate((element) => element.getBoundingClientRect().width)) - 96 * 20.8) < 1, 'the public site uses the width of UIPage, centered')
	await page.screenshot({ path: output + '/container-4k.png' })
	await page.setViewportSize({ width: 390, height: 844 })
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	await page.screenshot({ path: output + '/container-mobile.png', fullPage: true })
	assert.deepEqual(errors, [])
})
