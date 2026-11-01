import assert from 'node:assert/strict'
import test from 'node:test'

// The UI documentation site registers @meekojs/icon; its helper runs `meeko dev` of apps/ui and Chrome.
import { startDemo } from '../../ui/tests/helpers/demo.mjs'

/** What Chrome paints for each icon of the page. */
function icons(page) {
	return page.evaluate(() =>
		[...globalThis.document.querySelectorAll('main svg.meeko-icon')].map((svg) => {
			const box = svg.getBoundingClientRect()
			const shape = svg.querySelector('path, circle, ellipse, rect, line, polyline, polygon')
			const paint = shape ? globalThis.getComputedStyle(shape) : undefined
			return {
				name: svg.dataset.icon,
				width: box.width,
				height: box.height,
				color: globalThis.getComputedStyle(svg).color,
				paint: paint && (paint.stroke !== 'none' ? paint.stroke : paint.fill),
				hidden: svg.getAttribute('aria-hidden'),
				role: svg.getAttribute('role'),
				label: svg.getAttribute('aria-label'),
				style: svg.hasAttribute('style'),
				viewBox: svg.viewBox.baseVal ? `${svg.viewBox.baseVal.width}x${svg.viewBox.baseVal.height}` : null,
			}
		}),
	)
}

test('UIIcon on the UI site: visible in light and dark, accessible label, client navigation and no CSP violations', { timeout: 180_000 }, async (context) => {
	const { browser, origin, output } = await startDemo(context)
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
	const problems = []
	page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
	page.on('console', (message) => {
		if (message.type() === 'error' || /Content Security Policy|\[@meekojs\/icon\]/i.test(message.text())) problems.push(`${message.type()}: ${message.text()}`)
	})
	await page.addInitScript(() => {
		globalThis.addEventListener('securitypolicyviolation', (event) => console.error(`Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`))
	})

	// SSR: the icons are in the HTML, without inline styles.
	const html = await (await fetch(`${origin}/icons`)).text()
	const main = /<main[\s\S]*<\/main>/.exec(html)[0]
	assert.match(main, /<svg[^>]*data-icon="lucide:search"[^>]*>/)
	assert.match(main, /<svg[^>]*role="img"[^>]*aria-label="Eliminar"[^>]*data-icon="lucide:trash-2"/)
	assert.doesNotMatch(main.match(/<svg\b[^>]*class="meeko-icon[^>]*>/g).join(''), /style=/)

	// Client navigation from another guide keeps the icons and their attributes.
	await page.goto(`${origin}/badges`, { waitUntil: 'networkidle' })
	await page.evaluate(() => {
		globalThis.iconNavigationMarker = 'kept'
	})
	await page.getByRole('navigation', { name: 'Documentación de UI', exact: true }).getByRole('link', { name: 'Icon', exact: true }).click()
	await page.getByRole('heading', { name: 'Icon', exact: true, level: 1 }).waitFor()
	assert.equal(await page.evaluate(() => globalThis.iconNavigationMarker), 'kept', 'the guide opens with client navigation')

	const colors = {}
	for (const theme of ['light', 'dark']) {
		await page.evaluate((value) => {
			globalThis.document.documentElement.dataset.theme = value
		}, theme)
		const painted = await icons(page)
		assert.ok(painted.length >= 8, JSON.stringify(painted))
		for (const icon of painted) {
			assert.ok(icon.width > 0 && icon.height > 0, `${icon.name} is visible in ${theme}`)
			assert.equal(icon.paint, icon.color, `${icon.name} paints with currentColor in ${theme}`)
			assert.equal(icon.style, false)
			assert.ok(icon.viewBox && icon.viewBox !== '0x0', `${icon.name} keeps its viewBox`)
		}
		colors[theme] = painted.find((icon) => icon.name === 'lucide:search').color
		// After the view transition of the navigation, the first screen of the guide.
		await page.evaluate(() => globalThis.document.getAnimations().map((animation) => animation.finished.catch(() => {})))
		await page.waitForTimeout(400)
		await page.screenshot({ path: `${output}/icons-${theme}.png` })
	}
	assert.notEqual(colors.light, colors.dark, 'the icon follows the text color of each theme')

	// Accessibility: decorative by default, named with label.
	const painted = await icons(page)
	const search = painted.find((icon) => icon.name === 'lucide:search')
	assert.deepEqual([search.hidden, search.role, search.label], ['true', null, null])
	assert.equal(await page.getByRole('img', { name: 'Eliminar', exact: true }).count(), 1)
	assert.equal(await page.getByRole('img', { name: 'Meeko', exact: true }).count(), 1)

	// Dynamic names: literals of the expression and icons of icon.include.
	const menu = page.getByRole('button', { name: 'Abrir menú', exact: true })
	assert.equal(await menu.locator('svg').getAttribute('data-icon'), 'lucide:menu')
	await menu.click()
	const close = page.getByRole('button', { name: 'Cerrar menú', exact: true })
	await close.waitFor()
	assert.equal(await close.locator('svg').getAttribute('data-icon'), 'lucide:x')
	assert.ok((await close.locator('svg path').count()) > 0)
	const mode = page.getByRole('button', { name: 'Modo claro', exact: true })
	await mode.click()
	const dark = page.getByRole('button', { name: 'Modo oscuro', exact: true })
	await dark.waitFor()
	assert.equal(await dark.locator('svg').getAttribute('data-icon'), 'lucide:moon')
	assert.ok((await dark.locator('svg path').count()) > 0, 'an icon of icon.include renders after a change')

	assert.deepEqual(problems, [])
})
