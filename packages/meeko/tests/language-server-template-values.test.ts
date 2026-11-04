import type { CodeAction, CompletionItem, CompletionList, Diagnostic, Hover, MarkupContent, Position, ProtocolConnection, Range } from 'vscode-languageserver/node'

import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { after, before, describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { CodeActionRequest, CompletionItemTag, CompletionRequest, createConnection, createProtocolConnection, DidChangeTextDocumentNotification, DidOpenTextDocumentNotification, HoverRequest, InitializedNotification, InitializeRequest, InsertTextFormat, ShutdownRequest, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node'

import { doubleBracesMessage } from '../src/compiler/double-braces.ts'
import { startLanguageServer } from '../src/language-server/server.ts'
import { createTempProject, linkRepositoryPackages } from './helpers/temp-project.ts'

const card = `<script lang="ts">
const props = defineProps<{ title: string; open?: boolean; variant?: "primary" | "secondary" }>();
const emit = defineEmits<{ save: [id: number] }>();
const opened = defineModel<boolean>("open");
const snippets = defineSnippets<{ default: []; icon?: [size: number] }>();
</script>
<template><div>{props.title}<render snippet="snippets.default" /></div></template>
`

/** A component whose template is `body`; `^` marks the cursor. */
function page(body: string): string {
	return `<script lang="ts">
import { computed, signal } from "@meekojs/meeko";
import * as Card from "./Card.meeko";
const props = defineProps<{ title: string; open: boolean; items: Array<{ id: number; name: string }> }>();
const snippets = defineSnippets<{ default: []; icon?: [size: number]; [key: \`cell-\${string}\`]: [value: string] }>();
const name = signal("");
const checked = signal(false);
const total = computed(() => 1);
const rows = signal([1, 2, 3]);
const panel = useElementRef("panel");
const other = useElementRef("other");
function onClick(event: MouseEvent) {}
function onSubmit(event: SubmitEvent) {}
function reset() {}
</script>
<template>${body}</template>
`
}

/** A component without refs, whose only diagnostics are those of `body`. */
function plain(body: string): string {
	return `<script lang="ts">
const props = defineProps<{ title: string }>();
</script>
<template>${body}</template>
`
}

interface Offered {
	readonly label: string
	readonly newText: string | undefined
	readonly replaces: string | undefined
	readonly detail: string | undefined
	readonly sortText: string
	readonly format: InsertTextFormat | undefined
	/** The template after applying the item's `textEdit`, without its snippet placeholders. */
	readonly applied: string | undefined
}

/** The template of `text` after replacing `range` with `newText`, without snippet placeholders. */
function applyEdit(text: string, edit: { readonly range: Range; readonly newText: string }): string {
	const lines = text.split('\n')
	const at = (position: Position): number => lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0) + position.character
	const result = `${text.slice(0, at(edit.range.start))}${edit.newText.replace(/\$\d/g, '')}${text.slice(at(edit.range.end))}`
	return result.slice(result.indexOf('<template>') + '<template>'.length, result.lastIndexOf('</template>'))
}

describe('language server: completion from the script, by directive', () => {
	let root: string
	let client: ProtocolConnection
	let dispose: () => void
	let count = 0
	const published = new Map<string, Diagnostic[][]>()

	async function open(text: string): Promise<string> {
		const file = join(root, `Case${count++}.meeko`)
		await writeFile(file, text)
		const uri = pathToFileURL(file).href
		await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: 'meeko', version: 1, text } })
		return uri
	}

	/** The completion at `^` of `page(body)`, sorted as the editor sorts it. */
	async function complete(body: string): Promise<Offered[]> {
		const marked = page(body)
		const offset = marked.indexOf('^')
		const text = marked.replace('^', '')
		const uri = await open(text)
		const before = text.slice(0, offset)
		const position = { line: before.split('\n').length - 1, character: offset - before.lastIndexOf('\n') - 1 }
		const result = await client.sendRequest(CompletionRequest.type, { textDocument: { uri }, position })
		const items: CompletionItem[] = (Array.isArray(result) ? result : (result as CompletionList | null)?.items) ?? []
		const lines = text.split('\n')
		return items
			.map((item): Offered => {
				const edit = item.textEdit && 'range' in item.textEdit ? item.textEdit : undefined
				const replaces = edit && edit.range.start.line === edit.range.end.line ? lines[edit.range.start.line]!.slice(edit.range.start.character, edit.range.end.character) : undefined
				return { label: item.label, newText: edit?.newText ?? item.insertText, replaces, detail: item.detail, sortText: item.sortText ?? item.label, format: item.insertTextFormat, applied: edit && applyEdit(text, edit) }
			})
			.sort((a, b) => a.sortText.localeCompare(b.sortText))
	}

	const labels = (items: readonly Offered[], count: number): string[] => items.slice(0, count).map((item) => item.label)
	const find = (items: readonly Offered[], label: string): Offered => {
		const found = items.find((item) => item.label === label)
		assert.ok(found, `${label} missing: ${JSON.stringify(labels(items, 40))}`)
		return found
	}
	const ordered = (items: readonly Offered[], first: string, second: string): void => {
		const all = items.map((item) => item.label)
		assert.ok(all.indexOf(first) >= 0 && all.indexOf(first) < all.indexOf(second), `${first} before ${second}: ${JSON.stringify(labels(items, 40))}`)
	}

	before(async () => {
		;({ root } = await createTempProject('lsp-template-values-'))
		await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
		await linkRepositoryPackages(root)
		await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], types: [], strict: true, noEmit: true, skipLibCheck: true, allowArbitraryExtensions: true } }))
		await writeFile(join(root, 'Card.meeko'), card)
		const toServer = new PassThrough()
		const toClient = new PassThrough()
		const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient))
		startLanguageServer(server)
		server.listen()
		client = createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer))
		client.onNotification('window/logMessage', () => undefined)
		client.onNotification('textDocument/publishDiagnostics', ({ uri, diagnostics }: { uri: string; diagnostics: Diagnostic[] }) => {
			published.set(uri, [...(published.get(uri) ?? []), diagnostics])
		})
		client.onRequest('client/registerCapability', () => undefined)
		client.listen()
		dispose = () => server.dispose()
		await client.sendRequest(InitializeRequest.type, {
			processId: null,
			rootUri: pathToFileURL(root).href,
			workspaceFolders: [{ uri: pathToFileURL(root).href, name: 'fixture' }],
			capabilities: { textDocument: { completion: { completionItem: { snippetSupport: true } } } },
			initializationOptions: { diagnosticsDelay: 0, trusted: false, projectContracts: false },
		})
		await client.sendNotification(InitializedNotification.type, {})
	})

	after(async () => {
		await client.sendRequest(ShutdownRequest.type)
		client.dispose()
		dispose()
		await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
	})

	test('bind: offers every attribute of the element, with its type, after the generic bind: and bind', async () => {
		const button = await complete('<button bind^ ></button>')
		// The directives first, then each attribute with bind:, the element's own ones before the global ones.
		assert.equal(find(button, 'bind:').newText, 'bind:')
		assert.equal(find(button, 'bind').newText, 'bind="$1"')
		const type = find(button, 'bind:type')
		assert.deepEqual([type.newText, type.replaces, type.format, type.detail], ['bind:type="$1"', 'bind', InsertTextFormat.Snippet, "bind:type: 'submit' | 'reset' | 'button'"])
		assert.equal(find(button, 'bind:disabled').detail, 'bind:disabled: boolean')
		ordered(button, 'bind:', 'bind:type')
		ordered(button, 'bind:type', 'bind:class')
		ordered(button, 'bind:class', 'bind:aria-label')
		for (const label of ['bind:id', 'bind:style', 'bind:aria-label', 'bind:data-']) find(button, label)
		// After bind:, with bind: written: the range covers it all.
		const anchor = await complete('<a bind:hr^ ></a>')
		assert.deepEqual([find(anchor, 'bind:href').newText, find(anchor, 'bind:href').replaces], ['bind:href="$1"', 'bind:hr'])
		assert.equal(
			anchor.some((item) => item.label === 'bind:type'),
			false,
			'<a> has no type',
		)
		const input = await complete('<input bind:^ />')
		assert.equal(find(input, 'bind:checked').detail, 'bind:checked: boolean')
		assert.equal(find(input, 'bind:type').replaces, 'bind:')
		// A component: its props, with bind: also the text ones.
		const component = await complete('<Card bind^ />')
		assert.equal(find(component, 'bind:title').newText, 'bind:title="$1"')
		assert.equal(find(component, 'bind:title').detail, 'title: string')
		ordered(component, 'title', 'bind:title')
	})

	test("Meeko's HTML data: recent attributes, static values, roles and deprecated entries", async () => {
		const dialog = await complete('<dialog bind:^ ></dialog>')
		assert.equal(find(dialog, 'bind:closedby').detail, "bind:closedby: 'any' | 'closerequest' | 'none'")
		// Deprecated attributes are marked, as the editor strikes them through.
		const offered = async (body: string): Promise<CompletionItem[]> => {
			const marked = page(body)
			const offset = marked.indexOf('^')
			const text = marked.replace('^', '')
			const uri = await open(text)
			const before = text.slice(0, offset)
			const result = await client.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: { line: before.split('\n').length - 1, character: offset - before.lastIndexOf('\n') - 1 } })
			return (Array.isArray(result) ? result : (result as CompletionList | null)?.items) ?? []
		}
		const grabbed = (await offered('<div bind:^ ></div>')).find((item) => item.label === 'bind:aria-grabbed')
		assert.deepEqual(grabbed?.tags, [CompletionItemTag.Deprecated])
		// Static values inside the quotes: the attribute's values, the token being written in a list.
		assert.deepEqual(labels(await complete('<button type="^"></button>'), 3), ['submit', 'reset', 'button'])
		assert.deepEqual(labels(await complete('<div aria-pressed="^"></div>'), 3), ['false', 'mixed', 'true'])
		const roles = await complete('<div role="button al^"></div>')
		assert.equal(find(roles, 'alert').replaces, 'al')
		assert.deepEqual((await offered('<div role="^"></div>')).find((item) => item.label === 'directory')?.tags, [CompletionItemTag.Deprecated])
		// `true` writes the empty value of `hidden`: booleans fit, with its keywords.
		const hidden = await complete('<div bind:hidden="^"></div>')
		assert.deepEqual(labels(hidden, 3), ["'until-found'", "'hidden'", 'checked.value'])
	})

	test('ref: offers the names of useElementRef, those without a tag first', async () => {
		const items = await complete('<div ref:panel></div><p ref:^></p>')
		assert.deepEqual(labels(items, 2), ['ref:other', 'ref:panel'])
		assert.deepEqual([find(items, 'ref:other').newText, find(items, 'ref:other').replaces], ['ref:other', 'ref:'])
	})

	test('on: offers the handlers whose signature fits the event first', async () => {
		const click = await complete('<div on:click="^"></div>')
		assert.deepEqual(labels(click, 2), ['onClick', 'reset'])
		const submit = await complete('<form on:submit="on^"></form>')
		assert.equal(submit[0]!.label, 'onSubmit')
		assert.equal(find(submit, 'onSubmit').replaces, 'on')
		// A component's event: (id: number) => …; a MouseEvent handler does not fit.
		ordered(await complete('<Card on:save="^" />'), 'reset', 'onClick')
	})

	test('model offers the writable signals of the control or model type', async () => {
		assert.equal((await complete('<input model="^" />'))[0]!.label, 'name')
		assert.deepEqual(labels(await complete('<input type="checkbox" model="^" />'), 1), ['checked'])
		const model = await complete('<Card model:open="^" />')
		assert.equal(model[0]!.label, 'checked')
		// A computed is not writable.
		ordered(model, 'checked', 'total')
	})

	test('bind:attr="…" offers the enumerated values and the declarations of its type', async () => {
		const type = await complete('<button bind:type="^"></button>')
		assert.deepEqual(labels(type, 3), ["'submit'", "'reset'", "'button'"])
		assert.equal(find(type, "'submit'").newText, "'submit'")
		const disabled = await complete('<button bind:disabled="^"></button>')
		assert.deepEqual(labels(disabled, 2), ['checked.value', 'props.open'])
		const title = await complete('<Card bind:title="^" />')
		ordered(title, 'props.title', 'checked')
		ordered(title, 'name.value', 'checked')
	})

	test('if:when, each:of and each:key offer conditions, lists and fields', async () => {
		const condition = await complete('<div if:when="^"></div>')
		assert.deepEqual(labels(condition, 2), ['checked.value', 'props.open'])
		ordered(condition, 'props.open', 'snippets.icon')
		const list = await complete('<p each:of="^" each:as="item"></p>')
		assert.deepEqual(labels(list, 2), ['props.items', 'rows.value'])
		const key = await complete('<p each:of="props.items" each:as="item" each:key="^"></p>')
		ordered(key, 'item.id', 'props.title')
		assert.equal(find(key, 'item.id').detail, 'item.id: number')
		assert.equal(
			key.some((item) => item.label === 'panel' && /^0[01]/.test(item.sortText)),
			false,
			'a ref without a tag is never',
		)
	})

	test('render snippet offers the declared snippets, the dynamic ones with the cursor in the name', async () => {
		const items = await complete('<render snippet="^" />')
		assert.deepEqual(labels(items, 3), ['snippets.default', 'snippets.icon', "snippets['cell-']"])
		const dynamic = find(items, "snippets['cell-']")
		assert.deepEqual([dynamic.newText, dynamic.format], ["snippets['cell-$1']", InsertTextFormat.Snippet])
		// The child's snippets in <snippet name>.
		const names = await complete('<Card><snippet name="^"></snippet></Card>')
		for (const label of ['default', 'icon']) find(names, label)
	})

	test('an interpolation offers the declarations of the script before the imports and globals', async () => {
		const items = await complete('<p>{^}</p>')
		ordered(items, 'name', 'computed')
		ordered(items, 'props', 'Math')
		const typed = await complete('<p>{na^}</p>')
		assert.equal(find(typed, 'name').replaces, 'na')
	})

	test('typing bind:class leaves no stale diagnostic, and each step says what it needs', async () => {
		const prefix = plain('<div\n    ').replace('</template>\n', '')
		const suffix = '\n  ></div></template>\n'
		const uri = await open(`${prefix}${suffix}`)
		const line = prefix.split('\n').length - 1
		const character = prefix.length - prefix.lastIndexOf('\n') - 1
		let written = ''
		let version = 1
		const settle = async (): Promise<Diagnostic[]> => {
			const seen = published.get(uri)?.length ?? 0
			for (let wait = 0; wait < 200 && (published.get(uri)?.length ?? 0) <= seen; wait++) await new Promise((resolve) => setTimeout(resolve, 25))
			return published.get(uri)!.at(-1)!
		}
		const type = async (text: string): Promise<Diagnostic[]> => {
			await client.sendNotification(DidChangeTextDocumentNotification.type, {
				textDocument: { uri, version: ++version },
				contentChanges: [{ range: { start: { line, character: character + written.length }, end: { line, character: character + written.length } }, text }],
			})
			written += text
			return settle()
		}
		const bare = await type('bind')
		assert.deepEqual(
			bare.map((item) => item.code),
			['MEEK113'],
		)
		assert.match(bare[0]!.message as string, /bind:atributo/)
		assert.deepEqual([bare[0]!.range.start.character, bare[0]!.range.end.character], [character, character + 4])
		const colon = await type(':')
		assert.deepEqual(
			colon.map((item) => item.code),
			['MEEK012'],
		)
		// At `bind:`, not at the tag.
		assert.deepEqual([colon[0]!.range.start.line, colon[0]!.range.start.character, colon[0]!.range.end.character], [line, character, character + 5])
		const named = await type('class')
		assert.match(named[0]!.message as string, /bind:class necesita un valor/)
		assert.deepEqual(await type('="props.title"'), [])
	})

	test('{{ expr }} says that Meeko interpolates with one brace, and fixes it', async () => {
		const settle = async (uri: string): Promise<Diagnostic[]> => {
			for (let wait = 0; wait < 200 && !published.get(uri)?.length; wait++) await new Promise((resolve) => setTimeout(resolve, 25))
			return published.get(uri)!.at(-1)!
		}
		const text = plain('<p>{{ props.title }}</p><p>{ {props.title} }</p><p>{{hola mundo}}</p>')
		const uri = await open(text)
		const [diagnostic] = await settle(uri)
		assert.equal(diagnostic?.code, 'MEEK020')
		assert.equal(diagnostic?.message, doubleBracesMessage)
		// Both pairs of braces.
		const start = text.indexOf('{{ props.title }}')
		const line = text.slice(0, start).split('\n').length - 1
		const column = start - text.lastIndexOf('\n', start) - 1
		assert.deepEqual(diagnostic?.range, { start: { line, character: column }, end: { line, character: column + '{{ props.title }}'.length } })
		const actions = (await client.sendRequest(CodeActionRequest.type, { textDocument: { uri }, range: diagnostic!.range, context: { diagnostics: [diagnostic!] } })) as CodeAction[]
		const edits = (title: string): string[] => {
			const action = actions.find((candidate) => candidate.title === title)
			assert.ok(action, `${title}: ${JSON.stringify(actions.map((candidate) => candidate.title))}`)
			return action.edit!.changes![uri]!.map((edit) => edit.newText)
		}
		assert.deepEqual(edits('Convertir a {props.title}'), ['{props.title}'])
		assert.equal(actions.find((candidate) => candidate.title === 'Convertir a {props.title}')?.isPreferred, true)
		assert.deepEqual(edits('Mostrar las llaves como texto'), ['{"{ props.title }"}'])
		// Every one of the file: plain text inside the braces stays as text.
		assert.deepEqual(edits('Corregir todas las del archivo'), ['{props.title}', '{props.title}', '{"{hola mundo}"}'])
		// A valid object literal compiles without a warning.
		assert.deepEqual(await settle(await open(plain('<p>{{ a: 1 }}</p>'))), [])
	})

	test('a static value of a component prop offers its literal union (the icon names of <UIIcon name="…">)', async () => {
		const offered = await complete(`<Card title="x" variant="pr^" />`)
		assert.ok(
			offered.some((item) => item.label === 'primary'),
			JSON.stringify(offered.map((item) => item.label)),
		)
		assert.equal(find(offered, 'primary').applied, `<Card title="x" variant="primary" />`)
		assert.equal(find(await complete(`<Card title="x" variant="^" />`), 'secondary').applied, `<Card title="x" variant="secondary" />`)
	})

	test('inside a string, the values insert only their text, with the range of the string', async () => {
		// A literal union of a prop: TypeScript's items, never another pair of quotes.
		const partial = await complete(`<Card title="x" bind:variant="'pr^'" />`)
		assert.deepEqual(labels(partial, 2), ['primary', 'secondary'])
		assert.equal(find(partial, 'primary').applied, `<Card title="x" bind:variant="'primary'" />`)
		for (const item of partial) assert.doesNotMatch(item.applied ?? '', /''/, item.label)
		assert.equal(find(await complete(`<Card title="x" bind:variant="'^'" />`), 'secondary').applied, `<Card title="x" bind:variant="'secondary'" />`)
		assert.equal(find(await complete(`<Card title="x" bind:variant="'pr^im'" />`), 'primary').applied, `<Card title="x" bind:variant="'primary'" />`)
		assert.equal(find(await complete(`<Card title="x" bind:variant='"se^"' />`), 'secondary').applied, `<Card title="x" bind:variant='"secondary"' />`)
		// An HTML attribute's values, also where TypeScript has none: only the text.
		const type = await complete(`<button bind:type="'su^'"></button>`)
		assert.equal(type[0]!.label, 'submit')
		assert.equal(find(type, 'submit').applied, `<button bind:type="'submit'"></button>`)
		assert.equal(
			type.some((item) => item.label.startsWith("'")),
			false,
		)
		assert.equal(find(await complete(`<button bind:type="'re^se'"></button>`), 'reset').applied, `<button bind:type="'reset'"></button>`)
		assert.equal(find(await complete(`<button bind:type='"^"'></button>`), 'button').applied, `<button bind:type='"button"'></button>`)
		// In an expression, a whole literal with its quotes.
		assert.equal(find(await complete('<button bind:type="^"></button>'), "'submit'").applied, `<button bind:type="'submit'"></button>`)
	})

	test('a member path replaces the whole identifier and the members already written after it', async () => {
		const middle = await complete('<button bind:disabled="ch^ecked"></button>')
		assert.equal(find(middle, 'checked.value').applied, '<button bind:disabled="checked.value"></button>')
		assert.equal(find(middle, 'checked').applied, '<button bind:disabled="checked"></button>')
		assert.equal(find(await complete('<button bind:disabled="checked^.value"></button>'), 'checked.value').applied, '<button bind:disabled="checked.value"></button>')
		assert.equal(find(await complete('<button bind:disabled="ch^ecked.value"></button>'), 'checked.value').applied, '<button bind:disabled="checked.value"></button>')
		assert.equal(find(await complete('<div if:when="pro^ps.open"></div>'), 'props.open').applied, '<div if:when="props.open"></div>')
	})

	test('the attribute being edited is offered, and replaced whole keeping its value', async () => {
		const cases: Array<[string, string]> = [
			['<button bind:ty^pe="checked"></button>', 'bind:type'],
			['<Card title="x" var^iant="primary" />', 'variant'],
			['<Card title="x" bind:var^iant="name.value" />', 'bind:variant'],
			['<Card bind:ti^tle="name.value" />', 'bind:title'],
			['<Card title="x" on:sa^ve="reset" />', 'on:save'],
			['<Card title="x" model:op^en="checked" />', 'model:open'],
			['<button on:cl^ick="reset"></button>', 'on:click'],
			['<render snip^pet="snippets.default" />', 'snippet'],
			['<Card title="x"><snippet na^me="icon"></snippet></Card>', 'name'],
		]
		for (const [body, label] of cases) {
			const item = find(await complete(body), label)
			assert.equal(item.applied, body.replace('^', ''), body)
		}
		// Another attribute with that name is still a duplicate.
		assert.equal(
			(await complete('<button bind:type="checked" bind:ty^ ></button>')).some((item) => item.label === 'bind:type'),
			false,
		)
	})

	test("static attribute names come from Meeko's HTML data, with MDN's documentation", async () => {
		const raw = async (body: string): Promise<CompletionItem[]> => {
			const marked = page(body)
			const offset = marked.indexOf('^')
			const text = marked.replace('^', '')
			const uri = await open(text)
			const before = text.slice(0, offset)
			const result = await client.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: { line: before.split('\n').length - 1, character: offset - before.lastIndexOf('\n') - 1 } })
			return (Array.isArray(result) ? result : (result as CompletionList | null)?.items) ?? []
		}
		const value = (item: CompletionItem | undefined): string => (typeof item?.documentation === 'string' ? item.documentation : (item?.documentation?.value ?? ''))
		const dialog = await raw('<dialog clo^></dialog>')
		const closedby = dialog.find((item) => item.label === 'closedby')
		assert.ok(closedby, JSON.stringify(dialog.map((item) => item.label)))
		assert.match(value(closedby), /\[Especificación\]\(https:\/\/html\.spec\.whatwg\.org\//)
		const context = (await raw('<div context^></div>')).find((item) => item.label === 'contextmenu')
		assert.deepEqual(context?.tags, [CompletionItemTag.Deprecated])
		assert.match(value(context), /Obsoleto/)
		// The compiler's table: no `type` on <a> (a MIME hint there), and never an `on*` handler.
		const anchor = await raw('<a ty^></a>')
		assert.equal(
			anchor.some((item) => item.label === 'type'),
			false,
		)
		assert.match(value(anchor.find((item) => item.label === 'href')), /developer\.mozilla\.org/)
		const div = await raw('<div ar^></div>')
		for (const label of ['aria-pressed', 'aria-label', 'role', 'class'])
			assert.ok(
				div.some((item) => item.label === label),
				label,
			)
		assert.equal(
			div.some((item) => /^on[a-z]/.test(item.label)),
			false,
		)
		// A boolean attribute without a value; one with values opens them.
		const button = await raw('<button di^></button>')
		const disabled = button.find((item) => item.label === 'disabled')
		assert.equal(disabled?.textEdit?.newText, 'disabled')
		assert.equal(button.find((item) => item.label === 'type')?.command?.command, 'editor.action.triggerSuggest')
		// The hover of a static attribute reads the same data.
		const text = page('<dialog closedby="any"></dialog>')
		const uri = await open(text)
		const at = text.indexOf('closedby') + 2
		const before = text.slice(0, at)
		const hover = (await client.sendRequest(HoverRequest.type, { textDocument: { uri }, position: { line: before.split('\n').length - 1, character: at - before.lastIndexOf('\n') - 1 } })) as Hover | null
		assert.match((hover?.contents as MarkupContent | undefined)?.value ?? '', /Especificación/)
	})

	test('fixing every {{ }} of the file leaves the valid objects alone', async () => {
		const settle = async (uri: string): Promise<Diagnostic[]> => {
			for (let wait = 0; wait < 200 && !published.get(uri)?.length; wait++) await new Promise((resolve) => setTimeout(resolve, 25))
			return published.get(uri)!.at(-1)!
		}
		const text = plain('<p>{{ props.title }}</p><p>{{ props, b: 2 }}</p><p>{{ ...props, c: 1 }}</p><p>{{ f() { return 1 }, props }}</p><p>{{hola mundo}}</p>')
		const uri = await open(text)
		const [diagnostic] = await settle(uri)
		assert.equal(diagnostic?.code, 'MEEK020')
		const actions = (await client.sendRequest(CodeActionRequest.type, { textDocument: { uri }, range: diagnostic!.range, context: { diagnostics: [diagnostic!] } })) as CodeAction[]
		const all = actions.find((candidate) => candidate.title === 'Corregir todas las del archivo')
		assert.ok(all, JSON.stringify(actions.map((candidate) => candidate.title)))
		// Applied from the last one, so the earlier ranges stay valid.
		let fixed = text
		for (const edit of [...all.edit!.changes![uri]!].reverse()) fixed = `${fixed.slice(0, fixed.indexOf('<template>') + '<template>'.length)}${applyEdit(fixed, edit)}</template>\n`
		assert.equal(applyEdit(fixed, { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: '' }), '<p>{props.title}</p><p>{{ props, b: 2 }}</p><p>{{ ...props, c: 1 }}</p><p>{{ f() { return 1 }, props }}</p><p>{"{hola mundo}"}</p>')
		// The objects alone compile without a warning.
		assert.deepEqual(await settle(await open(plain('<p>{{ props, b: 2 }}</p><p>{{ ...props, c: 1 }}</p>'))), [])
	})

	test('bind="obj" with an object compiles, and bind="text" keeps its error', async () => {
		const settle = async (uri: string): Promise<Diagnostic[]> => {
			for (let wait = 0; wait < 200 && !published.get(uri)?.length; wait++) await new Promise((resolve) => setTimeout(resolve, 25))
			return published.get(uri)!.at(-1)!
		}
		assert.deepEqual(await settle(await open(plain('<div bind="{ id: props.title }" bind:class="props.title"></div>'))), [])
		// A value that is no object: TypeScript's error at the value.
		const text = await settle(await open(plain('<div bind="props.title"></div>')))
		assert.deepEqual(
			text.map((item) => item.code),
			['TS2345'],
		)
		assert.match(text[0]!.message as string, /not assignable to parameter of type 'object'/)
		// No value at all: the object is missing.
		const empty = await settle(await open(plain('<div bind=""></div>')))
		assert.deepEqual(
			empty.map((item) => item.code),
			['MEEK113'],
		)
		assert.match(empty[0]!.message as string, /bind necesita un objeto/)
	})
})
