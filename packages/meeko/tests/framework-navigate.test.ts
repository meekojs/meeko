import { Window as HappyWindow } from 'happy-dom'
import assert from 'node:assert/strict'
import test from 'node:test'

import type { PageSchema } from '../src/app/definitions/define-page.ts'
import type { ClientComponent } from '../src/app/runtime/client.ts'
import type { Component, DomScope } from '../src/app/runtime/renderer.ts'
import type { Signal } from '../src/core/reactivity.ts'
import type { PageRoute } from '../src/server/runtime/framework-render.ts'

import { useSearchParam } from '../src/app/composables/useSearchParam.ts'
import { mountClientApp, useNavigation } from '../src/app/runtime/client.ts'
import { bindComponent, renderComponent } from '../src/app/runtime/renderer.ts'
import { createRouteManifest } from '../src/app/runtime/router.ts'
import { navigate } from '../src/framework.ts'
import { createFrameworkHandler } from '../src/server/runtime/framework-render.ts'

/** A positive integer written as text in the URL. */
const pageNumber: PageSchema<unknown, number> = {
	'~standard': {
		version: 1,
		validate: (value) => (typeof value === 'string' && /^[1-9]\d*$/.test(value) ? { value: Number(value) } : { issues: ['invalid page'] }),
	},
}

function page(render: (props: Record<string, unknown>) => string, onHydrate?: () => void): ClientComponent {
	return {
		renderWithState: (props) => ({ html: render(props), state: {} }),
		renderToString: render,
		hydrateScope: () => {
			onHydrate?.()
			return () => {}
		},
	}
}

function layout(name: string, onHydrate?: () => void): ClientComponent {
	return {
		renderWithState: (props) => ({
			html: `<section data-layout="${name}">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, true)}</section>`,
			state: {},
		}),
		renderToString: (props) => `<section data-layout="${name}">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, false)}</section>`,
		hydrateScope: (scope: DomScope, props) => {
			onHydrate?.()
			return bindComponent(
				scope,
				0,
				() => props.outlet as Component<Record<string, unknown>>,
				() => ({}),
				'layout',
			)
		},
	}
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

/** The route and query string that a server loader received. */
function query(route: string, context: { searchParams: URLSearchParams }): string {
	const text = context.searchParams.toString()
	return text ? `${route}?${text}` : route
}

/** An application whose pages record the search their loader received. */
function fixture() {
	const loads: string[] = []
	const routes = createRouteManifest([
		{ id: '/', file: 'home.meeko', layouts: ['shell.meeko'], sidecar: 'home.route.ts' },
		{ id: '/users/[id]', file: 'user.meeko', layouts: ['shell.meeko'], sidecar: 'user.route.ts' },
		{ id: '/list', file: 'list.meeko', layouts: ['shell.meeko'], sidecar: 'list.route.ts' },
	])
	const searchParams = { page: undefined as Signal<number> | undefined, tab: undefined as Signal<string> | undefined }
	const listPage: ClientComponent = {
		renderWithState: () => {
			const current = useSearchParam('page', 1, { schema: pageNumber })
			return { html: `<p id="page">${current.value}</p>`, state: {} }
		},
		renderToString: () => `<p id="page">${useSearchParam('page', 1, { schema: pageNumber }).value}</p>`,
		hydrateScope: () => {
			searchParams.page = useSearchParam('page', 1, { schema: pageNumber })
			return () => {}
		},
	}
	const modules: Record<string, ClientComponent> = {
		'home.meeko': page(() => '<p id="home">Home</p>'),
		'user.meeko': page((props) => `<p id="user">${String((props.params as { id: string }).id)}:${JSON.stringify(props.search)}</p>`),
		'list.meeko': listPage,
		'shell.meeko': layout('shell', () => {
			searchParams.tab = useSearchParam('tab', 'profile')
		}),
	}
	const record = (route: string) => (context: { searchParams: URLSearchParams }) => {
		loads.push(query(route, context))
		return {}
	}
	const sidecars: Record<string, PageRoute> = {
		'home.route.ts': { load: record('/') },
		'user.route.ts': { load: record('/users') },
		'list.route.ts': { load: record('/list') },
	}
	return { routes, modules, sidecars, loads, searchParams }
}

type Fixture = ReturnType<typeof fixture>

async function boot(f: Fixture, url: string) {
	const server = createFrameworkHandler({
		routes: f.routes,
		loadPage: async (file) => f.modules[file]!,
		loadRoute: async (file) => f.sidecars[file]!,
	})
	const browser = new HappyWindow({ url })
	const response = await server(new Request(url))
	assert.equal(response.status, 200)
	const html = await response.text()
	browser.document.write(html)
	const root = browser.document.getElementById('app')!
	const errors: unknown[] = []
	const app = await mountClientApp({
		routes: f.routes,
		root: root as unknown as Element,
		payload: browser.document.getElementById('meeko-payload')!.textContent!,
		loadPage: async (file) => f.modules[file]!,
		serverData: true,
		fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
		browser: browser as unknown as Window,
		onNavigationError: (error) => errors.push(error),
	})
	return { app, browser, root, html, errors }
}

/** Replaces `location.assign` and `location.replace` so a document load is recorded, not performed. */
function recordDocumentLoads(browser: HappyWindow): string[] {
	const loads: string[] = []
	Object.defineProperty(browser.location, 'assign', { configurable: true, value: (url: string) => loads.push(`assign ${url}`) })
	Object.defineProperty(browser.location, 'replace', { configurable: true, value: (url: string) => loads.push(`replace ${url}`) })
	return loads
}

test('navigate() takes the typed target of <MeekoLink> and goes through the client router', async () => {
	const f = fixture()
	let pending: { readonly value: boolean } | undefined
	f.modules['home.meeko'] = page(
		() => '<p id="home">Home</p>',
		() => {
			pending = useNavigation().pending
		},
	)
	const gate = deferred<void>()
	f.sidecars['user.route.ts'] = {
		load: async (context: { searchParams: URLSearchParams }) => {
			await gate.promise
			f.loads.push(query('/users', context))
			return {}
		},
	}
	const { app, browser, root } = await boot(f, 'https://example.test/')
	f.loads.length = 0
	const length = browser.history.length
	const navigation = navigate({ to: '/users/[id]', params: { id: '42' }, search: { tab: 'activity', empty: null }, hash: 'bio' })
	await new Promise((done) => setTimeout(done, 0))
	assert.equal(pending?.value, true, 'useNavigation().pending follows a programmatic navigation')
	assert.equal(browser.location.pathname, '/', 'the URL changes when the page commits')
	gate.resolve()
	assert.equal(await navigation, true)
	assert.equal(browser.location.pathname + browser.location.search + browser.location.hash, '/users/42?tab=activity#bio')
	assert.equal(browser.history.length, length + 1)
	assert.equal(root.querySelector('#user')?.textContent, '42:{"tab":"activity"}')
	assert.deepEqual(f.loads, ['/users?tab=activity'])
	// A text URL, replacing the entry.
	assert.equal(await navigate('/users/7', { replace: true }), true)
	assert.equal(browser.location.pathname, '/users/7')
	assert.equal(browser.history.length, length + 1)
	assert.equal(root.querySelector('#user')?.textContent, '7:{}')
	app.dispose()
	browser.happyDOM.abort()
})

test('navigate() during the hydration waits for the router of the application', async () => {
	const f = fixture()
	let navigation: Promise<boolean> | undefined
	f.modules['home.meeko'] = page(
		() => '<p id="home">Home</p>',
		() => {
			navigation = navigate({ to: '/users/[id]', params: { id: '3' } }, { replace: true })
		},
	)
	const { app, browser, root } = await boot(f, 'https://example.test/')
	assert.equal(await navigation, true)
	assert.equal(browser.location.pathname, '/users/3')
	assert.equal(root.querySelector('#user')?.textContent, '3:{}')
	app.dispose()
	browser.happyDOM.abort()
})

test('navigate() loads another origin or a URL without a page as a document and refuses other schemes', async () => {
	const f = fixture()
	const { app, browser } = await boot(f, 'https://example.test/')
	const documents = recordDocumentLoads(browser)
	assert.equal(await navigate('https://elsewhere.test/a'), false)
	assert.equal(await navigate('/files/report.pdf', { replace: true }), false)
	assert.deepEqual(documents, ['assign https://elsewhere.test/a', 'replace https://example.test/files/report.pdf'])
	await assert.rejects(navigate('javascript:alert(1)'), (error: unknown) => error instanceof TypeError && /only follows http: and https:/.test(error.message))
	assert.equal(browser.location.pathname, '/')
	assert.equal(documents.length, 2)
	// An unknown route or missing params of a typed target reject like href().
	await assert.rejects(navigate({ to: '/nowhere' } as never), /Unknown route: \/nowhere/)
	app.dispose()
	browser.happyDOM.abort()
})

test('navigate() applies the link resolvers of the plugins like <MeekoLink>', async () => {
	const f = fixture()
	const server = createFrameworkHandler({ routes: f.routes, loadPage: async (file) => f.modules[file]!, loadRoute: async (file) => f.sidecars[file]! })
	const browser = new HappyWindow({ url: 'https://example.test/' })
	browser.document.write(await (await server(new Request('https://example.test/'))).text())
	const { definePlugin } = await import('../src/app/definitions/define-plugin.ts')
	const resolved: string[] = []
	const app = await mountClientApp({
		routes: f.routes,
		root: browser.document.getElementById('app') as unknown as Element,
		payload: browser.document.getElementById('meeko-payload')!.textContent!,
		loadPage: async (file) => f.modules[file]!,
		serverData: true,
		fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
		browser: browser as unknown as Window,
		plugins: [
			{
				name: 'resolver',
				plugin: definePlugin((plugin) =>
					plugin.resolveLink(({ to, href, hreflang }) => {
						resolved.push(`${to} ${href} ${String(hreflang)}`)
						return hreflang === 'tab' ? `${href}&via=resolver` : href
					}),
				),
			},
		],
	})
	assert.equal(await navigate({ to: '/users/[id]', params: { id: '1' }, search: { a: 1 }, hreflang: 'tab' }), true)
	assert.equal(browser.location.search, '?a=1&via=resolver')
	assert.equal(await navigate({ to: '/users/[id]', params: { id: '2' }, search: { a: 1 }, hreflang: 'tab', resolve: false }), true)
	assert.equal(browser.location.search, '?a=1')
	assert.deepEqual(resolved, ['/users/[id] /users/1?a=1 tab'])
	app.dispose()
	browser.happyDOM.abort()
})

test('navigate() outside a mounted app and during SSR throws and points to redirect()', async () => {
	assert.throws(() => navigate('/users/1'), /navigate\(\) sólo funciona en el navegador.*usa redirect\(\)/)
	const f = fixture()
	// A browser app in the same process does not make a server render navigate.
	const { app, browser } = await boot(f, 'https://example.test/')
	let failure: unknown
	f.modules['home.meeko'] = page(() => {
		try {
			void navigate('/users/1')
		} catch (error) {
			failure = error
		}
		return '<p id="home">Home</p>'
	})
	const server = createFrameworkHandler({ routes: f.routes, loadPage: async (file) => f.modules[file]!, loadRoute: async (file) => f.sidecars[file]! })
	assert.equal((await server(new Request('https://example.test/'))).status, 200)
	assert.match(String(failure), /navigate\(\) sólo funciona en el navegador.*usa redirect\(\)/)
	assert.equal(browser.location.pathname, '/')
	app.dispose()
	browser.happyDOM.abort()
	assert.throws(() => navigate('/users/1'), /usa redirect\(\)/, 'dispose releases the application')
})

test('useSearchParam reads the request URL in SSR, falls back on invalid values and hydrates the same value', async () => {
	const f = fixture()
	const { app, browser, root, html } = await boot(f, 'https://example.test/list?page=3&tab=history')
	assert.match(html, /<p id="page">3<\/p>/)
	assert.equal(root.querySelector('#page')?.textContent, '3')
	assert.equal(f.searchParams.page?.value, 3)
	assert.equal(f.searchParams.tab?.value, 'history')
	app.dispose()
	browser.happyDOM.abort()
	for (const query of ['?page=0', '?page=abc', '?page=2&page=3', '']) {
		const other = fixture()
		const booted = await boot(other, `https://example.test/list${query}`)
		assert.match(booted.html, /<p id="page">1<\/p>/, query)
		assert.equal(other.searchParams.page?.value, 1, query)
		booted.app.dispose()
		booted.browser.happyDOM.abort()
	}
	// Writing on the server is an error: the value is read-only there.
	const reader: ClientComponent = page(() => {
		const tab = useSearchParam('tab', 'profile')
		assert.throws(() => {
			tab.value = 'x'
		}, /sólo se puede escribir en el navegador/)
		return '<p>ok</p>'
	})
	const g = fixture()
	g.modules['home.meeko'] = reader
	const server = createFrameworkHandler({ routes: g.routes, loadPage: async (file) => g.modules[file]!, loadRoute: async (file) => g.sidecars[file]! })
	assert.equal((await server(new Request('https://example.test/'))).status, 200)
})

test('writing useSearchParam navigates with replace, keeps the other params and the hash and reloads the data', async () => {
	const f = fixture()
	const gate = deferred<void>()
	let gated = false
	f.sidecars['list.route.ts'] = {
		load: async (context: { searchParams: URLSearchParams }) => {
			if (gated) await gate.promise
			f.loads.push(query('/list', context))
			return {}
		},
	}
	const { app, browser, root, errors } = await boot(f, 'https://example.test/list?tab=history&q=x#results')
	f.loads.length = 0
	const length = browser.history.length
	const tab = f.searchParams.tab!
	gated = true
	tab.value = 'activity'
	// The written value reads at once, before the navigation commits.
	assert.equal(tab.value, 'activity')
	await new Promise((done) => setTimeout(done, 0))
	assert.equal(browser.location.search, '?tab=history&q=x')
	gated = false
	gate.resolve()
	await new Promise((done) => setTimeout(done, 20))
	assert.equal(browser.location.search, '?tab=activity&q=x')
	assert.equal(browser.location.hash, '#results')
	assert.equal(browser.history.length, length, 'replace by default')
	assert.deepEqual(f.loads, ['/list?tab=activity&q=x'])
	assert.equal(tab.value, 'activity')
	// The default value leaves the URL; the page that remounted reads its own parameter.
	tab.value = 'profile'
	f.searchParams.page!.value = 2
	await new Promise((done) => setTimeout(done, 20))
	assert.equal(browser.location.search, '?q=x&page=2', 'consecutive writes build on each other')
	assert.equal(root.querySelector('#page')?.textContent, '2')
	assert.equal(tab.value, 'profile')
	assert.equal(f.searchParams.page?.value, 2)
	// Writing the current value does not navigate.
	const before = f.loads.length
	f.searchParams.page!.value = 2
	await new Promise((done) => setTimeout(done, 20))
	assert.equal(f.loads.length, before)
	assert.deepEqual(errors, [])
	app.dispose()
	browser.happyDOM.abort()
})

test('useSearchParam follows history navigation and pushes with history: "push"; a failed navigation reverts the value', async () => {
	const f = fixture()
	let pushed: Signal<string> | undefined
	f.modules['shell.meeko'] = layout('shell', () => {
		pushed = useSearchParam('tab', 'profile', { history: 'push' })
	})
	const { app, browser, errors } = await boot(f, 'https://example.test/list')
	const length = browser.history.length
	pushed!.value = 'activity'
	await new Promise((done) => setTimeout(done, 20))
	assert.equal(browser.location.search, '?tab=activity')
	assert.equal(browser.history.length, length + 1)
	browser.history.back()
	await new Promise((done) => setTimeout(done, 50))
	assert.equal(browser.location.search, '')
	assert.equal(pushed!.value, 'profile')
	// A loader that fails keeps the previous page, and the written value goes back to the URL's.
	f.sidecars['list.route.ts'] = {
		load: () => {
			throw new Error('list failed')
		},
	}
	pushed!.value = 'broken'
	assert.equal(pushed!.value, 'broken')
	await new Promise((done) => setTimeout(done, 20))
	assert.equal(pushed!.value, 'profile')
	assert.equal(browser.location.search, '')
	assert.equal(errors.length, 1)
	app.dispose()
	browser.happyDOM.abort()
})

test('useSearchParam rejects an asynchronous schema and a value it cannot write', async () => {
	const f = fixture()
	const asynchronous: PageSchema<unknown, string> = { '~standard': { version: 1, validate: async (value) => ({ value: String(value) }) } }
	let failure: unknown
	f.modules['home.meeko'] = page(() => {
		try {
			void useSearchParam('tab', 'a', { schema: asynchronous }).value
		} catch (error) {
			failure = error
		}
		return '<p>ok</p>'
	})
	const server = createFrameworkHandler({ routes: f.routes, loadPage: async (file) => f.modules[file]!, loadRoute: async (file) => f.sidecars[file]! })
	assert.equal((await server(new Request('https://example.test/?tab=b'))).status, 200)
	assert.match(String(failure), /the schema must validate synchronously/)
	const g = fixture()
	const { app, browser } = await boot(g, 'https://example.test/list')
	assert.throws(() => {
		g.searchParams.tab!.value = { nested: true } as never
	}, /only strings, numbers, booleans, dates and arrays of them/)
	app.dispose()
	browser.happyDOM.abort()
})
