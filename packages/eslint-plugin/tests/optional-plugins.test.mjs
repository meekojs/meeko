import { compile } from '@meekojs/meeko/compiler'
import typescript from '@typescript-eslint/eslint-plugin'
import { Linter } from 'eslint'
import perfectionist from 'eslint-plugin-perfectionist'
import unusedImports from 'eslint-plugin-unused-imports'
import assert from 'node:assert/strict'
import test from 'node:test'

import { defineEslint } from '../dist/index.js'

const config = defineEslint({ perfectionist: true, unusedImports: true })
function fix(source, filename = 'App.meeko', selected = config) {
	const result = new Linter().verifyAndFix(source, selected, { filename })
	assert.deepEqual(result.messages, [])
	assert.equal(new Linter().verifyAndFix(result.output, selected, { filename }).fixed, false)
	return result.output
}

test('unused-imports stays opt-in and plugin options/namespaces are validated', () => {
	const source = `import unused from 'unused';`
	assert.equal(new Linter().verifyAndFix(source, defineEslint(), { filename: 'app.ts' }).output, source)
	assert.throws(() => defineEslint({ perfectionist: 'yes' }), /boolean/)
	assert.throws(() => defineEslint({ unusedImports: 'yes' }), /boolean/)
	assert.throws(() => defineEslint({ perfectionist: false, rules: { 'perfectionist/sort-imports': 'error' } }), /requires perfectionist/)
	assert.throws(() => defineEslint({ rules: { 'unused-imports/no-unused-vars': 'error' } }), /requires unusedImports/)
	assert.throws(() => defineEslint({ perfectionist: true, rules: { 'perfectionist/unknown': 'error' } }), /unknown rule/)
	assert.throws(() => defineEslint({ unusedImports: true, rules: { 'unused-imports/unknown': 'error' } }), /unknown rule/)
	for (const name of ['no-unused-vars', '@typescript-eslint/no-unused-vars']) {
		assert.throws(() => defineEslint({ unusedImports: true, rules: { [name]: 'warn' } }), /conflicts with unusedImports/)
		assert.doesNotThrow(() => defineEslint({ unusedImports: true, rules: { [name]: 'off' } }))
	}
})

test('unused-imports reports each unused binding once and accepts underscore locals', () => {
	const messages = new Linter().verify(`import unused from 'unused'; const missing = 1; const _intentional = 2;`, config, { filename: 'app.ts' })
	assert.deepEqual(messages.map((message) => message.ruleId).sort(), ['unused-imports/no-unused-imports', 'unused-imports/no-unused-vars'])
	assert.deepEqual(new Linter().verify(`const run = (_input) => 1; export {run};`, config, { filename: 'app.js' }), [])
	assert.equal(fix(`import unused from 'unused';`, 'app.js', defineEslint({ typescript: false, meeko: false, unusedImports: true })), '')
})

test('template-only, component-only, type-only and generic-constraint imports survive cleanup', () => {
	const source = `<script lang="ts" generic="T extends Entity">
import type {Entity} from './types.js';
import Card from './Card.meeko';
import {format, unused} from './format.js';
import type {User} from './user.js';
const props = defineProps<{user:User; item:T}>();
</script><template><Card>{format(props.user.name)}{props.item}</Card></template>`
	const output = fix(source)
	assert.match(output, /import Card from/)
	assert.match(output, /import type \{Entity\}/)
	assert.match(output, /import type \{User\}/)
	assert.match(output, /import \{format\}/)
	assert.doesNotMatch(output, /unused/)
	assert.equal(output.match(/<\/script>/g).length, 1)
	assert.equal(output.slice(output.indexOf('<template>')), source.slice(source.indexOf('<template>')))
})

test('removing a sole/final import never consumes script or template delimiters', () => {
	for (const source of [
		`<script lang="ts">import unused from 'unused';</script><template>{1}</template>`,
		`<script lang="ts">\r\nimport unused from 'unused';\r\n</script>\r\n<template>{1}</template>`,
		`<script lang="ts">import {used} from 'used'; import unused from 'unused';</script><template>{used}</template>`,
		`<script server lang="ts">import unused from 'unused';</script><template>{1}</template>`,
		`<script server lang="ts">import {used} from 'used'; import unused from 'unused'; export const data = used();</script><template>{data}</template>`,
	]) {
		const output = fix(source)
		assert.doesNotMatch(output, /from 'unused'/)
		assert.match(output, /<\/script>/)
		assert.equal(output.slice(output.indexOf('<template>')), source.slice(source.indexOf('<template>')))
	}
})

test('server and component imports stay in their own sections in either source order', () => {
	const app = `<script lang="ts">import Z from 'z'; import A from 'a';</script>`
	const server = `<script server lang="ts">import Z from 'server-z'; import A from 'server-a'; export const data = [Z,A];</script>`
	const template = `<template>{A}{Z}{data}</template>`
	for (const source of [app + server + template, server + app + template]) {
		const output = fix(source)
		assert.match(output, /<script lang="ts">import A from 'a'; import Z from 'z';<\/script>/)
		assert.match(output, /<script server lang="ts">import A from 'server-a'; import Z from 'server-z'; export const data = \[Z,A\];<\/script>/)
		assert.equal(output.indexOf('<script server'), source.indexOf('<script server'))
		assert.equal(output.slice(output.indexOf('<template>')), template)
	}
})

test('inline unused imports between adjacent sections preserve all tags and the next import', () => {
	const source = `<script lang="ts">import unused from 'unused';</script><script server lang="ts">import {load} from 'server'; export const data = load();</script><template>{data}</template>`
	assert.equal(fix(source), source.replace(`import unused from 'unused';`, ''))
})

test('natural ascending ordering reaches imports, objects and sets in a component script, but not plain arrays', () => {
	const source = `<script lang="ts">
import {z, a} from './item10.js';
import Item2 from './item2.js';
const value = {z,a};
const list = new Set([10,2]);
const array = [10,2];
</script><template>{value}{list}{array}<Item2 /></template>`
	const output = fix(source)
	assert.ok(output.indexOf("from './item2.js'") < output.indexOf("from './item10.js'"))
	assert.match(output, /import \{a, z\}/)
	assert.match(output, /const value = \{a,z\}/)
	assert.match(output, /new Set\(\[2,10\]\)/)
	assert.match(output, /const array = \[10,2\]/)
})

test('bare side-effect imports keep their order and remain in the source', () => {
	const source = `<script lang="ts">import Z from 'z'; import 'side-z'; import 'side-a'; import A from 'a';</script><template>{Z}{A}</template>`
	const output = fix(source)
	assert.ok(output.indexOf("import 'side-z'") < output.indexOf("import 'side-a'"))
	assert.match(output, /import A from 'a'/)
	assert.match(output, /import Z from 'z'/)
	assert.equal((output.match(/import 'side-/g) ?? []).length, 2)
})

test('import comments survive sorting and removing the final unused import', () => {
	const source = `<script lang="ts">
// Comment for Z
import Z from 'z';
// Comment for A
import A from 'a';
import unused from 'unused'; // keep trailing explanation
</script><template>{A}{Z}</template>`
	const output = fix(source)
	for (const comment of ['Comment for Z', 'Comment for A', 'keep trailing explanation']) assert.ok(output.includes(comment))
	assert.match(output, /<\/script><template>/)
})

test('unused import option types track the reproducible public TS no-unused-vars schema', () => {
	for (const name of ['no-unused-imports', 'no-unused-vars']) assert.deepEqual(unusedImports.rules[name].meta.schema, typescript.rules['no-unused-vars'].meta.schema)
	assert.deepEqual(
		Object.keys(perfectionist.rules).sort(),
		[
			'sort-array-includes',
			'sort-arrays',
			'sort-classes',
			'sort-constructor-parameters',
			'sort-decorators',
			'sort-enums',
			'sort-export-attributes',
			'sort-exports',
			'sort-heritage-clauses',
			'sort-import-attributes',
			'sort-imports',
			'sort-interfaces',
			'sort-intersection-types',
			'sort-jsx-props',
			'sort-maps',
			'sort-modules',
			'sort-named-exports',
			'sort-named-imports',
			'sort-object-types',
			'sort-objects',
			'sort-sets',
			'sort-switch-case',
			'sort-union-types',
			'sort-variable-declarations',
		].sort(),
	)
})

test('Perfectionist defaults warn and autofix imports in natural ascending order', () => {
	const source = "import { item10, item2 } from './item10';\nimport item from './item2';\nexport { item, item2, item10 };"
	const selected = defineEslint()
	const preset = selected.find(({ name }) => name === 'meeko/perfectionist')
	assert.deepEqual(preset.settings.perfectionist, { type: 'natural', order: 'asc' })
	for (const filename of ['app.js', 'app.ts', 'App.meeko']) {
		const wrap = (code) => (filename.endsWith('.meeko') ? `<script server lang="ts">${code}</script><template></template>` : code)
		const diagnostics = new Linter().verify(wrap(source), selected, { filename })
		assert.deepEqual(diagnostics.map(({ ruleId, severity }) => [ruleId, severity]).sort(), [
			['perfectionist/sort-imports', 1],
			['perfectionist/sort-named-imports', 1],
		])
		const output = fix(wrap(source), filename, selected)
		assert.ok(output.indexOf("from './item2'") < output.indexOf("from './item10'"))
		assert.match(output, /import \{ item2, item10 \}/)
		assert.deepEqual(new Linter().verify(wrap(source), defineEslint({ perfectionist: false }), { filename }), [])
		for (const overrides of [
			defineEslint({ rules: { 'perfectionist/sort-imports': 'error', 'perfectionist/sort-named-imports': 'error' } }),
			defineEslint({}, { rules: { 'perfectionist/sort-imports': 'error', 'perfectionist/sort-named-imports': 'error' } }),
		]) {
			const errors = new Linter().verify(wrap(source), overrides, { filename })
			assert.equal(errors.length, 2)
			assert.ok(errors.every(({ severity }) => severity === 2))
		}
	}
	assert.equal(
		defineEslint({ perfectionist: false }).some(({ plugins }) => plugins?.perfectionist),
		false,
	)
})

const presetRules = Object.keys(perfectionist.configs['recommended-natural'].rules).sort()
const presetOf = (selected) => selected.find(({ name }) => name === 'meeko/perfectionist').rules

/** One breach of each preset rule that has syntax in a script; sort-jsx-props needs JSX. */
const everyRule = `import { zed2, alpha2 } from './m'
import zImport from './z'
import aImport from './a'
import data from './d.json' with { type: 'json', alpha: 'x' }
export { data2 } from './d.json' with { type: 'json', alpha: 'x' }
export { zExp } from './z'
export { aExp } from './a'
export { zed2, alpha2 }
let zz = 1, aa = 2
type I = Zed & Abc
type U = 'z' | 'a'
type O = { z: 1; a: 2 }
interface F { z: 1; a: 2 }
class H implements Zed, Abc {}
@zDec @aDec class D {}
class C { z = 1; a = 2 }
enum E { Z = 'z', A = 'a' }
function zfn() {}
function afn() {}
const inc = ['z', 'a'].includes(aa)
const obj = { z: 1, a: 2 }
const set = new Set(['z', 'a'])
const map = new Map([['z', 1], ['a', 2]])
function sw(x) { switch (x) { case 'z': return 1; case 'a': return 2 } }
`
const fired = (source, filename, selected = defineEslint()) => {
	const messages = new Linter().verify(source, selected, { filename })
	assert.deepEqual(
		messages.filter(({ fatal }) => fatal),
		[],
	)
	return [...new Set(messages.filter(({ ruleId }) => ruleId?.startsWith('perfectionist/')).map(({ ruleId }) => ruleId))].sort()
}

test('perfectionist activates the whole published natural preset at warn level, and false activates nothing', () => {
	for (const selected of [defineEslint(), defineEslint({ perfectionist: true })]) {
		const rules = presetOf(selected)
		assert.deepEqual(Object.keys(rules).sort(), presetRules)
		for (const [name, entry] of Object.entries(rules)) {
			assert.equal(entry[0], 'warn', name)
			assert.equal(entry[1].type, 'natural', name)
			assert.equal(entry[1].order, 'asc', name)
		}
		assert.equal(rules['perfectionist/sort-imports'][1].sortSideEffects, false)
		assert.equal(rules['perfectionist/sort-imports'][1].useExperimentalDependencyDetection, false)
	}
	assert.ok(presetRules.includes('perfectionist/sort-objects'))
	assert.deepEqual(fired(everyRule, 'app.ts', defineEslint({ perfectionist: false })), [])
	assert.deepEqual(fired(`<script lang="ts">\n${everyRule}</script><template>{1}</template>`, 'App.meeko', defineEslint({ perfectionist: false })), [])
})

test('every preset rule reports in TypeScript and in the script of a component', () => {
	const scriptRules = presetRules.filter((name) => name !== 'perfectionist/sort-jsx-props')
	assert.deepEqual(fired(everyRule, 'app.ts'), scriptRules)
	assert.deepEqual(fired(`<script lang="ts">\n${everyRule}</script>\n<template>{1}</template>`, 'App.meeko'), scriptRules)
	assert.deepEqual(fired('export const view = <Item z="1" a="2" />', 'app.tsx'), ['perfectionist/sort-jsx-props'])
})

test('a server block sorts what stays in its scope; its modules and exports do not report', () => {
	const unsupported = new Set(['perfectionist/sort-export-attributes', 'perfectionist/sort-exports', 'perfectionist/sort-jsx-props', 'perfectionist/sort-modules', 'perfectionist/sort-named-exports'])
	const server = everyRule.replace(/^export \{ .* from .*\n/gm, '')
	assert.deepEqual(
		fired(`<script server lang="ts">\n${server}</script>\n<template>{1}</template>`, 'App.meeko'),
		presetRules.filter((name) => !unsupported.has(name)),
	)
})

test('options.rules and overrides turn one rule off or replace its options, and a comment exempts one object', () => {
	const source = 'export const value = { z: 1, a: 2 }\nexport const list = new Set([2, 1])\n'
	const left = ['perfectionist/sort-sets']
	assert.deepEqual(fired(source, 'app.ts', defineEslint({ rules: { 'perfectionist/sort-objects': 'off' } })), left)
	assert.deepEqual(fired(source, 'app.ts', defineEslint({}, { files: ['**/*.ts'], rules: { 'perfectionist/sort-objects': 'off' } })), left)
	const descending = defineEslint({ rules: { 'perfectionist/sort-objects': ['warn', { type: 'natural', order: 'desc' }] } })
	assert.deepEqual(fired('export const value = { a: 1, z: 2 }', 'app.ts', descending), ['perfectionist/sort-objects'])
	assert.deepEqual(fired('export const value = { z: 1, a: 2 }', 'app.ts', descending), [])
	const strict = new Linter().verify(source, defineEslint({ rules: { 'perfectionist/sort-objects': 'error' } }), { filename: 'app.ts' })
	assert.equal(strict.find(({ ruleId }) => ruleId === 'perfectionist/sort-objects').severity, 2)
	const exempted = `<script lang="ts">\n// eslint-disable-next-line perfectionist/sort-objects\nconst value = { z: 1, a: 2 }\n</script>\n<template>{value}</template>`
	assert.deepEqual(fired(exempted, 'App.meeko'), [])
})

test('the rules outside the preset stay off and inherit the natural order when they are enabled', () => {
	const rules = presetOf(defineEslint())
	assert.equal(rules['perfectionist/sort-arrays'], undefined)
	assert.equal(rules['perfectionist/sort-constructor-parameters'], undefined)
	const source = 'export class Item { constructor(item10, item2) { this.value = [item10, item2] } }\n'
	assert.deepEqual(fired(source, 'app.ts'), [])
	// Perfectionist requires useConfigurationIf for these two, which is why they are outside its preset.
	assert.throws(() => fired(source, 'app.ts', defineEslint({ rules: { 'perfectionist/sort-constructor-parameters': 'warn' } })), /fewer than 1 items/)
	const enabled = defineEslint({ rules: { 'perfectionist/sort-constructor-parameters': ['warn', { useConfigurationIf: { allNamesMatchPattern: '^item' } }] } })
	assert.deepEqual(fired(source, 'app.ts', enabled), ['perfectionist/sort-constructor-parameters'])
	assert.match(new Linter().verifyAndFix(source, enabled, { filename: 'app.ts' }).output, /constructor\(item2, item10\)/)
})

test('fixing a component keeps its sections, comments and line endings, compiles and settles at once', () => {
	const source = `<script server lang="ts">
const loaded = { z: 1, a: 2 }
export const data = loaded
</script>
<script lang="ts">
interface Props { z?: string; a?: string }
const props = defineProps<Props>()
const options = {
	// Explains z
	z: 1,
	// Explains a
	a: 2,
}
function zed() { return options.z }
function alpha() { return zed() }
</script>
<template>
	<div bind:title="JSON.stringify({ z: 'a&amp;b', a: 1 })">{props.a}{alpha()}{JSON.stringify({ z: data, a: 2 })}</div>
</template>
`
	const selected = defineEslint()
	for (const text of [source, source.replaceAll('\n', '\r\n')]) {
		const result = new Linter().verifyAndFix(text, selected, { filename: 'App.meeko' })
		assert.deepEqual(result.messages, [])
		const { output } = result
		assert.equal(new Linter().verifyAndFix(output, selected, { filename: 'App.meeko' }).fixed, false)
		assert.equal(output.match(/<\/script>/g).length, 2)
		assert.ok(output.indexOf('<script server') < output.indexOf('<script lang'))
		assert.match(output, /const loaded = \{ a: 2, z: 1 \}/)
		assert.match(output, /interface Props \{ a\?: string; z\?: string/)
		assert.ok(output.indexOf('function alpha') < output.indexOf('function zed'))
		assert.ok(output.indexOf('// Explains a') < output.indexOf('// Explains z'))
		assert.match(output, /\{ a: 1, z: 'a&amp;b' \}/)
		assert.match(output, /\{ a: 2, z: data \}/)
		if (text !== source) assert.doesNotMatch(output, /[^\r]\n/)
		assert.ok(compile(output, 'App.meeko').code.length)
	}
})

test('sorting respects direct dependencies, fallthrough, implicit enums and spread boundaries', () => {
	for (const source of [
		'class Item { z = 1; a = this.z + 1 }\nexport { Item }\n',
		'enum Level { Z, A }\nexport { Level }\n',
		'export const merged = (base) => ({ z: 1, ...base, a: 2 })\n',
		"export const pick = (x) => { switch (true) { case x > 5: return 'big'; case x > 1: return 'mid'; default: return 'small' } }\n",
		"export const order = (v) => { let r = ''; switch (v) { case 'z': r += 'z'; break; default: r += 'd'; case 'a': r += 'a'; break } return r }\n",
	]) {
		assert.equal(new Linter().verifyAndFix(source, defineEslint(), { filename: 'app.ts' }).output, source)
	}
})

test('a fix follows the sort order even where the order is observable, which is why it needs a review', () => {
	const output = (source) => new Linter().verifyAndFix(source, defineEslint(), { filename: 'app.ts' }).output
	assert.match(output('export const keys = Object.keys({ z: 1, a: 2 })\n'), /\{ a: 2, z: 1 \}/)
	assert.match(output("export const routes = new Map([['/z/x', 1], ['/a', 2], ['/z', 3]])\n"), /\['\/a', 2\], \['\/z', 3\], \['\/z\/x', 1\]/)
	assert.match(output('export class Item { z = 1; a = this.calc(); calc() { return this.z + 1 } }\n'), /a = this\.calc\(\); z = 1/)
	const modules = output('class Z { static make() { return 1 } }\nfunction getZ() { return Z }\nclass A { static v = getZ().make() }\nexport const value = A.v\n')
	assert.ok(modules.indexOf('class A') < modules.indexOf('class Z'))
})
