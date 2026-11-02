import type { MarkupContent } from 'vscode-languageserver/node'

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import type { LanguageProject } from './language-server-workspace.ts'

import { MeekoCompileError } from '../src/compiler/parser/sfc.ts'
import { componentDiagnostics } from '../src/language-server/diagnostics.ts'
import { completion, hover } from '../src/language-server/features.ts'
import { languageProject } from './language-server-workspace.ts'

const page = (body: string): string => `<script lang="ts">
import { signal } from "@meekojs/meeko";
const value = signal("a");
const label = signal("Alfa");
const options = signal([{ id: "a", name: "Alfa" }]);
function run(event: CommandEvent): void { console.log(event.command); }
</script>
<template>${body}</template>
`

const rich = `<select model="value"><button type="button"><selectedcontent></selectedcontent></button><option each:of="options.value" each:as="row" each:key="row.id" bind:value="row.id"><svg viewBox="0 0 10 10"><circle r="4" /></svg><span class="name" on:click="(event) => event.currentTarget.focus()">{row.name}</span></option><option value="b"><span bind:title="label.value">{label.value}</span></option></select>`

describe('language server: <select> with rich content', () => {
	let workspace: LanguageProject

	before(async () => {
		workspace = await languageProject('lsp-select-', { 'Page.meeko': page(rich) })
	})

	after(async () => {
		await workspace?.dispose()
	})

	/** The MEEK diagnostics of a template, with the text each one marks. */
	const diagnostics = async (name: string, body: string): Promise<string[]> => {
		const context = await workspace.open(name, page(body))
		const found = await componentDiagnostics(workspace.project, context.document, workspace.file(name), context.locate)
		return found.filter((item) => String(item.code).startsWith('MEEK')).map((item) => `${String(item.code)} ${context.document.getText(item.range)}`)
	}

	test('reports nothing on the rich select, and the checks inside it still work', async () => {
		assert.deepEqual(await diagnostics('Valid.meeko', rich), [])
		const errors = await workspace.open('Typed.meeko', page(rich.replace('{row.name}', '{row.missing}')))
		const found = await componentDiagnostics(workspace.project, errors.document, workspace.file('Typed.meeko'), errors.locate)
		assert.deepEqual(
			found.map((item) => errors.document.getText(item.range)).filter((text) => text.includes('missing')),
			['missing'],
		)
	})

	/** The error that stops the component while it is being edited, as the server reports it. */
	const stopped = (name: string, body: string): string | undefined => {
		const filename = workspace.file(name)
		const component = workspace.project.setDocument(filename, page(body))
		if (component) return undefined
		const error = workspace.project.componentError(filename) as MeekoCompileError
		assert.ok(error instanceof MeekoCompileError, String(error))
		return error.diagnostic.code
	}

	test('reports what the browser would take out of the select', () => {
		assert.equal(stopped('Input.meeko', `<select><input name="q"><option>A</option></select>`), 'MEEK008')
		const error = workspace.project.componentError(workspace.file('Input.meeko')) as MeekoCompileError
		assert.match(error.message, /<input> no puede ir dentro de <select>/)
	})

	test('a half-written tag inside the select stops the component as inside any other element', () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			[`<select><button`, `<div><button`],
			[`<select><option><span`, `<div><option><span`],
			[`<select><button type="button"><selectedcontent></button></select>`, `<div><button type="button"><section></button></div>`],
			[`<select><option><span>A</option></select>`, `<div><option><span>A</option></div>`],
		]
		for (const [inSelect, inDiv] of cases) assert.equal(stopped('Editing.meeko', inSelect), stopped('EditingDiv.meeko', inDiv), inSelect)
	})

	test('completes expressions, attributes and events of the elements inside the select', async () => {
		const expression = await workspace.open('Complete.meeko', page(rich.replace('bind:title="label.value"', 'bind:title="lab"')))
		const names = (completion(expression, expression.at('lab"', 3)) ?? []).map((item) => item.label)
		assert.ok(names.includes('label'), names.slice(0, 40).join(','))
		const row = await workspace.open('Row.meeko', page(rich.replace('{row.name}', '{row.na}')))
		const fields = (completion(row, row.at('row.na}', 6)) ?? []).map((item) => item.label)
		assert.ok(fields.includes('name'), fields.join(','))
	})

	test('hover types the elements inside the select, and on:command as a CommandEvent', async () => {
		const context = await workspace.open('Hover.meeko', page(rich))
		const target = (hover(context, context.at('currentTarget.focus', 3))?.contents as MarkupContent).value
		assert.match(target, /HTMLSpanElement/)
		const command = await workspace.open('Command.meeko', page(`<dialog on:command="(event) => console.log(event.command)"></dialog>`))
		const event = (hover(command, command.at('(event) =>', 3))?.contents as MarkupContent).value
		assert.match(event, /CommandEvent/)
		assert.doesNotMatch(event, /__Meeko/)
		assert.deepEqual(await diagnostics('CommandValid.meeko', `<dialog on:command="run" on:cancel="(event) => event.preventDefault()"></dialog><div on:command="(event: CommandEvent) => run(event)"></div>`), [])
	})
})
