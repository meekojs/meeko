import * as vscode from "vscode";
import { BridgeConnection } from "./client.js";
import type { LiveChange } from "./client.js";
import { bridgeDescriptorGlob, editableValue, groupSignals, hoverMarkdown, inlineText, isWorkspaceBridgeDescriptor, parseEditedValue, placeGroups } from "./model.js";
import type { EditorLiveSignal, LiveGroup } from "./model.js";

const descriptorGlob = bridgeDescriptorGlob;
const editCommand = "meeko.live.editSignal";
const reconnectCommand = "meeko.live.reconnect";
const flashMs = 700;
const caseInsensitive = process.platform === "win32" || process.platform === "darwin";

interface LiveEntry {
  /** Descriptor de la conexión; dos `meeko dev` pueden publicar el mismo ID de señal. */
  key: string;
  connection: BridgeConnection;
  signal: EditorLiveSignal;
}

/** Decoración calculada para un editor; la API de pruebas la expone tal cual. */
export interface LiveDecoration {
  line: number;
  text: string;
  flashing: boolean;
}

/** Estado observable de los valores en vivo, para las pruebas del host de VS Code. */
export interface MeekoLiveApi {
  readonly connected: boolean;
  /** Texto de la barra de estado, o `undefined` si está oculta. */
  readonly status: string | undefined;
  readonly connections: number;
  decorations(uri: vscode.Uri): LiveDecoration[];
  signals(uri: vscode.Uri): EditorLiveSignal[];
}

/**
 * Valores en vivo de `meeko dev` junto al código: vigila los descriptores del puente,
 * mantiene una conexión por servidor de desarrollo, decora las declaraciones de señales,
 * añade un hover con el valor de cada instancia y el comando para editarlo.
 */
export function registerLiveValues(context: vscode.ExtensionContext, output: vscode.LogOutputChannel): MeekoLiveApi {
  const connections = new Map<string, BridgeConnection>();
  const flashing = new Map<string, number>();
  const rendered = new Map<string, LiveDecoration[]>();
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let statusVisible = false;

  const settings = () => {
    const configuration = vscode.workspace.getConfiguration("meeko");
    return {
      enabled: vscode.workspace.isTrusted && configuration.get<boolean>("live.enabled", true),
      inline: configuration.get<boolean>("live.inlineValues", true),
    };
  };

  const valueType = vscode.window.createTextEditorDecorationType({
    after: { margin: "0 0 0 2em", color: new vscode.ThemeColor("editorCodeLens.foreground") },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  const flashType = vscode.window.createTextEditorDecorationType({
    after: {
      margin: "0 0 0 2em", color: new vscode.ThemeColor("editor.foreground"),
      backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  const status = vscode.window.createStatusBarItem("meeko.live", vscode.StatusBarAlignment.Right, 100);
  status.name = "Meeko live";
  status.command = reconnectCommand;
  context.subscriptions.push(valueType, flashType, status);

  const entries = (): LiveEntry[] => {
    const all: LiveEntry[] = [];
    for (const [key, connection] of connections) {
      for (const signal of connection.signals.values()) all.push({ key, connection, signal });
    }
    return all;
  };

  /** Una señal alias se edita sobre su principal, si sigue publicada en la misma conexión. */
  const principalOf = (entry: LiveEntry): LiveEntry => {
    const alias = entry.signal.alias;
    const principal = alias ? entry.connection.signals.get(alias.id) : undefined;
    return principal ? { ...entry, signal: principal } : entry;
  };

  const groupsFor = (document: vscode.TextDocument): LiveGroup[] =>
    document.uri.scheme === "file" ? groupSignals(entries().map((entry) => entry.signal), document.uri.fsPath, caseInsensitive) : [];

  const entryOf = (signal: EditorLiveSignal): LiveEntry | undefined =>
    entries().find((entry) => entry.signal === signal);

  const updateStatus = (): void => {
    const live = settings();
    const active = vscode.window.activeTextEditor?.document.languageId === "meeko";
    if (!live.enabled || (connections.size === 0 && !active)) { status.hide(); statusVisible = false; return; }
    const connected = [...connections.values()].filter((connection) => connection.isConnected);
    status.text = connected.length ? "$(pulse) Meeko live: conectado" : "$(debug-disconnect) Meeko live: desconectado";
    status.tooltip = connected.length
      ? `Valores en vivo de ${connected.map((connection) => connection.url).join(", ")}. Pulsa para reconectar.`
      : connections.size
        ? "meeko dev no responde. Pulsa para reconectar."
        : "Arranca meeko dev para ver los valores de las señales junto al código.";
    status.show();
    statusVisible = true;
  };

  const render = (): void => {
    renderTimer = undefined;
    const live = settings();
    const now = Date.now();
    rendered.clear();
    for (const editor of vscode.window.visibleTextEditors) {
      const document = editor.document;
      if (document.languageId !== "meeko" || !live.enabled || !live.inline) {
        editor.setDecorations(valueType, []);
        editor.setDecorations(flashType, []);
        continue;
      }
      const lines = Array.from({ length: document.lineCount }, (_, index) => document.lineAt(index).text);
      const normal: vscode.DecorationOptions[] = [];
      const flash: vscode.DecorationOptions[] = [];
      const shown: LiveDecoration[] = [];
      const used = new Set<number>();
      for (const placement of placeGroups(groupsFor(document), lines)) {
        if (used.has(placement.line)) continue;
        used.add(placement.line);
        const end = document.lineAt(placement.line).range.end;
        const text = inlineText(placement.group);
        const hot = placement.group.signals.some((signal) => (flashing.get(signal.id) ?? 0) > now);
        (hot ? flash : normal).push({ range: new vscode.Range(end, end), renderOptions: { after: { contentText: text } } });
        shown.push({ line: placement.line, text, flashing: hot });
      }
      editor.setDecorations(valueType, normal);
      editor.setDecorations(flashType, flash);
      rendered.set(document.uri.toString(), shown);
    }
  };

  const scheduleRender = (): void => {
    if (renderTimer === undefined) renderTimer = setTimeout(render, 30);
  };

  const onChange = (change: LiveChange): void => {
    if (!change.reset) {
      const until = Date.now() + flashMs;
      for (const id of change.changed) flashing.set(id, until);
      if (change.changed.length) {
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { flashTimer = undefined; flashing.clear(); scheduleRender(); }, flashMs + 20);
      }
    }
    for (const id of change.removed) flashing.delete(id);
    scheduleRender();
  };

  const connect = (uri: vscode.Uri): void => {
    if (!settings().enabled || uri.scheme !== "file") return;
    // The watcher also reports descriptors of linked packages and of temporary projects under `.meeko/`.
    if (!isWorkspaceBridgeDescriptor(vscode.workspace.asRelativePath(uri, false))) return;
    const key = uri.fsPath;
    let connection = connections.get(key);
    if (!connection) {
      connection = new BridgeConnection({
        descriptor: key,
        onState: (connected) => {
          output.info(`Meeko live: ${connected ? "conectado a" : "desconectado de"} ${connection?.url ?? key}`);
          updateStatus();
        },
        onChange,
        log: (message) => output.debug(message),
      });
      connections.set(key, connection);
      updateStatus();
    }
    connection.reload();
  };

  const disconnect = (uri: vscode.Uri): void => {
    const connection = connections.get(uri.fsPath);
    if (!connection) return;
    connections.delete(uri.fsPath);
    connection.dispose();
    updateStatus();
    scheduleRender();
  };

  const disconnectAll = (): void => {
    for (const connection of connections.values()) connection.dispose();
    connections.clear();
    updateStatus();
    scheduleRender();
  };

  const discover = async (): Promise<void> => {
    if (!settings().enabled) return;
    const found = await vscode.workspace.findFiles(descriptorGlob, "**/node_modules/**", 50);
    for (const uri of found) connect(uri);
  };

  const watcher = vscode.workspace.createFileSystemWatcher(descriptorGlob);
  context.subscriptions.push(
    watcher,
    watcher.onDidCreate(connect),
    watcher.onDidChange(connect),
    watcher.onDidDelete(disconnect),
    { dispose: () => { disconnectAll(); if (renderTimer) clearTimeout(renderTimer); if (flashTimer) clearTimeout(flashTimer); } },
    vscode.window.onDidChangeVisibleTextEditors(scheduleRender),
    vscode.window.onDidChangeActiveTextEditor(() => { updateStatus(); }),
    vscode.workspace.onDidChangeTextDocument((event) => { if (event.document.languageId === "meeko") scheduleRender(); }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("meeko.live")) return;
      if (settings().enabled) void discover();
      else disconnectAll();
      updateStatus();
      scheduleRender();
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { void discover(); updateStatus(); }),
  );

  const groupAt = (document: vscode.TextDocument, position: vscode.Position): LiveGroup | undefined => {
    const range = document.getWordRangeAtPosition(position, /[A-Za-z_$][\w$]*/);
    if (!range) return undefined;
    const word = document.getText(range);
    return groupsFor(document).find((group) => group.name === word);
  };

  const editLink = (signal: EditorLiveSignal): string => {
    const entry = entryOf(signal);
    return `command:${editCommand}?${encodeURIComponent(JSON.stringify([{ id: signal.id, ...(entry ? { bridge: entry.key } : {}) }]))}`;
  };

  context.subscriptions.push(vscode.languages.registerHoverProvider({ language: "meeko", scheme: "file" }, {
    provideHover(document, position) {
      if (!settings().enabled) return undefined;
      const group = groupAt(document, position);
      if (!group) return undefined;
      const markdown = new vscode.MarkdownString(hoverMarkdown(group, editLink));
      markdown.isTrusted = { enabledCommands: [editCommand] };
      return new vscode.Hover(markdown);
    },
  }));

  /**
   * Sin argumentos usa la señal bajo el cursor; `json` evita el cuadro de entrada (scripts y pruebas)
   * y `bridge` elige el descriptor cuando varios `meeko dev` publican el mismo ID.
   */
  const editSignal = async (argument?: { id?: unknown; json?: unknown; bridge?: unknown }): Promise<void> => {
    let entry: LiveEntry | undefined;
    if (typeof argument?.id === "string") {
      const id = argument.id;
      const bridge = typeof argument.bridge === "string" ? argument.bridge : undefined;
      entry = entries().find((candidate) => candidate.signal.id === id && (bridge === undefined || candidate.key === bridge));
    } else {
      const editor = vscode.window.activeTextEditor;
      const group = editor ? groupAt(editor.document, editor.selection.active) : undefined;
      if (!group) {
        void vscode.window.showInformationMessage("Coloca el cursor sobre una señal con valor en vivo de meeko dev.");
        return;
      }
      let signal = group.signals[0];
      if (group.signals.length > 1) {
        const picked = await vscode.window.showQuickPick(group.signals.map((candidate) => ({
          label: `${candidate.component} · ${candidate.instanceId}`, description: candidate.tab, detail: inlineText({ ...group, signals: [candidate] }), signal: candidate,
        })), { placeHolder: `Instancia de ${group.name} que quieres editar` });
        if (!picked) return;
        signal = picked.signal;
      }
      entry = signal ? entryOf(signal) : undefined;
    }
    if (!entry) {
      void vscode.window.showWarningMessage("Esa señal ya no está montada en el navegador.");
      return;
    }
    const target = principalOf(entry);
    const text = typeof argument?.json === "string" ? argument.json : await vscode.window.showInputBox({
      title: `Meeko: ${target.signal.component}.${target.signal.name} (${target.signal.instanceId})`,
      prompt: "Nuevo valor en JSON",
      value: editableValue(target.signal),
      validateInput: (value) => { const parsed = parseEditedValue(value); return parsed.ok ? undefined : parsed.error; },
    });
    if (text === undefined) return;
    const parsed = parseEditedValue(text);
    if (!parsed.ok) {
      void vscode.window.showErrorMessage(`Meeko: ${parsed.error}`);
      return;
    }
    const result = await target.connection.setSignal(target.signal.id, parsed.value);
    if (!result.ok) void vscode.window.showErrorMessage(`Meeko: no se pudo editar ${target.signal.name}: ${result.error}`);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(editCommand, editSignal),
    vscode.commands.registerCommand(reconnectCommand, async () => {
      if (!settings().enabled) {
        void vscode.window.showInformationMessage("Meeko live está desactivado (meeko.live.enabled) o el workspace no es de confianza.");
        return;
      }
      for (const connection of connections.values()) connection.reload();
      await discover();
    }),
  );

  void discover();
  updateStatus();

  return {
    get connected() { return [...connections.values()].some((connection) => connection.isConnected); },
    get connections() { return connections.size; },
    get status() { return statusVisible ? status.text : undefined; },
    decorations: (uri) => rendered.get(uri.toString()) ?? [],
    signals: (uri) => groupSignals(entries().map((entry) => entry.signal), uri.fsPath, caseInsensitive).flatMap((group) => group.signals),
  };
}
