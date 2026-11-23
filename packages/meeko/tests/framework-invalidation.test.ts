import { Window as HappyWindow } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import type { ClientComponent, ClientRoute } from '../src/app/runtime/client.ts'
import type * as client_tsTypes from '../src/app/runtime/client.ts'
import type { RouteRecord } from '../src/app/runtime/router.ts'
import type * as framework_server_tsTypes from '../src/framework-server.ts'
import type { Schema } from '../src/framework-server.ts'
import type { DataKey, PageRequest, RouteState } from '../src/framework.ts'
import type * as framework_render_tsTypes from '../src/server/runtime/framework-render.ts'
import type * as invalidation_tsTypes from '../src/shared/invalidation.ts'

import { createRouteManifest } from '../src/app/runtime/router.ts'
import { compile } from '../src/compiler.ts'
import { defineApiRoute, defineRpc } from '../src/framework-server.ts'
import { definePage, invalidate } from '../src/framework.ts'
import { checkApp } from '../src/framework/check-app.ts'
import { conventionDataKeys } from '../src/framework/contracts-generate.ts'
import { apiDataKey, checkDataKey, formatInvalidation, keyMatches, parseInvalidation } from '../src/shared/invalidation.ts'

const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href

/** The runtime as the compiled pages import it, by file URL: one instance for pages, server and browser. */
const runtime = async () => ({
	...((await import(fileUrl('src/server/runtime/framework-render.ts'))) as typeof framework_render_tsTypes),
	...((await import(fileUrl('src/app/runtime/client.ts'))) as typeof client_tsTypes),
	...((await import(fileUrl('src/framework-server.ts'))) as typeof framework_server_tsTypes),
	...((await import(fileUrl('src/shared/invalidation.ts'))) as typeof invalidation_tsTypes),
})

const anything = <T>(): Schema<T> => ({ '~standard': { version: 1, validate: (value) => ({ value: value as T }) } })

/** The application's data and every request the browser sends to it. */
interface Store {
	orders: string[]
	calls: string[]
	/** Holds `GET /api/orders` until it resolves. */
	gate: Promise<void> | undefined
	/** Mounts of the orders page in the browser, to tell a remount from an update in place. */
	setups: number
	loads: number
}

/** What the dashboard page exposes to the test. */
interface Dashboard {
	readonly list: { readonly refreshing: { readonly value: boolean } }
	readonly add: { mutate(input: { name: string; stats?: boolean }): Promise<unknown> }
	readonly fail: { mutate(input: unknown): Promise<unknown> }
	readonly create: { mutate(input: { body: { name: string } }): Promise<unknown> }
	readonly route: RouteState
}

const globals = globalThis as unknown as { meekoStore?: Store; meekoFetch?: typeof fetch; dashboard?: Dashboard; ordersView?: { draft: { value: string } } }

const dataModule = (framework: string): string => `import { createUseApi, createUseApiMutation, createUseRpcMutation, createUseRpcQuery } from ${framework};
const manifest = {
  api: [
    { clientKey: "orders", pathname: "/api/orders", method: "GET" },
    { clientKey: "orders", pathname: "/api/orders", method: "POST" },
    { clientKey: "customers", pathname: "/api/customers", method: "GET" },
  ],
  rpc: [
    { id: "orders.count", pathname: "/_meeko/rpc/orders.count" },
    { id: "orders.add", pathname: "/_meeko/rpc/orders.add" },
    { id: "orders.fail", pathname: "/_meeko/rpc/orders.fail" },
    { id: "stats.summary", pathname: "/_meeko/rpc/stats.summary" },
  ],
} as const;
const globals = globalThis as unknown as { meekoFetch: typeof fetch };
const options = { baseUrl: "https://example.test", fetch: ((input, init) => globals.meekoFetch(input, init)) as typeof fetch, csrfToken: () => "csrf" };
export const useApi = createUseApi(manifest, options);
export const useRpcQuery = createUseRpcQuery(manifest, options);
export const useRpcMutation = createUseRpcMutation(manifest, options);
export const useApiMutation = createUseApiMutation(manifest, options);
`

const dashboardPage = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import { useRoute } from "@meekojs/meeko/framework";
import { useApi, useApiMutation, useRpcMutation, useRpcQuery } from "./data.ts";
const route = useRoute();
const list = await useApi("/api/orders");
const count = await useRpcQuery("orders.count");
const stats = useRpcQuery("stats.summary");
const customers = useApi("/api/customers", undefined, { keys: ["crm"] });
const add = useRpcMutation("orders.add");
const fail = useRpcMutation("orders.fail");
const create = useApiMutation("/api/orders", "POST");
Object.assign(globalThis, { dashboard: { list, count, stats, customers, add, fail, create, route } });
</script>
<template><p class="list">{list.data.value.join(",")}</p><p class="count">{String(count.data.value)}</p><p class="stats">{stats.data.value ? String(stats.data.value.total) : "-"}</p></template>`

// The loader's data reaches the page twice: as props.data and as the export of its <script server>.
const ordersPage = `<script server lang="ts">
export const names = "";
</script>
<script lang="ts">
import { onMounted, signal } from "@meekojs/meeko";
const props = defineProps<{ data: { names: string } }>();
const draft = signal("typed");
const setups = globalThis as unknown as { meekoStore: { setups: number } };
// The server also renders the page for a payload; only a browser mount counts.
onMounted(() => {
	setups.meekoStore.setups++;
});
Object.assign(globalThis, { ordersView: { draft } });
</script>
<template><p class="names">{props.data.names}</p><p class="export">{names}</p><input class="draft" model="draft" /></template>`

const homePage = `<template><p class="home">home</p></template>`

const pages: Record<string, string> = { 'dashboard.meeko': dashboardPage, 'orders.meeko': ordersPage, 'home.meeko': homePage }

const routes: readonly RouteRecord[] = createRouteManifest([
	{ id: '/', file: 'home.meeko', layouts: [] },
	{ id: '/dashboard', file: 'dashboard.meeko', layouts: [] },
	{ id: '/orders', file: 'orders.meeko', layouts: [], sidecar: 'orders.route.ts' },
	{ id: '/spa', file: 'orders.meeko', layouts: [], sidecar: 'spa.route.ts', render: 'client' },
	{ id: '/live', file: 'orders.meeko', layouts: [], sidecar: 'live.route.ts', render: 'stream' },
])

const ordersLoad = ({ depends }: { depends: (...keys: string[]) => void }) => {
	const store = globals.meekoStore!
	store.loads++
	depends('orders')
	return { names: store.orders.join(',') }
}

const sidecars: Record<string, ClientRoute> = {
	'orders.route.ts': { load: ordersLoad } as ClientRoute,
	'spa.route.ts': { render: 'client', load: ordersLoad } as ClientRoute,
	'live.route.ts': { render: 'stream', load: ordersLoad } as ClientRoute,
}

async function loadPages(): Promise<{ modules: Record<string, ClientComponent>; cleanup: () => Promise<void> }> {
	await mkdir(resolve('.meeko'), { recursive: true })
	const directory = await mkdtemp(resolve('.meeko', 'invalidation-test-'))
	const pagesDirectory = join(directory, 'app', 'pages')
	await mkdir(pagesDirectory, { recursive: true })
	const runtimePath = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href)
	await writeFile(join(pagesDirectory, 'data.ts'), dataModule(runtimePath('src/framework.ts')))
	const modules: Record<string, ClientComponent> = {}
	for (const [file, source] of Object.entries(pages)) {
		const code = compile(source, join(pagesDirectory, file))
			.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtimePath('src/internal.ts')}`)
			.replace(`from "@meekojs/meeko/framework"`, `from ${runtimePath('src/framework.ts')}`)
			.replace(`from "@meekojs/meeko"`, `from ${runtimePath('src/index.ts')}`)
		const target = join(pagesDirectory, file.replace(/\.meeko$/, '.ts'))
		await writeFile(target, code)
		modules[file] = (await import(pathToFileURL(target).href)) as ClientComponent
	}
	return { modules, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

/** Writes declared with `defineRpc` and `defineApiRoute`, answered by the real dispatchers. */
async function installServer(): Promise<Store> {
	const { defineApiRoute, defineRpc, dispatchApiRoute, dispatchRpc, createRequestContext, MemorySessionStore, SessionManager, ApiError } = await runtime()
	const store: Store = { orders: ['a'], calls: [], gate: undefined, setups: 0, loads: 0 }
	globals.meekoStore = store
	const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false })
	const add = defineRpc({
		input: anything<{ name: string; stats?: boolean }>(),
		output: anything<{ count: number }>(),
		origin: 'none',
		invalidates: ['orders'],
		handler: ({ input, context }) => {
			store.orders.push(input.name)
			if (input.stats) context.invalidate('stats')
			return { count: store.orders.length }
		},
	})
	const fail = defineRpc({
		input: anything<unknown>(),
		output: anything<unknown>(),
		origin: 'none',
		invalidates: ['orders'],
		handler: ({ context }) => {
			context.invalidate('stats')
			throw new ApiError('SOLD_OUT', 409)
		},
	})
	const create = defineApiRoute({
		body: anything<{ name: string }>(),
		response: anything<{ name: string }>(),
		status: 201,
		origin: 'none',
		invalidates: ['orders'],
		handler: ({ body }) => {
			store.orders.push(body.name)
			return { name: body.name }
		},
	})
	const context = async (request: Request) => createRequestContext(request, {}, await sessions.load(request))
	globals.meekoFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init)
		const url = new URL(request.url)
		store.calls.push(`${request.method} ${url.pathname}`)
		if (url.pathname === '/api/orders' && request.method === 'GET') {
			if (store.gate) await store.gate
			return Response.json([...store.orders])
		}
		if (url.pathname === '/api/orders') return dispatchApiRoute(create, await context(request), sessions)
		if (url.pathname === '/api/customers') return Response.json(['c'])
		if (url.pathname === '/_meeko/rpc/orders.count') return Response.json(store.orders.length)
		if (url.pathname === '/_meeko/rpc/stats.summary') return Response.json({ total: store.orders.length * 10 })
		if (url.pathname === '/_meeko/rpc/orders.add') return dispatchRpc(add, await context(request), sessions)
		if (url.pathname === '/_meeko/rpc/orders.fail') return dispatchRpc(fail, await context(request), sessions)
		return new Response(null, { status: 404 })
	}) as typeof fetch
	return store
}

const flush = async (): Promise<void> => {
	for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Every application a test mounted: disposing them releases their data dependents. */
const opened: { dispose(): void }[] = []
const disposeAll = (): void => {
	for (const app of opened.splice(0)) app.dispose()
}

async function boot(modules: Record<string, ClientComponent>, url: string) {
	const { createFrameworkHandler, mountClientApp } = await runtime()
	const store = globals.meekoStore!
	const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]!, loadRoute: async (file) => sidecars[file]! as never })
	const browser = new HappyWindow({ url })
	const response = await server(new Request(url, { headers: { accept: 'text/html' } }))
	const document = await response.text()
	const ssrCalls = [...store.calls]
	browser.document.write(document)
	const root = browser.document.getElementById('app')! as unknown as Element
	const payload = browser.document.getElementById('meeko-payload')!.textContent!
	const app = await mountClientApp({
		routes,
		root,
		payload,
		loadPage: async (file) => modules[file]!,
		loadClientRoute: async (file) => sidecars[file]!,
		serverData: true,
		// Page payloads are counted with the data requests, by their URL.
		fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init)
			store.calls.push(`PAGE ${new URL(request.url).pathname}`)
			return server(request)
		}) as typeof fetch,
		onNavigationError: () => {},
		browser: browser as unknown as Window,
	})
	opened.push(app)
	return { app, browser, root, response, ssrCalls, payload: JSON.parse(payload) as Record<string, unknown> }
}

const text = (root: Element, selector: string): string | null | undefined => root.querySelector(selector)?.textContent
const view = () => globals.dashboard!

test('data keys are hierarchical by dots and travel percent-encoded in one header', () => {
	assert.equal(keyMatches('orders', 'orders'), true)
	assert.equal(keyMatches('orders', 'orders.list'), true)
	assert.equal(keyMatches('orders', 'orders.42.items'), true)
	assert.equal(keyMatches('orders', 'ordersArchive'), false)
	assert.equal(keyMatches('orders.list', 'orders'), false)
	assert.equal(formatInvalidation(['orders', 'orders', 'café, bar']), 'orders, caf%C3%A9%2C%20bar')
	assert.deepEqual(parseInvalidation('orders, caf%C3%A9%2C%20bar, , %E0%A4%A, .bad'), ['orders', 'café, bar'])
	assert.equal(formatInvalidation([]), undefined)
	for (const bad of ['', '.orders', 'orders.', 'a..b', 'line\nbreak', 'x'.repeat(201), 7]) assert.throws(() => checkDataKey(bad, 'test'), TypeError, String(bad))
	// The key by convention of an API path: its static segments after /api.
	assert.equal(apiDataKey('/api/orders'), 'orders')
	assert.equal(apiDataKey('/api/orders/[id]'), 'orders')
	assert.equal(apiDataKey('/api/orders/[id]/items'), 'orders.items')
	assert.equal(apiDataKey('/api/admin/orders'), 'admin.orders')
	assert.equal(apiDataKey('/api/[...path]'), 'api')
	assert.equal(apiDataKey('/api/v1.2/orders'), 'v1-2.orders')
})

test('a successful write sends its static and dynamic keys; an error, a read and a native form send none', async () => {
	const { defineApiRoute, defineRpc, dispatchApiRoute, dispatchRpc, createRequestContext, MemorySessionStore, SessionManager, ApiError, INVALIDATE_HEADER } = await runtime()
	const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false })
	const send = async (definition: object, body: unknown) => {
		const request = new Request('http://localhost/_meeko/rpc/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
		return dispatchRpc(definition as never, createRequestContext(request, {}, await sessions.load(request)), sessions)
	}
	const rename = defineRpc({
		input: anything<{ id: string; fail?: boolean }>(),
		output: anything<{ ok: boolean }>(),
		origin: 'none',
		invalidates: ['orders'],
		handler: ({ input, context }) => {
			context.invalidate(`orders.${input.id}`, 'stats')
			if (input.fail) throw new ApiError('CONFLICT', 409)
			return { ok: true }
		},
	})
	const ok = await send(rename, { id: '42' })
	assert.equal(ok.status, 200)
	assert.equal(ok.headers.get(INVALIDATE_HEADER), 'orders, orders.42, stats')
	const failed = await send(rename, { id: '42', fail: true })
	assert.equal(failed.status, 409)
	assert.equal(failed.headers.get(INVALIDATE_HEADER), null)
	// A response that breaks its schema is an error too: nothing changed for the client.
	const broken = defineRpc({ input: anything<unknown>(), output: { '~standard': { version: 1, validate: () => ({ issues: [{ message: 'no' }] }) } } as Schema<unknown>, origin: 'none', invalidates: ['orders'], handler: () => ({}) })
	assert.equal((await send(broken, {})).headers.get(INVALIDATE_HEADER), null)
	// A malformed key is a server fault.
	const misdeclared = defineRpc({ input: anything<unknown>(), output: anything<unknown>(), origin: 'none', invalidates: ['orders.'], handler: () => ({}) })
	assert.equal((await send(misdeclared, {})).status, 500)
	const without = defineRpc({ input: anything<unknown>(), output: anything<unknown>(), origin: 'none', handler: () => ({}) })
	assert.equal((await send(without, {})).headers.get(INVALIDATE_HEADER), null)

	const api = (method: string, init: RequestInit = {}) => new Request('http://localhost/api/orders', { method, ...init })
	const route = defineApiRoute({ body: anything<{ name: string }>(), response: anything<{ ok: boolean }>(), status: 201, origin: 'none', form: true, invalidates: ['orders'], handler: () => ({ ok: true }) })
	const json = api('POST', { body: '{"name":"a"}', headers: { 'content-type': 'application/json' } })
	const created = await dispatchApiRoute(route, createRequestContext(json, {}, await sessions.load(json)), sessions)
	assert.equal(created.status, 201)
	assert.equal(created.headers.get(INVALIDATE_HEADER), 'orders')
	// A native form answers 303: the page it returns to loads fresh data anyway.
	const form = api('POST', { body: 'name=a', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://localhost', referer: 'http://localhost/orders' } })
	const submitted = await dispatchApiRoute(route, createRequestContext(form, {}, await sessions.load(form)), sessions)
	assert.equal(submitted.status, 303)
	assert.equal(submitted.headers.get(INVALIDATE_HEADER), null)
	const read = defineApiRoute({ response: anything<string[]>(), invalidates: ['orders'], handler: () => [] })
	const get = api('GET')
	assert.equal((await dispatchApiRoute(read, createRequestContext(get, {}, await sessions.load(get)), sessions)).headers.get(INVALIDATE_HEADER), null)
})

test('a mutation refreshes the mounted resources whose keys match, keeping their data meanwhile', async () => {
	const store = await installServer()
	const { modules, cleanup } = await loadPages()
	try {
		const { root, response, ssrCalls } = await boot(modules, 'https://example.test/dashboard')
		// SSR is unaffected: a document carries no invalidation and its awaited data loads once.
		assert.equal(response.headers.get('x-meeko-invalidate'), null)
		assert.deepEqual(ssrCalls, ['GET /api/orders', 'POST /_meeko/rpc/orders.count'])
		await flush()
		assert.equal(text(root, '.stats'), '10')
		store.calls.length = 0

		// orders.add invalidates "orders": useApi("/api/orders") (key "orders") and
		// useRpcQuery("orders.count") (key "orders.count") refresh; stats and customers do not.
		let release!: () => void
		store.gate = new Promise((resolve) => (release = resolve))
		const added = view().add.mutate({ name: 'b' })
		await flush()
		assert.equal(view().list.refreshing.value, true)
		assert.equal(text(root, '.list'), 'a', 'the previous data stays while the refresh runs')
		let settled = false
		void added.then(() => (settled = true))
		await flush()
		assert.equal(settled, false, 'mutate resolves once the dependent data is fresh')
		store.gate = undefined
		release()
		await added
		assert.equal(view().list.refreshing.value, false)
		assert.equal(text(root, '.list'), 'a,b')
		assert.equal(text(root, '.count'), '2')
		assert.equal(text(root, '.stats'), '10')
		assert.deepEqual(store.calls.sort(), ['GET /api/orders', 'POST /_meeko/rpc/orders.add', 'POST /_meeko/rpc/orders.count'])

		// A key the handler adds: stats.summary is under "stats".
		store.calls.length = 0
		await view().add.mutate({ name: 'c', stats: true })
		assert.equal(text(root, '.stats'), '30')
		assert.deepEqual(store.calls.sort(), ['GET /api/orders', 'POST /_meeko/rpc/orders.add', 'POST /_meeko/rpc/orders.count', 'POST /_meeko/rpc/stats.summary'])

		// An error invalidates nothing, even with keys the handler added before it threw.
		store.calls.length = 0
		await assert.rejects(view().fail.mutate({}), { code: 'SOLD_OUT' })
		await flush()
		assert.deepEqual(store.calls, ['POST /_meeko/rpc/orders.fail'])

		// useApiMutation and a 201: the same header.
		store.calls.length = 0
		await view().create.mutate({ body: { name: 'd' } })
		assert.equal(text(root, '.list'), 'a,b,c,d')
		assert.deepEqual(store.calls.sort(), ['GET /api/orders', 'POST /_meeko/rpc/orders.count', 'POST /api/orders'])

		// Two mutations that end together share one refresh of each dependent.
		store.calls.length = 0
		await Promise.all([view().add.mutate({ name: 'e' }), view().add.mutate({ name: 'f' })])
		assert.deepEqual(store.calls.sort(), ['GET /api/orders', 'POST /_meeko/rpc/orders.add', 'POST /_meeko/rpc/orders.add', 'POST /_meeko/rpc/orders.count'])
		assert.equal(text(root, '.list'), 'a,b,c,d,e,f')
	} finally {
		disposeAll()
		await cleanup()
	}
})

test('invalidate() refreshes by explicit and conventional keys; unmounted resources never refetch', async () => {
	const store = await installServer()
	const { modules, cleanup } = await loadPages()
	const { invalidate } = await runtime()
	try {
		const { app } = await boot(modules, 'https://example.test/dashboard')
		await flush()
		store.calls.length = 0
		// The explicit key of useApi("/api/customers", …, { keys: ["crm"] }), besides "customers".
		await invalidate('crm')
		assert.deepEqual(store.calls, ['GET /api/customers'])
		store.calls.length = 0
		await invalidate('customers')
		assert.deepEqual(store.calls, ['GET /api/customers'])
		// A narrower key refreshes only what is under it.
		store.calls.length = 0
		await invalidate('orders.count')
		assert.deepEqual(store.calls, ['POST /_meeko/rpc/orders.count'])
		assert.throws(() => invalidate(), TypeError)
		// useRoute().refresh(): the page's data and every mounted resource, once each.
		store.calls.length = 0
		await view().route.refresh()
		// The payload request renders the page on the server, which loads its awaited data there too.
		assert.deepEqual([...new Set(store.calls)].sort(), ['GET /api/customers', 'GET /api/orders', 'PAGE /dashboard', 'POST /_meeko/rpc/orders.count', 'POST /_meeko/rpc/stats.summary'])
		assert.equal(store.calls.filter((call) => call === 'GET /api/customers' || call === 'POST /_meeko/rpc/stats.summary').length, 2)
		assert.throws(() => invalidate('orders..x'), TypeError)

		// After a navigation the dashboard's resources are released: nothing refetches.
		await app.navigate('https://example.test/')
		store.calls.length = 0
		await invalidate('orders', 'stats', 'crm')
		await flush()
		assert.deepEqual(store.calls, [])
		app.dispose()
	} finally {
		disposeAll()
		await cleanup()
	}
})

for (const route of ['/orders', '/spa', '/live']) {
	test(`a write reruns the loader of ${route} that depends on its key and updates the page without remounting it`, async () => {
		const store = await installServer()
		const { modules, cleanup } = await loadPages()
		const { invalidate } = await runtime()
		try {
			const { app, root, payload } = await boot(modules, `https://example.test${route}`)
			await flush()
			if (route !== '/spa') assert.deepEqual(payload.keys, ['orders'])
			assert.equal(text(root, '.names'), 'a')
			assert.equal(text(root, '.export'), 'a')
			const input = root.querySelector('.draft') as HTMLInputElement
			// The browser's instance: a payload request renders the page on the server too.
			const draft = globals.ordersView!.draft
			draft.value = 'still typing'
			const setups = store.setups
			const loads = store.loads
			store.calls.length = 0
			store.orders.push('b')
			await invalidate('orders.42')
			assert.equal(store.loads, loads, 'a key under the dependency is narrower: the loader does not rerun')
			await invalidate('orders')
			await flush()
			assert.equal(store.loads, loads + 1)
			assert.deepEqual(store.calls, route === '/spa' ? [] : [`PAGE ${route}`])
			assert.equal(text(root, '.names'), 'a,b')
			assert.equal(text(root, '.export'), 'a,b', 'the export of <script server> follows the new data')
			assert.equal(store.setups, setups, 'the page did not mount again')
			assert.equal(root.querySelector('.draft'), input, 'the same input element')
			assert.equal(draft.value, 'still typing')
			assert.equal(input.value, 'still typing')
			app.dispose()
		} finally {
			disposeAll()
			await cleanup()
		}
	})
}

test('useRoute().refresh() reruns the loader and every mounted resource; SSR has nothing to refresh', async () => {
	const store = await installServer()
	const { modules, cleanup } = await loadPages()
	const { fixedRoute } = await import(fileUrl('src/app/runtime/navigation.ts'))
	try {
		const ssr = fixedRoute({ url: '/', path: '/', id: '/', params: {}, search: {} }) as { refresh(): Promise<void> }
		await ssr.refresh()
		const { app, root } = await boot(modules, 'https://example.test/orders')
		await flush()
		const { liveRoute } = await import(fileUrl('src/app/runtime/navigation.ts'))
		const route = liveRoute({ url: '/orders', path: '/orders', id: '/orders', params: {}, search: {} }) as { state: { refresh(): Promise<void> } }
		store.orders.push('z')
		store.calls.length = 0
		await route.state.refresh()
		assert.deepEqual(store.calls, ['PAGE /orders'])
		assert.equal(text(root, '.names'), 'a,z')
		app.dispose()
	} finally {
		disposeAll()
		await cleanup()
	}
})

test('api.* and rpc.* apply the keys of a successful answer before they resolve, as useForm does through them', async () => {
	const { createApiClient, createRpcClient } = await import(fileUrl('src/shared/clients.ts'))
	const { registerDataDependent } = await runtime()
	const refreshed: string[] = []
	const release = registerDataDependent({
		keys: () => ['orders.list'],
		refresh: async () => {
			await new Promise((resolve) => setTimeout(resolve, 5))
			refreshed.push('orders.list')
		},
	})
	const fetcher = (async (input: RequestInfo | URL) => {
		const path = new URL(String(input)).pathname
		if (path.endsWith('/fail')) return Response.json({ code: 'NO' }, { status: 409, headers: { 'x-meeko-invalidate': 'orders' } })
		return path.endsWith('/empty') ? new Response(null, { status: 204, headers: { 'x-meeko-invalidate': 'orders' } }) : Response.json({ ok: true }, { headers: { 'x-meeko-invalidate': 'orders' } })
	}) as typeof fetch
	const options = { baseUrl: 'https://example.test', fetch: fetcher }
	try {
		const rpc = createRpcClient(
			{
				rpc: [
					{ id: 'orders.add', pathname: '/_meeko/rpc/orders.add' },
					{ id: 'orders.fail', pathname: '/_meeko/rpc/orders/fail' },
				],
			},
			options,
		) as Record<string, Record<string, (input: unknown) => Promise<unknown>>>
		const api = createApiClient({ api: [{ clientKey: 'orders', pathname: '/api/orders/empty', method: 'DELETE' }] }, options) as unknown as { orders: { delete(): Promise<unknown> } }
		assert.deepEqual(await rpc.orders!.add!({}), { ok: true })
		assert.deepEqual(refreshed, ['orders.list'])
		assert.equal(await api.orders.delete(), undefined)
		assert.deepEqual(refreshed, ['orders.list', 'orders.list'])
		// The header of an error answer is ignored.
		await assert.rejects(rpc.orders!.fail!({}), { code: 'NO' })
		await flush()
		assert.deepEqual(refreshed, ['orders.list', 'orders.list'])
	} finally {
		release()
	}
})

test('meeko check warns with MEEK141 about an invalidated key that no read can depend on', async () => {
	assert.deepEqual(
		conventionDataKeys(
			[
				{ pathname: '/api/orders/[id]/items', method: 'GET' },
				{ pathname: '/api/carts', method: 'POST' },
			],
			[{ id: 'stats.daily.summary' }],
		),
		['orders', 'orders.items', 'stats', 'stats.daily', 'stats.daily.summary'],
	)
	await mkdir(resolve('.meeko'), { recursive: true })
	const root = await mkdtemp(resolve('.meeko/invalidation-check-'))
	const write = async (path: string, text: string): Promise<void> => {
		await mkdir(join(root, path, '..'), { recursive: true })
		await writeFile(join(root, path), text)
	}
	try {
		await write('server/rpc/orders/list.ts', 'export default defineRpc({ input, output, handler: () => [] })\n')
		await write('server/api/stats.get.ts', 'export default defineApiRoute({ response, handler: () => ({}) })\n')
		await write(
			'server/rpc/orders/add.ts',
			[
				'export default defineRpc({',
				'  input, output,',
				'  invalidates: ["orders", "stats", "dashboard", "ordres", "orders.42"],',
				'  handler: ({ input, context }) => {',
				'    context.invalidate(`customers.${input.id}`, `crm.${input.id}`, "crm");',
				'    return {};',
				'  },',
				'})',
				'',
			].join('\n'),
		)
		await write('app/pages/index.meeko', '<script lang="ts">\nconst list = useApi("/api/customers", undefined, { keys: ["dashboard"] });\n</script>\n<template><p>x</p></template>\n')
		await write('app/pages/customers/[id].route.ts', 'export default definePage({ load: ({ params, depends }) => { depends(`customers.${params.id}`); return {} } })\n')
		const warnings = (await checkApp(root)).filter((diagnostic) => diagnostic.code === 'MEEK141')
		// "ordres" is a typo; "orders.42" is narrower than every read ("orders.list"); nothing reads crm.
		assert.deepEqual(
			warnings.map((warning) => warning.message.match(/"([^"]+)"/)![1]),
			['ordres', 'orders.42', 'crm.…', 'crm'],
		)
		assert.ok(warnings.every((warning) => warning.severity === 'warning' && warning.filename.endsWith(join('rpc', 'orders', 'add.ts'))))
		assert.deepEqual(warnings[0]!.location, { offset: 92, line: 3, column: 49 })
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

// Types only: this function is never called.
export function typedInvalidation(route: RouteState, usePageRequest: PageRequest): void {
	defineRpc({
		input: anything<{ id: string }>(),
		output: anything<{ ok: boolean }>(),
		invalidates: ['orders'],
		handler: ({ input, context }) => {
			context.invalidate(`orders.${input.id}`, 'stats')
			return { ok: true }
		},
	})
	// @ts-expect-error a data key is a string
	defineRpc({ input: anything<unknown>(), output: anything<unknown>(), invalidates: [1], handler: () => ({}) })
	defineApiRoute({ response: anything<{ ok: boolean }>(), invalidates: ['orders'], handler: ({ context }) => (context.invalidate('orders.1'), { ok: true }) })
	definePage({
		load: ({ params, depends }) => {
			depends('orders', `orders.${String(params)}`)
			return {}
		},
	})
	usePageRequest.depends('orders')
	const key: DataKey = 'anything.goes'
	const done: Promise<void> = invalidate(key, 'orders')
	const refreshed: Promise<void> = route.refresh()
	void [done, refreshed]
}
