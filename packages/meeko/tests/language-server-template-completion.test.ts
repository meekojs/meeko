import type { CompletionItem, CompletionList, ProtocolConnection } from 'vscode-languageserver/node'

import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { after, before, describe, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { CompletionRequest, CompletionTriggerKind, createConnection, createProtocolConnection, DidOpenTextDocumentNotification, InitializedNotification, InitializeRequest, InsertTextFormat, ShutdownRequest, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node'

import { startLanguageServer } from '../src/language-server/server.ts'
import { createTempProject, linkRepositoryPackages } from './helpers/temp-project.ts'

const card = `<script lang="ts">
interface Item { id: number; name: string }
const props = defineProps<{
  /** El elemento que muestra. */
  item: Item;
  title: string;
  variant?: "primary" | "secondary";
  label?: string | number;
  disabled?: boolean;
  onSelect?: (id: number) => void;
}>();
const emit = defineEmits<{ save: [id: number] }>();
const value = defineModel<string>();
const open = defineModel<boolean>("open");
const snippets = defineSnippets<{ default: []; icon?: [size: number] }>();
</script>
<template><div>{props.title}{props.item.name}<render snippet="snippets.default" /></div></template>
`

/** A parent whose template is `body`; `|` marks the cursor. */
function parent(body: string): string {
	return `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Card from "./Card.meeko";
const name = signal("");
const items = signal([{ id: 1, name: "a" }]);
</script>
<template>${body}</template>
`
}

interface Inserted {
	readonly label: string
	readonly newText: string | undefined
	readonly format: InsertTextFormat | undefined
	/** Source text that the insertion replaces. */
	readonly replaces: string | undefined
}

describe('language server: what template completion inserts', () => {
	let root: string
	let client: ProtocolConnection
	let dispose: () => void
	let count = 0

	/** The completion at `|` of `parent(body)`, through the server's whole chain. */
	async function complete(body: string, triggerCharacter?: string): Promise<{ items: CompletionItem[]; inserted: Inserted[] }> {
		const marked = parent(body)
		const offset = marked.indexOf('|')
		const text = marked.replace('|', '')
		const file = join(root, `Case${count++}.meeko`)
		await writeFile(file, text)
		const uri = pathToFileURL(file).href
		await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: 'meeko', version: 1, text } })
		const before = text.slice(0, offset)
		const position = { line: before.split('\n').length - 1, character: offset - before.lastIndexOf('\n') - 1 }
		const result = await client.sendRequest(CompletionRequest.type, {
			textDocument: { uri },
			position,
			...(triggerCharacter ? { context: { triggerKind: CompletionTriggerKind.TriggerCharacter, triggerCharacter } } : {}),
		})
		const items = (Array.isArray(result) ? result : (result as CompletionList | null)?.items) ?? []
		const lines = text.split('\n')
		const inserted = items.map((item): Inserted => {
			const edit = item.textEdit && 'range' in item.textEdit ? item.textEdit : undefined
			const replaces = edit && edit.range.start.line === edit.range.end.line ? lines[edit.range.start.line]!.slice(edit.range.start.character, edit.range.end.character) : undefined
			return { label: item.label, newText: edit?.newText ?? item.insertText, format: item.insertTextFormat, replaces }
		})
		// Never JSX: Meeko has no `prop={expr}`.
		for (const item of inserted) assert.doesNotMatch(item.newText ?? '', /=\{/, `${item.label} inserts JSX`)
		return { items, inserted }
	}

	const find = (inserted: readonly Inserted[], label: string): Inserted => {
		const found = inserted.find((item) => item.label === label)
		assert.ok(found, `${label} missing: ${JSON.stringify(inserted.map((item) => item.label))}`)
		return found
	}

	before(async () => {
		;({ root } = await createTempProject('lsp-template-completion-'))
		await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}\n')
		await linkRepositoryPackages(root)
		const files: Record<string, string> = {
			'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], types: [], strict: true, noEmit: true, skipLibCheck: true, allowArbitraryExtensions: true } }),
			'Card.meeko': card,
		}
		for (const [name, content] of Object.entries(files)) {
			await mkdir(dirname(join(root, name)), { recursive: true })
			await writeFile(join(root, name), content)
		}
		const toServer = new PassThrough()
		const toClient = new PassThrough()
		const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient))
		startLanguageServer(server)
		server.listen()
		client = createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer))
		client.onNotification('window/logMessage', () => undefined)
		client.onNotification('textDocument/publishDiagnostics', () => undefined)
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

	test('a component tag offers its props as text or with bind:, as their types admit, before the directives', async () => {
		const { items, inserted } = await complete('<Card it| />')
		// A text prop as text; a prop of another type with bind:; one that admits text, both.
		assert.deepEqual(find(inserted, 'title'), { label: 'title', newText: 'title="$1"', format: InsertTextFormat.Snippet, replaces: 'it' })
		assert.deepEqual(find(inserted, 'bind:item'), { label: 'bind:item', newText: 'bind:item="$1"', format: InsertTextFormat.Snippet, replaces: 'it' })
		assert.equal(
			inserted.some((item) => item.label === 'item'),
			false,
			'item is not text',
		)
		assert.equal(find(inserted, 'label').newText, 'label="$1"')
		assert.equal(find(inserted, 'bind:label').newText, 'bind:label="$1"')
		// A boolean bare (it passes `true`) or with bind:.
		assert.equal(find(inserted, 'disabled').newText, 'disabled')
		assert.equal(find(inserted, 'bind:disabled').newText, 'bind:disabled="$1"')
		// A literal union opens its values inside the quotes.
		const variant = items.find((item) => item.label === 'variant')!
		assert.equal(variant.command?.command, 'editor.action.triggerSuggest')
		// The type and the JSDoc, and the required props first, then the directives.
		const item = items.find((entry) => entry.label === 'bind:item')!
		assert.equal(item.detail, 'item: Item')
		assert.match((item.documentation as { value: string }).value, /El elemento que muestra\./)
		const sorted = [...items].sort((a, b) => (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label)).map((entry) => entry.label)
		assert.deepEqual(sorted.slice(0, 2), ['bind:item', 'title'])
		assert.ok(sorted.indexOf('variant') < sorted.indexOf('if:when'), JSON.stringify(sorted))
	})

	test('a component tag offers its events and models with their value', async () => {
		const { inserted } = await complete('<Card | />')
		// `defineEmits` and the callback props are events; `onSelect` is not a prop of the tag.
		assert.equal(find(inserted, 'on:save').newText, 'on:save="$1"')
		assert.equal(find(inserted, 'on:select').newText, 'on:select="$1"')
		assert.equal(
			inserted.some((item) => /onSelect/.test(item.label)),
			false,
		)
		assert.equal(find(inserted, 'model').newText, 'model="$1"')
		assert.equal(find(inserted, 'model:open').newText, 'model:open="$1"')
		assert.equal(
			inserted.some((item) => item.label === 'model:'),
			false,
			"the child's models replace model:",
		)
	})

	test('after bind:, on: or model: only that channel, replacing the whole name', async () => {
		const bind = (await complete('<Card bind:it| />')).inserted
		assert.deepEqual(find(bind, 'bind:item'), { label: 'bind:item', newText: 'bind:item="$1"', format: InsertTextFormat.Snippet, replaces: 'bind:it' })
		// Every prop after bind:, also a text one.
		assert.equal(find(bind, 'bind:title').newText, 'bind:title="$1"')
		assert.equal(
			bind.some((item) => item.label === 'if:when' || item.label === 'title'),
			false,
		)
		const events = (await complete('<Card on:s| />')).inserted
		assert.deepEqual(
			events.map((item) => [item.label, item.newText, item.replaces]),
			[
				['on:save', 'on:save="$1"', 'on:s'],
				['on:select', 'on:select="$1"', 'on:s'],
			],
		)
		const models = (await complete('<Card model:| />')).inserted
		assert.deepEqual(
			models.map((item) => item.newText),
			['model:open="$1"'],
			'never model:default',
		)
		assert.deepEqual((await complete('<Card ref:| />')).items, [], "a ref name is the author's")
	})

	test('the props already written and an existing value are respected', async () => {
		const { inserted } = await complete('<Card title="x" bind:item="items.value[0]!" | />')
		assert.equal(
			inserted.some((item) => ['title', 'bind:title', 'bind:item'].includes(item.label)),
			false,
		)
		// Renaming an attribute that has a value inserts only the name.
		const renamed = (await complete('<Card la|="x" />')).inserted
		assert.equal(find(renamed, 'label').newText, 'label')
		assert.equal(find(renamed, 'bind:label').newText, 'bind:label')
		const element = (await complete('<div on:cl|="go"></div>')).inserted
		assert.equal(find(element, 'on:click').newText, 'on:click')
	})

	test('an element offers its HTML attributes with their value and the cursor inside', async () => {
		const { inserted } = await complete('<div cl|></div>')
		assert.deepEqual(find(inserted, 'class'), { label: 'class', newText: 'class="$1"', format: InsertTextFormat.Snippet, replaces: 'cl' })
		assert.equal(find(inserted, 'if:when').newText, 'if:when="$1"')
		assert.equal(find(inserted, 'bind:').newText, 'bind:')
		assert.equal(find((await complete('<div bind:cl|></div>')).inserted, 'bind:class').newText, 'bind:class="$1"')
		assert.equal(find((await complete('<div on:cl|></div>')).inserted, 'on:click').newText, 'on:click="$1"')
		assert.equal(find((await complete('<input |/>')).inserted, 'model').newText, 'model="$1"')
		assert.equal(find((await complete('<div |></div>')).inserted, 'bind').newText, 'bind="$1"')
	})

	test('snippet, render and component tags offer their own attributes', async () => {
		const snippet = (await complete('<Card><snippet |></snippet></Card>')).inserted
		assert.deepEqual(
			snippet.map((item) => item.newText),
			['name="$1"', 'params="$1"', 'if:when="$1"'],
		)
		// The extension point of the snippet names: `snippetNameCompletion` in features.ts.
		assert.deepEqual((await complete('<Card><snippet name="|"></snippet></Card>')).inserted.map((item) => item.label).sort(), ['default', 'icon'])
		assert.deepEqual(
			(await complete('<render |/>')).inserted.map((item) => item.newText),
			['snippet="$1"', 'args="$1"', 'if:when="$1"'],
		)
		assert.ok(find((await complete('<component |></component>')).inserted, 'if:when'))
	})

	test('tags: HTML, components and render', async () => {
		const html = (await complete('<d|')).inserted
		assert.equal(find(html, 'div').newText, 'div')
		assert.equal(find((await complete('<|')).inserted, 'render').newText, 'render snippet="$1" />')
		assert.equal(find((await complete('<C|')).inserted, 'Card').replaces, 'C')
	})

	test('the values of a literal union, inside the quotes', async () => {
		const { inserted } = await complete('<Card variant="|" />')
		assert.deepEqual(inserted.map((item) => item.label).sort(), ['primary', 'secondary'])
	})

	test('empty values of a component tag complete expressions, also when the quote triggers it', async () => {
		for (const body of ['<Card bind:item="|" title="x" />', '<Card on:save="|" />', '<Card model="|" />', '<Card if:when="|" />', '<div bind:title="|"></div>']) {
			for (const trigger of [undefined, '"']) {
				const { items } = await complete(body, trigger)
				assert.ok(
					items.some((item) => item.label === 'items'),
					`${body} ${trigger ?? ''}: ${items.length} items`,
				)
			}
		}
	})

	test('TypeScript items replace the identifier they complete, also next to a colon', async () => {
		const { inserted } = await complete('<div bind:class="{ active:na| }"></div>')
		assert.deepEqual(find(inserted, 'name').replaces, 'na')
		assert.deepEqual(find((await complete('<p>{it|}</p>')).inserted, 'items').replaces, 'it')
	})
})
