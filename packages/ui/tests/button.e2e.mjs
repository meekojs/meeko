import assert from 'node:assert/strict'
import test from 'node:test'

import { startDemo } from './helpers/demo.mjs'

/** The opening tag of the element with the given id in the HTML. */
function openingTag(html, id) {
	const tag = html.match(new RegExp(`<(a|button)\\b[^>]*\\bid="${id}"[^>]*>`))?.[0]
	assert.ok(tag, `no element #${id}`)
	return tag
}

/** The attributes of an opening tag, without the ones Meeko adds. */
function attributes(tag) {
	return Object.fromEntries([...tag.matchAll(/\s([a-z-]+)(?:="([^"]*)")?/g)].filter(([, name]) => !name.startsWith('data-meeko')).map(([, name, value]) => [name, value ?? '']))
}

/** What the three kinds must share: everything that is seen, but the width of their text. */
const lookProperties = ['display', 'alignItems', 'justifyContent', 'boxSizing', 'marginTop', 'marginLeft', 'paddingTop', 'paddingLeft', 'paddingRight', 'paddingBottom', 'minHeight', 'height', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRadius', 'backgroundColor', 'color', 'opacity', 'cursor', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textAlign', 'textDecorationLine', 'textTransform', 'textIndent', 'textShadow', 'whiteSpace', 'verticalAlign', 'outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset', 'transitionProperty', 'transitionDuration']

const kinds = ['#button-kind-route', '#button-kind-anchor', '#button-kind-button']

async function looks(page) {
	return page.evaluate(
		({ selectors, properties }) =>
			selectors.map((selector) => {
				const element = globalThis.document.querySelector(selector)
				const css = globalThis.getComputedStyle(element)
				return Object.fromEntries([...properties.map((name) => [name, css[name]]), ['boxHeight', element.getBoundingClientRect().height]])
			}),
		{ selectors: kinds, properties: lookProperties },
	)
}

function assertSameLook(styles, state) {
	const [route, anchor, button] = styles
	assert.deepEqual(route, button, `${state}: the route looks like the button`)
	assert.deepEqual(anchor, button, `${state}: the link looks like the button`)
}

test('UIButton renders a route, a link or a button with the same look, roles, focus and click', { timeout: 120_000 }, async (context) => {
	const { browser, origin } = await startDemo(context)

	// SSR: each kind is its element, with only its own attributes.
	const html = await (await fetch(`${origin}/buttons`)).text()
	const route = attributes(openingTag(html, 'button-kind-route'))
	assert.match(openingTag(html, 'button-kind-route'), /^<a\b/)
	assert.equal(route.href, '/links')
	assert.equal(route.class, 'meeko-ui-button')
	assert.deepEqual([route['data-variant'], route['data-size'], route['data-shape']], ['primary', 'md', 'rounded'])
	for (const name of ['type', 'disabled', 'target', 'rel']) assert.ok(!(name in route), `the route has no ${name}`)
	const anchor = attributes(openingTag(html, 'button-kind-anchor'))
	assert.match(openingTag(html, 'button-kind-anchor'), /^<a\b/)
	assert.equal(anchor.href, 'https://github.com/meekojs/meeko')
	assert.equal(anchor.target, '_blank')
	assert.equal(anchor.rel, 'noopener noreferrer')
	assert.equal(anchor.class, 'meeko-ui-button')
	for (const name of ['type', 'disabled']) assert.ok(!(name in anchor), `the link has no ${name}`)
	const button = attributes(openingTag(html, 'button-kind-button'))
	assert.match(openingTag(html, 'button-kind-button'), /^<button\b/)
	assert.equal(button.type, 'button')
	assert.equal(button.class, 'meeko-ui-button')
	for (const name of ['href', 'target', 'rel', 'disabled']) assert.ok(!(name in button), `the button has no ${name}`)
	// UILink keeps its look with `to` and with `href`.
	const links = await (await fetch(`${origin}/links`)).text()
	assert.match(openingTag(links, 'link-route'), /^<a\b/)
	assert.equal(attributes(openingTag(links, 'link-route')).href, '/installation')
	assert.equal(attributes(openingTag(links, 'link-route')).class, 'meeko-ui-button meeko-ui-link')
	assert.equal(attributes(openingTag(links, 'link-anchor')).href, '/theming')

	const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: 'light' })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	await page.goto(`${origin}/buttons`, { waitUntil: 'networkidle' })
	const group = page.locator('#button-kinds')

	// Accessibility: two links and a button, by their names, in the tab order.
	assert.equal(await group.getByRole('link', { name: 'Ver enlaces', exact: true }).count(), 1)
	assert.equal(await group.getByRole('link', { name: 'GitHub', exact: true }).count(), 1)
	assert.equal(await group.getByRole('button', { name: 'Acción', exact: true }).count(), 1)
	assert.equal(await group.getByRole('button').count(), 1)

	// At rest, under the docs' own `a` and `a:hover` rules, the three look the same.
	assertSameLook(await looks(page), 'rest')

	// Focus: the keyboard reaches each one and draws the same ring.
	await page.locator('#button-kind-route').focus()
	const focused = []
	for (const selector of kinds) {
		if (selector !== kinds[0]) await page.keyboard.press('Tab')
		focused.push(await page.evaluate((selector) => globalThis.document.activeElement === globalThis.document.querySelector(selector) && globalThis.document.activeElement.matches(':focus-visible'), selector))
	}
	assert.deepEqual(focused, [true, true, true])
	const ring = await page.evaluate(
		(selectors) =>
			selectors.map((selector) => {
				const element = globalThis.document.querySelector(selector)
				element.focus()
				const css = globalThis.getComputedStyle(element)
				return [css.outlineStyle, css.outlineWidth, css.outlineColor, css.outlineOffset]
			}),
		kinds,
	)
	assert.notEqual(ring[0][0], 'none')
	assert.deepEqual(ring[0], ring[2])
	assert.deepEqual(ring[1], ring[2])
	await page.evaluate(() => globalThis.document.activeElement.blur())

	// Hover: the same background and text colour, which differ from the resting ones.
	const rest = (await looks(page))[2]
	const hovered = []
	for (const selector of kinds) {
		await page.hover(selector)
		await page.waitForTimeout(250)
		hovered.push(
			await page.evaluate((selector) => {
				const css = globalThis.getComputedStyle(globalThis.document.querySelector(selector))
				return { background: css.backgroundColor, color: css.color, decoration: css.textDecorationLine }
			}, selector),
		)
	}
	await page.mouse.move(0, 0)
	assert.notEqual(hovered[2].background, rest.backgroundColor)
	assert.deepEqual(hovered[0], hovered[2])
	assert.deepEqual(hovered[1], hovered[2])

	// on:click reaches the parent from the three. The links are held back (an app handler can do
	// the same with event.preventDefault()), so the page stays.
	await page.evaluate(() => {
		globalThis.__holdLinks = (event) => {
			if (event.target.closest('#button-kinds a')) event.preventDefault()
		}
		globalThis.document.addEventListener('click', globalThis.__holdLinks, true)
	})
	for (const selector of kinds) await page.click(selector)
	assert.match(await page.locator('#button-kinds-status').innerText(), /3/)
	assert.equal(new URL(page.url()).pathname, '/buttons')
	await page.evaluate(() => globalThis.document.removeEventListener('click', globalThis.__holdLinks, true))

	// The disabled state belongs to the button.
	const disabled = page.getByRole('button', { name: 'No disponible', exact: true })
	assert.ok(await disabled.isDisabled())
	assert.equal(await disabled.evaluate((element) => globalThis.getComputedStyle(element).opacity), '0.55')

	// `to` navigates on the client: the document (and this marker) survives.
	await page.evaluate(() => {
		globalThis.__sameDocument = true
	})
	await page.click('#button-kind-route')
	await page.waitForURL(`${origin}/links`)
	await page.locator('#link-route').waitFor()
	assert.equal(await page.evaluate(() => globalThis.__sameDocument), true)
	// So does UILink with `to`.
	await page.click('#link-route')
	await page.waitForURL(`${origin}/installation`)
	assert.equal(await page.evaluate(() => globalThis.__sameDocument), true)
	assert.deepEqual(errors, [])
})
