import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { startForms } from './helpers/forms-app.mjs'

const page = `<script lang="ts">
import { signal } from '@meekojs/meeko'
const name = signal('Ada')
const fixed = signal('Fijo')
const heard = signal('-')
const fruit = signal<string | null>('Pera')
const open = signal(false)
const closes = signal(0)
const field = { modelValue: 'Desde objeto', placeholder: 'Pista' }
</script>
<template>
<main>
<section id="input"><UIInput aria-label="Nombre" name="name" bind:modelValue="name.value" on:update:modelValue="(next) => (name.value = next)" /><output>{name.value}</output></section>
<section id="fixed"><UIInput aria-label="Fijo" bind:modelValue="fixed.value" on:update:modelValue="(next) => (heard.value = next)" /><output>{heard.value}</output></section>
<section id="spread"><UIInput aria-label="Objeto" bind="field" /></section>
<section id="select"><UISelect label="Fruta" name="fruit" bind:modelValue="fruit.value" on:update:modelValue="(next) => (fruit.value = next)" bind:options="['Manzana', 'Pera', 'Ciruela']" /><output>{fruit.value}</output></section>
<section id="modal"><button id="open" type="button" on:click="() => (open.value = true)">Abrir</button><UIModal title="Aviso" bind:modelValue="open.value" on:update:modelValue="(next) => { closes.value++; open.value = next; }"><p>Contenido</p></UIModal><output>{open.value}|{closes.value}</output></section>
</main>
</template>`

test('UIInput, UISelect and UIModal take their model by prop and event, without a change in UI', { timeout: 120_000 }, async (context) => {
	const { origin } = await startForms(context, { port: 4702, page })
	const html = await (await fetch(origin)).text()
	const section = (id) => new RegExp(`<section id="${id}">([\\s\\S]*?)</section>`).exec(html)?.[1] ?? ''
	// SSR: the value of the prop, and neither the prop nor the event reach the control through bind="rest".
	assert.match(section('input'), /<input[^>]*value="Ada"/)
	assert.match(section('spread'), /<input[^>]*value="Desde objeto"/)
	assert.match(section('spread'), /placeholder="Pista"/)
	assert.match(section('select'), /Pera/)
	assert.doesNotMatch(html, /modelvalue|onupdate/i)

	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const tab = await browser.newPage()
	const errors = []
	tab.on('pageerror', (error) => errors.push(error.message))
	tab.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	await tab.goto(origin, { waitUntil: 'networkidle' })

	await tab.getByLabel('Nombre').fill('Grace')
	assert.equal(await tab.locator('#input output').textContent(), 'Grace')
	assert.equal(await tab.getByLabel('Nombre').inputValue(), 'Grace')
	assert.deepEqual(await tab.locator('#input input').evaluate((input) => [input.hasAttribute('modelvalue'), input.getAttribute('name')]), [false, 'name'])

	// A parent that keeps its prop hears the write, and the control goes back.
	await tab.getByLabel('Fijo').fill('otro')
	assert.equal(await tab.locator('#fixed output').textContent(), 'otro')
	assert.equal(await tab.getByLabel('Fijo').inputValue(), 'Fijo')

	await tab.getByLabel('Objeto').fill('local')
	assert.equal(await tab.getByLabel('Objeto').inputValue(), 'local')

	assert.equal(await tab.getByLabel('Fruta').inputValue(), 'Pera')
	await tab.getByLabel('Fruta').selectOption('Ciruela')
	assert.equal(await tab.locator('#select output').textContent(), 'Ciruela')
	assert.equal(await tab.getByLabel('Fruta').inputValue(), 'Ciruela')

	await tab.locator('#open').click()
	await tab.waitForFunction(() => globalThis.document.querySelector('#modal dialog')?.open === true)
	await tab.keyboard.press('Escape')
	await tab.waitForFunction(() => globalThis.document.querySelector('#modal dialog')?.open === false)
	assert.equal(await tab.locator('#modal output').textContent(), 'false|1')

	assert.deepEqual(errors, [])
})

test('the published declarations of UI know the prop and the event of a model', async () => {
	const declaration = await readFile(new URL('../dist/app/components/Input.d.meeko.ts', import.meta.url), 'utf8')
	assert.match(declaration, /modelValue\?: __MeekoModels\["default"\] \| undefined/)
	assert.match(declaration, /"update:modelValue": \[next: __MeekoModels\["default"\]\]/)
})
