import { Linter } from 'eslint'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { defineEslint } from '../dist/index.js'
import { typeScriptRuleSchemaHash } from '../dist/typescript-rules.generated.js'
import { generatedTypes, schemaHash } from '../scripts/generate-rule-types.mjs'

const messages = (source, filename, config = defineEslint()) => new Linter().verify(source, config, { filename })

test('defineEslint enables JS, syntax-only TS and Meeko defaults with separate scopes', () => {
	assert.ok(messages('const unused = 1;', 'app.js').some((message) => message.ruleId === 'no-unused-vars'))
	assert.ok(messages('const unused: number = 1;', 'app.ts').some((message) => message.ruleId === '@typescript-eslint/no-unused-vars'))
	assert.ok(messages('<template><button>Save</button></template>', 'App.meeko').some((message) => message.ruleId === 'meeko/button-has-type'))
	assert.ok(messages('<script lang="ts">debugger;</script><template></template>', 'App.meeko').some((message) => message.ruleId === 'no-debugger'))
	assert.deepEqual(messages('<script lang="ts">const title = "Hi";</script><template>{title}</template>', 'App.meeko'), [])
})

test('prefer-ui-components is off for consumers until a project turns it on, because using UI is a choice', () => {
	const source = '<template><table></table></template>'
	const rule = 'meeko/prefer-ui-components'
	assert.ok(!messages(source, 'App.meeko').some((message) => message.ruleId === rule))
	assert.ok(messages(source, 'App.meeko', defineEslint({ rules: { [rule]: 'error' } })).some((message) => message.ruleId === rule))
})

test('rule namespaces are applied only to languages with registered plugins', () => {
	const config = defineEslint({ rules: { 'meeko/button-has-type': 'error', '@typescript-eslint/no-explicit-any': 'off', 'no-debugger': 'off' } })
	assert.deepEqual(messages('debugger;', 'app.js', config), [])
	assert.deepEqual(messages('const value: any = 1; export {value};', 'app.ts', config), [])
	assert.equal(messages('<template><button>Save</button></template>', 'App.meeko', config)[0].severity, 2)
	assert.deepEqual(messages('<script lang="ts">debugger;</script><template></template>', 'App.meeko', config), [])
})

test('options disable independent language presets and reject invalid namespace combinations', () => {
	const meekoOnly = defineEslint({ javascript: false, typescript: false, rules: { '@typescript-eslint/no-unused-vars': 'error' } })
	assert.deepEqual(messages('<template><p>Hi</p></template>', 'App.meeko', meekoOnly), [])
	const jsOnly = defineEslint({ typescript: false, meeko: false })
	assert.ok(messages('const unused = 1;', 'app.js', jsOnly).some((message) => message.ruleId === 'no-unused-vars'))
	assert.throws(() => defineEslint({ javascript: false, typescript: false, meeko: false }), /at least one/)
	assert.throws(() => defineEslint({ meeko: false, rules: { 'meeko/button-has-type': 'off' } }), /requires meeko/)
	assert.throws(() => defineEslint({ typescript: false, meeko: false, rules: { '@typescript-eslint/no-unused-vars': 'off' } }), /requires typescript or meeko/)
	assert.throws(() => defineEslint({ javascript: 'yes' }), /boolean/)
	assert.throws(() => defineEslint({ ignores: 'dist' }), /array of strings/)
	assert.throws(() => defineEslint({ rules: { 'meeko/unknown': 'error' } }), /unknown rule/)
	assert.throws(() => defineEslint({ rules: { 'other/rule': 'error' } }), /additional plugins in an override/)
	assert.throws(() => defineEslint({ rules: { '@typescript-eslint/no-floating-promises': 'error' } }), /requires type information/)
	assert.doesNotThrow(() => defineEslint({ rules: { '@typescript-eslint/no-floating-promises': 'off' } }))
	assert.doesNotThrow(() => defineEslint({ rules: { '@typescript-eslint/no-floating-promises': [0] } }))
})

test('default and additional ignores are global, and trailing overrides win', () => {
	const config = defineEslint({ ignores: ['**/custom/**'], rules: { 'no-debugger': 'error' } }, { files: ['**/*.js'], rules: { 'no-debugger': 'off' } })
	for (const path of ['node_modules/a.js', 'dist/a.js', '.meeko/a.js', 'custom/a.js']) {
		assert.ok(messages('debugger;', path, config).every((message) => message.ruleId === null))
	}
	assert.deepEqual(messages('debugger;', 'app.js', config), [])
	assert.ok(Array.isArray(config))
	assert.equal(config.at(-1).rules['no-debugger'], 'off')
})

test('generated TypeScript rule options match the pinned public schemas', async () => {
	assert.equal(typeScriptRuleSchemaHash, schemaHash)
	assert.equal(await readFile(new URL('../src/typescript-rules.generated.ts', import.meta.url), 'utf8'), generatedTypes())
})

test('consumer type checks known rule options and rejects typos and invalid tuples', () => {
	const tsc = fileURLToPath(new URL('../bin/tsc6', import.meta.resolve('typescript')))
	execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./types/consumer.ts', import.meta.url))], { stdio: 'pipe' })
})

test('component style rules are opt-in and scoped to Meeko files', () => {
	const source = '<script lang="ts">defineEmits<{save: []}>(); defineProps<{title: string}>();</script><template><p bind:title="\'Hello\'"></p></template>'
	assert.deepEqual(messages(source, 'App.meeko'), [])
	const config = defineEslint({
		rules: {
			'meeko/order-macros': 'error',
			'meeko/order-sections': ['error', { order: ['server', 'script', 'template', 'style'] }],
			'meeko/prefer-static-bindings': 'warn',
		},
	})
	const diagnostics = messages(source, 'App.meeko', config)
	assert.ok(diagnostics.some(({ ruleId }) => ruleId === 'meeko/order-macros'))
	assert.ok(diagnostics.some(({ ruleId, severity }) => ruleId === 'meeko/prefer-static-bindings' && severity === 1))
	assert.deepEqual(messages('export const value = 1;', 'app.ts', config), [])
	assert.deepEqual(messages('export const value = 1;', 'app.js', config), [])
	assert.throws(() => defineEslint({ meeko: false, rules: { 'meeko/order-macros': 'error' } }), /requires meeko/)
})

test('type import fixes compose with import sorting and removal in both scripts', () => {
	const source = `<script server lang="ts">import { URL } from 'node:url'; export const base: URL | undefined = undefined;</script>
<script lang="ts">import { URL } from 'node:url'; const url: URL | undefined = undefined;</script><template>{url}</template>`
	const config = defineEslint({
		perfectionist: true,
		unusedImports: true,
		rules: {
			'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
		},
	})
	const linter = new Linter()
	const fixed = linter.verifyAndFix(source, config, { filename: 'App.meeko' })
	assert.deepEqual(fixed.messages, [])
	assert.equal((fixed.output.match(/import type/g) ?? []).length, 2)
	assert.match(fixed.output, /<\/script>\s*<script lang="ts">/)
	assert.equal(linter.verifyAndFix(fixed.output, config, { filename: 'App.meeko' }).fixed, false)
})

test('type import fixes never merge same-source imports across server and component scripts', () => {
	const config = defineEslint({
		perfectionist: true,
		unusedImports: true,
		rules: {
			'@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'separate-type-imports' }],
		},
	})
	const server = `<script server lang="ts">import type { URL } from 'node:url'; export const base: URL | undefined = undefined;</script>`
	const client = `<script lang="ts">import { URL, URLSearchParams } from 'node:url'; const url: URL | undefined = undefined; const query = new URLSearchParams();</script>`
	for (const [first, second] of [
		[server, client],
		[client, server],
	]) {
		const linter = new Linter()
		const fixed = linter.verifyAndFix(first + second + '<template>{url}{query}</template>', config, { filename: 'App.meeko' })
		assert.deepEqual(fixed.messages, [])
		const scripts = [...fixed.output.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
		assert.equal(scripts.length, 2)
		for (const script of scripts) assert.equal((script[1].match(/import type\s*\{\s*URL\s*\}/g) ?? []).length, 1)
		assert.equal(linter.verifyAndFix(fixed.output, config, { filename: 'App.meeko' }).fixed, false)
	}
})

test('type import consistency preserves template component values and generic type references', () => {
	const config = defineEslint({
		perfectionist: true,
		unusedImports: true,
		rules: {
			'@typescript-eslint/consistent-type-imports': 'error',
		},
	})
	const source = `<script lang="ts" generic="T extends User">import Card from './Card.meeko'; import { User } from './types'; const props = defineProps<{ user: T }>();</script><template><Card bind:user="props.user" /></template>`
	const linter = new Linter()
	const fixed = linter.verifyAndFix(source, config, { filename: 'App.meeko' })
	assert.deepEqual(fixed.messages, [])
	assert.match(fixed.output, /import Card from/)
	assert.match(fixed.output, /import type\s*\{\s*User\s*\}/)
	assert.equal(linter.verifyAndFix(fixed.output, config, { filename: 'App.meeko' }).fixed, false)
})
