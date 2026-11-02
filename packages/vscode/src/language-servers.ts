import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node'

import * as vscode from 'vscode'
import { LanguageClient, Trace, TransportKind } from 'vscode-languageclient/node'

import type { ResolvedLanguageServer } from './server-resolution'

import { resolveLanguageServer } from './server-resolution'

interface RunningServer {
	readonly client: LanguageClient
	readonly resolution: ResolvedLanguageServer
	readonly traceListener?: vscode.Disposable
}

/** Owns one language client per workspace folder so projects can use different Meeko versions. */
export class LanguageServers {
	private readonly running = new Map<string, RunningServer>()
	private pending: Promise<void> = Promise.resolve()
	private disposed = false

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly output: vscode.LogOutputChannel,
		private readonly codeLenses: (lenses: vscode.CodeLens[], client: LanguageClient) => vscode.CodeLens[],
		private readonly changed: () => void,
	) {}

	get first(): ResolvedLanguageServer | undefined {
		return this.running.values().next().value?.resolution
	}

	clientFor(uri: vscode.Uri): LanguageClient | undefined {
		return this.running.get(vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() ?? 'global')?.client
	}

	resolutionFor(uri: vscode.Uri): ResolvedLanguageServer | undefined {
		return this.running.get(vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() ?? 'global')?.resolution
	}

	/** Serialize restarts caused by trust, configuration and workspace changes. */
	refresh(): Promise<void> {
		if (this.disposed) return this.pending
		this.pending = this.pending
			.catch((error: unknown) => {
				this.output.error(`No se pudo iniciar el servidor de Meeko: ${String(error)}`)
			})
			.then(() => this.restart())
		return this.pending
	}

	private async restart(): Promise<void> {
		await this.stop()
		if (this.disposed) return
		const folders = vscode.workspace.workspaceFolders ?? []
		const targets: readonly (vscode.WorkspaceFolder | undefined)[] = folders.length ? folders : [undefined]
		try {
			for (const [index, folder] of targets.entries()) {
				const trusted = vscode.workspace.isTrusted
				const resolution = resolveLanguageServer({
					folders: folder?.uri.scheme === 'file' ? [folder.uri.fsPath] : [],
					bundled: this.context.asAbsolutePath('dist/server.js'),
					preferWorkspace: trusted && (folder === undefined || folder.uri.scheme === 'file') && vscode.workspace.getConfiguration('meeko', folder?.uri).get<boolean>('languageServer.preferWorkspace', true),
				})
				const key = folder?.uri.toString() ?? 'global'
				const serverOptions: ServerOptions = {
					run: { module: resolution.module, transport: TransportKind.ipc },
					debug: { module: resolution.module, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', `--inspect=${6009 + index}`] } },
				}
				const clientOptions: LanguageClientOptions = {
					documentSelector: [{ language: 'meeko', scheme: folder?.uri.scheme ?? '*', ...(folder ? { pattern: { baseUri: folder.uri.toString(), pattern: '**/*.meeko' } } : {}) }],
					...(folder ? { workspaceFolder: folder } : {}),
					initializationOptions: { trusted, classes: { completion: vscode.workspace.getConfiguration('meeko', folder?.uri).get<string>('classes.completion', 'auto'), tailwindActive: vscode.extensions.getExtension('bradlc.vscode-tailwindcss')?.isActive === true } },
					outputChannel: this.output,
					middleware: {
						workspace: {
							configuration: async (params, token, next) => {
								const values = await next(params, token)
								if (!Array.isArray(values)) return values
								return values.map((value: unknown, index: number) => (params.items[index]?.section === 'meeko.classes' ? { ...(value && typeof value === 'object' ? value : {}), tailwindActive: vscode.extensions.getExtension('bradlc.vscode-tailwindcss')?.isActive === true } : value))
							},
						},
						provideCodeLenses: async (document, token, next) => {
							const lenses = await next(document, token)
							const current = this.running.get(key)?.client
							return lenses && current ? this.codeLenses(lenses, current) : lenses
						},
					},
				}
				const client = new LanguageClient('meeko', `Meeko (${folder?.name ?? 'global'})`, serverOptions, clientOptions)
				this.output.info(`Servidor de Meeko [${folder?.name ?? 'global'}]: ${resolution.source} ${resolution.module}${resolution.version ? ` (${resolution.version})` : ''}${resolution.reason ? `; ${resolution.reason}` : ''}`)
				this.running.set(key, { client, resolution })
				await client.start()
				const configuredTrace = (): Trace => Trace.fromString(vscode.workspace.getConfiguration('meeko').get<string>('trace.server', 'off'))
				await client.setTrace(configuredTrace())
				const traceListener = vscode.workspace.onDidChangeConfiguration((event) => {
					if (!event.affectsConfiguration('meeko.trace.server')) return
					void client.setTrace(configuredTrace()).catch((error: unknown) => this.output.warn(`No se pudo actualizar el trace de Meeko: ${String(error)}`))
				})
				this.running.set(key, { client, resolution, traceListener })
			}
		} catch (error) {
			await this.stop()
			throw error
		} finally {
			this.changed()
		}
	}

	private async stop(): Promise<void> {
		const clients = [...this.running.values()].map((entry) => {
			entry.traceListener?.dispose()
			return entry.client
		})
		this.running.clear()
		await Promise.all(
			clients.map(async (client) => {
				try {
					await client.stop()
				} catch (error) {
					this.output.warn(`No se pudo detener un servidor de Meeko: ${String(error)}`)
				}
			}),
		)
	}

	async dispose(): Promise<void> {
		this.disposed = true
		await this.pending.catch(() => undefined)
		await this.stop()
	}
}
