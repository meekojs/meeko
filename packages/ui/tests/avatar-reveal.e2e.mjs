// En el navegador: el botón de `reveal` de <UIInput> cambia el campo entre contraseña y texto sin enviar el
// formulario, y un <UIAvatar> cuya imagen no carga pasa a las iniciales, también si falló antes de hidratar.
import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { startForms } from './helpers/forms-app.mjs'

const page = `<script lang="ts">
import { signal } from '@meekojs/meeko'
const secret = signal('')
const sent = signal(0)
</script>
<template>
<main id="contenido">
<form id="login" on:submit="(event) => { event.preventDefault(); sent.value++ }">
<UIInput id="secret" aria-label="Contraseña" name="secret" type="password" reveal model="secret" />
<output id="secret-value">{secret.value}</output>
<output id="sent">{sent.value}</output>
</form>
<UIAvatar id="broken" name="Ana Pérez" src="/no-existe.png" />
<UIAvatar name="Luis Gómez" size="sm" />
</main>
</template>`

test('reveal toggles the type and aria-pressed without submitting, and a broken avatar falls back to its initials', { timeout: 180_000 }, async (context) => {
	const { origin } = await startForms(context, { port: 4731, page })
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const tab = await browser.newPage()
	const errors = []
	tab.on('pageerror', (error) => errors.push(error.message))
	await tab.goto(origin, { waitUntil: 'networkidle' })
	await tab.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0)
	const field = tab.locator('#secret')
	const toggle = tab.getByRole('button', { name: 'Mostrar contraseña' })
	await toggle.waitFor({ state: 'visible' })
	assert.equal(await field.getAttribute('type'), 'password')
	assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
	await field.fill('s3creto')
	await toggle.click()
	const hide = tab.getByRole('button', { name: 'Ocultar contraseña' })
	assert.equal(await field.getAttribute('type'), 'text')
	assert.equal(await hide.getAttribute('aria-pressed'), 'true')
	assert.equal(await field.inputValue(), 's3creto', 'the value survives the change of type')
	assert.equal(await tab.locator('#secret-value').textContent(), 's3creto')
	// El botón no envía el formulario y conserva el foco; el teclado lo vuelve a pulsar.
	assert.equal(await tab.locator('#sent').textContent(), '0')
	assert.equal(await hide.evaluate((element) => element === globalThis.document.activeElement), true)
	await tab.keyboard.press('Enter')
	assert.equal(await field.getAttribute('type'), 'password')
	assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
	assert.equal(await tab.locator('#sent').textContent(), '0')
	// La imagen rota: las iniciales, con el nombre en la caja.
	const broken = tab.getByRole('img', { name: 'Ana Pérez' })
	await broken.waitFor()
	assert.equal(await broken.textContent(), 'AP')
	assert.equal(await tab.locator('img').count(), 0)
	assert.equal(await tab.getByRole('img', { name: 'Luis Gómez' }).textContent(), 'LG')
	const sizes = await tab.getByRole('img', { name: 'Luis Gómez' }).evaluate((element) => element.getBoundingClientRect().width)
	assert.ok(sizes > 0)
	assert.deepEqual(errors, [])
})
