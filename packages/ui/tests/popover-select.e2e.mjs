import assert from 'node:assert/strict'
import test from 'node:test'

import { startDemo } from './helpers/demo.mjs'

/** The box of an element, or of the popover that holds it. */
const rect = (locator, popover = false) =>
	locator.evaluate((element, outer) => {
		const box = (outer ? element.closest('[data-meeko-popover]') : element).getBoundingClientRect()
		return { top: Math.round(box.top), bottom: Math.round(box.bottom), left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) }
	}, popover)

async function open(browser, origin, route) {
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	// Kept for the diagnostic of an intermittent failure: see lastPress.
	await page.addInitScript(() => {
		globalThis.addEventListener(
			'pointerdown',
			(event) => {
				const target = event.target
				globalThis.__lastPress = { x: event.clientX, y: event.clientY, target: target.outerHTML?.slice(0, 200), insideSelect: Boolean(target.closest?.('[data-meeko-select]')) }
			},
			true,
		)
	})
	await page.goto(origin + route, { waitUntil: 'networkidle' })
	await page.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0)
	return { errors, page }
}

/** The target and the coordinates of the last press of the page, as a text for the report of a test. */
const lastPress = async (page) => `last pointerdown: ${JSON.stringify(await page.evaluate(() => globalThis.__lastPress ?? null))}`

const focusedText = (page) => page.evaluate(() => globalThis.document.activeElement?.textContent?.trim() ?? '')

test('UIPopover documents a keyboard menu, a light dialog and a tooltip that never takes the focus', { timeout: 120_000 }, async (context) => {
	const { browser, origin, output } = await startDemo(context)
	const { errors, page } = await open(browser, origin, '/popover')

	// 1. Menu with the keyboard: Enter opens it on the first item, the arrows and a letter move, Enter chooses.
	const trigger = page.getByRole('button', { name: 'Acciones del proyecto', exact: true })
	const menu = page.getByRole('menu')
	await trigger.focus()
	await page.keyboard.press('Enter')
	await menu.waitFor({ state: 'visible' })
	await page.waitForFunction(() => globalThis.document.activeElement?.textContent?.trim() === 'Renombrar')
	assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
	await page.keyboard.press('ArrowDown')
	assert.equal(await focusedText(page), 'Duplicar')
	await page.keyboard.press('a')
	assert.equal(await focusedText(page), 'Archivar', 'typeahead')
	await page.keyboard.press('End')
	assert.equal(await focusedText(page), 'Archivar')
	await page.keyboard.press('Home')
	assert.equal(await focusedText(page), 'Renombrar')
	await page.keyboard.press('ArrowUp')
	assert.equal(await focusedText(page), 'Archivar', 'the arrows wrap around')
	// Anchored below its trigger, aligned to its start and with its offset, once it has slid in.
	await menu.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
	const button = await rect(trigger)
	const list = await rect(menu)
	assert.ok(Math.abs(list.top - button.bottom - 6) <= 1 && Math.abs(list.left - button.left) <= 1, JSON.stringify({ button, list }))
	await page.keyboard.press('Enter')
	await page.locator('#menu-status', { hasText: 'Proyecto archivado.' }).waitFor()
	await menu.waitFor({ state: 'hidden' })
	assert.equal(await page.evaluate(() => globalThis.document.activeElement?.textContent?.trim()), 'Acciones del proyecto', 'the focus goes back to the trigger')
	// Escape closes and gives the focus back; a click outside closes too.
	await page.keyboard.press('ArrowDown')
	await page.waitForFunction(() => globalThis.document.activeElement?.getAttribute('role') === 'menuitem')
	await page.keyboard.press('Escape')
	await menu.waitFor({ state: 'hidden' })
	assert.equal(await focusedText(page), 'Acciones del proyecto')
	await trigger.click()
	await menu.waitFor({ state: 'visible' })
	await page.mouse.click(20, 880)
	await menu.waitFor({ state: 'hidden' })
	await page.waitForFunction(() => [...globalThis.document.querySelectorAll('[data-meeko-popover-trigger]')].some((element) => element.textContent === 'Acciones del proyecto' && element.getAttribute('aria-expanded') === 'false'))
	// A quick reopening with the keyboard: choose an item and, as soon as the menu hides, reopen it
	// with the arrow. The focus must enter the menu every time, although the browser coalesces the
	// toggle events of the closing and the reopening.
	await trigger.focus()
	for (let round = 0; round < 6; round++) {
		await page.keyboard.press('ArrowDown')
		await page.waitForFunction(() => globalThis.document.activeElement?.getAttribute('role') === 'menuitem', undefined, { timeout: 2000 })
		await page.keyboard.press('End')
		await page.keyboard.press('Enter')
		await menu.waitFor({ state: 'hidden' })
		assert.equal(await focusedText(page), 'Acciones del proyecto')
	}
	// The same race, made certain: the arrow arrives before the toggle task of the closing runs.
	const reopened = await page.evaluate(async () => {
		const document = globalThis.document
		const button = [...document.querySelectorAll('[data-meeko-popover-trigger]')].find((element) => element.textContent === 'Acciones del proyecto')
		const content = document.getElementById(button.getAttribute('aria-controls'))
		const frame = () => new Promise((done) => globalThis.requestAnimationFrame(() => globalThis.setTimeout(done, 0)))
		const rounds = []
		for (let round = 0; round < 5; round++) {
			button.focus()
			button.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
			await frame()
			// Choosing an item closes the menu in a microtask; the arrow reopens it right away.
			document.activeElement.click()
			await Promise.resolve()
			const closed = !content.matches(':popover-open') && document.activeElement === button
			button.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
			await frame()
			rounds.push({ closed, open: content.matches(':popover-open') && content.hasAttribute('data-open'), expanded: button.getAttribute('aria-expanded'), role: document.activeElement?.getAttribute('role') })
			document.activeElement.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
			await frame()
		}
		return rounds
	})
	assert.deepEqual(
		reopened,
		Array.from({ length: 5 }, () => ({ closed: true, open: true, expanded: 'true', role: 'menuitem' })),
	)
	await page.locator('#menu-status', { hasText: 'Proyecto renombrado.' }).waitFor()

	// 2. Dialog: the focus enters the content, the model closes it from the action.
	const filters = page.getByRole('button', { name: 'Filtrar', exact: true })
	const dialog = page.getByRole('dialog', { name: 'Filtrar proyectos', exact: true })
	await filters.click()
	await dialog.waitFor({ state: 'visible' })
	await page.waitForFunction(() => globalThis.document.activeElement?.closest('[role=dialog]') !== null)
	await page.screenshot({ path: output + '/popover-dialog.png' })
	await dialog.getByLabel('Publicados').uncheck()
	await dialog.getByLabel('Borradores').check()
	await dialog.getByRole('button', { name: 'Aplicar filtros', exact: true }).click()
	await page.locator('#filters-status', { hasText: 'Mostrando proyectos borradores.' }).waitFor()
	await dialog.waitFor({ state: 'hidden' })

	// 3. Tooltip (mode="hint"): hover opens it without taking the focus, Escape closes it, the focus opens it.
	const help = page.getByRole('button', { name: 'Estado: borrador', exact: true })
	const tooltip = page.locator('[role=tooltip]')
	assert.equal(await help.getAttribute('aria-describedby'), await tooltip.getAttribute('id'))
	await filters.focus()
	await help.hover()
	await tooltip.waitFor({ state: 'visible' })
	assert.equal(await focusedText(page), 'Filtrar', 'the tooltip does not take the focus')
	const tip = await rect(tooltip)
	const helpBox = await rect(help)
	assert.ok(tip.bottom <= helpBox.top, 'placement="top" opens above the trigger')
	await page.keyboard.press('Escape')
	await tooltip.waitFor({ state: 'hidden' })
	await page.mouse.move(20, 880)
	await help.focus()
	await tooltip.waitFor({ state: 'visible' })
	await filters.focus()
	await tooltip.waitFor({ state: 'hidden' })

	// 4. The page fits a phone without horizontal scrolling.
	await page.setViewportSize({ width: 390, height: 844 })
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	assert.deepEqual(errors, [])
})

test('the active row looks the same in UISelect, UICombobox and UICommandPalette, in both themes', { timeout: 180_000 }, async (context) => {
	const { browser, origin } = await startDemo(context)
	const look = (row) =>
		row.evaluate((element) => {
			const style = globalThis.getComputedStyle(element)
			return { background: style.backgroundColor, ring: style.boxShadow }
		})
	const setTheme = (page, theme) => page.evaluate((value) => globalThis.document.documentElement.setAttribute('data-theme', value), theme)
	for (const theme of ['light', 'dark']) {
		const { errors, page } = await open(browser, origin, '/select')
		await setTheme(page, theme)
		await page.locator('#plan').focus()
		await page.keyboard.press('Enter')
		await page.waitForFunction(() => globalThis.document.getElementById('plan').matches(':open'))
		await page.keyboard.press('ArrowDown')
		const select = await look(page.locator('#plan option:focus'))
		await page.keyboard.press('Escape')

		await page.getByRole('combobox', { name: 'Temas', exact: true }).click()
		await page.keyboard.press('ArrowDown')
		const combobox = await look(page.locator('[data-meeko-select-list] [role="option"][data-active]'))
		await page.keyboard.press('Escape')

		await page.goto(origin + '/overlays', { waitUntil: 'networkidle' })
		await page.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0)
		await setTheme(page, theme)
		await page.locator('.meeko-ui-command-trigger').first().click()
		await page.locator('dialog.meeko-ui-command[open] input').fill('a')
		const palette = await look(page.locator('.meeko-ui-command-row[data-active]'))

		assert.notEqual(palette.ring, 'none', theme)
		assert.deepEqual(select, palette, `UISelect, ${theme}`)
		assert.deepEqual(combobox, palette, `UICombobox, ${theme}`)
		assert.deepEqual(errors, [])
		await page.close()
	}
})

test('UISelect documents keyboard and mouse choice, search, multiple with max and native form submission', { timeout: 120_000 }, async (context) => {
	const { browser, origin, output } = await startDemo(context)
	const { errors, page } = await open(browser, origin, '/select')
	const sent = page.locator('#select-sent')
	const initial = await sent.innerText()

	// 1. Required: the form does not submit, the select shows its error and takes the focus.
	const plan = page.locator('#plan')
	const send = page.getByRole('button', { name: 'Enviar selección', exact: true })
	assert.equal(await page.getByRole('combobox', { name: 'Plan', exact: true }).count(), 1, 'the <label for> names the trigger')
	await send.click()
	assert.equal(await sent.innerText(), initial)
	assert.equal(await plan.getAttribute('aria-invalid'), 'true')
	await page.getByRole('alert').filter({ hasText: 'Elige un plan para continuar.' }).waitFor()
	assert.equal(await plan.getAttribute('aria-describedby'), 'plan-error')
	assert.equal(await page.evaluate(() => globalThis.document.activeElement?.id), 'plan')

	// 2. A native select: the browser brings the keyboard, the list and the form value.
	const chosen = (select) => select.evaluate((element) => element.selectedOptions[0]?.textContent?.trim())
	const opened = (select) => select.evaluate((element) => element.matches(':open'))
	assert.equal(await plan.evaluate((element) => element.localName), 'select')
	assert.equal(await chosen(plan), 'Elige un plan', 'the placeholder, so the browser does not pick an option')
	await page.keyboard.press('Enter')
	await page.waitForFunction(() => globalThis.document.getElementById('plan').matches(':open'))
	await page.keyboard.press('End')
	assert.equal(await focusedText(page), 'Educación')
	await page.screenshot({ path: output + '/select-open.png' })
	await page.keyboard.press('Enter')
	await page.waitForFunction(() => !globalThis.document.getElementById('plan').matches(':open'))
	assert.equal(await chosen(plan), 'Educación')
	assert.equal(await plan.locator('selectedcontent').innerText(), 'Educación', 'the copy of the option is up to date')
	assert.equal(await plan.getAttribute('aria-invalid'), null, 'a value clears the error')
	assert.equal(await page.getByRole('alert').count(), 0)
	assert.equal(await page.evaluate(() => globalThis.document.activeElement?.id), 'plan')
	// And with the mouse. The list matches the width of its trigger, below it.
	await plan.click()
	// The same role query as the applications' tests: the option of a native select is still an `option`.
	const option = page.getByRole('option', { name: 'Empresa', exact: true })
	await option.waitFor()
	await plan.evaluate(() => globalThis.document.getAnimations().find((animation) => animation.effect?.pseudoElement === '::picker(select)')?.finished)
	const trigger = await rect(plan)
	const entry = await rect(option)
	assert.ok(entry.top >= trigger.bottom - 1 && entry.width <= trigger.width, JSON.stringify({ trigger, entry }))
	await option.click()
	assert.equal(await chosen(plan), 'Empresa')
	assert.equal(await opened(plan), false)

	// 3. Search and multiple with max: typing filters without accents, Enter adds, max blocks the rest.
	const topics = page.locator('#topics')
	const topicList = page.locator('#' + (await topics.getAttribute('aria-controls')))
	await topics.click()
	await topics.pressSequentially('diseno')
	await page.waitForFunction(() => [...globalThis.document.querySelectorAll('#' + globalThis.document.getElementById('topics').getAttribute('aria-controls') + ' [role=option]')].map((option) => option.textContent.trim()).join() === 'Diseño')
	await page.keyboard.press('Enter')
	assert.equal(await topics.inputValue(), '')
	await topicList.getByRole('option', { name: 'Accesibilidad', exact: true }).click()
	const blocked = topicList.getByRole('option', { name: 'Pruebas', exact: true })
	assert.equal(await blocked.getAttribute('aria-disabled'), 'true', 'max=2 reached')
	await blocked.click({ force: true })
	assert.equal(await topicList.locator('[aria-selected=true]').count(), 2)
	// It closed in 2 of 25 runs, with no confirmed cause: only then, report where the forced click landed.
	if ((await topics.getAttribute('aria-expanded')) !== 'true') context.diagnostic(await lastPress(page))
	assert.equal(await topics.getAttribute('aria-expanded'), 'true', 'a multiple select stays open')
	await page.keyboard.press('Escape')
	assert.equal(await topics.getAttribute('aria-expanded'), 'false')
	assert.deepEqual(await page.locator('#select-form [data-meeko-select] > [data-meeko-select-values] [data-meeko-select-value]').allInnerTexts(), ['Diseño', 'Accesibilidad'])

	// 4. The native form submits one hidden input per value.
	await send.click()
	await sent.filter({ hasText: 'plan=' }).waitFor()
	assert.equal(await sent.innerText(), 'Enviado en este ejemplo: plan=Empresa · topics=Diseño · topics=Accesibilidad')

	// 5. Objects: groups, a disabled option and a typed option snippet.
	const owner = page.locator('#owner')
	await owner.click()
	await page.locator('#owner option', { hasText: 'Sofía Ramos' }).waitFor()
	assert.deepEqual(await owner.locator('[data-meeko-select-group-label]').allInnerTexts(), ['Diseño', 'Ingeniería'])
	assert.equal(await owner.locator('option', { hasText: 'Mateo Gil' }).evaluate((option) => option.disabled), true)
	await owner.locator('option', { hasText: 'Sofía Ramos' }).click()
	await page.locator('#owner-status', { hasText: 'Sofía Ramos es responsable de ingeniería.' }).waitFor()
	await owner.locator('[data-meeko-select-value]', { hasText: 'Sofía Ramos' }).waitFor()
	// 6. Clearable: the button appears with a value, is named for assistive technology and empties the select.
	const clear = page.getByRole('button', { name: 'Quitar selección', exact: true })
	assert.equal(await clear.count(), 1)
	await clear.click()
	await page.locator('#owner-status', { hasText: 'Sin responsable asignado.' }).waitFor()
	await page.waitForFunction(() => /Asigna una persona/.test(globalThis.document.querySelector('#owner selectedcontent')?.textContent ?? ''))
	assert.equal(await clear.count(), 0, 'nothing left to clear')
	assert.equal(await page.evaluate(() => globalThis.document.activeElement?.id), 'owner', 'the focus goes back to the trigger')

	await page.setViewportSize({ width: 390, height: 844 })
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true)
	assert.deepEqual(errors, [])
})

test('UIThemeToggle cycles with the keyboard, moves a radio group with the arrows and works without JavaScript', { timeout: 120_000 }, async (context) => {
	const { browser, origin, output } = await startDemo(context)
	const { errors, page } = await open(browser, origin, '/theme-toggle')
	const theme = () => page.evaluate(() => globalThis.document.documentElement.dataset.themeChoice)
	const applied = () => page.evaluate(() => globalThis.document.documentElement.dataset.theme)
	const cycle = page.locator('#theme-cycle button')
	const radios = page.locator('#theme-select [role=radio]')
	const checked = () => page.locator('#theme-select [role=radio][aria-checked=true]').innerText()
	await page.evaluate(() => {
		globalThis.themeToggleMarker = 'retained'
	})

	// 1. Cycle mode: Enter moves to the next choice at once, and the accessible name follows it.
	assert.equal(await theme(), 'dark')
	assert.equal(await applied(), 'dark')
	assert.equal(await cycle.getAttribute('aria-label'), 'Tema: oscuro. Cambiar a sistema')
	await cycle.focus()
	await page.keyboard.press('Enter')
	await page.waitForFunction(() => globalThis.document.documentElement.dataset.themeChoice === 'system')
	assert.equal(await cycle.getAttribute('aria-label'), 'Tema: sistema. Cambiar a claro')
	assert.equal(await applied(), 'light', 'system follows prefers-color-scheme')
	await page.getByRole('status').filter({ hasText: 'Elección: sistema.' }).waitFor()
	await page.keyboard.press('Space')
	await page.waitForFunction(() => globalThis.document.documentElement.dataset.themeChoice === 'light')
	assert.equal(await cycle.getAttribute('aria-label'), 'Tema: claro. Cambiar a oscuro')
	assert.equal(await page.evaluate(() => globalThis.themeToggleMarker), 'retained', 'no navigation with JavaScript')

	// 2. Select mode: one radio in the tab order; the arrows, Home and End move the focus and the choice.
	assert.equal(await page.getByRole('radiogroup', { name: 'Tema', exact: true }).count(), 1)
	assert.equal(await checked(), 'Claro', 'both toggles share the preference')
	assert.deepEqual(await radios.evaluateAll((elements) => elements.map((element) => element.tabIndex)), [0, -1, -1])
	await page.locator('#theme-select [role=radio][aria-checked=true]').focus()
	await page.keyboard.press('ArrowRight')
	await page.waitForFunction(() => globalThis.document.documentElement.dataset.themeChoice === 'dark')
	assert.equal(await focusedText(page), 'Oscuro')
	assert.equal(await checked(), 'Oscuro')
	await page.keyboard.press('End')
	await page.waitForFunction(() => globalThis.document.documentElement.dataset.themeChoice === 'system')
	assert.equal(await focusedText(page), 'Sistema')
	await page.keyboard.press('ArrowRight')
	await page.waitForFunction(() => globalThis.document.documentElement.dataset.themeChoice === 'light')
	assert.equal(await focusedText(page), 'Claro', 'the arrows wrap around')
	await page.keyboard.press('ArrowLeft')
	await page.waitForFunction(() => globalThis.document.documentElement.dataset.themeChoice === 'system')
	await page.keyboard.press('Home')
	await page.waitForFunction(() => globalThis.document.documentElement.dataset.themeChoice === 'light')
	assert.deepEqual(await radios.evaluateAll((elements) => elements.map((element) => element.tabIndex)), [0, -1, -1])
	assert.equal(await cycle.getAttribute('aria-label'), 'Tema: claro. Cambiar a oscuro')
	await page.screenshot({ path: output + '/theme-toggle.png' })
	assert.deepEqual(errors, [])

	// 3. Without JavaScript the form posts the choice and the server comes back to the same page.
	const ssr = await browser.newPage({ javaScriptEnabled: false })
	await ssr.goto(origin + '/theme-toggle')
	await Promise.all([ssr.waitForResponse((response) => response.url().endsWith('/_meeko/theme')), ssr.locator('#theme-select [role=radio]', { hasText: 'Claro' }).click()])
	await ssr.waitForLoadState()
	assert.equal(new URL(ssr.url()).pathname, '/theme-toggle', 'the server comes back to the same page')
	assert.equal(await ssr.locator('#theme-select [role=radio][aria-checked=true]').innerText(), 'Claro')
	assert.equal((await ssr.context().cookies()).find((cookie) => cookie.name === 'meeko-theme')?.value, 'light')
})
