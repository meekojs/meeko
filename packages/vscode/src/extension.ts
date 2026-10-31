import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import type { ResolvedLanguageServer } from "./server-resolution";
import { ExecutionZoneDecorations, executionZonesRequest } from "./zones";
import type { ExecutionZoneItem } from "./zones";
import { LanguageServers } from "./language-servers";
import { registerLiveValues } from "./live/controller";
import { registerAutoClosingTags } from "./auto-close";
import { registerScaffoldCommands } from "./commands";
import type { MeekoLiveApi } from "./live/controller";

/** API que devuelve la activación; las pruebas la usan para saber qué servidor se eligió. */
export interface MeekoExtensionApi {
  readonly server: ResolvedLanguageServer | undefined;
  /** Server selected for a file in a multi-root workspace. */
  serverFor(uri: vscode.Uri): ResolvedLanguageServer | undefined;
  /** Zonas de ejecución decoradas en un documento, o `undefined` si aún no se pidieron. */
  executionZones(uri: vscode.Uri): readonly ExecutionZoneItem[] | undefined;
  /** Valores en vivo de `meeko dev`. */
  readonly live: MeekoLiveApi;
}

let zones: ExecutionZoneDecorations | undefined;
let servers: LanguageServers | undefined;

/** VS Code's command behind the reference lenses of the server. */
const showReferences = "editor.action.showReferences";

/**
 * The server sends `editor.action.showReferences` with LSP arguments; VS Code's command needs a
 * `Uri`, a `Position` and `Location`s.
 */
function referenceLens(lens: vscode.CodeLens, current: LanguageClient): vscode.CodeLens {
  const command = lens.command;
  if (command?.command !== showReferences || !Array.isArray(command.arguments) || typeof command.arguments[0] !== "string") return lens;
  const [uri, position, locations] = command.arguments as [string, { line: number; character: number }, Parameters<LanguageClient["protocol2CodeConverter"]["asLocation"]>[0][]];
  const converter = current.protocol2CodeConverter;
  lens.command = {
    ...command,
    arguments: [converter.asUri(uri), converter.asPosition(position), (locations ?? []).map((location) => converter.asLocation(location))],
  };
  return lens;
}

/** Arranca el cliente del servidor de lenguaje Meeko; la lógica del lenguaje vive en el servidor. */
export async function activate(context: vscode.ExtensionContext): Promise<MeekoExtensionApi> {
  const output = vscode.window.createOutputChannel("Meeko", { log: true });
  context.subscriptions.push(output);
  const api: MeekoExtensionApi = {
    get server() { return servers?.first; },
    serverFor: (uri) => servers?.resolutionFor(uri),
    executionZones: (uri) => zones?.applied.get(uri.toString()),
    live: registerLiveValues(context, output),
  };
  servers = new LanguageServers(context, output, (lenses, current) => lenses.map((lens) => referenceLens(lens, current)), () => zones?.refreshVisible());
  await servers.refresh();
  // An older workspace server has no zones; it answers the request with an error, shown as no zones.
  zones = new ExecutionZoneDecorations(context.extensionUri, (uri) => {
    const current = servers?.clientFor(vscode.Uri.parse(uri));
    return current ? current.sendRequest<{ zones: ExecutionZoneItem[] } | null>(executionZonesRequest, { textDocument: { uri } }) : Promise.resolve(null);
  });
  context.subscriptions.push(registerAutoClosingTags((uri) => servers?.clientFor(uri)));
  context.subscriptions.push(registerScaffoldCommands());
  context.subscriptions.push({ dispose: () => { zones?.dispose(); zones = undefined; } });
  const refresh = (): void => { void servers?.refresh().catch((error: unknown) => output.error(`No se pudo reiniciar Meeko: ${String(error)}`)); };
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(refresh));
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(refresh));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("meeko.languageServer")) return;
    refresh();
  }));
  return api;
}

/** Detiene el servidor de lenguaje al desactivar la extensión. */
export async function deactivate(): Promise<void> {
  zones?.dispose();
  zones = undefined;
  await servers?.dispose();
  servers = undefined;
}
