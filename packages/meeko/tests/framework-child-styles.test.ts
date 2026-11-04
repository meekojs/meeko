import assert from 'node:assert/strict'
import test from 'node:test'

import type { ClientComponent } from '../src/app/runtime/client.ts'
import type { Component } from '../src/app/runtime/renderer.ts'

import { renderComponent } from '../src/app/runtime/renderer.ts'
import { createRouteManifest } from '../src/app/runtime/router.ts'
import { registerStyleModule, styleModuleId } from '../src/app/runtime/style-modules.ts'
import { createFrameworkHandler } from '../src/server/runtime/framework-render.ts'

/** A compiled child component: its CSS is only reachable through the parent that renders it. */
const child = (name: string, css: string): Component<Record<string, never>> & { css: string } => ({
	css,
	renderWithState: () => ({ html: `<p class="${name}">${name}</p>`, state: {} }),
	renderToString: () => `<p class="${name}">${name}</p>`,
	hydrateScope: () => () => {},
})

const badge = child('badge', '.badge[data-meeko-s-1] { color: red; }')
const nested = child('nested', '.nested[data-meeko-s-2] { color: blue; }')
const card: Component<Record<string, never>> & { css: string } = {
	css: '.card[data-meeko-s-3] { padding: 1rem; }',
	renderWithState: () => ({ html: `<section class="card">${renderComponent(0, nested, {}, true)}</section>`, state: {} }),
	renderToString: () => `<section class="card">${renderComponent(0, nested, {}, false)}</section>`,
	hydrateScope: () => () => {},
}

const page: ClientComponent & { css: string } = {
	css: '.page[data-meeko-s-4] { margin: 0; }',
	renderWithState: () => ({ html: `<main class="page">${renderComponent(0, badge, {}, true)}${renderComponent(1, card, {}, true)}${renderComponent(2, badge, {}, true)}</main>`, state: {} }),
	renderToString: () => '<main></main>',
	hydrateScope: () => () => {},
}

test('the SSR document links the CSS of every child component it renders, once', async () => {
	const handler = createFrameworkHandler({
		routes: createRouteManifest([{ id: '/', file: 'page.meeko', layouts: [] }]),
		loadPage: async () => page,
	})
	const html = await (await handler(new Request('https://example.test/', { headers: { accept: 'text/html' } }))).text()
	const head = html.slice(0, html.indexOf('</head>'))
	for (const css of [page.css, badge.css, card.css, nested.css]) {
		assert.equal(head.split(css).length - 1, 1, `${css} is in <head> once`)
	}
	assert.ok(head.indexOf(page.css) < head.indexOf(badge.css), "the page's own CSS comes first")
})

test('the SSR <style> keeps range media queries and escapes only the sequence that would close it', async () => {
	const css = [
		'@media (width < 40rem) { .narrow[data-meeko-s-5] { display: none; } }',
		'/* a comment with </STYLE> */',
		".quote[data-meeko-s-5]::after { content: '</style><b>x</b>'; }",
		".pair[data-meeko-s-5]::before { content: '< </s'; }",
	].join('\n')
	const ranged: ClientComponent & { css: string } = {
		css,
		renderWithState: () => ({ html: `<main class="narrow">x</main>`, state: {} }),
		renderToString: () => '<main></main>',
		hydrateScope: () => () => {},
	}
	const handler = createFrameworkHandler({
		routes: createRouteManifest([{ id: '/', file: 'page.meeko', layouts: [] }]),
		loadPage: async () => ranged,
	})
	const html = await (await handler(new Request('https://example.test/', { headers: { accept: 'text/html' } }))).text()
	const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]!).find((text) => text.includes('.narrow'))
	assert.ok(style, html)
	// The range condition reaches the browser as written: `\3C` would be an identifier, not `<`.
	assert.match(style, /@media \(width < 40rem\)/)
	assert.doesNotMatch(style, /\\3C/i)
	// `</style`, in any case, becomes `<\/style`: `\/` is `/` inside a CSS string, and a comment keeps it as text.
	assert.match(style, /a comment with <\\\/STYLE>/)
	assert.match(style, /content: '<\\\/style><b>x<\/b>'/)
	assert.match(style, /content: '< <\/s'/)
	assert.doesNotMatch(style, /<\/style/i)
	assert.equal(style, css.replace(/<\/(style)/gi, '<\\/$1'))
})

test("the components' <style> tags follow the document head, where the client bundle adds their CSS", async () => {
	const handler = createFrameworkHandler({
		routes: createRouteManifest([{ id: '/', file: 'page.meeko', layouts: [] }]),
		loadPage: async () => page,
		document: { head: '<link rel="stylesheet" href="/global.css">' },
	})
	const html = await (await handler(new Request('https://example.test/', { headers: { accept: 'text/html' } }))).text()
	const head = html.slice(0, html.indexOf('</head>'))
	const global = head.indexOf('<link rel="stylesheet" href="/global.css">')
	assert.ok(global > 0, head)
	// Equal specificity resolves by order: the scoped rules must not lose to the global sheet before hydration only.
	assert.ok(head.indexOf('<style') > global, head)
	assert.ok(head.endsWith('</style>'), head)
	// Without a registered Vite module (production), the tags carry no development id.
	assert.doesNotMatch(head, /data-vite-dev-id/)
})

test("in development each <style> names its Vite module, so Vite's client adopts it instead of adding a copy", async () => {
	const styled: ClientComponent & { css: string } = {
		css: '.dev[data-meeko-s-6] { color: red; }',
		renderWithState: () => ({ html: `<main class="dev">x</main>`, state: {} }),
		renderToString: () => '<main></main>',
		hydrateScope: () => () => {},
	}
	registerStyleModule(styled.css, 'C:/app/pages/old.meeko?meeko-style=1&lang.css')
	registerStyleModule(styled.css, 'C:/app/pages/dev.meeko?meeko-style=2&lang.css')
	// A new version of the same component replaces its entry.
	registerStyleModule('.dev[data-meeko-s-6] { color: blue; }', 'C:/app/pages/old.meeko?meeko-style=3&lang.css')
	assert.equal(styleModuleId(styled.css), 'C:/app/pages/dev.meeko?meeko-style=2&lang.css')
	assert.equal(styleModuleId('.dev[data-meeko-s-6] { color: blue; }'), 'C:/app/pages/old.meeko?meeko-style=3&lang.css')
	registerStyleModule('.dev[data-meeko-s-6] { color: green; }', 'C:/app/pages/old.meeko?meeko-style=4&lang.css')
	assert.equal(styleModuleId('.dev[data-meeko-s-6] { color: blue; }'), undefined, 'the previous version is forgotten')
	const handler = createFrameworkHandler({
		routes: createRouteManifest([{ id: '/', file: 'page.meeko', layouts: [] }]),
		loadPage: async () => styled,
	})
	const html = await (await handler(new Request('https://example.test/', { headers: { accept: 'text/html' } }))).text()
	assert.match(html, /<style data-vite-dev-id="C:\/app\/pages\/dev\.meeko\?meeko-style=2&amp;lang\.css"[^>]*>\.dev\[data-meeko-s-6\] \{ color: red; \}<\/style>/)
})

test('the error page of a failed render inlines the CSS of its <style> and of its children', async () => {
	const errorPage: ClientComponent & { css: string } = {
		css: '.failure[data-meeko-s-7] { color: crimson; }',
		renderWithState: () => ({ html: `<main class="failure">${renderComponent(0, badge, {}, true)}</main>`, state: {} }),
		renderToString: () => `<main class="failure">${renderComponent(0, badge, {}, false)}</main>`,
		hydrateScope: () => () => {},
	}
	const failing: ClientComponent = {
		renderWithState: () => {
			throw new Error('render failed')
		},
		renderToString: () => {
			throw new Error('render failed')
		},
		hydrateScope: () => () => {},
	}
	const handler = createFrameworkHandler({
		routes: createRouteManifest([{ id: '/', file: 'page.meeko', layouts: [], error: 'error.meeko' }]),
		loadPage: async (file) => (file === 'error.meeko' ? errorPage : failing),
		onError: () => {},
	})
	const response = await handler(new Request('https://example.test/', { headers: { accept: 'text/html' } }))
	const html = await response.text()
	assert.equal(response.status, 500, html)
	const head = html.slice(0, html.indexOf('</head>'))
	assert.ok(head.includes(errorPage.css), head)
	assert.ok(head.includes(badge.css), head)
})
