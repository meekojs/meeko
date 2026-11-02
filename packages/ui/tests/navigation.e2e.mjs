import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { createNavigationApp, serveNavigationApp } from './helpers/navigation-app.mjs'

const launch = () => chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })

async function until(check, message) {
	const started = Date.now()
	while (!(await check())) {
		if (Date.now() - started > 10_000) throw new Error(message)
		await new Promise((done) => setTimeout(done, 25))
	}
}

test('the navigation components work in a browser, with and without JavaScript', { timeout: 240_000 }, async (t) => {
	const root = await createNavigationApp(t)
	const { origin } = await serveNavigationApp(root)
	const browser = await launch()
	t.after(() => browser.close())
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
	const open = async (viewport) => {
		const page = await context.newPage()
		if (viewport) await page.setViewportSize(viewport)
		const errors = []
		page.on('pageerror', (error) => errors.push(error.message))
		page.on('console', (message) => {
			// The browser reports the fixture's missing favicon; a hydration mismatch is an error or a warning.
			if ((message.type() === 'error' && !message.text().includes('404')) || /hydrat/i.test(message.text())) errors.push(message.text())
		})
		await page.goto(origin, { waitUntil: 'networkidle' })
		// Hydrated: the copy button of a code block only shows then.
		await page.locator('.meeko-ui-code-copy[data-ready]').first().waitFor()
		return { page, errors }
	}

	await t.test('without JavaScript: the drawer and the menu open, and nothing depends on a script', async () => {
		const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
		t.after(() => noScript.close())
		const page = await noScript.newPage()
		await page.goto(origin)
		assert.equal(await page.locator('main').count(), 1)
		// Invoker commands and popover are native: no hydration here.
		await page.locator('.meeko-ui-drawer-trigger').click()
		await page.locator('dialog.meeko-ui-drawer[open]').waitFor()
		await page.keyboard.press('Escape')
		await page.locator('dialog.meeko-ui-drawer:not([open])').waitFor({ state: 'attached' })
		await page.locator('.meeko-ui-header-toggle').click()
		await page.locator('.meeko-ui-header-menu a', { hasText: 'Acerca de' }).waitFor()
		await page.keyboard.press('Escape')
		// The copy button needs the script, so it does not show.
		assert.equal(await page.locator('.meeko-ui-code-copy').first().isVisible(), false)
		// The collapsible table of contents is a native details.
		await page.locator('.meeko-ui-toc-collapsible > summary').click()
		await page.locator('.meeko-ui-toc-collapsible a', { hasText: 'Tercera sección' }).click()
		assert.match(page.url(), /#tres$/)
		await page.close()
	})

	await t.test('hydration keeps the layout: the header and the page height do not move', async () => {
		const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } })
		t.after(() => noScript.close())
		const ssr = await noScript.newPage()
		await ssr.goto(origin)
		const measure = (target) => target.locator('.meeko-ui-header').boundingBox()
		const before = await measure(ssr)
		const beforeMain = await ssr.locator('main').boundingBox()
		const { page, errors } = await open()
		assert.deepEqual(await measure(page), before)
		const afterMain = await page.locator('main').boundingBox()
		assert.equal(afterMain.x, beforeMain.x)
		assert.equal(afterMain.width, beforeMain.width)
		assert.equal(before.height, 57, 'the bar and its border')
		assert.deepEqual(errors, [])
		await page.close()
	})

	await t.test('the skip link appears with the keyboard and moves the focus to main', async () => {
		const { page, errors } = await open()
		const link = page.locator('.meeko-ui-skip-link')
		assert.ok((await link.boundingBox()).y < 0, 'off the screen')
		await page.keyboard.press('Tab')
		assert.equal(await link.evaluate((element) => element === element.ownerDocument.activeElement), true)
		await until(async () => (await link.boundingBox()).y >= 0, 'the skip link did not appear')
		await page.keyboard.press('Enter')
		await until(() => page.evaluate(() => globalThis.document.activeElement?.id === 'contenido'), 'main did not take the focus')
		assert.deepEqual(errors, [])
		await page.close()
	})

	await t.test('UIDrawer: model, focus, Escape, backdrop, links and animation', async () => {
		const { page, errors } = await open({ width: 390, height: 844 })
		const dialog = page.locator('dialog.meeko-ui-drawer')
		const state = page.locator('#drawer-state')
		const trigger = page.locator('.meeko-ui-drawer-trigger')
		// The trigger: native command, and the model follows.
		await trigger.click()
		await dialog.and(page.locator('[open]')).waitFor()
		await until(async () => (await state.innerText()) === 'abierto:0', 'the model did not follow the command')
		assert.equal(await dialog.evaluate((element) => element.contains(element.ownerDocument.activeElement)), true, 'the focus goes inside')
		assert.equal(await page.evaluate(() => globalThis.getComputedStyle(globalThis.document.documentElement).overflowY), 'hidden', 'the page does not scroll behind it')
		await until(async () => (await dialog.boundingBox()).x === 0, 'the panel did not arrive')
		// Escape closes and gives the focus back.
		await page.keyboard.press('Escape')
		await until(async () => (await state.innerText()) === 'cerrado:1', 'Escape did not reach the model')
		assert.equal(await trigger.evaluate((element) => element === element.ownerDocument.activeElement), true, 'the focus comes back')
		// A click outside, with `closedby="any"`.
		await trigger.click()
		await until(async () => (await state.innerText()) === 'abierto:1', 'it did not open again')
		await until(async () => (await dialog.boundingBox()).x === 0, 'the panel did not arrive')
		await page.mouse.click(380, 400)
		await until(async () => (await state.innerText()) === 'cerrado:2', 'the backdrop did not close it')
		// The model opens it; the button of the panel closes it.
		await page.locator('#open-drawer').evaluate((element) => element.click())
		await dialog.and(page.locator('[open]')).waitFor()
		await page.locator('.meeko-ui-drawer-close').click()
		await until(async () => (await state.innerText()) === 'cerrado:3', 'the close button did not close it')
		// A link closes it, without leaving the page if it goes to a fragment.
		await trigger.click()
		await dialog.and(page.locator('[open]')).waitFor()
		await dialog.locator('summary', { hasText: 'Referencia' }).click()
		await dialog.locator('a', { hasText: 'useSignal' }).evaluate((element) => element.addEventListener('click', (event) => event.preventDefault()))
		await dialog.locator('a', { hasText: 'useSignal' }).click()
		await until(async () => (await state.innerText()) === 'cerrado:4', 'the link did not close it')
		await until(async () => !(await dialog.isVisible()), 'the panel did not leave')
		// It enters with @starting-style: a transition of `translate` runs right after opening.
		const entering = await dialog.evaluate((element) => {
			element.showModal()
			return element.getAnimations().map((animation) => animation.transitionProperty)
		})
		assert.ok(entering.includes('translate'), JSON.stringify(entering))
		assert.deepEqual(errors, [])
		await page.close()
	})

	await t.test('UINavigationTabs: select can filter without navigating', async () => {
		const { page, errors } = await open()
		const nav = page.getByRole('navigation', { name: 'Filtro' })
		const url = page.url()
		await nav.getByRole('link', { name: /^Activas/ }).click()
		assert.equal(await nav.getByRole('link', { name: /^Activas/ }).getAttribute('aria-current'), 'page')
		assert.equal(await nav.getByRole('link', { name: /^Todas/ }).getAttribute('aria-current'), null)
		assert.equal(page.url(), url, 'event.preventDefault() cancels the link')
		assert.deepEqual(errors, [])
		await page.close()
	})

	await t.test('UINavigationTabs: the indicator follows the current link, and a narrow row scrolls to it', async () => {
		const { page, errors } = await open()
		const nav = page.getByRole('navigation', { name: 'Vistas', exact: true })
		assert.equal(await nav.getByRole('tab').count(), 0)
		const indicator = nav.locator('.meeko-ui-nav-tabs-indicator')
		const aligned = async (name) => {
			const [bar, link] = await Promise.all([indicator.boundingBox(), nav.getByRole('link', { name, exact: true }).boundingBox()])
			return Math.abs(bar.x - link.x) < 1 && Math.abs(bar.width - link.width) < 1 && Math.abs(bar.y + bar.height - (link.y + link.height)) < 1
		}
		await until(() => aligned('Uno'), 'the indicator is not under the current link')
		await page.locator('#tab-two').click()
		assert.equal(await nav.getByRole('link', { name: 'Dos más largo' }).getAttribute('aria-current'), 'page')
		await until(() => aligned('Dos más largo'), 'the indicator did not follow')
		// In a row too narrow for its links, the current one is brought into view, and the page stays put.
		// 15px of this width are the gutter that the base keeps for the scrollbar.
		await page.setViewportSize({ width: 215, height: 900 })
		await nav.evaluate((element) => (element.scrollLeft = 0))
		await page.evaluate(() => globalThis.scrollTo(0, 0))
		await page.locator('#tab-four').evaluate((element) => element.click())
		await until(async () => (await nav.evaluate((element) => element.scrollLeft)) > 0, 'the row did not scroll to the current link')
		const box = await nav.boundingBox()
		const shown = await nav.locator('a[aria-current]').first().boundingBox()
		assert.ok(shown.x >= box.x - 1 && shown.x + shown.width <= box.x + box.width + 1, 'the current link is inside the row')
		assert.deepEqual(errors, [])
		await page.close()
	})

	await t.test('a link with to: its own current hydrates and updates over the route, without a mismatch', async () => {
		const { page, errors } = await open()
		const nav = page.getByRole('navigation', { name: 'Estados', exact: true })
		const states = () => nav.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('aria-current')))
		// Forced on a route that is not the active one, removed on the active one, and the route for the others.
		assert.deepEqual(await states(), ['page', null, 'page', null])
		await page.locator('#toggle-forced').click()
		assert.deepEqual(await states(), [null, null, 'page', null])
		await page.locator('#toggle-forced').click()
		assert.deepEqual(await states(), ['page', null, 'page', null])
		assert.deepEqual(errors, [])
		await page.close()
	})

	await t.test('UINavigationTree: details fold with the keyboard, and a long list shows its current link', async () => {
		const { page, errors } = await open()
		const tree = page.getByRole('navigation', { name: 'Documentación', exact: true })
		const group = tree.locator('details', { hasText: 'Referencia' })
		assert.equal(await group.evaluate((element) => element.open), false)
		await group.locator('summary').focus()
		await page.keyboard.press('Enter')
		assert.equal(await group.evaluate((element) => element.open), true)
		await until(async () => await tree.getByRole('link', { name: 'useSignal' }).isVisible(), 'the group did not open')
		assert.equal(await tree.getByRole('link', { name: 'Actual' }).getAttribute('aria-current'), 'page')
		assert.equal(await tree.locator('details', { hasText: 'Sólo aquí' }).evaluate((element) => element.open), true, 'the group of the current link starts open')
		// A code label does not break the column.
		const long = await tree.getByRole('link', { name: /useMuyLargo/ }).evaluate((element) => [element.scrollWidth <= element.clientWidth, element.getBoundingClientRect().width])
		assert.equal(long[0], true)
		assert.ok(long[1] <= 240)
		assert.deepEqual(errors, [])
		await page.close()
		// In a sidebar too short for the list, the current link is brought into view on load.
		const short = await context.newPage()
		await short.setViewportSize({ width: 1440, height: 260 })
		await short.goto(origin, { waitUntil: 'networkidle' })
		const sidebar = short.locator('.meeko-ui-page-sidebar')
		await until(async () => (await sidebar.evaluate((element) => element.scrollTop)) > 0, 'the sidebar did not scroll to the current link')
		const [panel, link] = await Promise.all([sidebar.boundingBox(), short.getByRole('navigation', { name: 'Documentación', exact: true }).getByRole('link', { name: 'Actual' }).boundingBox()])
		assert.ok(link.y >= panel.y && link.y + link.height <= panel.y + panel.height, 'the current link is inside the panel')
		assert.equal(await short.evaluate(() => globalThis.scrollY), 0, 'the document stays put')
		await short.close()
	})

	await t.test('UITableOfContents: follows the scroll with aria-current and, where it exists, scroll-target-group', async () => {
		const { page, errors } = await open()
		const toc = page.locator('.meeko-ui-page-aside .meeko-ui-toc')
		const current = () => toc.locator('a[aria-current="location"]').innerText()
		await until(async () => (await toc.locator('a[aria-current="location"]').count()) === 1, 'no active entry')
		await page.evaluate(() => globalThis.document.getElementById('tres').scrollIntoView())
		await until(async () => (await current()) === 'Tercera sección', 'it did not follow the scroll')
		// A jump: the entries it skipped are still "passed".
		await page.evaluate(() => globalThis.document.getElementById('dos').scrollIntoView())
		await until(async () => (await current()) === 'Segunda sección', 'it did not mark the heading the anchor reached')
		const painted = await page.evaluate(() => globalThis.CSS.supports('scroll-target-group: auto'))
		if (painted) {
			const count = await toc.evaluate((element) => [...element.querySelectorAll('a')].filter((link) => link.matches(':target-current')).length)
			assert.equal(count, 1, 'the platform paints one entry')
			assert.equal(await toc.locator('a[aria-current="location"]').evaluate((link) => link.matches(':target-current')), true, 'the script and the platform agree')
		}
		// Clicking the link is a native anchor.
		await toc.locator('a', { hasText: 'Primera sección' }).click()
		assert.match(page.url(), /#uno$/)
		assert.deepEqual(errors, [])
		await page.close()
		// The narrow view folds once a heading is chosen.
		const narrow = await open({ width: 390, height: 844 })
		const details = narrow.page.locator('.meeko-ui-toc-collapsible')
		assert.equal(await narrow.page.locator('.meeko-ui-page-aside').isVisible(), false)
		await details.locator('summary').click()
		await details.locator('a', { hasText: 'Segunda sección' }).click()
		assert.equal(await details.evaluate((element) => element.open), false)
		assert.deepEqual(narrow.errors, [])
		await narrow.page.close()
	})

	await t.test('UIPagination: loads more, announces busy, keeps the focus and ignores clicks', async () => {
		const { page, errors } = await open()
		const pagination = page.locator('.meeko-ui-pagination').first()
		const button = pagination.getByRole('button')
		assert.match(await pagination.locator('p').innerText(), /2 de 5/)
		await button.focus()
		await button.click()
		assert.equal(await pagination.getAttribute('aria-busy'), 'true')
		assert.equal(await button.getAttribute('aria-disabled'), 'true')
		assert.equal((await button.innerText()).trim(), 'Cargando…')
		await button.evaluate((element) => element.click())
		await until(async () => (await pagination.getAttribute('aria-busy')) === null, 'it stayed busy')
		assert.match(await pagination.locator('p').innerText(), /3 de 5/, 'a click while busy does not load twice')
		assert.equal(await button.evaluate((element) => element === element.ownerDocument.activeElement), true, 'the focus stays')
		// Two more rounds reach the end, and the button goes.
		await button.click()
		await until(async () => (await pagination.locator('p').innerText()).includes('4 de 5'), 'it did not load again')
		await until(async () => (await pagination.getAttribute('aria-busy')) === null, 'it stayed busy')
		await button.click()
		await until(async () => (await pagination.getByRole('button').count()) === 0, 'the button stays with nothing left')
		assert.match(await pagination.locator('p').innerText(), /5 de 5/)
		assert.deepEqual(errors, [])
		await page.close()
	})

	await t.test('UIProse dresses its own text and stops at a component inside it', async () => {
		const { page, errors } = await open()
		const read = (selector, property) =>
			page
				.locator(selector)
				.first()
				.evaluate((element, name) => globalThis.getComputedStyle(element)[name], property)
		const token = (name) =>
			page.evaluate((property) => {
				const probe = globalThis.document.createElement('div')
				probe.style.fontSize = `var(${property})`
				globalThis.document.body.append(probe)
				const size = globalThis.getComputedStyle(probe).fontSize
				probe.remove()
				return size
			}, name)
		// Its reading styles reach the text: a selector in @scope without :scope would match nothing here.
		assert.equal(await read('#handwritten > h2', 'fontSize'), await token('--ui-font-size-2xl'))
		assert.equal(await read('#snapshot code', 'fontFamily'), await read('#snapshot pre code', 'fontFamily'))
		assert.notEqual(await read('#snapshot p code', 'backgroundColor'), 'rgba(0, 0, 0, 0)')
		// A card keeps its own text, on a solid too: the color and margin of the prose end at it.
		const card = page.locator('#handwritten .meeko-ui-card')
		assert.equal(await card.locator('.meeko-ui-card-body p').evaluate((element) => globalThis.getComputedStyle(element).color), await card.evaluate((element) => globalThis.getComputedStyle(element).color))
		assert.deepEqual(errors, [])
		await page.close()
	})

	await t.test('UICodeBlock and UIProse copy, say so, and come back', async () => {
		const { page, errors } = await open()
		const block = page.locator('.meeko-ui-code-block').first()
		const copy = block.locator('.meeko-ui-code-copy')
		await copy.click()
		await until(async () => (await copy.innerText()).trim() === 'Copiado', 'the button did not confirm')
		assert.equal(await copy.getAttribute('data-state'), 'done')
		assert.equal(await block.locator('[role="status"]').innerText(), 'Copiado')
		assert.equal(await page.evaluate(() => globalThis.navigator.clipboard.readText()), 'pnpm add @meekojs/ui')
		await until(async () => (await copy.innerText()).trim() === 'Copiar', 'the button did not come back')
		// The highlighted block copies its `code`, not the markup.
		await page.locator('.meeko-ui-code-block').nth(1).locator('.meeko-ui-code-copy').click()
		await until(async () => (await page.evaluate(() => globalThis.navigator.clipboard.readText())) === 'const a = 1', 'the highlighted code')
		// A snapshot's button: the delegated listener of UIProse.
		const snapshot = page.locator('#snapshot .code-copy')
		await snapshot.click()
		await until(async () => (await snapshot.innerText()).trim() === 'Copiado', 'the snapshot button did not confirm')
		assert.equal(await page.evaluate(() => globalThis.navigator.clipboard.readText()), 'const del = 2')
		await until(async () => (await snapshot.innerText()).trim() === 'Copiar', 'the snapshot button did not come back')
		assert.deepEqual(errors, [])
		await page.close()
	})

	await t.test('UILocaleSuggestion floats without moving the page, and speaks each language', async () => {
		const { page, errors } = await open()
		const height = () => page.evaluate(() => globalThis.document.documentElement.scrollHeight)
		const before = await height()
		await page.locator('#suggest').click()
		const aside = page.locator('.meeko-ui-locale-suggestion')
		await aside.waitFor()
		assert.equal(await height(), before)
		assert.equal(await aside.getAttribute('lang'), 'en')
		assert.equal(await aside.getAttribute('aria-label'), 'Language suggestion')
		assert.equal((await aside.getByRole('status').innerText()).trim(), 'This page is also available in English.')
		assert.equal(await aside.getByRole('link', { name: 'Read in English' }).getAttribute('hreflang'), 'en')
		const stay = aside.getByRole('button', { name: 'Seguir en Español' })
		assert.equal(await stay.getAttribute('lang'), 'es')
		await stay.click()
		await aside.waitFor({ state: 'detached' })
		assert.equal(await page.locator('#stays').innerText(), '1')
		assert.deepEqual(errors, [])
		await page.close()
	})

	await t.test('UIHeader: the menu is a popover that closes with a link, without overflowing a phone', async () => {
		const { page, errors } = await open({ width: 390, height: 844 })
		assert.equal(await page.locator('.meeko-ui-header-nav').isVisible(), false)
		assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, 'no horizontal scroll')
		const main = await page.locator('main').boundingBox()
		await page.locator('.meeko-ui-header-toggle').click()
		const menu = page.locator('.meeko-ui-header-menu')
		await menu.locator('a', { hasText: 'Acerca de' }).waitFor()
		assert.deepEqual(await page.locator('main').boundingBox(), main, 'the menu floats')
		// A client navigation may keep the header mounted: a chosen link closes the menu by itself.
		const github = menu.locator('a', { hasText: 'GitHub' })
		await github.evaluate((element) => element.addEventListener('click', (event) => event.preventDefault()))
		await github.click()
		assert.equal(await menu.evaluate((element) => element.matches(':popover-open')), false)
		await page.locator('.meeko-ui-header-toggle').click()
		await menu.locator('a', { hasText: 'Acerca de' }).click()
		await page.locator('#about').waitFor()
		assert.deepEqual(errors, [])
		await page.close()
	})

	await t.test('with prefers-reduced-motion nothing animates', async () => {
		const reduced = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } })
		t.after(() => reduced.close())
		const page = await reduced.newPage()
		await page.goto(origin, { waitUntil: 'networkidle' })
		const transition = (selector) =>
			page
				.locator(selector)
				.first()
				.evaluate((element) => globalThis.getComputedStyle(element).transitionProperty + '/' + globalThis.getComputedStyle(element).transitionDuration)
		for (const selector of ['.meeko-ui-drawer', '.meeko-ui-skip-link', '.meeko-ui-nav-link', '.meeko-ui-nav-chevron']) assert.match(await transition(selector), /^(none|all)\/0s$/, selector)
		await page.close()
	})
})
