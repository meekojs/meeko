import type { LanguageClient } from 'vscode-languageclient/node'

import * as vscode from 'vscode'

import type { MeekoLiveApi } from './live/controller'
import type { ResolvedLanguageServer } from './server-resolution'
import type { ServerState, ServerStatus } from './status'
import type { ExecutionZoneItem } from './zones'

import { registerAutoClosingTags } from './auto-close'
import { registerScaffoldCommands } from './commands'
import { setupHotReload } from './dev/hot-reload'
import { setTranslator, t } from './l10n'
import { LanguageServers } from './language-servers'
import { registerLiveValues } from './live/controller'
import { registerSnippetCompletion } from './snippets'
import { restartCommand, serverStatus, showOutputCommand } from './status'
import { ExecutionZoneDecorations, executionZonesRequest } from './zones'

/** API que devuelve la activación; las pruebas la usan para saber qué servidor se eligió. */
export interface MeekoExtensionApi {
	readonly server: ResolvedLanguageServer | undefined
	/** Server selected for a file in a multi-root workspace. */
	serverFor(uri: vscode.Uri): ResolvedLanguageServer | undefined
	/** Estado del servidor que atiende un archivo, también si no arrancó. */
	serverState(uri: vscode.Uri): ServerState | undefined
	/** Lo que muestra el indicador de estado del lenguaje para el editor activo. */
	readonly status: ServerStatus | undefined
	/** Zonas de ejecución decoradas en un documento, o `undefined` si aún no se pidieron. */
	executionZones(uri: vscode.Uri): readonly ExecutionZoneItem[] | undefined
	/** Valores en vivo de `meeko dev`. */
	readonly live: MeekoLiveApi
}

let zones: ExecutionZoneDecorations | undefined
let servers: LanguageServers | undefined

/** VS Code's command behind the reference lenses of the server. */
const showReferences = 'editor.action.showReferences'

/**
 * The server sends `editor.action.showReferences` with LSP arguments; VS Code's command needs a
 * `Uri`, a `Position` and `Location`s.
 */
function referenceLens(lens: vscode.CodeLens, current: LanguageClient): vscode.CodeLens {
	const command = lens.command
	if (command?.command !== showReferences || !Array.isArray(command.arguments) || typeof command.arguments[0] !== 'string') return lens
	const [uri, position, locations] = command.arguments as [string, { line: number; character: number }, Parameters<LanguageClient['protocol2CodeConverter']['asLocation']>[0][]]
	const converter = current.protocol2CodeConverter
	lens.command = {
		...command,
		arguments: [converter.asUri(uri), converter.asPosition(position), (locations ?? []).map((location) => converter.asLocation(location))],
	}
	return lens
}

/** Indicador del lenguaje con el servidor que atiende el editor activo. */
function registerServerStatus(state: (uri: vscode.Uri) => ServerState | undefined): { readonly current: () => ServerStatus | undefined; readonly update: () => void } & vscode.Disposable {
	const item = vscode.languages.createLanguageStatusItem('meeko.languageServer', { language: 'meeko' })
	item.name = t('Meeko Language Server')
	let shown: ServerStatus | undefined
	const update = (): void => {
		const document = vscode.window.activeTextEditor?.document
		shown = serverStatus(document?.languageId === 'meeko' ? state(document.uri) : undefined)
		item.text = shown.text
		item.detail = shown.detail
		item.severity = shown.severity === 'error' ? vscode.LanguageStatusSeverity.Error : vscode.LanguageStatusSeverity.Information
		item.busy = shown.busy
		item.command = shown.command
	}
	update()
	const listener = vscode.window.onDidChangeActiveTextEditor(update)
	return {
		current: () => shown,
		update,
		dispose: () => {
			listener.dispose()
			item.dispose()
		},
	}
}

/** Arranca el cliente del servidor de lenguaje Meeko; la lógica del lenguaje vive en el servidor. */
export async function activate(context: vscode.ExtensionContext): Promise<MeekoExtensionApi> {
	setupHotReload(context)

	// Before any text is shown: the pure modules translate through `t`, which has no `vscode` import.
	setTranslator(vscode.l10n.t)
	const output = vscode.window.createOutputChannel('Meeko', { log: true })
	context.subscriptions.push(output)
	const current = new LanguageServers(
		context,
		output,
		(lenses, client) => lenses.map((lens) => referenceLens(lens, client)),
		(settled) => {
			if (settled) zones?.refreshVisible()
			status.update()
		},
	)
	servers = current
	const status = registerServerStatus((uri) => current.stateFor(uri))
	const refresh = (force = false): Promise<void> => current.refresh(force).catch((error: unknown) => output.error(`No se pudo reiniciar Meeko: ${String(error)}`))
	// Nothing below needs a running server: a server that fails to start leaves all of it working.
	context.subscriptions.push(
		status,
		registerSnippetCompletion(),
		registerAutoClosingTags((uri) => servers?.clientFor(uri)),
		registerScaffoldCommands(),
		vscode.commands.registerCommand(restartCommand, () => refresh(true)),
		vscode.commands.registerCommand(showOutputCommand, () => output.show()),
		vscode.workspace.onDidGrantWorkspaceTrust(() => void refresh()),
		vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()),
		vscode.workspace.onDidOpenTextDocument((document) => current.documentOpened(document)),
		vscode.workspace.onDidCloseTextDocument((document) => current.documentClosed(document)),
		// One formatter for every `.meeko`: each client would register its own for documents of another.
		vscode.languages.registerDocumentFormattingEditProvider({ language: 'meeko' }, { provideDocumentFormattingEdits: (document, options, token) => current.formattingEdits(document, options, token) }),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('meeko.languageServer')) void refresh()
		}),
		{
			dispose: () => {
				zones?.dispose()
				zones = undefined
			},
		},
	)
	const api: MeekoExtensionApi = {
		get server() {
			return servers?.first
		},
		serverFor: (uri) => servers?.resolutionFor(uri),
		serverState: (uri) => servers?.stateFor(uri),
		get status() {
			return status.current()
		},
		executionZones: (uri) => zones?.applied.get(uri.toString()),
		live: registerLiveValues(context, output),
	}
	// An older workspace server has no zones; it answers the request with an error, shown as no zones.
	zones = new ExecutionZoneDecorations(context.extensionUri, (uri) => {
		const client = servers?.clientFor(vscode.Uri.parse(uri))
		return client ? client.sendRequest<{ zones: ExecutionZoneItem[] } | null>(executionZonesRequest, { textDocument: { uri } }) : Promise.resolve(null)
	})
	// A failed start is reported by `LanguageServers` and never rejects the activation.
	await refresh()
	return api
}

/** Detiene el servidor de lenguaje al desactivar la extensión. */
export async function deactivate(): Promise<void> {
	zones?.dispose()
	zones = undefined
	await servers?.dispose()
	servers = undefined
}
