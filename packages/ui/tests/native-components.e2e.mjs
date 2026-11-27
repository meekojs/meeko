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
					const names = [...globalThis.document.querySelectorAll('[role=tab] > span')].map((element) => globalThis.getComputedStyle(element).viewTransitionName).filter((value) => value !== 'none')
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
			await page.waitForFunction(() => !globalThis.document.querySelector('dialog[open]:has(> div > input[type="search"][role="combobox"])'))

			// The field keeps the search, and opening again selects it. New results go to the first row.
			await page.getByRole('button', { name: 'Buscar', exact: true }).click()
			await dialog.waitFor()
			assert.equal(await input.inputValue(), 'todo')
			assert.equal(await input.evaluate((element) => [element.selectionStart, element.selectionEnd].join()), '0,4')
			await input.fill('rutas')
			await page.waitForFunction(() => globalThis.document.querySelector('#palette-out').textContent.endsWith('|0'))

			// Escape and the backdrop close it; `/` opens it outside a field only.
			await page.keyboard.press('Escape')
			await page.waitForFunction(() => !globalThis.document.querySelector('dialog[open]:has(> div > input[type="search"][role="combobox"])'))
			await page.locator('body').click({ position: { x: 2, y: 2 } })
			await page.keyboard.press('/')
			await dialog.waitFor()
			await page.mouse.click(4, 880)
			await page.waitForFunction(() => !globalThis.document.querySelector('dialog[open]:has(> div > input[type="search"][role="combobox"])'))
			await dialog.waitFor({ state: 'hidden' })
			await page.locator('label[for=plain]').click()
			await page.keyboard.press('/')
			assert.equal(await page.locator('dialog[open]:has(> div > input[type="search"][role="combobox"])').count(), 0, '/ inside a select is not a shortcut')

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
			await page.locator('#show-exposed').click()
			await page.getByRole('dialog', { name: 'Expuesta', exact: true }).waitFor()
			assert.deepEqual(errors, [])
			await page.close()
		})

		await t.test('UISelect: a list of its own in every engine, with late options, placement, snippets, groups, the keyboard and a form', async () => {
			const { page, errors } = await open(browser, origin)
			// In a flex row it fills the row, like <UIInput>, instead of shrinking to its value.
			assert.deepEqual(await page.locator('#select-row').evaluate((element) => [element.querySelector('[data-meeko-select]'), element.querySelector('[data-meeko-select-trigger]')].map((part) => part.getBoundingClientRect().width)), [400, 400])
			const listOf = async (select) => page.locator('#' + (await select.getAttribute('aria-controls')))
			/** The box of an element, or of the popover that holds it. */
			const rect = (locator, popover = false) =>
				locator.evaluate((element, outer) => {
					const box = (outer ? element.closest('[data-meeko-popover]') : element).getBoundingClientRect()
					return { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), width: Math.round(box.width) }
				}, popover)
			const settled = (list) =>
				list.evaluate((element) =>
					Promise.all(
						element
							.closest('[data-meeko-popover]')
							.getAnimations()
							.map((animation) => animation.finished),
					),
				)
			const focusedId = () => page.evaluate(() => globalThis.document.activeElement?.id)
			const text = async (locator) => (await locator.innerText()).trim()
			/** The text of the option that `aria-activedescendant` names. */
			const active = async (select) => {
				const id = await select.getAttribute('aria-activedescendant')
				return id ? text(page.locator('#' + id)) : undefined
			}
			const rows = (list) => list.locator('[role=option]')

			// Late options, and a value that leaves them.
			const plain = page.locator('#plain')
			const plainList = await listOf(plain)
			assert.equal(await page.getByRole('combobox', { name: 'Plan', exact: true }).count(), 1, 'the <label for> names the trigger')
			assert.deepEqual(await plain.evaluate((element) => [element.localName, element.getAttribute('aria-haspopup'), element.getAttribute('aria-expanded')]), ['button', 'listbox', 'false'])
			assert.equal(await page.locator('select').count(), 0, 'no native select')
			assert.equal(await text(plain), 'Equipo')
			assert.equal(await rows(plainList).count(), 0, 'a closed list has no options')
			await plain.click()
			await plainList.getByRole('option', { name: 'Equipo', exact: true }).waitFor()
			assert.equal(await plain.getAttribute('aria-expanded'), 'true')
			assert.equal(await plainList.getByRole('option', { name: 'Equipo', exact: true }).getAttribute('aria-selected'), 'true')
			await page.keyboard.press('Escape')
			await plainList.waitFor({ state: 'hidden' })
			assert.equal(await plain.getAttribute('aria-expanded'), 'false')
			assert.equal(await focusedId(), 'plain', 'the focus stays on the trigger')
			await page.locator('#more').click()
			await page.waitForFunction((id) => globalThis.document.querySelectorAll(`[id="${id}"] [role=option]`).length === 3, await plain.getAttribute('aria-controls'))
			assert.equal(await text(plain), 'Equipo', 'the choice survives new options')
			assert.equal(await rows(plainList).and(page.locator('[aria-selected=true]')).count(), 1)
			await page.locator('#none').click()
			await page.waitForFunction((id) => globalThis.document.querySelectorAll(`[id="${id}"] [role=option]`).length === 1, await plain.getAttribute('aria-controls'))
			assert.equal(await text(plain), 'Equipo', 'a value that left stays visible, as it stays in the model')
			assert.equal(await rows(plainList).and(page.locator('[aria-selected=true]')).count(), 0)
			assert.match(await page.locator('#select-out').innerText(), /^Equipo\|/)
			assert.equal(await page.locator('input[type=hidden][name=plain]').inputValue(), 'Equipo', 'and the form still sends it')
			await page.getByRole('button', { name: 'Quitar selección', exact: true }).click()
			await page.locator('#select-out', { hasText: /^(?:null)?\|/ }).waitFor({ timeout: 5000 })
			assert.equal(await text(plain), 'Elige', 'the placeholder')
			assert.equal(await page.locator('input[type=hidden][name=plain]').inputValue(), '')
			assert.equal(await page.getByRole('button', { name: 'Quitar selección', exact: true }).count(), 0)
			assert.equal(await focusedId(), 'plain', 'the clear button gives the focus back')

			// Snippets and groups paint the same in every engine; placement and offset place the list.
			const rich = page.locator('#rich')
			const richList = await listOf(rich)
			const chosen = rich.locator('[data-meeko-select-value] strong')
			assert.equal(await chosen.innerText(), 'Carla', 'the value snippet paints the trigger')
			assert.equal(await chosen.getAttribute('data-color'), 'rosa')
			await rich.click()
			const ana = richList.getByRole('option', { name: /^Ana/ })
			await ana.waitFor()
			await settled(richList)
			if (await page.evaluate(() => globalThis.CSS.supports('position-area', 'top'))) {
				const [trigger, list] = [await rect(rich), await rect(richList, true)]
				assert.ok(Math.abs(trigger.top - list.bottom - 10) <= 1 && Math.abs(list.left - trigger.left) <= 1 && list.width >= trigger.width, `placement="top-start" with an offset of 10: ${JSON.stringify({ trigger, list })}`)
			} else t.diagnostic(`${name} has no CSS anchor positioning: the list opens unanchored`)
			assert.deepEqual(await richList.locator('[data-meeko-select-group-label]').allInnerTexts(), ['Equipo de Diseño', 'Equipo de Ingeniería'], 'the group snippet')
			assert.equal(await richList.getByRole('group', { name: 'Equipo de Diseño', exact: true }).getByRole('option').count(), 2)
			assert.equal(await richList.getByRole('group', { name: 'Equipo de Ingeniería', exact: true }).getByRole('option').count(), 1)
			const carla = richList.getByRole('option', { name: /^Carla/ })
			assert.equal(await carla.getAttribute('aria-selected'), 'true')
			assert.match(await carla.innerText(), /Carla\s*\(elegida\)/, 'the option snippet and its state')
			assert.equal(await carla.locator('span[data-color=rosa]').count(), 1)
			assert.equal(await carla.locator('svg[aria-hidden=true]').count(), 1, 'the mark of the chosen option')
			assert.equal(await rows(richList).locator('svg').count(), 1, 'only on the chosen one')
			const bea = richList.getByRole('option', { name: 'Bea', exact: true })
			assert.equal(await bea.getAttribute('aria-disabled'), 'true')
			// Dispatched on the row itself: its handler is the one that refuses a disabled option.
			await bea.evaluate((option) => option.click())
			assert.equal(await rich.getAttribute('aria-expanded'), 'true', 'a disabled option chooses nothing')
			await ana.click()
			await page.locator('#select-out', { hasText: '|Ana' }).waitFor()
			await chosen.filter({ hasText: 'Ana' }).waitFor()
			await richList.waitFor({ state: 'hidden' })
			assert.equal(await rich.getAttribute('aria-expanded'), 'false')
			assert.equal(await focusedId(), 'rich', 'a choice gives the focus back to the trigger')

			// The keyboard of a combobox that only selects, with the focus always on the trigger.
			await page.keyboard.press('ArrowDown')
			await ana.waitFor()
			assert.equal(await rich.getAttribute('aria-expanded'), 'true')
			assert.match(await active(rich), /^Ana/, 'the list opens on the chosen option')
			await page.keyboard.press('ArrowDown')
			assert.match(await active(rich), /^Carla/, 'over the disabled option')
			await page.keyboard.press('ArrowDown')
			assert.match(await active(rich), /^Carla/, 'the arrows stop at the end')
			await page.keyboard.press('Home')
			assert.match(await active(rich), /^Ana/)
			await page.keyboard.press('End')
			assert.match(await active(rich), /^Carla/)
			await page.keyboard.press('a')
			assert.match(await active(rich), /^Ana/, 'typing jumps to the option')
			assert.equal(await focusedId(), 'rich')
			await page.keyboard.press('Escape')
			await richList.waitFor({ state: 'hidden' })
			assert.equal(await rich.getAttribute('aria-expanded'), 'false')
			assert.equal(await rich.getAttribute('aria-activedescendant'), null)
			assert.match(await page.locator('#select-out').innerText(), /\|Ana$/, 'Escape chooses nothing')
			assert.equal(await focusedId(), 'rich')
			await page.keyboard.press('End')
			await carla.waitFor()
			assert.match(await active(rich), /^Carla/, 'End opens on the last option')
			await page.keyboard.press('Space')
			await page.locator('#select-out', { hasText: '|Carla' }).waitFor()
			await richList.waitFor({ state: 'hidden' })
			assert.equal(await rich.getAttribute('aria-expanded'), 'false', 'Space chooses and closes, and its click does not reopen')
			assert.equal(await focusedId(), 'rich')
			await page.keyboard.press('Enter')
			await carla.waitFor()
			await page.keyboard.press('Tab')
			await richList.waitFor({ state: 'hidden' })
			assert.equal(await rich.getAttribute('aria-expanded'), 'false', 'Tab closes')
			assert.notEqual(await focusedId(), 'rich', 'and moves on')
			// A press outside closes it too, and leaves the focus where the press put it.
			await rich.click()
			await carla.waitFor()
			await page.mouse.click(4, 4)
			await richList.waitFor({ state: 'hidden' })
			await page.waitForFunction(() => globalThis.document.getElementById('rich').getAttribute('aria-expanded') === 'false')

			// A form: required, what it sends, a disabled select and the reset.
			const form = page.locator('#select-form')
			const sent = () => form.evaluate((element) => [...new globalThis.FormData(element)].map(([field, value]) => `${field}=${value}`).join('&'))
			const size = page.getByRole('combobox', { name: 'Talla', exact: true })
			const shade = page.getByRole('combobox', { name: 'Color', exact: true })
			const out = page.locator('#form-out')
			assert.equal(await sent(), 'size=&shade=Verde', 'an empty value without a choice, and nothing of a disabled select')
			assert.equal(await page.getByRole('combobox', { name: 'Fijo', exact: true }).isDisabled(), true)
			assert.equal(await size.getAttribute('aria-required'), 'true')
			await page.locator('#select-send').click()
			await page.waitForFunction(() => globalThis.document.activeElement?.getAttribute('aria-label') === 'Talla')
			assert.equal(await size.getAttribute('aria-invalid'), 'true', 'required: the trigger shows the error and takes the focus')
			assert.equal(await out.innerText(), 'null|Verde||', 'and the form is not sent')
			await page.keyboard.press('m')
			await (await listOf(size)).getByRole('option', { name: 'M', exact: true }).waitFor()
			assert.equal(await active(size), 'M')
			await page.keyboard.press('Enter')
			await out.filter({ hasText: 'M|Verde|M|' }).waitFor()
			assert.equal(await size.getAttribute('aria-invalid'), null, 'a value clears the error')
			await shade.click()
			await (await listOf(shade)).getByRole('option', { name: 'Azul', exact: true }).click()
			await out.filter({ hasText: 'M|Azul|M|' }).waitFor()
			assert.equal(await sent(), 'size=M&shade=Azul')
			await page.locator('#select-send').click()
			await out.filter({ hasText: 'M|Azul|M|size=M&shade=Azul' }).waitFor()
			await page.locator('#select-reset').click()
			await out.filter({ hasText: 'null|Verde|M,null|size=M&shade=Azul' }).waitFor()
			assert.equal(await text(size), 'Elige una talla', 'a reset goes back to the value of the first render')
			assert.equal(await text(shade), 'Verde')
			assert.equal(await sent(), 'size=&shade=Verde')
			await page.locator('#select-send').click()
			await page.waitForFunction(() => globalThis.document.activeElement?.getAttribute('aria-label') === 'Talla')
			assert.equal(await size.getAttribute('aria-invalid'), 'true', 'and required holds again')
			assert.equal(await out.innerText(), 'null|Verde|M,null|size=M&shade=Azul')

			// With reduced motion nothing slides or turns.
			await page.emulateMedia({ reducedMotion: 'reduce' })
			await shade.click()
			const shadeList = await listOf(shade)
			await shadeList.getByRole('option', { name: 'Verde', exact: true }).waitFor()
			assert.equal(await shadeList.evaluate((element) => element.closest('[data-meeko-popover]').getAnimations().length), 0)
			assert.equal(await shade.locator('svg').evaluate((icon) => globalThis.getComputedStyle(icon).transitionProperty), 'none')
			await page.keyboard.press('Escape')
			await page.emulateMedia({ reducedMotion: null })
			assert.deepEqual(errors, [])
			await page.close()
		})

		await t.test('UIDrawer: leaves with a View Transition, by every way out, and gives the focus back', async () => {
			const { page, errors } = await open(browser, origin)
			const trigger = page.getByRole('button', { name: 'Abrir panel', exact: true })
			// The drawers of the fixture, by their title: "Panel" enters from the start, "Panel derecho" from the end.
			const dialog = page.locator('dialog', { has: page.locator('h2', { hasText: /^Panel$/ }) })
			const opened = async () => {
				// With the keyboard: WebKit does not focus a button that is clicked, and there would be no focus to give back.
				await trigger.focus()
				await page.keyboard.press('Enter')
				await dialog.and(page.locator('[open]')).waitFor()
				await page.waitForFunction(() => globalThis.document.querySelector('#drawer-out').textContent.startsWith('true'))
				await dialog.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
			}
			const left = async (closes) => {
				await page.locator('#drawer-out', { hasText: `false|${closes}` }).waitFor()
				await finished(page)
				assert.equal(await dialog.evaluate((element) => [element.open, element.hasAttribute('data-meeko-ui-modal-state'), element.hasAttribute('data-meeko-ui-modal-order')].join()), 'false,false,false')
				assert.equal(await trigger.evaluate((element) => element === element.ownerDocument.activeElement), true, 'the focus comes back')
			}
			await opened()
			await page.keyboard.press('Escape')
			await left(1)
			await opened()
			// What the exit looks like: the panel, on its own, with an animation of the old image.
			const exit = await page.evaluate(async () => {
				const dialog = [...globalThis.document.querySelectorAll('dialog')].find((element) => element.querySelector('h2')?.textContent.trim() === 'Panel')
				dialog.querySelector('button[command="close"]').click()
				const entry = globalThis.meekoTransitions.at(-1)
				const name = globalThis.getComputedStyle(dialog).viewTransitionName
				await entry.transition.ready
				return {
					types: entry.types,
					name,
					animations: globalThis.document
						.getAnimations()
						.map((animation) => animation.effect?.pseudoElement)
						.filter((pseudo) => pseudo?.includes('ui-drawer')),
				}
			})
			assert.deepEqual(exit.types, ['ui-modal-close'])
			assert.equal(exit.name, 'ui-drawer-left')
			assert.ok(exit.animations.includes('::view-transition-old(ui-drawer-left)'), JSON.stringify(exit.animations))
			await left(2)
			await opened()
			await page.mouse.click(1200, 400)
			await left(3)
			// `closedBy="none"`, opened by the native command when the browser has it: only its button closes it.
			const right = page.locator('dialog', { has: page.locator('h2', { hasText: /^Panel derecho$/ }) })
			await page.getByRole('button', { name: 'Abrir el derecho', exact: true }).click()
			await right.and(page.locator('[open]')).waitFor()
			await page.keyboard.press('Escape')
			assert.equal(await right.evaluate((element) => element.open), true, 'Escape does not close it')
			await right.locator('button[command="close"]').click()
			await page.waitForFunction(() => ![...globalThis.document.querySelectorAll('dialog')].find((element) => element.querySelector('h2')?.textContent.trim() === 'Panel derecho').open)
			// A link closes it at once and navigates: the scroll lock leaves before the transition of the route,
			// because changing the overflow of the root inside a View Transition crashes WebKit 27.2.
			await opened()
			const crashed = []
			page.on('crash', () => crashed.push(true))
			await page.locator('#drawer-link').click()
			await page.locator('#route-a').waitFor()
			await finished(page)
			assert.deepEqual(crashed, [])
			assert.equal(await page.evaluate(() => globalThis.getComputedStyle(globalThis.document.documentElement).overflowY), 'visible', 'the page scrolls again')
			assert.deepEqual(errors, [])
			await page.close()
		})

		await t.test('UINavigationTabs: the indicator moves with the transition of the navigation', async () => {
			const { page, errors } = await open(browser, origin)
			await page.locator('#to-tabs').click()
			await page.locator('#route-a').waitFor()
			await finished(page)
			const nav = page.getByRole('navigation', { name: 'Rutas', exact: true })
			assert.equal(await nav.locator('a[aria-current]').innerText(), 'Primera pestaña')
			// The indicator is the last child of the row.
			const before = await nav.locator(':scope > span[aria-hidden="true"]').boundingBox()
			const during = await page.evaluate(async () => {
				// Each page mounts its own row: the indicator is looked up again after the navigation.
				const indicator = () => globalThis.document.querySelector('nav[aria-label="Rutas"] > span[aria-hidden="true"]')
				const already = globalThis.meekoTransitions.length
				const name = globalThis.getComputedStyle(indicator()).viewTransitionName
				;[...globalThis.document.querySelectorAll('nav[aria-label="Rutas"] a')].find((link) => link.textContent.trim() === 'Segunda').click()
				const started = Date.now()
				while (globalThis.meekoTransitions.length === already) {
					if (Date.now() - started > 5000) throw new Error('the navigation started no View Transition')
					await new Promise((done) => globalThis.setTimeout(done, 5))
				}
				const entry = globalThis.meekoTransitions.at(-1)
				await entry.transition.ready
				const group = globalThis.document.getAnimations().find((animation) => animation.effect?.pseudoElement === '::view-transition-group(ui-navigation-tabs-indicator)')
				const frames = group?.effect.getKeyframes().map((frame) => frame.transform) ?? []
				return { outside: name, types: entry.types, inside: globalThis.getComputedStyle(indicator()).viewTransitionName, duration: group?.effect.getTiming().duration, first: frames[0], last: frames.at(-1) }
			})
			assert.equal(during.outside, 'none', 'no name outside a navigation')
			assert.deepEqual(during.types, ['meeko-route'])
			assert.equal(during.inside, 'ui-navigation-tabs-indicator')
			assert.ok(during.first && during.last && during.first !== during.last, `the group moves: ${JSON.stringify(during)}`)
			await finished(page)
			await page.locator('#route-b').waitFor()
			assert.equal(await nav.locator('a[aria-current]').innerText(), 'Segunda')
			const after = await nav.locator(':scope > span[aria-hidden="true"]').boundingBox()
			const link = await nav.locator('a[aria-current]').boundingBox()
			assert.ok(after.x > before.x && Math.abs(after.x - link.x) < 1 && Math.abs(after.width - link.width) < 1, JSON.stringify({ before, after, link }))
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
