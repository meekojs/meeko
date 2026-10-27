import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { componentFile, endpointFiles, endpointMethods, pageFile, projectRootOf, schemaLibrary } from "./scaffold.js";
import type { ScaffoldFile } from "./scaffold.js";

/** The Meeko project of the active file or, without one, of the first workspace folder that is a project. */
function currentProject(): string | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  const fromActive = active?.scheme === "file" ? projectRootOf(active.fsPath) : undefined;
  if (fromActive) return fromActive;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const root = projectRootOf(folder.uri.fsPath);
    if (root) return root;
  }
  return undefined;
}

/** The indentation of `.meeko` files in this workspace: a tab, or the configured spaces. */
function indentation(root: string): string {
  const editor = vscode.workspace.getConfiguration("editor", { languageId: "meeko", uri: vscode.Uri.file(root) });
  return editor.get<boolean>("insertSpaces", true) ? " ".repeat(editor.get<number>("tabSize", 2)) : "\t";
}

/** Writes the files, never over an existing one, and opens the first. */
async function write(files: readonly ScaffoldFile[]): Promise<void> {
  const taken = files.find((file) => !file.append && existsSync(file.path));
  if (taken) {
    void vscode.window.showErrorMessage(`Ya existe ${vscode.workspace.asRelativePath(taken.path)}`);
    return;
  }
  for (const file of files) {
    const uri = vscode.Uri.file(file.path);
    const previous = file.append ? new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)) : "";
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(previous + file.content));
  }
  await vscode.window.showTextDocument(vscode.Uri.file(files[0]!.path));
}

/** Runs a scaffold with the project of the active file; reports a missing project or invalid input. */
async function scaffold(build: (root: string) => Promise<readonly ScaffoldFile[] | string | undefined>): Promise<void> {
  const root = currentProject();
  if (!root) {
    void vscode.window.showErrorMessage("No hay un proyecto Meeko abierto (una carpeta con meeko.config.ts o app/pages).");
    return;
  }
  const files = await build(root);
  if (files === undefined) return;
  if (typeof files === "string") {
    void vscode.window.showErrorMessage(files);
    return;
  }
  await write(files);
}

/** «Meeko: nuevo componente», «nueva página» y «nuevo endpoint de API». */
export function registerScaffoldCommands(): vscode.Disposable {
  const ask = (prompt: string, placeHolder: string, check: (value: string) => string | undefined) =>
    vscode.window.showInputBox({ prompt, placeHolder, validateInput: (value) => value.trim() ? check(value) : undefined });
  return vscode.Disposable.from(
    vscode.commands.registerCommand("meeko.newComponent", () => scaffold(async (root) => {
      const name = await ask("Nombre del componente", "AppCard o App/Card", (value) => {
        const file = componentFile(root, value);
        return typeof file === "string" ? file : undefined;
      });
      if (!name) return undefined;
      const file = componentFile(root, name, indentation(root));
      return typeof file === "string" ? file : [file];
    })),
    vscode.commands.registerCommand("meeko.newPage", () => scaffold(async (root) => {
      const route = await ask("Ruta de la página", "/users/[id]", (value) => {
        const file = pageFile(root, value);
        return typeof file === "string" ? file : undefined;
      });
      if (!route) return undefined;
      const file = pageFile(root, route, indentation(root));
      return typeof file === "string" ? file : [file];
    })),
    vscode.commands.registerCommand("meeko.newEndpoint", () => scaffold(async (root) => {
      const library = schemaLibrary(root);
      if (!library) return "Los endpoints necesitan schemas públicos: instala valibot o zod en el proyecto.";
      const picked = await vscode.window.showQuickPick([...endpointMethods], { placeHolder: "Método HTTP" });
      const method = endpointMethods.find((candidate) => candidate === picked);
      if (!method) return undefined;
      const route = await ask(`Ruta del endpoint ${method}`, "/users/[id]", (value) => {
        const files = endpointFiles(root, method, value, library);
        return typeof files === "string" ? files : undefined;
      });
      if (!route) return undefined;
      return endpointFiles(root, method, route, library, indentation(root));
    })),
  );
}
