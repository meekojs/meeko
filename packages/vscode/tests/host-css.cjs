const assert = require('node:assert/strict')
const vscode = require('vscode')

/** Verifica los registros CSS reales del cliente sin abrir ningún componente .meeko. */
exports.run = async function run() {
	const root = process.env.MEEKO_HOST_CONSUMER
	const uri = vscode.Uri.file(require('node:path').join(root, 'app/styles/utilities/variant.css'))
	const document = await vscode.workspace.openTextDocument(uri)
	await vscode.window.showTextDocument(document)
	assert.equal(document.languageId, 'css')
	const extension = vscode.extensions.getExtension('meekojs.meeko-language')
	const deadline = Date.now() + 20_000
	const position = document.positionAt(document.getText().indexOf('var(') + 6)
	const name = '--meeko-host-inverted'
	const complete = () => vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, position)
	let completions
	while (Date.now() < deadline) {
		completions = await complete()
		if (extension?.isActive && completions?.items.some((item) => item.label === name)) break
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	assert.ok(extension?.isActive, 'workspaceContains activates Meeko with CSS alone')
	assert.ok(
		completions?.items.some((item) => item.label === name),
		'CSS gets variables from imported @theme',
	)
	const hovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri, position)
	assert.ok(hovers.some((hover) => hover.contents.some((content) => content.value?.includes('CSS variable'))))
	const definitions = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position)
	assert.ok(definitions.some((location) => (location.uri ?? location.targetUri).fsPath.endsWith('tokens.css')))
	const config = vscode.workspace.getConfiguration('meeko', uri)
	await config.update('cssVariables.completion', false, vscode.ConfigurationTarget.Workspace)
	// La notificación de configuración se entrega de forma asíncrona al servidor.
	let disabled = false
	for (let attempt = 0; attempt < 40; attempt++) {
		if (!(await complete())?.items.some((item) => item.label === name)) {
			disabled = true
			break
		}
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	assert.ok(disabled, 'completion can be disabled without restarting')
	const remaining = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position)
	assert.ok(
		remaining.some((location) => (location.uri ?? location.targetUri).fsPath.endsWith('tokens.css')),
		'definition remains enabled',
	)
	const tokensUri = vscode.Uri.file(require('node:path').join(root, 'app/styles/tokens.css'))
	const tokens = await vscode.workspace.openTextDocument(tokensUri)
	const edit = new vscode.WorkspaceEdit()
	edit.insert(tokensUri, tokens.positionAt(tokens.getText().length), '\n:root { --meeko-host-unsaved: gold; }\n')
	assert.ok(await vscode.workspace.applyEdit(edit))
	await config.update('cssVariables.completion', true, vscode.ConfigurationTarget.Workspace)
	let unsaved = false
	for (let attempt = 0; attempt < 40; attempt++) {
		if ((await complete())?.items.some((item) => item.label === '--meeko-host-unsaved')) {
			unsaved = true
			break
		}
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	assert.ok(unsaved, 'unsaved imported CSS updates completions in another file')
	const references = await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, position)
	assert.ok(
		references.some((location) => location.uri.fsPath.endsWith('Example.meeko')),
		'references reach closed Meeko components from CSS',
	)
	assert.ok(
		references.some((location) => location.uri.fsPath.endsWith('tokens.css')),
		'references include the declaration',
	)
	await config.update('cssVariables.completion', false, vscode.ConfigurationTarget.Workspace)
	const renamed = '--meeko-host-renamed'
	const workspaceEdit = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', uri, position, renamed)
	assert.ok(workspaceEdit, 'rename stays available with completion disabled')
	assert.equal(workspaceEdit.entries().length, 3)
	assert.ok(await vscode.workspace.applyEdit(workspaceEdit), 'VS Code applies the versioned edits across CSS and Meeko')
	assert.ok(document.getText().includes(`var(${renamed})`))
	assert.ok(tokens.getText().includes(`${renamed}: #123456`))
	assert.ok(tokens.getText().includes('--meeko-host-unsaved: gold'), 'rename keeps unrelated unsaved changes')
	const componentUri = vscode.Uri.file(require('node:path').join(root, 'app/components/Example.meeko'))
	const component = await vscode.workspace.openTextDocument(componentUri)
	assert.equal((component.getText().match(/--meeko-host-renamed/g) ?? []).length, 2)
	assert.ok(!component.getText().includes(name))
	const renamedPosition = document.positionAt(document.getText().indexOf(renamed) + 4)
	const collision = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', uri, renamedPosition, '--meeko-host-unsaved')
	assert.ok(!collision || collision.entries().length === 0, 'the editor offers no edits for a name collision')
	await config.update('cssVariables.rename', false, vscode.ConfigurationTarget.Workspace)
	let renameDisabled = false
	for (let attempt = 0; attempt < 40; attempt++) {
		let result
		try {
			result = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', uri, renamedPosition, '--another-name')
		} catch (error) {
			if (!/can't be renamed/.test(String(error))) throw error
		}
		if (!result || result.entries().length === 0) {
			renameDisabled = true
			break
		}
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
	assert.ok(renameDisabled, 'rename has its own live setting')
	const remainingReferences = await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri, renamedPosition)
	assert.ok(
		remainingReferences.some((location) => location.uri.fsPath.endsWith('Example.meeko')),
		'reference lookup stays enabled',
	)
	console.log('PASS: CSS-only activation, completion, hover, definition, references, cross-file rename, collisions, independent settings and unsaved imports in real VS Code')
}
