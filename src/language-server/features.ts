import { dirname, relative } from "node:path";
import ts from "@typescript/typescript6";
import { getCSSLanguageService } from "vscode-css-languageservice";
import { getLanguageService as getHtmlLanguageService } from "vscode-html-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CodeActionKind, CompletionItemKind, FoldingRangeKind, MarkupKind, SemanticTokensBuilder, SymbolKind,
} from "vscode-languageserver/node";
import type {
  CodeAction, CompletionItem, Diagnostic, DocumentSymbol, FoldingRange, FormattingOptions, Hover, Location,
  ParameterInformation, Position, Range, SemanticTokens, SemanticTokensLegend, SignatureHelp, SignatureInformation,
  TextEdit, WorkspaceEdit,
} from "vscode-languageserver/node";
import type { AutoImport } from "../autoimports.js";
import { parseSfc } from "../compiler/sfc.js";
import type { SfcSection } from "../compiler/sfc.js";
import type { VirtualComponent } from "./model.js";
import type { MeekoProject } from "./project.js";

/** Documento resuelto para traducir posiciones de cualquier archivo de un resultado. */
export interface LocatedDocument {
  readonly uri: string;
  readonly document: TextDocument;
}

/** Contexto común de una petición sobre un componente abierto. */
export interface FeatureContext {
  readonly project: MeekoProject;
  readonly component: VirtualComponent;
  readonly document: TextDocument;
  /** Traduce una ruta de archivo (componente o TypeScript) a su URI y texto actuales. */
  locate(filename: string): LocatedDocument | undefined;
}

const semanticTypes = ["class", "enum", "interface", "namespace", "typeParameter", "type", "parameter", "variable", "enumMember", "property", "function", "method"];
const semanticModifiers = ["declaration", "static", "async", "readonly", "defaultLibrary"];

/** Leyenda de tokens semánticos que anuncia el servidor. */
export const semanticTokensLegend: SemanticTokensLegend = { tokenTypes: semanticTypes, tokenModifiers: semanticModifiers };

const htmlLanguageService = getHtmlLanguageService();
const cssLanguageService = getCSSLanguageService();
const userPreferences: ts.UserPreferences = {
  quotePreference: "double",
  importModuleSpecifierEnding: "js",
  importModuleSpecifierPreference: "relative",
  includeCompletionsForModuleExports: true,
  includeCompletionsWithInsertText: true,
};
// Renaming an imported symbol renames its declaration and every importer, across .meeko and
// .ts files, instead of introducing a local `import { a as b }` alias.
const renamePreferences: ts.UserPreferences = { ...userPreferences, providePrefixAndSuffixTextForRename: false };

/** Rango fuente de un tramo generado; ambos extremos deben pertenecer a un mismo tramo mapeado. */
export function sourceRange(component: VirtualComponent, start: number, length: number): [number, number] | undefined {
  for (const span of component.spans) {
    if (start >= span.generatedStart && start + length <= span.generatedEnd) {
      return [span.sourceStart + start - span.generatedStart, span.sourceStart + start + length - span.generatedStart];
    }
  }
  return undefined;
}

function toRange(document: TextDocument, start: number, end: number): Range {
  return { start: document.positionAt(start), end: document.positionAt(end) };
}

function generatedOffset(context: FeatureContext, position: Position): number | undefined {
  return context.component.toGenerated(context.document.offsetAt(position));
}

/** Ubicación LSP de un tramo de TypeScript, ya sea de un componente virtual o de un archivo real. */
export function locationOf(context: FeatureContext, fileName: string, span: ts.TextSpan): Location | undefined {
  const virtual = context.project.virtualEntry(fileName);
  if (virtual) {
    const range = sourceRange(virtual, span.start, span.length);
    const target = range && context.locate(virtual.filename);
    return range && target ? { uri: target.uri, range: toRange(target.document, range[0], range[1]) } : undefined;
  }
  const target = context.locate(fileName);
  return target ? { uri: target.uri, range: toRange(target.document, span.start, span.start + span.length) } : undefined;
}

function dedupeLocations(locations: readonly Location[]): Location[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = `${location.uri}:${location.range.start.line}:${location.range.start.character}:${location.range.end.line}:${location.range.end.character}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function completionKind(kind: string): CompletionItemKind {
  switch (kind) {
    case "function": case "local function": return CompletionItemKind.Function;
    case "method": case "construct": case "call": return CompletionItemKind.Method;
    case "class": case "local class": return CompletionItemKind.Class;
    case "interface": return CompletionItemKind.Interface;
    case "type": case "type parameter": return CompletionItemKind.TypeParameter;
    case "enum": return CompletionItemKind.Enum;
    case "enum member": return CompletionItemKind.EnumMember;
    case "module": case "external module name": return CompletionItemKind.Module;
    case "property": case "getter": case "setter": case "memberVariable": return CompletionItemKind.Property;
    case "keyword": return CompletionItemKind.Keyword;
    case "const": return CompletionItemKind.Constant;
    case "string": return CompletionItemKind.Value;
    default: return CompletionItemKind.Variable;
  }
}

/** Datos que conserva un elemento de completado para resolver su detalle. */
export interface CompletionData {
  readonly uri: string;
  readonly offset: number;
  readonly name: string;
  readonly source?: string;
  readonly data?: ts.CompletionEntryData;
}

export function completion(context: FeatureContext, position: Position): CompletionItem[] | undefined {
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  const result = context.project.service.getCompletionsAtPosition(context.component.virtualFilename, offset, userPreferences);
  if (!result) return undefined;
  return result.entries.map((entry) => {
    const item: CompletionItem = { label: entry.name, kind: completionKind(entry.kind), sortText: entry.sortText };
    if (entry.insertText !== undefined) item.insertText = entry.insertText;
    if (entry.filterText !== undefined) item.filterText = entry.filterText;
    if (entry.replacementSpan) {
      const range = sourceRange(context.component, entry.replacementSpan.start, entry.replacementSpan.length);
      if (range) item.textEdit = { range: toRange(context.document, range[0], range[1]), newText: entry.insertText ?? entry.name };
    }
    if (entry.source !== undefined && entry.hasAction) item.labelDetails = { description: entry.source };
    const data: CompletionData = {
      uri: context.document.uri,
      offset,
      name: entry.name,
      ...(entry.source === undefined ? {} : { source: entry.source }),
      ...(entry.data === undefined ? {} : { data: entry.data }),
    };
    item.data = data;
    return item;
  });
}

export function resolveCompletion(context: FeatureContext, item: CompletionItem): CompletionItem {
  const data = item.data as CompletionData | undefined;
  if (!data) return item;
  const details = context.project.service.getCompletionEntryDetails(
    context.component.virtualFilename, data.offset, data.name, formatSettings({ tabSize: 2, insertSpaces: true }),
    data.source, userPreferences, data.data,
  );
  if (!details) return item;
  const detail = ts.displayPartsToString(details.displayParts);
  if (detail) item.detail = detail;
  const documentation = ts.displayPartsToString(details.documentation ?? []);
  if (documentation) item.documentation = { kind: MarkupKind.Markdown, value: documentation };
  const edits = details.codeActions?.flatMap((action) => {
    const mapped = mapFileChanges(context, action.changes);
    return mapped?.[context.document.uri] ?? [];
  }) ?? [];
  if (edits.length) item.additionalTextEdits = edits;
  return item;
}

export function hover(context: FeatureContext, position: Position): Hover | undefined {
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  const info = context.project.service.getQuickInfoAtPosition(context.component.virtualFilename, offset);
  if (!info) return undefined;
  const signature = ts.displayPartsToString(info.displayParts ?? []);
  const documentation = ts.displayPartsToString(info.documentation ?? []);
  const tags = (info.tags ?? []).map((tag) => `*@${tag.name}*${tag.text ? ` — ${ts.displayPartsToString(tag.text)}` : ""}`);
  const value = ["```typescript", signature, "```", ...(documentation ? ["", documentation] : []), ...(tags.length ? ["", tags.join("\n\n")] : [])].join("\n");
  const range = sourceRange(context.component, info.textSpan.start, info.textSpan.length);
  return { contents: { kind: MarkupKind.Markdown, value }, ...(range ? { range: toRange(context.document, range[0], range[1]) } : {}) };
}

export function definition(context: FeatureContext, position: Position): Location[] | undefined {
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  const definitions = context.project.service.getDefinitionAtPosition(context.component.virtualFilename, offset) ?? [];
  return dedupeLocations(definitions.flatMap((item) => locationOf(context, item.fileName, item.textSpan) ?? []));
}

export function references(context: FeatureContext, position: Position, includeDeclaration: boolean): Location[] | undefined {
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  const symbols = context.project.service.findReferences(context.component.virtualFilename, offset) ?? [];
  const declarations = new Set(symbols.map((symbol) => `${symbol.definition.fileName}:${symbol.definition.textSpan.start}`));
  const locations = symbols.flatMap((symbol) => symbol.references
    .filter((reference) => includeDeclaration || (!reference.isDefinition && !declarations.has(`${reference.fileName}:${reference.textSpan.start}`)))
    .flatMap((reference) => locationOf(context, reference.fileName, reference.textSpan) ?? []));
  return dedupeLocations(locations);
}

export function prepareRename(context: FeatureContext, position: Position): { range: Range; placeholder: string } | undefined {
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  const info = context.project.service.getRenameInfo(context.component.virtualFilename, offset, renamePreferences);
  if (!info.canRename) return undefined;
  const range = sourceRange(context.component, info.triggerSpan.start, info.triggerSpan.length);
  return range ? { range: toRange(context.document, range[0], range[1]), placeholder: context.document.getText().slice(range[0], range[1]) } : undefined;
}

export function rename(context: FeatureContext, position: Position, newName: string): WorkspaceEdit | undefined {
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  const info = context.project.service.getRenameInfo(context.component.virtualFilename, offset, renamePreferences);
  if (!info.canRename) return undefined;
  const locations = context.project.service.findRenameLocations(context.component.virtualFilename, offset, false, false, renamePreferences) ?? [];
  const changes: Record<string, TextEdit[]> = {};
  const seen = new Set<string>();
  for (const location of locations) {
    const target = locationOf(context, location.fileName, location.textSpan);
    if (!target) continue;
    const key = `${target.uri}:${target.range.start.line}:${target.range.start.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (changes[target.uri] ??= []).push({ range: target.range, newText: `${location.prefixText ?? ""}${newName}${location.suffixText ?? ""}` });
  }
  return { changes };
}

export function signatureHelp(context: FeatureContext, position: Position): SignatureHelp | undefined {
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  const help = context.project.service.getSignatureHelpItems(context.component.virtualFilename, offset, {});
  if (!help) return undefined;
  const signatures = help.items.map((item): SignatureInformation => {
    const separator = ts.displayPartsToString(item.separatorDisplayParts);
    let label = ts.displayPartsToString(item.prefixDisplayParts);
    const parameters: ParameterInformation[] = item.parameters.map((parameter, index) => {
      if (index > 0) label += separator;
      const start = label.length;
      label += ts.displayPartsToString(parameter.displayParts);
      const documentation = ts.displayPartsToString(parameter.documentation);
      return { label: [start, label.length], ...(documentation ? { documentation } : {}) };
    });
    label += ts.displayPartsToString(item.suffixDisplayParts);
    const documentation = ts.displayPartsToString(item.documentation);
    return { label, parameters, ...(documentation ? { documentation: { kind: MarkupKind.Markdown, value: documentation } } : {}) };
  });
  return { signatures, activeSignature: help.selectedItemIndex, activeParameter: help.argumentIndex };
}

/** Tokens semánticos de script y expresiones de plantilla; los multilínea se dividen por línea. */
export function semanticTokens(context: FeatureContext): SemanticTokens {
  const { component, document } = context;
  const encoded = context.project.service.getEncodedSemanticClassifications(
    component.virtualFilename,
    { start: 0, length: component.code.length },
    ts.SemanticClassificationFormat.TwentyTwenty,
  ).spans;
  const tokens: Array<{ start: number; end: number; type: number; modifiers: number }> = [];
  for (let index = 0; index < encoded.length; index += 3) {
    const generatedStart = encoded[index]!;
    const length = encoded[index + 1]!;
    const classification = encoded[index + 2]!;
    const type = (classification >> 8) - 1;
    if (type < 0 || type >= semanticTypes.length || length <= 0) continue;
    const range = sourceRange(component, generatedStart, length);
    if (!range) continue;
    // TypeScript encodes modifiers from bit 0 in the legend's order. The declaration bit is
    // dropped so a declaration and its uses share one color; bits beyond the legend are ignored.
    tokens.push({ start: range[0], end: range[1], type, modifiers: classification & 0b11110 });
  }
  tokens.sort((left, right) => left.start - right.start || left.end - right.end);
  const builder = new SemanticTokensBuilder();
  let previousEnd = -1;
  for (const token of tokens) {
    if (token.start < previousEnd) continue;
    previousEnd = token.end;
    const start = document.positionAt(token.start);
    const end = document.positionAt(token.end);
    for (let line = start.line; line <= end.line; line++) {
      const from = line === start.line ? start.character : 0;
      const to = line === end.line ? end.character : lineLength(document, line);
      if (to > from) builder.push(line, from, to - from, token.type, token.modifiers);
    }
  }
  return builder.build();
}

function lineLength(document: TextDocument, line: number): number {
  const text = document.getText({ start: { line, character: 0 }, end: { line: line + 1, character: 0 } });
  return text.replace(/\r?\n$|\r$/, "").length;
}

const navigationKinds: Record<string, SymbolKind> = {
  module: SymbolKind.Module,
  class: SymbolKind.Class,
  "local class": SymbolKind.Class,
  enum: SymbolKind.Enum,
  "enum member": SymbolKind.EnumMember,
  interface: SymbolKind.Interface,
  type: SymbolKind.TypeParameter,
  method: SymbolKind.Method,
  property: SymbolKind.Property,
  getter: SymbolKind.Property,
  setter: SymbolKind.Property,
  constructor: SymbolKind.Constructor,
  function: SymbolKind.Function,
  "local function": SymbolKind.Function,
  const: SymbolKind.Constant,
  let: SymbolKind.Variable,
  var: SymbolKind.Variable,
  "local var": SymbolKind.Variable,
  alias: SymbolKind.Variable,
};

function sections(source: string, filename: string): SfcSection[] {
  const parsed = parseSfc(source, filename);
  return [parsed.script, parsed.template, ...(parsed.style ? [parsed.style] : [])].sort((left, right) => left.start - right.start);
}

/** Documento con todo el texto fuera de una sección sustituido por espacios; conserva posiciones. */
function maskedSection(document: TextDocument, section: SfcSection, language: string): TextDocument {
  const source = document.getText();
  const masked = source.slice(0, section.contentStart).replace(/[^\r\n]/g, " ")
    + section.content
    + source.slice(section.contentEnd).replace(/[^\r\n]/g, " ");
  return TextDocument.create(`${document.uri}#${language}`, language, document.version, masked);
}

export function documentSymbols(context: FeatureContext): DocumentSymbol[] {
  const { component, document } = context;
  const convert = (item: ts.NavigationTree): DocumentSymbol | undefined => {
    const span = item.spans[0];
    const range = span && sourceRange(component, span.start, span.length);
    if (!range || item.text.startsWith("__meeko_")) return undefined;
    const name = (item.nameSpan && sourceRange(component, item.nameSpan.start, item.nameSpan.length)) ?? [range[0], range[0]];
    const children = (item.childItems ?? []).flatMap((child) => convert(child) ?? []).sort(byPosition);
    return {
      name: item.text,
      kind: navigationKinds[item.kind] ?? SymbolKind.Variable,
      range: toRange(document, range[0], range[1]),
      selectionRange: toRange(document, name[0], name[1]),
      ...(children.length ? { children } : {}),
    };
  };
  const tree = context.project.service.getNavigationTree(component.virtualFilename);
  const byPosition = (left: DocumentSymbol, right: DocumentSymbol) =>
    left.range.start.line - right.range.start.line || left.range.start.character - right.range.start.character;
  const scriptSymbols = (tree.childItems ?? []).flatMap((item) => convert(item) ?? []).sort(byPosition);
  return sections(document.getText(), component.filename).map((section) => {
    let children: DocumentSymbol[] = [];
    if (section.name === "script") children = scriptSymbols;
    else if (section.name === "template") {
      const html = maskedSection(document, section, "html");
      children = htmlLanguageService.findDocumentSymbols2(html, htmlLanguageService.parseHTMLDocument(html));
    } else {
      const css = maskedSection(document, section, "css");
      children = cssLanguageService.findDocumentSymbols2(css, cssLanguageService.parseStylesheet(css));
    }
    const tagEnd = section.contentStart;
    return {
      name: `<${section.name}>`,
      kind: SymbolKind.Module,
      range: toRange(document, section.start, section.end),
      selectionRange: toRange(document, section.start, tagEnd),
      ...(children.length ? { children } : {}),
    };
  });
}

export function foldingRanges(context: FeatureContext): FoldingRange[] {
  const { component, document } = context;
  const ranges: FoldingRange[] = [];
  const add = (startLine: number, endLine: number, kind?: string): void => {
    if (endLine > startLine) ranges.push({ startLine, endLine, ...(kind ? { kind } : {}) });
  };
  for (const section of sections(document.getText(), component.filename)) {
    add(document.positionAt(section.start).line, document.positionAt(section.end).line - 1);
    if (section.name === "template") {
      ranges.push(...htmlLanguageService.getFoldingRanges(maskedSection(document, section, "html"), {}));
    } else if (section.name === "style") {
      ranges.push(...cssLanguageService.getFoldingRanges(maskedSection(document, section, "css"), {}));
    }
  }
  for (const span of context.project.service.getOutliningSpans(component.virtualFilename)) {
    const range = sourceRange(component, span.textSpan.start, span.textSpan.length);
    if (!range) continue;
    const kind = span.kind === ts.OutliningSpanKind.Comment ? FoldingRangeKind.Comment
      : span.kind === ts.OutliningSpanKind.Imports ? FoldingRangeKind.Imports
        : span.kind === ts.OutliningSpanKind.Region ? FoldingRangeKind.Region : undefined;
    const end = document.positionAt(range[1]);
    // Like VS Code's TypeScript support, keep the closing brace line visible.
    const endLine = end.character > 0 && /^\s*[}\])]/.test(document.getText().slice(document.offsetAt({ line: end.line, character: 0 }), range[1])) ? end.line - 1 : end.line;
    add(document.positionAt(range[0]).line, endLine, kind);
  }
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.startLine}:${range.endLine}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
}

function formatSettings(options: Pick<FormattingOptions, "tabSize" | "insertSpaces">): ts.FormatCodeSettings {
  return {
    tabSize: options.tabSize,
    indentSize: options.tabSize,
    convertTabsToSpaces: options.insertSpaces,
    newLineCharacter: "\n",
    insertSpaceBeforeAndAfterBinaryOperators: true,
    insertSpaceAfterCommaDelimiter: true,
    insertSpaceAfterSemicolonInForStatements: true,
  };
}

/** Formatea script con TypeScript y plantilla y estilos con los servicios HTML y CSS. */
export function formatting(context: FeatureContext, options: FormattingOptions): TextEdit[] {
  const { component, document } = context;
  const source = document.getText();
  const edits: TextEdit[] = [];
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  for (const section of sections(source, component.filename)) {
    if (section.name === "script") {
      const script = component.spans[0]!;
      const generated = context.project.service.getFormattingEditsForRange(
        component.virtualFilename, script.generatedStart, script.generatedEnd, formatSettings(options),
      );
      for (const edit of generated) {
        const range = sourceRange(component, edit.span.start, edit.span.length);
        if (!range || range[1] > section.contentEnd) continue;
        edits.push({ range: toRange(document, range[0], range[1]), newText: edit.newText });
      }
      continue;
    }
    const language = section.name === "template" ? "html" : "css";
    const embedded = TextDocument.create(`${document.uri}#${language}`, language, document.version, section.content);
    const generated = language === "html"
      ? htmlLanguageService.format(embedded, undefined, { tabSize: options.tabSize, insertSpaces: options.insertSpaces })
      : cssLanguageService.format(embedded, undefined, { tabSize: options.tabSize, insertSpaces: options.insertSpaces });
    let formatted = section.content;
    for (const edit of [...generated].sort((a, b) => embedded.offsetAt(b.range.start) - embedded.offsetAt(a.range.start))) {
      formatted = formatted.slice(0, embedded.offsetAt(edit.range.start)) + edit.newText + formatted.slice(embedded.offsetAt(edit.range.end));
    }
    if (formatted.trim()) {
      if (!formatted.startsWith("\n") && !formatted.startsWith("\r\n")) formatted = newline + formatted;
      if (!formatted.endsWith("\n")) formatted += newline;
    }
    if (formatted !== section.content) edits.push({ range: toRange(document, section.contentStart, section.contentEnd), newText: formatted });
  }
  return edits;
}

/** Traduce cambios de TypeScript; descarta el conjunto si algún cambio cae en código sintético. */
export function mapFileChanges(context: FeatureContext, changes: readonly ts.FileTextChanges[]): Record<string, TextEdit[]> | undefined {
  const result: Record<string, TextEdit[]> = {};
  for (const change of changes) {
    if (change.isNewFile) return undefined;
    const virtual = context.project.virtualEntry(change.fileName);
    const target = context.locate(virtual?.filename ?? change.fileName);
    if (!target) return undefined;
    for (const textChange of change.textChanges) {
      let range: [number, number] | undefined;
      if (virtual) {
        range = sourceRange(virtual, textChange.span.start, textChange.span.length);
        const script = virtual.spans[0]!;
        if (textChange.span.length === 0 && (!range || range[0] === script.sourceStart) && textChange.span.start <= script.generatedStart) {
          // New imports go at the top of the script, after the line break that follows <script>.
          let at = script.sourceStart;
          const text = target.document.getText();
          if (text.startsWith("\r\n", at)) at += 2;
          else if (text[at] === "\n") at += 1;
          range = [at, at];
        }
      } else range = [textChange.span.start, textChange.span.start + textChange.span.length];
      if (!range) return undefined;
      (result[target.uri] ??= []).push({ range: toRange(target.document, range[0], range[1]), newText: textChange.newText });
    }
  }
  return result;
}

function overlaps(left: Range, right: Range): boolean {
  const before = (a: Position, b: Position) => a.line < b.line || (a.line === b.line && a.character <= b.character);
  return before(left.start, right.end) && before(right.start, left.end);
}

/** Correcciones rápidas: imports de TypeScript, autoimports ambiguos y `params` en rutas estáticas. */
export function codeActions(context: FeatureContext, range: Range, diagnostics: readonly Diagnostic[]): CodeAction[] {
  const { component, document } = context;
  const actions: CodeAction[] = [];
  const service = context.project.service;
  const fixable = new Set(service.getSupportedCodeFixes().map(Number));
  for (const diagnostic of diagnostics) {
    const code = typeof diagnostic.code === "string" ? Number(/^TS(\d+)$/.exec(diagnostic.code)?.[1]) : diagnostic.code;
    if (code === undefined || !Number.isFinite(code) || !fixable.has(code)) continue;
    const start = component.toGenerated(document.offsetAt(diagnostic.range.start));
    const end = component.toGenerated(document.offsetAt(diagnostic.range.end));
    if (start === undefined || end === undefined) continue;
    let fixes: readonly ts.CodeFixAction[];
    try { fixes = service.getCodeFixesAtPosition(component.virtualFilename, start, Math.max(start, end), [code], formatSettings({ tabSize: 2, insertSpaces: true }), userPreferences); }
    catch { continue; }
    for (const fix of fixes) {
      const changes = mapFileChanges(context, fix.changes);
      if (!changes) continue;
      actions.push({
        title: fix.description,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        ...(fix.fixName === "import" ? { isPreferred: true } : {}),
        edit: { changes },
      });
    }
  }
  actions.push(...autoImportActions(context, range, diagnostics));
  actions.push(...staticHrefActions(context, range, diagnostics));
  return actions;
}

function importStatement(component: VirtualComponent, entry: AutoImport): string {
  let specifier = entry.specifier ?? relative(dirname(component.filename), entry.file).replaceAll("\\", "/");
  if (!entry.specifier && !specifier.startsWith(".")) specifier = `./${specifier}`;
  if (!entry.component && !entry.specifier) specifier = specifier.replace(/\.[cm]?ts$/, ".js");
  return entry.component
    ? `import * as ${entry.name} from ${JSON.stringify(specifier)};`
    : `import ${entry.typeOnly ? "type " : ""}{ ${entry.imported === entry.name ? entry.name : `${entry.imported} as ${entry.name}`} } from ${JSON.stringify(specifier)};`;
}

function scriptInsertion(context: FeatureContext): Range {
  const script = context.component.spans[0]!;
  const text = context.document.getText();
  let at = script.sourceStart;
  if (text.startsWith("\r\n", at)) at += 2;
  else if (text[at] === "\n") at += 1;
  return toRange(context.document, at, at);
}

function autoImportActions(context: FeatureContext, range: Range, diagnostics: readonly Diagnostic[]): CodeAction[] {
  const actions: CodeAction[] = [];
  const related = diagnostics.filter((item) => item.code === "MEEK_AUTOIMPORT");
  for (const problem of context.component.problems) {
    if (problem.kind !== "ambiguous") continue;
    const occurrence = identifierRange(context, problem.name);
    if (!related.length && !(occurrence && overlaps(occurrence, range))) continue;
    for (const candidate of problem.candidates) {
      const statement = importStatement(context.component, candidate);
      const newline = context.document.getText().includes("\r\n") ? "\r\n" : "\n";
      actions.push({
        title: `Import ${problem.name} from ${candidate.specifier ?? relative(dirname(context.component.filename), candidate.file).replaceAll("\\", "/")}`,
        kind: CodeActionKind.QuickFix,
        ...(related.length ? { diagnostics: related } : {}),
        edit: { changes: { [context.document.uri]: [{ range: scriptInsertion(context), newText: `${statement}${newline}` }] } },
      });
    }
  }
  return actions;
}

/** Rango de la primera referencia a un identificador en el código del componente. */
export function identifierRange(context: Pick<FeatureContext, "component" | "document">, name: string): Range | undefined {
  const { component, document } = context;
  const file = ts.createSourceFile(component.virtualFilename, component.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found: [number, number] | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) {
      const range = sourceRange(component, node.getStart(file), node.getWidth(file));
      if (range) { found = range; return; }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found ? toRange(document, found[0], found[1]) : undefined;
}

function staticHrefActions(context: FeatureContext, range: Range, diagnostics: readonly Diagnostic[]): CodeAction[] {
  const { component, document } = context;
  const file = ts.createSourceFile(component.virtualFilename, component.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const actions: CodeAction[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const named = (ts.isIdentifier(callee) && callee.text === "href") || (ts.isPropertyAccessExpression(callee) && callee.name.text === "href");
      const [, id, options] = node.arguments;
      if (named && id && options && ts.isStringLiteralLike(id) && !id.text.includes("[") && ts.isObjectLiteralExpression(options)) {
        const index = options.properties.findIndex((property) => property.name && ts.isIdentifier(property.name) && property.name.text === "params");
        const property = options.properties[index];
        if (property) {
          let start: number;
          let end: number;
          if (options.properties.length === 1) {
            start = id.getEnd();
            end = options.getEnd();
          } else if (index < options.properties.length - 1) {
            start = property.getStart(file);
            end = options.properties[index + 1]!.getStart(file);
          } else {
            start = options.properties[index - 1]!.getEnd();
            end = property.getEnd();
          }
          const removal = sourceRange(component, start, end - start);
          const call = sourceRange(component, node.getStart(file), node.getWidth(file));
          if (removal && call) {
            const target = toRange(document, removal[0], removal[1]);
            const callRange = toRange(document, call[0], call[1]);
            const related = diagnostics.filter((item) => overlaps(item.range, callRange));
            if (overlaps(callRange, range) || related.length) {
              actions.push({
                title: `Remove params from static route ${JSON.stringify(id.text)}`,
                kind: CodeActionKind.QuickFix,
                ...(related.length ? { diagnostics: related, isPreferred: true } : {}),
                edit: { changes: { [document.uri]: [{ range: target, newText: "" }] } },
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return actions;
}
