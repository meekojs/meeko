import assert from 'node:assert/strict'
import test from 'node:test'

import { startDemo } from './helpers/demo.mjs'

/** The accessible name and description that Chromium computes for the element of `selector`. */
async function accessible(page, selector) {
	const client = await page.context().newCDPSession(page)
	try {
		const { root } = await client.send('DOM.getDocument', { depth: 0 })
		const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector })
		const { nodes } = await client.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })
		const node = nodes.find((entry) => !entry.ignored) ?? nodes[0]
		return { role: node.role?.value, name: node.name?.value ?? '', description: node.description?.value ?? '' }
	} finally {
		await client.detach()
	}
}

const tooltipText = (page, selector) => page.locator(selector).evaluate((element) => globalThis.document.getElementById(element.getAttribute('interestfor')).textContent)
const isOpen = (page, selector) => page.locator(selector).evaluate((element) => globalThis.document.getElementById(element.getAttribute('interestfor')).matches(':popover-open'))

test('UIIconButton and UIHint render without JavaScript, and they are named, described, focused and opened in Chromium', { timeout: 120_000 }, async (context) => {
	const { browser, origin, output } = await startDemo(context)

	// Without JavaScript: the markup of the server already names the actions and links the routes.
	const ssr = await browser.newPage({ javaScriptEnabled: false })
	await ssr.goto(`${origin}/buttons`)
	const icons = ssr.locator('#icon-buttons')
	assert.equal(await icons.getByRole('button', { name: 'Abrir el menú', exact: true }).count(), 1)
	assert.equal(await icons.getByRole('link', { name: 'Ver enlaces', exact: true }).getAttribute('href'), '/links')
	assert.equal(await ssr.locator('#icon-button-pin').getAttribute('aria-pressed'), 'false')
	await ssr.goto(`${origin}/overlays`)
	assert.equal(await ssr.locator('#hint-revenue').getByRole('button', { name: 'Más información', exact: true }).count(), 1)
	await ssr.close()

	// Reduced motion: the colours do not transition, so a computed style is the final one.
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	await page.goto(`${origin}/buttons`, { waitUntil: 'networkidle' })

	// The name is the label, and the tooltip that repeats it is not a description as well.
	assert.deepEqual(await accessible(page, '#icon-button-menu'), { role: 'button', name: 'Abrir el menú', description: '' })
	assert.equal(await tooltipText(page, '#icon-button-menu'), 'Abrir el menú')
	// The focus of the keyboard opens the tooltip, and Escape closes it without moving the focus.
	await page.locator('#icon-button-menu').focus()
	await page.waitForFunction(() => globalThis.document.getElementById(globalThis.document.getElementById('icon-button-menu').getAttribute('interestfor')).matches(':popover-open'))
	await page.keyboard.press('Escape')
	await page.waitForFunction(() => !globalThis.document.getElementById(globalThis.document.getElementById('icon-button-menu').getAttribute('interestfor')).matches(':popover-open'))
	assert.equal(await page.evaluate(() => globalThis.document.activeElement?.id), 'icon-button-menu')
	// The pointer opens it too.
	const close = page.locator('#icon-buttons').getByRole('button', { name: 'Cerrar', exact: true })
	await close.hover()
	await page.waitForFunction(() => [...globalThis.document.querySelectorAll('[role="tooltip"]')].some((tip) => tip.textContent === 'Cerrar' && tip.matches(':popover-open')))
	// The keyboard activates it, and the square keeps the size of the control.
	const confirm = page.locator('#icon-buttons').getByRole('button', { name: 'Confirmar', exact: true })
	await confirm.focus()
	await page.keyboard.press('Enter')
	await page.keyboard.press('Space')
	assert.match(await page.locator('#icon-button-status').innerText(), /2/)
	const box = await confirm.boundingBox()
	assert.equal(Math.round(box.width), Math.round(box.height), 'an icon button is square')

	// A toggle: aria-pressed and its look follow the model.
	const pin = page.locator('#icon-button-pin')
	const background = () => pin.evaluate((element) => globalThis.getComputedStyle(element).backgroundColor)
	await page.mouse.move(0, 0)
	const off = await background()
	await pin.click()
	assert.equal(await pin.getAttribute('aria-pressed'), 'true')
	await page.mouse.move(0, 0)
	assert.notEqual(await background(), off, 'a pressed toggle looks pressed')
	assert.deepEqual(await accessible(page, '#icon-button-pin'), { role: 'button', name: 'Fijar el panel', description: '' })
	await pin.press('Enter')
	assert.equal(await pin.getAttribute('aria-pressed'), 'false')
	// Busy: focusable, announced, with the spinner instead of the icon; disabled: native.
	const states = page.locator('#icon-button-states-preview')
	const saving = states.getByRole('button', { name: 'Guardando', exact: true })
	assert.equal(await saving.getAttribute('aria-busy'), 'true')
	assert.equal(await saving.locator('svg').evaluate((element) => globalThis.getComputedStyle(element).display), 'none')
	assert.equal(await states.getByRole('button', { name: 'Archivar (no disponible)', exact: true }).isDisabled(), true)
	// Without a tooltip, the name is still the label.
	const bare = states.getByRole('button', { name: 'Sin tooltip', exact: true })
	assert.equal(await bare.getAttribute('interestfor'), null)
	await page.locator('#icon-buttons').screenshot({ path: output + '/icon-button-light.png' })
	// A route navigates on the client.
	await page.locator('#icon-buttons').getByRole('link', { name: 'Ver enlaces', exact: true }).click()
	await page.waitForURL(`${origin}/links`)

	// UIHint, inside a heading and inside a paragraph.
	await page.goto(`${origin}/overlays`, { waitUntil: 'networkidle' })
	const revenue = page.locator('#hint-revenue button')
	const revenueId = await revenue.getAttribute('id')
	const named = await accessible(page, `[id="${revenueId}"]`)
	assert.deepEqual(named, { role: 'button', name: 'Más información', description: 'Importe cobrado, sin impuestos ni devoluciones.' })
	// Its icon is the size of the text of the heading, and it sits on the line of the text.
	const sizes = await page.locator('#hint-revenue').evaluate((heading) => {
		const icon = heading.querySelector('button svg').getBoundingClientRect()
		return { font: parseFloat(globalThis.getComputedStyle(heading).fontSize), width: icon.width, height: icon.height }
	})
	assert.ok(Math.abs(sizes.width - sizes.font) < 0.5 && Math.abs(sizes.height - sizes.font) < 0.5, JSON.stringify(sizes))
	const paragraph = await page.locator('#hint-margin').evaluate((button) => {
		const text = parseFloat(globalThis.getComputedStyle(button.parentElement).fontSize)
		const icon = button.querySelector('svg').getBoundingClientRect().width
		const line = button.parentElement.getBoundingClientRect().height
		return { text, icon, line, lineHeight: parseFloat(globalThis.getComputedStyle(button.parentElement).lineHeight) }
	})
	assert.ok(Math.abs(paragraph.icon - paragraph.text) < 0.5, JSON.stringify(paragraph))
	assert.ok(paragraph.line <= paragraph.lineHeight + 0.5, `the hint does not make its line taller: ${JSON.stringify(paragraph)}`)
	// Tab reaches it and opens the help; a press opens it as well, for touch.
	await page.locator('#hint-revenue').evaluate((heading) => heading.previousElementSibling?.focus?.())
	await revenue.focus()
	await page.waitForFunction((id) => globalThis.document.getElementById(globalThis.document.getElementById(id).getAttribute('interestfor')).matches(':popover-open'), revenueId)
	await page.keyboard.press('Escape')
	await page.waitForFunction((id) => !globalThis.document.getElementById(globalThis.document.getElementById(id).getAttribute('interestfor')).matches(':popover-open'), revenueId)
	await page.locator('#hint-margin').click()
	await page.waitForFunction(() => globalThis.document.getElementById(globalThis.document.getElementById('hint-margin').getAttribute('interestfor')).matches(':popover-open'))
	assert.equal(await isOpen(page, '#hint-margin'), true)
	assert.equal((await accessible(page, '#hint-margin')).description, 'Ingresos menos los costes directos')
	await page.locator('#hint-preview').screenshot({ path: output + '/hint-light.png' })

	// Dark and phone: nothing overflows.
	await page.setViewportSize({ width: 390, height: 844 })
	await page.evaluate(() => {
		globalThis.document.documentElement.dataset.theme = 'dark'
	})
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	await page.locator('#hint-preview').screenshot({ path: output + '/hint-mobile-dark.png' })
	await page.goto(`${origin}/buttons`, { waitUntil: 'networkidle' })
	await page.evaluate(() => {
		globalThis.document.documentElement.dataset.theme = 'dark'
	})
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	await page.locator('#icon-button-states-preview').screenshot({ path: output + '/icon-button-mobile-dark.png' })

	// The texts follow the language of the document.
	await page.goto(`${origin}/en/overlays`, { waitUntil: 'networkidle' })
	assert.equal((await accessible(page, '#hint-revenue button')).name, 'More information')
	assert.deepEqual(errors, [])
})
