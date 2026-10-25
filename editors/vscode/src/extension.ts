import * as vscode from "vscode";
import { relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { getLanguageService as getHtmlLanguageService } from "vscode-html-languageservice";
import { getCSSLanguageService } from "vscode-css-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parseSfc } from "../../../src/compiler/sfc.js";
import { checkSource } from "../../../src/check.js";
import { projectRoot } from "../../../src/compiler/project-root.js";
import { checkFrameworkPageContracts } from "../../../src/framework/page-contracts-check.js";
import { createEditorModel, type EditorModel } from "./model.js";

/** Estado de un documento abierto y su proyecto TypeScript virtual. */
interface CachedModel {
  version: number;
  model: EditorModel;
  semantic?: vscode.SemanticTokens;
}

const selector: vscode.DocumentSelector = [{ language: "meeko", scheme: "file" }];
const semanticTypes = ["class", "enum", "interface", "namespace", "typeParameter", "type", "parameter", "variable", "enumMember", "property", "function", "method"];
const semanticModifiers = ["declaration", "static", "async", "readonly", "defaultLibrary"];
const semanticLegend = new vscode.SemanticTokensLegend(semanticTypes, semanticModifiers);
const semanticChanges = new vscode.EventEmitter<void>();
const models = new Map<string, CachedModel>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const htmlLanguageService = getHtmlLanguageService();
const cssLanguageService = getCSSLanguageService();
let diagnostics: vscode.DiagnosticCollection;
let contractDiagnostics: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;
const contractTimers = new Map<string, ReturnType<typeof setTimeout>>();
const contractVersions = new Map<string, number>();
const contractRuns = new Map<string, Promise<void>>();
const contractUris = new Map<string, Set<string>>();

/** Inicia los diagnósticos y las herramientas semánticas del lenguaje. */
export function activate(context: vscode.ExtensionContext): void {
  diagnostics = vscode.languages.createDiagnosticCollection("meeko");
  contractDiagnostics = vscode.languages.createDiagnosticCollection("meeko-project-contracts");
  output = vscode.window.createOutputChannel("Meeko");
  context.subscriptions.push(diagnostics, contractDiagnostics, output, semanticChanges);
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((document) => {
    scheduleCheck(document);
    scheduleContractCheck(document);
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(({ document }) => {
    clearModel(document.uri.toString());
    contractDiagnostics.delete(document.uri);
    scheduleCheck(document);
  }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.uri.scheme === "file" && ["typescript", "typescriptreact", "javascript", "javascriptreact"].includes(document.languageId)) {
      refreshProjectModels(document.fileName);
    }
    scheduleCheck(document);
    scheduleContractCheck(document);
  }));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.delete(key);
    clearModel(key);
    diagnostics.delete(document.uri);
  }));

  context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, {
    onDidChangeSemanticTokens: semanticChanges.event,
    async provideDocumentSemanticTokens(document, cancellation) {
      const version = document.version;
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (cancellation.isCancellationRequested || document.version !== version) {
        return new vscode.SemanticTokensBuilder(semanticLegend).build();
      }
      const model = getModel(document);
      if (!model) return new vscode.SemanticTokensBuilder(semanticLegend).build();
      const cached = models.get(document.uri.toString());
      if (cached?.semantic) return cached.semantic;
      try {
        const encoded = model.service.getEncodedSemanticClassifications(
          model.virtualFilename,
          { start: 0, length: model.code.length },
          ts.SemanticClassificationFormat.TwentyTwenty,
        ).spans;
        const tokens: Array<{ start: number; end: number; type: string; modifiers: string[] }> = [];
        for (let index = 0; index < encoded.length; index += 3) {
          const generatedStart = encoded[index]!;
          const length = encoded[index + 1]!;
          const classification = encoded[index + 2]!;
          const span = model.spans.find((item) => generatedStart >= item.generatedStart && generatedStart + length <= item.generatedEnd);
          const type = semanticTypes[(classification >> 8) - 1];
          if (!span || !type || length <= 0) continue;
          const start = span.sourceStart + generatedStart - span.generatedStart;
          const end = start + length;
          if (end > span.sourceEnd) continue;
          const modifiers = semanticModifiers.filter((_, bit) => bit !== 0 && (classification & (1 << bit)) !== 0);
          tokens.push({ start, end, type, modifiers });
        }
        tokens.sort((left, right) => left.start - right.start);
        const builder = new vscode.SemanticTokensBuilder(semanticLegend);
        for (const token of tokens) {
          const start = document.positionAt(token.start);
          const end = document.positionAt(token.end);
          if (start.line === end.line) builder.push(new vscode.Range(start, end), token.type, token.modifiers);
        }
        const result = builder.build();
        if (!cancellation.isCancellationRequested && document.version === version && cached?.model === model) cached.semantic = result;
        return result;
      } catch {
        return new vscode.SemanticTokensBuilder(semanticLegend).build();
      }
    },
  }, semanticLegend));

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
          const embedded = TextDocument.create(`${document.uri.toString()}#${language}`, language, document.version, section.content);
          const generated = language === "html"
            ? htmlLanguageService.format(embedded, undefined, { tabSize, insertSpaces })
            : cssLanguageService.format(embedded, undefined, { tabSize, insertSpaces });
          let formatted = section.content;
          for (const edit of [...generated].sort((a, b) => embedded.offsetAt(b.range.start) - embedded.offsetAt(a.range.start))) {
            const start = embedded.offsetAt(edit.range.start);
            const end = embedded.offsetAt(edit.range.end);
            formatted = formatted.slice(0, start) + edit.newText + formatted.slice(end);
          }
          if (formatted.trim()) {
            const newline = document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
            if (!formatted.startsWith("\n") && !formatted.startsWith("\r\n")) formatted = newline + formatted;
            if (!formatted.endsWith("\n")) formatted += newline;
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

  for (const document of vscode.workspace.textDocuments) {
    scheduleCheck(document);
    scheduleContractCheck(document);
  }
  context.subscriptions.push({ dispose: () => {
    for (const timer of timers.values()) clearTimeout(timer);
    for (const timer of contractTimers.values()) clearTimeout(timer);
    for (const cached of models.values()) cached.model.dispose();
    models.clear();
  } });
}

/** Libera los recursos al desactivar la extensión. */
export function deactivate(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  for (const timer of contractTimers.values()) clearTimeout(timer);
  for (const cached of models.values()) cached.model.dispose();
  models.clear();
}

function frameworkContractRoot(document: vscode.TextDocument): string | undefined {
  if (document.uri.scheme !== "file" || !vscode.workspace.isTrusted) return undefined;
  const root = projectRoot(document.fileName);
  const parts = relative(root, resolve(document.fileName)).split(sep);
  const app = parts.indexOf("app");
  if (app < 0) return undefined;
  const area = parts[app + 1];
  const basename = parts.at(-1) ?? "";
  if (area === "pages" && (basename.endsWith(".meeko") || basename.endsWith(".route.ts"))) return root;
  if (area === "layouts" && basename.endsWith(".meeko")) return root;
  if (area === "app.meeko" || area === "error.meeko") return root;
  return undefined;
}

/** Project contracts depend on saved routes and sidecars; run them outside the typing debounce. */
function scheduleContractCheck(document: vscode.TextDocument): void {
  const root = frameworkContractRoot(document);
  if (!root || document.isDirty) return;
  clearTimeout(contractTimers.get(root));
  const version = (contractVersions.get(root) ?? 0) + 1;
  contractVersions.set(root, version);
  contractTimers.set(root, setTimeout(() => {
    const previous = contractRuns.get(root) ?? Promise.resolve();
    const run = previous.then(async () => {
      if (contractVersions.get(root) !== version) return;
      const found = await checkFrameworkPageContracts(root);
      if (contractVersions.get(root) !== version) return;
      const grouped = new Map<string, vscode.Diagnostic[]>();
      for (const item of found) {
        const uri = vscode.Uri.file(item.filename);
        const source = await vscode.workspace.openTextDocument(uri);
        const start = source.positionAt(item.offset);
        const end = source.positionAt(Math.min(item.offset + 1, source.getText().length));
        const diagnostic = new vscode.Diagnostic(new vscode.Range(start, end), item.message, vscode.DiagnosticSeverity.Error);
        diagnostic.code = item.code;
        diagnostic.source = "Meeko";
        const key = uri.toString();
        grouped.set(key, [...(grouped.get(key) ?? []), diagnostic]);
      }
      for (const key of contractUris.get(root) ?? []) {
        if (!grouped.has(key)) contractDiagnostics.delete(vscode.Uri.parse(key));
      }
      for (const [key, items] of grouped) contractDiagnostics.set(vscode.Uri.parse(key), items);
      contractUris.set(root, new Set(grouped.keys()));
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`${root}: project contract check failed: ${message}`);
      if (document.languageId === "meeko" && !document.isClosed) {
        const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), `Project contract check failed: ${message}`, vscode.DiagnosticSeverity.Error);
        diagnostic.code = "MEEK_PROJECT_CHECK";
        diagnostic.source = "Meeko";
        contractDiagnostics.set(document.uri, [diagnostic]);
      }
    });
    contractRuns.set(root, run);
    void run.finally(() => { if (contractRuns.get(root) === run) contractRuns.delete(root); });
  }, 450));
}

function clearModel(key: string): void {
  models.get(key)?.model.dispose();
  models.delete(key);
}

function refreshProjectModels(filename: string): void {
  const root = projectRoot(filename);
  const sameRoot = (other: string) => process.platform === "win32" ? other.toLowerCase() === root.toLowerCase() : other === root;
  let changed = false;
  let contractDocument: vscode.TextDocument | undefined;
  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId !== "meeko" || document.uri.scheme !== "file" || !sameRoot(projectRoot(document.fileName))) continue;
    clearModel(document.uri.toString());
    scheduleCheck(document);
    if (!contractDocument && frameworkContractRoot(document)) contractDocument = document;
    changed = true;
  }
  if (changed) semanticChanges.fire();
  if (contractDocument) scheduleContractCheck(contractDocument);
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
