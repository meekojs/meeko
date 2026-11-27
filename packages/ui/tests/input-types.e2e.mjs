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

const sizes = `<template>
<main id="contenido">
<div id="sizes">
<UIInput aria-label="Campo xs" size="xs" /><UIButton id="button-xs" size="xs">Botón</UIButton>
<UIInput aria-label="Campo sm" size="sm" /><UIButton id="button-sm" size="sm">Botón</UIButton>
<UIInput aria-label="Campo md" /><UIButton id="button-md">Botón</UIButton>
<UIInput aria-label="Clave sm" type="password" reveal size="sm" />
</div>
</main>
</template>`

test('UIInput of each size is as tall as its control height token and as a UIButton of the same size', { timeout: 180_000 }, async (context) => {
	const { origin } = await startForms(context, { port: 4734, page: sizes })
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const tab = await browser.newPage()
	await tab.goto(origin)
	const height = (locator) => locator.evaluate((element) => element.getBoundingClientRect().height)
	const token = (size) => tab.evaluate((name) => Number.parseFloat(globalThis.getComputedStyle(globalThis.document.documentElement).getPropertyValue(name)) * 16, `--ui-control-height-${size}`)
	for (const size of ['xs', 'sm', 'md']) {
		const field = await height(tab.getByLabel(`Campo ${size}`))
		assert.equal(field, await token(size), `${size}: the height of the token`)
		assert.equal(field, await height(tab.locator(`#button-${size}`)), `${size}: the height of a button of that size`)
	}
	const secret = tab.getByLabel('Clave sm')
	const toggle = tab.locator('#sizes button[type="button"]').last()
	assert.equal(await height(secret), await token('sm'))
	const box = await toggle.boundingBox()
	assert.deepEqual([box.width, box.height], [await token('sm'), await token('sm')], 'the button of reveal is a square as tall as the field')
	await tab.close()
})
