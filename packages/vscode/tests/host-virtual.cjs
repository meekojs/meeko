const assert = require('node:assert/strict')
const vscode = require('vscode')

exports.run = async function run() {
	const scheme = 'meeko-test'
	const root = vscode.Uri.parse(`${scheme}://repository/project`)
	const uri = vscode.Uri.joinPath(root, 'Counter.meeko')
	const source = '<script lang="ts">const count: number = "bad";</script><template><p>{count}</p></template>'
	let bytes = new TextEncoder().encode(source)
	const changes = new vscode.EventEmitter()
	const provider = vscode.workspace.registerFileSystemProvider(scheme, {
		onDidChangeFile: changes.event,
		stat: (item) => (item.toString() === root.toString() ? { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 } : { type: vscode.FileType.File, ctime: 0, mtime: 0, size: bytes.length }),
		readDirectory: () => [['Counter.meeko', vscode.FileType.File]],
		readFile: () => bytes,
		watch: () => new vscode.Disposable(() => undefined),
		createDirectory: () => {
			throw vscode.FileSystemError.NoPermissions()
		},
		writeFile: (item, content) => {
			if (item.toString() !== uri.toString()) throw vscode.FileSystemError.FileNotFound(item)
			bytes = content
			changes.fire([{ type: vscode.FileChangeType.Changed, uri: item }])
		},
		delete: () => {
			throw vscode.FileSystemError.NoPermissions()
		},
		rename: () => {
			throw vscode.FileSystemError.NoPermissions()
		},
	})
	try {
		const index = vscode.workspace.workspaceFolders?.length ?? 0
		assert.ok(vscode.workspace.updateWorkspaceFolders(index, 0, { uri: root, name: 'Virtual Meeko' }))
		for (let attempt = 0; attempt < 40 && !vscode.workspace.getWorkspaceFolder(uri); attempt++) await new Promise((resolve) => setTimeout(resolve, 100))
		assert.ok(vscode.workspace.getWorkspaceFolder(uri), `Virtual folder must be registered: ${JSON.stringify({ uri: uri.toString(), folders: vscode.workspace.workspaceFolders?.map((item) => item.uri.toString()) })}`)
		const document = await vscode.workspace.openTextDocument(uri)
		assert.equal(document.languageId, 'meeko')
		const extension = vscode.extensions.getExtension('meekojs.meeko-language')
		assert.ok(extension)
		const api = await extension.activate()
		for (let attempt = 0; attempt < 40 && api.serverFor(uri)?.source !== 'bundled'; attempt++) await new Promise((resolve) => setTimeout(resolve, 100))
		assert.equal(api.serverFor(uri)?.source, 'bundled')
		const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri)
		assert.ok(
			symbols?.some((symbol) => symbol.name === '<script>'),
			JSON.stringify(symbols),
		)
		const hover = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, document.positionAt(source.indexOf('count:') + 2))
		assert.ok(hover?.length, 'Hover must work for a virtual Meeko document')
		let diagnostics = []
		for (let attempt = 0; attempt < 60; attempt++) {
			diagnostics = vscode.languages.getDiagnostics(uri)
			if (diagnostics.some((item) => item.code === 'TS2322')) break
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		assert.ok(
			diagnostics.some((item) => item.code === 'TS2322'),
			JSON.stringify(diagnostics),
		)
		const replacement = new vscode.WorkspaceEdit()
		replacement.replace(uri, new vscode.Range(document.positionAt(source.indexOf('"bad"')), document.positionAt(source.indexOf('"bad"') + 5)), '1')
		assert.ok(await vscode.workspace.applyEdit(replacement))
		for (let attempt = 0; attempt < 60 && vscode.languages.getDiagnostics(uri).some((item) => item.code === 'TS2322'); attempt++) await new Promise((resolve) => setTimeout(resolve, 100))
		assert.ok(!vscode.languages.getDiagnostics(uri).some((item) => item.code === 'TS2322'), 'Diagnostics must update after didChange')
		const insertion = new vscode.WorkspaceEdit()
		insertion.insert(uri, document.positionAt(document.getText().indexOf('</script>')), ' const message = "hi"; message.')
		assert.ok(await vscode.workspace.applyEdit(insertion))
		const completion = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, document.positionAt(document.getText().indexOf('message.') + 'message.'.length))
		assert.ok(
			completion?.items.some((item) => item.label === 'length'),
			'Local TypeScript completion must work',
		)
	} finally {
		provider.dispose()
		changes.dispose()
	}
}
