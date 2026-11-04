import type { Diagnostic } from 'vscode-languageserver/node'

import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { CompletionRequest, createConnection, createProtocolConnection, DidChangeTextDocumentNotification, DidCloseTextDocumentNotification, DidOpenTextDocumentNotification, DocumentSymbolRequest, HoverRequest, InitializedNotification, InitializeRequest, PublishDiagnosticsNotification, ShutdownRequest, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node'

import { startLanguageServer } from '../src/language-server/server.ts'

test('virtual Meeko document receives single-file language features over LSP', async () => {
	const toServer = new PassThrough()
	const toClient = new PassThrough()
	const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient))
	startLanguageServer(server)
	server.listen()
	const client = createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer))
	const uri = 'meeko-test://repository/project/Counter.meeko'
	const diagnostics: Diagnostic[][] = []
	client.onNotification(PublishDiagnosticsNotification.type, (params) => {
		if (params.uri === uri) diagnostics.push(params.diagnostics)
	})
	const logs: unknown[] = []
	client.onNotification('window/logMessage', (entry) => {
		logs.push(entry)
	})
	client.listen()
	try {
		await client.sendRequest(InitializeRequest.type, {
			processId: null,
			rootUri: 'meeko-test://repository/project',
			workspaceFolders: [{ uri: 'meeko-test://repository/project', name: 'virtual' }],
			capabilities: {},
			initializationOptions: { trusted: false, projectContracts: false, diagnosticsDelay: 0 },
		})
		await client.sendNotification(InitializedNotification.type, {})
		const source = '<script lang="ts">const count: number = "bad";</script><template><p>{count}</p></template>'
		await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: 'meeko', version: 1, text: source } })
		const symbols = await client.sendRequest(DocumentSymbolRequest.type, { textDocument: { uri } })
		assert.ok(
			symbols?.some((symbol) => symbol.name === '<script>'),
			JSON.stringify(symbols),
		)
		const position = { line: 0, character: source.indexOf('count:') + 2 }
		const hover = await client.sendRequest(HoverRequest.type, { textDocument: { uri }, position })
		assert.ok(hover, `hover on a local symbol must work: ${JSON.stringify({ logs, diagnostics })}`)
		for (let attempt = 0; attempt < 40 && diagnostics.length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 50))
		assert.ok(
			diagnostics.at(-1)?.some((item) => item.code === 'TS2322'),
			JSON.stringify({ diagnostics, logs }),
		)
		const completionSource = '<script lang="ts">const message = "hi"; message.</script><template><p>{message}</p></template>'
		await client.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { uri, version: 2 }, contentChanges: [{ text: completionSource }] })
		const completion = await client.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: { line: 0, character: completionSource.indexOf('message.') + 'message.'.length } })
		const items = Array.isArray(completion) ? completion : completion?.items
		assert.ok(
			items?.some((item) => item.label === 'length'),
			JSON.stringify(items?.slice(0, 10)),
		)
		await client.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri } })
		await client.sendRequest(ShutdownRequest.type)
	} finally {
		client.dispose()
		server.dispose()
	}
})
