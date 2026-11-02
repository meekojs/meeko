import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { startDemo } from './helpers/demo.mjs'

// 82% of the browser's 16px plus 0.2vw, between 100% and 137.5%.
const expected = [
	[390, 844, 16],
	[1440, 900, 16],
	[2560, 1440, 18.24],
	[3840, 2160, 20.8],
]

const measure = (page) =>
	page.evaluate(() => {
		const size = (element) => Number.parseFloat(globalThis.getComputedStyle(element).fontSize)
		const root = size(globalThis.document.documentElement)
		const prose = globalThis.document.querySelector('.meeko-ui-prose')
		const text = prose.querySelector(':scope > p')
		const character = globalThis.document.createElement('span')
		character.style.cssText = 'position: absolute; visibility: hidden; width: 75ch'
		text.append(character)
		const measure75 = character.getBoundingClientRect().width
		character.remove()
		const visible = (selector) => [...globalThis.document.querySelectorAll(selector)].find((element) => element.getBoundingClientRect().width > 0)
		const link = visible('.meeko-ui-nav-link')
		return {
			root,
			overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
			body: globalThis.document.querySelector('.meeko-ui-page-body').getBoundingClientRect().width,
			header: globalThis.document.querySelector('.meeko-ui-header-bar').getBoundingClientRect().width,
			prose: size(text),
			textWidth: text.getBoundingClientRect().width,
			measure75,
			navigation: link ? size(link) : undefined,
			control: visible('.meeko-ui-input')?.getBoundingClientRect().height,
		}
	})

test('the root grows with the screen, and everything in rem with it, without a horizontal scroll', { timeout: 180_000 }, async (context) => {
	const { browser, origin, output } = await startDemo(context)
	const page = await browser.newPage()
	for (const [width, height, root] of expected) {
		await page.setViewportSize({ width, height })
		await page.goto(origin + '/installation', { waitUntil: 'networkidle' })
		const sizes = await measure(page)
		assert.ok(Math.abs(sizes.root - root) < 0.05, `the root at ${width}: ${sizes.root}`)
		assert.equal(sizes.overflow, false, `horizontal scroll at ${width}`)
		// Reading text at 1rem, in a measure of 75ch; the page, on its token, or the whole screen.
		assert.ok(Math.abs(sizes.prose - sizes.root) < 0.05, `the prose at ${width}: ${sizes.prose}`)
		assert.ok(sizes.textWidth <= sizes.measure75 + 1, `the measure at ${width}: ${sizes.textWidth} of ${sizes.measure75}`)
		assert.ok(Math.abs(sizes.body - Math.min(96 * sizes.root, width)) < 1, `the page at ${width}: ${sizes.body}`)
		assert.ok(Math.abs(sizes.header - sizes.body) < 1, `the header follows the page at ${width}: ${sizes.header} and ${sizes.body}`)
		if (sizes.navigation !== undefined) assert.ok(sizes.navigation >= 0.875 * sizes.root - 0.05, `the navigation at ${width}: ${sizes.navigation}`)
		await page.screenshot({ path: `${output}/fluid-scale-${width}.png` })
	}
	await page.close()
})

test("the scale starts from the reader's font size, on every screen", { timeout: 180_000 }, async (context) => {
	const { origin } = await startDemo(context)
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true, args: ['--blink-settings=defaultFontSize=20'] })
	context.after(() => browser.close())
	const page = await browser.newPage()
	for (const [width, height, root] of [
		[390, 844, 20],
		[1440, 900, 20],
		[3840, 2160, 24.08],
	]) {
		await page.setViewportSize({ width, height })
		await page.goto(origin + '/installation', { waitUntil: 'networkidle' })
		const sizes = await measure(page)
		assert.ok(Math.abs(sizes.root - root) < 0.05, `the root at ${width} with 20px in the browser: ${sizes.root}`)
		assert.equal(sizes.overflow, false, `horizontal scroll at ${width} with 20px in the browser`)
	}
	await page.close()
})
