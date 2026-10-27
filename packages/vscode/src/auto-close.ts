import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

/** Petición del servidor de Meeko que devuelve la etiqueta de cierre como snippet (`$0</div>`). */
export const tagCompletionRequest = "meeko/tagComplete";

/**
 * Cierra las etiquetas de la plantilla al escribir `>` o `</`, como la extensión de HTML de VS Code:
 * tras la pulsación, pide al servidor la etiqueta de cierre y la inserta si el cursor no se movió.
 * Se desactiva con `meeko.autoClosingTags`.
 */
export function registerAutoClosingTags(client: () => LanguageClient | undefined): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listener = vscode.workspace.onDidChangeTextDocument((event) => {
    const { document } = event;
    if (document.languageId !== "meeko" || event.contentChanges.length === 0) return;
    if (event.reason === vscode.TextDocumentChangeReason.Undo || event.reason === vscode.TextDocumentChangeReason.Redo) return;
    const change = event.contentChanges[event.contentChanges.length - 1]!;
    if ((change.text !== ">" && change.text !== "/") || change.rangeLength !== 0) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) return;
    if (!vscode.workspace.getConfiguration("meeko", document).get<boolean>("autoClosingTags", true)) return;
    const position = change.range.start.translate(0, 1);
    const version = document.version;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const current = client();
      if (!current) return;
      void current.sendRequest<string | null>(tagCompletionRequest, {
        textDocument: { uri: document.uri.toString() },
        position: current.code2ProtocolConverter.asPosition(position),
      }).then(async (snippet) => {
        const active = vscode.window.activeTextEditor;
        // Typing went on, or the cursor left the tag: the closing tag would land in the wrong place.
        if (!snippet || !active || active.document !== document || document.version !== version || !active.selection.active.isEqual(position)) return;
        await active.insertSnippet(new vscode.SnippetString(snippet), position);
      }, () => undefined);
    }, 100);
  });
  return { dispose: () => { if (timer) clearTimeout(timer); listener.dispose(); } };
}
