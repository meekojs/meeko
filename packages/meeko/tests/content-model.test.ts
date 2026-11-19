import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { describeHydrationError, HydrationMismatchError, reportHydrationError } from '../src/app/runtime/hydration-errors.ts'
import { checkSource } from '../src/check.ts'
import { compile } from '../src/compiler.ts'
import { clientEntrySource, staticClientEntrySource } from '../src/framework/project-templates.ts'

interface RuntimeModule {
	renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> }
	hydrate(root: Element, props: Record<string, unknown>, state?: Record<string, unknown>): () => void
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href)

/** Compiles components inside the repository; the runtime is imported by file URL, as one instance. */
async function load(components: Record<string, string>, entry: string): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(join(parent, 'content-model-test-'))
	for (const [name, source] of Object.entries(components)) {
		let code = compile(source, join(directory, `${name}.meeko`))
			.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
			.replaceAll(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
		for (const other of Object.keys(components)) code = code.replace(`from "./${other}.meeko"`, `from "./${other}.ts"`)
		await writeFile(join(directory, `${name}.ts`), code)
	}
	const component = (await import(pathToFileURL(join(directory, `${entry}.ts`)).href)) as RuntimeModule
	return { component, cleanup: () => rm(directory, { recursive: true, force: true }) }
}

async function checkProject(files: Record<string, string>, name: string): Promise<Array<[string, string | undefined, string]>> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const root = await mkdtemp(join(parent, 'content-model-check-'))
	try {
		await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
		await writeFile(join(root, 'tsconfig.json'), `${JSON.stringify({ compilerOptions: { types: ['node'], paths: { '@meekojs/meeko/internal': ['../../src/internal.ts'], '@meekojs/meeko': ['../../src/index.ts'] } } })}\n`)
		for (const [file, source] of Object.entries(files)) await writeFile(join(root, file), source)
		const source = files[`${name}.meeko`]!
		const diagnostics = await checkSource(source, join(root, `${name}.meeko`))
		return diagnostics.map((item) => [item.code, item.severity, source.slice(item.location.offset).split(/[\s/>]/, 1)[0]!])
	} finally {
		await rm(root, { recursive: true, force: true })
	}
}

const block = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const count = signal(0);
</script>
<template><div class="panel"><button on:click="() => count.value++">{count.value}</button></div></template>
`

const phrasing = `<template><span class="hint">i</span></template>
`

/** Code, severity and source text where each MEEK139 warning of a template points. */
function warningsOf(template: string): Array<[string, string | undefined, string]> {
	const source = `<template>${template}</template>`
	return (compile(source, 'Native.meeko').warnings ?? []).filter((warning) => warning.code === 'MEEK139').map((warning) => [warning.code, warning.severity, source.slice(warning.location.offset).split(/[\s/>]/, 1)[0]!])
}

test('MEEK139 warns about a block element inside an element that only admits phrasing content', () => {
	// The parser closes the <p> before the block: the markup is not the one written.
	assert.deepEqual(warningsOf('<p class="a">x<div>y</div>z</p>'), [['MEEK139', 'warning', '<div']])
	assert.deepEqual(warningsOf('<p><ul><li>a</li></ul></p>'), [['MEEK139', 'warning', '<ul']])
	assert.deepEqual(warningsOf('<p><a href="/"><div>x</div></a></p>'), [['MEEK139', 'warning', '<div']])
	// A self-closing element and <form> keep their nesting in the compiled HTML, which the browser breaks.
	assert.deepEqual(warningsOf('<p><div /></p>'), [['MEEK139', 'warning', '<div']])
	assert.deepEqual(warningsOf('<p><form></form></p>'), [['MEEK139', 'warning', '<form']])
	// Other parents that only admit phrasing content.
	assert.deepEqual(warningsOf('<span><div>x</div></span>'), [['MEEK139', 'warning', '<div']])
	assert.deepEqual(warningsOf('<h1><section>x</section></h1>'), [['MEEK139', 'warning', '<section']])
	assert.deepEqual(warningsOf('<p><button><div>x</div></button></p>'), [['MEEK139', 'warning', '<div']])
	assert.deepEqual(warningsOf('<span><template if:when="true"><div>x</div></template></span>'), [['MEEK139', 'warning', '<div']])
	const [paragraph] = compile('<template><p><div /></p></template>', 'Native.meeko').warnings ?? []
	assert.match(paragraph!.message, /<div> dentro de <p>.*Hydration mismatch/)
	const [span] = compile('<template><span><div>x</div></span></template>', 'Native.meeko').warnings ?? []
	assert.match(span!.message, /<div> dentro de <span>, que sólo admite contenido de frase/)
})

test('MEEK139 does not warn about valid content models', () => {
	for (const template of ['<p><span>ok</span> <em>x</em></p>', '<p>a</p><div>b</div>', '<p>a<p>b</p>', '<a href="/"><div>x</div></a>', '<div><form></form></div>', '<p><svg><g></g></svg></p>', '<ul><li><div>x</div></li></ul>']) {
		assert.deepEqual(warningsOf(template), [], template)
	}
})

test('meeko check reports MEEK139 for a component whose known root is a block element, also through another component', { timeout: 120_000 }, async () => {
	const files = {
		'Panel.meeko': block,
		'Hint.meeko': phrasing,
		// Its root is another component, as <UITooltip> renders a <Popover>.
		'Wrapper.meeko': `<script lang="ts">\nimport * as Panel from "./Panel.meeko";\n</script>\n<template><Panel /></template>\n`,
		'Page.meeko': `<script lang="ts">
import * as Hint from "./Hint.meeko";
import * as Panel from "./Panel.meeko";
import * as Wrapper from "./Wrapper.meeko";
</script>
<template><main>
<p>Text <Panel /> and <Hint /> and <Wrapper /></p>
<span><Panel /></span>
<div><Panel /></div>
</main></template>
`,
	}
	const diagnostics = await checkProject(files, 'Page')
	assert.deepEqual(diagnostics, [
		['MEEK139', 'warning', '<Panel'],
		['MEEK139', 'warning', '<Wrapper'],
		['MEEK139', 'warning', '<Panel'],
	])
})

test('a block component inside <p> fails to hydrate with the component, the expected and the found node', async () => {
	const { component, cleanup } = await load(
		{
			Panel: block,
			Page: `<script lang="ts">\nimport * as Panel from "./Panel.meeko";\n</script>\n<template><section><p>Before <Panel /> after</p></section></template>\n`,
		},
		'Page',
	)
	const window = new Window()
	try {
		const rendered = component.renderWithState({})
		const root = window.document.createElement('main')
		// The browser closes the <p> before the component's <div>, as happy-dom does.
		root.innerHTML = rendered.html
		assert.equal(root.querySelector('p > div'), null)
		let failure: unknown
		try {
			component.hydrate(root as unknown as Element, {}, rendered.state)
		} catch (error) {
			failure = error
		}
		assert.ok(failure instanceof HydrationMismatchError, String(failure))
		assert.equal(failure.component, 'Panel')
		assert.match(failure.location, /^Page\.meeko:\d+:\d+$/)
		assert.equal(failure.expected, '<!--/meeko:component:0--> inside <p>')
		assert.equal(failure.found, '<div> after </p>')
		assert.match(failure.message, /^Hydration mismatch in Page\.meeko:\d+:\d+ \(component Panel\): Missing end marker .*closed <p> before <div>.*MEEK139/)
		const report = describeHydrationError(failure)
		assert.match(report.message, /^\[meeko\] Hydration mismatch in <Panel> at Page\.meeko:\d+:\d+/)
		assert.match(report.message, /\n {2}expected: <!--\/meeko:component:0--> inside <p>\n {2}found: {4}<div> after <\/p>\n/)
	} finally {
		await window.happyDOM.abort()
		await cleanup()
	}
})

test('a text that differs from SSR reports the expected and the found text', async () => {
	const { component, cleanup } = await load({ Label: `<script lang="ts">\nconst props = defineProps<{ text: string }>();\n</script>\n<template><p>{props.text}</p></template>\n` }, 'Label')
	const window = new Window()
	try {
		const root = window.document.createElement('main')
		root.innerHTML = component.renderWithState({ text: 'server' }).html
		assert.throws(
			() => component.hydrate(root as unknown as Element, { text: 'client' }),
			(error: unknown) => error instanceof HydrationMismatchError && error.expected === 'text "client"' && error.found === 'text "server"' && /^Hydration mismatch in Label\.meeko:\d+:\d+ \(text \d+\)$/.test(error.message),
		)
	} finally {
		await window.happyDOM.abort()
		await cleanup()
	}
})

test("reportHydrationError logs the mismatch and shows Vite's error overlay when it is registered", async () => {
	const window = new Window()
	try {
		const document = window.document as unknown as Document
		const logged: unknown[][] = []
		const shown: Array<{ message: string; plugin?: string; id?: string }> = []
		class Overlay extends (window.HTMLElement as unknown as typeof HTMLElement) {
			constructor(error: { message: string; plugin?: string; id?: string }) {
				super()
				shown.push(error)
			}
		}
		window.customElements.define('vite-error-overlay', Overlay as unknown as typeof window.HTMLElement)
		const failure = new HydrationMismatchError('Page.meeko:4:12 (component Panel)', 'expected <div>, found <p>', { expected: '<div>', found: '<p>' })
		const host = { console: { error: (...args: unknown[]) => void logged.push(args) }, document, customElements: window.customElements as unknown as CustomElementRegistry }
		reportHydrationError(failure, host)
		reportHydrationError(failure, host)
		assert.equal(logged.length, 2)
		assert.match(String(logged[0]![0]), /^\[meeko\] Hydration mismatch in <Panel> at Page\.meeko:4:12: the page did not hydrate/)
		assert.match(String(logged[0]![0]), /expected: <div>\n {2}found: {4}<p>/)
		assert.equal(logged[0]![1], failure)
		assert.equal(shown[0]!.plugin, 'meeko')
		assert.equal(shown[0]!.id, 'Page.meeko:4:12')
		// One overlay at a time.
		assert.equal(document.body.querySelectorAll('vite-error-overlay').length, 1)
		// Without Vite's overlay, or for another error, the console still has it.
		const plain: unknown[][] = []
		reportHydrationError(new Error('Meeko route hydration mismatch'), { console: { error: (...args: unknown[]) => void plain.push(args) } })
		assert.match(String(plain[0]![0]), /^\[meeko\] The page did not hydrate.*\nMeeko route hydration mismatch$/s)
	} finally {
		await window.happyDOM.abort()
	}
})

test('the client entries report a failed hydration in development and still throw it', () => {
	for (const entry of [clientEntrySource, staticClientEntrySource]) {
		assert.match(entry, /import \{ reportHydrationError \} from "@meekojs\/meeko\/internal";/)
		assert.match(entry, /catch \(error\) \{\n.*\n {2}if \(import\.meta\.env\.DEV\) reportHydrationError\(error\);\n {2}throw error;\n\}/)
	}
})
