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
	// While busy it keeps the focus and does not act: the click must not submit nor reach the handler.
	assert.equal(await page.locator('#save').evaluate((element) => element.disabled), false)
	assert.equal(await page.locator('#save').getAttribute('aria-busy'), 'true')
	assert.equal(await page.locator('#save').getAttribute('aria-disabled'), 'true')
	// Enabled but busy: neither the click nor the keyboard submits, and the focus stays.
	await page.locator('#editor').evaluate((form) => form.addEventListener('submit', () => (globalThis.submitted = true)))
	await page.locator('#save').focus()
	await page.keyboard.press('Enter')
	assert.equal(await page.evaluate(() => globalThis.submitted), undefined)
	assert.equal(await page.locator('#save').evaluate((element) => element === globalThis.document.activeElement), true)
	await page.locator('#busy').click()
	await page.getByRole('alert').getByRole('button', { name: 'Cerrar aviso' }).click()
	assert.equal(await page.getByRole('alert').count(), 0)
	await page.locator('#notify').click()
	await page.locator('#notify').click()
	assert.equal(await page.locator('.meeko-ui-toast-host[aria-live="polite"] .meeko-ui-toast').filter({ hasText: 'Cambios guardados' }).count(), 2, JSON.stringify({ errors, html: await page.locator('.meeko-ui-toast-host').innerHTML() }))
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
	// The exit is a View Transition of its own type, and the name exists only during it.
	await page.evaluate(() => {
		const start = globalThis.document.startViewTransition.bind(globalThis.document)
		globalThis.viewTransitionTypes = []
		globalThis.document.startViewTransition = (options) => {
			globalThis.viewTransitionTypes.push(options.types ?? [])
			return start(options)
		}
	})
	await page.locator('#notify').click()
	const closing = page.locator('.meeko-ui-toast').last()
	assert.equal(await closing.evaluate((element) => globalThis.getComputedStyle(element).viewTransitionName), 'none')
	await closing.getByRole('button').click()
	await closing.waitFor({ state: 'detached' })
	assert.deepEqual(await page.evaluate(() => globalThis.viewTransitionTypes), [['ui-toast-close']])
	// With a modal open the host goes back to the top of the top layer, or the toast would stay behind it.
	await page.evaluate(() => {
		const dialog = globalThis.document.createElement('dialog')
		dialog.id = 'modal'
		globalThis.document.body.append(dialog)
		dialog.showModal()
		globalThis.hostToggles = 0
		globalThis.document.querySelector('.meeko-ui-toast-host').addEventListener('beforetoggle', () => globalThis.hostToggles++)
		globalThis.document.querySelector('#notify').click()
	})
	await page.waitForFunction(() => globalThis.hostToggles === 2)
	assert.equal(await page.locator('.meeko-ui-toast-host').evaluate((element) => element.matches(':popover-open')), true)
	await page.evaluate(() => {
		globalThis.document.querySelector('#modal').remove()
		globalThis.document.querySelector('#clear').click()
	})
	await page.locator('.meeko-ui-toast').first().waitFor({ state: 'detached' })
	assert.equal(await page.getByRole('rowheader', { name: 'Ana' }).count(), 1)
	await page.emulateMedia({ reducedMotion: 'reduce' })
	assert.equal(
		await page
			.locator('.meeko-ui-skeleton > span')
			.first()
			.evaluate((element) => globalThis.getComputedStyle(element).animationName),
		'none',
	)
	// Less motion, no transition: the toast just goes.
	await page.locator('#notify').click()
	await page.locator('.meeko-ui-toast').last().getByRole('button').click()
	assert.equal(await page.locator('.meeko-ui-toast').count(), 0)
	assert.deepEqual(await page.evaluate(() => globalThis.viewTransitionTypes), [['ui-toast-close']])
	assert.deepEqual(errors, [])
	const native = await browser.newContext({ javaScriptEnabled: false })
	context.after(() => native.close())
	const ssr = await native.newPage()
	await ssr.goto(origin)
	assert.equal(await ssr.getByLabel('Comentario').inputValue(), 'Initial comment')
	await ssr.getByRole('checkbox', { name: 'Aceptar condiciones' }).check()
	assert.equal(await ssr.getByRole('checkbox', { name: 'Aceptar condiciones' }).isChecked(), true)
})
