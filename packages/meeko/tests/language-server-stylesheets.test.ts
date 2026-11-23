import type { CompletionItem, CompletionList, Hover, Location, MarkupContent, Registration } from 'vscode-languageserver/node'

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CompletionRequest, CompletionResolveRequest, ConfigurationRequest, createConnection, createProtocolConnection, DefinitionRequest, DidChangeConfigurationNotification, DidChangeTextDocumentNotification, DidCloseTextDocumentNotification, DidOpenTextDocumentNotification, HoverRequest, InitializedNotification, InitializeRequest, PrepareRenameRequest, ReferencesRequest, RegistrationRequest, RenameRequest, ShutdownRequest, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node'

import { cssVariableTokenAt } from '../src/language-server/css-variables'
import { startLanguageServer } from '../src/language-server/server'
import { tempProject } from './helpers/temp-project'

test('standalone CSS variable tokens exclude comments, strings and non-variable fallbacks', () => {
	for (const language of ['css', 'tailwindcss']) {
		for (const [text, expected] of [
			['@utility inverted { color: var(--ac|cent); }', true],
			[':root { --ac|cent: red; }', true],
			['.x { color: var(--missing, var(--|)); }', true],
			['.x { /* var(--|) */ }', false],
			['.x { content: "var(--|)"; }', false],
			['.x { color: var(--accent, re|d); }', false],
		] as const)
			assert.equal(Boolean(cssVariableTokenAt(text.replace('|', ''), text.indexOf('|'), language)), expected, text)
	}
})

test('CSS registers only variable providers, follows unsaved imports and keeps every setting independent', { timeout: 30_000 }, async (context) => {
	const root = await tempProject(context, 'lsp-stylesheets')
	await mkdir(join(root, 'app/styles/utilities'), { recursive: true })
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}')
	await writeFile(join(root, 'meeko.config.ts'), 'throw new Error("CSS must not execute config"); export default {}')
	await writeFile(join(root, 'app/styles/main.css'), '@import "./tokens.css"; @import "./utilities/variant.css";')
	const tokens = join(root, 'app/styles/tokens.css')
	await writeFile(tokens, '@theme { --color-surface-inverted-1: #123456; }')
	const filename = join(root, 'app/styles/utilities/variant.css')
	const text = '@utility inverted { --local: green; color: var(--color-surface-inverted-1); }'
	await writeFile(filename, text)
	const uri = pathToFileURL(filename).href
	const toServer = new PassThrough(),
		toClient = new PassThrough()
	const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient))
	startLanguageServer(server)
	server.listen()
	const client = createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer))
	const registrations: Registration[] = []
	let settings: Record<string, unknown> = {}
	const scopedSettings = new Map<string, Record<string, unknown>>()
	client.onRequest(RegistrationRequest.type, (params) => {
		registrations.push(...params.registrations)
	})
	client.onRequest(ConfigurationRequest.type, ({ items }) => items.map(({ section, scopeUri }) => (section === 'meeko.cssVariables' ? (scopedSettings.get(scopeUri ?? '') ?? settings) : section === 'meeko.classes' ? { completion: 'off', hover: 'off', definition: false } : {})))
	client.onNotification('window/logMessage', () => undefined)
	client.onNotification('textDocument/publishDiagnostics', () => assert.fail('CSS must not publish Meeko diagnostics'))
	client.listen()
	context.after(async () => {
		await client.sendRequest(ShutdownRequest.type)
		client.dispose()
		server.dispose()
	})
	await client.sendRequest(InitializeRequest.type, {
		processId: null,
		rootUri: pathToFileURL(root).href,
		capabilities: {
			workspace: { configuration: true, workspaceEdit: { documentChanges: true } },
			textDocument: { synchronization: { dynamicRegistration: true }, completion: { dynamicRegistration: true }, hover: { dynamicRegistration: true }, definition: { dynamicRegistration: true }, references: { dynamicRegistration: true }, rename: { dynamicRegistration: true, prepareSupport: true } },
		},
		initializationOptions: { trusted: false, projectContracts: false },
	})
	await client.sendNotification(InitializedNotification.type, {})
	await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: 'css', version: 1, text } })
	const position = TextDocument.create(uri, 'css', 1, text).positionAt(text.indexOf('var(') + 6)
	const params = { textDocument: { uri }, position }
	const complete = async (request = params) => {
		const result = (await client.sendRequest(CompletionRequest.type, request)) as CompletionItem[] | CompletionList | null
		return Array.isArray(result) ? result : (result?.items ?? [])
	}
	const hover = () => client.sendRequest(HoverRequest.type, params) as Promise<Hover | null>
	const definition = () => client.sendRequest(DefinitionRequest.type, params) as Promise<Location[] | null>
	const references = () => client.sendRequest(ReferencesRequest.type, { ...params, context: { includeDeclaration: false } }) as Promise<Location[] | null>
	const rename = () => client.sendRequest(RenameRequest.type, { ...params, newName: '--surface-alt' })
	const configure = async (next: Record<string, unknown>) => {
		settings = next
		await client.sendNotification(DidChangeConfigurationNotification.type, { settings: {} })
	}
	const suggestions = await complete()
	assert.ok(suggestions.some(({ label }) => label === '--local'))
	const item = suggestions.find(({ label }) => label === '--color-surface-inverted-1')!
	assert.ok(item, 'class settings do not disable CSS variables')
	const resolved = await client.sendRequest(CompletionResolveRequest.type, item)
	assert.match((resolved.documentation as MarkupContent).value, /#123456/)
	assert.match(((await hover())!.contents as MarkupContent).value, /#123456/)
	assert.equal((await definition())![0]!.uri, pathToFileURL(tokens).href)
	assert.deepEqual(registrations.map(({ method }) => method).sort(), ['textDocument/didOpen', 'textDocument/didChange', 'textDocument/didClose', 'textDocument/completion', 'textDocument/hover', 'textDocument/definition', 'textDocument/references', 'textDocument/rename'].sort())
	for (const registration of registrations) {
		const options = registration.registerOptions as { documentSelector: { language: string; scheme: string; pattern: string }[] }
		assert.deepEqual(
			options.documentSelector.map(({ language }) => language),
			['css', 'tailwindcss'],
		)
		assert.ok(options.documentSelector.every(({ scheme, pattern }) => scheme === 'file' && pattern === `${root.replaceAll('\\', '/')}/**/*.css`))
	}
	await configure({ completion: false })
	assert.deepEqual(await complete(), [])
	assert.ok(await hover())
	assert.ok(await definition())
	assert.equal((await references())!.length, 1)
	assert.ok(await client.sendRequest(PrepareRenameRequest.type, params))
	const edit = await rename()
	assert.equal(edit!.documentChanges!.length, 2)
	assert.ok(edit!.documentChanges!.some((change) => 'textDocument' in change && change.textDocument.uri === uri && change.textDocument.version === 1))
	await configure({ references: false })
	assert.equal(await references(), null)
	assert.ok(await rename())
	assert.ok((await complete()).length)
	await configure({ rename: false })
	assert.equal(await rename(), null)
	assert.equal(await client.sendRequest(PrepareRenameRequest.type, params), null)
	assert.ok(await references())
	assert.ok((await complete()).length)
	await configure({ hover: false })
	assert.ok((await complete()).length)
	assert.equal(await hover(), null)
	assert.ok(await definition())
	await configure({ definition: false })
	assert.ok((await complete()).length)
	assert.ok(await hover())
	assert.equal(await definition(), null)
	await configure({})
	const tokensUri = pathToFileURL(tokens).href
	const unsaved = '@theme { --color-surface-inverted-1: blue; --unsaved: 2px; }'
	await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri: tokensUri, languageId: 'css', version: 1, text: unsaved } })
	assert.ok((await complete()).some(({ label }) => label === '--unsaved'))
	assert.match(((await hover())!.contents as MarkupContent).value, /blue/)
	const unsavedRename = await rename()
	assert.ok(unsavedRename!.documentChanges!.some((change) => 'textDocument' in change && change.textDocument.uri === tokensUri && change.textDocument.version === 1))
	await client.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { uri: tokensUri, version: 2 }, contentChanges: [{ text: '@theme { --replacement: red; }' }] })
	assert.ok((await complete()).some(({ label }) => label === '--replacement'))
	assert.ok(!(await complete()).some(({ label }) => label === '--unsaved'))
	await client.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri: tokensUri } })
	assert.ok(!(await complete()).some(({ label }) => label === '--replacement'))
	assert.match(((await hover())!.contents as MarkupContent).value, /#123456/)
	// Una hoja nueva y todavía incompleta también recupera declaraciones anteriores al cursor.
	const freshUri = pathToFileURL(join(root, 'app/styles/new.css')).href
	const fresh = ':root { --fresh: gold; color: var(--'
	await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri: freshUri, languageId: 'tailwindcss', version: 1, text: fresh } })
	assert.ok((await complete({ textDocument: { uri: freshUri }, position: { line: 0, character: fresh.length } })).some(({ label }) => label === '--fresh'))
	scopedSettings.set(freshUri, { completion: false })
	await configure({})
	assert.deepEqual(await complete({ textDocument: { uri: freshUri }, position: { line: 0, character: fresh.length } }), [])
	assert.ok((await complete()).length, 'resource settings of another stylesheet do not disable this one')
	// El registro CSS no activa funciones para hojas de paquetes ajenos a Meeko.
	await mkdir(join(root, 'other'), { recursive: true })
	await writeFile(join(root, 'other/package.json'), '{"private":true}')
	const otherUri = pathToFileURL(join(root, 'other/other.css')).href
	await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri: otherUri, languageId: 'css', version: 1, text } })
	assert.deepEqual(await complete({ textDocument: { uri: otherUri }, position }), [])
})

test('variable settings from initialization and push notifications do not disable component classes', { timeout: 30_000 }, async (context) => {
	const root = await tempProject(context, 'lsp-variable-settings')
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}')
	const filename = join(root, 'Page.meeko'),
		uri = pathToFileURL(filename).href
	const text = '<template><p class="page">Hi</p></template><style>.page { --accent: red; color: var(--accent); }</style>'
	await writeFile(filename, text)
	const toServer = new PassThrough(),
		toClient = new PassThrough()
	const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient))
	startLanguageServer(server)
	server.listen()
	const client = createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer))
	client.onNotification('window/logMessage', () => undefined)
	client.onNotification('textDocument/publishDiagnostics', () => undefined)
	client.listen()
	context.after(async () => {
		await client.sendRequest(ShutdownRequest.type)
		client.dispose()
		server.dispose()
	})
	await client.sendRequest(InitializeRequest.type, {
		processId: null,
		rootUri: pathToFileURL(root).href,
		capabilities: {},
		initializationOptions: { trusted: false, projectContracts: false, diagnosticsDelay: 60_000, cssVariables: { completion: false, hover: false, definition: false } },
	})
	await client.sendNotification(InitializedNotification.type, {})
	await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: 'meeko', version: 1, text } })
	const document = TextDocument.create(uri, 'meeko', 1, text)
	const variable = { textDocument: { uri }, position: document.positionAt(text.indexOf('var(') + 6) }
	for (const method of [CompletionRequest.type, HoverRequest.type, DefinitionRequest.type]) assert.equal(await client.sendRequest(method.method, variable), null)
	const references = () => client.sendRequest(ReferencesRequest.type, { ...variable, context: { includeDeclaration: true } })
	const rename = () => client.sendRequest(RenameRequest.type, { ...variable, newName: '--brand' })
	assert.equal((await references())!.length, 2, 'reference lookup stays enabled when completion, hover and definition are off')
	assert.ok(await rename())
	const ownClass = { textDocument: { uri }, position: document.positionAt(text.indexOf('class="page') + 9) }
	assert.ok(await client.sendRequest(CompletionRequest.type, ownClass))
	assert.ok(await client.sendRequest(HoverRequest.type, ownClass))
	assert.ok(await client.sendRequest(DefinitionRequest.type, ownClass))
	await client.sendNotification(DidChangeConfigurationNotification.type, { settings: { meeko: { cssVariables: { completion: true, hover: false, definition: false } } } })
	const result = (await client.sendRequest(CompletionRequest.type, variable)) as CompletionItem[]
	assert.ok(result.some(({ label }) => label === '--accent'))
	assert.equal(await client.sendRequest(HoverRequest.type, variable), null)
	assert.equal(await client.sendRequest(DefinitionRequest.type, variable), null)
	await client.sendNotification(DidChangeConfigurationNotification.type, { settings: { meeko: { cssVariables: { references: false, rename: true } } } })
	assert.equal(await references(), null)
	assert.ok(await rename())
	await client.sendNotification(DidChangeConfigurationNotification.type, { settings: { meeko: { cssVariables: { references: true, rename: false } } } })
	assert.equal((await references())!.length, 2)
	assert.equal(await rename(), null)
})
