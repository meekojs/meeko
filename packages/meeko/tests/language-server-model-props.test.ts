import type { CompletionItem, MarkupContent } from 'vscode-languageserver/node'

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { LanguageProject } from './language-server-workspace.ts'

import { componentDiagnostics } from '../src/language-server/diagnostics.ts'
import { completion, componentTagMembers, directiveNameCompletion, hover } from '../src/language-server/features.ts'
import { languageProject } from './language-server-workspace.ts'

const input = `<script lang="ts">
const value = defineModel<string>({ default: "" });
const touched = defineModel<boolean>("touched", { default: false });
const props = defineProps<{ placeholder?: string }>();
</script>
<template><input model="value" bind:placeholder="props.placeholder" /><b>{touched.value}</b></template>
`

const required = `<script lang="ts">
const value = defineModel<string>();
</script>
<template><input model="value" /></template>
`

const parentOf = (template: string, script = ''): string => `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as AppInput from "./AppInput.meeko";
import * as AppRequired from "./AppRequired.meeko";
const name = signal("");
const flag = signal(false);
${script}
</script>
<template>${template}</template>
`

const files = {
	'AppInput.meeko': input,
	'AppRequired.meeko': required,
	'Empty.meeko': parentOf(`<AppInput  />`),
	'BindPrefix.meeko': parentOf(`<AppInput bind: />`),
	'OnPrefix.meeko': parentOf(`<AppInput on: />`),
	'BySignal.meeko': parentOf(`<AppInput model="name"  />`),
	'ByProp.meeko': parentOf(`<AppInput bind:modelValue="name.value"  />`),
	'Full.meeko': parentOf(`<AppInput bind:modelValue="name.value" on:update:modelValue="(next) => (name.value = next)" bind:touched="flag.value" on:update:touched="(next) => (flag.value = next)" />`),
	'Wrong.meeko': parentOf(`<AppInput bind:modelValue="1" />`),
	'WrongHandler.meeko': parentOf(`<AppInput on:update:modelValue="(next: number) => next" />`),
	'RequiredFine.meeko': parentOf(`<AppRequired bind:modelValue="name.value" /><AppRequired model="name" />`),
	'RequiredMissing.meeko': parentOf(`<AppRequired on:update:modelValue="() => {}" />`),
	'Unknown.meeko': parentOf(`<AppInput on:update:nope="() => {}" />`),
	'AppEvents.meeko': `<script lang="ts">
const value = defineModel<string>({ default: "" });
const emit = defineEmits<{ save: [] }>();
const props = defineProps<{ title?: string; onlyOnce?: boolean }>();
</script>
<template><button on:click="() => emit('save')">{props.title}{value.value}</button></template>
`,
	'SpreadObject.meeko': `<script lang="ts">
import * as AppEvents from "./AppEvents.meeko";
</script>
<template><AppEvents bind="{  }" /></template>
`,
	'SpreadHandler.meeko': `<script lang="ts">
import * as AppEvents from "./AppEvents.meeko";
</script>
<template><AppEvents bind="{ onSave: () => {} }" /></template>
`,
}

describe('language server: a model by prop and event', () => {
	let workspace: LanguageProject

	before(async () => {
		workspace = await languageProject('lsp-model-props-', files)
	})

	after(async () => {
		await workspace?.dispose()
	})

	/** What the server offers: the directives and the members that the tag check declares. */
	const offered = async (file: string, at: string, shift: number): Promise<CompletionItem[]> => {
		const context = await workspace.open(file)
		const position = context.at(at, shift)
		return directiveNameCompletion(context.document, position, new Set(), componentTagMembers(context, position)) ?? []
	}
	const labels = async (file: string, at: string, shift: number): Promise<string[]> => (await offered(file, at, shift)).map((item) => item.label)

	test('the tag offers both forms of each model, with their types', async () => {
		const items = await offered('Empty.meeko', '<AppInput  />', '<AppInput '.length)
		const detail = (label: string): string | undefined => items.find((item) => item.label === label)?.detail
		assert.equal(detail('model'), 'model?: Signal<string>')
		assert.equal(detail('bind:modelValue'), 'modelValue?: string')
		assert.equal(detail('on:update:modelValue'), 'on:update:modelValue(next: string)')
		assert.equal(detail('model:touched'), 'model:touched?: Signal<boolean>')
		assert.equal(detail('bind:touched'), 'touched?: boolean')
		assert.equal(detail('on:update:touched'), 'on:update:touched(next: boolean)')
		// The internal name of the unnamed model is no API.
		assert.deepEqual(
			items.filter((item) => /default|onUpdate/.test(item.label)).map((item) => item.label),
			[],
		)
		// Once, not also as a prop and an event.
		assert.equal(items.filter((item) => item.label === 'bind:modelValue').length, 1)
		assert.equal(items.filter((item) => item.label === 'on:update:modelValue').length, 1)
	})

	test('after bind: and on:, only that channel', async () => {
		const bind = await labels('BindPrefix.meeko', '<AppInput bind:', '<AppInput bind:'.length)
		assert.ok(bind.includes('bind:modelValue') && bind.includes('bind:touched') && bind.includes('bind:placeholder'), bind.join())
		assert.ok(!bind.includes('model') && !bind.includes('on:update:modelValue'), bind.join())
		const on = await labels('OnPrefix.meeko', '<AppInput on:', '<AppInput on:'.length)
		assert.ok(on.includes('on:update:modelValue') && on.includes('on:update:touched'), on.join())
		assert.ok(!on.includes('bind:modelValue'), on.join())
	})

	test('the form already written leaves out the other one, as MEEK066 asks', async () => {
		const bySignal = await labels('BySignal.meeko', '<AppInput model="name"  />', '<AppInput model="name" '.length)
		assert.ok(!bySignal.includes('bind:modelValue') && !bySignal.includes('on:update:modelValue') && !bySignal.includes('model'), bySignal.join())
		assert.ok(bySignal.includes('bind:touched'), bySignal.join())
		const byProp = await labels('ByProp.meeko', '<AppInput bind:modelValue="name.value"  />', '<AppInput bind:modelValue="name.value" '.length)
		assert.ok(!byProp.includes('model') && !byProp.includes('bind:modelValue'), byProp.join())
		assert.ok(byProp.includes('on:update:modelValue') && byProp.includes('model:touched'), byProp.join())
	})

	test('a hover on bind:modelValue, bind:touched and on:update:modelValue shows its type', async () => {
		const context = await workspace.open('Full.meeko')
		const shown = (at: string, shift: number): string => (hover(context, context.at(at, shift))?.contents as MarkupContent | undefined)?.value ?? ''
		assert.match(shown('bind:modelValue', 'bind:'.length + 1), /modelValue\?: string/)
		assert.match(shown('bind:touched', 'bind:'.length + 1), /touched\?: boolean/)
		assert.match(shown('on:update:modelValue', 'on:update:'.length + 1), /\(next: string\) => void/)
		assert.match(shown('on:update:touched', 'on:update:'.length + 1), /\(next: boolean\) => void/)
		// The parameter of an inline handler has the type of the model.
		assert.match(shown('(next) => (name.value', 1), /next: string/)
		assert.match(shown('(next) => (flag.value', 1), /next: boolean/)
	})

	test('inside bind="{ }" the props are offered, not the keys that bind rejects', async () => {
		const context = await workspace.open('SpreadObject.meeko')
		const offered = completion(context, context.at('bind="{  }"', 'bind="{ '.length))?.map((item) => item.label) ?? []
		assert.ok(offered.includes('title') && offered.includes('modelValue'), offered.join())
		assert.deepEqual(
			offered.filter((label) => /^["']?on/i.test(label)),
			[],
		)
	})

	test('a handler written in bind="{ }" gives one error, MEEK113', async () => {
		const context = await workspace.open('SpreadHandler.meeko')
		const found = await componentDiagnostics(workspace.project, context.document, workspace.file('SpreadHandler.meeko'), () => undefined)
		assert.deepEqual(
			found.map((diagnostic) => diagnostic.code).filter((code) => code !== 'TS2591'),
			['MEEK113'],
		)
	})

	test('the editor names how to pass a required model', async () => {
		const context = await workspace.open('RequiredMissing.meeko')
		const found = await componentDiagnostics(workspace.project, context.document, workspace.file('RequiredMissing.meeko'), () => undefined)
		const missing = found.find((diagnostic) => diagnostic.code === 'TS2741')
		const message = typeof missing?.message === 'string' ? missing.message : ''
		assert.match(message, /model="señal" o bind:modelValue="valor"/)
		assert.doesNotMatch(message, /default/)
	})

	test('the editor agrees with meeko check', async () => {
		const codes = async (file: string): Promise<Array<string | number | undefined>> => {
			const context = await workspace.open(file)
			const found = await componentDiagnostics(workspace.project, context.document, workspace.file(file), () => undefined)
			// TS2591: this temporary project has no `@types/node` for the sources of the package itself.
			return found.map((diagnostic) => diagnostic.code).filter((code) => code !== 'TS2591')
		}
		assert.deepEqual(await codes('Full.meeko'), [])
		assert.deepEqual(await codes('RequiredFine.meeko'), [])
		assert.ok((await codes('Wrong.meeko')).includes('TS2322'))
		assert.ok((await codes('WrongHandler.meeko')).includes('TS2322'))
		assert.ok((await codes('RequiredMissing.meeko')).includes('TS2741'))
		assert.ok((await codes('Unknown.meeko')).includes('TS2353'))
	})
})
