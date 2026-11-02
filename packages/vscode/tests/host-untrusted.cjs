const assert = require('node:assert/strict')
const path = require('node:path')
const vscode = require('vscode')

exports.run = async function run() {
	assert.equal(vscode.workspace.isTrusted, false, 'The test host must be in Restricted Mode')
	const folder = vscode.workspace.workspaceFolders?.[0]
	assert.ok(folder, 'The temporary workspace must be open')
	const uri = vscode.Uri.file(path.join(folder.uri.fsPath, 'Counter.meeko'))
	const document = await vscode.workspace.openTextDocument(uri)
	assert.equal(document.languageId, 'meeko')

	const extension = vscode.extensions.getExtension('meekojs.meeko-language')
	assert.ok(extension, 'The Meeko extension must be available in the test host')
	const api = await extension.activate()
	const selected = api.serverFor(uri)
	assert.equal(selected?.source, 'bundled', JSON.stringify(selected))
	const bundledPath = path.join(extension.extensionPath, 'dist', 'server.js')
	assert.equal(process.platform === 'win32' ? selected.module.toLowerCase() : selected.module, process.platform === 'win32' ? bundledPath.toLowerCase() : bundledPath)
	assert.match(selected.reason, /workspace no es de confianza/)

	await vscode.window.showTextDocument(document)
	for (let attempt = 0; attempt < 60; attempt++) {
		if (vscode.languages.getDiagnostics(uri).some((item) => item.code === 'TS2322')) break
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	assert.ok(
		vscode.languages.getDiagnostics(uri).some((item) => item.code === 'TS2322'),
		'The bundled language server must answer diagnostics',
	)
	assert.equal(api.live.connected, false)
	assert.equal(api.live.connections, 0)
	assert.equal(api.live.status, undefined)
	assert.deepEqual(api.live.decorations(uri), [])
	process.stdout.write('Meeko untrusted host: Restricted Mode, bundled server and live disabled verified.\n')
}
