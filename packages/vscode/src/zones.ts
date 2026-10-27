import * as vscode from "vscode";

/** Where lines of a `.meeko` run, as the language server reports them. */
export type ExecutionZoneKind = "server" | "shared" | "browser";

/** A zone of the `meeko/executionZones` response. */
export interface ExecutionZoneItem {
  readonly kind: ExecutionZoneKind;
  readonly reason: string;
  readonly label: string;
  readonly detail: string;
  readonly range: { readonly start: { readonly line: number; readonly character: number }; readonly end: { readonly line: number; readonly character: number } };
}

/** Custom request of the Meeko language server. */
export const executionZonesRequest = "meeko/executionZones";

/** Setting that turns the decorations on and off. */
export const executionZonesSetting = "meeko.editor.executionZones";

/** Sends `meeko/executionZones`; `null` for a document the server does not model. */
export type ZoneSource = (uri: string) => Promise<{ zones: ExecutionZoneItem[] } | null>;

const kinds: readonly ExecutionZoneKind[] = ["server", "shared", "browser"];

/** Decorations of the zone kinds, from the colors that the extension contributes to themes. */
function decorationTypes(extension: vscode.Uri): Record<ExecutionZoneKind, vscode.TextEditorDecorationType> {
  const icon = (kind: ExecutionZoneKind, theme: "light" | "dark") => vscode.Uri.joinPath(extension, "icons", "zones", `${kind}-${theme}.svg`);
  const create = (kind: ExecutionZoneKind) => vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor(`meeko.executionZone.${kind}Background`),
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    light: { gutterIconPath: icon(kind, "light"), gutterIconSize: "contain" },
    dark: { gutterIconPath: icon(kind, "dark"), gutterIconSize: "contain" },
  });
  return { server: create("server"), shared: create("shared"), browser: create("browser") };
}

/**
 * Shows the execution zones of the visible `.meeko` editors: a bar in the gutter and a faint line
 * color for the code that runs only on the server, on both sides and only in the browser. The
 * first line of each zone explains it on hover.
 */
export class ExecutionZoneDecorations implements vscode.Disposable {
  private readonly types: Record<ExecutionZoneKind, vscode.TextEditorDecorationType>;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly versions = new Map<string, number>();
  /** Zones applied to each document, by URI; the tests read them. */
  readonly applied = new Map<string, readonly ExecutionZoneItem[]>();

  constructor(extension: vscode.Uri, private readonly source: ZoneSource, private readonly delay = 250) {
    this.types = decorationTypes(extension);
    this.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshVisible()),
      vscode.workspace.onDidChangeTextDocument(({ document }) => this.schedule(document)),
      vscode.workspace.onDidSaveTextDocument((document) => this.schedule(document)),
      vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration(executionZonesSetting)) this.refreshVisible(); }),
    );
    this.refreshVisible();
  }

  private enabled(document: vscode.TextDocument): boolean {
    return vscode.workspace.getConfiguration("meeko", document).get<boolean>("editor.executionZones", true);
  }

  /** Requests and applies the zones of every visible `.meeko` editor. */
  refreshVisible(): void {
    const documents = new Set(vscode.window.visibleTextEditors.map((editor) => editor.document).filter((document) => document.languageId === "meeko"));
    for (const document of documents) void this.refresh(document);
  }

  private schedule(document: vscode.TextDocument): void {
    if (document.languageId !== "meeko") return;
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      // A hidden document is refreshed when an editor shows it again.
      if (vscode.window.visibleTextEditors.some((editor) => editor.document.uri.toString() === key)) void this.refresh(document);
    }, this.delay));
  }

  /** Requests the zones of one document and decorates its visible editors. */
  async refresh(document: vscode.TextDocument): Promise<void> {
    const key = document.uri.toString();
    const version = (this.versions.get(key) ?? 0) + 1;
    this.versions.set(key, version);
    let zones: readonly ExecutionZoneItem[] = [];
    if (this.enabled(document) && document.uri.scheme === "file") {
      try { zones = (await this.source(key))?.zones ?? []; }
      catch { zones = []; }
    }
    // A newer request for the same document wins.
    if (this.versions.get(key) !== version) return;
    this.applied.set(key, zones);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() !== key) continue;
      for (const kind of kinds) {
        editor.setDecorations(this.types[kind], zones.filter((zone) => zone.kind === kind).flatMap((zone): vscode.DecorationOptions[] => {
          const last = Math.min(zone.range.end.line, document.lineCount - 1);
          const first = Math.min(zone.range.start.line, last);
          // The explanation is attached to the first line of the zone only, not to every hover inside it.
          const options: vscode.DecorationOptions[] = [{
            range: document.lineAt(first).range,
            hoverMessage: new vscode.MarkdownString(`**${zone.label}** · ${zone.detail}`),
          }];
          if (last > first) options.push({ range: new vscode.Range(first + 1, 0, last, document.lineAt(last).range.end.character) });
          return options;
        }));
      }
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const subscription of this.subscriptions) subscription.dispose();
    for (const type of Object.values(this.types)) type.dispose();
  }
}
