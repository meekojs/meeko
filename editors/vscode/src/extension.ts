import * as vscode from "vscode";
import ts from "@typescript/typescript6";
import { parseSfc } from "../../../src/compiler/sfc.js";
import { checkSource } from "../../../src/check.js";
import { createEditorModel, type EditorModel } from "./model.js";

/** Estado de un documento abierto y su proyecto TypeScript virtual. */
interface CachedModel {
  version: number;
  model: EditorModel;
}

const selector: vscode.DocumentSelector = [{ language: "meeko", scheme: "file" }];
const models = new Map<string, CachedModel>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let diagnostics: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;

/** Inicia los diagnósticos y las herramientas semánticas del lenguaje. */
export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection("meeko");
  output = vscode.window.createOutputChannel("Meeko");
  context.subscriptions.push(diagnostics, output);
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(scheduleCheck));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(({ document }) => {
    clearModel(document.uri.toString());
    scheduleCheck(document);
  }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(scheduleCheck));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.delete(key);
    clearModel(key);
    diagnostics.delete(document.uri);
  }));

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(selector, {
    provideCompletionItems(document, position) {
      const entry = modelAt(document, position);
      if (!entry) return undefined;
      const { model, offset } = entry;
      const result = model.service.getCompletionsAtPosition(model.virtualFilename, offset, {});
      return result?.entries.map((item) => {
        const completion = new vscode.CompletionItem(item.name, completionKind(item.kind));
        completion.sortText = item.sortText;
        return completion;
      });
    },
  }, ".", ":"));

  context.subscriptions.push(vscode.languages.registerDefinitionProvider(selector, {
    provideDefinition(document, position) {
      const entry = modelAt(document, position);
      if (!entry) return undefined;
      const locations = entry.model.service.getDefinitionAtPosition(entry.model.virtualFilename, entry.offset) ?? [];
      return locations.flatMap((location) => {
        const result = translateLocation(entry.model, document, location.fileName, location.textSpan);
        return result ? [result] : [];
      });
    },
  }));

  context.subscriptions.push(vscode.languages.registerHoverProvider(selector, {
    provideHover(document, position) {
      const entry = modelAt(document, position);
      if (!entry) return undefined;
      const info = entry.model.service.getQuickInfoAtPosition(entry.model.virtualFilename, entry.offset);
      if (!info) return undefined;
      const signature = ts.displayPartsToString(info.displayParts ?? []);
      const documentation = ts.displayPartsToString(info.documentation ?? []);
      const markdown = new vscode.MarkdownString();
      markdown.appendCodeblock(signature, "typescript");
      if (documentation) markdown.appendMarkdown(`\n${documentation}`);
      return new vscode.Hover(markdown);
    },
  }));

  context.subscriptions.push(vscode.languages.registerRenameProvider(selector, {
    prepareRename(document, position) {
      const entry = modelAt(document, position);
      if (!entry) return undefined;
      const info = entry.model.service.getRenameInfo(entry.model.virtualFilename, entry.offset);
      if (!info.canRename) return undefined;
      return sourceRange(entry.model, document, info.triggerSpan);
    },
    provideRenameEdits(document, position, newName) {
      const entry = modelAt(document, position);
      if (!entry) return undefined;
      const locations = entry.model.service.findRenameLocations(entry.model.virtualFilename, entry.offset, false, false, true) ?? [];
      const edits = new vscode.WorkspaceEdit();
      for (const location of locations) {
        if (location.fileName !== entry.model.virtualFilename) continue;
        const range = sourceRange(entry.model, document, location.textSpan);
        if (range) edits.replace(document.uri, range, `${location.prefixText ?? ""}${newName}${location.suffixText ?? ""}`);
      }
      return edits;
    },
  }));

  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(selector, {
    async provideDocumentFormattingEdits(document) {
      try {
        const parsed = parseSfc(document.getText(), document.fileName);
        const sections = [parsed.script, parsed.template, parsed.style].filter((item) => item !== undefined);
        const edits: vscode.TextEdit[] = [];
        const tabSize = Number(vscode.workspace.getConfiguration("editor", document.uri).get<number>("tabSize", 2));
        const insertSpaces = vscode.workspace.getConfiguration("editor", document.uri).get<boolean>("insertSpaces", true);
        for (const section of sections) {
          if (section.name === "script") {
            const model = getModel(document);
            const generated = model?.service.getFormattingEditsForRange(model.virtualFilename, 0, section.content.length, {
              tabSize,
              indentSize: tabSize,
              convertTabsToSpaces: insertSpaces,
              newLineCharacter: "\n",
              insertSpaceBeforeAndAfterBinaryOperators: true,
              insertSpaceAfterCommaDelimiter: true,
              insertSpaceAfterSemicolonInForStatements: true,
            }) ?? [];
            for (const edit of generated) {
              const start = model?.toSource(edit.span.start);
              const end = model?.toSource(edit.span.start + edit.span.length);
              if (start === undefined || end === undefined || end > section.contentEnd) continue;
              edits.push(vscode.TextEdit.replace(new vscode.Range(document.positionAt(start), document.positionAt(end)), edit.newText));
            }
            continue;
          }
          const language = section.name === "template" ? "html" : "css";
          const temporary = await vscode.workspace.openTextDocument({ language, content: section.content });
          const generated = await vscode.commands.executeCommand<vscode.TextEdit[]>("vscode.executeFormatDocumentProvider", temporary.uri, {
            tabSize,
            insertSpaces,
          });
          if (!generated?.length) continue;
          let formatted = section.content;
          for (const edit of [...generated].sort((a, b) => temporary.offsetAt(b.range.start) - temporary.offsetAt(a.range.start))) {
            const start = temporary.offsetAt(edit.range.start);
            const end = temporary.offsetAt(edit.range.end);
            formatted = formatted.slice(0, start) + edit.newText + formatted.slice(end);
          }
          if (formatted !== section.content) {
            edits.push(vscode.TextEdit.replace(
              new vscode.Range(document.positionAt(section.contentStart), document.positionAt(section.contentEnd)),
              formatted,
            ));
          }
        }
        return edits;
      } catch {
        return [];
      }
    },
  }));

  for (const document of vscode.workspace.textDocuments) scheduleCheck(document);
  context.subscriptions.push({ dispose: () => {
    for (const timer of timers.values()) clearTimeout(timer);
    for (const cached of models.values()) cached.model.dispose();
    models.clear();
  } });
}

/** Libera los recursos al desactivar la extensión. */
export function deactivate(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  for (const cached of models.values()) cached.model.dispose();
  models.clear();
}

function clearModel(key: string): void {
  models.get(key)?.model.dispose();
  models.delete(key);
}

function getModel(document: vscode.TextDocument): EditorModel | undefined {
  const key = document.uri.toString();
  const existing = models.get(key);
  if (existing?.version === document.version) return existing.model;
  clearModel(key);
  try {
    const model = createEditorModel(document.getText(), document.fileName);
    models.set(key, { version: document.version, model });
    return model;
  } catch {
    return undefined;
  }
}

function modelAt(document: vscode.TextDocument, position: vscode.Position): { model: EditorModel; offset: number } | undefined {
  const model = getModel(document);
  const offset = model?.toGenerated(document.offsetAt(position));
  return model && offset !== undefined ? { model, offset } : undefined;
}

function sourceRange(model: EditorModel, document: vscode.TextDocument, span: ts.TextSpan): vscode.Range | undefined {
  const start = model.toSource(span.start);
  const end = model.toSource(span.start + span.length);
  return start === undefined || end === undefined
    ? undefined
    : new vscode.Range(document.positionAt(start), document.positionAt(end));
}

function translateLocation(model: EditorModel, document: vscode.TextDocument, filename: string, span: ts.TextSpan): vscode.Location | undefined {
  if (filename === model.virtualFilename) {
    const range = sourceRange(model, document, span);
    return range ? new vscode.Location(document.uri, range) : undefined;
  }
  const file = model.service.getProgram()?.getSourceFile(filename);
  if (!file) return undefined;
  const start = file.getLineAndCharacterOfPosition(span.start);
  const end = file.getLineAndCharacterOfPosition(span.start + span.length);
  return new vscode.Location(vscode.Uri.file(filename), new vscode.Range(start.line, start.character, end.line, end.character));
}

function completionKind(kind: string): vscode.CompletionItemKind {
  if (["function", "method"].includes(kind)) return vscode.CompletionItemKind.Function;
  if (["class", "interface", "type"].includes(kind)) return vscode.CompletionItemKind.Class;
  if (["property", "memberVariable"].includes(kind)) return vscode.CompletionItemKind.Property;
  return vscode.CompletionItemKind.Variable;
}

function scheduleCheck(document: vscode.TextDocument): void {
  if (document.languageId !== "meeko" || document.uri.scheme !== "file") return;
  const key = document.uri.toString();
  clearTimeout(timers.get(key));
  const version = document.version;
  timers.set(key, setTimeout(() => { void check(document, version); }, 450));
}

async function check(document: vscode.TextDocument, version: number): Promise<void> {
  const source = document.getText();
  const filename = document.fileName;
  try {
    const found = await checkSource(source, filename);
    if (document.version !== version || document.isClosed) return;
    diagnostics.set(document.uri, found.map((item) => {
      const start = document.positionAt(item.location.offset);
      const end = document.positionAt(Math.min(item.location.offset + 1, source.length));
      const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end), item.message, vscode.DiagnosticSeverity.Error);
      diagnostic.code = item.code;
      diagnostic.source = "Meeko";
      return diagnostic;
    }));
  } catch (error) {
    if (document.version === version) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`${filename}: ${message}`);
    }
  }
}
