// <UIInput type="number" | "time" | "month">: the model is the text of the control, before and after hydrating.
import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { startForms } from './helpers/forms-app.mjs'

const page = `<script lang="ts">
import { signal } from '@meekojs/meeko'
const amount = signal('2.5')
const start = signal('')
const period = signal('2026-11')
</script>
<template>
<main id="contenido">
<form id="types" on:submit="(event) => event.preventDefault()">
<UIInput aria-label="Cantidad" name="amount" type="number" min="0" max="10" step="0.5" inputmode="decimal" model="amount" />
<UIInput aria-label="Hora" name="start" type="time" step="900" model="start" />
<UIInput aria-label="Mes" name="period" type="month" min="2026-01" model="period" />
<output id="values">{amount.value}|{start.value}|{period.value}</output>
<button id="set" type="button" on:click="() => { amount.value = '7'; start.value = '18:45'; period.value = '2027-01' }">Cambiar</button>
</form>
</main>
</template>`

test('UIInput number, time and month keep the text of the control in the model, before and after hydration', { timeout: 180_000 }, async (context) => {
	const { origin } = await startForms(context, { port: 4733, page })
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const tab = await browser.newPage()
	const errors = []
	tab.on('pageerror', (error) => errors.push(error.message))
	tab.on('console', (message) => {
		if (message.type() === 'error' || /hydrat/i.test(message.text())) errors.push(message.text())
	})
	// The client entry waits: what is typed first is in the server's HTML only.
	let release
	const held = new Promise((resolve) => {
		release = resolve
	})
	await tab.route('**/entry-client.ts*', async (route) => {
		await held
		await route.continue()
	})
	await tab.goto(origin, { waitUntil: 'commit' })
	const amount = tab.getByLabel('Cantidad')
	await amount.waitFor()
	assert.equal(await amount.getAttribute('type'), 'number')
	assert.equal(await amount.getAttribute('inputmode'), 'decimal')
	assert.equal(await amount.inputValue(), '2.5', 'the model of the server')
	assert.equal(await tab.getByLabel('Mes').inputValue(), '2026-11')
	await amount.fill('4')
	await tab.getByLabel('Hora').fill('09:30')

	release()
	await tab.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 60_000 })
	await tab.waitForFunction(() => globalThis.document.querySelector('#values').textContent === '4|09:30|2026-11', undefined, { timeout: 10_000 }).catch(() => undefined)
	assert.equal(await tab.locator('#values').textContent(), '4|09:30|2026-11', JSON.stringify(errors))

	// After hydrating: the arrows of a number step it, an empty field is an empty text, and the code writes back.
	await amount.press('ArrowUp')
	assert.equal(await tab.locator('#values').textContent(), '4.5|09:30|2026-11')
	await amount.fill('')
	assert.equal(await tab.locator('#values').textContent(), '|09:30|2026-11')
	await tab.locator('#set').click()
	assert.equal(await amount.inputValue(), '7')
	assert.equal(await tab.getByLabel('Hora').inputValue(), '18:45')
	assert.equal(await tab.getByLabel('Mes').inputValue(), '2027-01')
	assert.deepEqual(await tab.locator('#types').evaluate((form) => Object.fromEntries(new globalThis.FormData(form))), { amount: '7', start: '18:45', period: '2027-01' })
	assert.deepEqual(errors, [])
	await tab.close()
})
