import { Linter, RuleTester } from 'eslint'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import parser from '../dist/parser.js'
import orderMacros from '../dist/rules/order-macros.js'
import orderSections from '../dist/rules/order-sections.js'
import preferStatic from '../dist/rules/prefer-static-bindings.js'

const tester = new RuleTester({ languageOptions: { parser } })
const script = (body) => `<script lang="ts">${body}</script><template><div></div></template>`

tester.run('order-macros', orderMacros, {
	valid: [
		script('const props = defineProps<{name: string}>(); const emit = defineEmits();'),
		script('function nested() { const emit = defineEmits(); const props = defineProps(); }'),
		script('function defineProps() {} const emit = defineEmits(); const props = defineProps();'),
		{ code: script('const emit = defineEmits(); const props = defineProps();'), options: [{ order: ['defineEmits', 'defineProps'] }] },
		'<script server lang="ts">const emit = defineEmits();</script><script lang="ts">const props = defineProps();</script><template><div></div></template>',
		script('const props = defineProps(); function focus() {} defineExpose({ focus });'),
	],
	invalid: [
		{ code: script('const emit = defineEmits();\nconst props = defineProps();'), output: script('const props = defineProps();\nconst emit = defineEmits();'), errors: [{ messageId: 'order', line: 2 }] },
		{ code: script('const emit = defineEmits(); // belongs to emit\nconst props = defineProps();'), output: null, errors: [{ messageId: 'order' }] },
		{ code: script('// emit declaration\nconst emit = defineEmits();\nconst props = defineProps();'), output: null, errors: [{ messageId: 'order' }] },
		{ code: script('const emit = defineEmits();\nconst props = defineProps(); // props'), output: null, errors: [{ messageId: 'order' }] },
		{ code: script('const model = defineModel(makeDefault()); const props = defineProps();'), output: null, errors: [{ messageId: 'order' }] },
		{ code: script('const model = defineModel(props); const props = defineProps();'), output: null, errors: [{ messageId: 'order' }] },
		{ code: script('const emit = defineEmits(); await setup(); const props = defineProps();'), output: null, errors: [{ messageId: 'order' }] },
		{ code: script('defineExpose({ focus }); function focus() {}'), output: null, errors: [{ messageId: 'expose' }] },
		{ code: '<script server lang="ts">const emit = defineEmits();\nconst props = defineProps();</script><template><div></div></template>', output: '<script server lang="ts">const props = defineProps();\nconst emit = defineEmits();</script><template><div></div></template>', errors: [{ messageId: 'order' }] },
	],
})

tester.run('order-sections', orderSections, {
	valid: [
		'<script server lang="ts">export const value = 1;</script><script lang="ts">const x = 1;</script><template><div></div></template><style>div { color: red }</style>',
		'<template><div></div></template>',
		{ code: '<template><div></div></template><script lang="ts">const x = 1;</script>', options: [{ order: ['template', 'script'] }] },
	],
	invalid: [
		{ code: '<template><div></div></template>\n<script lang="ts">// script\nconst x = 1;</script>', output: '<script lang="ts">// script\nconst x = 1;</script>\n<template><div></div></template>', errors: [{ messageId: 'order', line: 2 }] },
		{ code: '<template><div></div></template><!-- script --> <script lang="ts">const x = 1;</script>', output: null, errors: [{ messageId: 'order' }] },
		{ code: '<!-- template --><template><div></div></template><script lang="ts">const x = 1;</script>', output: null, errors: [{ messageId: 'order' }] },
		{ code: '<script lang="ts">const x = 1;</script><script server lang="ts">const y = 2;</script><template><div></div></template>', output: '<script server lang="ts">const y = 2;</script><script lang="ts">const x = 1;</script><template><div></div></template>', errors: [{ messageId: 'order' }] },
	],
})

tester.run('prefer-static-bindings', preferStatic, {
	valid: [
		'<template><input bind:disabled="false" bind:value="12" /></template>',
		'<template><input bind:disabled="\'\'" /></template>',
		'<template><Card bind:disabled="true" bind:ref="\'name\'" bind:is="\'div\'" /></template>',
		'<template><x-card bind:label="\'Save\'"></x-card></template>',
		'<template><component bind:label="\'Save\'" /></template>',
		'<template><div bind:label="null" bind:title="undefined" bind:onClick="\'click\'"></div></template>',
		'<template><MeekoTeleport bind:disabled="true" /></template>',
		'<template><svg bind:focusable="true"></svg></template>',
		'<template><div bind:title="\'\\0\'"></div></template>',
		'<template><div bind:title="\'A\\r\\n\\tB\'"></div></template>',
	],
	invalid: [
		{ code: '<template><Card bind:label="\'Guardar\'" /></template>', output: '<template><Card label="Guardar" /></template>', errors: [{ messageId: 'static', line: 1, column: 17 }] },
		{ code: '<template><input bind:disabled="true" /></template>', output: '<template><input disabled /></template>', errors: [{ messageId: 'static' }] },
		{ code: '<template><div bind:title="\'A &amp; &quot;B&quot; &lt;C&gt;\'"></div></template>', output: '<template><div title="A &amp; &quot;B&quot; &lt;C&gt;"></div></template>', errors: [{ messageId: 'static' }] },
		{ code: '<template><div bind:title="\'&amp;amp;\'"></div></template>', output: '<template><div title="&amp;amp;"></div></template>', errors: [{ messageId: 'static' }] },
	],
})

test('ordering and literal fixes are idempotent and stay inside SFC boundaries', () => {
	const linter = new Linter()
	const rules = { 'order-macros': orderMacros, 'order-sections': orderSections, 'prefer-static-bindings': preferStatic }
	const config = { files: ['**/*.meeko'], languageOptions: { parser }, plugins: { meeko: { rules } }, rules: Object.fromEntries(Object.keys(rules).map((name) => [`meeko/${name}`, 'error'])) }
	const input = '<template><button bind:title="\'Save\'" bind:disabled="true"></button></template>\n<script lang="ts">const emit = defineEmits();\nconst props = defineProps();</script>'
	const first = linter.verifyAndFix(input, config, { filename: 'Example.meeko' })
	assert.equal(first.messages.length, 0)
	assert.equal(first.fixed, true)
	const second = linter.verifyAndFix(first.output, config, { filename: 'Example.meeko' })
	assert.equal(second.fixed, false)
	assert.equal(second.output, first.output)
})

test('invalid syntax remains a parser diagnostic', () => {
	const messages = new Linter().verify('<script lang="ts">const x = ;</script><template><div></div></template>', { languageOptions: { parser } })
	assert.equal(messages[0]?.fatal, true)
})
