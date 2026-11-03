import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium, firefox, webkit } from 'playwright-core'

import { createNativeApp } from './helpers/native-app.mjs'

/** Firefox and WebKit run only when their Playwright builds are installed; Chrome always runs. */
const launchers = {
	chrome: () => chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true }),
	firefox: () => firefox.launch({ headless: true }),
	webkit: () => webkit.launch({ headless: true }),
}

/** A delay that nothing else on the page uses: a timer with this value can only be the tooltip's. */
const openDelay = 317
const closeDelay = 163

const page = `<script lang="ts">
	import { effect, signal, untrack } from '@meekojs/meeko'

	const open = signal(false)
	const toggles = signal<boolean[]>([])
	effect(() => {
		const now = open.value
		untrack(() => (toggles.value = [...toggles.value, now]))
	})
	const external = signal('external-a')
	const shown = signal(true)
	const firstTrigger = signal(true)
	const mounted = signal(true)
	const start = signal(${openDelay})
</script>

<template>
	<main style="padding: 96px 48px; display: flex; flex-wrap: wrap; gap: 48px;">
		<button id="before" type="button">Antes</button>
		<UITooltip
			triggerId="plain"
			text="Plano"
			class="tip-plain"
			model="open"
			bind:delay="start.value"
			bind:closeDelay="${closeDelay}"
		><snippet name="trigger">Plano</snippet></UITooltip>
		<UIPopover mode="hint" triggerId="hint" class="tip-hint" bind:offset="6" bind:delay="${openDelay}" bind:closeDelay="${closeDelay}" placement="top"><snippet name="trigger">Popover</snippet>Pista</UIPopover>
		<UITooltip text="Con botón" class="tip-uibutton" bind:delay="${openDelay}"><snippet name="anchor" params="trigger"><UIButton bind="trigger">UIButton</UIButton></snippet></UITooltip>
		<UITooltip text="Enlace" class="tip-link" bind:delay="${openDelay}"><snippet name="anchor" params="trigger"><a href="#enlace" bind="trigger">Enlace</a></snippet></UITooltip>
		<UITooltip text="Sin href" class="tip-nohref" bind:delay="${openDelay}"><snippet name="anchor" params="trigger"><a tabindex="0" bind="trigger">Sin href</a></snippet></UITooltip>
		<UITooltip text="Span" class="tip-span" bind:delay="${openDelay}"><snippet name="anchor" params="trigger"><span tabindex="0" bind="trigger">Span</span></snippet></UITooltip>
		<UITooltip text="Sin reenviar" class="tip-partial" bind:delay="${openDelay}"><snippet name="anchor" params="trigger"><button type="button" bind:id="trigger.id" bind:aria-describedby="trigger['aria-describedby']">Sin reenviar</button></snippet></UITooltip>
		<UITooltip text="Desactivado" class="tip-disabled" bind:delay="${openDelay}"><snippet name="anchor" params="trigger"><button type="button" disabled bind="trigger">Desactivado</button></snippet></UITooltip>
		<UITooltip text="Svg" class="tip-svg" bind:delay="${openDelay}"><snippet name="anchor" params="trigger"><svg width="60" height="24"><a href="#svg" bind="trigger"><text x="0" y="16">Vector</text></a></svg></snippet></UITooltip>
		<UITooltip text="Cero" class="tip-zero" bind:delay="0" bind:closeDelay="0"><snippet name="trigger">Cero</snippet></UITooltip>
		<button id="unmount-trigger" type="button">Se desmonta</button>
		<UIPopover if:when="mounted.value" mode="hint" triggerId="unmount-trigger" class="tip-unmount" bind:delay="${openDelay}">Desmontado</UIPopover>
		<UITooltip text="Se desmonta entero" class="tip-whole" if:when="mounted.value" bind:delay="${openDelay}"><snippet name="trigger">Entero</snippet></UITooltip>
		<UIPopover mode="auto" placement="bottom-start">
			<snippet name="trigger">Menú</snippet>
			<UITooltip text="Dentro" class="tip-nested" bind:delay="${openDelay}"><snippet name="trigger">Interior</snippet></UITooltip>
		</UIPopover>
		<button id="external-a" type="button">Externo A</button>
		<button id="external-b" type="button">Externo B</button>
		<UIPopover mode="hint" bind:triggerId="external.value" class="tip-external" bind:delay="${openDelay}">Externo</UIPopover>
		<UITooltip text="Se va" class="tip-gone" bind:delay="${openDelay}"><snippet name="anchor" params="trigger"><button if:when="shown.value" type="button" bind="trigger">Se va</button></snippet></UITooltip>
		<UITooltip text="Cambia" class="tip-swap" bind:delay="${openDelay}" bind:closeDelay="${closeDelay}"><snippet name="anchor" params="trigger"><button if:when="firstTrigger.value" type="button" bind="trigger">Uno</button><button if:when="!firstTrigger.value" type="button" bind="trigger">Dos</button></snippet></UITooltip>
		<button id="swap" type="button" on:click="() => (firstTrigger.value = !firstTrigger.value)">Sustituir</button>
		<p id="state">{String(open.value)}|{toggles.value.join()}</p>
		<button id="write-open" type="button" on:click="() => (open.value = true)">Abrir</button>
		<button id="write-close" type="button" on:click="() => (open.value = false)">Cerrar</button>
		<button id="to-b" type="button" on:click="() => (external.value = 'external-b')">Cambiar</button>
		<button id="remove" type="button" on:click="() => (shown.value = false)">Quitar</button>
		<button id="slower" type="button" on:click="() => (start.value = 900)">Más lento</button>
		<button id="unmount" type="button" on:click="() => (mounted.value = false)">Desmontar</button>
		<MeekoLink id="leave" to="/other">Salir</MeekoLink>
	</main>
</template>
`

/** On a page of its own: opening a hint closes any other, so it would disturb the rest. */
const startsOpen = `<script lang="ts">
	import { signal } from '@meekojs/meeko'

	const open = signal(true)
</script>

<template>
	<main style="padding: 96px 48px;">
		<UITooltip triggerId="initial" text="De partida" class="tip-initial" model="open" bind:delay="${openDelay}" bind:closeDelay="${closeDelay}"><snippet name="trigger">De partida</snippet></UITooltip>
		<p id="initial-state">{String(open.value)}</p>
	</main>
</template>
`

const route = "import { definePage } from '@meekojs/meeko/framework'\nexport const route = definePage({ render: 'prerender' })\n"
const pages = { 'app/pages/tips.meeko': page, 'app/pages/tips.route.ts': route, 'app/pages/starts-open.meeko': startsOpen, 'app/pages/starts-open.route.ts': route }

/** Records the timers of the tooltip's delays, and with `force` turns the browser into one without Interest Invokers. */
function instrument({ force, delays }) {
	// As the DOM counts them: removing a listener that is not there changes nothing.
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
	globalThis.tipTimers = []
	const native = globalThis.setTimeout
	globalThis.setTimeout = function (work, delay, ...rest) {
		if (delays.includes(delay)) globalThis.tipTimers.push(delay)
		return native.call(this, work, delay, ...rest)
	}
	if (!force) return
	// Chrome no longer has a switch for this. Without the property the component takes the script, and
	// the browser is stopped by cancelling the event that it fires before opening.
	for (const element of ['HTMLButtonElement', 'HTMLAnchorElement', 'HTMLAreaElement', 'SVGAElement']) delete globalThis[element]?.prototype.interestForElement
	globalThis.addEventListener('interest', (event) => event.preventDefault(), true)
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const center = async (locator) => {
	const box = await locator.boundingBox()
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
const away = (tab) => tab.mouse.move(2, 2)
const hover = async (tab, locator) => {
	const point = await center(locator)
	await tab.mouse.move(point.x, point.y)
}
const openTip = (tip) => tip.evaluate((element) => element.matches(':popover-open'))
/** Milliseconds until the tooltip reaches a state. */
const until = async (tip, wanted, act, limit = 2500) => {
	const started = performance.now()
	await act()
	while (performance.now() - started < limit) {
		if ((await openTip(tip)) === wanted) return Math.round(performance.now() - started)
		await sleep(4)
	}
	throw new Error(`the tooltip did not become ${wanted ? 'open' : 'closed'} in ${limit} ms`)
}

async function visit(browser, origin, { force = false, contextOptions = {}, path = '/tips' } = {}) {
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions })
	const tab = await context.newPage()
	const errors = []
	tab.on('pageerror', (error) => errors.push(error.message))
	tab.on('console', (message) => {
		if ((message.type() === 'error' && !message.text().includes('404')) || /hydrat/i.test(message.text())) errors.push(message.text())
	})
	await tab.addInitScript(instrument, { force, delays: [openDelay, closeDelay, 900] })
	await tab.goto(origin + path, { waitUntil: 'networkidle' })
	await tab.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0)
	return { context, errors, tab }
}

/** What must hold in every browser and on both paths. */
async function sameBehavior(tab, errors) {
	const trigger = tab.locator('#plain')
	const tip = tab.locator('.tip-plain')
	// SSR: the same attributes with or without support, no matter what the browser does with them.
	assert.equal(await trigger.getAttribute('interestfor'), await tip.getAttribute('id'))
	assert.equal(await trigger.getAttribute('aria-describedby'), await tip.getAttribute('id'))

	// The pointer: after `delay`, without taking the focus, open once, and the model follows.
	await tab.locator('#before').focus()
	const opened = await until(tip, true, () => hover(tab, trigger))
	assert.ok(opened >= openDelay - 20, `opens after its delay, not in ${opened} ms`)
	assert.equal(await tab.evaluate(() => globalThis.document.activeElement?.id), 'before')
	await tab.locator('#state', { hasText: 'true|false,true' }).waitFor()
	assert.equal(await tip.getAttribute('data-open'), '')
	assert.equal(await tab.getByRole('button', { name: 'Menú', exact: true }).getAttribute('interestfor'), null, 'only a hint carries the attribute')
	// Over the gap and onto the content: it stays.
	const box = await tip.boundingBox()
	await tab.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 })
	await sleep(closeDelay + 150)
	assert.equal(await openTip(tip), true, 'the pointer can move onto the tooltip')
	const closed = await until(tip, false, () => away(tab))
	assert.ok(closed >= closeDelay - 20, `closes after its delay, not in ${closed} ms`)
	await tab.locator('#state', { hasText: 'false|false,true,false' }).waitFor()

	// The focus: at once, and Escape closes without coming back.
	const focused = await until(tip, true, () => trigger.focus())
	assert.ok(focused < openDelay - 100, `the focus does not wait for the delay of the pointer: ${focused} ms`)
	// The model follows the toggle task. An Escape before it is coalesced with the opening, and the model never shows true.
	await tab.locator('#state', { hasText: /^true/ }).waitFor()
	await tab.keyboard.press('Escape')
	await tab.locator('#state', { hasText: 'false|false,true,false,true,false' }).waitFor()
	await sleep(openDelay + 80)
	assert.equal(await openTip(tip), false, 'Escape closes for good')
	await tab.locator('#before').focus()
	await sleep(closeDelay + 40)
	assert.equal(await openTip(tip), false)

	// Escape with the pointer over the trigger.
	await until(tip, true, () => hover(tab, trigger))
	await tab.keyboard.press('Escape')
	await sleep(openDelay + 80)
	assert.equal(await openTip(tip), false)
	await away(tab)
	await sleep(closeDelay + 40)

	// A pointer that comes and goes closes it, although the trigger keeps the focus.
	await until(tip, true, () => trigger.focus())
	await tab.locator('#state', { hasText: /^true/ }).waitFor()
	await hover(tab, trigger)
	await until(tip, false, () => away(tab))
	await tab.locator('#state', { hasText: /^false/ }).waitFor()
	assert.equal(await tab.evaluate(() => globalThis.document.activeElement?.id), 'plain')
	await tab.locator('#before').focus()

	// The model opens and closes, and a pointer that leaves closes what the model opened.
	await tab.locator('#write-open').evaluate((button) => button.click())
	await tab.locator('#state', { hasText: /^true/ }).waitFor()
	assert.equal(await openTip(tip), true)
	await tab.locator('#write-close').evaluate((button) => button.click())
	await tab.locator('#state', { hasText: /^false/ }).waitFor()
	assert.equal(await openTip(tip), false)
	await tab.locator('#write-open').evaluate((button) => button.click())
	await tab.locator('#state', { hasText: /^true/ }).waitFor()
	await hover(tab, trigger)
	await sleep(openDelay + 80)
	assert.equal(await openTip(tip), true)
	await until(tip, false, () => away(tab))
	await tab.locator('#state', { hasText: /^false/ }).waitFor()
	// Escape closes what the model opened, without any interest in between.
	await tab.locator('#write-open').evaluate((button) => button.click())
	await tab.locator('#state', { hasText: /^true/ }).waitFor()
	await tab.keyboard.press('Escape')
	await tab.locator('#state', { hasText: /^false/ }).waitFor()
	assert.equal(await openTip(tip), false)

	// A new `delay` counts from then on.
	await tab.locator('#slower').evaluate((button) => button.click())
	await sleep(50)
	const slower = await until(tip, true, () => hover(tab, trigger))
	assert.ok(slower >= 880, `the new delay applies: ${slower} ms`)
	await until(tip, false, () => away(tab))

	// `<UIPopover mode="hint">` and every kind of trigger.
	for (const [selector, label] of [
		['.tip-hint', 'Popover'],
		['.tip-uibutton', 'UIButton'],
		['.tip-link', 'Enlace'],
		['.tip-nohref', 'Sin href'],
		['.tip-span', 'Span'],
		['.tip-partial', 'Sin reenviar'],
		['.tip-disabled', 'Desactivado'],
	]) {
		const content = tab.locator(selector)
		const source = tab.getByText(label, { exact: true }).first()
		const time = await until(content, true, () => hover(tab, source))
		assert.ok(time >= openDelay - 20, `${label}: opens after its delay, not in ${time} ms`)
		await until(content, false, () => away(tab))
	}
	// An SVG link opens nowhere: showPopover takes no SVG `source`, and Chrome would never close it with the pointer.
	await hover(tab, tab.getByText('Vector', { exact: true }))
	await sleep(openDelay + 80)
	assert.equal(await openTip(tab.locator('.tip-svg')), false)
	await away(tab)
	await sleep(closeDelay + 40)
	// The same trigger with no delay, the place of the anchor and the offset.
	const zero = tab.locator('.tip-zero')
	const zeroTrigger = tab.getByRole('button', { name: 'Cero', exact: true })
	await until(zero, true, () => hover(tab, zeroTrigger))
	await zero.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
	const [tipBox, sourceBox] = await Promise.all([zero.boundingBox(), zeroTrigger.boundingBox()])
	assert.ok(Math.abs(tipBox.y + tipBox.height + 6 - sourceBox.y) <= 1, `placement="top" and its offset: ${JSON.stringify({ tipBox, sourceBox })}`)
	await until(zero, false, () => away(tab))

	// Inside a popover: it does not close the popover that holds it.
	const menu = tab.getByRole('button', { name: 'Menú', exact: true })
	await menu.click()
	const inner = tab.getByRole('button', { name: 'Interior', exact: true })
	await inner.waitFor()
	const nested = tab.locator('.tip-nested')
	await until(nested, true, () => hover(tab, inner))
	assert.equal(await menu.getAttribute('aria-expanded'), 'true', 'the tooltip does not close the popover it is in')
	await tab.keyboard.press('Escape')
	await tab.keyboard.press('Escape')
	await tab.mouse.click(2, 880)
	await away(tab)
	await sleep(closeDelay + 40)

	// Another `triggerId`: the old trigger no longer opens it, the new one does.
	const external = tab.locator('.tip-external')
	await until(external, true, () => hover(tab, tab.locator('#external-a')))
	await tab.locator('#to-b').evaluate((button) => button.click())
	await external.waitFor({ state: 'hidden' })
	await away(tab)
	await sleep(closeDelay + 40)
	await hover(tab, tab.locator('#external-a'))
	await sleep(openDelay + 80)
	assert.equal(await openTip(external), false, 'the old trigger keeps no listener')
	await until(external, true, () => hover(tab, tab.locator('#external-b')))
	await until(external, false, () => away(tab))

	// A trigger replaced under the same `id`: the new one opens it at the first pass, after `delay`, and the old one is forgotten.
	const swapped = tab.locator('.tip-swap')
	await until(swapped, true, () => hover(tab, tab.getByRole('button', { name: 'Uno', exact: true })))
	await until(swapped, false, () => away(tab))
	await tab.locator('#swap').evaluate((button) => button.click())
	const second = tab.getByRole('button', { name: 'Dos', exact: true })
	await second.waitFor()
	const swappedTime = await until(swapped, true, () => hover(tab, second))
	assert.ok(swappedTime >= openDelay - 20, `the new trigger waits for its delay, not ${swappedTime} ms`)
	await until(swapped, false, () => away(tab))
	// Replaced while open, it closes.
	await until(swapped, true, () => hover(tab, second))
	await until(swapped, false, () => tab.locator('#swap').evaluate((button) => button.click()))
	await away(tab)
	await sleep(closeDelay + 40)

	// A trigger that leaves the document does not leave its tooltip open.
	const gone = tab.locator('.tip-gone')
	await until(gone, true, () => hover(tab, tab.getByRole('button', { name: 'Se va', exact: true })))
	await until(gone, false, () => tab.locator('#remove').evaluate((button) => button.click()))
	await away(tab)
	await sleep(closeDelay + 40)

	// Unmounting with the tooltip open: nothing stays open, and the trigger that remains is left as it was.
	const remaining = tab.locator('#unmount-trigger')
	await until(tab.locator('.tip-unmount'), true, () => hover(tab, remaining))
	await tab.locator('#unmount').evaluate((button) => button.click())
	await tab.locator('.tip-unmount').waitFor({ state: 'detached' })
	await tab.locator('.tip-whole').waitFor({ state: 'detached' })
	assert.equal(await tab.locator('[data-meeko-popover]:popover-open').count(), 0, 'nothing stays open')
	assert.equal(await remaining.getAttribute('data-meeko-popover-interest'), null)
	assert.equal(await remaining.evaluate((element) => element.style.getPropertyValue('--popover-delay')), '')
	await tab.evaluate(() => (globalThis.tipTimers = []))
	await away(tab)
	await hover(tab, remaining)
	await sleep(openDelay + 80)
	assert.deepEqual(await tab.evaluate(() => globalThis.tipTimers), [], 'its listeners went with it')
	assert.deepEqual(errors, [])
}

/** A model that starts open: it shows, and its trigger has its listeners like any other. */
async function startsOpenBehavior(browser, origin, force) {
	const { context, errors, tab } = await visit(browser, origin, { force, path: '/starts-open' })
	const tip = tab.locator('.tip-initial')
	await tip.waitFor({ state: 'visible' })
	await tab.locator('#initial-state', { hasText: 'true' }).waitFor()
	await hover(tab, tab.locator('#initial'))
	await sleep(openDelay + 80)
	assert.equal(await openTip(tip), true)
	await until(tip, false, () => away(tab))
	await tab.locator('#initial-state', { hasText: 'false' }).waitFor()
	await until(tip, true, () => hover(tab, tab.locator('#initial')))
	assert.deepEqual(errors, [])
	await context.close()
}

for (const [engine, name, force] of [
	['chrome', 'Chrome, with Interest Invokers', false],
	['chrome', 'Chrome, with the script forced', true],
	['firefox', 'Firefox', false],
	['webkit', 'WebKit', false],
]) {
	test(`a tooltip behaves the same in ${name}`, { timeout: 180_000 }, async (t) => {
		let browser
		try {
			browser = await launchers[engine]()
		} catch (error) {
			if (engine === 'chrome') throw error
			t.diagnostic(`${engine} is not installed: ${error.message.split('\n')[0]}`)
			return
		}
		t.after(() => browser.close())
		const { origin } = await createNativeApp(t, pages)
		const { context, errors, tab } = await visit(browser, origin, { force })
		await sameBehavior(tab, errors)
		await startsOpenBehavior(browser, origin, force)
		const supported = await tab.evaluate(() => 'interestForElement' in globalThis.HTMLButtonElement.prototype)
		if (engine === 'chrome') assert.equal(supported, !force)
		else if (supported) t.diagnostic(`${engine} now has Interest Invokers`)
		await context.close()
	})
}

test('with Interest Invokers the browser opens the tooltip: no timer, no second mechanism', { timeout: 180_000 }, async (t) => {
	const browser = await launchers.chrome()
	t.after(() => browser.close())
	const { origin } = await createNativeApp(t, pages)

	const timers = (tab) => tab.evaluate(() => globalThis.tipTimers)
	const logged = (tab, selector) =>
		tab.locator(selector).evaluate((element) => {
			globalThis.tipEvents = []
			for (const type of ['interest', 'loseinterest', 'beforetoggle', 'toggle']) element.addEventListener(type, (event) => globalThis.tipEvents.push(event.newState ? `${type}:${event.newState}` : type))
		})
	const events = (tab) => tab.evaluate(() => globalThis.tipEvents)

	await t.test('the delays come from the browser, and each change happens once', async () => {
		const { context, errors, tab } = await visit(browser, origin)
		const trigger = tab.locator('#plain')
		const tip = tab.locator('.tip-plain')
		await logged(tab, '.tip-plain')
		assert.equal(await trigger.evaluate((element) => globalThis.getComputedStyle(element).getPropertyValue('interest-delay-start')), `${openDelay / 1000}s`)
		assert.equal(await trigger.evaluate((element) => globalThis.getComputedStyle(element).getPropertyValue('interest-delay-end')), `${closeDelay / 1000}s`)
		await until(tip, true, () => hover(tab, trigger))
		await sleep(60)
		await until(tip, false, () => away(tab))
		await sleep(60)
		assert.deepEqual(await events(tab), ['interest', 'beforetoggle:open', 'toggle:open', 'loseinterest', 'beforetoggle:closed', 'toggle:closed'], 'it neither opens twice nor flickers')
		assert.deepEqual(await timers(tab), [], 'no timer of the script')
		assert.deepEqual(errors, [])
		await context.close()
	})

	await t.test('a focused trigger does not wait, and the browser closes it when the focus leaves', async () => {
		const { context, tab } = await visit(browser, origin)
		const trigger = tab.locator('#plain')
		const tip = tab.locator('.tip-plain')
		await tab.locator('#before').focus()
		await until(tip, true, () => tab.keyboard.press('Tab'))
		assert.equal(await tab.evaluate(() => globalThis.document.activeElement?.id), 'plain')
		assert.equal(await trigger.evaluate((element) => globalThis.getComputedStyle(element).getPropertyValue('interest-delay-start')), '0s')
		await until(tip, false, () => tab.keyboard.press('Tab'))
		assert.deepEqual(await timers(tab), [])
		await context.close()
	})

	await t.test('what the browser ignores stays with the script, and only there are there timers', async () => {
		const { context, tab } = await visit(browser, origin)
		for (const [selector, label, native] of [
			['.tip-uibutton', 'UIButton', true],
			['.tip-link', 'Enlace', true],
			['.tip-nohref', 'Sin href', false],
			['.tip-span', 'Span', false],
			['.tip-partial', 'Sin reenviar', false],
			['.tip-disabled', 'Desactivado', false],
		]) {
			await tab.evaluate(() => (globalThis.tipTimers = []))
			await logged(tab, selector)
			await until(tab.locator(selector), true, () => hover(tab, tab.getByText(label, { exact: true }).first()))
			await until(tab.locator(selector), false, () => away(tab))
			const log = await events(tab)
			if (native) assert.ok(log.includes('interest'), `${label}: ${log}`)
			assert.equal((await timers(tab)).length > 0, !native, `${label}: timers ${await timers(tab)}`)
			assert.equal(log.filter((type) => type === 'toggle:open').length, 1, `${label} opens once: ${log}`)
		}
		await context.close()
	})

	await t.test('a touch opens it, as the focus did, and touching elsewhere closes it', async () => {
		const { context, tab } = await visit(browser, origin, { contextOptions: { hasTouch: true, isMobile: true } })
		const trigger = tab.locator('#plain')
		const tip = tab.locator('.tip-plain')
		const point = await center(trigger)
		await until(tip, true, () => tab.touchscreen.tap(point.x, point.y))
		await tab.locator('#state', { hasText: 'true|false,true' }).waitFor()
		await sleep(400)
		assert.equal(await openTip(tip), true, 'it stays open')
		await tab.touchscreen.tap(point.x, point.y)
		await sleep(400)
		assert.equal(await openTip(tip), true, 'a second touch on the trigger does not close it')
		await until(tip, false, () => tab.touchscreen.tap(2, 880))
		await tab.locator('#state', { hasText: 'false|false,true,false' }).waitFor()
		// A long press shows interest by itself, and lifting the finger ends it.
		const cdp = await context.newCDPSession(tab)
		await until(tip, true, () => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }))
		await until(tip, false, () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }))
		await context.close()
	})

	await t.test('without JavaScript the browser still opens it', async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false })
		const tab = await context.newPage()
		await tab.goto(origin + '/tips')
		const tip = tab.locator('.tip-plain')
		assert.equal(await tip.isVisible(), false)
		const point = await center(tab.locator('#plain'))
		await tab.mouse.move(point.x, point.y)
		await tip.waitFor({ state: 'visible' })
		await tab.mouse.move(2, 2)
		await tip.waitFor({ state: 'hidden' })
		await context.close()
	})

	await t.test('a pointer that arrives before hydration: the browser opens it and the model takes it', async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
		const tab = await context.newPage()
		// The entry waits, so the page stays as the server sent it until the tooltip is open.
		let release
		const held = new Promise((done) => (release = done))
		await tab.route('**/entry-client.ts*', async (route) => {
			await held
			await route.continue().catch(() => undefined)
		})
		await tab.goto(origin + '/tips', { waitUntil: 'commit' })
		const trigger = tab.locator('#plain')
		await trigger.waitFor()
		const tip = tab.locator('.tip-plain')
		await until(tip, true, () => hover(tab, trigger))
		assert.equal(await tab.evaluate(() => globalThis.performance.getEntriesByName('meeko-hydration').length), 0, 'still not hydrated')
		release()
		await tab.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 60_000 })
		await tab.locator('#state', { hasText: 'true|false,true' }).waitFor()
		assert.equal(await openTip(tip), true, 'hydration does not close it')
		assert.equal(await tip.getAttribute('data-open'), '')
		await until(tip, false, () => away(tab))
		await tab.locator('#state', { hasText: 'false|false,true,false' }).waitFor()
		await context.close()
	})

	await t.test('the accessibility tree: one description on both paths', async () => {
		const describe = async (force) => {
			const { context, tab } = await visit(browser, origin, { force })
			const cdp = await context.newCDPSession(tab)
			await cdp.send('Accessibility.enable')
			const { root } = await cdp.send('DOM.getDocument')
			const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#plain' })
			const read = async () => {
				const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })
				return { name: nodes[0].name?.value, description: nodes[0].description?.value }
			}
			const closed = await read()
			await until(tab.locator('.tip-plain'), true, () => hover(tab, tab.locator('#plain')))
			const opened = await read()
			await context.close()
			return { closed, opened }
		}
		const expected = { name: 'Plano', description: 'Plano' }
		assert.deepEqual(await describe(false), { closed: expected, opened: expected })
		assert.deepEqual(await describe(true), { closed: expected, opened: expected })
	})

	await t.test('all the tooltips of a page share their document listeners, and none outlives them', async () => {
		for (const force of [false, true]) {
			const { context, tab } = await visit(browser, origin, { force })
			const listeners = () => tab.evaluate(() => globalThis.documentListeners())
			assert.ok((await tab.locator('[data-meeko-popover][popover=hint]').count()) > 10, 'a page with many of them')
			assert.deepEqual(await listeners(), { pointerover: 1, focusin: 1, keydown: 0 }, 'a closed tooltip listens to no key')
			const tip = tab.locator('.tip-plain')
			await until(tip, true, () => hover(tab, tab.locator('#plain')))
			assert.deepEqual(await listeners(), { pointerover: 1, focusin: 1, keydown: 1 }, 'only the open one does')
			await until(tip, false, () => away(tab))
			assert.deepEqual(await listeners(), { pointerover: 1, focusin: 1, keydown: 0 })
			// Unmounting everything takes them away; and with a tooltip open, its key too.
			await until(tip, true, () => hover(tab, tab.locator('#plain')))
			await tab.locator('#leave').click()
			await tab.locator('#other').waitFor()
			assert.deepEqual(await listeners(), { pointerover: 0, focusin: 0, keydown: 0 })
			await context.close()
		}
	})

	await t.test('with reduced motion nothing slides, on both paths', async () => {
		for (const force of [false, true]) {
			const { context, tab } = await visit(browser, origin, { force, contextOptions: { reducedMotion: 'reduce' } })
			const tip = tab.locator('.tip-plain')
			await until(tip, true, () => hover(tab, tab.locator('#plain')))
			assert.equal(await tip.evaluate((element) => element.getAnimations().length), 0, 'no transition')
			assert.ok(['none', '0px'].includes(await tip.evaluate((element) => globalThis.getComputedStyle(element).translate)))
			await context.close()
		}
	})
})
