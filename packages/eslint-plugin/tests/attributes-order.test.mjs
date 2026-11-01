import { compile } from '@meekojs/meeko/compiler'
import { Linter, RuleTester } from 'eslint'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { format } from 'prettier'

import plugin, { defineEslint } from '../dist/index.js'
import parser from '../dist/parser.js'

const rule = plugin.rules['attributes-order']
const tester = new RuleTester({ languageOptions: { parser } })
const wrap = (attrs, tag = 'div') => `<template><${tag} ${attrs}></${tag}></template>`
const error = [{ messageId: 'order' }]

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
		{ code: wrap('args="item" snippet="row"', 'render'), output: null, errors: error },
		{ code: wrap('each:key="item.id" each:index="index" each:as="item" each:of="items"'), output: null, errors: error },
		{ code: wrap('on:save="save" bind:title="getTitle()"', 'Card'), output: null, errors: error },
		{ code: wrap('bind:z="readZ()" bind:a="readA()"'), options: [{ alphabetical: true }], output: null, errors: error },
		{ code: wrap('bind="attrs" title="t" id="a"'), output: wrap('title="t" id="a" bind="attrs"'), errors: error },
		{ code: wrap('bind="attrs" bind:title="title"'), output: null, errors: error },
		{ code: wrap('bind="attrs" class="c"'), output: null, errors: error },
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

test('fixes converge with static bindings and the Meeko Prettier plugin', async () => {
	const linter = new Linter()
	for (const input of [wrap('bind:alt="alt" class="c" bind:title="\'Save\'" id="a"'), wrap('style="color: red" title="a &amp; b" id="x"', 'Card')]) {
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
