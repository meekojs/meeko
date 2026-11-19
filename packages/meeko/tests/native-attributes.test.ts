import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { TextDocument } from 'vscode-languageserver-textdocument'

import type { AttributeValueOf, AttributeValues, ElementAttributes, StrictAttributeValueOf } from '../src/index.ts'
import type { AttributeLiteralCheck, AttributeStrictCheck, InvalidAttributeLiterals } from '../src/shared/html-attribute-values.ts'

import { checkSource } from '../src/check.ts'
import { compile } from '../src/compiler.ts'
import { attributeData, checksAttributeValue, closedAttributeValues } from '../src/compiler/attribute-values.ts'
import { bindAttributeCompletion, tagAt } from '../src/language-server/embedded.ts'
import { attributeValueType, htmlAttributeSource } from '../src/language-server/html-data-source.ts'
import { svgElementAttributes, svgGlobalAttributes } from '../src/shared/html-data/svg.ts'

// Regressions of the native attribute catalog (HTML and SVG): the same data types the values, offers
// them in the editor, checks them in `meeko check` (MEEK122) and writes them at run time.

/** `true` when `A` and `B` are the same type. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const same = <A, B>(value: Equal<A, B>): Equal<A, B> => value

test('the catalog types popovertarget, popovertargetaction, interestfor, command and commandfor', () => {
	// popovertarget, commandfor and interestfor reference one element by its ID.
	for (const [tag, name] of [
		['button', 'popovertarget'],
		['input', 'popovertarget'],
		['button', 'commandfor'],
		['button', 'interestfor'],
		['a', 'interestfor'],
		['area', 'interestfor'],
	] as const) {
		assert.equal(attributeData(tag, name)?.kind, 'id', `${tag} ${name}`)
	}
	assert.equal(attributeData('button', 'interestfor')?.experimental, true)
	assert.equal(attributeData('div', 'popovertarget'), undefined, 'popovertarget is only on <button> and <input>')
	assert.deepEqual(closedAttributeValues('button', 'popovertargetaction'), ['toggle', 'show', 'hide'])
	assert.deepEqual(closedAttributeValues('input', 'popovertargetaction'), ['toggle', 'show', 'hide'])
	assert.deepEqual(closedAttributeValues('div', 'popover'), ['auto', 'manual', 'hint', ''])
	assert.deepEqual(attributeData('button', 'command')?.prefixes, ['--'])
	assert.ok(checksAttributeValue('button', 'popovertarget'), 'an ID is checked')
	assert.ok(checksAttributeValue('button', 'disabled'), 'a boolean attribute is checked')
	assert.ok(!checksAttributeValue('div', 'title'), 'free text is not')

	same<AttributeValues<'button', 'popovertargetaction'>, 'toggle' | 'show' | 'hide'>(true)
	same<AttributeValues<'button', 'command'>, 'toggle-popover' | 'show-popover' | 'hide-popover' | 'close' | 'request-close' | 'show-modal' | `--${string}`>(true)
	same<AttributeValues<'button', 'popovertarget'>, never>(true)
	same<AttributeValues<'button', 'interestfor'>, never>(true)
})

test('the SVG catalog keeps the case of names and values and types them', () => {
	assert.deepEqual(svgElementAttributes.linearGradient.gradientUnits.values, ['userSpaceOnUse', 'objectBoundingBox'])
	assert.equal(svgElementAttributes.circle.r.kind, 'text')
	assert.equal(svgGlobalAttributes['stroke-linecap'].freeform, true, 'a presentation attribute also takes CSS values')
	assert.deepEqual(svgElementAttributes.animate.fill.values, ['freeze', 'remove'], '<animate fill> is not the paint')
	assert.deepEqual(closedAttributeValues('svg:linearGradient', 'gradientUnits'), ['userSpaceOnUse', 'objectBoundingBox'])
	assert.equal(attributeData('svg:a', 'href')?.kind, 'url')
	assert.equal(attributeData('svg:a', 'download'), svgElementAttributes.a.download, '<a> inside <svg> reads the SVG data')

	same<AttributeValues<'linearGradient', 'gradientUnits'>, 'userSpaceOnUse' | 'objectBoundingBox'>(true)
	same<AttributeValues<'svg:a', 'target'>, never>(true)
	same<AttributeValues<'feBlend', 'mode'>, AttributeValues<'svg:feBlend', 'mode'>>(true)
})

test('every native attribute accepts null and undefined, and the semantic types stay assignable', () => {
	const html: ElementAttributes<'button'> = { popovertarget: 'menu', popovertargetaction: null, command: '--rotate', commandfor: undefined, interestfor: 'tip', disabled: true, class: ['a', null], style: { color: 'red' }, 'aria-pressed': 'mixed', 'data-kind': 1 }
	const svg: ElementAttributes<'linearGradient'> = { gradientUnits: 'userSpaceOnUse', spreadMethod: null, id: undefined, 'aria-hidden': 'true', 'data-x': 'y', 'xlink:custom': 'any' }
	const svgLink: ElementAttributes<'svg:a'> = { href: '#top', target: '_blank', download: null }
	const custom: ElementAttributes<'x-card'> = { variant: 'any', anything: null }
	// AttributeValueOf stays wide in 1.x: completion offers the values, any text is valid.
	const wide: AttributeValueOf<'button', 'popovertargetaction'> = String(html.popovertargetaction)
	const strict: Array<StrictAttributeValueOf<'button', 'popovertargetaction'>> = ['show', null, undefined]
	// @ts-expect-error Strictly, popovertargetaction admits only its values.
	const typo: StrictAttributeValueOf<'button', 'popovertargetaction'> = 'shwo'
	const toggle: StrictAttributeValueOf<'div', 'draggable'> = true
	const presence: StrictAttributeValueOf<'button', 'disabled'> = 'disabled'
	assert.ok(svg && svgLink && custom && wide !== undefined && toggle && presence)
	assert.deepEqual([...strict, typo], ['show', null, undefined, 'shwo'])
})

test('MEEK122 types each literal of a union on its own', () => {
	same<InvalidAttributeLiterals<'button', 'popovertargetaction', 'show' | 'shwo' | null>, 'shwo'>(true)
	same<InvalidAttributeLiterals<'button', 'popovertargetaction', 'show' | null>, never>(true)
	same<InvalidAttributeLiterals<'button', 'popovertargetaction', 'SHOW'>, never>(true)
	same<InvalidAttributeLiterals<'button', 'popovertargetaction', string | null>, never>(true)
	same<InvalidAttributeLiterals<'button', 'popovertarget', 'menu' | '' | 'two ids'>, '' | 'two ids'>(true)
	same<InvalidAttributeLiterals<'button', 'disabled', '' | 'disabled' | 'false'>, 'false'>(true)
	same<InvalidAttributeLiterals<'svg:linearGradient', 'gradientUnits', 'userSpaceOnUse' | 'userspaceonuse'>, 'userspaceonuse'>(true)
	same<InvalidAttributeLiterals<'button', 'command', '--spin' | 'close' | 'open'>, 'open'>(true)
	same<AttributeLiteralCheck<'button', 'popovertargetaction', 'show' | null>, unknown>(true)
	same<AttributeStrictCheck<'button', 'popovertargetaction', 'show' | null>, unknown>(true)
	same<AttributeStrictCheck<'button', 'popovertargetaction', string | null> extends unknown ? (unknown extends AttributeStrictCheck<'button', 'popovertargetaction', string | null> ? false : true) : false, true>(true)
	same<AttributeStrictCheck<'div', 'title', string | null>, unknown>(true)
})

/** Temporary project under `.meeko/` whose package imports resolve to src/, with an optional `meeko.config.ts`. */
async function typeProject(config?: string): Promise<{ root: string; cleanup: () => Promise<void> }> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const root = await mkdtemp(join(parent, 'native-attributes-'))
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
	await writeFile(join(root, 'tsconfig.json'), `${JSON.stringify({ compilerOptions: { types: ['node'], paths: { '@meekojs/meeko/internal': ['../../src/internal.ts'], '@meekojs/meeko': ['../../src/index.ts'] } } })}\n`)
	if (config) await writeFile(join(root, 'meeko.config.ts'), config)
	return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

const checkScript = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import type { ElementAttributes } from "@meekojs/meeko";
const action = signal<"show" | null>("show");
const typo = signal<"show" | "shwo" | null>("show");
const text = signal<string | null>("show");
const units = signal<"userSpaceOnUse" | null>(null);
const svgAttrs: ElementAttributes<"linearGradient"> = { gradientUnits: "objectBoundingBox" };
const buttonAttrs = { popovertargetaction: "hide" as const, popovertarget: "menu" };
</script>
`

interface CheckCase {
	readonly name: string
	readonly template: string
	/** The text that each diagnostic marks, in order; none when the template is valid. */
	readonly at?: readonly string[]
	readonly message?: RegExp
	readonly severity?: 'warning' | 'error'
}

async function runCases(root: string, cases: readonly CheckCase[]): Promise<void> {
	for (const item of cases) {
		const source = `${checkScript}<template>${item.template}</template>`
		const diagnostics = await checkSource(source, join(root, `${item.name}.meeko`))
		const messages = JSON.stringify(diagnostics)
		if (!item.at) {
			assert.deepEqual(diagnostics, [], `${item.name}: ${messages}`)
			continue
		}
		assert.equal(diagnostics.length, item.at.length, `${item.name}: ${messages}`)
		const template = source.indexOf('<template>')
		for (const at of item.at) {
			const offset = source.indexOf(at, template)
			const found = diagnostics.find((diagnostic) => diagnostic.location.offset === offset)
			assert.ok(found, `${item.name} at ${at}: ${messages}`)
			assert.equal(found.code, 'MEEK122', `${item.name}: ${messages}`)
			assert.equal(found.severity === 'warning' ? 'warning' : 'error', item.severity ?? 'warning', `${item.name}: ${messages}`)
			if (item.message) assert.match(found.message, item.message)
		}
	}
}

test('meeko check: static attributes, bindings, unions and nullable values in HTML and SVG', { timeout: 240_000 }, async () => {
	const { root, cleanup } = await typeProject()
	try {
		await runCases(root, [
			{
				name: 'Valid',
				template: [
					`<button popovertarget="menu" popovertargetaction="toggle">a</button><button bind:popovertargetaction="action.value" bind:popovertarget="text.value">a</button>`,
					`<input type="button" popovertarget="menu" popovertargetaction="hide" />`,
					`<button commandfor="dialog" command="show-modal" interestfor="tip">b</button><button commandfor="dialog" command="--spin">c</button>`,
					`<a href="/" interestfor="tip">d</a><button disabled>e</button><button disabled="disabled">f</button><button bind:disabled="null">f</button>`,
					`<div id="menu" popover="manual">g</div><div bind:popover="null">g</div><button bind="buttonAttrs">h</button>`,
					`<svg viewBox="0 0 10 10"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" spreadMethod="reflect"></linearGradient><linearGradient bind:gradientUnits="units.value"></linearGradient><linearGradient bind="svgAttrs"></linearGradient></defs>`,
					`<a href="#top" target="_blank"><circle r="4" fill="url(#g)" stroke-linecap="round" /></a><animate attributeName="r" fill="freeze" /></svg>`,
				].join(''),
			},
			{ name: 'PopoverAction', template: `<button popovertargetaction="shwo">a</button>`, at: ['"shwo"'], message: /^"shwo" no es un valor de popovertargetaction en <button>: admite toggle, show, hide\./ },
			{ name: 'UnionMember', template: `<button bind:popovertargetaction="typo.value">a</button>`, at: ['typo.value'], message: /^"shwo" no es un valor de popovertargetaction/ },
			{ name: 'UnionLiteral', template: `<button bind:popovertargetaction="action.value ? 'show' : 'hdie'">a</button>`, at: [`action.value ? 'show' : 'hdie'`], message: /^"hdie" no es un valor/ },
			{ name: 'EmptyId', template: `<button popovertarget="">a</button>`, at: ['""'], message: /no es un ID válido para popovertarget en <button>/ },
			{ name: 'Command', template: `<button command="open">a</button>`, at: ['"open"'], message: /admite .*show-modal.*--…/ },
			{ name: 'BooleanText', template: `<button disabled="false">a</button>`, at: ['"false"'], message: /^"false" no es un valor de disabled en <button>/ },
			{ name: 'SvgCase', template: `<svg><linearGradient gradientUnits="userspaceonuse"></linearGradient></svg>`, at: ['"userspaceonuse"'], message: /gradientUnits en <linearGradient>: admite userSpaceOnUse, objectBoundingBox/ },
			{ name: 'SvgSpread', template: `<svg><linearGradient bind="{ gradientUnits: 'user' }"></linearGradient></svg>` },
		])
	} finally {
		await cleanup()
	}
})

test('meeko check: the strict mode also refuses a wide type on a closed set of values', { timeout: 240_000 }, async () => {
	const { root, cleanup } = await typeProject(`export default { check: { attributeValues: "strict" } };\n`)
	try {
		await runCases(root, [
			{ name: 'StrictValid', template: `<button bind:popovertargetaction="action.value" bind:popovertarget="text.value" bind:title="text.value">a</button><svg><linearGradient bind:gradientUnits="units.value"></linearGradient></svg>` },
			{ name: 'StrictWide', template: `<button bind:popovertargetaction="text.value">a</button>`, at: ['text.value'], severity: 'error', message: /^El tipo string \| null es más amplio que los valores de popovertargetaction en <button>: admite toggle, show, hide/ },
			// An invalid literal stays the warning of the default mode.
			{ name: 'StrictLiteral', template: `<button bind:popovertargetaction="typo.value">a</button>`, at: ['typo.value'], message: /^"shwo" no es un valor/ },
		])
		// The option of checkSource wins over the configuration.
		const source = `${checkScript}<template><button bind:popovertargetaction="text.value">a</button></template>`
		assert.deepEqual(await checkSource(source, join(root, 'Warn.meeko'), { attributeValues: 'warn' }), [])
	} finally {
		await cleanup()
	}
})

test('the type check code checks SVG elements with the prefix svg:, and the run-time code does not change', () => {
	const source = `<script lang="ts">\nconst units = "userSpaceOnUse";\n</script>\n<template><svg><linearGradient gradientUnits="userSpaceOnUse" bind:spreadMethod="units"></linearGradient><a href="#x" bind="{ target: '_self' }"></a></svg><button popovertarget="m"></button></template>`
	const checked = compile(source, 'Svg.meeko', { typeCheck: true }).code
	assert.match(checked, /__meeko\.checkAttributeValue<"svg:linearGradient", "gradientUnits">\(\)\("userSpaceOnUse"\)/)
	assert.match(checked, /__meeko\.checkAttributeValue<"svg:linearGradient", "spreadMethod">\(\)\(units\)/)
	assert.match(checked, /__meeko\.spreadEntries\(\("a" as "svg:a"\)/)
	assert.match(checked, /__meeko\.checkAttributeValue<"button", "popovertarget">/)
	assert.match(compile(source, 'Svg.meeko', { typeCheck: true, strictAttributeValues: true }).code, /__meeko\.checkAttributeValueStrict<"svg:linearGradient", "spreadMethod">/)
	const runtime = compile(source, 'Svg.meeko').code
	assert.doesNotMatch(runtime, /checkAttributeValue|svg:linearGradient/)
	assert.match(runtime, /spreadEntries\("a"/)
})

test('editor: completion and types by tag, from the same catalog, in HTML and SVG', () => {
	const names = (tag: string): string[] =>
		htmlAttributeSource()
			.attributes(tag)
			.map((info) => info.name)
	assert.ok(names('button').includes('popovertarget') && names('button').includes('interestfor') && names('button').includes('commandfor'))
	assert.ok(!names('div').includes('popovertarget'), 'popovertarget only on <button> and <input>')
	assert.ok(names('linearGradient').includes('gradientUnits'), 'a name only SVG has needs no prefix')
	assert.ok(names('lineargradient').includes('gradientUnits'), 'nor its case')
	assert.ok(names('svg:a').includes('xlink:href') && !names('svg:a').includes('coords'), '<a> inside <svg> is the SVG one')
	assert.ok(!names('svg:circle').some((name) => name === name.toLowerCase() && name === 'pathlength'), 'SVG names keep their case')
	const info = (tag: string, name: string) =>
		htmlAttributeSource()
			.attributes(tag)
			.find((item) => item.name === name)!
	assert.equal(attributeValueType(info('button', 'popovertargetaction')), "'toggle' | 'show' | 'hide' | null | undefined")
	assert.equal(attributeValueType(info('button', 'popovertarget')), 'string | null | undefined')
	assert.equal(attributeValueType(info('button', 'disabled')), 'boolean | null | undefined')
	assert.equal(attributeValueType(info('div', 'draggable')), "'true' | 'false' | boolean | null | undefined")
	assert.equal(attributeValueType(info('svg:linearGradient', 'gradientUnits')), "'userSpaceOnUse' | 'objectBoundingBox' | null | undefined")
	assert.equal(attributeValueType(info('button', 'command')), "'toggle-popover' | 'show-popover' | 'hide-popover' | 'close' | 'request-close' | 'show-modal' | `--${string}` | null | undefined")

	// tagAt knows SVG content, and what follows <foreignObject> is HTML again.
	const template = `<template><svg><a href="#"></a><foreignObject><a href="/"></a></foreignObject></svg><a href="/"></a></template>`
	const contexts = [...template.matchAll(/<a /g)].map((match) => tagAt(template, match.index + 2)!.svg)
	assert.deepEqual(contexts, [true, false, false])

	const document = TextDocument.create('file:///Gradient.meeko', 'meeko', 1, '<template><svg><linearGradient bind:></linearGradient></svg></template>')
	const position = document.positionAt(document.getText().indexOf('bind:') + 5)
	const items = bindAttributeCompletion(document, position, 'bind:', ['svg:linearGradient'], new Set())
	const units = items.find((item) => item.label === 'bind:gradientUnits')
	assert.equal(units?.detail, "bind:gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox' | null | undefined")
	assert.ok(!items.some((item) => item.label === 'bind:gradientunits'))
})

const updatePage = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const action = signal<"show" | "hide" | null>("show");
const target = signal<string | undefined>("menu");
const units = signal<"userSpaceOnUse" | null>("userSpaceOnUse");
const attrs = signal<{ popovertargetaction: "toggle" | null; "aria-pressed": "true" | undefined }>({ popovertargetaction: "toggle", "aria-pressed": "true" });
</script>
<template><main><button class="single" bind:popovertargetaction="action.value" bind:popovertarget="target.value">a</button><button class="spread" bind="attrs.value">b</button><svg><linearGradient class="gradient" bind:gradientUnits="units.value"></linearGradient></svg><i class="clear" on:click="() => { action.value = null; target.value = undefined; units.value = null; attrs.value = { popovertargetaction: null, 'aria-pressed': undefined } }"></i><i class="restore" on:click="() => { action.value = 'hide'; target.value = 'other'; units.value = 'userSpaceOnUse'; attrs.value = { popovertargetaction: 'toggle', 'aria-pressed': 'true' } }"></i></main></template>`

test('a binding that goes from a valid value to null leaves the attribute out in SSR and removes it in the browser', async () => {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(join(parent, 'native-attributes-runtime-'))
	const window = new Window()
	try {
		const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href)
		const load = async (source: string, name: string) => {
			const code = compile(source, join(directory, `${name}.meeko`))
				.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
				.replaceAll(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
			await writeFile(join(directory, `${name}.ts`), code)
			return (await import(pathToFileURL(join(directory, `${name}.ts`)).href)) as { renderToString(props: object): string; hydrate(root: Element, props: object): () => void }
		}
		// SSR: null and undefined from the start write nothing.
		const empty = await load(updatePage.replace('signal<"show" | "hide" | null>("show")', 'signal<"show" | "hide" | null>(null)').replace('signal<string | undefined>("menu")', 'signal<string | undefined>(undefined)').replace('signal<"userSpaceOnUse" | null>("userSpaceOnUse")', 'signal<"userSpaceOnUse" | null>(null)'), 'Empty')
		const emptyHtml = empty.renderToString({})
		assert.doesNotMatch(emptyHtml, /class="single"[^>]*popovertarget/)
		assert.doesNotMatch(emptyHtml, /gradientUnits/)

		const component = await load(updatePage, 'Page')
		const html = component.renderToString({})
		assert.match(html, /<button class="single" popovertargetaction="show" popovertarget="menu"/)
		assert.match(html, /popovertargetaction="toggle"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*popovertargetaction="toggle"/)
		assert.match(html, /<linearGradient class="gradient" gradientUnits="userSpaceOnUse"/)
		const root = window.document.createElement('div')
		root.innerHTML = html
		const release = component.hydrate(root as unknown as Element, {})
		const attribute = (selector: string, name: string): string | null => root.querySelector(selector)!.getAttribute(name)
		const click = (selector: string): void => (root.querySelector(selector) as unknown as HTMLElement).click()
		click('i.clear')
		assert.equal(attribute('.single', 'popovertargetaction'), null)
		assert.equal(attribute('.single', 'popovertarget'), null)
		assert.equal(attribute('.spread', 'popovertargetaction'), null)
		assert.equal(attribute('.spread', 'aria-pressed'), null)
		assert.equal(attribute('.gradient', 'gradientUnits'), null)
		click('i.restore')
		assert.equal(attribute('.single', 'popovertargetaction'), 'hide')
		assert.equal(attribute('.single', 'popovertarget'), 'other')
		assert.equal(attribute('.spread', 'popovertargetaction'), 'toggle')
		assert.equal(attribute('.gradient', 'gradientUnits'), 'userSpaceOnUse')
		release()
	} finally {
		window.happyDOM.abort()
		await rm(directory, { recursive: true, force: true })
	}
})
