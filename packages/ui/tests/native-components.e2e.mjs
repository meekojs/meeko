import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium, firefox, webkit } from 'playwright-core'

import { createNativeApp } from './helpers/native-app.mjs'

/** Firefox and WebKit run only when their Playwright builds are installed; Chrome always runs. */
const engines = [
	['chrome', () => chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })],
	['firefox', () => firefox.launch({ headless: true })],
	['webkit', () => webkit.launch({ headless: true })],
]

async function launch(name, start, t) {
	try {
		return await start()
	} catch (error) {
		if (name === 'chrome') throw error
		t.diagnostic(`${name} is not installed: ${error.message.split('\n')[0]}`)
		return undefined
	}
}

async function open(browser, origin) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if ((message.type() === 'error' && !message.text().includes('404')) || /hydrat/i.test(message.text())) errors.push(message.text())
	})
	await page.addInitScript(() => {
		globalThis.meekoTransitions = []
		const native = globalThis.Document.prototype.startViewTransition
		if (!native) return
		globalThis.Document.prototype.startViewTransition = function (argument) {
			const transition = native.call(this, argument)
			globalThis.meekoTransitions.push({ types: argument?.types ?? [], transition })
			return transition
		}
	})
	await page.goto(origin, { waitUntil: 'networkidle' })
	await page.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0)
	return { page, errors }
}

const finished = (page) => page.evaluate(() => Promise.all(globalThis.meekoTransitions.map((entry) => entry.transition.finished.catch(() => {}))))
const types = (page) => page.evaluate(() => globalThis.meekoTransitions.flatMap((entry) => entry.types))
const focused = (page) => page.evaluate(() => globalThis.document.activeElement?.textContent?.trim() ?? '')

for (const [name, start] of engines) {
	test(`native components in ${name}`, { timeout: 240_000 }, async (t) => {
		const browser = await launch(name, start, t)
		if (!browser) return
		t.after(() => browser.close())
		const { origin } = await createNativeApp(t)

		await t.test('UITabs: roles, keyboard, panels with hidden and an indicator that moves', async () => {
			const { page, errors } = await open(browser, origin)
			const tablist = page.getByRole('tablist', { name: 'Ajustes', exact: true })
			const tab = (label) => tablist.getByRole('tab', { name: label, exact: true })
			assert.equal(await tab('Equipo').getAttribute('aria-selected'), 'true')
			assert.equal(await page.locator('#panel-team').isVisible(), true, 'the chosen panel, from the server')
			assert.equal(await page.locator('#panel-account').isVisible(), false)
			assert.deepEqual(await tablist.getByRole('tab').evaluateAll((tabs) => tabs.map((element) => element.tabIndex)), [-1, 0, -1, -1], 'one tab in the tab order')
			const panel = page.getByRole('tabpanel', { name: 'Equipo', exact: true })
			assert.equal(await panel.getAttribute('id'), await tab('Equipo').getAttribute('aria-controls'))

			await tab('Equipo').focus()
			await page.keyboard.press('ArrowRight')
			await page.waitForFunction(() => globalThis.document.querySelector('#tab-value').textContent.startsWith('audit'))
			await finished(page)
			assert.equal(await focused(page), 'Auditoría', 'the arrow skips the disabled tab')
			assert.equal(await page.locator('[data-panel=audit]').innerText(), 'Panel común: Auditoría')
			await page.keyboard.press('ArrowRight')
			await page.waitForFunction(() => globalThis.document.querySelector('#tab-value').textContent.startsWith('account'))
			assert.equal(await focused(page), 'Cuenta', 'the arrow wraps')
			await finished(page)
			await page.keyboard.press('End')
			await page.waitForFunction(() => globalThis.document.querySelector('#tab-value').textContent.startsWith('audit'))
			await finished(page)
			await page.keyboard.press('Home')
			await page.waitForFunction(() => globalThis.document.querySelector('#tab-value').textContent.startsWith('account'))
			await finished(page)
			await page.keyboard.press('Tab')
			assert.equal(await page.evaluate(() => globalThis.document.activeElement?.getAttribute('role')), 'tabpanel', 'Tab goes to the panel')

			await tab('Facturación').click({ force: true })
			assert.equal(await tab('Cuenta').getAttribute('aria-selected'), 'true', 'a disabled tab is not chosen')
			await tab('Equipo').click()
			await page.locator('#panel-team').waitFor()
			await finished(page)
			assert.ok((await types(page)).every((type) => type === 'ui-tab'))
			assert.equal(await page.locator('[data-ui-tabs-active]').count(), 0, 'the mark leaves with the transition')

			// The model may change from outside, and the indicator follows.
			await page.locator('#tab-external').click()
			await page.locator('[data-panel=audit]').waitFor()
			await finished(page)
			assert.match(await page.locator('#tab-value').innerText(), /^audit\|/)
			assert.doesNotMatch(await page.locator('#tab-value').innerText(), /audit$/, 'an outside change is not a change event of the component')

			// A second group at the same time: only the one that changed names its indicator.
			if (name !== 'firefox') {
				const during = await page.evaluate(async () => {
					const button = [...globalThis.document.querySelectorAll('#tabs-two [role=tab]')].find((element) => element.textContent === 'Dos')
					button.click()
					const entry = globalThis.meekoTransitions.at(-1)
					await entry.transition.ready
					const names = [...globalThis.document.querySelectorAll('.meeko-ui-tabs-indicator')].map((element) => globalThis.getComputedStyle(element).viewTransitionName).filter((value) => value !== 'none')
					return { names }
				})
				assert.deepEqual(during.names, ['ui-tabs-indicator'])
				await finished(page)
			}
			assert.equal(await page.getByRole('tablist', { name: 'Segundo grupo', exact: true }).count(), 1, 'labelledBy names the list')
			assert.deepEqual(errors, [])
			await page.close()
		})

		await t.test('UITabs with reduced motion and without JavaScript', async () => {
			const context = await browser.newContext({ reducedMotion: 'reduce' })
			const reduced = await context.newPage()
			await reduced.addInitScript(() => {
				globalThis.calls = 0
				const native = globalThis.Document.prototype.startViewTransition
				if (native)
					globalThis.Document.prototype.startViewTransition = function (argument) {
						globalThis.calls++
						return native.call(this, argument)
					}
			})
			await reduced.goto(origin, { waitUntil: 'networkidle' })
			await reduced.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0)
			await reduced.getByRole('tab', { name: 'Cuenta', exact: true }).click()
			assert.equal(await reduced.locator('#panel-account').isVisible(), true, 'at once')
			assert.equal(await reduced.evaluate(() => globalThis.calls), 0)
			await context.close()
			if (name === 'webkit') return
			const noScript = await browser.newContext({ javaScriptEnabled: false })
			const page = await noScript.newPage()
			await page.goto(origin)
			assert.equal(await page.locator('#panel-team').isVisible(), true, 'the chosen panel shows without JavaScript')
			assert.equal(await page.locator('#panel-account').isVisible(), false)
			await noScript.close()
		})

		await t.test('UITooltip: hover and focus, without taking the focus; Escape closes it', async () => {
			const { page, errors } = await open(browser, origin)
			const trigger = page.getByRole('button', { name: '¿Qué es esto?', exact: true })
			const tooltip = page.getByRole('tooltip', { name: '', includeHidden: true }).filter({ hasText: 'Se publica al guardar' })
			assert.equal(await trigger.getAttribute('aria-describedby'), await tooltip.getAttribute('id'))
			assert.equal(await tooltip.isVisible(), false)
			await page.locator('#tab-external').focus()
			await trigger.hover()
			await tooltip.waitFor({ state: 'visible' })
			assert.equal(await focused(page), 'Auditoría desde fuera', 'the tooltip does not take the focus')
			await tooltip.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
			const [tip, box] = await Promise.all([tooltip.boundingBox(), trigger.boundingBox()])
			assert.ok(tip.y + tip.height <= box.y, `above the trigger: ${JSON.stringify({ tip, box })}`)
			await page.keyboard.press('Escape')
			await tooltip.waitFor({ state: 'hidden' })
			await page.mouse.move(2, 880)
			await trigger.focus()
			await tooltip.waitFor({ state: 'visible' })
			await page.locator('#tab-external').focus()
			await tooltip.waitFor({ state: 'hidden' })

			// Its own anchor, with rich content, below it.
			const own = page.getByRole('button', { name: 'Propio', exact: true })
			const describedBy = await own.getAttribute('aria-describedby')
			assert.ok(describedBy)
			await own.hover()
			const rich = page.locator(`[id="${describedBy}"]`)
			await rich.locator('strong', { hasText: 'Con formato' }).waitFor()
			await rich.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
			const [richBox, ownBox] = await Promise.all([rich.boundingBox(), own.boundingBox()])
			assert.ok(richBox.y >= ownBox.y + ownBox.height, 'below its anchor')
			assert.deepEqual(errors, [])
			await page.close()
		})

		await t.test('UICommandPalette: shortcuts, status, arrows, links, sections and events', async () => {
			const { page, errors } = await open(browser, origin)
			const out = page.locator('#palette-out')
			const dialog = page.getByRole('dialog', { name: 'Buscar', exact: true })
			const input = dialog.getByRole('combobox')
			assert.equal(await dialog.count(), 0, 'closed from the server')
			await page.locator('body').click({ position: { x: 2, y: 2 } })
			await page.keyboard.press('Control+k')
			await dialog.waitFor()
			assert.equal(await page.evaluate(() => globalThis.document.activeElement?.id), 'palette-input', 'the focus goes to the field')
			assert.equal(await input.getAttribute('name'), 'q')
			assert.equal(await input.getAttribute('aria-expanded'), 'false')
			assert.equal(await dialog.getByRole('listbox', { includeHidden: true }).isVisible(), false)
			await input.fill('nada')
			await dialog.getByRole('status').filter({ hasText: 'Sin resultados para «nada».' }).waitFor()
			await input.fill('error')
			await dialog.getByRole('status').filter({ hasText: 'La búsqueda no está disponible ahora mismo.' }).waitFor()
			await input.fill('todo')
			const options = dialog.getByRole('option')
			await options.first().waitFor()
			assert.deepEqual(await options.evaluateAll((elements) => elements.map((element) => [element.localName, element.getAttribute('href'), element.getAttribute('data-depth')])), [
				['a', '#signals', '0'],
				['a', '#computed', '1'],
				['a', '#effects', '1'],
				['a', '#routes', '0'],
			])
			assert.equal(await input.getAttribute('aria-expanded'), 'true')
			const activeId = () => input.getAttribute('aria-activedescendant')
			assert.equal(await activeId(), await options.nth(0).getAttribute('id'))
			await page.keyboard.press('ArrowDown')
			assert.equal(await activeId(), await options.nth(1).getAttribute('id'))
			assert.equal(await options.nth(1).getAttribute('aria-selected'), 'true')
			assert.equal(await dialog.locator('mark', { hasText: 'reactivo' }).count(), 1, 'the snippet paints the excerpt')
			await page.keyboard.press('ArrowUp')
			await page.keyboard.press('ArrowUp')
			assert.equal(await activeId(), await options.nth(3).getAttribute('id'), 'it wraps')
			// Enter goes through a click on the link, so a router would take it.
			await page.keyboard.press('Enter')
			await page.waitForFunction(() => globalThis.location.hash === '#routes')
			await out.filter({ hasText: 'Rutas|open,close' }).waitFor()
			await page.waitForFunction(() => !globalThis.document.querySelector('dialog.meeko-ui-command[open]'))

			// The field keeps the search, and opening again selects it. New results go to the first row.
			await page.locator('.meeko-ui-command-trigger').click()
			await dialog.waitFor()
			assert.equal(await input.inputValue(), 'todo')
			assert.equal(await input.evaluate((element) => [element.selectionStart, element.selectionEnd].join()), '0,4')
			await input.fill('rutas')
			await page.waitForFunction(() => globalThis.document.querySelector('#palette-out').textContent.endsWith('|0'))

			// Escape and the backdrop close it; `/` opens it outside a field only.
			await page.keyboard.press('Escape')
			await page.waitForFunction(() => !globalThis.document.querySelector('dialog.meeko-ui-command[open]'))
			await page.keyboard.press('/')
			await dialog.waitFor()
			await page.mouse.click(4, 880)
			await page.waitForFunction(() => !globalThis.document.querySelector('dialog.meeko-ui-command[open]'))
			await dialog.waitFor({ state: 'hidden' })
			await page.locator('label[for=plain]').click()
			await page.keyboard.press('/')
			assert.equal(await page.locator('dialog.meeko-ui-command[open]').count(), 0, '/ inside a select is not a shortcut')

			// A second palette, with buttons, only by its model, without its shortcut.
			await page.locator('#open-actions').click()
			const actions = page.getByRole('dialog', { name: 'Acciones', exact: true })
			await actions.waitFor()
			assert.equal(
				await actions
					.getByRole('option')
					.first()
					.evaluate((element) => [element.localName, element.getAttribute('type')].join()),
				'button,button',
			)
			await actions.getByRole('option', { name: 'Mover', exact: true }).click()
			await out.filter({ hasText: 'Mover|' }).waitFor()
			assert.deepEqual(errors, [])
			await page.close()
		})

		await t.test('UISelect native: late options, a value that leaves, offset, placement and reactive copy', async () => {
			const { page, errors } = await open(browser, origin)
			const plain = page.locator('#plain')
			const chosen = () => plain.evaluate((element) => element.selectedOptions[0]?.textContent)
			assert.equal(await page.getByRole('combobox', { name: 'Plan', exact: true }).count(), 1)
			assert.equal(await chosen(), 'Equipo')
			assert.equal(await plain.locator('option[hidden]').count(), 0, 'no stand-in option while the options hold the value')
			await page.locator('#more').click()
			await page.waitForFunction(() => globalThis.document.querySelectorAll('#plain option').length === 3)
			assert.equal(await chosen(), 'Equipo', 'the choice survives new options')
			await page.locator('#none').click()
			await page.waitForFunction(() => globalThis.document.querySelectorAll('#plain option').length === 2)
			assert.equal(await chosen(), 'Equipo', 'a value that left stays visible, as it stays in the model')
			assert.equal(await plain.locator('option[hidden]').evaluate((option) => globalThis.getComputedStyle(option).display), 'none', 'the stand-in option never shows in the list')
			assert.match(await page.locator('#select-out').innerText(), /^Equipo\|/)
			assert.equal(await plain.evaluate((element) => element.value), 'Equipo', 'and the form still sends it')
			await page.getByRole('button', { name: 'Quitar selección', exact: true }).click()
			await page.locator('#select-out', { hasText: /^(?:null)?\|/ }).waitFor({ timeout: 5000 })
			assert.equal(await chosen(), 'Elige')

			const rich = page.locator('#rich')
			assert.equal(await rich.evaluate((element) => element.selectedOptions[0]?.querySelector('span:last-of-type')?.textContent), 'Carla')
			if (name === 'firefox') {
				assert.equal(await rich.evaluate((element) => globalThis.getComputedStyle(element).appearance), 'auto', 'Firefox stays with its own select')
			} else {
				assert.equal(await rich.locator('[data-meeko-select-value]').innerText(), 'Carla', 'with an option snippet, the trigger still shows the label')
				assert.equal(await rich.evaluate((element) => element.querySelectorAll('[id]').length), 0, 'no id inside the options, which the copy would duplicate')
				await rich.click()
				const option = rich.locator('option', { hasText: 'Ana' })
				await option.waitFor()
				await rich.evaluate((element) =>
					Promise.all(
						element.ownerDocument
							.getAnimations()
							.filter((animation) => animation.effect?.pseudoElement === '::picker(select)')
							.map((animation) => animation.finished),
					),
				)
				const [box, list] = await Promise.all([rich.boundingBox(), option.boundingBox()])
				assert.ok(list.y + list.height <= box.y, `placement="top-start" opens above: ${JSON.stringify({ box, list })}`)
				assert.equal(await rich.locator('option', { hasText: 'Bea' }).evaluate((element) => element.disabled), true)
				await option.click()
				await page.locator('#select-out', { hasText: '|Ana' }).waitFor()
				await rich.locator('[data-meeko-select-value]', { hasText: 'Ana' }).waitFor()
			}
			assert.deepEqual(errors, [])
			await page.close()
		})

		await t.test('UIThemeToggle: the theme is on <html> inside the transition', async () => {
			const { page, errors } = await open(browser, origin)
			await page.getByRole('radio', { name: 'Oscuro', exact: true }).click()
			await page.waitForFunction(() => globalThis.document.documentElement.dataset.theme === 'dark')
			if (name !== 'firefox' || (await page.evaluate(() => typeof globalThis.document.startViewTransition === 'function'))) {
				assert.deepEqual(await types(page), ['ui-theme'])
				// Set inside the callback: the update promise settles with the attribute already written.
				const sync = await page.evaluate(async () => {
					const entry = globalThis.meekoTransitions.at(-1)
					await entry.transition.updateCallbackDone
					return globalThis.document.documentElement.dataset.theme
				})
				assert.equal(sync, 'dark')
				await finished(page)
			}
			assert.deepEqual(errors, [])
			await page.close()
		})
	})
}
