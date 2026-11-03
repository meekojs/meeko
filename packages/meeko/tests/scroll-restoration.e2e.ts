import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Browser, BrowserContextOptions, Page } from 'playwright-core'

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { chromium, firefox, webkit } from 'playwright-core'

import type * as framework_server_tsTypes from '../src/framework-server.ts'
import type * as node_tsTypes from '../src/node.ts'

import { buildProject } from '../src/framework/project.ts'
import { createTempProject, linkRepositoryPackages } from './helpers/temp-project.ts'

/** Firefox and WebKit run when asked for: `MEEKO_E2E_ENGINES=chromium,firefox,webkit`. */
const engines = (process.env.MEEKO_E2E_ENGINES ?? 'chromium').split(',')
const launchers = { chromium, firefox, webkit } as const

const nav = `<nav style="position:fixed;top:0;left:0;z-index:9;background:#fff">
	<a id="to-long" href="/long">long</a>
	<a id="to-other" href="/other">other</a>
	<a id="to-short" href="/short">short</a>
	<a id="to-slow" href="/slow">slow</a>
	<a id="to-grow" href="/grow">grow</a>
	<a id="to-mid" href="/long#mid">long mid</a>
	<a id="here-mid" href="#mid">here mid</a>
</nav>`

const tall = (id: string) => `<template>${nav}<h1 id="${id}">${id}</h1><div style="height:10000px"></div><h2 id="mid">mid</h2><div style="height:10000px"></div></template>\n`

const files: Record<string, string> = {
	'package.json': '{"name":"scroll-restoration-app","private":true,"type":"module"}\n',
	'meeko.config.mjs': 'export default { viewTransitions: true };\n',
	'app/pages/long.meeko': tall('long'),
	'app/pages/other.meeko': tall('other'),
	'app/pages/short.meeko': `<template>${nav}<h1 id="short">short</h1><div style="height:1500px"></div></template>\n`,
	'app/pages/slow.meeko': `<script server lang="ts">
export const route = definePage({
	load: async () => {
		await new Promise((done) => setTimeout(done, 1200))
		return {}
	},
})
</script>
<template>${nav}<h1 id="slow">slow</h1><div style="height:6000px"></div></template>
`,
	'app/pages/grow.meeko': `<script server lang="ts">
import { defer } from '@meekojs/meeko/framework'

export const route = definePage({
	render: 'stream',
	load: () => ({
		more: defer(async () => {
			await new Promise((done) => setTimeout(done, 1200))
			return 15000
		}),
	}),
})
</script>
<script lang="ts">
import type { Deferred } from '@meekojs/meeko/framework'

const props = defineProps<{ data: { more: Deferred<number> } }>()
</script>
<template>${nav}<h1 id="grow">grow</h1><div style="height:2000px"></div><div id="grown" if:when="props.data.more.status === 'resolved'" style="height:15000px"></div></template>
`,
}

/**
 * Records each frame and the View Transitions in flight, so a test can wait for them and see what was
 * painted. It is source text: the transform of tsx names inner functions with a helper the page lacks.
 */
const spy = `{
	const state = { frames: [], active: 0, started: 0, atReady: [] }
	globalThis.spy = state
	const tick = () => {
		state.frames.push([document.querySelector('h1')?.id, Math.round(scrollY)])
		requestAnimationFrame(tick)
	}
	requestAnimationFrame(tick)
	const native = document.startViewTransition?.bind(document)
	if (native) {
		document.startViewTransition = (argument) => {
			state.active++
			state.started++
			const transition = native(argument)
			transition.ready.then(
				() => state.atReady.push(Math.round(scrollY)),
				() => {},
			)
			const done = () => {
				state.active--
			}
			transition.finished.then(done, done)
			return transition
		}
	}
}`

type Spy = { spy: { frames: Array<[string | undefined, number]>; active: number; started: number; atReady: number[] } }

const scrollPosition = (page: Page): Promise<number> => page.evaluate(() => Math.round(scrollY))
const nextFrames = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))

async function settled(page: Page, heading: string): Promise<void> {
	await page.waitForFunction((id) => document.querySelector('h1')?.id === id, heading, { timeout: 30_000 })
	await page.waitForFunction(() => (globalThis as unknown as Spy).spy.active === 0, undefined, { timeout: 30_000 })
	await nextFrames(page)
}
async function scrollPage(page: Page, top: number): Promise<void> {
	await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), top)
	await nextFrames(page)
}
async function follow(page: Page, link: string, heading: string): Promise<void> {
	await page.locator(`#${link}`).click()
	await settled(page, heading)
}
const near = (actual: number, expected: number, message: string): void => assert.ok(Math.abs(actual - expected) <= 2, `${message}: ${actual}, expected ${expected}`)

/** No frame painted `heading` anywhere but at `top`, from the first frame that shows it onwards. */
async function assertNoJump(page: Page, heading: string, top: number, message: string): Promise<void> {
	const frames = await page.evaluate(() => (globalThis as unknown as Spy).spy.frames)
	const shown = frames.filter(([id]) => id === heading)
	assert.ok(shown.length > 0, `${message}: no frame showed ${heading}`)
	for (const [, position] of shown) near(position, top, `${message}: a frame of ${heading} painted elsewhere`)
}
const clearFrames = (page: Page): Promise<void> =>
	page.evaluate(() => {
		;(globalThis as unknown as Spy).spy.frames.length = 0
	})

async function withServedApp(run: (origin: string, browser: Browser, engine: string) => Promise<void>): Promise<void> {
	const project = await createTempProject('scroll-restoration-e2e')
	const root = project.root
	type ServerModule = typeof framework_server_tsTypes
	type NodeModule = typeof node_tsTypes
	let server: Server | undefined
	let app: Awaited<ReturnType<ServerModule['createServerApp']>> | undefined
	try {
		for (const [file, contents] of Object.entries(files)) {
			await mkdir(dirname(join(root, file)), { recursive: true })
			await writeFile(join(root, file), contents)
		}
		await linkRepositoryPackages(root, ['@meekojs/meeko', 'vite'])
		const built = await buildProject(root)
		const { createServerApp } = (await import(pathToFileURL(resolve('dist/framework-server.js')).href)) as ServerModule
		const { createNodeAssetReader, toNodeListener } = (await import(pathToFileURL(resolve('dist/node.js')).href)) as NodeModule
		const output = (await import(pathToFileURL(join(built.output, 'index.mjs')).href)) as Pick<Parameters<ServerModule['createServerApp']>[0], 'load' | 'manifest'>
		app = await createServerApp({
			manifest: output.manifest,
			load: output.load,
			production: false,
			assets: createNodeAssetReader({ root: join(built.output, 'client'), assets: output.manifest.assets ?? {} }),
		})
		const running = app
		server = createHttpServer(toNodeListener((request) => running.fetch(request)))
		await new Promise<void>((ready) => server!.listen(0, '127.0.0.1', ready))
		const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
		for (const engine of engines) {
			const launcher = launchers[engine as keyof typeof launchers]
			const browser = await launcher.launch({
				...(engine !== 'chromium' ? {} : process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' as const }),
				headless: true,
			})
			try {
				await run(origin, browser, engine)
			} finally {
				await browser.close()
			}
		}
	} finally {
		if (server) await new Promise<void>((done) => server!.close(() => done()))
		await app?.close()
		await project.remove()
	}
}

async function open(browser: Browser, origin: string, path: string, options: BrowserContextOptions = {}): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
	const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, ...options })
	const page = await context.newPage()
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.addInitScript({ content: spy })
	await page.goto(origin + path, { waitUntil: 'networkidle' })
	await page.waitForFunction(() => performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 30_000 })
	return { page, errors, close: () => context.close() }
}

/** Long to short and back, forward again, and short to long and back. */
async function bothWays(browser: Browser, origin: string, options: BrowserContextOptions, label: string): Promise<void> {
	const { page, errors, close } = await open(browser, origin, '/long', options)
	await scrollPage(page, 15000)
	await follow(page, 'to-short', 'short')
	assert.equal(await scrollPosition(page), 0, `${label}: a new navigation starts at the top`)
	await scrollPage(page, 300)
	await clearFrames(page)
	await page.goBack()
	await settled(page, 'long')
	near(await scrollPosition(page), 15000, `${label}: back to the long page`)
	await assertNoJump(page, 'long', 15000, `${label}: back`)
	await clearFrames(page)
	await page.goForward()
	await settled(page, 'short')
	near(await scrollPosition(page), 300, `${label}: forward, from long to short`)
	await assertNoJump(page, 'short', 300, `${label}: forward`)
	await page.goBack()
	await settled(page, 'long')
	near(await scrollPosition(page), 15000, `${label}: back again`)
	assert.deepEqual(errors, [])
	await close()
}

test('back and forward return to the position of each entry, with no frame elsewhere, with and without View Transitions', { timeout: 300_000 }, async () => {
	await withServedApp(async (origin, browser, engine) => {
		await bothWays(browser, origin, {}, `${engine} animated`)
		await bothWays(browser, origin, { reducedMotion: 'reduce' }, `${engine} reduced motion`)

		const { page, close } = await open(browser, origin, '/long')
		const animates = await page.evaluate(() => typeof document.startViewTransition === 'function')
		await scrollPage(page, 9000)
		await follow(page, 'to-other', 'other')
		await scrollPage(page, 4000)
		await page.evaluate(() => {
			;(globalThis as unknown as Spy).spy.atReady.length = 0
		})
		await page.goBack()
		await settled(page, 'long')
		near(await scrollPosition(page), 9000, 'back between animated pages')
		if (animates) {
			const atReady = await page.evaluate(() => (globalThis as unknown as Spy).spy.atReady)
			assert.equal(atReady.length, 1, 'the traversal animates')
			near(atReady[0]!, 9000, 'the transition captures the page at its position')
		}
		await close()
	})
})

test('an entry with a fragment returns to its position, and a new navigation still goes to the anchor or the top', { timeout: 300_000 }, async () => {
	await withServedApp(async (origin, browser, engine) => {
		const { page, errors, close } = await open(browser, origin, '/short')
		await follow(page, 'to-mid', 'long')
		const anchor = await scrollPosition(page)
		assert.ok(anchor > 9000, `${engine}: a new navigation goes to the anchor: ${anchor}`)
		await scrollPage(page, anchor + 3000)
		await follow(page, 'to-short', 'short')
		assert.equal(await scrollPosition(page), 0)
		await page.goBack()
		await settled(page, 'long')
		near(await scrollPosition(page), anchor + 3000, `${engine}: the entry keeps its position, not the anchor`)
		await close()

		// Fragment links of the page are the browser's, and also get a position per entry.
		const same = await open(browser, origin, '/long')
		await scrollPage(same.page, 1000)
		await same.page.locator('#here-mid').click()
		await same.page.waitForFunction(() => location.hash === '#mid')
		await nextFrames(same.page)
		const target = await scrollPosition(same.page)
		assert.ok(target > 9000, `${engine}: the fragment link scrolls: ${target}`)
		await scrollPage(same.page, target + 500)
		await same.page.goBack()
		await same.page.waitForFunction(() => location.hash === '')
		await nextFrames(same.page)
		near(await scrollPosition(same.page), 1000, `${engine}: back to the entry before the fragment`)
		await same.page.goForward()
		await same.page.waitForFunction(() => location.hash === '#mid')
		await nextFrames(same.page)
		near(await scrollPosition(same.page), target + 500, `${engine}: forward to the fragment keeps its position`)
		assert.deepEqual(same.errors, [])
		await same.close()
		assert.deepEqual(errors, [])
	})
})

test('a reload and a return from another document keep the position, and other code keeps its history state', { timeout: 300_000 }, async () => {
	await withServedApp(async (origin, browser, engine) => {
		const { page, errors, close } = await open(browser, origin, '/short')
		await scrollPage(page, 500)
		await follow(page, 'to-long', 'long')
		await scrollPage(page, 12000)
		await page.reload({ waitUntil: 'networkidle' })
		await page.waitForFunction(() => performance.getEntriesByName('meeko-hydration').length > 0)
		await nextFrames(page)
		near(await scrollPosition(page), 12000, `${engine}: reload`)
		await page.waitForTimeout(300)
		near(await scrollPosition(page), 12000, `${engine}: reload, once hydrated`)
		// The entry before the reload still has its position, in the storage.
		await page.goBack()
		await settled(page, 'short')
		near(await scrollPosition(page), 500, `${engine}: back after a reload`)
		await page.goForward()
		await settled(page, 'long')
		near(await scrollPosition(page), 12000, `${engine}: forward after a reload`)

		// Another document and back, from the bfcache or by loading it again.
		await page.evaluate(() => location.assign('/short?document'))
		await page.waitForURL('**/short?document')
		await page.waitForFunction(() => performance.getEntriesByName('meeko-hydration').length > 0)
		await page.goBack()
		await page.waitForFunction(() => location.pathname === '/long' && document.querySelector('h1')?.id === 'long')
		await page.waitForFunction(() => performance.getEntriesByName('meeko-hydration').length > 0)
		await nextFrames(page)
		near(await scrollPosition(page), 12000, `${engine}: back from another document`)
		// SPA navigation still restores by itself after coming back.
		await page.waitForTimeout(100)
		assert.equal(await page.evaluate(() => history.scrollRestoration), 'manual', 'and the page takes over again')

		// The state of other code survives new navigations and traversals.
		await page.evaluate(() => history.replaceState({ ...history.state, mine: 1 }, ''))
		await follow(page, 'to-short', 'short')
		await page.goBack()
		await settled(page, 'long')
		assert.equal(await page.evaluate(() => (history.state as { mine?: number }).mine), 1, 'the entry keeps the state of other code')
		assert.deepEqual(errors, [])
		await close()
	})
})

test('with a request in flight the last destination wins, and late content neither jumps on another page nor moves a reader who scrolled', { timeout: 300_000 }, async () => {
	await withServedApp(async (origin, browser, engine) => {
		// Back to a slow page: the position arrives with its page, and the first frame already has it.
		const slow = await open(browser, origin, '/slow')
		await scrollPage(slow.page, 2000)
		await follow(slow.page, 'to-long', 'long')
		await scrollPage(slow.page, 7000)
		await clearFrames(slow.page)
		await slow.page.goBack()
		await slow.page.waitForTimeout(300)
		near(await scrollPosition(slow.page), 7000, `${engine}: the old page does not move while the request is in flight`)
		await settled(slow.page, 'slow')
		near(await scrollPosition(slow.page), 2000, `${engine}: back to the slow page`)
		await assertNoJump(slow.page, 'slow', 2000, `${engine}: slow`)
		assert.deepEqual(slow.errors, [])
		await slow.close()

		// Back to a slow page and, with the request in flight, somewhere else: nothing lands later.
		const { page, errors, close } = await open(browser, origin, '/short')
		await scrollPage(page, 400)
		await follow(page, 'to-slow', 'slow')
		await scrollPage(page, 3000)
		await follow(page, 'to-long', 'long')
		await page.goBack()
		await page.waitForFunction(() => location.pathname === '/slow')
		await page.goBack()
		await settled(page, 'short')
		near(await scrollPosition(page), 400, `${engine}: the last destination`)
		await page.waitForTimeout(1600)
		assert.equal(await page.evaluate(() => document.querySelector('h1')?.id), 'short', `${engine}: the slow answer does not commit`)
		near(await scrollPosition(page), 400, `${engine}: and does not move the page`)
		assert.deepEqual(errors, [])
		await close()

		// A position that needs deferred content waits for it.
		const grow = await open(browser, origin, '/grow')
		await grow.page.waitForSelector('#grown')
		await scrollPage(grow.page, 12000)
		await follow(grow.page, 'to-short', 'short')
		await grow.page.goBack()
		await settled(grow.page, 'grow')
		await grow.page.waitForSelector('#grown', { timeout: 30_000 })
		await nextFrames(grow.page)
		await nextFrames(grow.page)
		near(await scrollPosition(grow.page), 12000, `${engine}: the position arrives with the deferred content`)
		assert.deepEqual(grow.errors, [])

		// The same with a reader who scrolls meanwhile: the page stays with them.
		await follow(grow.page, 'to-short', 'short')
		await grow.page.goBack()
		await settled(grow.page, 'grow')
		await grow.page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
		await grow.page.waitForSelector('#grown', { timeout: 30_000 })
		await nextFrames(grow.page)
		await nextFrames(grow.page)
		assert.equal(await scrollPosition(grow.page), 0, `${engine}: late content does not take the page from the reader`)

		// And content that arrives after leaving does not move the next page.
		await scrollPage(grow.page, 12000)
		await follow(grow.page, 'to-short', 'short')
		await grow.page.goBack()
		await grow.page.waitForFunction(() => document.querySelector('h1')?.id === 'grow')
		await follow(grow.page, 'to-short', 'short')
		await scrollPage(grow.page, 200)
		await grow.page.waitForTimeout(1600)
		near(await scrollPosition(grow.page), 200, `${engine}: no late jump on another page`)
		assert.deepEqual(grow.errors, [])
		await grow.close()
	})
})
