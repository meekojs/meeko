import type { CodeAction, CompletionItem, Diagnostic, MarkupContent } from 'vscode-languageserver/node'

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, test } from 'node:test'
import { CodeActionRequest, CodeLensRequest, CompletionRequest, createConnection, createProtocolConnection, DidOpenTextDocumentNotification, HoverRequest, InitializedNotification, InitializeRequest, PublishDiagnosticsNotification, ShutdownRequest, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node'

import { doubleBracesMessage } from '../src/compiler/double-braces.ts'
import { builtinTag, builtinTags } from '../src/language-server/builtin-tags.ts'
import { cleanupAfterAwaitMessage, cleanupAfterAwaitText, cleanupBrowserApiMessage } from '../src/language-server/cleanup.ts'
import { spanishMessages } from '../src/language-server/l10n-es.ts'
import { currentLocale, defaultLocale, format, joinList, localized, resolveLocale, setLocale, t } from '../src/language-server/l10n.ts'
import { reactiveLensTitle } from '../src/language-server/lenses.ts'
import { ExecutionZonesRequest, startLanguageServer } from '../src/language-server/server.ts'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'src', 'language-server')

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sourceFiles(join(directory, entry.name)) : entry.name.endsWith('.ts') ? [join(directory, entry.name)] : []))
}

/** A call of `t`: not a method, nor the end of a longer identifier. */
const call = /(?:(?<=\.\.\.)|(?<![\w$.]))t\(/g
/** The same call with its message: a single- or double-quoted literal. */
const literalCall = /(?:(?<=\.\.\.)|(?<![\w$.]))t\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")\s*[,)]/g

/** Value of a quoted literal with the escapes that the messages use. */
function literalValue(literal: string): string {
	return literal.slice(1, -1).replace(/\\(.)/g, (_, char: string) => (char === 'n' ? '\n' : char))
}

/** Messages passed to `t` in `src/language-server/**`, with the files that use them. */
function sourceMessages(): Map<string, string[]> {
	const messages = new Map<string, string[]>()
	for (const file of sourceFiles(source)) {
		const name = relative(root, file).replaceAll('\\', '/')
		if (name.endsWith('/l10n-es.ts')) continue
		const text = readFileSync(file, 'utf8')
		const literals = [...text.matchAll(literalCall)].map((match) => literalValue(match[1]!))
		// The module of the mechanism declares `t` itself, so its signature is no call.
		if (!name.endsWith('/l10n.ts')) assert.equal(literals.length, [...text.matchAll(call)].length, `${name}: every t(...) takes a quoted string literal as its first argument`)
		for (const message of literals) messages.set(message, [...(messages.get(message) ?? []), name])
	}
	return messages
}

const placeholders = (message: string): string[] => [...new Set(message.match(/\{\d+\}/g))].sort()

afterEach(() => {
	setLocale()
})

describe('the language of the server', () => {
	test('a locale that starts with es is Spanish, any other explicit one is English, and none is the default', () => {
		assert.equal(defaultLocale, 'es')
		for (const tag of [undefined, null, '', '  ']) assert.equal(resolveLocale(tag), 'es', String(tag))
		for (const tag of ['es', 'es-ES', 'es-MX', 'ES', 'es_AR', ' es-419 ']) assert.equal(resolveLocale(tag), 'es', tag)
		for (const tag of ['en', 'en-US', 'en-gb', 'pt-BR', 'fr', 'de', 'zh-cn', 'ja', 'esperanto', 'est']) assert.equal(resolveLocale(tag), 'en', tag)
		assert.equal(currentLocale(), 'es')
		assert.equal(setLocale('en-GB'), 'en')
		assert.equal(currentLocale(), 'en')
		assert.equal(setLocale(), 'es')
	})

	test('t returns the Spanish translation by default and the English message otherwise', () => {
		assert.equal(t('Server only'), 'Sólo servidor')
		assert.equal(t('Move {0} to <script server>', 'A.route.ts'), 'Mover A.route.ts a <script server>')
		setLocale('en')
		assert.equal(t('Server only'), 'Server only')
		assert.equal(t('Move {0} to <script server>', 'A.route.ts'), 'Move A.route.ts to <script server>')
		setLocale('es-ES')
		assert.equal(t('Server only'), 'Sólo servidor')
		// A message without translation is shown as written.
		assert.equal(t('A message nobody translated'), 'A message nobody translated')
	})

	test('format fills {n} markers, repeats them and leaves the ones without an argument', () => {
		assert.equal(format('{0} and {1}', 'a', 2), 'a and 2')
		assert.equal(format('`{0}` in {0}: {1}', 'x', true), '`x` in x: true')
		assert.equal(format('{0} {1}', 'a'), 'a {1}')
		assert.equal(format('{0}'), '{0}')
		assert.equal(format('{0}', '$&'), '$&')
	})

	test('joinList joins a list in the language of the connection', () => {
		assert.equal(joinList([]), '')
		assert.equal(joinList(['a']), 'a')
		assert.equal(joinList(['a', 'b']), 'a y b')
		assert.equal(joinList(['a', 'b', 'c']), 'a, b y c')
		setLocale('en')
		assert.equal(joinList(['a', 'b']), 'a and b')
		assert.equal(joinList(['a', 'b', 'c']), 'a, b and c')
	})

	test('localized builds a table once per language, not when the module loads', () => {
		let builds = 0
		const table = localized(() => {
			builds++
			return { label: t('Server only') }
		})
		assert.equal(builds, 0)
		assert.equal(table().label, 'Sólo servidor')
		assert.equal(table().label, 'Sólo servidor')
		assert.equal(builds, 1)
		setLocale('en')
		assert.equal(table().label, 'Server only')
		assert.equal(table().label, 'Server only')
		assert.equal(builds, 2)
		setLocale('es')
		assert.equal(table().label, 'Sólo servidor')
		assert.equal(builds, 2)
	})

	test('the static tables and messages follow the language', () => {
		const link = builtinTag('MeekoLink')!
		assert.match(link.summary, /^Enlace a una página de la aplicación/)
		assert.match(link.props[0]!.documentation, /^ID de la ruta de destino/)
		assert.equal(link.completion, 'Enlace a una ruta tipada: <MeekoLink to="/users/[id]" bind:params="{ id }">')
		setLocale('en')
		assert.match(link.summary, /^Link to a page of the application/)
		assert.match(link.props[0]!.documentation, /^Route ID of the target/)
		assert.ok(builtinTags.length > 3)
		assert.match(cleanupBrowserApiMessage(['window']), /uses `window`, which only exists in the browser/)
		assert.match(cleanupBrowserApiMessage(['window', 'document']), /uses `window` and `document`, which only exist in the browser/)
		assert.match(cleanupAfterAwaitText(), /^`onCleanup` is registered after an `await`/)
		// The exported constant is the message in the default language.
		assert.match(cleanupAfterAwaitMessage, /^`onCleanup` se registra después de un `await`/)
		assert.equal(reactiveLensTitle({ accesses: [{ read: true, write: false, template: true }] } as never), '1 read · 0 writes · in the template')
		setLocale('es')
		assert.equal(reactiveLensTitle({ accesses: [{ read: true, write: false, template: true }] } as never), '1 lectura · 0 escrituras · en la plantilla')
	})
})

describe('the Spanish catalog', () => {
	test('has an entry for every message that the server shows, and no entry that nothing uses', () => {
		const messages = sourceMessages()
		assert.ok(messages.size > 250, `Expected the messages of the server: ${messages.size}`)
		const catalog = new Set(Object.keys(spanishMessages))
		const missing = [...messages.keys()].filter((message) => !catalog.has(message))
		assert.deepEqual(missing, [], `Add the Spanish translation to src/language-server/l10n-es.ts:\n${missing.join('\n')}`)
		const unused = [...catalog].filter((message) => !messages.has(message))
		assert.deepEqual(unused, [], `Entries of l10n-es.ts that no t(...) uses:\n${unused.join('\n')}`)
	})

	test('keeps the markers of every message and writes the key in English', () => {
		for (const [message, translation] of Object.entries(spanishMessages)) {
			assert.ok(translation.trim(), `${message}: the translation is empty`)
			assert.deepEqual(placeholders(translation), placeholders(message), `${message}: the translation uses other markers`)
			assert.doesNotMatch(message, /[áéíóúñ¿¡«»]/, `${message}: the key is the English message`)
		}
	})

	test('translates a message that is not an exact copy of the English one wherever the languages differ', () => {
		// The English and the Spanish text of these coincide in the source of the editor: a regression guard for the
		// messages that were written in Spanish before the catalog and must not come out in English by default.
		for (const message of ['Server only', 'Browser only', 'Server and browser', 'Move to `onMounted`', 'Show the braces as text']) assert.notEqual(spanishMessages[message], message, message)
	})
})

const component = `<script lang="ts">
const count = signal(0);
const total = computed(() => count.value * 2);
</script>
<template>
  <p>{{ count.value }}</p>
  <button on:click="count.value++">{total.value}</button>
</template>
`

interface Session {
	readonly uri: string
	readonly diagnostics: Diagnostic[][]
	request<T>(method: string, params: unknown): Promise<T>
	position(needle: string, delta?: number): { line: number; character: number }
}

/** A server in this process that initializes with `locale` (or without it) and has `component` open. */
async function withServer(locale: string | undefined, text: string, run: (session: Session) => Promise<void>): Promise<void> {
	const toServer = new PassThrough()
	const toClient = new PassThrough()
	const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient))
	startLanguageServer(server)
	server.listen()
	const client = createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer))
	const diagnostics: Diagnostic[][] = []
	client.onNotification('window/logMessage', () => undefined)
	client.onNotification(PublishDiagnosticsNotification.type, (params) => {
		if (params.uri === uri) diagnostics.push(params.diagnostics)
	})
	client.listen()
	const uri = 'untitled:/L10n.meeko'
	try {
		await client.sendRequest(InitializeRequest.type, {
			processId: null,
			rootUri: null,
			workspaceFolders: null,
			capabilities: { workspace: { workspaceEdit: { documentChanges: true } } },
			...(locale === undefined ? {} : { locale }),
			initializationOptions: { trusted: false, projectContracts: false, diagnosticsDelay: 0 },
		})
		await client.sendNotification(InitializedNotification.type, {})
		await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: 'meeko', version: 1, text } })
		await run({
			uri,
			diagnostics,
			request: (method, params) => client.sendRequest(method, params),
			position(needle, delta = 0) {
				const offset = text.indexOf(needle)
				assert.ok(offset >= 0, needle)
				const before = text.slice(0, offset + delta)
				return { line: before.split('\n').length - 1, character: before.length - before.lastIndexOf('\n') - 1 }
			},
		})
	} finally {
		await client.sendRequest(ShutdownRequest.type)
		client.dispose()
		server.dispose()
	}
}

async function settled(session: Session, wait: (items: Diagnostic[]) => boolean): Promise<Diagnostic[]> {
	for (let attempt = 0; attempt < 600; attempt++) {
		const latest = session.diagnostics.at(-1)
		if (latest && wait(latest)) return latest
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	throw new Error(`The diagnostics did not arrive: ${JSON.stringify(session.diagnostics.at(-1))}`)
}

/** What the server shows in a component, in the language of its connection. */
async function shown(session: Session) {
	const { uri } = session
	const zones = (await session.request<{ zones: Array<{ label: string; detail: string }> } | null>(ExecutionZonesRequest.method, { textDocument: { uri } }))!.zones
	const hover = await session.request<{ contents: MarkupContent } | null>(HoverRequest.method, { textDocument: { uri }, position: session.position('count = signal', 1) })
	const completions = await session.request<CompletionItem[] | { items: CompletionItem[] }>(CompletionRequest.method, { textDocument: { uri }, position: session.position('<button ', '<button '.length) })
	const items = Array.isArray(completions) ? completions : completions.items
	const lenses = (await session.request<Array<{ command?: { title: string } }> | null>(CodeLensRequest.method, { textDocument: { uri } })) ?? []
	const found = await settled(session, (items) => items.some((item) => item.message === doubleBracesMessage))
	const brace = found.find((item) => item.message === doubleBracesMessage)!
	const actions = await session.request<CodeAction[]>(CodeActionRequest.method, { textDocument: { uri }, range: brace.range, context: { diagnostics: [brace] } })
	return {
		zones: zones.map((zone) => [zone.label, zone.detail]),
		hover: hover?.contents.value ?? '',
		directive: items.find((item) => item.label === 'if')?.detail,
		lenses: lenses.map((lens) => lens.command?.title),
		actions: actions.map((action) => action.title),
		braces: brace.message,
	}
}

describe('the language server speaks the language of the client', { timeout: 300_000 }, () => {
	test('with locale en, the hover, the completion, the code actions, the lenses and the zones are in English', async () => {
		await withServer('en-US', component, async (session) => {
			const result = await shown(session)
			assert.match(result.hover, /\*\*Reads \(/)
			assert.match(result.hover, /\*\*Writes \(/)
			assert.doesNotMatch(result.hover, /Lecturas|Escrituras/)
			assert.equal(result.directive, 'First branch of a conditional chain')
			assert.ok(
				result.lenses.some((title) => /^\d+ reads? · \d+ writes? · in the template$/.test(title ?? '')),
				JSON.stringify(result.lenses),
			)
			assert.ok(
				result.actions.some((title) => title === 'Convert to {count.value}'),
				JSON.stringify(result.actions),
			)
			assert.ok(result.actions.includes('Show the braces as text'), JSON.stringify(result.actions))
			assert.deepEqual(
				result.zones.map(([label]) => label),
				['Server and browser'],
			)
			assert.match(result.zones[0]![1], /^The component setup runs on the server during SSR/)
			// What the compiler reports comes from `src/compiler` and keeps its Spanish message.
			assert.equal(result.braces, doubleBracesMessage)
		})
	})

	test('with locale es, or without locale, everything is Spanish as before', async () => {
		const results = []
		for (const locale of ['es-ES', undefined]) {
			await withServer(locale, component, async (session) => {
				results.push(await shown(session))
			})
		}
		for (const result of results) {
			assert.match(result.hover, /\*\*Lecturas \(/)
			assert.equal(result.directive, 'Primera rama de una cadena condicional')
			assert.ok(result.actions.includes('Convertir a {count.value}'), JSON.stringify(result.actions))
			assert.ok(result.actions.includes('Mostrar las llaves como texto'))
			assert.ok(
				result.lenses.some((title) => /^\d+ lecturas? · \d+ escrituras? · en la plantilla$/.test(title ?? '')),
				JSON.stringify(result.lenses),
			)
			assert.equal(result.zones[0]![0], 'Servidor y navegador')
			assert.match(result.zones[0]![1], /^El setup del componente se ejecuta en el servidor/)
		}
		assert.deepEqual(results[0], results[1])
	})

	test('the diagnostics of the server itself follow the language', async () => {
		const unvalued = '<script lang="ts">\nconst count = signal(0);\n</script>\n<template><button bind:class>{count.value}</button></template>\n'
		for (const [locale, expected] of [
			['en', 'bind:class needs a value: bind:class="expression"'],
			['es-MX', 'bind:class necesita un valor: bind:class="expresión"'],
			[undefined, 'bind:class necesita un valor: bind:class="expresión"'],
		] as const) {
			await withServer(locale, unvalued, async (session) => {
				const found = await settled(session, (items) => items.some((item) => item.message.includes('bind:class')))
				assert.deepEqual(
					found.map((item) => item.message),
					[expected],
					String(locale),
				)
			})
		}
	})
})
