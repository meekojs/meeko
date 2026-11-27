import assert from 'node:assert/strict'
import test from 'node:test'

import { startDemo } from './helpers/demo.mjs'

/** The role and accessible name that Chromium computes for the element of `selector`. */
async function accessible(page, selector) {
	const client = await page.context().newCDPSession(page)
	try {
		const { root } = await client.send('DOM.getDocument', { depth: 0 })
		const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector })
		const { nodes } = await client.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })
		const node = nodes.find((entry) => !entry.ignored) ?? nodes[0]
		return { role: node.role?.value, name: node.name?.value ?? '' }
	} finally {
		await client.detach()
	}
}

/** The boxes of the parts of the stat number `index` of `group`. */
const layout = (page, group, index) =>
	page
		.locator(`#${group} > dl`)
		.nth(index)
		.evaluate((stat) => {
			const box = (element) => {
				const { left, top, right, bottom, width, height } = element.getBoundingClientRect()
				return { left, top, right, bottom, width, height }
			}
			const value = stat.querySelector('dt + dd')
			const change = [...stat.querySelectorAll('dd')].find((dd) => dd.querySelector('.sr-only'))
			const trend = [...stat.querySelectorAll('dd')].find((dd) => dd.querySelector('svg[role="img"]'))
			const svg = trend?.querySelector('svg')
			const line = svg?.querySelector('path:last-child')
			return {
				stat: box(stat),
				value: box(value),
				valueSize: globalThis.getComputedStyle(value).fontSize,
				change: change && box(change),
				trend: trend && box(trend),
				svg: svg && box(svg),
				stroke: line && globalThis.getComputedStyle(line).strokeWidth,
				animation: svg && globalThis.getComputedStyle(svg).animationName,
				container: globalThis.getComputedStyle(stat).containerType,
				rem: parseFloat(globalThis.getComputedStyle(globalThis.document.documentElement).fontSize),
			}
		})

test('UIStat as a key figure and UISparkline: SSR without JavaScript, compact by the width of the stat, named and focusable in Chromium', { timeout: 120_000 }, async (context) => {
	const { browser, origin } = await startDemo(context)

	// Without JavaScript: the server already names the change, the trend and the link, and sizes the sparkline.
	const ssr = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } })
	await ssr.goto(`${origin}/content`)
	const wide = ssr.locator('#kpi-wide')
	assert.equal(await wide.getByRole('link', { name: 'Ver detalle: Ingresos', exact: true }).getAttribute('href'), '/tables')
	assert.equal(await wide.getByRole('img', { name: 'Tendencia: mínimo 8,2, máximo 12,4, último 12,4', exact: true }).count(), 1)
	assert.equal(await wide.locator('.sr-only').first().textContent(), 'Sube 12,5\u00a0%')
	const before = await layout(ssr, 'kpi-wide', 0)
	assert.equal(before.svg.height, 2 * before.rem, 'the height of --ui-sparkline-height comes from CSS')
	await ssr.close()

	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	await page.goto(`${origin}/content`, { waitUntil: 'networkidle' })

	// Wide (the stat is wider than 20rem): the sparkline goes beside the value, as wide as its token.
	const large = await layout(page, 'kpi-wide', 0)
	assert.equal(large.container, 'inline-size')
	assert.ok(large.stat.width >= 20 * large.rem, `a wide stat: ${large.stat.width}`)
	assert.deepEqual(large.svg, before.svg, 'hydration does not move the sparkline')
	assert.equal(large.trend.width, 7 * large.rem, 'the width of --ui-stat-trend-width')
	assert.ok(large.trend.left > large.value.right - 1, 'beside the value')
	assert.ok(large.trend.top < large.value.bottom && large.trend.bottom > large.value.top, 'on the row of the value')
	assert.ok(large.trend.right <= large.stat.right + 0.5, 'inside the stat')
	assert.equal(large.stroke, '1.5px', 'the stroke keeps its width when the box stretches')
	assert.equal(large.animation, 'ui-sparkline-draw')

	// Compact (each stat of the row of three is narrower than 20rem): the same viewport, another layout.
	const small = await layout(page, 'kpi-compact', 0)
	assert.ok(small.stat.width < 20 * small.rem, `a narrow stat: ${small.stat.width}`)
	assert.ok(small.trend.top >= small.change.bottom - 0.5, 'under the change')
	assert.equal(Math.round(small.trend.width), Math.round(small.stat.width), 'as wide as the stat')
	assert.ok(small.svg.right <= small.stat.right + 0.5, 'without overflowing')
	assert.ok(parseFloat(small.valueSize) < parseFloat(large.valueSize), `a smaller value: ${small.valueSize} < ${large.valueSize}`)

	// The tones: up is good by default, down is good with good="down", and zero is neutral.
	const tones = await page.locator('#kpi-wide > dl').evaluateAll((stats) => stats.map((stat) => globalThis.getComputedStyle(stat.querySelector('.sr-only').parentElement).color))
	const expected = await page.evaluate(() =>
		['--ui-color-success-text', '--ui-color-success-text', '--ui-color-text'].map((name) => {
			const probe = globalThis.document.createElement('span')
			probe.style.color = `var(${name})`
			globalThis.document.body.append(probe)
			const color = globalThis.getComputedStyle(probe).color
			probe.remove()
			return color
		}),
	)
	assert.deepEqual(tones, expected)
	assert.equal(await page.locator('#kpi-wide .sr-only').nth(1).textContent(), 'Baja 8\u00a0%')
	assert.equal(await page.locator('#kpi-wide .sr-only').nth(2).textContent(), 'Sin cambios')

	// The names that Chromium computes, and the link reached with the keyboard with a visible ring.
	assert.deepEqual(await accessible(page, '#sparkline-visits svg'), { role: 'image', name: 'Tendencia: mínimo 1200, máximo 1890, último 1890' })
	assert.deepEqual(await accessible(page, '#kpi-compact > dl:nth-child(3) a'), { role: 'link', name: 'Ver las altas' })
	const link = page.locator('#kpi-wide').getByRole('link', { name: 'Ver detalle: Ingresos' })
	await link.focus()
	await page.keyboard.press('Shift+Tab')
	await page.keyboard.press('Tab')
	assert.equal(await link.evaluate((element) => element === globalThis.document.activeElement && element.matches(':focus-visible')), true)
	assert.notEqual(await link.evaluate((element) => globalThis.getComputedStyle(element).outlineStyle), 'none')
	// A route: the click navigates in the client.
	await link.click()
	await page.waitForURL(`${origin}/tables`)

	// In a row of flex items that gives it no width, a key figure keeps its intrinsic width instead of collapsing.
	await page.goto(`${origin}/content`, { waitUntil: 'networkidle' })
	const flexWidth = await page
		.locator('#kpi-wide > dl')
		.first()
		.evaluate((stat) => {
			const row = globalThis.document.createElement('div')
			row.style.display = 'flex'
			stat.before(row)
			row.append(stat)
			return stat.getBoundingClientRect().width / parseFloat(globalThis.getComputedStyle(globalThis.document.documentElement).fontSize)
		})
	assert.equal(flexWidth, 12, 'the width of --ui-stat-intrinsic-width, in rem')

	// On a phone, nothing overflows the page.
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(`${origin}/content`, { waitUntil: 'networkidle' })
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	await page.close()

	// Reduced motion: the line does not draw itself.
	const calm = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
	await calm.goto(`${origin}/content`, { waitUntil: 'networkidle' })
	assert.equal((await layout(calm, 'kpi-wide', 0)).animation, 'none')
	await calm.close()

	// In English, the texts and the numbers of English.
	const english = await browser.newPage({ viewport: { width: 1280, height: 900 } })
	await english.goto(`${origin}/en/content`, { waitUntil: 'networkidle' })
	assert.equal(await english.locator('#kpi-wide .sr-only').first().textContent(), 'Up 12.5%')
	assert.equal(await english.locator('#kpi-wide').getByRole('link', { name: 'View details: Revenue', exact: true }).getAttribute('href'), '/en/tables')
	assert.equal(await english.locator('#kpi-wide').getByRole('img', { name: 'Trend: minimum 8.2, maximum 12.4, latest 12.4', exact: true }).count(), 1)
	await english.close()

	assert.deepEqual(errors, [])
})
