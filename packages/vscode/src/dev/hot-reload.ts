import * as vscode from 'vscode'

import { createReloadScheduler, reloadPattern } from './reload-scheduler'

/**
 * Recarga la ventana del Extension Development Host cuando cambian la gramática, los snippets,
 * el manifiesto o `dist/`. Sólo actúa en modo desarrollo (F5); no hace nada instalada ni en las
 * pruebas del host. Usa el observador de VS Code, que en Remote - WSL corre dentro de Linux.
 * @param context Contexto de activación de la extensión.
 */
export function setupHotReload(context: vscode.ExtensionContext): void {
	if (context.extensionMode !== vscode.ExtensionMode.Development) return

	const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(context.extensionUri, reloadPattern))
	const scheduler = createReloadScheduler(() => {
		void vscode.commands.executeCommand('workbench.action.reloadWindow')
	})
	const schedule = () => scheduler.schedule()

	context.subscriptions.push(watcher, watcher.onDidChange(schedule), watcher.onDidCreate(schedule), watcher.onDidDelete(schedule), scheduler)
}
