import * as vscode from 'vscode'

import type { ScaffoldFile, ScaffoldKind } from './scaffold'

import { t } from './l10n'
import { clickedFolder, componentFile, endpointFiles, endpointMethods, indentUnit, pageFile, projectRootOf, scaffoldContextKey, scaffoldPrefill, schemaLibrary, takenFile, writtenContent } from './scaffold'

/** The Meeko project of the active file or, without one, of the first workspace folder that is a project. */
function currentProject(): string | undefined {
	const active = vscode.window.activeTextEditor?.document.uri
	const fromActive = active?.scheme === 'file' ? projectRootOf(active.fsPath) : undefined
	if (fromActive) return fromActive
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const root = projectRootOf(folder.uri.fsPath)
		if (root) return root
	}
	return undefined
}

/** The project and folder of a resource clicked in the explorer; `undefined` from the palette or outside a project. */
function clickedTarget(resource: unknown): undefined | { root: string; folder: string } {
	if (!(resource instanceof vscode.Uri) || resource.scheme !== 'file') return undefined
	const folder = clickedFolder(resource.fsPath)
	const root = projectRootOf(folder)
	return root ? { root, folder } : undefined
}

/** The indentation of `.meeko` files in this workspace: a tab, or the configured spaces. */
function indentation(root: string): string {
	const editor = vscode.workspace.getConfiguration('editor', { languageId: 'meeko', uri: vscode.Uri.file(root) })
	return indentUnit(editor.get<boolean>('insertSpaces', true), editor.get<number>('tabSize', 2))
}

/** Writes the files, never over an existing one, and opens the first. */
async function write(files: readonly ScaffoldFile[]): Promise<void> {
	const taken = takenFile(files)
	if (taken) {
		void vscode.window.showErrorMessage(t('{0} already exists', vscode.workspace.asRelativePath(taken.path)))
		return
	}
	for (const file of files) {
		const uri = vscode.Uri.file(file.path)
		const previous = file.append ? new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)) : ''
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(writtenContent(file, previous)))
	}
	await vscode.window.showTextDocument(vscode.Uri.file(files[0]!.path))
}

/**
 * Runs a scaffold with the project of the resource clicked in the explorer or, without one, of the
 * active file; reports a missing project or invalid input. `prefill` is the initial value of the
 * input box that the clicked folder implies.
 */
async function scaffold(kind: ScaffoldKind, resource: unknown, build: (root: string, prefill: string | undefined) => Promise<readonly ScaffoldFile[] | string | undefined>): Promise<void> {
	const clicked = clickedTarget(resource)
	const root = clicked?.root ?? currentProject()
	if (!root) {
		void vscode.window.showErrorMessage(t('No Meeko project is open (a folder with meeko.config.ts or app/pages).'))
		return
	}
	const files = await build(root, clicked ? scaffoldPrefill(kind, root, clicked.folder) : undefined)
	if (files === undefined) return
	if (typeof files === 'string') {
		void vscode.window.showErrorMessage(files)
		return
	}
	await write(files)
}

/** «Meeko: nuevo componente», «nueva página» y «nuevo endpoint de API». */
export function registerScaffoldCommands(): vscode.Disposable {
	// A prefilled value is a prefix to complete: the cursor goes after it and it is not reported as invalid until edited.
	const ask = (prompt: string, placeHolder: string, value: string | undefined, check: (value: string) => string | undefined) =>
		vscode.window.showInputBox({
			prompt,
			placeHolder,
			...(value === undefined ? {} : { value, valueSelection: [value.length, value.length] as [number, number] }),
			validateInput: (input) => (input.trim() && input !== value ? check(input) : undefined),
		})
	// The explorer menu entries of package.json show while this context key is set: the extension only activates for Meeko.
	void vscode.commands.executeCommand('setContext', scaffoldContextKey, true)
	return vscode.Disposable.from(
		{ dispose: () => void vscode.commands.executeCommand('setContext', scaffoldContextKey, false) },
		vscode.commands.registerCommand('meeko.newComponent', (resource?: unknown) =>
			scaffold('component', resource, async (root, prefill) => {
				const name = await ask(t('Component name'), t('AppCard or App/Card'), prefill, (value) => {
					const file = componentFile(root, value)
					return typeof file === 'string' ? file : undefined
				})
				if (!name) return undefined
				const file = componentFile(root, name, indentation(root))
				return typeof file === 'string' ? file : [file]
			}),
		),
		vscode.commands.registerCommand('meeko.newPage', (resource?: unknown) =>
			scaffold('page', resource, async (root, prefill) => {
				const route = await ask(t('Page route'), '/users/[id]', prefill, (value) => {
					const file = pageFile(root, value)
					return typeof file === 'string' ? file : undefined
				})
				if (!route) return undefined
				const file = pageFile(root, route, indentation(root))
				return typeof file === 'string' ? file : [file]
			}),
		),
		vscode.commands.registerCommand('meeko.newEndpoint', (resource?: unknown) =>
			scaffold('endpoint', resource, async (root, prefill) => {
				const library = schemaLibrary(root)
				if (!library) return t('Endpoints need public schemas: install valibot or zod in the project.')
				const picked = await vscode.window.showQuickPick([...endpointMethods], { placeHolder: t('HTTP method') })
				const method = endpointMethods.find((candidate) => candidate === picked)
				if (!method) return undefined
				const route = await ask(t('Route of the {0} endpoint', method), '/users/[id]', prefill, (value) => {
					const files = endpointFiles(root, method, value, library)
					return typeof files === 'string' ? files : undefined
				})
				if (!route) return undefined
				return endpointFiles(root, method, route, library, indentation(root))
			}),
		),
	)
}
