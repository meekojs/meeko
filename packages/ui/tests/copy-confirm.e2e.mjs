import assert from 'node:assert/strict'
import test from 'node:test'

import { icons } from '../dist/app/utils/icons.js'
import { startDemo } from './helpers/demo.mjs'

/** Collects the errors of a page, which must stay empty. */
function watch(page) {
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`)
	})
	return errors
}

test('UICopyButton waits hidden without JavaScript, copies, announces the result, recovers and reports a failure', { timeout: 120_000 }, async (context) => {
	const { browser, origin } = await startDemo(context)

	// Without JavaScript it cannot copy: it is in the markup, hidden, and the status region is empty.
	const ssr = await browser.newPage({ javaScriptEnabled: false })
	await ssr.goto(`${origin}/buttons`)
	assert.equal(await ssr.locator('#copy-button-text').evaluate((element) => globalThis.getComputedStyle(element).visibility), 'hidden')
	assert.equal(await ssr.locator('#copy-button-text').getAttribute('data-copy-state'), 'idle')
	await ssr.close()

	const browserContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
	context.after(() => browserContext.close())
	await browserContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
	const page = await browserContext.newPage()
	const errors = watch(page)
	await page.goto(`${origin}/buttons`, { waitUntil: 'networkidle' })
	const text = page.locator('#copy-button-text')
	await page.waitForFunction(() => globalThis.getComputedStyle(globalThis.document.getElementById('copy-button-text')).visibility === 'visible')
	assert.equal((await text.textContent()).trim(), 'Copiar')
	const status = page.locator('#copy-button-text + [role="status"]')
	assert.equal(await status.textContent(), '')

	// A copy: the clipboard, the state, the text, the announcement and the event.
	const idleColor = await text.evaluate((element) => globalThis.getComputedStyle(element).color)
	await text.click()
	await page.waitForFunction(() => globalThis.document.getElementById('copy-button-text').dataset.copyState === 'copied')
	assert.equal(await page.evaluate(() => globalThis.navigator.clipboard.readText()), 'pnpm add @meekojs/ui')
	assert.equal((await text.textContent()).trim(), 'Copiado')
	assert.equal(await status.textContent(), 'Copiado')
	assert.match(await page.locator('#copy-button-status').textContent(), /Copias en este ejemplo: 1/)
	const copiedColor = await text.evaluate((element) => globalThis.getComputedStyle(element).color)
	const successText = await page.evaluate(() => {
		const probe = globalThis.document.createElement('span')
		probe.style.color = 'var(--ui-copy-button-copied-color)'
		globalThis.document.body.append(probe)
		const color = globalThis.getComputedStyle(probe).color
		probe.remove()
		return color
	})
	assert.equal(copiedColor, successText, 'the result takes its token')
	assert.notEqual(copiedColor, idleColor)
	// After the feedback time it goes back, and the region is empty again for the next announcement.
	await page.waitForFunction(() => globalThis.document.getElementById('copy-button-text').dataset.copyState === 'idle', undefined, { timeout: 5000 })
	assert.equal((await text.textContent()).trim(), 'Copiar')
	assert.equal(await status.textContent(), '')

	// Icon only: the name stays, the icon turns into the check mark and the region says the result.
	const icon = page.locator('#copy-button-icon')
	assert.equal(await icon.getAttribute('aria-label'), 'Copiar el token')
	assert.equal(await icon.locator('path').getAttribute('d'), icons.copy)
	await icon.click()
	await page.waitForFunction(() => globalThis.document.getElementById('copy-button-icon').dataset.copyState === 'copied')
	assert.equal(await icon.getAttribute('aria-label'), 'Copiar el token')
	assert.equal(await icon.locator('path').getAttribute('d'), icons.check)
	assert.equal(await page.evaluate(() => globalThis.navigator.clipboard.readText()), 'sk_test_4f8a')
	assert.match(await page.locator('#copy-button-status').textContent(), /Copias en este ejemplo: 2/)

	// A copy that the browser refuses: the failure is shown and announced, and no copy is counted.
	await page.evaluate(() => {
		globalThis.navigator.clipboard.writeText = () => Promise.reject(new Error('denied'))
	})
	await page.waitForFunction(() => globalThis.document.getElementById('copy-button-text').dataset.copyState === 'idle', undefined, { timeout: 5000 })
	await text.click()
	await page.waitForFunction(() => globalThis.document.getElementById('copy-button-text').dataset.copyState === 'failed')
	assert.equal((await text.textContent()).trim(), 'No se pudo copiar')
	assert.equal(await status.textContent(), 'No se pudo copiar')
	assert.match(await page.locator('#copy-button-status').textContent(), /Copias en este ejemplo: 2/)
	assert.deepEqual(errors, [])
})

test('useModal().confirm() resolves true only when accepted, false on Cancel, Esc, the close button and the backdrop', { timeout: 120_000 }, async (context) => {
	const { browser, origin } = await startDemo(context)
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
	const errors = watch(page)
	await page.goto(`${origin}/modals`, { waitUntil: 'networkidle' })
	const status = page.locator('#confirm-status')
	const dialog = () => page.locator('dialog[open]')
	const closed = () => page.waitForFunction(() => globalThis.document.querySelectorAll('dialog[open]').length === 0)
	const open = async (id, title) => {
		await page.locator(id).click()
		await page.getByRole('dialog', { name: title, exact: true }).waitFor()
	}

	// Neutral: the focus starts on the accepting button, which resolves true once, even clicked twice.
	await open('#confirm-neutral', '¿Publicar los cambios?')
	assert.equal(await page.evaluate(() => globalThis.document.activeElement?.textContent?.trim()), 'Publicar')
	assert.equal(
		(
			await dialog()
				.getAttribute('aria-describedby')
				.then((id) => page.locator(`#${id}`).textContent())
		).trim(),
		'Se verán en la web en unos segundos.',
	)
	await dialog()
		.getByRole('button', { name: 'Publicar', exact: true })
		.evaluate((button) => {
			button.click()
			button.click()
		})
	await closed()
	assert.equal((await status.textContent()).trim(), 'Confirmado.')

	// Cancel resolves false.
	await open('#confirm-neutral', '¿Publicar los cambios?')
	await dialog().getByRole('button', { name: 'Cancelar', exact: true }).click()
	await closed()
	assert.equal((await status.textContent()).trim(), 'Rechazado.')

	// Danger: the focus starts on Cancel, and the accepting button has the danger tone.
	await open('#confirm-neutral', '¿Publicar los cambios?')
	await dialog().getByRole('button', { name: 'Publicar', exact: true }).click()
	await closed()
	await open('#confirm-danger', '¿Eliminar el proyecto?')
	assert.equal(await page.evaluate(() => globalThis.document.activeElement?.textContent?.trim()), 'Cancelar')
	const [danger, solid] = await dialog()
		.getByRole('button', { name: 'Eliminar', exact: true })
		.evaluate((button) => {
			const probe = globalThis.document.createElement('span')
			probe.style.backgroundColor = 'var(--ui-color-danger)'
			globalThis.document.body.append(probe)
			const color = globalThis.getComputedStyle(probe).backgroundColor
			probe.remove()
			return [globalThis.getComputedStyle(button).backgroundColor, color]
		})
	assert.equal(danger, solid)
	// Esc resolves false.
	await page.keyboard.press('Escape')
	await closed()
	assert.equal((await status.textContent()).trim(), 'Rechazado.')

	// The close button resolves false.
	await open('#confirm-neutral', '¿Publicar los cambios?')
	await dialog().getByRole('button', { name: 'Publicar', exact: true }).click()
	await closed()
	await open('#confirm-danger', '¿Eliminar el proyecto?')
	await dialog().getByRole('button', { name: 'Cerrar modal', exact: true }).click()
	await closed()
	assert.equal((await status.textContent()).trim(), 'Rechazado.')

	// A click on the backdrop resolves false.
	await open('#confirm-neutral', '¿Publicar los cambios?')
	await dialog().getByRole('button', { name: 'Publicar', exact: true }).click()
	await closed()
	await open('#confirm-danger', '¿Eliminar el proyecto?')
	await page.mouse.click(8, 8)
	await closed()
	assert.equal((await status.textContent()).trim(), 'Rechazado.')
	// Without a body, the description sits above the actions with the space of the body.
	await open('#confirm-neutral', '¿Publicar los cambios?')
	const gap = await dialog().evaluate((element) => {
		const description = element.querySelector('p').getBoundingClientRect()
		const footer = element.querySelector('footer').getBoundingClientRect()
		return footer.top - description.bottom
	})
	assert.ok(gap > 8, `the description touches the actions: ${gap}px`)
	await page.keyboard.press('Escape')
	await closed()
	assert.deepEqual(errors, [])
})

test('native progress, meter and file inputs read their tokens, and the navigation bar follows data-navigating', { timeout: 120_000 }, async (context) => {
	const { browser, origin } = await startDemo(context)
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
	const errors = watch(page)
	await page.goto(`${origin}/controls`, { waitUntil: 'networkidle' })
	const styles = await page.evaluate(() => {
		const resolve = (property, value) => {
			const probe = globalThis.document.createElement('span')
			probe.style.setProperty(property, value)
			globalThis.document.body.append(probe)
			const result = globalThis.getComputedStyle(probe).getPropertyValue(property)
			probe.remove()
			return result
		}
		const root = globalThis.document.getElementById('native-elements')
		const [determinate, indeterminate] = root.querySelectorAll('progress')
		const meters = [...root.querySelectorAll('meter')]
		const file = root.querySelector('input[type="file"]')
		return {
			track: [globalThis.getComputedStyle(determinate).backgroundColor, resolve('background-color', 'var(--ui-progress-track)')],
			height: [globalThis.getComputedStyle(determinate).height, resolve('height', 'var(--ui-progress-height)')],
			moving: globalThis.getComputedStyle(indeterminate).animationName,
			meterTrack: [globalThis.getComputedStyle(meters[0]).backgroundColor, resolve('background-color', 'var(--ui-meter-track)')],
			regions: ['optimum', 'suboptimum', 'even-less-good'].map((region) => resolve('background-color', `var(--ui-meter-${region}-color)`)),
			button: [globalThis.getComputedStyle(file, '::file-selector-button').backgroundColor, resolve('background-color', 'var(--ui-file-button-bg)')],
		}
	})
	assert.equal(styles.track[0], styles.track[1])
	assert.equal(styles.height[0], styles.height[1])
	assert.equal(styles.moving, 'ui-progress-indeterminate')
	assert.equal(new Set(styles.regions).size, 3, 'three distinct semantic colors')
	assert.equal(styles.meterTrack[0], styles.meterTrack[1])
	// The bar of each region is painted in its own color: the three meters look different.
	const shots = await Promise.all([0, 1, 2].map((index) => page.locator('#native-elements meter').nth(index).screenshot()))
	assert.equal(new Set(shots.map((shot) => shot.toString('base64'))).size, 3)
	assert.equal(styles.button[0], styles.button[1])

	// The bar of a navigation: invisible at rest and during the delay, visible after it, and gone after it ends.
	const bar = () =>
		page.evaluate(() => {
			const style = globalThis.getComputedStyle(globalThis.document.documentElement, '::before')
			return { opacity: Number(style.opacity), height: style.height, position: style.position }
		})
	assert.equal((await bar()).opacity, 0)
	await page.evaluate(() => globalThis.document.documentElement.setAttribute('data-navigating', ''))
	assert.equal((await bar()).opacity, 0, 'a fast navigation never shows it')
	await page.waitForFunction(() => Number(globalThis.getComputedStyle(globalThis.document.documentElement, '::before').opacity) === 1, undefined, { timeout: 2000 })
	const shown = await bar()
	assert.equal(shown.position, 'fixed')
	assert.notEqual(shown.height, '0px')
	await page.evaluate(() => globalThis.document.documentElement.removeAttribute('data-navigating'))
	await page.waitForFunction(() => Number(globalThis.getComputedStyle(globalThis.document.documentElement, '::before').opacity) === 0, undefined, { timeout: 2000 })
	// A height of 0 turns it off.
	await page.evaluate(() => {
		globalThis.document.documentElement.style.setProperty('--ui-navigation-progress-height', '0')
		globalThis.document.documentElement.setAttribute('data-navigating', '')
	})
	assert.equal((await bar()).height, '0px')
	assert.deepEqual(errors, [])
})
