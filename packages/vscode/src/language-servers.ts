import type { ErrorHandler, InitializeParams, LanguageClientOptions, Middleware, ServerOptions } from 'vscode-languageclient/node'

import * as vscode from 'vscode'
import { CloseAction, ErrorAction, LanguageClient, State, Trace, TransportKind } from 'vscode-languageclient/node'

import type { ClassProviderInfo } from './class-providers'
import type { PlannedClient } from './folder-plan'
import type { ResolvedLanguageServer } from './server-resolution'
import type { ServerState } from './status'

import { classProvidersMethod, classSettingsForServer, legacyTailwindExtension, requestClassProviders } from './class-providers'
import { LooseDiagnostics, routeDiagnostics } from './diagnostic-owner'
import { freeSlot, globalKey, planClients, reconcileClients } from './folder-plan'
import { t } from './l10n'
import { resolveLanguageServer } from './server-resolution'

/** A client that exists for a folder; `failed` ones stay so a refresh does not retry them. */
interface ClientEntry {
	readonly key: string
	readonly name: string
	/** What the client was created from; a different one restarts it. */
	readonly signature: string
	/** Offset of the debug port. */
	readonly slot: number
	resolution: ResolvedLanguageServer
	state: ServerState['state']
	error: string | undefined
	client: LanguageClient | undefined
	/** The first start finished: from then on a closed connection restarts the server. */
	started: boolean
	stopping: boolean
	disposables: vscode.Disposable[]
}

/** A client that should exist, with everything its start needs. */
interface ClientTarget {
	readonly plan: PlannedClient
	readonly folder: vscode.WorkspaceFolder | undefined
	readonly name: string
	readonly trusted: boolean
	readonly configuration: vscode.WorkspaceConfiguration
	readonly resolution: ResolvedLanguageServer
	/** Schemes of the global client; a folder client uses the scheme of its folder. */
	readonly schemes: readonly string[]
	readonly signature: string
}

/** Schemes of the documents outside the workspace folders that the global client attends. */
const looseSchemes: readonly string[] = ['file', 'untitled']

/** Requests whose first argument is the document, or its URI, and whose last one is `next`. */
const documentRequests = [
	'provideCompletionItem',
	'provideHover',
	'provideSignatureHelp',
	'provideDefinition',
	'provideDeclaration',
	'provideTypeDefinition',
	'provideImplementation',
	'provideReferences',
	'provideDocumentHighlights',
	'provideDocumentSymbols',
	'provideCodeActions',
	'provideCodeLenses',
	'provideDocumentFormattingEdits',
	'provideDocumentRangeFormattingEdits',
	'provideDocumentRangesFormattingEdits',
	'provideOnTypeFormattingEdits',
	'provideRenameEdits',
	'prepareRename',
	'provideDocumentLinks',
	'provideDocumentColors',
	'provideFoldingRanges',
	'provideSelectionRanges',
	'provideLinkedEditingRange',
	'provideInlayHints',
	'provideInlineValues',
	'provideInlineCompletionItems',
	'provideDocumentSemanticTokens',
	'provideDocumentSemanticTokensEdits',
	'provideDocumentRangeSemanticTokens',
	'prepareCallHierarchy',
	'prepareTypeHierarchy',
	'provideDiagnostics',
] as const satisfies readonly (keyof Middleware)[]

/** Notifications of a document, or of an event that carries it. */
const documentNotifications = ['didOpen', 'didChange', 'willSave', 'didSave', 'didClose'] as const satisfies readonly (keyof Middleware)[]

function resourceOf(value: unknown): vscode.Uri {
	if (value instanceof vscode.Uri) return value
	const item = value as { uri?: vscode.Uri; document?: { uri: vscode.Uri } }
	return item.document?.uri ?? (item.uri as vscode.Uri)
}

/**
 * Every feature of a client matches documents with `languages.match` and its selector, and a
 * `RelativePattern` of a folder also matches the files of a folder nested in it; the server adds
 * selectors of its own for CSS. Only the middleware sees each document, so it drops what belongs
 * to another client: the document is never opened in this server nor asked about.
 */
function ownedDocuments(owns: (uri: vscode.Uri) => boolean): Middleware {
	const guard =
		(skipped: () => unknown) =>
		(...args: unknown[]): unknown => {
			const next = args.pop() as (...rest: unknown[]) => unknown
			return owns(resourceOf(args[0])) ? next(...args) : skipped()
		}
	const middleware: Record<string, unknown> = { willSaveWaitUntil: guard(() => Promise.resolve([])) }
	for (const name of documentRequests) middleware[name] = guard(() => undefined)
	for (const name of documentNotifications) middleware[name] = guard(() => Promise.resolve())
	return middleware as Middleware
}

/** Client of the documents outside the workspace folders: its server gets no folder of the workspace. */
class DetachedLanguageClient extends LanguageClient {
	protected override fillInitializeParams(params: InitializeParams): void {
		super.fillInitializeParams(params)
		params.rootPath = null
		params.rootUri = null
		params.workspaceFolders = null
	}
}

/** Whether the VS Code extension `id` is installed and active, as a class provider names it. */
function extensionActive(id: string): boolean {
	return vscode.extensions.getExtension(id)?.isActive === true
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** Initial settings for a server; it asks for them again with `workspace/configuration`. */
function initializationOptions(target: ClientTarget): Record<string, unknown> {
	const { configuration } = target
	const enabled = (name: string): boolean => configuration.get<boolean>(name, true)
	return {
		trusted: target.trusted,
		warmup: enabled('languageServer.warmup'),
		warmupFiles: openComponents(target.plan.key),
		classes: {
			completion: configuration.get<string>('classes.completion', 'auto'),
			hover: configuration.get<string>('classes.hover', 'auto'),
			definition: enabled('classes.definition'),
			// The class providers are not known before the server starts: workspace/configuration adds activeExtensions.
			tailwindActive: extensionActive(legacyTailwindExtension),
		},
		cssVariables: {
			completion: enabled('cssVariables.completion'),
			hover: enabled('cssVariables.hover'),
			definition: enabled('cssVariables.definition'),
			references: enabled('cssVariables.references'),
			rename: enabled('cssVariables.rename'),
		},
	}
}

function ownerOf(uri: vscode.Uri): string {
	return vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() ?? globalKey
}

/** A `.meeko` outside every workspace folder, which only the global client can attend. */
function looseComponent(document: vscode.TextDocument): boolean {
	return document.languageId === 'meeko' && looseSchemes.includes(document.uri.scheme) && ownerOf(document.uri) === globalKey
}

/**
 * `.meeko` files of a client open in tabs, also the tabs restored and not yet shown: the server
 * prepares their projects first, so the first colors do not wait for the TypeScript program.
 */
function openComponents(key: string): string[] {
	const files = vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => (tab.input instanceof vscode.TabInputText ? tab.input.uri : undefined)))
	return files.flatMap((uri) => (uri?.scheme === 'file' && uri.fsPath.endsWith('.meeko') && ownerOf(uri) === key ? [uri.fsPath] : []))
}

/**
 * Owns one language client per workspace folder, so projects can use different Meeko versions,
 * and a global one for the documents outside the folders. Each document belongs to one client:
 * the one of its innermost folder.
 */
export class LanguageServers {
	private readonly entries = new Map<string, ClientEntry>()
	/** Archivos sin carpeta cuyos diagnósticos publicó un servidor de carpeta antes de que existiera el global. */
	private readonly looseDiagnostics = new LooseDiagnostics()
	private pending: Promise<void> = Promise.resolve()
	private disposed = false

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly output: vscode.LogOutputChannel,
		private readonly codeLenses: (lenses: vscode.CodeLens[], client: LanguageClient) => vscode.CodeLens[],
		/** `settled` is `false` while servers start: there is state to show, but no server to ask yet. */
		private readonly changed: (settled: boolean) => void,
	) {}

	/** Server of the first folder that has one running. */
	get first(): ResolvedLanguageServer | undefined {
		const keys = [...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString()), globalKey]
		for (const key of keys) {
			const entry = this.entries.get(key)
			if (entry && entry.state !== 'failed') return entry.resolution
		}
		return undefined
	}

	clientFor(uri: vscode.Uri): LanguageClient | undefined {
		const entry = this.entries.get(ownerOf(uri))
		return entry?.state === 'failed' ? undefined : entry?.client
	}

	resolutionFor(uri: vscode.Uri): ResolvedLanguageServer | undefined {
		const entry = this.entries.get(ownerOf(uri))
		return entry?.state === 'failed' ? undefined : entry?.resolution
	}

	/** State of the server that attends a document, also when it failed to start. */
	stateFor(uri: vscode.Uri): ServerState | undefined {
		const entry = this.entries.get(ownerOf(uri))
		return entry ? { state: entry.state, resolution: entry.resolution, folder: entry.name, ...(entry.error === undefined ? {} : { error: entry.error }) } : undefined
	}

	/** The global client starts with the first `.meeko` opened outside the workspace folders. */
	documentOpened(document: vscode.TextDocument): void {
		if (this.disposed || this.entries.has(globalKey) || !looseComponent(document)) return
		void this.refresh()
	}

	/**
	 * Serializes the changes caused by trust, configuration and workspace folders. Only the clients
	 * whose folder, server or options changed restart; `force` restarts all of them. A server that
	 * fails to start does not reject: it stays as `failed` for {@link stateFor}.
	 */
	refresh(force = false): Promise<void> {
		if (this.disposed) return this.pending
		this.pending = this.pending
			.catch((error: unknown) => {
				this.output.error(`No se pudo iniciar el servidor de Meeko: ${String(error)}`)
			})
			.then(() => this.reconcile(force))
		return this.pending
	}

	private targets(): ClientTarget[] {
		const folders = vscode.workspace.workspaceFolders ?? []
		const byKey = new Map(folders.map((folder) => [folder.uri.toString(), folder]))
		const trusted = vscode.workspace.isTrusted
		const planned = planClients({ folders: [...byKey.keys()], looseDocuments: vscode.workspace.textDocuments.some(looseComponent) })
		return planned.map((plan) => {
			const folder = plan.folder === undefined ? undefined : byKey.get(plan.folder)
			const configuration = vscode.workspace.getConfiguration('meeko', folder?.uri)
			const local = folder === undefined || folder.uri.scheme === 'file'
			const resolution = resolveLanguageServer({
				folders: folder?.uri.scheme === 'file' ? [folder.uri.fsPath] : [],
				bundled: this.context.asAbsolutePath('dist/server.js'),
				preferWorkspace: trusted && local && configuration.get<boolean>('languageServer.preferWorkspace', true),
			})
			// Without folders the global client attends every scheme, as a single-file window always did.
			const schemes = folder ? [folder.uri.scheme] : folders.length ? looseSchemes : ['*']
			const signature = JSON.stringify([resolution.module, resolution.source, resolution.version, trusted, configuration.get<boolean>('languageServer.warmup', true), plan.excluded, schemes])
			return { plan, folder, name: folder?.name ?? globalKey, trusted, configuration, resolution, schemes, signature }
		})
	}

	private async reconcile(force: boolean): Promise<void> {
		if (this.disposed) return
		const targets = this.targets()
		const wanted = new Map(targets.map((target) => [target.plan.key, target.signature]))
		const running = new Map([...this.entries].map(([key, entry]) => [key, entry.signature]))
		const changes = reconcileClients(running, wanted, force)
		if (!changes.stop.length && !changes.start.length) return
		try {
			await Promise.all(changes.stop.map((key) => this.stop(key)))
			if (this.disposed) return
			// Independent: the failure of a folder does not stop the others.
			const starting = targets.filter((target) => changes.start.includes(target.plan.key)).map((target) => this.start(target))
			if (starting.length) this.changed(false)
			await Promise.all(starting)
		} finally {
			this.changed(true)
		}
	}

	private async start(target: ClientTarget): Promise<void> {
		const entry: ClientEntry = {
			key: target.plan.key,
			name: target.name,
			signature: target.signature,
			slot: freeSlot([...this.entries.values()].map((other) => other.slot)),
			resolution: target.resolution,
			state: 'starting',
			error: undefined,
			client: undefined,
			started: false,
			stopping: false,
			disposables: [],
		}
		this.entries.set(entry.key, entry)
		if (entry.key === globalKey) this.dropLooseDiagnostics()
		let failure: string
		try {
			await this.launch(entry, target)
			return
		} catch (error) {
			failure = describe(error)
			this.output.error(`No se pudo iniciar el servidor de Meeko [${entry.name}] (${entry.resolution.source} ${entry.resolution.module}): ${failure}`)
			await this.release(entry)
		}
		if (entry.resolution.source === 'workspace' && !this.disposed) {
			const workspacePackage = entry.resolution.version ? `@meekojs/meeko ${entry.resolution.version}` : '@meekojs/meeko'
			entry.resolution = { module: this.context.asAbsolutePath('dist/server.js'), source: 'bundled', reason: t('the workspace server of {0} failed to start: {1}', workspacePackage, failure) }
			entry.state = 'starting'
			try {
				await this.launch(entry, target)
				this.notify('warning', t('The language server of {0} in "{1}" failed to start; Meeko is using the one bundled with the extension.', workspacePackage, entry.name))
				return
			} catch (error) {
				failure = describe(error)
				this.output.error(`Tampoco arrancó el servidor incluido de Meeko [${entry.name}]: ${failure}`)
				await this.release(entry)
			}
		}
		entry.state = 'failed'
		entry.error = failure
		this.notify('error', t('The Meeko language server failed to start in "{0}": {1}', entry.name, failure))
	}

	/** Whether the global client exists and has not failed, so it attends the files outside the folders. */
	private globalActive(): boolean {
		const global = this.entries.get(globalKey)
		return global !== undefined && global.state !== 'failed'
	}

	/** The global client takes over the loose files: the folder clients stop showing theirs. */
	private dropLooseDiagnostics(): void {
		for (const [key, uris] of this.looseDiagnostics.takeAll()) {
			const diagnostics = this.entries.get(key)?.client?.diagnostics
			for (const uri of uris) diagnostics?.delete(vscode.Uri.parse(uri))
		}
	}

	private notify(kind: 'warning' | 'error', message: string): void {
		const show = kind === 'error' ? vscode.window.showErrorMessage : vscode.window.showWarningMessage
		void show(message, t('Show Output')).then((choice) => {
			if (choice) this.output.show()
		})
	}

	private async launch(entry: ClientEntry, target: ClientTarget): Promise<void> {
		const { folder } = target
		const { resolution } = entry
		const serverOptions: ServerOptions = {
			run: { module: resolution.module, transport: TransportKind.ipc },
			debug: { module: resolution.module, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', `--inspect=${6009 + entry.slot}`] } },
		}
		let fallback: ErrorHandler | undefined
		const clientOptions: LanguageClientOptions = {
			documentSelector: target.schemes.map((scheme) => ({ language: 'meeko', scheme, ...(folder ? { pattern: { baseUri: folder.uri.toString(), pattern: '**/*.meeko' } } : {}) })),
			...(folder ? { workspaceFolder: folder } : {}),
			initializationOptions: initializationOptions(target),
			outputChannel: this.output,
			// This class reports the failure and falls back to the bundled server.
			initializationFailedHandler: () => false,
			errorHandler: {
				error: (error, message, count) => fallback?.error(error, message, count) ?? { action: ErrorAction.Continue },
				// A server that dies while it starts is not restarted: the start fails at once.
				closed: () => (entry.started && fallback ? fallback.closed() : { action: CloseAction.DoNotRestart, handled: true }),
			},
			middleware: this.middleware(entry, folder === undefined),
		}
		const client = new (folder ? LanguageClient : DetachedLanguageClient)('meeko', `Meeko (${entry.name})`, serverOptions, clientOptions)
		fallback = client.createDefaultErrorHandler()
		entry.client = client
		this.output.info(`Servidor de Meeko [${entry.name}]: ${resolution.source} ${resolution.module}${resolution.version ? ` (${resolution.version})` : ''}${resolution.reason ? `; ${resolution.reason}` : ''}`)
		await client.start()
		const configuredTrace = (): Trace => Trace.fromString(vscode.workspace.getConfiguration('meeko').get<string>('trace.server', 'off'))
		await client.setTrace(configuredTrace())
		entry.disposables.push(
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (!event.affectsConfiguration('meeko.trace.server')) return
				void client.setTrace(configuredTrace()).catch((error: unknown) => this.output.warn(`No se pudo actualizar el trace de Meeko: ${String(error)}`))
			}),
			// The server restarts itself after a crash, and gives up after several in a row.
			client.onDidChangeState(({ newState }) => {
				if (entry.stopping || entry.client !== client) return
				entry.state = newState === State.Running ? 'running' : newState === State.Starting ? 'starting' : 'failed'
				entry.error = entry.state === 'failed' ? 'el servidor se detuvo de forma inesperada' : undefined
				this.changed(newState === State.Running)
			}),
		)
		entry.started = true
		entry.state = 'running'
	}

	private middleware(entry: ClientEntry, detached: boolean): Middleware {
		const owns = (uri: vscode.Uri): boolean => ownerOf(uri) === entry.key
		return {
			...ownedDocuments(owns),
			// A server also reports files it did not open; those of another folder have their own server.
			// A file outside every folder is attended only by the global client once it exists.
			handleDiagnostics: (uri, diagnostics, next) => {
				const route = routeDiagnostics({ client: entry.key, owner: ownerOf(uri), globalActive: this.globalActive() })
				if (route === 'drop') return
				if (route === 'publish-loose') this.looseDiagnostics.record(entry.key, uri.toString())
				next(uri, diagnostics)
			},
			// `workspace/didChangeWatchedFiles` is not filtered by owner: the client sends every event of
			// its watchers to its server and the middleware cannot intercept them. Each server keeps only
			// the paths under the roots of its projects (`MeekoProject.filesChanged`), and it needs the
			// files of other folders too: an outer folder resolves imports into a nested one and the
			// other way round, so dropping them would leave stale programs.
			workspace: {
				configuration: async (params, token, next) => {
					const values = await next(params, token)
					if (!Array.isArray(values)) return values
					return Promise.all(
						values.map(async (value: unknown, index: number) => {
							const item = params.items[index]
							if (item?.section !== 'meeko.classes') return value
							return classSettingsForServer(value, await this.classProviders(entry, item.scopeUri), extensionActive)
						}),
					)
				},
				...(detached ? { workspaceFolders: () => null, didChangeWorkspaceFolders: () => Promise.resolve() } : {}),
			},
			provideCodeLenses: async (document, token, next) => {
				if (!owns(document.uri)) return undefined
				const lenses = await next(document, token)
				return lenses && entry.client ? this.codeLenses(lenses, entry.client) : lenses
			},
		}
	}

	/**
	 * The class providers that the project of `uri` declares, asked to its server: they say which
	 * extensions attend the classes that a tool generates. A server before 1.12 has none.
	 */
	private classProviders(entry: ClientEntry, uri: string | undefined): Promise<ClassProviderInfo[]> {
		const client = entry.client
		if (!client) return Promise.resolve([])
		return requestClassProviders(() => client.sendRequest(classProvidersMethod, uri === undefined ? null : { textDocument: { uri } }))
	}

	/** Disposes the client of an entry, which stays in the map. */
	private async release(entry: ClientEntry): Promise<void> {
		const client = entry.client
		entry.client = undefined
		entry.started = false
		for (const disposable of entry.disposables.splice(0)) disposable.dispose()
		if (!client) return
		// A client that restarts after a crash cannot stop until it is running again.
		if (client.state === State.Starting) {
			await new Promise<void>((resolve) => {
				const done = (): void => {
					clearTimeout(timer)
					listener.dispose()
					resolve()
				}
				const timer = setTimeout(done, 10_000)
				const listener = client.onDidChangeState(done)
			})
		}
		if (!client.needsStop()) return
		try {
			await client.stop()
		} catch (error) {
			this.output.warn(`No se pudo detener un servidor de Meeko: ${String(error)}`)
		}
	}

	private async stop(key: string): Promise<void> {
		const entry = this.entries.get(key)
		if (!entry) return
		entry.stopping = true
		this.entries.delete(key)
		this.looseDiagnostics.forget(key)
		await this.release(entry)
	}

	async dispose(): Promise<void> {
		this.disposed = true
		await this.pending.catch(() => undefined)
		await Promise.all([...this.entries.keys()].map((key) => this.stop(key)))
	}
}
