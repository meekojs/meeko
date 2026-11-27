import type { LanguageClient } from 'vscode-languageclient/node'

import * as vscode from 'vscode'

import { tagCloseApplies, tagClosePosition, tagCloseTrigger } from './auto-close-trigger'

/** Petición del servidor de Meeko que devuelve la etiqueta de cierre como snippet (`$0</div>`). */
export const tagCompletionRequest = 'meeko/tagComplete'

/**
 * Cierra las etiquetas de la plantilla al escribir `>` o `</`, como la extensión de HTML de VS Code:
 * tras la pulsación, pide al servidor la etiqueta de cierre y la inserta si el cursor no se movió.
 * Se desactiva con `meeko.autoClosingTags`.
 */
export function registerAutoClosingTags(client: (uri: vscode.Uri) => LanguageClient | undefined): vscode.Disposable {
	let timer: ReturnType<typeof setTimeout> | undefined
	const listener = vscode.workspace.onDidChangeTextDocument((event) => {
		const { document } = event
		const reason = event.reason === vscode.TextDocumentChangeReason.Undo ? 'undo' : event.reason === vscode.TextDocumentChangeReason.Redo ? 'redo' : undefined
		const change = tagCloseTrigger({ languageId: document.languageId, reason, changes: event.contentChanges })
		if (!change) return
		const editor = vscode.window.activeTextEditor
		if (!editor || editor.document !== document) return
		if (!vscode.workspace.getConfiguration('meeko', document).get<boolean>('autoClosingTags', true)) return
		const start = tagClosePosition(change.range.start)
		const position = new vscode.Position(start.line, start.character)
		const version = document.version
		if (timer) clearTimeout(timer)
		timer = setTimeout(() => {
			timer = undefined
			const current = client(document.uri)
			if (!current) return
			void current
				.sendRequest<string | null>(tagCompletionRequest, {
					textDocument: { uri: document.uri.toString() },
					position: current.code2ProtocolConverter.asPosition(position),
				})
				.then(
					async (snippet) => {
						const active = vscode.window.activeTextEditor
						// Typing went on, or the cursor left the tag: the closing tag would land in the wrong place.
						const applies = tagCloseApplies({
							snippet,
							sameDocument: active?.document === document,
							requestedVersion: version,
							currentVersion: document.version,
							requestedPosition: position,
							cursor: active?.selection.active,
						})
						if (!snippet || !active || !applies) return
						await active.insertSnippet(new vscode.SnippetString(snippet), position)
					},
					() => undefined,
				)
		}, 100)
	})
	return {
		dispose: () => {
			if (timer) clearTimeout(timer)
			listener.dispose()
		},
	}
}
