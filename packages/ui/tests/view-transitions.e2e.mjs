import assert from 'node:assert/strict'
import test from 'node:test'

import { startDemo } from './helpers/demo.mjs'

test('a page above the element limit does not animate, as the source or as the destination, and a normal one does', { timeout: 90_000 }, async (context) => {
	const { browser, origin } = await startDemo(context)
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.addInitScript(() => {
		const state = (globalThis.meekoLarge = { started: [], growInUpdate: false })
		const grow = () => {
			const block = globalThis.document.createElement('div')
			block.id = 'large-page'
			block.hidden = true
			block.append(...Array.from({ length: 4100 }, () => globalThis.document.createElement('i')))
			globalThis.document.body.append(block)
		}
		state.grow = grow
		const native = globalThis.Document.prototype.startViewTransition
		globalThis.Document.prototype.startViewTransition = function (argument) {
			const update = typeof argument === 'function' ? argument : argument.update
			// The new page arrives inside the callback, like the DOM of a long guide.
			const wrapped = () => {
				if (state.growInUpdate) grow()
				return update()
			}
			const transition = native.call(this, typeof argument === 'function' ? wrapped : { ...argument, update: wrapped })
			const record = { skipped: false, done: false }
			state.started.push(record)
			transition.ready.catch((error) => (record.skipped = error.name))
			void transition.finished.then(() => (record.done = true))
			return transition
		}
	})
	const started = () => page.evaluate(() => globalThis.meekoLarge.started.length)
	const settled = () => page.waitForFunction(() => globalThis.meekoLarge.started.every((record) => record.done))
	const themeButton = page.locator('[data-meeko-theme-toggle] button').first()
	// The label names what the button does next, so it changes with the theme.
	const changeTheme = async () => {
		const before = await themeButton.getAttribute('aria-label')
		await themeButton.click()
		await page.waitForFunction((before) => globalThis.document.querySelector('[data-meeko-theme-toggle] button').getAttribute('aria-label') !== before, before)
	}
	await page.goto(origin + '/transitions', { waitUntil: 'networkidle' })

	// A normal page animates the theme and a navigation.
	await changeTheme()
	await settled()
	assert.equal(await started(), 1, 'the theme animates on a normal page')
	await page.getByRole('link', { name: 'Ver proyecto', exact: true }).click()
	await page.getByRole('heading', { name: 'Un proyecto, dos vistas', exact: true }).waitFor()
	await settled()
	assert.equal(await started(), 2, 'a navigation animates between normal pages')
	assert.equal(await page.evaluate(() => globalThis.meekoLarge.started[1].skipped), false)

	// From a large page: neither the theme nor the navigation start a transition, and both still happen.
	await page.evaluate(() => globalThis.meekoLarge.grow())
	await changeTheme()
	assert.equal(await started(), 2, 'the theme does not animate on a large page')
	await page.getByRole('link', { name: 'Volver a proyectos', exact: true }).click()
	await page.getByRole('heading', { name: 'View Transitions', exact: true }).waitFor()
	assert.equal(await started(), 2, 'a navigation from a large page does not animate')
	await page.evaluate(() => globalThis.document.getElementById('large-page').remove())

	// To a large page: the transition starts on the short one and is skipped when the new content is in.
	await page.evaluate(() => (globalThis.meekoLarge.growInUpdate = true))
	await page.getByRole('link', { name: 'Ver proyecto', exact: true }).click()
	await page.getByRole('heading', { name: 'Un proyecto, dos vistas', exact: true }).waitFor()
	await settled()
	assert.equal(await started(), 3)
	assert.equal(await page.evaluate(() => globalThis.meekoLarge.started[2].skipped), 'AbortError', 'the animation is skipped, the navigation is not')
	assert.equal(new URL(page.url()).pathname, '/transitions/project')
	assert.equal(await page.evaluate(() => globalThis.document.getAnimations().filter((animation) => animation.effect.pseudoElement?.startsWith('::view-transition')).length), 0, 'no frame of the transition is left to paint')
	assert.deepEqual(errors, [])
})

test('native view transitions wrap client commits, history and shared elements with opt-out and reduced-motion fallbacks', { timeout: 90_000 }, async (context) => {
	const { browser, origin, output } = await startDemo(context)
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	await page.addInitScript(() => {
		globalThis.meekoViewTransitions = []
		const prototype = globalThis.Document.prototype
		const native = prototype.startViewTransition
		prototype.startViewTransition = function (update) {
			const transition = native.call(this, update)
			globalThis.meekoViewTransitions.push(transition)
			return transition
		}
	})
	const count = () => page.evaluate(() => globalThis.meekoViewTransitions.length)
	const finished = () => page.evaluate(() => Promise.all(globalThis.meekoViewTransitions.map((transition) => transition.finished)))
	await page.goto(origin + '/transitions', { waitUntil: 'networkidle' })
	assert.equal(await count(), 0, 'SSR hydration does not trigger a transition')
	await page.getByRole('link', { name: 'Ver proyecto', exact: true }).click()
	await page.getByRole('heading', { name: 'Un proyecto, dos vistas', exact: true }).waitFor()
	assert.equal(await count(), 1)
	await page.evaluate(() => globalThis.meekoViewTransitions.at(-1).ready)
	const transitionName = () => page.locator('.view-transition-demo-project').evaluate((element) => globalThis.getComputedStyle(element).viewTransitionName)
	assert.equal(await transitionName(), 'ui-demo-project', 'the card has its name during the navigation')
	await page.screenshot({ path: output + '/view-transition-native.png', fullPage: true })
	await finished()
	assert.equal(await transitionName(), 'none', 'and only during it: no other transition of the page repeats it')
	await page.getByRole('link', { name: 'Volver a proyectos', exact: true }).click()
	await page.getByRole('heading', { name: 'View Transitions', exact: true }).waitFor()
	await finished()
	assert.equal(await count(), 2)
	await page.goBack()
	await page.getByRole('heading', { name: 'Un proyecto, dos vistas', exact: true }).waitFor()
	await finished()
	assert.equal(await count(), 3, 'popstate uses a native transition')
	await page.getByRole('link', { name: 'Volver sin transición', exact: true }).click()
	await page.getByRole('heading', { name: 'View Transitions', exact: true }).waitFor()
	assert.equal(await count(), 3, 'per-link opt-out skips the native API')
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.getByRole('link', { name: 'Ver proyecto', exact: true }).click()
	await page.getByRole('heading', { name: 'Un proyecto, dos vistas', exact: true }).waitFor()
	assert.equal(await count(), 3, 'reduced motion skips the native API')
	await page.setViewportSize({ width: 390, height: 844 })
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	await page.screenshot({ path: output + '/view-transition-mobile.png', fullPage: true })
	assert.deepEqual(errors, [])
	const fallback = await browser.newPage()
	const fallbackErrors = []
	fallback.on('pageerror', (error) => fallbackErrors.push(error.message))
	await fallback.addInitScript(() => {
		globalThis.Document.prototype.startViewTransition = undefined
	})
	await fallback.goto(origin + '/transitions', { waitUntil: 'networkidle' })
	await fallback.getByRole('link', { name: 'Ver proyecto', exact: true }).click()
	await fallback.getByRole('heading', { name: 'Un proyecto, dos vistas', exact: true }).waitFor()
	assert.equal(new URL(fallback.url()).pathname, '/transitions/project')
	assert.deepEqual(fallbackErrors, [])
})
