import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium, firefox, webkit } from 'playwright-core'

import { createNativeApp } from './helpers/native-app.mjs'

/** Firefox and WebKit run only when their Playwright builds are installed; Chrome always runs. */
const engines = {
	chrome: () => chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true }),
	firefox: () => firefox.launch({ headless: true }),
	webkit: () => webkit.launch({ headless: true }),
}

const delay = 120
const closeDelay = 90

const tips = `<script lang="ts">
	import { signal } from '@meekojs/meeko'

	const external = signal('external-a')
	const shown = signal(true)
	const firstTrigger = signal(true)
	const mounted = signal(true)
</script>

<template>
	<main style="padding: 96px 48px; display: flex; flex-wrap: wrap; gap: 48px;">
		<button id="external-a" type="button">Externo A</button>
		<button id="external-b" type="button">Externo B</button>
		<UIPopover mode="hint" bind:triggerId="external.value" class="tip-external" bind:delay="${delay}" bind:closeDelay="${closeDelay}">Externo</UIPopover>
		<UITooltip text="Se va" class="tip-gone" bind:delay="${delay}" bind:closeDelay="${closeDelay}"><snippet name="anchor" params="trigger"><button if:when="shown.value" type="button" bind="trigger">Se va</button></snippet></UITooltip>
		<UITooltip text="Cambia" class="tip-swap" bind:delay="${delay}" bind:closeDelay="${closeDelay}"><snippet name="anchor" params="trigger"><button if:when="firstTrigger.value" type="button" bind="trigger">Uno</button><button if:when="!firstTrigger.value" type="button" bind="trigger">Dos</button></snippet></UITooltip>
		<UITooltip text="Plano" class="tip-plain" bind:delay="${delay}" bind:closeDelay="${closeDelay}"><snippet name="trigger">Plano</snippet></UITooltip>
		<button id="unmount-trigger" type="button">Se desmonta</button>
		<UIPopover if:when="mounted.value" mode="hint" triggerId="unmount-trigger" class="tip-unmount" bind:delay="${delay}">Desmontado</UIPopover>
		<button id="to-b" type="button" on:click="() => (external.value = 'external-b')">Cambiar</button>
		<button id="remove" type="button" on:click="() => (shown.value = false)">Quitar</button>
		<button id="swap" type="button" on:click="() => (firstTrigger.value = !firstTrigger.value)">Sustituir</button>
		<button id="unmount" type="button" on:click="() => (mounted.value = false)">Desmontar</button>
		<MeekoLink id="leave" to="/other">Salir</MeekoLink>
	</main>
</template>
`

/** Every mode with a model that starts open: on its own page, because opening a hint closes any other. */
const startsOpen = (mode) => `<script lang="ts">
	import { signal } from '@meekojs/meeko'

	const open = signal(true)
</script>

<template>
	<main style="padding: 96px 48px;">
		<UIPopover mode="${mode}" role="menu" label="Menú" class="content" model="open" triggerId="trigger" bind:delay="${delay}" bind:closeDelay="${closeDelay}">
			<snippet name="trigger">Disparador</snippet>
			<button type="button" role="menuitem">Primero</button>
			<button type="button" role="menuitem">Último</button>
		</UIPopover>
		<p id="state">{String(open.value)}</p>
	</main>
</template>
`
const startsOpenTip = `<script lang="ts">
	import { signal } from '@meekojs/meeko'

	const open = signal(true)
</script>

<template>
	<main style="padding: 96px 48px;">
		<UITooltip triggerId="trigger" text="De partida" class="content" model="open" bind:delay="${delay}" bind:closeDelay="${closeDelay}"><snippet name="trigger">Disparador</snippet></UITooltip>
		<p id="state">{String(open.value)}</p>
	</main>
</template>
`

const route = "import { definePage } from '@meekojs/meeko/framework'\nexport const route = definePage({ render: 'prerender' })\n"
const pages = {
	'app/pages/tips.meeko': tips,
	'app/pages/tips.route.ts': route,
	'app/pages/open-auto.meeko': startsOpen('auto'),
	'app/pages/open-auto.route.ts': route,
	'app/pages/open-manual.meeko': startsOpen('manual'),
	'app/pages/open-manual.route.ts': route,
	'app/pages/open-hint.meeko': startsOpenTip,
	'app/pages/open-hint.route.ts': route,
}

/** Counts the listeners of the document as the DOM does: removing one that is not there changes nothing. */
function countListeners() {
	const registered = { pointerover: new Set(), focusin: new Set(), keydown: new Set() }
	globalThis.documentListeners = () => Object.fromEntries(Object.entries(registered).map(([type, listeners]) => [type, listeners.size]))
	const add = globalThis.EventTarget.prototype.addEventListener
	const remove = globalThis.EventTarget.prototype.removeEventListener
	globalThis.EventTarget.prototype.addEventListener = function (type, listener, ...rest) {
		if (this === globalThis.document && type in registered) registered[type].add(listener)
		return add.call(this, type, listener, ...rest)
	}
	globalThis.EventTarget.prototype.removeEventListener = function (type, listener, ...rest) {
		if (this === globalThis.document && type in registered) registered[type].delete(listener)
		return remove.call(this, type, listener, ...rest)
	}
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const away = (tab) => tab.mouse.move(2, 2)
const hover = async (tab, locator) => {
	const box = await locator.boundingBox()
	await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}
const isOpen = (tip) => tip.evaluate((element) => element.matches(':popover-open'))
const until = async (tip, wanted, act, limit = 2000) => {
	await act()
	const started = Date.now()
	while (Date.now() - started < limit) {
		if ((await isOpen(tip)) === wanted) return
		await sleep(5)
	}
	throw new Error(`the content did not become ${wanted ? 'open' : 'closed'} in ${limit} ms`)
}

async function visit(browser, origin, path, contextOptions = {}) {
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions })
	const tab = await context.newPage()
	const errors = []
	tab.on('pageerror', (error) => errors.push(error.message))
	tab.on('console', (message) => {
		if ((message.type() === 'error' && !message.text().includes('404')) || /hydrat/i.test(message.text())) errors.push(message.text())
	})
	await tab.addInitScript(countListeners)
	await tab.goto(origin + path, { waitUntil: 'networkidle' })
	await tab.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0)
	return { context, errors, tab }
}

for (const [engine, launch] of Object.entries(engines)) {
	test(`the trigger of a popover in ${engine}`, { timeout: 180_000 }, async (t) => {
		let browser
		try {
			browser = await launch()
		} catch (error) {
			if (engine === 'chrome') throw error
			t.diagnostic(`${engine} is not installed: ${error.message.split('\n')[0]}`)
			return
		}
		t.after(() => browser.close())
		const { origin } = await createNativeApp(t, pages)

		await t.test('a trigger that leaves the document closes its tooltip', async () => {
			const { context, errors, tab } = await visit(browser, origin, '/tips')
			const tip = tab.locator('.tip-gone')
			await until(tip, true, () => hover(tab, tab.getByRole('button', { name: 'Se va', exact: true })))
			await until(tip, false, () => tab.locator('#remove').evaluate((button) => button.click()))
			assert.deepEqual(errors, [])
			await context.close()
		})

		await t.test('another triggerId moves the listeners and closes the tooltip', async () => {
			const { context, errors, tab } = await visit(browser, origin, '/tips')
			const tip = tab.locator('.tip-external')
			await until(tip, true, () => hover(tab, tab.locator('#external-a')))
			await until(tip, false, () => tab.locator('#to-b').evaluate((button) => button.click()))
			await away(tab)
			await sleep(closeDelay + 40)
			await hover(tab, tab.locator('#external-a'))
			await sleep(delay + 100)
			assert.equal(await isOpen(tip), false, 'the old trigger keeps no listener')
			await until(tip, true, () => hover(tab, tab.locator('#external-b')))
			await until(tip, false, () => away(tab))
			assert.deepEqual(errors, [])
			await context.close()
		})

		await t.test('a trigger replaced under the same id keeps working, at the first pass', async () => {
			const { context, errors, tab } = await visit(browser, origin, '/tips')
			const tip = tab.locator('.tip-swap')
			await until(tip, true, () => hover(tab, tab.getByRole('button', { name: 'Uno', exact: true })))
			await until(tip, false, () => away(tab))
			await tab.locator('#swap').evaluate((button) => button.click())
			const second = tab.getByRole('button', { name: 'Dos', exact: true })
			await second.waitFor()
			await until(tip, true, () => hover(tab, second))
			await until(tip, false, () => away(tab))
			// With the keyboard too, and replaced while open it closes.
			await tab.locator('#swap').evaluate((button) => button.click())
			const third = tab.getByRole('button', { name: 'Uno', exact: true })
			await third.waitFor()
			await until(tip, true, () => third.focus())
			await until(tip, false, () => tab.locator('#swap').evaluate((button) => button.click()))
			assert.deepEqual(errors, [])
			await context.close()
		})

		for (const mode of ['auto', 'manual']) {
			await t.test(`mode="${mode}": a model that starts open leaves the keyboard on its trigger`, async () => {
				const { context, errors, tab } = await visit(browser, origin, `/open-${mode}`)
				const content = tab.locator('.content')
				await content.waitFor({ state: 'visible' })
				await tab.locator('#state', { hasText: 'true' }).waitFor()
				await tab.locator('#trigger').focus()
				// The arrow is what the trigger's own listener does: without it the focus stays there.
				await tab.keyboard.press('ArrowUp')
				await tab.waitForFunction(() => globalThis.document.activeElement?.textContent === 'Último', undefined, { timeout: 2000 })
				assert.equal(await isOpen(content), true)
				assert.deepEqual(errors, [])
				await context.close()
			})
		}

		await t.test('mode="hint": a model that starts open leaves the pointer on its trigger', async () => {
			const { context, errors, tab } = await visit(browser, origin, '/open-hint')
			const content = tab.locator('.content')
			await content.waitFor({ state: 'visible' })
			await tab.locator('#state', { hasText: 'true' }).waitFor()
			await hover(tab, tab.locator('#trigger'))
			await sleep(delay + 100)
			assert.equal(await isOpen(content), true)
			await until(content, false, () => away(tab))
			await tab.locator('#state', { hasText: 'false' }).waitFor()
			await until(content, true, () => hover(tab, tab.locator('#trigger')))
			assert.deepEqual(errors, [])
			await context.close()
		})

		await t.test('the tooltips of a page share their document listeners, and none outlives them', async () => {
			const { context, errors, tab } = await visit(browser, origin, '/tips')
			const listeners = () => tab.evaluate(() => globalThis.documentListeners())
			assert.ok((await tab.locator('[data-meeko-popover][popover=hint]').count()) >= 5, 'a page with several of them')
			assert.deepEqual(await listeners(), { pointerover: 1, focusin: 1, keydown: 0 }, 'a closed tooltip listens to no key')
			const tip = tab.locator('.tip-plain')
			const trigger = tab.getByRole('button', { name: 'Plano', exact: true })
			await until(tip, true, () => hover(tab, trigger))
			assert.deepEqual(await listeners(), { pointerover: 1, focusin: 1, keydown: 1 }, 'only the open one does')
			await tab.keyboard.press('Escape')
			await sleep(40)
			assert.equal(await isOpen(tip), false, 'and Escape closes it')
			assert.deepEqual(await listeners(), { pointerover: 1, focusin: 1, keydown: 0 })
			await away(tab)
			await sleep(closeDelay + 40)

			// Unmounting one with its external trigger still there: its listeners go with it.
			const remaining = tab.locator('#unmount-trigger')
			await until(tab.locator('.tip-unmount'), true, () => hover(tab, remaining))
			await tab.locator('#unmount').evaluate((button) => button.click())
			await tab.locator('.tip-unmount').waitFor({ state: 'detached' })
			assert.equal(await tab.locator('[data-meeko-popover]:popover-open').count(), 0, 'nothing stays open')
			assert.deepEqual(await listeners(), { pointerover: 1, focusin: 1, keydown: 0 }, 'the others still share theirs')

			// Unmounting everything, with one open, takes them all away.
			await away(tab)
			await sleep(closeDelay + 40)
			await until(tip, true, () => hover(tab, trigger))
			await tab.locator('#leave').click()
			await tab.locator('#other').waitFor()
			assert.deepEqual(await listeners(), { pointerover: 0, focusin: 0, keydown: 0 })
			assert.deepEqual(errors, [])
			await context.close()
		})
	})
}

test('a popover that is not a hint adds nothing to the document', { timeout: 120_000 }, async (t) => {
	const browser = await engines.chrome()
	t.after(() => browser.close())
	const { origin } = await createNativeApp(t, pages)
	for (const path of ['/open-auto', '/open-manual']) {
		const { context, tab } = await visit(browser, origin, path)
		assert.deepEqual(await tab.evaluate(() => globalThis.documentListeners()), { pointerover: 0, focusin: 0, keydown: 0 }, path)
		await context.close()
	}
})
