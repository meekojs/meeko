import assert from 'node:assert/strict'
import test from 'node:test'

import { startDemo } from './helpers/demo.mjs'

test('UIDateRange on /forms: shortcuts after hydration, typed dates, the invalid state and change only with a valid range', { timeout: 120_000 }, async (context) => {
	const { browser, origin } = await startDemo(context)

	// Without JavaScript: a named group with two labelled dates, and the shortcuts waiting disabled, without `today`.
	const ssr = await browser.newPage({ javaScriptEnabled: false })
	await ssr.goto(`${origin}/forms`)
	const still = ssr.getByRole('group', { name: 'Periodo', exact: true })
	assert.equal(await still.getByLabel('Desde', { exact: true }).getAttribute('type'), 'date')
	assert.equal(await still.getByRole('button', { name: 'Hoy', exact: true }).isDisabled(), true)
	assert.equal(await ssr.getByRole('group', { name: 'Periodo de ventas', exact: true }).count(), 1, 'inside UIField, named by the label of the field')
	await ssr.close()

	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	// The brand assets of the site come from its `dev` script, which the test server does not run.
	page.on('response', (response) => {
		if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/brand/')) errors.push(`${response.status()} ${response.url()}`)
	})
	page.on('console', (message) => {
		if (message.text().startsWith('Failed to load resource')) return
		if (message.type() === 'error' || /hydrat|mismatch/i.test(message.text())) errors.push(message.text())
	})
	await page.goto(`${origin}/forms`, { waitUntil: 'networkidle' })
	const group = page.getByRole('group', { name: 'Periodo', exact: true })
	const from = group.getByLabel('Desde', { exact: true })
	const to = group.getByLabel('Hasta', { exact: true })
	const status = page.locator('#date-range-status')
	const shortcut = (name) => group.getByRole('button', { name, exact: true })

	// Once mounted the shortcuts take the local date of the browser.
	const days = await page.evaluate(() => {
		const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
		const now = new Date()
		return { today: iso(now), weekAgo: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), longAgo: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 40)), tomorrow: iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) }
	})
	await page.waitForFunction(() => !globalThis.document.querySelector('#date-range-demo button[disabled]'))
	assert.equal((await status.textContent()).trim(), 'Sin rango aplicado.')

	// A shortcut fills both dates, is pressed and emits change once.
	await shortcut('7 días').click()
	assert.equal(await from.inputValue(), days.weekAgo)
	assert.equal(await to.inputValue(), days.today)
	assert.equal(await shortcut('7 días').getAttribute('aria-pressed'), 'true')
	assert.equal(await shortcut('Hoy').getAttribute('aria-pressed'), 'false')
	assert.equal((await status.textContent()).trim(), `Rango aplicado: ${days.weekAgo} → ${days.today} (1)`)
	await shortcut('7 días').click()
	assert.match((await status.textContent()).trim(), /\(1\)$/, 'the same range again emits nothing')

	// From after To: both dates invalid and described by the message; change does not come.
	await from.fill(days.tomorrow)
	const alert = group.getByRole('alert')
	assert.equal((await alert.textContent()).trim(), 'La fecha «Desde» no puede ser posterior a la fecha «Hasta».')
	const errorId = await alert.getAttribute('id')
	for (const date of [from, to]) {
		assert.equal(await date.getAttribute('aria-invalid'), 'true')
		assert.equal(await date.getAttribute('aria-describedby'), errorId)
	}
	assert.equal(await shortcut('7 días').getAttribute('aria-pressed'), 'false', 'the models follow what the user types')
	const border = await from.evaluate((element) => globalThis.getComputedStyle(element).borderTopColor)
	assert.notEqual(border, await group.getByRole('button', { name: 'Hoy', exact: true }).evaluate((element) => globalThis.getComputedStyle(element).borderTopColor), 'the danger border of an invalid field')
	assert.match((await status.textContent()).trim(), /\(1\)$/)

	// Longer than maxDays (31).
	await from.fill(days.longAgo)
	assert.equal((await alert.textContent()).trim(), 'El rango no puede tener más de 31 días.')
	assert.match((await status.textContent()).trim(), /\(1\)$/)

	// A valid range typed by hand: the message goes and change carries it.
	await from.fill(days.today)
	assert.equal(await group.getByRole('alert').count(), 0)
	assert.equal(await from.getAttribute('aria-invalid'), null)
	assert.equal((await status.textContent()).trim(), `Rango aplicado: ${days.today} → ${days.today} (2)`)
	assert.equal(await shortcut('Hoy').getAttribute('aria-pressed'), 'true')

	// An unfinished date empties the model without emitting.
	await to.fill('')
	assert.match((await status.textContent()).trim(), /\(2\)$/)
	assert.equal(await group.getByRole('alert').count(), 0, 'a missing date is not an error')

	assert.deepEqual(errors, [])
})
