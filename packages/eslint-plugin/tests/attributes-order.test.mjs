import { compile } from '@meekojs/meeko/compiler'
import { Linter, RuleTester } from 'eslint'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { format } from 'prettier'
import ts from 'typescript'

import plugin, { defineEslint } from '../dist/index.js'
import parser from '../dist/parser.js'

const rule = plugin.rules['attributes-order']
const tester = new RuleTester({ languageOptions: { parser } })
const wrap = (attrs, tag = 'div') => `<template><${tag} ${attrs}></${tag}></template>`
const error = [{ messageId: 'order' }]
/** The error of an order that only a suggestion fixes, because it moves `names`. */
const suggested = (names, output) => [{ messageId: 'order', suggestions: [{ messageId: 'reorder', data: { names }, output }] }]
const effectFreeExpressions = ['title', 'title.value', 'state.value?.title', "state.value['title']", 'items[index.value]', "'text'", '1', 'null', 'open.value ? title : other', 'a ?? b ?? c', 'a && b || c', '!open.value', 'typeof title', 'count.value + 1', '`${a.value} ${b}`', 'title as string', 'title!', "['a', title.value]", "{ id: title, 'aria-label': other, [key]: 1, ...rest }", '() => save()', '(event) => emit(event)', 'function () { save() }', '(a, b)']
const effectfulExpressions = ['read()', 'state.read()', 'state?.read()', 'read?.()', 'new Reader()', 'delete state.title', 'count.value++', '--count.value', 'count.value = 1', 'count.value += 1', 'await load', 'tag`text`', "import('./a')", '[...items]', 'open ? read() : other', 'a ?? read()', '!read()', 'void read()', '`${read()}`', 'items[read()]', 'read().value', '{ id: read() }', '{ [read()]: 1 }', '{ ...read() }', '(a, read())', '(() => read())()', 'read() as string', 'read()!', 'class {}']

tester.run('attributes-order', rule, {
	valid: [
		wrap('id="a" title="b" class="c" on:click="save"'),
		wrap('ref:card each:of="items" each:as="item" each:index="index" each:key="item.id" if:when="visible" is="Card" id="a" class="c" model="value" bind:title="title" bind="attrs" on:save="save" html="content"', 'component'),
		wrap('name="row" params="item"', 'snippet'),
		wrap('snippet="row" args="item"', 'render'),
		wrap('alt="a" bind:title="title"'),
		{ code: wrap('bind:class="classes" class="c" id="a"'), options: [{ order: ['bindings', 'attributes'] }] },
		{ code: wrap('each:of="items" each:as="item" each:index="index" each:key="item.id"'), options: [{ alphabetical: true }] },
	],
	invalid: [
		{ code: '<template><!-- keep --><Card bind:title="title" id="a" /></template>', output: '<template><!-- keep --><Card id="a" bind:title="title" /></template>', errors: error },
		{ code: wrap('bind:title="title" class="c" id="a"'), output: wrap('class="c" id="a" bind:title="title"'), errors: error },
		{ code: wrap('bind:title="title" class="c" id="a"', 'Card'), output: wrap('class="c" id="a" bind:title="title"', 'Card'), errors: error },
		{ code: wrap('class="c" is="Card"', 'component'), output: wrap('is="Card" class="c"', 'component'), errors: error },
		{ code: wrap('class="c" if:when="visible"'), output: wrap('if:when="visible" class="c"'), errors: error },
		{ code: wrap('each:of="items" each:as="item" bind:title="item.title" id="t" ref:element class="c" on:click="save"'), output: wrap('ref:element each:of="items" each:as="item" id="t" class="c" bind:title="item.title" on:click="save"'), errors: error },
		{ code: wrap('model="value" title="t"'), output: wrap('title="t" model="value"'), errors: error },
		{ code: wrap('model:value="value" title="t"', 'Card'), output: wrap('title="t" model:value="value"', 'Card'), errors: error },
		{ code: wrap('on:click="save" class="c"'), output: wrap('class="c" on:click="save"'), errors: error },
		{ code: wrap('html="content" class="c"'), output: wrap('class="c" html="content"'), errors: error },
		{ code: wrap('params="item" name="row"', 'snippet'), output: wrap('name="row" params="item"', 'snippet'), errors: error },
		{ code: wrap('args="item" snippet="row"', 'render'), output: wrap('snippet="row" args="item"', 'render'), errors: error },
		{ code: wrap('each:key="item.id" each:index="index" each:as="item" each:of="items"'), output: wrap('each:of="items" each:as="item" each:index="index" each:key="item.id"'), errors: error },
		{ code: wrap('on:save="save" bind:title="getTitle()"', 'Card'), output: null, errors: suggested('bind:title', wrap('bind:title="getTitle()" on:save="save"', 'Card')) },
		{ code: wrap('bind:z="readZ()" bind:a="readA()"'), options: [{ alphabetical: true }], output: null, errors: suggested('bind:z, bind:a', wrap('bind:a="readA()" bind:z="readZ()"')) },
		{ code: wrap('bind="attrs" title="t" id="a"'), output: wrap('title="t" id="a" bind="attrs"'), errors: error },
		{ code: wrap('bind="attrs" bind:title="title"'), output: wrap('bind:title="title" bind="attrs"'), errors: error },
		{ code: wrap('bind="attrs" class="c"'), output: wrap('class="c" bind="attrs"'), errors: error },
		{ code: wrap('bind="attrs" style="color: red" bind:class="classes.value"'), output: wrap('style="color: red" bind:class="classes.value" bind="attrs"'), errors: error },
		// The report that had no way out: the spread between bindings of a <component is>.
		{
			code: `<template>
	<component
		is="to ? 'MeekoLink' : 'a'"
		class="relative flex"
		bind="rest"
		bind:to="to"
		bind:href="href"
		bind:type="type"
		on:click="onClick"
	></component>
</template>`,
			output: `<template>
	<component
		is="to ? 'MeekoLink' : 'a'"
		class="relative flex"
		bind:to="to"
		bind:href="href"
		bind:type="type"
		bind="rest"
		on:click="onClick"
	></component>
</template>`,
			errors: [{ messageId: 'order', data: { name: 'bind:to', previous: 'bind' } }],
		},
		// As it was reported: `bind:is` is an ordinary binding for the rule, and MEEK030 for the compiler.
		{
			code: wrap('bind:is="tag" class="relative" bind="rest" bind:to="to" on:click="onClick"', 'component'),
			output: wrap('class="relative" bind:is="tag" bind:to="to" bind="rest" on:click="onClick"', 'component'),
			errors: [{ messageId: 'order', data: { name: 'class', previous: 'bind:is' } }],
		},
		...effectFreeExpressions.map((expression) => ({ code: wrap(`bind="rest" bind:title="${expression}"`), output: wrap(`bind:title="${expression}" bind="rest"`), errors: error })),
		...effectfulExpressions.map((expression) => ({ code: wrap(`bind="rest" bind:title="${expression}"`), output: null, errors: suggested('bind:title', wrap(`bind:title="${expression}" bind="rest"`)) })),
		// Only the expressions that swap count: this call stays first.
		{ code: wrap('bind:title="read()" bind="rest" bind:to="to"'), output: wrap('bind:title="read()" bind:to="to" bind="rest"'), errors: error },
		{ code: wrap('bind:title="read()" id="a"'), output: wrap('id="a" bind:title="read()"'), errors: error },
		// A spread with effects: it counts when it swaps, and a class written before it moves it as well.
		{ code: wrap('bind="read()" class="c"'), output: wrap('class="c" bind="read()"'), errors: error },
		{ code: wrap('bind="read()" bind:title="title"'), output: null, errors: suggested('bind', wrap('bind:title="title" bind="read()"')) },
		{ code: wrap('bind:title="read()" class="c" bind="rest"'), output: null, errors: suggested('bind:title', wrap('class="c" bind:title="read()" bind="rest"')) },
		{ code: wrap('bind:z="z" bind:class="read()" bind="rest"', 'Card'), options: [{ alphabetical: true }], output: null, errors: suggested('bind:class', wrap('bind:class="read()" bind:z="z" bind="rest"', 'Card')) },
		// A control clamps its value to the current max: on an update, the written order of both effects decides.
		{ code: wrap('bind:value="value.value" bind:max="max.value"', 'input'), options: [{ alphabetical: true }], output: null, errors: suggested('bind:value, bind:max', wrap('bind:max="max.value" bind:value="value.value"', 'input')) },
		{ code: wrap('bind:value="value.value" bind:max="max.value"', 'Card'), options: [{ alphabetical: true }], output: wrap('bind:max="max.value" bind:value="value.value"', 'Card'), errors: error },
		{ code: wrap('bind="rest" bind:value="value.value"', 'input'), output: wrap('bind:value="value.value" bind="rest"', 'input'), errors: error },
		// On a custom element `html` is literal text, which the parser leaves alone and the rule cannot analyze.
		{ code: wrap('html="not an expression" bind:title="title"', 'x-card'), output: null, errors: suggested('html', wrap('bind:title="title" html="not an expression"', 'x-card')) },
		// The written order decides the value: neither a fix nor a suggestion.
		{ code: wrap('bind="rest" class="c" bind:class="classes"'), output: null, errors: error },
		{ code: wrap('bind="read()" id="a" bind:id="other"'), output: null, errors: error },
		{ code: wrap('bind:id="other" class="c" id="a"'), output: null, errors: error },
		{ code: wrap('bind:class="classes" class="c" id="a"'), output: null, errors: error },
		{ code: wrap('title="z" alt="a"'), options: [{ alphabetical: true }], output: wrap('alt="a" title="z"'), errors: error },
		{ code: wrap('bind:alt="alt" title="z"'), options: [{ alphabetical: true }], output: wrap('title="z" bind:alt="alt"'), errors: error },
		{ code: wrap('id="a" bind:title="title" class="c"'), options: [{ order: ['bindings'] }], output: wrap('bind:title="title" id="a" class="c"'), errors: error },
		{ code: wrap('bind:title="title"\r\n\t title="a\nb"\r\n\t id="\u{1f600}"'), output: null, errors: error },
		{ code: wrap('bind:alt="alt"\r\n\t title="a\nb"\r\n\t id="\u{1f600}"'), output: wrap('title="a\nb"\r\n\t id="\u{1f600}"\r\n\t bind:alt="alt"'), errors: error },
	],
})

const config = {
	files: ['**/*.meeko'],
	languageOptions: { parser },
	plugins: { meeko: plugin },
	rules: { 'meeko/attributes-order': ['error', { alphabetical: true }], 'meeko/prefer-static-bindings': 'error' },
}
const orderConfig = { ...config, rules: { 'meeko/attributes-order': 'error' } }

test('fixes converge with static bindings and the Meeko Prettier plugin', async () => {
	const linter = new Linter()
	for (const input of [wrap('bind:alt="alt" class="c" bind:title="\'Save\'" id="a"'), wrap('style="color: red" title="a &amp; b" id="x"', 'Card'), wrap('bind="attrs" bind:alt="alt" class="c" id="a" on:click="save"')]) {
		const fixed = linter.verifyAndFix(input, config, { filename: 'Example.meeko' })
		assert.deepEqual(fixed.messages, [])
		const options = { filepath: 'Example.meeko', plugins: ['@meekojs/prettier-plugin'], singleAttributePerLine: true, useTabs: true }
		const formatted = await format(fixed.output, options)
		const again = linter.verifyAndFix(formatted, config, { filename: 'Example.meeko' })
		assert.equal(again.fixed, false)
		assert.deepEqual(again.messages, [])
		assert.equal(await format(again.output, options), formatted)
		assert.match(formatted, /\n\s+id=/)
	}
})

test('comments between attributes and duplicate spellings remain parser diagnostics', () => {
	for (const input of [wrap('class="c" <!-- keep --> id="a"'), wrap('class="c" id="a" id="b"')]) {
		const fixed = new Linter().verifyAndFix(input, config, { filename: 'Example.meeko' })
		assert.equal(fixed.fixed, false)
		assert.equal(fixed.output, input)
		assert.equal(fixed.messages[0]?.fatal, true)
	}
})

test('the rule remains optional in recommended and defineEslint', () => {
	for (const entry of [...plugin.configs.recommended, ...defineEslint()]) assert.equal(entry.rules?.['meeko/attributes-order'], undefined)
	assert.equal(new Linter().verify(wrap('bind:title="title" id="x"'), defineEslint({ rules: { 'meeko/attributes-order': 'warn' } }), { filename: 'Example.meeko' }).filter((entry) => entry.ruleId === 'meeko/attributes-order').length, 1)
})

test('compiler evaluation order is preserved for binding expressions', () => {
	const script = '<script lang="ts">function readA() { return "a" }; function readZ() { return "z" }</script>'
	const linter = new Linter()
	const input = script + wrap('class="c" bind:title="readA()" bind:translate="readZ()" id="a"')
	const fixed = linter.verifyAndFix(input, config, { filename: 'Example.meeko' })
	assert.equal(fixed.fixed, true)
	assert.deepEqual(fixed.messages, [])
	const calls = (source) => [...compile(source, 'Example.meeko').code.matchAll(/read[AZ]\(\)/g)].map((entry) => entry[0])
	assert.deepEqual(calls(fixed.output), calls(input))
	const unsafe = script + wrap('bind:title="readZ()" bind:alt="readA()"')
	assert.equal(linter.verifyAndFix(unsafe, config, { filename: 'Example.meeko' }).fixed, false)
	const manuallyReordered = unsafe.replace('bind:title="readZ()" bind:alt="readA()"', 'bind:alt="readA()" bind:title="readZ()"')
	assert.notDeepEqual(calls(unsafe), calls(manuallyReordered))
})

test('group fixes preserve compiled spread evaluation and converge', () => {
	const script = '<script lang="ts">function readA() { return "a" }; function readZ() { return {} }</script>'
	const linter = new Linter()
	const calls = (source) => [...compile(source, 'Example.meeko').code.matchAll(/read[AZ]\(\)/g)].map((entry) => entry[0])
	for (const attrs of ['bind:title="readA()" id="a" bind="readZ()"', 'bind="readZ()" id="a"', 'bind:title="readA()" class="c" id="a"']) {
		const input = script + wrap(attrs)
		const fixed = linter.verifyAndFix(input, config, { filename: 'Example.meeko' })
		assert.equal(fixed.fixed, true)
		assert.deepEqual(fixed.messages, [])
		assert.deepEqual(calls(fixed.output), calls(input))
		assert.equal(linter.verifyAndFix(fixed.output, config, { filename: 'Example.meeko' }).fixed, false)
	}
	// Moving class before a binding also moves its combined spread evaluation.
	const unsafe = script + wrap('bind:title="readA()" class="c" bind="readZ()"')
	const reordered = script + wrap('class="c" bind:title="readA()" bind="readZ()"')
	assert.notDeepEqual(calls(unsafe), calls(reordered))
	assert.equal(linter.verifyAndFix(unsafe, config, { filename: 'Example.meeko' }).fixed, false)
})

/** The attributes of the root element that `body` renders on the server, whatever their order. */
async function renderedAttributes(script, body) {
	const directory = await mkdtemp(join(tmpdir(), 'meeko-attributes-order-'))
	try {
		const code = compile(`${script}<template>${body}</template>`, join(directory, 'Example.meeko')).code.replaceAll(/from "(@meekojs\/meeko(?:\/internal)?)"/g, (_, name) => `from ${JSON.stringify(import.meta.resolve(name))}`)
		const file = join(directory, 'Example.mjs')
		await writeFile(file, ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText)
		const { renderToString } = await import(pathToFileURL(file).href)
		const opening = /^<\w+([^>]*)>/.exec(renderToString({}))[1]
		return [...opening.matchAll(/([\w:-]+)="([^"]*)"/g)]
			.map((entry) => `${entry[1]}=${entry[2]}`)
			.filter((entry) => !entry.startsWith('data-meeko'))
			.sort()
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

test('fixing a spread renders the same attributes on the server', async () => {
	const script = '<script lang="ts">const rest = { id: "spread", title: "spread", class: "spread", style: "color: red", "data-only": "spread" }; const label = "own"; const classes = "bound"</script>'
	const linter = new Linter()
	for (const [body, expected] of [
		['<div bind="rest" id="own" bind:title="label"></div>', ['class=spread', 'data-only=spread', 'id=own', 'style=color: red', 'title=own']],
		['<div bind="rest" class="own" style="color: blue"></div>', ['class=own spread', 'data-only=spread', 'id=spread', 'style=color: red; color: blue', 'title=spread']],
		['<div bind="rest" bind:class="classes" bind:title="label"></div>', ['class=bound spread', 'data-only=spread', 'id=spread', 'style=color: red', 'title=own']],
		['<component is="\'section\'" bind="rest" class="own" bind:title="label"></component>', ['class=own spread', 'data-only=spread', 'id=spread', 'style=color: red', 'title=own']],
	]) {
		const fixed = linter.verifyAndFix(`${script}\n<template>${body}</template>`, orderConfig, { filename: 'Example.meeko' })
		assert.equal(fixed.fixed, true, body)
		assert.deepEqual(fixed.messages, [])
		const fixedBody = /<template>(.*)<\/template>/.exec(fixed.output)[1]
		assert.notEqual(fixedBody, body)
		assert.deepEqual(await renderedAttributes(script, body), expected)
		assert.deepEqual(await renderedAttributes(script, fixedBody), expected)
	}
})

test('a suggestion is offered for the editor and never applied by --fix', () => {
	const input = wrap('bind="rest" bind:title="read()"')
	const linter = new Linter()
	const [message] = linter.verify(input, orderConfig, { filename: 'Example.meeko' })
	assert.equal(message.fix, undefined)
	assert.match(message.suggestions[0].desc, /bind:title/)
	const fixed = linter.verifyAndFix(input, orderConfig, { filename: 'Example.meeko' })
	assert.equal(fixed.fixed, false)
	assert.equal(fixed.output, input)
})
