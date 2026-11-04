import { compile } from '@meekojs/meeko/compiler'
import { Linter, RuleTester } from 'eslint'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { format } from 'prettier'

import plugin, { defineEslint } from '../dist/index.js'
import parser from '../dist/parser.js'

const rule = plugin.rules['html-self-closing']
const tester = new RuleTester({ languageOptions: { parser } })
const wrap = (content) => `<template>${content}</template>`
const always = [{ messageId: 'always' }]
const never = [{ messageId: 'never' }]
const allNever = { html: { normal: 'never', void: 'never' }, component: 'never', svg: 'never', math: 'never' }

test('the rule relies on the Meeko of its peer range, with no branch for a version that does not accept <div />', () => {
	const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
	assert.match(JSON.parse(read('../package.json')).peerDependencies['@meekojs/meeko'], /^>=1\.8 /)
	assert.match(read('../src/rules/html-self-closing.ts'), /^import \{ isSelfClosableElement \} from '@meekojs\/meeko\/parse'$/m)
	assert.doesNotMatch(read('../docs/rules/html-self-closing.md'), /1\.7/)
})

tester.run('html-self-closing', rule, {
	valid: [
		wrap('<div />'),
		wrap('<div class="a"\n\tbind:title="title"\n/>'),
		wrap('<p>text</p>'),
		wrap('<div><!-- note --></div>'),
		// Whitespace is a rendered text node: left alone by default.
		wrap('<div> </div>'),
		wrap('<div>\n</div>'),
		wrap('<input /><br /><img src="a.png" alt="" />'),
		wrap('<AppButton /><component is="AppButton" /><render snippet="row" />'),
		wrap('<Card><snippet name="header" /></Card>'),
		wrap('<span if:when="show" /><li each:of="items" each:as="item" each:key="item" />'),
		wrap('<svg viewBox="0 0 1 1"><path d="M0" /><linearGradient id="g" /></svg>'),
		wrap('<math><mi /><mn>1</mn></math>'),
		// Elements that cannot close themselves, or that close without an end tag.
		wrap('<template if:when="show"></template><ul><li><li>b</li></ul>'),
		wrap('<table><tr><td /><td>x</td></tr></table>'),
		{ code: wrap('<div></div><input>'), options: [{ html: { normal: 'never', void: 'never' } }] },
		{ code: wrap('<div></div><div /><input><input />'), options: [{ html: { normal: 'any', void: 'any' } }] },
		{ code: wrap('<AppButton></AppButton><component is="AppButton"></component>'), options: [{ component: 'never' }] },
		{ code: wrap('<svg><path d="M0"></path></svg><math><mi></mi></math>'), options: [{ svg: 'never', math: 'never' }] },
		{ code: wrap('<div> </div><div>\t</div>'), options: [{ ignoreWhitespace: true }] },
		// An unquoted value keeps its `/`: this input is not self-closing.
		{ code: wrap('<input value=a/>'), options: [{ html: { void: 'never' } }] },
	],
	invalid: [
		{ code: wrap('<div></div>'), output: wrap('<div />'), errors: [{ messageId: 'always', line: 1, column: 11, endColumn: 16 }] },
		{ code: wrap('<div class="a" id="b"></div><span></span>'), output: wrap('<div class="a" id="b" /><span />'), errors: [...always, ...always] },
		{ code: wrap('<div><span></span></div>'), output: wrap('<div><span /></div>'), errors: always },
		// One attribute per line: `/>` takes the place of `>`.
		{ code: wrap('<div\n\tclass="a"\n\tbind:title="title"\n></div>'), output: wrap('<div\n\tclass="a"\n\tbind:title="title"\n/>'), errors: always },
		{ code: wrap('<span if:when="show"></span>'), output: wrap('<span if:when="show" />'), errors: always },
		{ code: wrap('<li each:of="items" each:as="item" each:key="item"></li>'), output: wrap('<li each:of="items" each:as="item" each:key="item" />'), errors: always },
		{ code: wrap('<textarea name="t"></textarea><my-element></my-element>'), output: wrap('<textarea name="t" /><my-element />'), errors: [...always, ...always] },
		{ code: wrap('<table><tr><td></td><td>x</td></tr></table>'), output: wrap('<table><tr><td /><td>x</td></tr></table>'), errors: always },
		{ code: wrap('<input><br>'), output: wrap('<input /><br />'), errors: [...always, ...always] },
		{ code: wrap('<input value=a/>'), output: wrap('<input value=a/ />'), errors: always },
		{ code: wrap('<AppButton></AppButton>'), output: wrap('<AppButton />'), errors: always },
		{ code: wrap('<component is="AppButton"></component>'), output: wrap('<component is="AppButton" />'), errors: always },
		{ code: wrap('<Card><snippet name="header"></snippet></Card>'), output: wrap('<Card><snippet name="header" /></Card>'), errors: always },
		{ code: wrap('<render snippet="row"></render>'), output: wrap('<render snippet="row" />'), errors: always },
		{ code: wrap('<svg><path d="M0"></path><linearGradient id="g"></linearGradient></svg>'), output: wrap('<svg><path d="M0" /><linearGradient id="g" /></svg>'), errors: [...always, ...always] },
		{ code: wrap('<math><mi></mi></math>'), output: wrap('<math><mi /></math>'), errors: always },
		// ignoreWhitespace drops line breaks and indentation, never a space or text.
		{ code: wrap('<div>\n\t</div><p>\n</p>'), options: [{ ignoreWhitespace: true }], output: wrap('<div /><p />'), errors: [...always, ...always] },
		{ code: wrap('<AppButton>\r\n</AppButton>'), options: [{ ignoreWhitespace: true }], output: wrap('<AppButton />'), errors: always },
		// 'never' writes the end tag, or drops the `/` of a void element.
		{ code: wrap('<div />'), options: [allNever], output: wrap('<div></div>'), errors: never },
		{ code: wrap('<div class="a"/>'), options: [allNever], output: wrap('<div class="a"></div>'), errors: [{ messageId: 'never', data: { name: 'div', replacement: '<div></div>' } }] },
		{ code: wrap('<div\n\tclass="a"\n/>'), options: [allNever], output: wrap('<div\n\tclass="a"\n></div>'), errors: never },
		{ code: wrap('<input /><br/>'), options: [allNever], output: wrap('<input><br>'), errors: [...never, ...never] },
		{ code: wrap('<AppButton /><component is="AppButton" />'), options: [allNever], output: wrap('<AppButton></AppButton><component is="AppButton"></component>'), errors: [...never, ...never] },
		{ code: wrap('<svg><linearGradient id="g" /></svg><math><mi /></math>'), options: [allNever], output: wrap('<svg><linearGradient id="g"></linearGradient></svg><math><mi></mi></math>'), errors: [...never, ...never] },
		// Categories are independent.
		{ code: wrap('<div></div><input /><AppButton></AppButton>'), options: [{ html: { void: 'never' }, component: 'any' }], output: wrap('<div /><input><AppButton></AppButton>'), errors: [...always, ...never] },
	],
})

const config = {
	files: ['**/*.meeko'],
	languageOptions: { parser },
	plugins: { meeko: plugin },
	rules: { 'meeko/html-self-closing': 'error', 'meeko/attributes-order': 'error', 'meeko/prefer-static-bindings': 'error' },
}
const script = '<script lang="ts">\nconst AppButton = {} as never\nconst show = true\nconst items = ["a"]\nconst title = "t"\n</script>\n\n'
const inputs = [
	wrap('<div bind:title="\'Save\'" class="a"></div><span if:when="show"></span>'),
	wrap('<ul><li each:of="items" each:as="item" each:key="item" bind:data-id="item"></li></ul><AppButton bind:label="title" class="b"></AppButton>'),
	wrap('<section\n\tclass="a"\n\tbind:title="title"\n\tid="s"\n></section><textarea name="t"></textarea><svg><path d="M0"></path></svg>'),
]

test('fixes are idempotent and compile to the same component', () => {
	const linter = new Linter()
	const only = { ...config, rules: { 'meeko/html-self-closing': 'error' } }
	for (const input of inputs) {
		const fixed = linter.verifyAndFix(script + input, only, { filename: 'Example.meeko' })
		assert.equal(fixed.fixed, true)
		assert.deepEqual(fixed.messages, [])
		const again = linter.verifyAndFix(fixed.output, only, { filename: 'Example.meeko' })
		assert.equal(again.fixed, false)
		assert.equal(again.output, fixed.output)
		// Only source positions (`Example.meeko:8:93` in debug labels) may change.
		const code = (source) => compile(source, 'Example.meeko').code.replace(/Example\.meeko:\d+:\d+/g, 'Example.meeko')
		assert.equal(code(fixed.output), code(script + input))
	}
})

test('fixes converge with attributes-order, static bindings and the Meeko Prettier plugin', async () => {
	const linter = new Linter()
	for (const input of inputs) {
		const fixed = linter.verifyAndFix(script + input, config, { filename: 'Example.meeko' })
		assert.deepEqual(fixed.messages, [])
		const options = { filepath: 'Example.meeko', plugins: ['@meekojs/prettier-plugin'], singleAttributePerLine: true, useTabs: true }
		const formatted = await format(fixed.output, options)
		const again = linter.verifyAndFix(formatted, config, { filename: 'Example.meeko' })
		assert.equal(again.fixed, false)
		assert.deepEqual(again.messages, [])
		assert.equal(await format(again.output, options), formatted)
		assert.doesNotMatch(formatted, /><\/(?:div|span|li|AppButton|section|textarea|path)>/)
		compile(formatted, 'Example.meeko')
	}
})

test('Prettier keeps both forms, so the rule decides', async () => {
	const options = { filepath: 'Example.meeko', plugins: ['@meekojs/prettier-plugin'] }
	const source = `${script}<template>\n\t<div />\n\t<span></span>\n\t<input />\n</template>\n`
	const formatted = await format(source, { ...options, useTabs: true })
	assert.match(formatted, /<div \/>/)
	assert.match(formatted, /<span><\/span>/)
	assert.match(formatted, /<input \/>/)
})

test('the parser reads names inside and after self-closing elements', () => {
	const source = '<script lang="ts">\nconst title = "t"\nconst items = ["a"]\n</script>\n<template><div bind:title="title" /><li each:of="items" each:as="item" bind:data-id="item" /><span bind:title="missing" /><p>{other}</p></template>'
	const messages = new Linter().verify(source, { files: ['**/*.meeko'], languageOptions: { parser }, rules: { 'no-undef': 'error', 'no-unused-vars': 'error' } }, { filename: 'Example.meeko' })
	assert.deepEqual(
		messages.map((message) => [
			message.ruleId,
			source
				.split('\n')
				.slice(0, message.line - 1)
				.join('\n').length +
				(message.line > 1 ? 1 : 0) +
				message.column -
				1,
		]),
		[
			['no-undef', source.indexOf('missing')],
			['no-undef', source.indexOf('other')],
		],
	)
})

test('the rule remains optional in recommended and defineEslint', () => {
	for (const entry of [...plugin.configs.recommended, ...defineEslint()]) assert.equal(entry.rules?.['meeko/html-self-closing'], undefined)
	const messages = new Linter().verify(wrap('<div></div>'), defineEslint({ rules: { 'meeko/html-self-closing': 'warn' } }), { filename: 'Example.meeko' })
	assert.equal(messages.filter((entry) => entry.ruleId === 'meeko/html-self-closing').length, 1)
})
