import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

import { startDevServer } from '../../../scripts/test-support/dev-server.ts'

const demo = fileURLToPath(new URL('../../../apps/ui/', import.meta.url))
const output = fileURLToPath(new URL('../.meeko/', import.meta.url))

async function until(check, message) {
	const start = Date.now()
	while (!(await check())) {
		if (Date.now() - start > 30_000) throw new Error(message())
		await new Promise((done) => setTimeout(done, 50))
	}
}

test('modals hydrate, stack, settle, restore focus and work on mobile', { timeout: 120_000 }, async (context) => {
	const cli = fileURLToPath(new URL('../../meeko/dist/cli.js', import.meta.url))
	const { origin, stop } = await startDevServer({ root: demo, cli, path: '/modals', startupTimeout: 30_000 })
	context.after(stop)
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
	const failures = []
	page.on('pageerror', (error) => failures.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') failures.push(message.text())
	})
	await page.goto(`${origin}/modals`, { waitUntil: 'networkidle' })
	const settleMotion = () => page.locator('dialog[open]').evaluateAll((elements) => Promise.all(elements.flatMap((element) => element.getAnimations().map((animation) => animation.finished.catch(() => {})))))
	const assertBackdrop = async (count) => {
		const dialogs = page.locator('dialog[open]')
		assert.equal(await dialogs.count(), count)
		const colors = await dialogs.evaluateAll((elements) => elements.map((element) => globalThis.getComputedStyle(element, '::backdrop').backgroundColor))
		assert.equal(colors.filter((color) => color === 'rgba(0, 0, 0, 0.5)').length, 1, 'only the top modal dims the background')
		assert.equal(colors.filter((color) => color === 'rgba(0, 0, 0, 0)').length, count - 1, 'lower backdrops stay transparent')
		assert.equal(await page.locator('dialog[open][data-meeko-ui-modal-top]').count(), 1)
	}
	assert.equal(await page.locator('dialog[open]').count(), 0, 'SSR starts with closed dialogs')
	const trigger = page.getByRole('button', { name: 'Abrir confirmación', exact: true })
	await trigger.click()
	await page.locator('dialog[open]').waitFor()
	assert.equal(await page.getByRole('dialog', { name: 'Confirmar acción', exact: true }).count(), 1)
	await assertBackdrop(1)
	// Declarative dialogs occur earlier in the DOM but can be opened last.
	await page.getByRole('button', { name: 'Modal declarativo', exact: true }).evaluate((element) => element.click())
	await until(
		async () => (await page.locator('dialog[open]').count()) === 2,
		() => 'Declarative modal did not stack',
	)
	await assertBackdrop(2)
	const declarative = page.getByRole('dialog', { name: 'Un modal declarativo', exact: true })
	assert.equal(await declarative.evaluate((element) => element.hasAttribute('data-meeko-ui-modal-top')), true, 'opening order wins over DOM order')
	await declarative.evaluate((element) => element.close())
	await until(
		async () => (await page.locator('dialog[open][data-meeko-ui-modal-top]').count()) === 1,
		() => 'Native close did not restore backdrop ownership',
	)
	await assertBackdrop(1)
	await page.locator('dialog[open][data-meeko-ui-modal-top]').getByRole('button', { name: 'Abrir otro modal', exact: true }).click()
	await until(
		async () => (await page.locator('dialog[open]').count()) === 2,
		() => 'Nested modal did not open',
	)
	await assertBackdrop(2)
	await page.locator('dialog[open][data-meeko-ui-modal-top]').getByRole('button', { name: 'Abrir otro modal', exact: true }).click()
	await until(
		async () => (await page.locator('dialog[open]').count()) === 3,
		() => 'Third modal did not open',
	)
	await assertBackdrop(3)
	await settleMotion()
	assert.deepEqual(await page.locator('dialog[open]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-size'))), ['lg', 'md', 'sm'])
	const widths = await page.locator('dialog[open]').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width))
	assert.ok(widths[0] > widths[1] && widths[1] > widths[2], 'nested demo dialogs have distinct sizes')
	assert.equal(await page.locator('dialog[open][data-meeko-ui-modal-behind]').count(), 2)
	assert.equal(await page.evaluate(() => globalThis.document.activeElement?.closest('dialog')?.hasAttribute('data-meeko-ui-modal-top')), true, 'focus stays in the top modal')
	await mkdir(output, { recursive: true })
	await page.screenshot({ path: `${output}/modal-stack-desktop.png` })
	await page.setViewportSize({ width: 390, height: 844 })
	await assertBackdrop(3)
	await page.screenshot({ path: `${output}/modal-stack-mobile.png` })
	await page.setViewportSize({ width: 1280, height: 800 })
	await page.mouse.click(8, 8)
	await until(
		async () => (await page.locator('dialog[open]').count()) === 2,
		() => 'Backdrop closed the wrong modal',
	)
	await assertBackdrop(2)
	await page.keyboard.press('Escape')
	await until(
		async () => (await page.locator('dialog[open]').count()) === 1,
		() => 'Escape closed the wrong stack',
	)
	await assertBackdrop(1)
	// The promise of open() settles when the exit ends, a moment after the dialog stops being [open].
	await page.locator('dialog[open]', { hasText: 'adicional cancelada' }).waitFor()
	await settleMotion()
	assert.equal(await page.locator('dialog[open]').evaluate((element) => globalThis.getComputedStyle(element).scale), '1', 'previous modal returns to full size')
	await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
	assert.equal(await page.locator('dialog[data-meeko-ui-modal-state="closing"]').count(), 1, 'programmatic confirmation keeps the modal mounted during its exit')
	await until(
		async () => (await page.locator('dialog[open]').count()) === 0,
		() => 'Modal did not close',
	)
	await page.getByRole('status').first().filter({ hasText: 'Acción confirmada' }).waitFor()
	assert.equal(await page.locator('[data-meeko-ui-modal-order], [data-meeko-ui-modal-top]').count(), 0, 'closed dialogs release backdrop ownership')
	assert.equal(await trigger.evaluate((element) => element === element.ownerDocument.activeElement), true, 'focus returns to the opener')
	await trigger.click()
	await page.locator('dialog[open]').waitFor()
	await mkdir(output, { recursive: true })
	await page.screenshot({ path: `${output}/modal-desktop.png` })
	await page.mouse.click(8, 8)
	await until(
		async () => (await page.locator('dialog[open]').count()) === 0,
		() => 'Backdrop did not dismiss',
	)
	await page.getByRole('status').first().filter({ hasText: 'Acción cancelada' }).waitFor()
	await page.getByRole('button', { name: 'Modal declarativo', exact: true }).click()
	await page.locator('dialog[open]').waitFor()
	await page.getByLabel('Nombre', { exact: true }).fill('Diego')
	await page.getByRole('button', { name: 'Listo', exact: true }).click()
	await page.getByRole('button', { name: 'Modal declarativo', exact: true }).evaluate((element) => element.click())
	await settleMotion()
	assert.equal(await page.locator('dialog[open]').count(), 1, 'reopening cancels a declarative exit')
	assert.equal(await page.getByLabel('Nombre', { exact: true }).inputValue(), 'Diego', 'reopening preserves the mounted content')
	await page.getByRole('button', { name: 'Listo', exact: true }).click()
	await until(
		async () => (await page.locator('dialog[open]').count()) === 0,
		() => 'Declarative close animation did not finish',
	)
	await page.getByRole('button', { name: 'Cierre protegido', exact: true }).click()
	await page.locator('dialog[open]').waitFor()
	await page.keyboard.press('Escape')
	await page.mouse.click(8, 8)
	assert.equal(await page.locator('dialog[open]').count(), 1)
	assert.equal(await page.getByRole('button', { name: 'Cerrar modal' }).count(), 0)
	await page.getByRole('button', { name: 'Terminar', exact: true }).click()
	await until(
		async () => (await page.locator('dialog[open]').count()) === 0,
		() => 'Protected modal exit did not finish',
	)
	await page.setViewportSize({ width: 390, height: 844 })
	await trigger.click()
	await page.locator('dialog[open]').waitFor()
	const bounds = await page.locator('dialog[open]').boundingBox()
	assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390)
	assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844)
	await page.screenshot({ path: `${output}/modal-mobile.png` })
	await page.getByRole('button', { name: 'Cerrar modal', exact: true }).click()
	await until(
		async () => (await page.locator('dialog[open]').count()) === 0,
		() => 'Close button did not dismiss',
	)
	await page.getByRole('link', { name: 'Meeko UI, inicio', exact: true }).click()
	await page.getByRole('heading', { name: 'Tu interfaz. Con el lenguaje de Meeko.' }).waitFor()
	await page.getByRole('link', { name: /Interacciones completas/ }).click()
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await trigger.click()
	await page.locator('dialog[open]').waitFor()
	assert.equal(await page.locator('dialog[open]').count(), 1, 'host survives client navigation')
	assert.equal(await page.locator('dialog[open]').evaluate((element) => element.getAnimations().length), 0, 'reduced motion skips entrance animations')
	await page.keyboard.press('Escape')
	await until(
		async () => (await page.locator('dialog[open]').count()) === 0,
		() => 'Reduced-motion close did not finish',
	)
	// The rebuild of the linked package is covered in the core (framework-context-identity); this test never writes to the shared dist.
	await page.goto(`${origin}/modals`, { waitUntil: 'networkidle' })
	await trigger.click()
	await page.locator('dialog[open]').waitFor()
	assert.deepEqual(failures, [], 'no hydration or browser errors')
})
