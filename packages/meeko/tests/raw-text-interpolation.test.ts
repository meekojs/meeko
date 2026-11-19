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

/** SSR of a component compiled against the source runtime. */
async function render(source: string, props: Record<string, unknown>): Promise<string> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(join(parent, 'raw-text-'))
	try {
		const code = compile(source, join(directory, 'Raw.meeko'))
			.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
			.replaceAll(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
		await writeFile(join(directory, 'Raw.ts'), code)
		const module = (await import(pathToFileURL(join(directory, 'Raw.ts')).href)) as { renderToString(props: Record<string, unknown>): string }
		return module.renderToString(props)
	} finally {
		await rm(directory, { recursive: true, force: true })
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
	assert.match(html, /<textarea>.*&lt;\/textarea&gt;&lt;\/title&gt;&lt;\/noscript&gt;&lt;img src=x onerror=alert\(1\)&gt;.*<\/textarea>/)
	assert.equal(html.split('&lt;img').length, 4, html)
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
