import assert from 'node:assert/strict'
import test from 'node:test'

import { startDemo } from './helpers/demo.mjs'

test('public UI documentation renders every guide, navigates, copies code and validates forms on mobile', { timeout: 120_000 }, async (context) => {
	const { browser, origin, output } = await startDemo(context)
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	for (const route of ['/', '/installation', '/theming', '/components', '/buttons', '/links', '/badges', '/forms', '/cards', '/tables', '/modals', '/app', '/transitions', '/transitions/project']) {
		const response = await page.goto(origin + route)
		assert.equal(response.status(), 200, route)
		assert.equal(await page.locator('main h1').count(), 1, route)
		assert.match(await page.title(), / · Meeko UI$/, route)
		assert.ok(await page.locator('meta[name="description"]').getAttribute('content'), route)
	}
	await page.goto(origin + '/installation')
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
	await page.getByRole('button', { name: 'Copiar código' }).first().click()
	await page.getByRole('status').filter({ hasText: 'Copiado' }).waitFor()
	assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'pnpm add @meekojs/ui')
	await page.getByRole('searchbox', { name: 'Buscar en la guía', exact: true }).fill('badge')
	const navigation = page.getByRole('navigation', { name: 'Documentación de UI', exact: true })
	assert.equal(await navigation.getByRole('link').count(), 1)
	await page.evaluate(() => {
		globalThis.uiDocsNavigationMarker = 'retained'
	})
	await navigation.getByRole('link', { name: 'Badge', exact: true }).click()
	await page.getByRole('heading', { name: 'Badge', exact: true, level: 1 }).waitFor()
	assert.equal(await page.evaluate(() => globalThis.uiDocsNavigationMarker), 'retained', 'internal links use client navigation')
	assert.equal(await navigation.getByRole('link', { name: 'Badge', exact: true }).getAttribute('aria-current'), 'page')
	await page.getByRole('searchbox', { name: 'Buscar en la guía', exact: true }).fill('')
	await page.goto(origin)
	await page.getByRole('button', { name: 'Guardar proyecto', exact: true }).click()
	await page.getByRole('status').filter({ hasText: 'Cambios guardados' }).waitFor()
	await page.screenshot({ path: output + '/documentation-desktop.png', fullPage: true })
	for (const theme of ['light', 'dark']) {
		await page.evaluate((value) => {
			globalThis.document.documentElement.dataset.theme = value
		}, theme)
		const palette = await page.evaluate(() => {
			const style = globalThis.getComputedStyle(globalThis.document.documentElement)
			return { ink: style.getPropertyValue('--ink').trim(), ui: style.getPropertyValue('--meeko-ui-text').trim() }
		})
		assert.equal(palette.ink, palette.ui)
	}
	await page.setViewportSize({ width: 390, height: 844 })
	await page.locator('.mobile-menu > summary').click()
	await navigation.getByRole('link', { name: 'Field e Input', exact: true }).click()
	await page.getByRole('heading', { name: 'Field e Input', level: 1 }).waitFor()
	assert.equal(await page.locator('.mobile-menu').getAttribute('open'), null)
	await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click()
	await page.getByRole('alert').filter({ hasText: 'Escribe un nombre.' }).waitFor()
	assert.equal(await page.locator('#name').getAttribute('aria-invalid'), 'true')
	await page.getByRole('textbox', { name: /Nombre/ }).fill('Aurora')
	await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click()
	await page.getByRole('status').filter({ hasText: 'Nombre validado' }).waitFor()
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	await page.screenshot({ path: output + '/documentation-mobile.png', fullPage: true })
	await page.goto(origin + '/this-guide-does-not-exist')
	assert.equal(await page.getByRole('heading', { name: 'Esta página no existe', level: 1 }).count(), 1)
	await page.getByRole('link', { name: 'Ver componentes', exact: true }).click()
	await page.getByRole('heading', { name: 'Componentes', level: 1 }).waitFor()
	const ssr = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
	await ssr.goto(origin + '/installation')
	assert.equal(await ssr.getByRole('heading', { name: 'Instalación', level: 1 }).count(), 1)
	await ssr.locator('.mobile-menu > summary').click()
	await ssr.getByRole('navigation', { name: 'Documentación de UI', exact: true }).getByRole('link', { name: 'Todos los componentes', exact: true }).click()
	assert.equal(await ssr.getByRole('heading', { name: 'Componentes', level: 1 }).count(), 1)
	assert.deepEqual(errors, [])
})
