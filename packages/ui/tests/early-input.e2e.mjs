// A slow connection or an autofill: the user edits the controls of the server's HTML before the
// JavaScript arrives. What they see has to be what the model has once the page hydrates.
import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { earlyPage, startForms } from './helpers/forms-app.mjs'

const launch = () => chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })

/** A page whose client entry waits until `hydrate`, as with a slow connection; the HTML is already there. */
async function heldPage(browser, origin, errors) {
	const page = await browser.newPage()
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	let release
	const held = new Promise((resolve) => {
		release = resolve
	})
	await page.route('**/entry-client.ts*', async (route) => {
		await held
		await route.continue()
	})
	await page.goto(origin, { waitUntil: 'commit' })
	await page.locator('#send').waitFor()
	return {
		page,
		hydrate: async () => {
			release()
			await page.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 60_000 })
		},
	}
}

test('what is edited before hydration reaches the model and the submission of every control', { timeout: 180_000 }, async (context) => {
	const { origin } = await startForms(context, { port: 4520, page: earlyPage })
	const browser = await launch()
	context.after(() => browser.close())
	const errors = []
	const { page, hydrate } = await heldPage(browser, origin, errors)

	assert.equal(await page.locator('#values').textContent(), '|||false|false|day|4||', 'the model of the server')
	await page.getByLabel('Nombre').fill('Ana')
	await page.getByLabel('Clave').fill('s3creta')
	await page.getByLabel('Nota').fill('Hola')
	await page.getByRole('checkbox', { name: 'Aceptar' }).check()
	await page.getByRole('switch', { name: 'Avisos' }).check()
	await page.getByRole('radio', { name: 'Semana' }).check()
	await page.getByRole('slider', { name: 'Volumen' }).fill('8')
	await page.getByLabel('Fruta').selectOption('Pera')
	assert.equal(await page.locator('#values').textContent(), '|||false|false|day|4||', 'nothing has run yet')

	await hydrate()
	const expected = 'Ana|s3creta|Hola|true|true|week|8|Pera|'
	await page.waitForFunction((text) => globalThis.document.querySelector('#values').textContent === text, expected, { timeout: 10_000 }).catch(() => undefined)
	assert.equal(await page.locator('#values').textContent(), expected, JSON.stringify(errors))
	// The controls keep what the user sees.
	assert.equal(await page.getByLabel('Nombre').inputValue(), 'Ana')
	assert.equal(await page.getByRole('checkbox', { name: 'Aceptar' }).isChecked(), true)
	assert.equal(await page.getByRole('radio', { name: 'Semana' }).isChecked(), true)
	assert.equal(await page.getByRole('slider', { name: 'Volumen' }).inputValue(), '8')
	assert.equal(await page.getByLabel('Fruta').inputValue(), 'Pera')
	// The track of the slider follows the value that was there before hydrating.
	assert.match((await page.getByRole('slider', { name: 'Volumen' }).getAttribute('style')) ?? '', /--slider-fill: 80%/)

	// The submission with JavaScript sends the same as the form holds natively.
	await page.locator('#send').click()
	assert.equal(await page.locator('#sent').textContent(), expected)
	assert.deepEqual(await page.locator('#early').evaluate((form) => Object.fromEntries(new globalThis.FormData(form))), { text: 'Ana', secret: 's3creta', note: 'Hola', accepted: 'yes', alerts: 'on', period: 'week', volume: '8', fruit: 'Pera', city: '' })

	// After hydrating, both directions go on working, with the type of each model.
	await page.getByLabel('Nombre').fill('Ana María')
	await page.getByRole('slider', { name: 'Volumen' }).fill('6')
	assert.equal(await page.locator('#values').textContent(), 'Ana María|s3creta|Hola|true|true|week|6|Pera|')
	await page.locator('#reset').click()
	assert.equal(await page.getByLabel('Nombre').inputValue(), 'desde código')
	assert.equal(await page.getByRole('checkbox', { name: 'Aceptar' }).isChecked(), false)
	assert.equal(await page.getByRole('slider', { name: 'Volumen' }).inputValue(), '2')
	assert.equal(await page.getByRole('radio', { name: 'Día' }).isChecked(), true)
	assert.deepEqual(errors, [])
	await page.close()

	// A control nobody touched leaves its model alone, also a range whose value the browser clamped.
	const untouched = await heldPage(browser, origin, errors)
	await untouched.hydrate()
	assert.equal(await untouched.page.locator('#values').textContent(), '|||false|false|day|4||')
	assert.equal(await untouched.page.getByRole('slider', { name: 'Tope' }).inputValue(), '100')
	assert.equal(await untouched.page.locator('#capped').textContent(), '150', 'the browser clamped it; nobody moved it')
	await untouched.page.close()

	// A combobox: the text is a search while it keeps the focus, and no value until one is chosen.
	const searching = await heldPage(browser, origin, errors)
	const city = searching.page.getByRole('combobox', { name: 'Ciudad' })
	await city.fill('qui')
	await searching.hydrate()
	const list = searching.page.locator('[role=listbox]')
	await list.getByRole('option', { name: 'Quito' }).waitFor()
	assert.equal(await list.getByRole('option').count(), 1, 'the list is filtered by what was typed')
	assert.equal(await city.inputValue(), 'qui')
	await list.getByRole('option', { name: 'Quito' }).click()
	assert.equal(await city.inputValue(), 'Quito')
	assert.equal(await searching.page.locator('#values').textContent(), '|||false|false|day|4||Quito')
	await searching.page.close()

	// Without the focus the search ended: the field shows the selection, which is none.
	const left = await heldPage(browser, origin, errors)
	await left.page.getByRole('combobox', { name: 'Ciudad' }).fill('qui')
	await left.page.getByLabel('Nombre').focus()
	await left.hydrate()
	await left.page.waitForFunction(() => globalThis.document.querySelector('input[role=combobox]').value === '', undefined, { timeout: 10_000 })
	assert.equal(await left.page.locator('[role=listbox]').isVisible(), false)
	await left.page.close()
	assert.deepEqual(errors, [])
})
