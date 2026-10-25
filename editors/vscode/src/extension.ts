import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import type { LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";
import { resolveLanguageServer } from "./server-resolution.js";
import type { ResolvedLanguageServer } from "./server-resolution.js";

/** API que devuelve la activación; las pruebas la usan para saber qué servidor se eligió. */
export interface MeekoExtensionApi {
  readonly server: ResolvedLanguageServer | undefined;
}

let client: LanguageClient | undefined;

/** Arranca el cliente del servidor de lenguaje Meeko; la lógica del lenguaje vive en el servidor. */
export async function activate(context: vscode.ExtensionContext): Promise<MeekoExtensionApi> {
  const output = vscode.window.createOutputChannel("Meeko", { log: true });
  context.subscriptions.push(output);
  const api: { server: ResolvedLanguageServer | undefined } = { server: undefined };

  const start = async (): Promise<void> => {
    const trusted = vscode.workspace.isTrusted;
    const server = resolveLanguageServer({
      folders: (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file").map((folder) => folder.uri.fsPath),
      bundled: context.asAbsolutePath("dist/server.js"),
      preferWorkspace: trusted && vscode.workspace.getConfiguration("meeko").get<boolean>("languageServer.preferWorkspace", true),
    });
    api.server = server;
    output.info(`Meeko language server: ${server.source} ${server.module}${server.version ? ` (${server.version})` : ""}${server.reason ? `; ${server.reason}` : ""}`);
    const serverOptions: ServerOptions = {
      run: { module: server.module, transport: TransportKind.ipc },
      debug: { module: server.module, transport: TransportKind.ipc, options: { execArgv: ["--nolazy", "--inspect=6009"] } },
    };
    const clientOptions: LanguageClientOptions = {
      documentSelector: [{ language: "meeko", scheme: "file" }],
      initializationOptions: { trusted },
      outputChannel: output,
    };
    client = new LanguageClient("meeko", "Meeko", serverOptions, clientOptions);
    await client.start();
  };

  await start();
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(async () => {
    await client?.stop();
    await start();
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (!event.affectsConfiguration("meeko.languageServer")) return;
    await client?.stop();
    await start();
  }));
  return api;
}

/** Detiene el servidor de lenguaje al desactivar la extensión. */
export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}
