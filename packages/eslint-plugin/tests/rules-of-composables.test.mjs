import * as typescriptParser from '@typescript-eslint/parser'
import { Linter, RuleTester } from 'eslint'
import assert from 'node:assert/strict'
import test from 'node:test'

import plugin, { defineEslint } from '../dist/index.js'
import meekoParser from '../dist/parser.js'

const rule = plugin.rules['rules-of-composables']
const tester = new RuleTester({ languageOptions: { parser: typescriptParser } })
const component = (script, template = '<p>Hola</p>') => `<script lang="ts">${script}</script><template>${template}</template>`
const invalid = (code, messageId = 'context') => ({ code, errors: [{ messageId }] })

tester.run('rules-of-composables', rule, {
	valid: [
		'function useCustom() { const value = useAnything(); return value; }',
		'const useCustom = () => useAnything();',
		'export function useCustom() { return { first: useFirst(), second: useSecond() }; }',
		'async function useCustom() { const result = await useApi(); return result; }',
		'const tools = { useCustom() { return useAnything(); } };',
		'function ordinary() { return createId(); }',
		'function useCustom() { if (!ready) throw new Error(); return useAnything(); }',
		'const items = [1,2].map(() => createId());',
		'function ordinary() { return useful(); }',
		'function ordinary() { return api[useKey](); }',
		{ code: component('const id = useAnything();'), languageOptions: { parser: meekoParser } },
		{ code: component('function useCustom() { return useAnything(); } const value = useCustom();'), languageOptions: { parser: meekoParser } },
		{ code: '<script server lang="ts">const value = await useApi();</script>' + component('const id = useId();'), languageOptions: { parser: meekoParser } },
	],
	invalid: [
		invalid('const value = useAnything();'),
		invalid('function ordinary() { return useAnything(); }'),
		invalid('const handler = () => useAnything();'),
		invalid('function useCustom() { return () => useAnything(); }'),
		invalid('function useCustom() { items.map(() => useAnything()); }'),
		invalid('function useCustom() { register(function useFake() { return useAnything(); }); }'),
		invalid('function useCustom() { if (ready) useAnything(); }', 'conditional'),
		invalid('function useCustom() { return ready ? useAnything() : null; }', 'conditional'),
		invalid('function useCustom() { return ready && useAnything(); }', 'conditional'),
		invalid('function useCustom() { for (const item of items) useAnything(); }', 'conditional'),
		invalid('function useCustom() { try { useAnything(); } catch {} }', 'conditional'),
		invalid('async function useCustom() { await work(); return useAnything(); }', 'late'),
		invalid('async function useCustom() { return useAnything(await work()); }', 'late'),
		invalid('function useCustom() { if (ready) return null; return useAnything(); }', 'late'),
		invalid('function useCustom(value = useAnything()) {}'),
		invalid('function* useCustom() { return useAnything(); }'),
		invalid('import { useAnything as read } from "hooks"; function handler() { read(); }'),
		invalid('import { useAnything as read } from "hooks"; const alias=read; function handler() { alias(); }'),
		invalid('const {useAnything: read}=hooks; function handler() { read(); }'),
		invalid('function ordinary() { return hooks.useAnything(); }'),
		invalid('function ordinary() { return hooks["useAnything"](); }'),
		invalid('function useCustom() { return useAnything?.(); }', 'conditional'),
		{ ...invalid(component('function createItem() { return useId(); }')), languageOptions: { parser: meekoParser } },
		{ ...invalid(component('', '<button on:click="useAnything()">Abrir</button>')), languageOptions: { parser: meekoParser } },
		{ ...invalid(component('', '<p>{useAnything()}</p>')), languageOptions: { parser: meekoParser } },
		{ ...invalid(component('if (ready) useAnything();'), 'conditional'), languageOptions: { parser: meekoParser } },
		{ ...invalid(component('const result=await useApi();const next=useAnything();'), 'late'), languageOptions: { parser: meekoParser } },
	],
})

test('the global rule applies to JS, TS, Meeko and consumers that disable Meeko files', () => {
	const source = 'export function handler() { useCustom(); }'
	for (const filename of ['test.js', 'test.ts']) {
		const messages = new Linter().verify(source, defineEslint(), { filename })
		assert.ok(messages.some((message) => message.ruleId === 'meeko/rules-of-composables' && message.severity === 2))
	}
	const config = defineEslint({ meeko: false, rules: { 'meeko/rules-of-composables': 'off' } })
	assert.ok(!new Linter().verify(source, config, { filename: 'test.ts' }).some((message) => message.ruleId === 'meeko/rules-of-composables'))
	const messages = new Linter().verify(component('function handler() { useCustom(); }'), plugin.configs.recommended, { filename: 'Test.meeko' })
	assert.ok(messages.some((message) => message.ruleId === 'meeko/rules-of-composables'))
})
