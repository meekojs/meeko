import assert from 'node:assert/strict'
import test from 'node:test'

import { createAppNavigator, createNavigator, createRouteManifest } from '../src/app/runtime/router.ts'

const routes = createRouteManifest([{ id: '/docs/[slug]', file: 'doc.meeko', layouts: [] }])

/** A browser with a history stack, a page of `height` px and one queue of animation frames. */
function fakeBrowser(start: string, storage = new Map<string, string>()) {
	const stack: Array<{ url: string; state: unknown }> = [{ url: start, state: null }]
	let index = 0
	let frames: Array<(time: number) => void> = []
	const listeners = new Map<string, Set<(event: Event) => void>>()
	const scrolls: number[] = []
	const page = { height: 100_000, viewport: 1000 }
	const browser = {
		scrollX: 0,
		scrollY: 0,
		innerHeight: page.viewport,
		get location() {
			return new URL(stack[index]!.url)
		},
		history: {
			scrollRestoration: 'auto',
			get state() {
				return stack[index]!.state
			},
			pushState(state: unknown, _title: string, url: URL | string) {
				stack.splice(index + 1)
				stack.push({ url: new URL(url, stack[index]!.url).href, state })
				index++
			},
			replaceState(state: unknown, _title: string, url: URL | string) {
				stack[index] = { url: new URL(url, stack[index]!.url).href, state }
			},
		},
		document: {
			get documentElement() {
				return { scrollHeight: page.height }
			},
			getElementById: () => null,
			getElementsByName: () => [],
		},
		sessionStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => void storage.set(key, value),
		},
		scrollTo(options: ScrollToOptions) {
			browser.scrollY = Math.max(0, Math.min(options.top ?? 0, page.height - page.viewport))
			scrolls.push(browser.scrollY)
		},
		requestAnimationFrame(callback: (time: number) => void) {
			frames.push(callback)
			return frames.length
		},
		cancelAnimationFrame() {
			frames = []
		},
		addEventListener(name: string, listener: (event: Event) => void) {
			if (!listeners.has(name)) listeners.set(name, new Set())
			listeners.get(name)!.add(listener)
		},
		removeEventListener(name: string, listener: (event: Event) => void) {
			listeners.get(name)?.delete(listener)
		},
	}
	const dispatch = (name: string, persisted = false): void => {
		for (const listener of listeners.get(name) ?? []) listener(Object.assign(new Event(name), { persisted }))
	}
	return {
		window: browser as unknown as Window,
		browser,
		page,
		scrolls,
		dispatch,
		/** Moves through the history like the browser, which fires `popstate` and, with `manual`, does not scroll. */
		traverse(delta: number) {
			index += delta
			dispatch('popstate')
		},
		runFrame() {
			const queued = frames
			frames = []
			for (const frame of queued) frame(0)
		},
		get pendingFrames() {
			return frames.length
		},
		/** The reader scrolls: the position changes and the event comes at the next frame. */
		userScroll(top: number) {
			browser.scrollY = top
			dispatch('scroll')
		},
		state: () => stack[index]!.state as Record<string, unknown> | null,
	}
}

const settle = () => new Promise<void>((done) => setImmediate(done))

test('a history.state that is not a plain object stays as it is: its entry has no name and returns to the top', async () => {
	class Custom {
		kept = 7
	}
	const url = 'https://example.test/docs/long'
	for (const state of [['kept', 7], new Custom(), new Date(0), new Map([['kept', 7]])]) {
		const fake = fakeBrowser(url)
		fake.browser.history.replaceState(state, '', url)
		const navigator = createNavigator(routes, () => {}, fake.window)
		assert.equal(fake.state(), state, 'creating the memory leaves it alone')
		fake.userScroll(500)
		assert.equal(fake.state(), state, 'a scroll leaves it alone')
		await navigator.navigate('/docs/short')
		assert.equal(fake.browser.scrollY, 0)
		fake.traverse(-1)
		await settle()
		assert.equal(fake.browser.location.pathname, '/docs/long')
		assert.equal(fake.state(), state, 'still the same value of the application')
		assert.equal(fake.browser.scrollY, 0, 'no name, no position')
		navigator.dispose()
	}
})

test('a replacing navigation does not spread a state that is not a plain object', async () => {
	const url = 'https://example.test/docs/long'
	const fake = fakeBrowser(url)
	const navigator = createNavigator(routes, () => {}, fake.window)
	fake.userScroll(500)
	// The entry already has a name, and the application then gives it another kind of state.
	const state = ['kept', 7]
	fake.browser.history.replaceState(state, '', url)
	await navigator.navigate('/docs/long#part', { replace: true })
	assert.equal(fake.state(), state)
	navigator.dispose()
})

test('a plain object or null gets the name of its entry, and keeps the rest of the state', async () => {
	const url = 'https://example.test/docs/long'
	const bare = Object.assign(Object.create(null) as Record<string, unknown>, { kept: 7 })
	for (const state of [null, { kept: 7 }, bare]) {
		const fake = fakeBrowser(url)
		fake.browser.history.replaceState(state, '', url)
		const navigator = createNavigator(routes, () => {}, fake.window)
		fake.userScroll(500)
		assert.equal(typeof fake.state()?.meekoEntry, 'string')
		if (state) assert.equal(fake.state()?.kept, 7)
		await navigator.navigate('/docs/short')
		fake.traverse(-1)
		await settle()
		assert.equal(fake.browser.scrollY, 500)
		navigator.dispose()
	}
})

test('back and forward return to the position of each entry, in both directions', async () => {
	const fake = fakeBrowser('https://example.test/docs/long')
	const navigator = createNavigator(routes, () => {}, fake.window)
	assert.equal(fake.browser.history.scrollRestoration, 'manual')
	fake.userScroll(50_000)
	await navigator.navigate('/docs/short')
	assert.equal(fake.browser.scrollY, 0, 'a new entry starts at the top')
	fake.userScroll(300)
	fake.traverse(-1)
	await settle()
	assert.equal(fake.browser.location.pathname, '/docs/long')
	assert.equal(fake.browser.scrollY, 50_000)
	fake.traverse(1)
	await settle()
	assert.equal(fake.browser.scrollY, 300)
	navigator.dispose()
})

test('the position is applied in the same turn as the commit of the traversal, without waiting for a frame', async () => {
	const fake = fakeBrowser('https://example.test/docs/long')
	let positionAtCommit = -1
	const navigator = createNavigator(
		routes,
		() => {
			positionAtCommit = fake.browser.scrollY
		},
		fake.window,
	)
	fake.userScroll(5000)
	await navigator.navigate('/docs/short')
	fake.traverse(-1)
	await settle()
	assert.equal(positionAtCommit, 0, 'the old page is on screen while it renders')
	assert.equal(fake.browser.scrollY, 5000)
	assert.equal(fake.pendingFrames, 0, 'nothing is left for a later frame when the position is reachable')
	navigator.dispose()
})

test('a renderer that settles the scroll with its DOM gets it there, for new entries and traversals, and once', async () => {
	const fake = fakeBrowser('https://example.test/docs/a')
	const seen: number[] = []
	const navigator = createAppNavigator(
		routes,
		(context) => {
			context.settleScroll?.()
			seen.push(fake.browser.scrollY)
		},
		fake.window,
	)
	fake.userScroll(5000)
	await navigator.navigate('/docs/b')
	assert.deepEqual(seen, [0], 'a new entry is at the top before the update callback ends')
	assert.deepEqual(fake.scrolls, [0], 'and scrolls once')
	fake.userScroll(700)
	fake.traverse(-1)
	await settle()
	assert.deepEqual(seen, [0, 5000], 'the entry left keeps the position it had before the scroll')
	fake.traverse(1)
	await settle()
	assert.deepEqual(seen, [0, 5000, 700])
	navigator.dispose()
})

test('a position beyond the end waits for the content, and gives way to whoever moves the page', async () => {
	const fake = fakeBrowser('https://example.test/docs/grow')
	const navigator = createNavigator(routes, () => {}, fake.window)
	fake.userScroll(20_000)
	await navigator.navigate('/docs/short')
	fake.page.height = 3000
	fake.traverse(-1)
	await settle()
	assert.equal(fake.browser.scrollY, 2000, 'as far as it can')
	fake.page.height = 10_000
	fake.runFrame()
	assert.equal(fake.browser.scrollY, 9000, 'further with what has arrived')
	fake.page.height = 100_000
	fake.runFrame()
	assert.equal(fake.browser.scrollY, 20_000, 'there once it fits')
	assert.equal(fake.pendingFrames, 0)

	await navigator.navigate('/docs/short')
	fake.page.height = 3000
	fake.traverse(-1)
	await settle()
	assert.equal(fake.browser.scrollY, 2000)
	fake.userScroll(100)
	fake.page.height = 100_000
	fake.runFrame()
	assert.equal(fake.browser.scrollY, 100, 'the reader keeps the page')
	assert.equal(fake.pendingFrames, 0)
	navigator.dispose()
})

test('the last destination wins: a late answer lands nowhere and a wait stops with the next navigation', async () => {
	const fake = fakeBrowser('https://example.test/docs/a')
	let release: (() => void) | undefined
	let slow = false
	const navigator = createNavigator(
		routes,
		({ url }) => {
			if (slow && url.pathname === '/docs/b') return new Promise<void>((done) => (release = done))
		},
		fake.window,
	)
	fake.userScroll(1000)
	await navigator.navigate('/docs/b')
	fake.userScroll(2000)
	await navigator.navigate('/docs/c')
	fake.userScroll(3000)
	slow = true
	fake.traverse(-1) // To b, which is slow.
	await settle()
	assert.equal(fake.browser.scrollY, 3000, 'the old page stays still meanwhile')
	fake.traverse(-1) // To a, which wins.
	await settle()
	assert.equal(fake.browser.location.pathname, '/docs/a')
	assert.equal(fake.browser.scrollY, 1000)
	release!()
	await settle()
	assert.equal(fake.browser.scrollY, 1000, 'the answer of b does not move the page')

	// A position still waiting for content does not follow the reader to a new entry.
	fake.userScroll(1000)
	fake.page.height = 1500
	fake.traverse(1)
	await settle()
	fake.traverse(1)
	await settle()
	const waiting = fake.pendingFrames
	await navigator.navigate('/docs/d')
	assert.ok(waiting > 0)
	assert.equal(fake.pendingFrames, 0)
	assert.equal(fake.browser.scrollY, 0)
	navigator.dispose()
})

test('an entry with a fragment returns to its position, and without one to the anchor', async () => {
	const fake = fakeBrowser('https://example.test/docs/a')
	const scrolledTo: string[] = []
	const element = {
		scrollIntoView() {
			scrolledTo.push('part')
			fake.browser.scrollY = 7000
		},
	}
	fake.browser.document.getElementById = (() => element) as never
	const navigator = createNavigator(routes, () => {}, fake.window)
	await navigator.navigate('/docs/b#part')
	assert.deepEqual(scrolledTo, ['part'], 'a new navigation goes to the anchor')
	fake.userScroll(8000)
	await navigator.navigate('/docs/c')
	fake.traverse(-1)
	await settle()
	assert.equal(fake.browser.scrollY, 8000)
	assert.deepEqual(scrolledTo, ['part'], 'the entry has a position, so the anchor plays no part')

	// A fragment link of the page is the browser's: the entry appears without the navigator.
	fake.userScroll(1000)
	fake.browser.history.pushState(null, '', 'https://example.test/docs/b#other')
	fake.userScroll(9000)
	assert.equal(typeof fake.state()?.meekoEntry, 'string', 'the entry gets its name')
	fake.traverse(-1)
	await settle()
	assert.equal(fake.browser.scrollY, 1000, 'the previous entry kept the position before the jump')
	fake.traverse(1)
	await settle()
	assert.equal(fake.browser.scrollY, 9000)

	// Firefox and WebKit also fire `popstate` for that link, already scrolled and before `scroll`.
	fake.userScroll(1500)
	fake.browser.history.pushState(null, '', 'https://example.test/docs/b#third')
	fake.browser.scrollY = 7000
	fake.dispatch('popstate')
	fake.dispatch('scroll')
	fake.traverse(-1)
	await settle()
	assert.equal(fake.browser.scrollY, 1500, 'the position before the jump, not after it')
	fake.traverse(1)
	await settle()
	assert.equal(fake.browser.scrollY, 7000)

	// An entry nobody saw, as after clearing the storage, falls back to its anchor.
	const fresh = fakeBrowser('https://example.test/docs/a')
	const freshElement = {
		scrollIntoView() {
			scrolledTo.push('fresh')
		},
	}
	fresh.browser.document.getElementById = (() => freshElement) as never
	const other = createNavigator(routes, () => {}, fresh.window)
	await other.navigate('/docs/b#part')
	assert.equal(scrolledTo.filter((name) => name === 'fresh').length, 1)
	fresh.browser.history.pushState(null, '', 'https://example.test/docs/c#part')
	fresh.traverse(0)
	await settle()
	assert.equal(scrolledTo.filter((name) => name === 'fresh').length, 2)
	other.dispose()
	navigator.dispose()
})

test('other code keeps its data in history.state, through new navigations, traversals and replaced entries', async () => {
	const fake = fakeBrowser('https://example.test/docs/a')
	const navigator = createNavigator(routes, () => {}, fake.window)
	fake.browser.history.replaceState({ ...fake.state(), mine: 1 }, '', fake.browser.location.href)
	fake.userScroll(10)
	const name = fake.state()!.meekoEntry
	assert.equal(typeof name, 'string')
	await navigator.navigate('/docs/b')
	fake.traverse(-1)
	await settle()
	assert.deepEqual(fake.state(), { mine: 1, meekoEntry: name })
	await navigator.navigate('/docs/c', { replace: true })
	assert.deepEqual(fake.state(), { mine: 1, meekoEntry: name }, 'replacing an entry keeps it')

	// A state that is not an object cannot carry the name: it stays as it is, and the entry goes without.
	fake.browser.history.pushState('text', '', 'https://example.test/docs/d')
	fake.dispatch('scroll')
	assert.equal(fake.state() as unknown, 'text')
	navigator.dispose()
})

test('a page that hides leaves the entry to the browser, and the next document finds the positions', async () => {
	const storage = new Map<string, string>()
	const fake = fakeBrowser('https://example.test/docs/a', storage)
	const navigator = createNavigator(routes, () => {}, fake.window)
	fake.userScroll(4000)
	await navigator.navigate('/docs/b')
	fake.userScroll(6000)
	fake.dispatch('pagehide')
	assert.equal(fake.browser.history.scrollRestoration, 'auto', 'a reload restores early, before hydration')
	fake.dispatch('pageshow', true)
	assert.equal(fake.browser.history.scrollRestoration, 'manual', 'a page back from the bfcache takes over again')
	assert.equal(fake.browser.scrollY, 6000, 'and keeps its position')
	assert.deepEqual(fake.scrolls.slice(-1), [0], 'without a scroll of its own')
	// The WebKit of Windows brings it back at the top.
	fake.dispatch('pagehide')
	fake.browser.scrollY = 0
	fake.dispatch('pageshow', true)
	assert.equal(fake.browser.scrollY, 6000)
	fake.dispatch('pagehide')
	navigator.dispose()
	assert.match(storage.get('meeko:scroll')!, /\[0,4000\]/)

	// The reload of b: the browser restored it, so the position is not applied on top of it.
	const reloaded = fakeBrowser('https://example.test/docs/b', storage)
	reloaded.browser.history.replaceState(fake.state(), '', 'https://example.test/docs/b')
	reloaded.browser.history.scrollRestoration = 'auto'
	reloaded.browser.scrollY = 5500
	const next = createNavigator(routes, () => {}, reloaded.window)
	assert.equal(reloaded.browser.scrollY, 5500, 'the reader may have moved before hydration')
	assert.deepEqual(reloaded.scrolls, [])
	next.dispose()

	// An entry that stayed `manual`: the browser did nothing, so Meeko does.
	const manual = fakeBrowser('https://example.test/docs/b', storage)
	manual.browser.history.replaceState(fake.state(), '', 'https://example.test/docs/b')
	manual.browser.history.scrollRestoration = 'manual'
	const third = createNavigator(routes, () => {}, manual.window)
	assert.equal(manual.browser.scrollY, 5500, 'where the reader left it, on disposing the previous document')
	third.dispose()

	// Content rendered in the client only: the browser could not reach the position.
	const empty = fakeBrowser('https://example.test/docs/b', storage)
	empty.browser.history.replaceState(fake.state(), '', 'https://example.test/docs/b')
	empty.page.height = 700
	const fourth = createNavigator(routes, () => {}, empty.window)
	empty.page.height = 100_000
	empty.runFrame()
	assert.equal(empty.browser.scrollY, 5500)
	fourth.dispose()
})

test('loading a page writes nothing in the history, and an entry never scrolled returns to the top', async () => {
	const fake = fakeBrowser('https://example.test/docs/a')
	let writes = 0
	const replaceState = fake.browser.history.replaceState.bind(fake.browser.history)
	fake.browser.history.replaceState = (...args) => {
		writes++
		replaceState(...args)
	}
	const navigator = createNavigator(routes, () => {}, fake.window)
	assert.equal(writes, 0, 'a replaceState is a same-document navigation for whoever observes them')
	assert.equal(fake.state(), null)
	await navigator.navigate('/docs/b')
	assert.equal(writes, 0)
	fake.userScroll(4000)
	fake.traverse(-1)
	await settle()
	assert.equal(fake.browser.location.pathname, '/docs/a')
	assert.equal(fake.browser.scrollY, 0, 'it was at the top')
	fake.traverse(1)
	await settle()
	assert.equal(fake.browser.scrollY, 4000)
	navigator.dispose()

	// A page that loads already scrolled, as on a reload, has a position to remember from the start.
	const scrolled = fakeBrowser('https://example.test/docs/a')
	scrolled.browser.scrollY = 300
	const other = createNavigator(routes, () => {}, scrolled.window)
	assert.equal(typeof scrolled.state()?.meekoEntry, 'string')
	other.dispose()
})

test('storage that fails only costs the return from another document', async () => {
	const fake = fakeBrowser('https://example.test/docs/a')
	Object.defineProperty(fake.browser, 'sessionStorage', {
		get() {
			throw new Error('denied')
		},
	})
	const navigator = createNavigator(routes, () => {}, fake.window)
	fake.userScroll(4000)
	await navigator.navigate('/docs/b')
	fake.traverse(-1)
	await settle()
	assert.equal(fake.browser.scrollY, 4000)
	fake.dispatch('pagehide')
	navigator.dispose()
})
