import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { createNativeApp } from './helpers/native-app.mjs'

const route = "import { definePage } from '@meekojs/meeko/framework'\nexport const route = definePage({ render: 'prerender' })\n"

const menuPage = `<script lang="ts">
	import { signal } from '@meekojs/meeko'

	const log = signal<string[]>([])
	const push = (entry: string) => (log.value = [...log.value, entry])
	const items = [
		{ label: 'Renombrar', value: 'rename', shortcut: 'F2', onSelect: () => push('onSelect:rename') },
		{ label: 'Duplicar', value: 'duplicate' },
		{ label: 'Archivar', value: 'archive', disabled: true },
		{ separator: true as const },
		{ label: 'Descargar', value: 'download' },
		{ label: 'Otra página', to: '/other' },
		{ label: 'Eliminar', value: 'delete', tone: 'danger' as const },
	]
</script>

<template>
	<main style="padding: 48px; display: flex; gap: 48px; align-items: start;">
		<UIMenu triggerLabel="Acciones" bind:items="items" on:select="(item) => push('select:' + item.label)" />
		<button id="after" type="button">Después</button>
		<UIMenu bind:items="[{ label: 'Uno' }]" />
		<p id="log">{log.value.join('|')}</p>
	</main>
</template>
`

const segmentedPage = `<script lang="ts">
	import { signal } from '@meekojs/meeko'

	const days = signal('30')
	const options = [{ value: '7', label: '7 días' }, { value: '30', label: '30 días' }, { value: '90', label: '90 días' }]
	const many = ['Hoy', 'Esta semana', 'Este mes', 'Este trimestre', 'Este año', 'Todo el histórico'].map((label, index) => ({ value: String(index), label }))
</script>

<template>
	<main style="padding: 16px;">
		<form id="form" method="get" action="/segmented">
			<UISegmentedControl legend="Periodo" hideLegend size="sm" name="days" model="days" bind:options="options" />
			<button id="send" type="submit">Enviar</button>
		</form>
		<p id="days">{days.value}</p>
		<div id="narrow" style="width: 240px;">
			<UISegmentedControl ariaLabel="Intervalo" name="range" bind:options="many" />
		</div>
	</main>
</template>
`

const launch = () => chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })

async function visit(browser, origin, path, options = {}) {
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options })
	const tab = await context.newPage()
	const errors = []
	tab.on('pageerror', (error) => errors.push(error.message))
	tab.on('console', (message) => {
		if ((message.type() === 'error' && !message.text().includes('404')) || /hydrat/i.test(message.text())) errors.push(message.text())
	})
	await tab.goto(origin + path, { waitUntil: 'networkidle' })
	if (options.javaScriptEnabled !== false) await tab.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0)
	return { context, errors, tab }
}

const focused = (tab) => tab.evaluate(() => globalThis.document.activeElement?.textContent?.trim() ?? '')
const isOpen = (tab, index = 0) => tab.evaluate((at) => globalThis.document.querySelectorAll('[role=menu]')[at].matches(':popover-open'), index)

test('UIMenu and UISegmentedControl in Chromium', { timeout: 240_000 }, async (t) => {
	const { origin } = await createNativeApp(t, { 'app/pages/menu.meeko': menuPage, 'app/pages/menu.route.ts': route, 'app/pages/segmented.meeko': segmentedPage, 'app/pages/segmented.route.ts': route })
	const browser = await launch()
	t.after(() => browser.close())

	await t.test('the keyboard of a menu button: arrows, Home, End, typeahead, Esc and Tab', async () => {
		const { context, errors, tab } = await visit(browser, origin, '/menu')
		const trigger = tab.getByRole('button', { name: 'Acciones', exact: true })
		await trigger.focus()
		await tab.keyboard.press('ArrowDown')
		await tab.waitForFunction(() => globalThis.document.activeElement?.getAttribute('role') === 'menuitem')
		assert.equal(await isOpen(tab), true)
		assert.equal(await trigger.getAttribute('aria-expanded'), 'true')
		assert.equal(await focused(tab), 'RenombrarF2', 'ArrowDown opens on the first item')
		await tab.keyboard.press('ArrowDown')
		await tab.keyboard.press('ArrowDown')
		assert.equal(await focused(tab), 'Descargar', 'the disabled item and the separator are skipped')
		await tab.keyboard.press('End')
		assert.equal(await focused(tab), 'Eliminar')
		await tab.keyboard.press('ArrowDown')
		assert.equal(await focused(tab), 'RenombrarF2', 'the arrows wrap around')
		await tab.keyboard.press('Home')
		await tab.keyboard.press('o')
		assert.equal(await focused(tab), 'Otra página', 'typeahead')
		await tab.keyboard.press('Escape')
		assert.equal(await isOpen(tab), false)
		assert.equal(await focused(tab), 'Acciones', 'Esc gives the focus back to the trigger')
		await tab.keyboard.press('ArrowUp')
		await tab.waitForFunction(() => globalThis.document.activeElement?.textContent === 'Eliminar')
		await tab.keyboard.press('Tab')
		assert.equal(await isOpen(tab), false, 'Tab closes the menu')
		assert.equal(await tab.evaluate(() => globalThis.document.activeElement?.id), 'after', 'and moves on from the trigger')
		assert.deepEqual(errors, [])
		await context.close()
	})

	await t.test('choosing an item: onSelect, the select event, closing and the focus on the trigger', async () => {
		const { context, errors, tab } = await visit(browser, origin, '/menu')
		const trigger = tab.getByRole('button', { name: 'Acciones', exact: true })
		await trigger.focus()
		await tab.keyboard.press('Enter')
		await tab.waitForFunction(() => globalThis.document.activeElement?.getAttribute('role') === 'menuitem')
		assert.equal(await focused(tab), 'RenombrarF2', 'Enter opens on the first item')
		await tab.keyboard.press('Enter')
		await tab.waitForFunction(() => globalThis.document.querySelector('#log')?.textContent === 'onSelect:rename|select:Renombrar')
		assert.equal(await isOpen(tab), false)
		assert.equal(await focused(tab), 'Acciones')
		// The pointer, on a disabled item: nothing happens and the menu stays open.
		await trigger.click()
		// Playwright waits for an aria-disabled element to be enabled: the pointer clicks where it is.
		const archive = await tab.getByRole('menuitem', { name: 'Archivar' }).boundingBox()
		await tab.mouse.click(archive.x + archive.width / 2, archive.y + archive.height / 2)
		assert.equal(await isOpen(tab), true)
		assert.equal(await tab.locator('#log').textContent(), 'onSelect:rename|select:Renombrar')
		await tab.getByRole('menuitem', { name: 'Eliminar' }).click()
		await tab.waitForFunction(() => globalThis.document.querySelector('#log')?.textContent?.endsWith('|select:Eliminar'))
		assert.equal(await isOpen(tab), false)
		// The icon-only trigger has the name of the messages.
		const dots = tab.getByRole('button', { name: 'Más acciones' })
		await dots.click()
		assert.equal(await isOpen(tab, 1), true)
		// The `toggle` event, which moves the focus inside, comes a task after the opening.
		await tab.waitForFunction(() => globalThis.document.activeElement?.textContent === 'Uno')
		assert.deepEqual(errors, [])
		await context.close()
	})

	await t.test('a link item navigates on the client with MeekoLink', async () => {
		const { context, errors, tab } = await visit(browser, origin, '/menu')
		await tab.evaluate(() => (globalThis.marker = 'kept'))
		await tab.getByRole('button', { name: 'Acciones', exact: true }).click()
		await tab.getByRole('menuitem', { name: 'Otra página' }).click()
		await tab.waitForSelector('#other')
		assert.equal(await tab.evaluate(() => globalThis.marker), 'kept', 'no full reload')
		assert.deepEqual(errors, [])
		await context.close()
	})

	await t.test('without JavaScript, the menu opens with popovertarget and a segmented control submits its form', async () => {
		const { context, tab } = await visit(browser, origin, '/menu', { javaScriptEnabled: false })
		await tab.getByRole('button', { name: 'Acciones', exact: true }).click()
		assert.equal(await isOpen(tab), true)
		await context.close()
		const plain = await visit(browser, origin, '/segmented', { javaScriptEnabled: false })
		await plain.tab.getByRole('radio', { name: '90 días' }).click()
		await Promise.all([plain.tab.waitForURL(/days=90/), plain.tab.click('#send')])
		await plain.context.close()
	})

	await t.test('a segmented control: native arrows, the model and a track that scrolls inside its width', async () => {
		const { context, errors, tab } = await visit(browser, origin, '/segmented', { viewport: { width: 390, height: 800 } })
		const group = tab.getByRole('group', { name: 'Periodo' })
		assert.equal(await group.isVisible(), true, 'the hidden legend still names the group')
		assert.equal(await tab.locator('legend').evaluate((legend) => legend.getBoundingClientRect().width <= 1), true)
		await tab.getByRole('radio', { name: '30 días' }).focus()
		await tab.keyboard.press('ArrowRight')
		await tab.waitForFunction(() => globalThis.document.querySelector('#days')?.textContent === '90')
		assert.equal(await tab.getByRole('radio', { name: '90 días' }).isChecked(), true)
		// The height of the whole control is the one of a small control.
		const heights = await tab.evaluate(() => {
			const track = globalThis.document.querySelector('fieldset > div')
			return { track: track.getBoundingClientRect().height, control: parseFloat(globalThis.getComputedStyle(globalThis.document.documentElement).getPropertyValue('--ui-control-height-sm')) * parseFloat(globalThis.getComputedStyle(globalThis.document.documentElement).fontSize) }
		})
		assert.ok(Math.abs(heights.track - heights.control) < 1, JSON.stringify(heights))
		const narrow = await tab.evaluate(() => {
			const track = globalThis.document.querySelector('#narrow fieldset > div')
			const labels = [...track.querySelectorAll('label')].map((label) => label.getBoundingClientRect().height)
			return { scroll: track.scrollWidth, width: track.clientWidth, box: track.getBoundingClientRect().width, labels, page: globalThis.document.documentElement.scrollWidth, viewport: globalThis.document.documentElement.clientWidth }
		})
		assert.ok(narrow.scroll > narrow.width, 'the track scrolls')
		assert.ok(narrow.box <= 240, 'inside the width of its container')
		assert.equal(new Set(narrow.labels.map(Math.round)).size, 1, 'no option breaks into lines')
		assert.ok(narrow.page <= narrow.viewport, 'the page does not get wider')
		// The focus reaches the last option and the track scrolls to show it.
		await tab.getByRole('radio', { name: 'Hoy' }).check()
		await tab.getByRole('radio', { name: 'Hoy' }).focus()
		await tab.keyboard.press('ArrowLeft')
		assert.equal(await tab.getByRole('radio', { name: 'Todo el histórico' }).isChecked(), true)
		assert.ok((await tab.evaluate(() => globalThis.document.querySelector('#narrow fieldset > div').scrollLeft)) > 0)
		assert.deepEqual(errors, [])
		await context.close()
	})
})
