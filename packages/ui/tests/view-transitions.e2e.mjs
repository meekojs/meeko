import assert from 'node:assert/strict'
import test from 'node:test'

import { startDemo } from './helpers/demo.mjs'

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
	await page.getByRole('heading', { name: 'Detalle del proyecto.', exact: true }).waitFor()
	assert.equal(await count(), 1)
	await page.evaluate(() => globalThis.meekoViewTransitions.at(-1).ready)
	await page.screenshot({ path: output + '/view-transition-native.png', fullPage: true })
	await finished()
	assert.equal(await page.locator('.view-transition-demo-project').evaluate((element) => globalThis.getComputedStyle(element).viewTransitionName), 'ui-demo-project')
	await page.getByRole('link', { name: 'Volver a proyectos', exact: true }).click()
	await page.getByRole('heading', { name: 'De una vista al detalle.', exact: true }).waitFor()
	await finished()
	assert.equal(await count(), 2)
	await page.goBack()
	await page.getByRole('heading', { name: 'Detalle del proyecto.', exact: true }).waitFor()
	await finished()
	assert.equal(await count(), 3, 'popstate uses a native transition')
	await page.getByRole('link', { name: 'Volver sin transición', exact: true }).click()
	await page.getByRole('heading', { name: 'De una vista al detalle.', exact: true }).waitFor()
	assert.equal(await count(), 3, 'per-link opt-out skips the native API')
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.getByRole('link', { name: 'Ver proyecto', exact: true }).click()
	await page.getByRole('heading', { name: 'Detalle del proyecto.', exact: true }).waitFor()
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
	await fallback.getByRole('heading', { name: 'Detalle del proyecto.', exact: true }).waitFor()
	assert.equal(new URL(fallback.url()).pathname, '/transitions/project')
	assert.deepEqual(fallbackErrors, [])
})
