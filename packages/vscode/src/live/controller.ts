import { readFile } from 'node:fs/promises'
import * as vscode from 'vscode'

import type { LiveChange } from './client'
import type { BridgeOff, EditorLiveSignal, LiveGroup } from './model'

import { BridgeConnection, isAlive } from './client'
import { bridgeDescriptorGlob, bridgeOffFromRecord, devServerRecordGlob, editableValue, groupSignals, hoverMarkdown, inlineText, isWorkspaceBridgeDescriptor, isWorkspaceDevServerRecord, liveStatus, parseEditedValue, placeGroups } from './model'
import { localWorkspacePath, reconcileWatchedFolders } from './workspace'

const descriptorGlob = bridgeDescriptorGlob
const editCommand = 'meeko.live.editSignal'
const reconnectCommand = 'meeko.live.reconnect'
const flashMs = 700
const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'

interface LiveEntry {
    /** Descriptor de la conexión; dos `meeko dev` pueden publicar el mismo ID de señal. */
    key: string
    connection: BridgeConnection
    signal: EditorLiveSignal
}

/** Decoración calculada para un editor; la API de pruebas la expone tal cual. */
export interface LiveDecoration {
    line: number
    text: string
    flashing: boolean
}

/** Estado observable de los valores en vivo, para las pruebas del host de VS Code. */
export interface MeekoLiveApi {
    readonly connected: boolean
    /** Texto de la barra de estado, o `undefined` si está oculta. */
    readonly status: string | undefined
    readonly connections: number
    decorations(uri: vscode.Uri): LiveDecoration[]
    signals(uri: vscode.Uri): EditorLiveSignal[]
}

/**
 * Valores en vivo de `meeko dev` junto al código: vigila los descriptores del puente,
 * mantiene una conexión por servidor de desarrollo, decora las declaraciones de señales,
 * añade un hover con el valor de cada instancia y el comando para editarlo.
 */
export function registerLiveValues(context: vscode.ExtensionContext, output: vscode.LogOutputChannel): MeekoLiveApi {
    const connections = new Map<string, BridgeConnection>()
    /** `meeko dev` en marcha sin puente, por la ruta de su `.meeko/dev/server.json`. */
    const bridgesOff = new Map<string, BridgeOff>()
    const flashing = new Map<string, number>()
    const rendered = new Map<string, LiveDecoration[]>()
    const folderWatchers = new Map<string, vscode.Disposable[]>()
    let disposed = false
    let flashTimer: ReturnType<typeof setTimeout> | undefined
    let renderTimer: ReturnType<typeof setTimeout> | undefined
    let statusVisible = false

    const settings = () => {
        const configuration = vscode.workspace.getConfiguration('meeko')
        return {
            enabled: vscode.workspace.isTrusted && configuration.get<boolean>('live.enabled', true),
            inline: configuration.get<boolean>('live.inlineValues', true),
        }
    }

    /** Relative paths are accepted only for files inside a current local workspace folder. */
    const workspacePath = (uri: vscode.Uri): string | undefined => {
        if (uri.scheme !== 'file') return undefined
        const folder = vscode.workspace.getWorkspaceFolder(uri)
        if (!folder || folder.uri.scheme !== 'file') return undefined
        return localWorkspacePath(folder.uri.fsPath, uri.fsPath)
    }

    const valueType = vscode.window.createTextEditorDecorationType({
        after: { margin: '0 0 0 2em', color: new vscode.ThemeColor('editorCodeLens.foreground') },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    })
    const flashType = vscode.window.createTextEditorDecorationType({
        after: {
            margin: '0 0 0 2em',
            color: new vscode.ThemeColor('editor.foreground'),
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        },
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    })
    const status = vscode.window.createStatusBarItem('meeko.live', vscode.StatusBarAlignment.Right, 100)
    status.name = 'Meeko live'
    status.command = reconnectCommand
    context.subscriptions.push(valueType, flashType, status)

    const entries = (): LiveEntry[] => {
        const all: LiveEntry[] = []
        for (const [key, connection] of connections) {
            for (const signal of connection.signals.values()) all.push({ key, connection, signal })
        }
        return all
    }

    /** Una señal alias se edita sobre su principal, si sigue publicada en la misma conexión. */
    const principalOf = (entry: LiveEntry): LiveEntry => {
        const alias = entry.signal.alias
        const principal = alias ? entry.connection.signals.get(alias.id) : undefined
        return principal ? { ...entry, signal: principal } : entry
    }

    const groupsFor = (document: vscode.TextDocument): LiveGroup[] =>
        workspacePath(document.uri) !== undefined
            ? groupSignals(
                  entries().map((entry) => entry.signal),
                  document.uri.fsPath,
                  caseInsensitive,
              )
            : []

    const entryOf = (signal: EditorLiveSignal): LiveEntry | undefined => entries().find((entry) => entry.signal === signal)

    const updateStatus = (): void => {
        const live = settings()
        const activeEditor = vscode.window.activeTextEditor?.document
        const active = activeEditor?.languageId === 'meeko' && workspacePath(activeEditor.uri) !== undefined
        // A record whose process ended without removing it (a killed meeko dev) no longer counts.
        for (const [key, off] of bridgesOff) if (!isAlive(off.pid)) bridgesOff.delete(key)
        if (!live.enabled || (connections.size === 0 && bridgesOff.size === 0 && !active)) {
            status.hide()
            statusVisible = false
            return
        }
        const connected = [...connections.values()].filter((connection) => connection.isConnected).map((connection) => connection.url ?? 'meeko dev')
        const shown = liveStatus(connected, connections.size, [...bridgesOff.values()])
        status.text = shown.text
        status.tooltip = shown.tooltip
        status.show()
        statusVisible = true
    }

    const render = (): void => {
        renderTimer = undefined
        const live = settings()
        const now = Date.now()
        rendered.clear()
        for (const editor of vscode.window.visibleTextEditors) {
            const document = editor.document
            if (document.languageId !== 'meeko' || !live.enabled || !live.inline) {
                editor.setDecorations(valueType, [])
                editor.setDecorations(flashType, [])
                continue
            }
            const lines = Array.from({ length: document.lineCount }, (_, index) => document.lineAt(index).text)
            const normal: vscode.DecorationOptions[] = []
            const flash: vscode.DecorationOptions[] = []
            const shown: LiveDecoration[] = []
            const used = new Set<number>()
            for (const placement of placeGroups(groupsFor(document), lines)) {
                if (used.has(placement.line)) continue
                used.add(placement.line)
                const end = document.lineAt(placement.line).range.end
                const text = inlineText(placement.group)
                const hot = placement.group.signals.some((signal) => (flashing.get(signal.id) ?? 0) > now)
                ;(hot ? flash : normal).push({ range: new vscode.Range(end, end), renderOptions: { after: { contentText: text } } })
                shown.push({ line: placement.line, text, flashing: hot })
            }
            editor.setDecorations(valueType, normal)
            editor.setDecorations(flashType, flash)
            rendered.set(document.uri.toString(), shown)
        }
    }

    const scheduleRender = (): void => {
        if (renderTimer === undefined) renderTimer = setTimeout(render, 30)
    }

    const onChange = (change: LiveChange): void => {
        if (!change.reset) {
            const until = Date.now() + flashMs
            for (const id of change.changed) flashing.set(id, until)
            if (change.changed.length) {
                if (flashTimer) clearTimeout(flashTimer)
                flashTimer = setTimeout(() => {
                    flashTimer = undefined
                    flashing.clear()
                    scheduleRender()
                }, flashMs + 20)
            }
        }
        for (const id of change.removed) flashing.delete(id)
        scheduleRender()
    }

    const connect = (uri: vscode.Uri): void => {
        if (disposed || !settings().enabled) return
        // The watcher also reports descriptors of linked packages and of temporary projects under `.meeko/`.
        const path = workspacePath(uri)
        if (!path || !isWorkspaceBridgeDescriptor(path)) return
        const key = uri.fsPath
        let connection = connections.get(key)
        if (!connection) {
            connection = new BridgeConnection({
                descriptor: key,
                onState: (connected) => {
                    output.info(`Meeko live: ${connected ? 'conectado a' : 'desconectado de'} ${connection?.url ?? key}`)
                    updateStatus()
                },
                onChange,
                log: (message) => output.debug(message),
            })
            connections.set(key, connection)
            updateStatus()
        }
        connection.reload()
    }

    const disconnect = (uri: vscode.Uri): void => {
        const connection = connections.get(uri.fsPath)
        if (!connection) return
        connections.delete(uri.fsPath)
        connection.dispose()
        updateStatus()
        scheduleRender()
    }

    const disconnectAll = (): void => {
        for (const connection of connections.values()) connection.dispose()
        connections.clear()
        bridgesOff.clear()
        updateStatus()
        scheduleRender()
    }

    /** Lee el registro de un `meeko dev`: desde Meeko 1.7.1 dice si se arrancó sin puente y por qué. */
    const readRecord = async (uri: vscode.Uri): Promise<void> => {
        const path = workspacePath(uri)
        if (disposed || !settings().enabled || !path || !isWorkspaceDevServerRecord(path)) return
        let off: BridgeOff | undefined
        try {
            off = bridgeOffFromRecord(await readFile(uri.fsPath, 'utf8'))
        } catch {
            off = undefined
        }
        // A folder can be removed while the asynchronous read is in progress.
        if (disposed || !settings().enabled || workspacePath(uri) === undefined) return
        if (off && isAlive(off.pid)) bridgesOff.set(uri.fsPath, off)
        else bridgesOff.delete(uri.fsPath)
        updateStatus()
    }

    const dropRecord = (uri: vscode.Uri): void => {
        if (bridgesOff.delete(uri.fsPath)) updateStatus()
    }

    const discover = async (folder: vscode.WorkspaceFolder): Promise<void> => {
        if (disposed || !settings().enabled || folder.uri.scheme !== 'file') return
        const [found, records] = await Promise.all([
            vscode.workspace.findFiles(new vscode.RelativePattern(folder, descriptorGlob), '**/node_modules/**', 50),
            vscode.workspace.findFiles(new vscode.RelativePattern(folder, devServerRecordGlob), '**/node_modules/**', 50),
        ])
        for (const uri of found) {
            if (vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() === folder.uri.toString()) connect(uri)
        }
        await Promise.all(records.filter((uri) => vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() === folder.uri.toString()).map(readRecord))
    }

    const discoverAll = async (): Promise<void> => {
        await Promise.all((vscode.workspace.workspaceFolders ?? []).map(discover))
    }

    const reconcileFolders = (): void => {
        const added = reconcileWatchedFolders(vscode.workspace.workspaceFolders ?? [], folderWatchers, (folder) => {
            const key = folder.uri.toString()
            const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, descriptorGlob))
            const recordWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, devServerRecordGlob))
            const owned = (uri: vscode.Uri): boolean => vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() === key
            return [
                watcher,
                watcher.onDidCreate((uri) => { if (owned(uri)) connect(uri) }),
                watcher.onDidChange((uri) => { if (owned(uri)) connect(uri) }),
                watcher.onDidDelete((uri) => { if (owned(uri)) disconnect(uri) }),
                recordWatcher,
                recordWatcher.onDidCreate((uri) => { if (owned(uri)) void readRecord(uri) }),
                recordWatcher.onDidChange((uri) => { if (owned(uri)) void readRecord(uri) }),
                recordWatcher.onDidDelete((uri) => { if (owned(uri)) dropRecord(uri) }),
            ]
        })
        for (const key of connections.keys()) {
            if (workspacePath(vscode.Uri.file(key)) === undefined) disconnect(vscode.Uri.file(key))
        }
        for (const key of bridgesOff.keys()) {
            if (workspacePath(vscode.Uri.file(key)) === undefined) dropRecord(vscode.Uri.file(key))
        }
        for (const folder of added) void discover(folder)
        updateStatus()
        scheduleRender()
    }

    context.subscriptions.push(
        {
            dispose: () => {
                disposed = true
                for (const watchers of folderWatchers.values()) for (const watcher of watchers) watcher.dispose()
                folderWatchers.clear()
                disconnectAll()
                if (renderTimer) clearTimeout(renderTimer)
                if (flashTimer) clearTimeout(flashTimer)
            },
        },
        vscode.window.onDidChangeVisibleTextEditors(scheduleRender),
        vscode.window.onDidChangeActiveTextEditor(() => {
            updateStatus()
        }),
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.languageId === 'meeko') scheduleRender()
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(reconcileFolders),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (!event.affectsConfiguration('meeko.live')) return
            if (settings().enabled) void discoverAll()
            else disconnectAll()
            updateStatus()
            scheduleRender()
        }),
        vscode.workspace.onDidGrantWorkspaceTrust(() => {
            void discoverAll()
            updateStatus()
        }),
    )

    const groupAt = (document: vscode.TextDocument, position: vscode.Position): LiveGroup | undefined => {
        const range = document.getWordRangeAtPosition(position, /[A-Za-z_$][\w$]*/)
        if (!range) return undefined
        const word = document.getText(range)
        return groupsFor(document).find((group) => group.name === word)
    }

    const editLink = (signal: EditorLiveSignal): string => {
        const entry = entryOf(signal)
        return `command:${editCommand}?${encodeURIComponent(JSON.stringify([{ id: signal.id, ...(entry ? { bridge: entry.key } : {}) }]))}`
    }

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            { language: 'meeko', scheme: 'file' },
            {
                provideHover(document, position) {
                    if (!settings().enabled) return undefined
                    const group = groupAt(document, position)
                    if (!group) return undefined
                    const markdown = new vscode.MarkdownString(hoverMarkdown(group, editLink))
                    markdown.isTrusted = { enabledCommands: [editCommand] }
                    return new vscode.Hover(markdown)
                },
            },
        ),
    )

    /**
     * Sin argumentos usa la señal bajo el cursor; `json` evita el cuadro de entrada (scripts y pruebas)
     * y `bridge` elige el descriptor cuando varios `meeko dev` publican el mismo ID.
     */
    const editSignal = async (argument?: { id?: unknown; json?: unknown; bridge?: unknown }): Promise<void> => {
        let entry: LiveEntry | undefined
        if (typeof argument?.id === 'string') {
            const id = argument.id
            const bridge = typeof argument.bridge === 'string' ? argument.bridge : undefined
            entry = entries().find((candidate) => candidate.signal.id === id && (bridge === undefined || candidate.key === bridge))
        } else {
            const editor = vscode.window.activeTextEditor
            const group = editor ? groupAt(editor.document, editor.selection.active) : undefined
            if (!group) {
                void vscode.window.showInformationMessage('Coloca el cursor sobre una señal con valor en vivo de meeko dev.')
                return
            }
            let signal = group.signals[0]
            if (group.signals.length > 1) {
                const picked = await vscode.window.showQuickPick(
                    group.signals.map((candidate) => ({
                        label: `${candidate.component} · ${candidate.instanceId}`,
                        description: candidate.tab,
                        detail: inlineText({ ...group, signals: [candidate] }),
                        signal: candidate,
                    })),
                    { placeHolder: `Instancia de ${group.name} que quieres editar` },
                )
                if (!picked) return
                signal = picked.signal
            }
            entry = signal ? entryOf(signal) : undefined
        }
        if (!entry) {
            void vscode.window.showWarningMessage('Esa señal ya no está montada en el navegador.')
            return
        }
        const target = principalOf(entry)
        const text =
            typeof argument?.json === 'string'
                ? argument.json
                : await vscode.window.showInputBox({
                      title: `Meeko: ${target.signal.component}.${target.signal.name} (${target.signal.instanceId})`,
                      prompt: 'Nuevo valor en JSON',
                      value: editableValue(target.signal),
                      validateInput: (value) => {
                          const parsed = parseEditedValue(value)
                          return parsed.ok ? undefined : parsed.error
                      },
                  })
        if (text === undefined) return
        const parsed = parseEditedValue(text)
        if (!parsed.ok) {
            void vscode.window.showErrorMessage(`Meeko: ${parsed.error}`)
            return
        }
        const result = await target.connection.setSignal(target.signal.id, parsed.value)
        if (!result.ok) void vscode.window.showErrorMessage(`Meeko: no se pudo editar ${target.signal.name}: ${result.error}`)
    }

    context.subscriptions.push(
        vscode.commands.registerCommand(editCommand, editSignal),
        vscode.commands.registerCommand(reconnectCommand, async () => {
            if (!settings().enabled) {
                void vscode.window.showInformationMessage('Meeko live está desactivado (meeko.live.enabled) o el workspace no es de confianza.')
                return
            }
            for (const connection of connections.values()) connection.reload()
            await discoverAll()
        }),
    )

    reconcileFolders()

    return {
        get connected() {
            return [...connections.values()].some((connection) => connection.isConnected)
        },
        get connections() {
            return connections.size
        },
        get status() {
            return statusVisible ? status.text : undefined
        },
        decorations: (uri) => workspacePath(uri) !== undefined ? rendered.get(uri.toString()) ?? [] : [],
        signals: (uri) =>
            workspacePath(uri) === undefined ? [] : groupSignals(
                entries().map((entry) => entry.signal),
                uri.fsPath,
                caseInsensitive,
            ).flatMap((group) => group.signals),
    }
}
