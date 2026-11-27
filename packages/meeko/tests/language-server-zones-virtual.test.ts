import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { createConnection, createProtocolConnection, DidChangeTextDocumentNotification, DidCloseTextDocumentNotification, DidOpenTextDocumentNotification, InitializedNotification, InitializeRequest, PublishDiagnosticsNotification, ShutdownRequest, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver/node'

import { ExecutionZonesRequest, startLanguageServer } from '../src/language-server/server.ts'

const component = `<script server lang="ts">
export const answer = 42;
</script>
<script lang="ts">
const value = 1;
onMounted(() => {
  console.log(value);
});
</script>
<template><p>{value}</p></template>
`

// The editors open documents that are not on disk (`vscode-vfs`, `untitled`, a custom file system):
// the server models each one in an isolated project, so the zones must not depend on the scheme.
test('the server answers meeko/executionZones for open documents that are not on disk', { timeout: 120_000 }, async () => {
	const toServer = new PassThrough()
	const toClient = new PassThrough()
	const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient))
	startLanguageServer(server)
	server.listen()
	const client = createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer))
	client.onNotification('window/logMessage', () => undefined)
	client.onNotification(PublishDiagnosticsNotification.type, () => undefined)
	client.listen()
	try {
		await client.sendRequest(InitializeRequest.type, {
			processId: null,
			rootUri: null,
			workspaceFolders: null,
			capabilities: {},
			initializationOptions: { trusted: false, projectContracts: false, diagnosticsDelay: 0 },
		})
		await client.sendNotification(InitializedNotification.type, {})
		for (const uri of ['vscode-vfs://github/meekojs/example/app/components/Plain.meeko', 'untitled:/Plain.meeko', 'meeko-test://repository/project/Plain.meeko']) {
			await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: 'meeko', version: 1, text: component } })
			const zones = await client.sendRequest(ExecutionZonesRequest, { textDocument: { uri } })
			assert.deepEqual(
				zones?.zones.map((zone) => [zone.kind, zone.reason, zone.range.start.line, zone.range.end.line]),
				[
					['server', 'server-block', 0, 2],
					['shared', 'setup', 3, 4],
					['browser', 'onMounted', 5, 7],
					['shared', 'setup', 8, 8],
				],
				uri,
			)
			assert.deepEqual(zones?.zones[0]!.range.end, { line: 2, character: '</script>'.length }, uri)
			// The zones follow the open text, not a file.
			await client.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { uri, version: 2 }, contentChanges: [{ text: component.replace(/onMounted[\s\S]*?\}\);\n/, '') }] })
			const edited = await client.sendRequest(ExecutionZonesRequest, { textDocument: { uri } })
			assert.deepEqual(
				edited?.zones.map((zone) => [zone.kind, zone.range.start.line, zone.range.end.line]),
				[
					['server', 0, 2],
					['shared', 3, 5],
				],
				uri,
			)
			await client.sendNotification(DidCloseTextDocumentNotification.type, { textDocument: { uri } })
			assert.equal(await client.sendRequest(ExecutionZonesRequest, { textDocument: { uri } }), null, `${uri}: a closed document has no zones`)
		}
		// A virtual document that is not a component, or that the server never received, has no zones.
		await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri: 'untitled:Untitled-1', languageId: 'meeko', version: 1, text: component } })
		assert.equal(await client.sendRequest(ExecutionZonesRequest, { textDocument: { uri: 'untitled:Untitled-1' } }), null)
		assert.equal(await client.sendRequest(ExecutionZonesRequest, { textDocument: { uri: 'vscode-vfs://github/meekojs/example/Missing.meeko' } }), null)
	} finally {
		await client.sendRequest(ShutdownRequest.type)
		client.dispose()
		server.dispose()
	}
})
