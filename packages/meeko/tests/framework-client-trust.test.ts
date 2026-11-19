import { Window as HappyWindow } from 'happy-dom'
import assert from 'node:assert/strict'
import test from 'node:test'

import type { ClientComponent } from '../src/app/runtime/client.ts'
import type { ErrorPageRecord } from '../src/app/runtime/router.ts'

import { defineRouteMiddleware } from '../src/app/definitions/define-route-middleware.ts'
import { readHydrationDocument } from '../src/app/runtime/client-payload.ts'
import { mountClientApp } from '../src/app/runtime/client.ts'
import { createRouteManifest } from '../src/app/runtime/router.ts'
import { escapeHtml } from '../src/core/server.ts'
import { clientEntrySource } from '../src/framework/project-templates.ts'
import { createFrameworkHandler } from '../src/server/runtime/framework-render.ts'

// The client trusts only what the server wrote around the page: the payload and the root of the
// document, the head that SSR wrote, and HTTP(S) redirect targets. Page content (user HTML, already
// sanitized, keeps its `id`s) and data (a `?next=` of the URL) cannot stand in for them.

/** A page that shows user HTML, as with `html="trustHtml(DOMPurify.sanitize(input))"`. */
function userPage(content: () => string): ClientComponent {
	return {
		renderWithState: () => ({ html: `<article>${content()}</article>`, state: {} }),
		renderToString: () => `<article>${content()}</article>`,
		hydrateScope: () => () => {},
	}
}

const plain: ClientComponent = {
	renderWithState: () => ({ html: '<p>Plain</p>', state: {} }),
	renderToString: () => '<p>Plain</p>',
	hydrateScope: () => () => {},
}

const routes = createRouteManifest([
	{ id: '/post', file: 'post.meeko', layouts: [] },
	{ id: '/scripted', file: 'plain.meeko', layouts: [], sidecar: 'scripted.route.ts' },
	{ id: '/plain', file: 'plain.meeko', layouts: [] },
	{ id: '/login', file: 'plain.meeko', layouts: [] },
	{ id: '/guarded', file: 'plain.meeko', layouts: [], sidecar: 'guarded.route.ts' },
])
const errorPage: ErrorPageRecord = { file: 'error.meeko', layouts: [] }

function setup(comment: () => string) {
	const page = userPage(comment)
	const modules: Record<string, ClientComponent> = { 'post.meeko': page, 'plain.meeko': plain, 'error.meeko': plain }
	const sidecars: Record<string, unknown> = {
		'scripted.route.ts': { head: () => ({ script: [{ children: 'window.__routeScript = (window.__routeScript ?? 0) + 1' }] }) },
		'guarded.route.ts': {},
	}
	const server = createFrameworkHandler({
		routes,
		errorPage,
		loadPage: async (file) => modules[file]!,
		loadRoute: async (file) => sidecars[file] as never,
		document: { nonce: () => 'n0nce' },
		clientEntry: '/entry.js',
	})
	const ssr = async (url: string) => (await server(new Request(url, { headers: { accept: 'text/html' } }))).text()
	return { modules, server, ssr }
}

/** The public payload of a page, with an inline head script that the server never wrote. */
function forgedPayload(html: string): string {
	const real = /<script id="meeko-payload" type="application\/json">([^<]*)<\/script>/.exec(html)![1]!
	const forged = JSON.parse(real) as Record<string, unknown>
	forged.head = { ...(forged.head as object | undefined), script: [{ children: 'window.__pwned = document.domain' }] }
	return JSON.stringify(forged)
}

test('the hydration document is the root and payload that the server wrote, not page content with their ids', async () => {
	let comment = '<p>hello</p>'
	const { modules, server, ssr } = setup(() => comment)
	const url = 'https://victim.test/post'
	// A visitor posts a comment whose sanitized HTML carries a forged payload under the payload's id.
	const forged = forgedPayload(await ssr(url))
	comment = `<div id="app"></div><p id="meeko-payload">${escapeHtml(forged)}</p><script id="meeko-payload" type="application/json">${escapeHtml(forged)}</script>`
	const html = await ssr(url)
	const browser = new HappyWindow({ url })
	browser.document.write(html)
	const document = browser.document as unknown as Document
	// What document.getElementById finds first is the page's element.
	assert.equal(document.getElementById('meeko-payload')?.tagName, 'P')
	const { root, payload } = readHydrationDocument(document)
	assert.equal(root.parentElement, document.body)
	assert.notEqual(payload, forged)
	assert.equal(JSON.parse(payload).route, '/post')
	assert.equal(JSON.parse(payload).head?.script, undefined)
	const app = await mountClientApp({
		routes,
		errorPage,
		root,
		payload,
		loadPage: async (file) => modules[file]!,
		serverData: true,
		fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
		onNavigationError: () => {},
		browser: browser as unknown as Window,
	})
	assert.deepEqual(
		[...document.head.querySelectorAll('script')].map((script) => script.textContent).filter((text) => text.includes('__pwned')),
		[],
	)
	app.dispose()
	browser.happyDOM.abort()
})

test('the hydration document needs the root and a later payload as children of <body>', () => {
	const browser = new HappyWindow({ url: 'https://example.test/' })
	const document = browser.document as unknown as Document
	browser.document.write('<!doctype html><html><head></head><body><main><div id="app"></div><script id="meeko-payload" type="application/json">{}</script></main></body></html>')
	assert.throws(() => readHydrationDocument(document), /Missing Meeko SSR data/)
	browser.document.body.innerHTML = '<script id="meeko-payload" type="application/json">{}</script><div id="app"></div>'
	assert.throws(() => readHydrationDocument(document), /Missing Meeko SSR data/)
	browser.document.body.innerHTML = '<div id="app"></div><div id="app"></div><script id="meeko-payload" type="application/json">{"a":1}</script><script id="meeko-payload" type="text/plain">{"b":1}</script>'
	const found = readHydrationDocument(document)
	assert.equal(found.root, document.body.firstElementChild)
	assert.equal(found.payload, '{"a":1}')
	browser.happyDOM.abort()
})

test('the generated client entry reads the hydration document with readHydrationDocument', () => {
	assert.match(clientEntrySource, /readHydrationDocument\(document\)/)
	assert.doesNotMatch(clientEntrySource, /getElementById\("meeko-payload"\)/)
})

test('a forged hydration payload cannot add head elements that SSR did not write', async () => {
	const { modules, server, ssr } = setup(() => '<p>hello</p>')
	const url = 'https://victim.test/post'
	const html = await ssr(url)
	const browser = new HappyWindow({ url })
	browser.document.write(html)
	const document = browser.document as unknown as Document
	const forged = JSON.parse(forgedPayload(html)) as { head: Record<string, unknown> }
	forged.head.style = [{ children: 'body { background: url(https://evil.test/) }' }]
	forged.head.link = [{ rel: 'stylesheet', href: 'https://evil.test/x.css' }]
	forged.head.meta = [{ httpEquiv: 'refresh', content: '0;url=https://evil.test/' }]
	// Even when a host reads the wrong element, the payload only adopts the head the server wrote.
	const app = await mountClientApp({
		routes,
		errorPage,
		root: document.getElementById('app')!,
		payload: JSON.stringify(forged),
		loadPage: async (file) => modules[file]!,
		serverData: true,
		fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
		onNavigationError: () => {},
		browser: browser as unknown as Window,
	})
	const head = document.head.innerHTML
	assert.doesNotMatch(head, /__pwned|evil\.test/)
	// A later update of the head does not bring them back.
	await app.navigate('/plain')
	await app.navigate('/post')
	assert.doesNotMatch(document.head.innerHTML, /__pwned|evil\.test/)
	app.dispose()
	browser.happyDOM.abort()
})

test('the head that SSR wrote is adopted on hydration and a navigation still creates route scripts with the nonce', async () => {
	const { modules, server, ssr } = setup(() => '<p>hello</p>')
	const html = await ssr('https://example.test/scripted')
	const browser = new HappyWindow({ url: 'https://example.test/scripted' })
	browser.document.write(html)
	const document = browser.document as unknown as Document
	const routeScripts = () => [...document.head.querySelectorAll('script')].filter((script) => script.textContent?.includes('__routeScript'))
	const ssrScript = routeScripts()
	assert.equal(ssrScript.length, 1)
	const app = await mountClientApp({
		routes,
		errorPage,
		...readHydrationDocument(document),
		loadPage: async (file) => modules[file]!,
		serverData: true,
		fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
		onNavigationError: () => {},
		browser: browser as unknown as Window,
	})
	// Adopted, not created again.
	assert.deepEqual(routeScripts(), ssrScript)
	assert.equal(await app.navigate('/plain'), true)
	assert.equal(routeScripts().length, 0)
	assert.equal(await app.navigate('/scripted'), true)
	const created = routeScripts()
	assert.equal(created.length, 1)
	assert.notEqual(created[0], ssrScript[0])
	assert.equal(created[0]!.getAttribute('nonce'), 'n0nce')
	app.dispose()
	browser.happyDOM.abort()
})

/** Records the URLs that the application loads as documents, without leaving the page. */
function recordAssign(browser: HappyWindow): string[] {
	const assigned: string[] = []
	Object.defineProperty(browser.location, 'assign', { configurable: true, value: (href: string) => assigned.push(String(href)) })
	return assigned
}

for (const target of ['javascript:window.__pwned=1//', 'JavaScript:window.__pwned=1//', 'data:text/html,<script>window.__pwned=1</script>', 'vbscript:x']) {
	test(`a client route middleware redirect to ${target.slice(0, 11)} fails without navigating`, async () => {
		const { modules, server, ssr } = setup(() => '<p>hello</p>')
		const guard = defineRouteMiddleware(({ url, match }) => {
			// An open `?next=`, as after a login.
			const next = url.searchParams.get('next')
			if (match.route.id === '/guarded' && next) return Response.redirect(new URL(next, url).href)
		})
		const browser = new HappyWindow({ url: 'https://example.test/plain' })
		browser.document.write(await ssr('https://example.test/plain'))
		const assigned = recordAssign(browser)
		const errors: unknown[] = []
		const app = await mountClientApp({
			routes,
			errorPage,
			...readHydrationDocument(browser.document as unknown as Document),
			loadPage: async (file) => modules[file]!,
			loadMiddleware: async () => [guard],
			serverData: true,
			fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
			onNavigationError: (error) => errors.push(error),
			browser: browser as unknown as Window,
		})
		await app.navigate(`/guarded?next=${encodeURIComponent(target)}`).catch((error: unknown) => errors.push(error))
		await new Promise<void>((done) => setImmediate(done))
		assert.deepEqual(assigned, [])
		assert.equal(browser.location.pathname, '/plain')
		assert.equal((browser as unknown as { __pwned?: unknown }).__pwned, undefined)
		assert.match(String(errors[0]), /only http: and https: redirects are followed/)
		app.dispose()
		browser.happyDOM.abort()
	})
}

test('a client route middleware redirect navigates in place to a route and loads any other HTTP(S) URL', async () => {
	const { modules, server, ssr } = setup(() => '<p>hello</p>')
	const guard = defineRouteMiddleware(({ url, match }) => {
		const next = url.searchParams.get('next')
		if (match.route.id === '/guarded' && next) return Response.redirect(new URL(next, url).href)
	})
	const browser = new HappyWindow({ url: 'https://example.test/plain' })
	browser.document.write(await ssr('https://example.test/plain'))
	const assigned = recordAssign(browser)
	const errors: unknown[] = []
	const app = await mountClientApp({
		routes,
		errorPage,
		...readHydrationDocument(browser.document as unknown as Document),
		loadPage: async (file) => modules[file]!,
		loadMiddleware: async () => [guard],
		serverData: true,
		fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
		onNavigationError: (error) => errors.push(error),
		browser: browser as unknown as Window,
	})
	assert.equal(await app.navigate('/guarded?next=/login'), false)
	for (let turn = 0; turn < 5 && browser.location.pathname !== '/login'; turn++) await new Promise<void>((done) => setImmediate(done))
	assert.equal(browser.location.pathname, '/login')
	assert.equal(await app.navigate('/guarded?next=https%3A%2F%2Fother.test%2Fhome'), false)
	assert.equal(await app.navigate('/guarded?next=/files/report.pdf'), false)
	assert.deepEqual(assigned, ['https://other.test/home', 'https://example.test/files/report.pdf'])
	assert.deepEqual(errors, [])
	app.dispose()
	browser.happyDOM.abort()
})
