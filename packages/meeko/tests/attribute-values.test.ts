import { Window } from 'happy-dom'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import type { AttributeValueOf, AttributeValues, ClassValue, StyleValue } from '../src/index.ts'

import { joinAttribute } from '../src/app/runtime/dynamic-tag.ts'
import { checkSource } from '../src/check.ts'
import { compile } from '../src/compiler.ts'
import { closedAttributeValues, closedAttributeValuesOf } from '../src/compiler/attribute-values.ts'
import { attributeValue, renderAttribute } from '../src/core/server.ts'

/** Temporary project under `.meeko/` whose package imports resolve to src/. */
async function typeProject(): Promise<{ root: string; cleanup: () => Promise<void> }> {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const root = await mkdtemp(join(parent, 'attribute-values-'))
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
	await writeFile(join(root, 'tsconfig.json'), `${JSON.stringify({ compilerOptions: { types: ['node'], paths: { '@meekojs/meeko/internal': ['../../src/internal.ts'], '@meekojs/meeko': ['../../src/index.ts'] } } })}\n`)
	return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('the closed values of an attribute come from the HTML data, without suggestions or lists', () => {
	assert.deepEqual([...closedAttributeValues('button', 'type')!].sort(), ['button', 'reset', 'submit'])
	assert.deepEqual([...closedAttributeValues('div', 'hidden')!].sort(), ['', 'hidden', 'until-found'])
	assert.ok(closedAttributeValues('input', 'type')!.includes('datetime-local'))
	assert.ok(closedAttributeValues('span', 'aria-pressed')!.includes('mixed'))
	// Free text, suggestions (`freeform`) and lists of words (`rel`, `class`) have none.
	for (const [tag, name] of [
		['a', 'href'],
		['a', 'rel'],
		['div', 'class'],
		['div', 'title'],
		['x-card', 'type'],
		['a', 'type'],
	] as const) {
		assert.equal(closedAttributeValues(tag, name), undefined, `${tag} ${name}`)
	}
	assert.deepEqual(closedAttributeValuesOf(['a', 'button'], 'type')?.slice().sort(), ['button', 'reset', 'submit'])
})

test('ElementAttributes and AttributeValueOf suggest the values and still accept any value', () => {
	const type: AttributeValues<'button', 'type'> = 'submit'
	// @ts-expect-error A value outside the closed ones is not one of AttributeValues.
	const wrong: AttributeValues<'button', 'type'> = 'sumbit'
	const free: AttributeValueOf<'button', 'type'> = String(type)
	const values: Array<AttributeValueOf<'div', 'hidden'>> = ['until-found', true, false, null, undefined, 1, free]
	assert.equal(values.length, 7)
	void wrong
})

test('ClassValue and AttributeValueOf accept nested class arrays', () => {
	const classes: ClassValue = ['card', false, ['rounded', null, undefined]]
	const attribute: AttributeValueOf<'div', 'class'> = classes
	assert.deepEqual(attribute, classes)
})

test('ClassValue accepts clsx-style objects and rejects functions, symbols and signals', () => {
	const active = true
	const classes: ClassValue = ['card', { 'card--active': active, hidden: false, count: 0, label: 'yes' }, [[{ deep: null }], 2]]
	const attribute: AttributeValueOf<'div', 'class'> = { on: active }
	assert.ok(classes && attribute)
	void (() => {
		// @ts-expect-error A function is not a class.
		const fn: ClassValue = () => 'x'
		// @ts-expect-error A symbol is not a class.
		const symbol: ClassValue = Symbol('x')
		// @ts-expect-error A signal is an object without an index signature: its .value is the class.
		const signalValue: ClassValue = { value: true, peek: () => true } as { readonly value: boolean; peek(): boolean }
		// @ts-expect-error The condition of a class is a value, not an object.
		const nested: ClassValue = { on: { value: true } }
		void [fn, symbol, signalValue, nested]
	})
})

test('StyleValue and AttributeValueOf accept style objects', () => {
	const styles: StyleValue = { backgroundColor: 'red', '--space': '1rem', opacity: 0.5, display: false }
	const attribute: AttributeValueOf<'div', 'style'> = styles
	assert.deepEqual(attribute, styles)
})

test('the type check code wraps checked values; the run-time code does not change', () => {
	const source = `<script lang="ts">\nconst kind = "submit";\n</script>\n<template><button type="sumbit" bind:value="kind"><span bind:aria-pressed="kind">x</span></button><a href="/" rel="external">y</a></template>`
	const checked = compile(source, 'Values.meeko', { typeCheck: true }).code
	assert.match(checked, /__meeko\.checkAttributeValue<"button", "type">\(\)\("sumbit"\), " type=\\"sumbit\\""/)
	assert.match(checked, /__meeko\.checkAttributeValue<"span", "aria-pressed">\(\)\(kind\)/)
	// `value` of a button, `href` and `rel` have no closed values: nothing to check.
	assert.doesNotMatch(checked, /checkAttributeValue<"button", "value">|checkAttributeValue<"a"/)
	assert.doesNotMatch(compile(source, 'Values.meeko').code, /checkAttributeValue/)
})

test('meeko check warns with MEEK122 on a literal outside the values, never on a wide string', { timeout: 120_000 }, async () => {
	const { root, cleanup } = await typeProject()
	const script = `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst text = signal<string>("submit");\nconst kind = signal<"submit" | "nope">("submit");\nconst wrongKind = signal<"nope" | "other">("nope");\nconst flag = signal(true);\n</script>\n`
	const cases: Array<{ name: string; template: string; at?: string; message?: RegExp }> = [
		{ name: 'Valid', template: `<button type="submit">a</button><button type="SUBMIT">b</button><button bind:type="text.value">c</button><div hidden="until-found"></div><div bind:hidden="flag.value"></div><div bind:style="{ backgroundColor: 'red', '--space': 4, display: false }"></div><div hidden></div><dialog closedby="any"></dialog><a target="_blank" rel="noopener external">e</a><input type="datetime-local" /><component is="flag.value ? 'a' : 'button'" bind:type="'reset'">f</component>` },
		{ name: 'StaticType', template: `<button type="sumbit">a</button>`, at: `"sumbit"`, message: /^"sumbit" no es un valor de type en <button>: admite .*submit.*\. Es un aviso en 1\.x y será un error en 2\.0$/ },
		{ name: 'BoundLiteral', template: `<button bind:type="'sumbit'">a</button>`, at: `'sumbit'` },
		{ name: 'BoundUnion', template: `<button bind:type="wrongKind.value">a</button>`, at: 'wrongKind.value' },
		// Since 1.10 each literal of a union is checked on its own: a valid one does not hide an invalid one.
		{ name: 'MixedUnion', template: `<button bind:type="kind.value">a</button>`, at: 'kind.value', message: /^"nope" no es un valor de type en <button>: admite submit, reset, button\./ },
		{ name: 'Hidden', template: `<div hidden="nope"></div>`, at: `"nope"`, message: /admite "", hidden, until-found|admite until-found, hidden, ""/ },
		{ name: 'InputType', template: `<input type="emial" />`, at: `"emial"` },
		{ name: 'Aria', template: `<span aria-pressed="maybe">x</span>`, at: `"maybe"` },
		{ name: 'DynamicTag', template: `<component is="flag.value ? 'a' : 'button'" bind:type="'zzz'">x</component>`, at: `'zzz'` },
	]
	try {
		for (const item of cases) {
			const source = `${script}<template>${item.template}</template>`
			const diagnostics = await checkSource(source, join(root, `${item.name}.meeko`))
			const messages = JSON.stringify(diagnostics)
			if (!item.at) {
				assert.deepEqual(diagnostics, [], `${item.name}: ${messages}`)
				continue
			}
			// Only the warning: meeko check does not fail.
			assert.ok(
				diagnostics.every((diagnostic) => diagnostic.code === 'MEEK122' && diagnostic.severity === 'warning'),
				`${item.name}: ${messages}`,
			)
			const offset = source.indexOf(item.at, source.indexOf('<template>'))
			const warning = diagnostics.find((diagnostic) => diagnostic.location.offset === offset)
			assert.ok(warning, `${item.name}: ${messages}`)
			if (item.message) assert.match(warning.message, item.message)
		}
	} finally {
		await cleanup()
	}
})

test('meeko check accepts clsx-style values in bind:class and rejects functions, symbols and signals at the expression', { timeout: 120_000 }, async () => {
	const { root, cleanup } = await typeProject()
	const script = `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst on = signal(true);\nconst format = () => "x";\n</script>\n`
	const cases: Array<{ name: string; template: string; at?: string; message?: RegExp }> = [
		{
			name: 'ClassValid',
			template: `<div bind:class="{ on: on.value, off: false }">a</div><p class="x" bind:class="['a', { b: on.value }, [[null, 1]]]">b</p><span bind="{ class: { c: on.value } }">c</span><i class="z" bind:class="{ z: on.value }" bind="{ title: 'a' }">d</i><b bind:class="[on.value && 'b']" bind="{ title: 'b' }">e</b><component is="on.value ? 'a' : 'b'" bind:class="{ q: true }">f</component><component is="on.value ? 'a' : 'b'" class="r" bind:class="['s']">g</component>`,
		},
		{ name: 'ClassFunction', template: `<div bind:class="format">a</div>`, at: 'format', message: /'\(\) => string' is not assignable to parameter of type 'ClassValue'/ },
		{ name: 'ClassJoined', template: `<p class="x" bind:class="format">a</p>`, at: 'format', message: /ClassValue/ },
		{ name: 'ClassSignal', template: `<p class="x" bind:class="on" bind="{ title: 'a' }">a</p>`, at: 'on"', message: /Signal<boolean>.*ClassValue/ },
		{ name: 'ClassSpreadExplicit', template: `<p bind:class="format" bind="{ title: 'a' }">a</p>`, at: 'format', message: /ClassValue/ },
		{ name: 'ClassSymbol', template: `<p bind:class="Symbol()">a</p>`, at: 'Symbol()', message: /'symbol' is not assignable to parameter of type 'ClassValue'/ },
		{ name: 'ClassSignalCondition', template: `<p bind:class="{ a: on }">a</p>`, at: '{ a: on }', message: /ClassValue/ },
		{ name: 'ClassDynamicTag', template: `<component is="on.value ? 'a' : 'b'" bind:class="format">e</component>`, at: 'format', message: /ClassValue/ },
		{ name: 'ClassSpread', template: `<span bind="{ class: format }">c</span>`, at: 'class', message: /AttributeValueOf<"span", "class">/ },
	]
	try {
		for (const item of cases) {
			const source = `${script}<template>${item.template}</template>`
			const diagnostics = await checkSource(source, join(root, `${item.name}.meeko`))
			const messages = JSON.stringify(diagnostics)
			if (!item.at) {
				assert.deepEqual(diagnostics, [], `${item.name}: ${messages}`)
				continue
			}
			assert.equal(diagnostics.length, 1, `${item.name}: ${messages}`)
			const [error] = diagnostics
			assert.notEqual(error!.severity, 'warning', `${item.name}: ${messages}`)
			assert.equal(error!.location.offset, source.indexOf(item.at, source.indexOf('<template>')), `${item.name}: ${messages}`)
			if (item.message) assert.match(error!.message, item.message, item.name)
		}
	} finally {
		await cleanup()
	}
})

test('hidden writes until-found and other texts as they are, and stays boolean otherwise', () => {
	// Before 1.8 hidden was boolean: any truthy value wrote hidden="", so "until-found" was lost.
	assert.equal(renderAttribute('hidden', 'until-found'), ' hidden="until-found"')
	assert.equal(renderAttribute('hidden', 'hidden'), ' hidden="hidden"')
	for (const value of [true, 1]) assert.equal(attributeValue('hidden', value), '', String(value))
	for (const value of [false, '', 0, null, undefined]) assert.equal(attributeValue('hidden', value), null, String(value))
	// The boolean attributes of the standard still write themselves empty, also the recent ones.
	assert.equal(attributeValue('disabled', 'no'), '')
	assert.equal(attributeValue('disabled', false), null)
	assert.equal(attributeValue('itemscope', true), '')
	// Other enumerated attributes keep their text.
	assert.equal(attributeValue('popover', 'manual'), 'manual')
})

test('class arrays join their non-empty fragments with spaces', () => {
	assert.equal(attributeValue('class', ['card', false, ['rounded', null, undefined], '']), 'card rounded')
	assert.equal(renderAttribute('class', ['card', ['rounded', 'wide']]), ' class="card rounded wide"')
	assert.equal(attributeValue('class', [false, null, undefined, '']), null)
	assert.equal(attributeValue('title', ['a', 'b']), 'a,b')
})

test('class objects add each key whose value is truthy, in order, like clsx', () => {
	assert.equal(attributeValue('class', { a: true, b: false, c: 1, d: 0, e: 'yes', f: '', g: null, h: undefined }), 'a c e')
	assert.equal(
		attributeValue('class', [
			'x',
			{ y: true, z: false },
			[
				[{ w: true }, 'v'],
				['  ', { ' ': true }],
			],
		]),
		'x y w v',
	)
	assert.equal(renderAttribute('class', { 'is-open': true, 'p-4 m-2': true }), ' class="is-open p-4 m-2"')
	// Repeats are kept, as clsx does.
	assert.equal(attributeValue('class', ['a', { a: true }]), 'a a')
	for (const value of [{}, { a: false }, [{ a: 0 }, []], true, false, null, undefined]) assert.equal(attributeValue('class', value), null, JSON.stringify(value))
	// Numbers are classes; booleans never are.
	assert.equal(attributeValue('class', 3), '3')
	assert.equal(attributeValue('class', [1, true, false]), '1')
	assert.equal(joinAttribute('class', 'base', { on: true, off: false }), 'base on')
	assert.equal(joinAttribute('class', 'base', { off: false }), 'base')
})

test('style objects serialize camelCase, kebab-case and custom properties', () => {
	assert.equal(attributeValue('style', { backgroundColor: 'red', 'font-size': '1rem', '--space': 4, opacity: 0.5, display: false, color: null }), 'background-color: red; font-size: 1rem; --space: 4; opacity: 0.5')
	assert.equal(renderAttribute('style', { color: 'rgb(1, 2, 3)', WebkitTransform: 'scale(1)' }), ' style="color: rgb(1, 2, 3); -webkit-transform: scale(1)"')
	assert.equal(attributeValue('style', { color: undefined }), null)
	assert.throws(() => attributeValue('style', { 'color;background': 'red' }), /Invalid CSS property name/)
})

const hiddenPage = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const state = signal<string | boolean>("until-found");
</script>
<template><main><section class="fixed" hidden="until-found">a</section><section class="bound" bind:hidden="state.value">b</section><section class="literal" bind:hidden="'until-found'">c</section><section class="flag" bind:hidden="true">d</section><i class="next" on:click="() => state.value = state.value === 'until-found' ? true : state.value === true ? false : 'until-found'"></i></main></template>`

test('hidden="until-found", bind:hidden with a text and bind:hidden with a boolean render, hydrate and update', async () => {
	const parent = resolve('.meeko')
	await mkdir(parent, { recursive: true })
	const directory = await mkdtemp(join(parent, 'attribute-hidden-'))
	const window = new Window()
	try {
		const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href)
		const code = compile(hiddenPage, join(directory, 'Page.meeko'))
			.code.replace(`from "@meekojs/meeko/internal"`, `from ${runtime('src/internal.ts')}`)
			.replaceAll(`from "@meekojs/meeko"`, `from ${runtime('src/index.ts')}`)
		await writeFile(join(directory, 'Page.ts'), code)
		const component = (await import(pathToFileURL(join(directory, 'Page.ts')).href)) as { renderToString(props: object): string; hydrate(root: Element, props: object): () => void }
		const html = component.renderToString({})
		assert.match(html, /<section class="fixed" hidden="until-found"/)
		assert.match(html, /<section class="bound" hidden="until-found"/)
		assert.match(html, /<section class="literal" hidden="until-found"/)
		assert.match(html, /<section class="flag" hidden=""/)
		const root = window.document.createElement('div')
		root.innerHTML = html
		const release = component.hydrate(root as unknown as Element, {})
		const bound = (): string | null => root.querySelector('.bound')!.getAttribute('hidden')
		const next = (): void => (root.querySelector('i.next') as unknown as HTMLElement).click()
		assert.equal(bound(), 'until-found')
		next()
		assert.equal(bound(), '')
		next()
		assert.equal(bound(), null)
		next()
		assert.equal(bound(), 'until-found')
		release()
	} finally {
		window.happyDOM.abort()
		await rm(directory, { recursive: true, force: true })
	}
})
