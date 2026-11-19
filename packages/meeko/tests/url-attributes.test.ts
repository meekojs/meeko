import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test, { mock } from 'node:test'
import { pathToFileURL } from 'node:url'

import { spreadEntries } from '../src/app/runtime/dynamic-tag.ts'
import { compile } from '../src/compiler.ts'
import { attributeValue, blockedUrl, renderAttribute } from '../src/core/server.ts'

interface RuntimeModule {
	renderToString(props: Record<string, unknown>): string
	hydrate(root: Element, props: Record<string, unknown>): () => void
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href)

/** Compiles a component against the source runtime, imported by file URL so both share one instance. */
async function load(source: string): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(join(parent, 'url-test-'))
	const code = compile(source, join(directory, 'Url.meeko'))
		.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
		.replaceAll(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
	await writeFile(join(directory, 'Url.ts'), code)
	const component = (await import(pathToFileURL(join(directory, 'Url.ts')).href)) as RuntimeModule
	return { component, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

async function render(template: string, props: Record<string, unknown>): Promise<string> {
	const { component, cleanup } = await load(`<script lang="ts">\nconst props = defineProps<{ v?: any; o?: any }>()\n</script>\n<template>${template}</template>\n`)
	try {
		return component.renderToString(props)
	} finally {
		await cleanup()
	}
}

const blocked = `"${blockedUrl}"`

/** Every blocked URL warns outside production; the tests read the warnings they expect. */
const warn = mock.method(console, 'warn', () => {})

test('a URL attribute never keeps a javascript:, vbscript: or data: scheme, however it is written', () => {
	const unsafe = [
		'javascript:alert(1)',
		'JaVaScRiPt:alert(1)',
		' \u0001\u001f javascript:alert(1)',
		'java\tscript:alert(1)',
		'java\nscr\ript:alert(1)',
		'\njavascript:alert(1)',
		'vbscript:msgbox(1)',
		'data:text/html,<script>alert(1)</script>',
		'DATA:text/html;base64,PHNjcmlwdD4=',
	]
	for (const name of ['href', 'xlink:href', 'src', 'action', 'formaction', 'poster', 'cite', 'background', 'data', 'ping', 'manifest', 'codebase', 'longdesc', 'HREF']) {
		for (const value of unsafe) assert.equal(attributeValue(name, value), blockedUrl, `${name}=${JSON.stringify(value)}`)
	}
	assert.equal(renderAttribute('href', 'javascript:alert(1)'), ` href=${blocked}`)
	// A value from a template expression is never decoded as HTML: an entity stays text, and the escape keeps it so.
	assert.equal(renderAttribute('href', '&#106;avascript:alert(1)'), ' href="&amp;#106;avascript:alert(1)"')
	// Other attributes keep the text: it is not a URL there.
	assert.equal(attributeValue('title', 'javascript:alert(1)'), 'javascript:alert(1)')
	assert.equal(attributeValue('alt', 'data:text/html,x'), 'data:text/html,x')
})

test('legitimate URLs stay as written', () => {
	const kept: Array<[string, string]> = [
		['href', 'mailto:ana@example.com'],
		['href', 'tel:+34600000000'],
		['href', 'https://example.com/a?b=1#c'],
		['href', '/docs/guide'],
		['href', '../guide'],
		['href', 'guide'],
		['href', '#top'],
		['href', '?page=2'],
		['href', '//cdn.example.com/x'],
		['href', 'javascript'],
		['href', '/search?q=javascript:alert(1)'],
		['href', './javascript:alert(1)'],
		['src', 'blob:https://example.com/0c1d8f2e'],
		['src', 'data:image/png;base64,iVBORw0KGgo='],
		['src', ' DATA:IMAGE/SVG+XML,<svg/>'],
		['poster', 'data:image/webp;base64,UklGR'],
		['action', '/login'],
		['xlink:href', '#icon-star'],
	]
	for (const [name, value] of kept) assert.equal(attributeValue(name, value), value, `${name}=${JSON.stringify(value)}`)
	// `data:image/*` loads an image in `src` and `poster`; a link to it is still blocked.
	assert.equal(attributeValue('href', 'data:image/png;base64,iVBORw0KGgo='), blockedUrl)
	assert.equal(attributeValue('data', 'data:image/svg+xml,<svg onload=alert(1)>'), blockedUrl)
	assert.equal(attributeValue('href', null), null)
	assert.equal(attributeValue('href', false), null)
})

test('a meta refresh never redirects to a script URL', () => {
	for (const value of ['0;url=javascript:alert(1)', '0; URL = "javascript:alert(1)"', "5,url='vbscript:x'", '0 javascript:alert(1)', '1.5;data:text/html,x', ' 0;\turl=java\tscript:alert(1)']) {
		assert.equal(attributeValue('content', value), blockedUrl, value)
	}
	for (const value of ['0;url=https://example.com/', '5', 'width=device-width, initial-scale=1', 'Meeko: javascript: frameworks', 'text/html; charset=utf-8']) {
		assert.equal(attributeValue('content', value), value, value)
	}
})

test('SSR blocks script URLs in bound attributes, in HTML and in SVG', async () => {
	const href = { v: 'javascript:alert(1)' }
	assert.equal(await render('<a bind:href="props.v">x</a>', href), `<a href=${blocked} data-meeko="0">x</a>`)
	assert.equal(await render('<svg><a bind:href="props.v"><text>x</text></a></svg>', href), `<svg><a href=${blocked} data-meeko="0"><text>x</text></a></svg>`)
	assert.equal(await render('<svg><a bind:xlink:href="props.v"><text>x</text></a></svg>', href), `<svg><a xlink:href=${blocked} data-meeko="0"><text>x</text></a></svg>`)
	assert.equal(await render('<form bind:action="props.v"><button bind:formaction="props.v">x</button></form>', href), `<form action=${blocked} data-meeko="0"><button formaction=${blocked} data-meeko="1">x</button></form>`)
	assert.equal(await render('<iframe bind:src="props.v"></iframe>', { v: 'data:text/html,<script>alert(1)</script>' }), `<iframe src=${blocked} data-meeko="0"></iframe>`)
	assert.equal(await render('<meta http-equiv="refresh" bind:content="props.v">', { v: '0;url=javascript:alert(1)' }), `<meta http-equiv="refresh" content=${blocked} data-meeko="0">`)
	assert.equal(await render('<img bind:src="props.v">', { v: 'data:image/png;base64,AAAA' }), '<img src="data:image/png;base64,AAAA" data-meeko="0">')
	assert.equal(await render('<a bind:href="props.v">x</a>', { v: 'mailto:ana@example.com' }), '<a href="mailto:ana@example.com" data-meeko="0">x</a>')
	// The spread's URL keys, in any case.
	assert.equal(await render('<svg><a bind="props.o"><text>x</text></a></svg>', { o: { 'xlink:href': 'javascript:alert(1)' } }), `<svg><a xlink:href=${blocked} data-meeko="0"><text>x</text></a></svg>`)
	assert.equal(await render('<a bind="props.o">x</a>', { o: { HREF: ' javascript:alert(1)' } }), `<a HREF=${blocked} data-meeko="0">x</a>`)
	// <component is> writes its attributes the same way.
	assert.equal(await render(`<component is="'a'" bind:href="props.v">x</component>`, href), `<a href=${blocked} data-meeko="0">x</a>`)
})

test('bind="obj" rejects srcdoc and http-equiv, like the on* keys, and checks the URL of formaction', async () => {
	for (const key of ['srcdoc', 'SrcDoc', 'http-equiv', 'HTTP-EQUIV']) {
		assert.throws(
			() => spreadEntries('div', { [key]: 'x' } as never, []),
			(error: unknown) => error instanceof TypeError && error.message.startsWith('MEEK113') && error.message.includes(JSON.stringify(key)),
			key,
		)
	}
	await assert.rejects(render('<iframe bind="props.o"></iframe>', { o: { srcdoc: '<script>alert(1)</script>' } }), /MEEK113.*"srcdoc"/)
	await assert.rejects(render('<component is="props.v" bind="props.o">x</component>', { v: 'div', o: { srcdoc: '<p>x</p>' } }), /MEEK113.*"srcdoc"/)
	// A wrapper of <button> forwards formaction: a URL, checked like action.
	assert.match(await render('<component is="props.v" bind="props.o">x</component>', { v: 'button', o: { formaction: '/save' } }), /<button formaction="\/save" data-meeko="0">/)
	assert.equal(await render('<button bind="props.o">x</button>', { o: { formAction: 'javascript:alert(1)' } }), `<button formAction=${blocked} data-meeko="0">x</button>`)
	await assert.rejects(render('<meta bind="props.o">', { o: { 'http-equiv': 'refresh', content: '0;url=/x' } }), /MEEK113.*"http-equiv"/)
	// The rest of the object still works.
	assert.equal(await render('<a bind="props.o">x</a>', { o: { href: '/ok', title: 'Ok' } }), '<a href="/ok" title="Ok" data-meeko="0">x</a>')
})

const reactive = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ v: string }>()
const url = signal(props.v)
const attrs = signal<Record<string, string>>({ href: props.v })
function unsafe() {
	url.value = " JAVA\\tSCRIPT:alert(2)"
	attrs.value = { href: "vbscript:x" }
}
function safe() {
	url.value = "/ok"
	attrs.value = { href: "mailto:ana@example.com" }
}
</script>
<template><a class="bound" bind:href="url.value">a</a><a class="spread" bind="attrs.value">s</a><button class="unsafe" on:click="unsafe">x</button><button class="safe" on:click="safe">ok</button></template>
`

test('hydration matches the SSR of a blocked URL, and updates block it too', async () => {
	const { component, cleanup } = await load(reactive)
	const window = new Window()
	try {
		const root = window.document.createElement('main')
		root.innerHTML = component.renderToString({ v: 'javascript:alert(1)' })
		const bound = root.querySelector('a.bound')!
		const spread = root.querySelector('a.spread')!
		assert.equal(bound.getAttribute('href'), blockedUrl)
		assert.equal(spread.getAttribute('href'), blockedUrl)
		// The same value in the browser: no hydration mismatch.
		const release = component.hydrate(root as unknown as Element, { v: 'javascript:alert(1)' })
		assert.equal(bound.getAttribute('href'), blockedUrl)
		;(root.querySelector('button.safe') as unknown as HTMLButtonElement).click()
		assert.equal(bound.getAttribute('href'), '/ok')
		assert.equal(spread.getAttribute('href'), 'mailto:ana@example.com')
		;(root.querySelector('button.unsafe') as unknown as HTMLButtonElement).click()
		assert.equal(bound.getAttribute('href'), blockedUrl)
		assert.equal(spread.getAttribute('href'), blockedUrl)
		release()
	} finally {
		await window.happyDOM.close()
		await cleanup()
	}
})

test('a blocked URL warns once per attribute and scheme, without its value', () => {
	const before = warn.mock.callCount()
	attributeValue('icon', 'javascript:secret-value')
	attributeValue('ICON', ' javascript:other')
	assert.equal(warn.mock.callCount(), before + 1)
	const message = String(warn.mock.calls.at(-1)!.arguments[0])
	assert.match(message, /icon/)
	assert.match(message, /javascript:/)
	assert.ok(!message.includes('secret-value'), message)
})

test('the values of an SVG animation never carry a script URL', async () => {
	// With attributeName="href", `to`, `from`, `by` and each item of `values` are the URL of the link.
	for (const name of ['to', 'from', 'by', 'values', 'TO']) {
		for (const value of ['javascript:alert(1)', ' JAVA\tSCRIPT:alert(1)', 'vbscript:x', 'data:text/html,<script>alert(1)</script>']) {
			assert.equal(attributeValue(name, value), blockedUrl, `${name}=${JSON.stringify(value)}`)
		}
	}
	assert.equal(attributeValue('values', '#a; javascript:alert(1); #b'), blockedUrl)
	assert.equal(attributeValue('values', '#a;\njavascript:alert(1)'), blockedUrl)
	// Numbers, colours, paths, fragments and images stay.
	for (const [name, value] of [
		['to', '#other'],
		['to', '/next'],
		['from', '10'],
		['by', '0 0 10 10'],
		['values', '0;1;0'],
		['values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0'],
		['values', 'red; blue'],
		['values', '#a;#b'],
		['to', 'data:image/png;base64,AAAA'],
	] as const) {
		assert.equal(attributeValue(name, value), value, `${name}=${JSON.stringify(value)}`)
	}
	const v = { v: 'javascript:alert(1)' }
	assert.equal(await render('<svg><a href="#x"><animate attributeName="href" bind:to="props.v" /><text>x</text></a></svg>', v), `<svg><a href="#x"><animate attributeName="href" to=${blocked} data-meeko="0"></animate><text>x</text></a></svg>`)
	assert.equal(await render('<svg><a href="#x"><set attributeName="href" bind:to="props.v" /><text>x</text></a></svg>', v), `<svg><a href="#x"><set attributeName="href" to=${blocked} data-meeko="0"></set><text>x</text></a></svg>`)
	assert.equal(await render('<svg><a href="#x"><animate attributeName="href" bind:values="props.v" /><text>x</text></a></svg>', { v: '#x;javascript:alert(1)' }), `<svg><a href="#x"><animate attributeName="href" values=${blocked} data-meeko="0"></animate><text>x</text></a></svg>`)
	assert.equal(await render('<svg><a href="#x"><animate bind="props.o" /><text>x</text></a></svg>', { o: { attributeName: 'href', from: 'javascript:alert(1)' } }), `<svg><a href="#x"><animate attributeName="href" from=${blocked} data-meeko="0"></animate><text>x</text></a></svg>`)
	assert.equal(await render('<svg><rect><animate attributeName="width" bind:values="props.v" /></rect></svg>', { v: '0;10;0' }), '<svg><rect><animate attributeName="width" values="0;10;0" data-meeko="0"></animate></rect></svg>')
})
