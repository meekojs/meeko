import * as vscode from 'vscode'

import type { ExecutionZoneItem, ExecutionZoneKind } from './zone-ranges'

import { executionZoneKinds, LatestRequests, zoneDecorationRanges } from './zone-ranges'

export type { ExecutionZoneItem, ExecutionZoneKind } from './zone-ranges'

/** Custom request of the Meeko language server. */
export const executionZonesRequest = 'meeko/executionZones'

/** Setting that turns the decorations on and off. */
export const executionZonesSetting = 'meeko.editor.executionZones'

/** Sends `meeko/executionZones`; `null` for a document the server does not model. */
export type ZoneSource = (uri: string) => Promise<{ zones: ExecutionZoneItem[] } | null>

/** Decorations of the zone kinds, from the colors that the extension contributes to themes. */
function decorationTypes(extension: vscode.Uri): Record<ExecutionZoneKind, vscode.TextEditorDecorationType> {
	const icon = (kind: ExecutionZoneKind, theme: 'light' | 'dark') => vscode.Uri.joinPath(extension, 'icons', 'zones', `${kind}-${theme}.svg`)
	const create = (kind: ExecutionZoneKind) =>
		vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			backgroundColor: new vscode.ThemeColor(`meeko.executionZone.${kind}Background`),
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
			light: { gutterIconPath: icon(kind, 'light'), gutterIconSize: 'contain' },
			dark: { gutterIconPath: icon(kind, 'dark'), gutterIconSize: 'contain' },
		})
	return { server: create('server'), shared: create('shared'), browser: create('browser') }
}

/**
 * Shows the execution zones of the visible `.meeko` editors: a bar in the gutter and a faint line
 * color for the code that runs only on the server, on both sides and only in the browser. The
 * first line of each zone explains it on hover.
 */
export class ExecutionZoneDecorations implements vscode.Disposable {
	private readonly types: Record<ExecutionZoneKind, vscode.TextEditorDecorationType>
	private readonly subscriptions: vscode.Disposable[] = []
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
	private readonly requests = new LatestRequests()
	/** Zones applied to each open document, by URI; the tests read them. */
	readonly applied = new Map<string, readonly ExecutionZoneItem[]>()

	constructor(
		extension: vscode.Uri,
		private readonly source: ZoneSource,
		private readonly delay = 250,
	) {
		this.types = decorationTypes(extension)
		this.subscriptions.push(
			vscode.window.onDidChangeVisibleTextEditors(() => this.refreshVisible()),
			vscode.workspace.onDidChangeTextDocument(({ document }) => this.schedule(document)),
			vscode.workspace.onDidSaveTextDocument((document) => this.schedule(document)),
			vscode.workspace.onDidCloseTextDocument((document) => this.forget(document.uri.toString())),
			// Changing the language mode of a visible editor closes and opens the document: the close
			// drops its state, so the open paints it again, or clears it when it is no longer Meeko.
			vscode.workspace.onDidOpenTextDocument((document) => (document.languageId === 'meeko' ? this.schedule(document) : this.clear(document))),
			vscode.workspace.onDidChangeConfiguration((event) => {
				if (event.affectsConfiguration(executionZonesSetting)) this.refreshVisible()
			}),
		)
		this.refreshVisible()
	}

	private enabled(document: vscode.TextDocument): boolean {
		return vscode.workspace.getConfiguration('meeko', document).get<boolean>('editor.executionZones', true)
	}

	/** Requests and applies the zones of every visible `.meeko` editor. */
	refreshVisible(): void {
		const documents = new Set(vscode.window.visibleTextEditors.map((editor) => editor.document).filter((document) => document.languageId === 'meeko'))
		for (const document of documents) void this.refresh(document)
	}

	private schedule(document: vscode.TextDocument): void {
		if (document.languageId !== 'meeko') return
		const key = document.uri.toString()
		clearTimeout(this.timers.get(key))
		this.timers.set(
			key,
			setTimeout(() => {
				this.timers.delete(key)
				// A hidden document is refreshed when an editor shows it again.
				if (vscode.window.visibleTextEditors.some((editor) => editor.document.uri.toString() === key)) void this.refresh(document)
			}, this.delay),
		)
	}

	/** Removes the decorations of the visible editors of a document that is not `.meeko` (anymore). */
	private clear(document: vscode.TextDocument): void {
		const key = document.uri.toString()
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() !== key) continue
			for (const kind of executionZoneKinds) editor.setDecorations(this.types[kind], [])
		}
	}

	/** Drops the state of a closed document; a request in flight for it is discarded when it answers. */
	private forget(key: string): void {
		clearTimeout(this.timers.get(key))
		this.timers.delete(key)
		this.requests.forget(key)
		this.applied.delete(key)
	}

	/** Requests the zones of one document and decorates its visible editors. */
	async refresh(document: vscode.TextDocument): Promise<void> {
		// A closed document has no editors, and its state would never be dropped again.
		if (document.isClosed) return
		const key = document.uri.toString()
		const turn = this.requests.begin(key)
		let zones: readonly ExecutionZoneItem[] = []
		// The server models open documents of any scheme, not only files on disk; without a client
		// for the document, or when the server does not model it, the answer is no zones.
		if (this.enabled(document)) {
			try {
				zones = (await this.source(key))?.zones ?? []
			} catch {
				zones = []
			}
		}
		// A newer request for the same document wins, and a document closed meanwhile keeps no state.
		if (!this.requests.isCurrent(key, turn)) return
		this.applied.set(key, zones)
		const lines = { lineCount: document.lineCount, lineLength: (line: number) => document.lineAt(line).range.end.character }
		for (const editor of vscode.window.visibleTextEditors) {
			if (editor.document.uri.toString() !== key) continue
			for (const kind of executionZoneKinds) {
				editor.setDecorations(
					this.types[kind],
					zoneDecorationRanges(zones, kind, lines).map((range): vscode.DecorationOptions => ({
						range: new vscode.Range(range.startLine, range.startCharacter, range.endLine, range.endCharacter),
						...(range.hover === undefined ? {} : { hoverMessage: new vscode.MarkdownString(range.hover) }),
					})),
				)
			}
		}
	}

	dispose(): void {
		for (const timer of this.timers.values()) clearTimeout(timer)
		this.timers.clear()
		this.requests.clear()
		for (const subscription of this.subscriptions) subscription.dispose()
		for (const type of Object.values(this.types)) type.dispose()
	}
}
