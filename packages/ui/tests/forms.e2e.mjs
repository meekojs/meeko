import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { startForms } from './helpers/forms-app.mjs'

test('forms hydrate, preserve native submission, keyboard and model updates; feedback closes and stacks', { timeout: 120_000 }, async (context) => {
	const { origin } = await startForms(context)
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const page = await browser.newPage()
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	await page.goto(origin, { waitUntil: 'networkidle' })
	assert.equal(await page.getByLabel('Comentario').inputValue(), 'Initial comment')
	await page.getByLabel('Comentario').fill('Updated')
	await page.getByRole('checkbox', { name: 'Aceptar condiciones' }).check()
	await page.getByRole('switch', { name: 'Notificaciones' }).press('Space')
	await page.getByRole('radio', { name: 'Día', exact: true }).focus()
	await page.keyboard.press('ArrowRight')
	assert.equal(await page.getByRole('radio', { name: 'Semana' }).isChecked(), true)
	await page.getByRole('slider', { name: 'Volumen' }).press('ArrowRight')
	assert.equal(await page.locator('#values').textContent(), 'Updated|true|false|week|6', JSON.stringify(errors))
	assert.deepEqual(await page.locator('#editor').evaluate((form) => Object.fromEntries(new FormData(form, globalThis.document.querySelector('#save')))), { comment: 'Updated', date: '', accepted: 'yes', period: 'week', volume: '6', intent: 'save' })
	await page.locator('#busy').click()
	assert.equal(await page.locator('#save').isDisabled(), true)
	assert.equal(await page.locator('#save').getAttribute('aria-busy'), 'true')
	await page.locator('#busy').click()
	await page.getByRole('alert').getByRole('button', { name: 'Cerrar aviso' }).click()
	assert.equal(await page.getByRole('alert').count(), 0)
	await page.locator('#notify').click()
	await page.locator('#notify').click()
	assert.equal(await page.getByRole('status').filter({ hasText: 'Cambios guardados' }).count(), 2, JSON.stringify({ errors, html: await page.locator('.meeko-ui-toast-host').innerHTML() }))
	const boxes = await page.locator('.meeko-ui-toast').evaluateAll((elements) =>
		elements.map((element) => {
			const box = element.getBoundingClientRect()
			return { top: box.top, bottom: box.bottom }
		}),
	)
	assert.ok(boxes[0].bottom <= boxes[1].top, 'notifications never overlap')
	await page.locator('.meeko-ui-toast').first().getByRole('button').click()
	assert.equal(await page.locator('.meeko-ui-toast').count(), 1)
	await page.locator('#clear').click()
	await page.locator('#timed').click()
	const timed = page.locator('.meeko-ui-toast').filter({ hasText: 'Aviso temporal' })
	await timed.hover()
	await page.waitForTimeout(1000)
	assert.equal(await timed.count(), 1, 'hover pauses expiration')
	await page.locator('h1').hover()
	await timed.waitFor({ state: 'detached' })
	assert.equal(await page.getByRole('rowheader', { name: 'Ana' }).count(), 1)
	await page.emulateMedia({ reducedMotion: 'reduce' })
	assert.equal(
		await page
			.locator('.meeko-ui-skeleton > span')
			.first()
			.evaluate((element) => globalThis.getComputedStyle(element).animationName),
		'none',
	)
	assert.deepEqual(errors, [])
	const native = await browser.newContext({ javaScriptEnabled: false })
	context.after(() => native.close())
	const ssr = await native.newPage()
	await ssr.goto(origin)
	assert.equal(await ssr.getByLabel('Comentario').inputValue(), 'Initial comment')
	await ssr.getByRole('checkbox', { name: 'Aceptar condiciones' }).check()
	assert.equal(await ssr.getByRole('checkbox', { name: 'Aceptar condiciones' }).isChecked(), true)
})
