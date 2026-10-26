import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { resolveLanguageServer } from "./server-resolution.js";
import type { ResolvedLanguageServer } from "./server-resolution.js";
import { ExecutionZoneDecorations, executionZonesRequest } from "./zones.js";
import type { ExecutionZoneItem } from "./zones.js";
import { registerLiveValues } from "./live/controller.js";
import type { MeekoLiveApi } from "./live/controller.js";

/** API que devuelve la activación; las pruebas la usan para saber qué servidor se eligió. */
export interface MeekoExtensionApi {
  readonly server: ResolvedLanguageServer | undefined;
  /** Zonas de ejecución decoradas en un documento, o `undefined` si aún no se pidieron. */
  executionZones(uri: vscode.Uri): readonly ExecutionZoneItem[] | undefined;
  /** Valores en vivo de `meeko dev`. */
  readonly live: MeekoLiveApi;
}

let client: LanguageClient | undefined;
let zones: ExecutionZoneDecorations | undefined;

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
  const api: { server: ResolvedLanguageServer | undefined; executionZones: MeekoExtensionApi["executionZones"]; live: MeekoLiveApi } = {
    server: undefined,
    executionZones: (uri) => zones?.applied.get(uri.toString()),
    live: registerLiveValues(context, output),
  };

  const start = async (): Promise<void> => {
    const trusted = vscode.workspace.isTrusted;
    const server = resolveLanguageServer({
      folders: (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file").map((folder) => folder.uri.fsPath),
      bundled: context.asAbsolutePath("dist/server.js"),
      preferWorkspace: trusted && vscode.workspace.getConfiguration("meeko").get<boolean>("languageServer.preferWorkspace", true),
    });
    api.server = server;
    output.info(`Servidor de lenguaje de Meeko: ${server.source} ${server.module}${server.version ? ` (${server.version})` : ""}${server.reason ? `; ${server.reason}` : ""}`);
    const serverOptions: ServerOptions = {
      run: { module: server.module, transport: TransportKind.ipc },
      debug: { module: server.module, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6009"] } },
    };
    const clientOptions: LanguageClientOptions = {
      documentSelector: [{ language: "meeko", scheme: "file" }],
      initializationOptions: { trusted },
      outputChannel: output,
      middleware: {
        provideCodeLenses: async (document, token, next) => {
          const lenses = await next(document, token);
          const current = client;
          return current ? lenses?.map((lens) => referenceLens(lens, current)) : lenses;
        },
      },
    };
    const started = new LanguageClient("meeko", "Meeko", serverOptions, clientOptions);
    client = started;
    await started.start();
    // An older workspace server has no zones; it answers the request with an error, shown as no zones.
    zones = new ExecutionZoneDecorations(context.extensionUri, (uri) => started.sendRequest<{ zones: ExecutionZoneItem[] } | null>(executionZonesRequest, { textDocument: { uri } }));
  };

  const stop = async (): Promise<void> => {
    zones?.dispose();
    zones = undefined;
    await client?.stop();
  };

  await start();
  context.subscriptions.push({ dispose: () => { zones?.dispose(); zones = undefined; } });
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(async () => {
    await stop();
    await start();
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (!event.affectsConfiguration("meeko.languageServer")) return;
    await stop();
    await start();
  }));
  return api;
}

/** Detiene el servidor de lenguaje al desactivar la extensión. */
export async function deactivate(): Promise<void> {
  zones?.dispose();
  zones = undefined;
  await client?.stop();
  client = undefined;
}
