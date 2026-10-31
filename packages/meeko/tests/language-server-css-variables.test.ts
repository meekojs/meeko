import type { CompletionItem, CompletionList, Hover, InitializeResult, Location, MarkupContent } from 'vscode-languageserver/node'

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CompletionRequest, CompletionResolveRequest, createConnection, createProtocolConnection, DefinitionRequest, DidChangeTextDocumentNotification, DidChangeWatchedFilesNotification, DidOpenTextDocumentNotification, FileChangeType, HoverRequest, InitializedNotification, InitializeRequest, PublishDiagnosticsNotification, ShutdownRequest, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node'

import { ClassIndex, classView } from '../src/language-server/classes'
import { cssVariableCompletion, cssVariableDefinition, cssVariableHover, cssVariableRules, cssVariableTokenAt, resolveCssVariableCompletion } from '../src/language-server/css-variables'
import { startLanguageServer } from '../src/language-server/server'
import { tempProject } from './helpers/temp-project'

const component = (style: string, template = '<p>Hello</p>', attributes = '') => `<template>${template}</template>\r\n<style${attributes}>${style}</style>`
const cursor = (source: string) => ({ source: source.replace('|', ''), offset: source.indexOf('|') })
const doc = (source: string, filename = '/app/Page.meeko') => TextDocument.create(pathToFileURL(filename).href, 'meeko', 1, source)

test('custom properties retain values, case, Unicode, contexts and @property registrations', () => {
	const source = ':root { --Accent: #123456; --espacio: 1rem !important; }\r\n@media (prefers-color-scheme: dark) { :root { --Accent: white; } }\r\n@property --angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }\r\n:global(.theme) { --цвет: red; }'
	const rules = cssVariableRules(source, 10)!
	assert.equal(rules.filter(({ name }) => name === '--Accent').length, 2)
	assert.equal(rules.find(({ name }) => name === '--espacio')?.value, '1rem !important')
	assert.equal(rules.find(({ name }) => name === '--цвет')?.global, true)
	assert.equal(rules.find(({ name }) => name === '--angle')?.registered, true)
	for (const rule of rules) assert.equal(source.slice(rule.start - 10, rule.end - 10), rule.name)
	assert.equal(cssVariableRules(':root { --broken:'), undefined)
})

test('variable tokens understand nested fallbacks, inline literals and replacement in the middle', () => {
	for (const source of [
		component('.x { color: var(--ac|cent); }'),
		component('.x { color: var(--missing, var(--|)); }'),
		component('.x { width: calc(var(--|) * 2); }'),
		component('.x { color: var(|); }'),
		component(':root { --ac|cent: red; }'),
		component(':root { |--accent: red; }'),
		component('@property --ac|cent { initial-value: red; }'),
		'<template><p style="color: var(--ac|cent)">Hi</p></template>',
		"<template><p bind:style=\"open.value ? 'color: var(--ac|cent)' : ''\">Hi</p></template>",
		'<template><p bind:style="`color: var(--ac|cent); opacity: ${opacity.value}`">Hi</p></template>',
	]) {
		const at = cursor(source)
		assert.ok(cssVariableTokenAt(at.source, at.offset), source)
	}
	const middle = cursor(component('.x { color: var(--ac|cent); }'))
	const token = cssVariableTokenAt(middle.source, middle.offset)!
	assert.equal(middle.source.slice(token.start, token.end), '--accent')
	for (const source of [
		component('.x { /* var(--|) */ color: red; }'),
		component('.x { content: "var(--|)"; }'),
		component('.x { color: var(--accent, re|d); }'),
		'<template><p title="var(--|)">Hi</p></template>',
		'<script lang="ts">const value = "var(--|)";</script><template><p>Hi</p></template>',
		'<template><p bind:style="style.va|lue">Hi</p></template>',
		'<template><p bind:style="`color: ${style.va|lue}`">Hi</p></template>',
	]) {
		const at = cursor(source)
		assert.equal(cssVariableTokenAt(at.source, at.offset), undefined, source)
	}
})

test('variables share the cached style sources, with scoped visibility and authored definitions', async (context) => {
	const root = await tempProject(context, 'css-variable-sources')
	await mkdir(join(root, 'app/styles'), { recursive: true })
	await mkdir(join(root, '.meeko/styles'), { recursive: true })
	const tokens = ':root { --accent: #285ac8; }\r\n[data-theme="dark"] { --accent: white; }'
	await writeFile(join(root, 'app/styles/main.css'), '@import "./tokens.css";')
	await writeFile(join(root, 'app/styles/tokens.css'), tokens)
	await writeFile(join(root, '.meeko/styles/main.css'), ':root { --accent: #285ac8; --generated: 2px; }')
	const index = new ClassIndex(root)
	const filename = join(root, 'app/Page.meeko')
	const document = doc(component('.own { --local: green; color: var(--accent); }', '<p>Hi</p>', ' scoped'), filename)
	const components = [
		{ filename: join(root, 'app/Global.meeko'), source: component(':root { --global-only: 1px; }') },
		{ filename: join(root, 'app/Scoped.meeko'), source: component('.local { --private: 1px; } :global(.theme) { --public: 2px; }', '<p>Hi</p>', ' scoped') },
	]
	const view = () => classView(document, filename, index, components)
	const position = document.positionAt(document.getText().indexOf('var(--accent)') + 6)
	const suggestions = cssVariableCompletion(document, position, view)!
	const labels = suggestions.map(({ label }) => label)
	for (const name of ['--accent', '--local', '--global-only', '--generated', '--public']) assert.ok(labels.includes(name), name)
	assert.ok(!labels.includes('--private'))
	assert.equal(labels.filter((name) => name === '--accent').length, 1)
	const item = suggestions.find(({ label }) => label === '--accent')!
	assert.ok(!item.documentation, 'documentation is resolved lazily')
	assert.match((resolveCssVariableCompletion(item, view()).documentation as MarkupContent).value, /#285ac8/)
	assert.match((cssVariableHover(document, position, view)!.contents as MarkupContent).value, /data-theme/)
	const locations = cssVariableDefinition(document, position, view)!
	assert.equal(locations.length, 2)
	for (const location of locations) {
		assert.equal(location.uri, pathToFileURL(join(root, 'app/styles/tokens.css')).href)
		const stylesheet = TextDocument.create(location.uri, 'css', 0, tokens)
		assert.equal(tokens.slice(stylesheet.offsetAt(location.range.start), stylesheet.offsetAt(location.range.end)), '--accent')
	}
	const generated = TextDocument.create(document.uri, 'meeko', 2, document.getText().replaceAll('--accent', '--generated'))
	assert.equal(cssVariableDefinition(generated, position, () => classView(generated, filename, index, components))![0]!.uri, pathToFileURL(join(root, '.meeko/styles/main.css')).href)
})

test('incomplete CSS preserves cached suggestions but does not offer obsolete definition ranges', async (context) => {
	const root = await tempProject(context, 'css-variable-stale')
	await mkdir(join(root, 'app/styles'), { recursive: true })
	const file = join(root, 'app/styles/main.css')
	await writeFile(file, ':root { --accent: red; }')
	const index = new ClassIndex(root)
	const filename = join(root, 'app/Page.meeko')
	const document = doc(component('.page { color: var(--accent); }'), filename)
	const position = document.positionAt(document.getText().indexOf('var(--accent)') + 6)
	const view = () => classView(document, filename, index)
	assert.ok(cssVariableCompletion(document, position, view)?.some(({ label }) => label === '--accent'))
	await writeFile(file, ':root { --accent: blue; /* incomplete')
	index.filesChanged([file])
	assert.ok(cssVariableCompletion(document, position, view)?.some(({ label }) => label === '--accent'))
	assert.equal(cssVariableDefinition(document, position, view), undefined)
	assert.match((cssVariableHover(document, position, view)!.contents as MarkupContent).value, /última versión CSS válida/)
})

test('the first completion recovers local declarations before an unfinished var expression', () => {
	const at = cursor(component('.page { --local: green; color: var(--|'))
	const document = doc(at.source)
	const view = () => classView(document)
	const position = document.positionAt(at.offset)
	const suggestions = cssVariableCompletion(document, position, view)!
	assert.ok(suggestions.some(({ label }) => label === '--local'))
	const resolved = resolveCssVariableCompletion(
		suggestions.find(({ label }) => label === '--local')!,
		view(),
	)
	assert.match((resolved.documentation as MarkupContent).value, /green/)
	assert.match((resolved.documentation as MarkupContent).value, /CSS incompleto/)
	const comment = cursor(component('/* --fake: red; } */ .page { color: var(--|'))
	const commentDocument = doc(comment.source)
	assert.ok(!cssVariableCompletion(commentDocument, commentDocument.positionAt(comment.offset), () => classView(commentDocument))?.some(({ label }) => label === '--fake'))
})

test('LSP completes, resolves, hovers and navigates global variables in restricted workspaces', async (context) => {
	const root = await tempProject(context, 'css-variable-protocol')
	await mkdir(join(root, 'app/styles'), { recursive: true })
	await writeFile(join(root, 'package.json'), '{"private":true,"type":"module"}')
	await writeFile(join(root, 'meeko.config.ts'), 'throw new Error("must not run"); export default {};')
	const stylesheet = join(root, 'app/styles/main.css')
	await writeFile(stylesheet, ':root { --accent: #123456; }')
	let text = component('.page { color: var(--accent); }')
	const filename = join(root, 'Page.meeko'),
		uri = pathToFileURL(filename).href
	await writeFile(filename, text)
	const toServer = new PassThrough(),
		toClient = new PassThrough()
	const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient))
	startLanguageServer(server)
	server.listen()
	const client = createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer))
	client.onNotification(PublishDiagnosticsNotification.type, () => undefined)
	client.onNotification('window/logMessage', () => undefined)
	client.listen()
	context.after(async () => {
		await client.sendRequest(ShutdownRequest.type)
		client.dispose()
		server.dispose()
	})
	const initialized = (await client.sendRequest(InitializeRequest.type, {
		processId: null,
		rootUri: pathToFileURL(root).href,
		capabilities: { textDocument: { completion: { completionList: { itemDefaults: ['editRange', 'data'] } } } },
		initializationOptions: { trusted: false, projectContracts: false, diagnosticsDelay: 60_000 },
	})) as InitializeResult
	assert.ok(initialized.capabilities.completionProvider?.triggerCharacters?.includes('-'))
	await client.sendNotification(InitializedNotification.type, {})
	await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: 'meeko', version: 1, text } })
	const position = () => doc(text, filename).positionAt(text.indexOf('var(--accent)') + 6)
	const complete = async () => {
		const result = (await client.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: position() })) as CompletionList | CompletionItem[]
		const items = Array.isArray(result) ? result : result.items
		return items.map((item) => ({ ...item, data: (Array.isArray(result) ? undefined : result.itemDefaults?.data) ?? item.data }))
	}
	const suggestion = (await complete()).find(({ label }) => label === '--accent')!
	assert.ok(suggestion)
	const resolved = await client.sendRequest(CompletionResolveRequest.type, suggestion)
	assert.match((resolved.documentation as MarkupContent).value, /#123456/)
	const hover = (await client.sendRequest(HoverRequest.type, { textDocument: { uri }, position: position() })) as Hover
	assert.match((hover.contents as MarkupContent).value, /--accent/)
	const locations = (await client.sendRequest(DefinitionRequest.type, { textDocument: { uri }, position: position() })) as Location[]
	assert.equal(locations[0]!.uri, pathToFileURL(stylesheet).href)
	await writeFile(stylesheet, ':root { --replacement: blue; }')
	await client.sendNotification(DidChangeWatchedFilesNotification.type, { changes: [{ uri: pathToFileURL(stylesheet).href, type: FileChangeType.Changed }] })
	assert.ok((await complete()).some(({ label }) => label === '--replacement'))
	text = component(':root { --unsaved: green; } .page { color: var(--accent); }')
	await client.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { uri, version: 2 }, contentChanges: [{ text }] })
	assert.ok((await complete()).some(({ label }) => label === '--unsaved'))
	for (const [index, template] of ['<p style="color: var(--accent)">Hi</p>', '<p bind:style="\'color: var(--accent)\'">Hi</p>'].entries()) {
		text = component('', template)
		await client.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { uri, version: 3 + index }, contentChanges: [{ text }] })
		assert.ok(
			(await complete()).some(({ label }) => label === '--replacement'),
			template,
		)
	}
})
