import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { checkSource } from '../src/check.ts'
import { compile } from '../src/compiler.ts'
import { MeekoCompileError } from '../src/compiler/parser/sfc.ts'
import { componentDiagnostics } from '../src/language-server/diagnostics.ts'
import { languageProject } from './language-server-workspace.ts'

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href)

/** A component whose template is `template`, with a `v` prop. */
const component = (template: string): string => `<script lang="ts">\nconst props = defineProps<{ v?: string }>()\n</script>\n<template>${template}</template>\n`

interface RuntimeModule {
	renderToString(props: Record<string, unknown>): string
	hydrate(root: Element, props: Record<string, unknown>): () => void
}

/** A component compiled against the source runtime, imported by file URL so both share one instance. */
async function load(source: string): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(join(parent, 'raw-text-'))
	const code = compile(source, join(directory, 'Raw.meeko'))
		.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
		.replaceAll(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
	await writeFile(join(directory, 'Raw.ts'), code)
	const component = (await import(pathToFileURL(join(directory, 'Raw.ts')).href)) as RuntimeModule
	return { component, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

/** SSR of a component compiled against the source runtime. */
async function render(source: string, props: Record<string, unknown>): Promise<string> {
	const { component, cleanup } = await load(source)
	try {
		return component.renderToString(props)
	} finally {
		await cleanup()
	}
}

function assertRawTextError(source: string, offset: number, tag: string): void {
	assert.throws(
		() => compile(source, 'Raw.meeko'),
		(error: unknown) => {
			assert.ok(error instanceof MeekoCompileError, String(error))
			assert.equal(error.diagnostic.code, 'MEEK140', error.message)
			assert.equal(error.diagnostic.location.offset, offset, error.message)
			assert.match(error.diagnostic.message, new RegExp(`<${tag}>`))
			return true
		},
	)
}

test('an interpolation inside a template <script> or <style> is MEEK140', () => {
	// A visitor's `1\nglobalThis.x = 1` would run: the text marker is a line comment for the script.
	const unquoted = component('<script>window.cfg = {props.v}</script>')
	assertRawTextError(unquoted, unquoted.indexOf('{props.v}'), 'script')
	// Between backticks, `${…}` of the value would run.
	const literal = component('<script>window.cfg = `{props.v}`</script>')
	assertRawTextError(literal, literal.indexOf('{props.v}'), 'script')
	const typed = component('<script type="module">const a = 1; console.log({props.v})</script>')
	assertRawTextError(typed, typed.indexOf('{props.v}'), 'script')
	const style = component('<style>.a { color: red }</style>')
	assertRawTextError(style, style.indexOf('{ color'), 'style')
	const svg = component('<svg><script>go({props.v})</script></svg>')
	assertRawTextError(svg, svg.indexOf('{props.v}'), 'script')
	const svgStyle = component('<svg><style>text {props.v}</style></svg>')
	assertRawTextError(svgStyle, svgStyle.indexOf('{props.v}'), 'style')
	// Also behind a condition, where the element is rendered in a region.
	const conditional = component('<div><script if:when="props.v">go({props.v})</script></div>')
	assertRawTextError(conditional, conditional.indexOf('{props.v}'), 'script')
	// The message says what to use instead.
	assert.throws(
		() => compile(unquoted, 'Raw.meeko'),
		(error: unknown) => error instanceof MeekoCompileError && /useHead/.test(error.diagnostic.message) && /data-\*/.test(error.diagnostic.message),
	)
	assert.throws(
		() => compile(style, 'Raw.meeko'),
		(error: unknown) => error instanceof MeekoCompileError && /<style> del componente/.test(error.diagnostic.message) && /bind:style/.test(error.diagnostic.message),
	)
})

test('a template <script> or <style> without interpolations still compiles', async () => {
	assert.equal(await render(component('<script src="/app.js"></script><style></style>'), {}), '<script src="/app.js"></script><style></style>')
	assert.equal(await render(component('<script>go()</script>'), {}), '<script>go()</script>')
})

test('textarea, title and noscript keep escaping their interpolations', async () => {
	const html = await render(component('<textarea>{props.v}</textarea><title>{props.v}</title><noscript>{props.v}</noscript>'), { v: '</textarea></title></noscript><img src=x onerror=alert(1)>' })
	assert.ok(!html.includes('<img'), html)
	assert.match(html, /<textarea data-meeko="0">&lt;\/textarea&gt;&lt;\/title&gt;&lt;\/noscript&gt;&lt;img src=x onerror=alert\(1\)&gt;<\/textarea>/)
	assert.equal(html.split('&lt;img').length, 4, html)
})

test('textarea and title hold their text without hydration markers, which they would show', async () => {
	// The browser reads their content as text: a comment marker would be part of the value and the title.
	const html = await render(component('<textarea>a &amp; {props.v} "b"</textarea><title>{props.v} · Meeko</title>'), { v: 'x < y' })
	assert.equal(html, '<textarea data-meeko="0">a &amp; x &lt; y &quot;b&quot;</textarea><title data-meeko="1">x &lt; y · Meeko</title>')
	assert.ok(!html.includes('meeko:text'), html)
	// The parser drops a line break right after <textarea>: SSR repeats it, as model does.
	assert.equal(await render(component('<textarea>{props.v}</textarea>'), { v: '\nline' }), '<textarea data-meeko="0">\n\nline</textarea>')
	// Without {…} nothing changes, and <title> of SVG is markup with its markers.
	assert.equal(await render(component('<textarea>a &amp; b</textarea><title>Meeko</title>'), {}), '<textarea>a &amp; b</textarea><title>Meeko</title>')
	assert.equal(await render(component('<svg><title>{props.v}</title></svg>'), { v: 'x' }), '<svg><title><!--meeko:text:0-->x<!--/meeko:text:0--></title></svg>')
})

const textElements = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ v: string }>()
const name = signal(props.v)
</script>
<template><main><textarea class="t">Hola, {name.value}.</textarea><title>{name.value} · Meeko</title><noscript>{name.value}</noscript><p>{name.value}</p><button on:click="() => name.value = 'Luz & <b>'">x</button><ul><li each:of="[1, 2]" each:as="n"><textarea>{n}:{name.value}</textarea></li></ul></main></template>`

test('textarea and title with {…} hydrate, update and release their text; noscript does not bind', async () => {
	const { component: Text, cleanup } = await load(textElements)
	const window = new Window()
	try {
		const root = window.document.createElement('div')
		root.innerHTML = Text.renderToString({ v: 'Ana' })
		const textarea = root.querySelector('textarea.t') as unknown as HTMLTextAreaElement
		assert.equal(textarea.value, 'Hola, Ana.')
		assert.equal(root.querySelector('title')!.textContent, 'Ana · Meeko')
		const release = Text.hydrate(root as unknown as Element, { v: 'Ana' })
		;(root.querySelector('button') as unknown as HTMLButtonElement).click()
		assert.equal(textarea.value, 'Hola, Luz & <b>.')
		assert.equal(root.querySelector('title')!.textContent, 'Luz & <b> · Meeko')
		assert.deepEqual(
			[...root.querySelectorAll('li textarea')].map((item) => item.textContent),
			['1:Luz & <b>', '2:Luz & <b>'],
		)
		assert.equal(root.querySelector('p')!.textContent, 'Luz & <b>')
		release()
		;(root.querySelector('button') as unknown as HTMLButtonElement).click()
		assert.equal(textarea.value, 'Hola, Luz & <b>.')
		// A different text in the browser is a hydration mismatch, as with any text.
		root.innerHTML = Text.renderToString({ v: 'Ana' })
		assert.throws(() => Text.hydrate(root as unknown as Element, { v: 'Eva' }), /Hydration mismatch in Raw\.meeko:\d+:\d+ \(text/)
	} finally {
		await window.happyDOM.close()
		await cleanup()
	}
})

test('script, style and other raw text elements write their static content verbatim', async () => {
	// Raw text has no character references: escaping `"` or `&` changed the script.
	assert.equal(await render(component('<script>if (a && b) go("x", \'y\') </script>'), {}), '<script>if (a && b) go("x", \'y\') </script>')
	assert.equal(await render(component('<script type="module">import "./a.js"</script>'), {}), '<script type="module">import "./a.js"</script>')
	assert.equal(await render(component('<style>a > b::after { }</style>'.replace('{ }', '')), {}), '<style>a > b::after </style>')
	assert.equal(await render(component('<xmp><b>&amp;</b></xmp><iframe><p>x</p></iframe>'), {}), '<xmp><b>&amp;</b></xmp><iframe><p>x</p></iframe>')
	// <noscript> is HTML without JavaScript: its markup is written as is, and each {…} escaped, without markers.
	assert.equal(await render(component('<noscript><img src="/pixel.gif" alt="">{props.v}</noscript>'), { v: '<b>' }), '<noscript><img src="/pixel.gif" alt="">&lt;b&gt;</noscript>')
	// In <svg>, <script> and <style> are markup: entities decode and are escaped again, the same text.
	assert.equal(await render(component('<svg><script>if (a &amp;&amp; b) go("x")</script></svg>'), {}), '<svg><script>if (a &amp;&amp; b) go(&quot;x&quot;)</script></svg>')
})

test('xmp, iframe, noembed and noframes reject {…} with MEEK140', () => {
	// The browser shows their content as text, with markers and entities, or ignores it.
	for (const tag of ['xmp', 'iframe', 'noembed', 'noframes']) {
		const source = component(`<${tag}>{props.v}</${tag}>`)
		assertRawTextError(source, source.indexOf('{props.v}'), tag)
	}
})

test('meeko check and the editor report MEEK140', { timeout: 90_000 }, async () => {
	const source = component('<p>x</p><script>window.cfg = {props.v}</script>')
	await mkdir(resolve('.meeko'), { recursive: true })
	const root = await mkdtemp(resolve('.meeko', 'raw-text-check-'))
	try {
		const diagnostics = await checkSource(source, join(root, 'Raw.meeko'))
		assert.deepEqual(
			diagnostics.map(({ code, location }) => [code, location.offset]),
			[['MEEK140', source.indexOf('{props.v}')]],
		)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
	const workspace = await languageProject('lsp-raw-text-', { 'Raw.meeko': source })
	try {
		const opened = await workspace.open('Raw.meeko')
		const diagnostics = await componentDiagnostics(workspace.project, opened.document, workspace.file('Raw.meeko'), () => undefined)
		const raw = diagnostics.filter((item) => item.code === 'MEEK140')
		assert.equal(raw.length, 1, JSON.stringify(diagnostics))
		assert.equal(opened.document.offsetAt(raw[0]!.range.start), source.indexOf('{props.v}'))
	} finally {
		await workspace.dispose()
	}
})
