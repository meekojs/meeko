import { dirname, relative } from "node:path";
import ts from "@typescript/typescript6";
import { getCSSLanguageService } from "vscode-css-languageservice";
import { getLanguageService as getHtmlLanguageService } from "vscode-html-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CodeActionKind, CompletionItemKind, FoldingRangeKind, InsertTextFormat, MarkupKind, SemanticTokensBuilder, SymbolKind,
} from "vscode-languageserver/node";
import type {
  CodeAction, CompletionItem, CompletionList, Diagnostic, DocumentSymbol, FoldingRange, FormattingOptions, Hover, Location,
  ParameterInformation, Position, Range, SemanticTokens, SemanticTokensLegend, SignatureHelp, SignatureInformation,
  TextEdit, WorkspaceEdit,
} from "vscode-languageserver/node";
import type { AutoImport } from "../autoimports.js";
import { parseSfc } from "../compiler/sfc.js";
import type { SfcSection } from "../compiler/sfc.js";
import { eachKeyActions, sidecarActions } from "./actions.js";
import { domEventCompletion, htmlAttributeCompletion, tagAt } from "./embedded.js";
import { componentSummaryMarkdown, tagSummary } from "./components.js";
import type { EditCapabilities } from "./actions.js";
import type { AppIndex } from "./app-index.js";
import { appTargetDefinition, appTargetHover, componentMarkdown, componentModuleAt, reactiveHover } from "./insights.js";
import type { HoverSection } from "./insights.js";
import { componentFiles, htmlDirectiveDocs } from "./model.js";
import type { ComponentTag, SnippetTag, VirtualComponent } from "./model.js";
import type { MeekoProject } from "./project.js";
import { analyzeReactivity } from "./reactivity.js";

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
  /** Páginas, endpoints y procedimientos del proyecto para hover y definición de rutas, API y RPC. */
  readonly app?: AppIndex | undefined;
}

const semanticTypes = ["class", "enum", "interface", "namespace", "typeParameter", "type", "parameter", "variable", "enumMember", "property", "function", "method"];
/**
 * The first five modifiers are TypeScript's, in its bit order. `modification` (LSP) marks a write of
 * `.value` or a call that reloads a resource; `signal`, `computed` and `resource` mark a reactive
 * declaration and its uses; `reactive` marks the tokens of a template expression that reads one.
 */
const semanticModifiers = ["declaration", "static", "async", "readonly", "defaultLibrary", "modification", "signal", "computed", "resource", "reactive"];
const modifierBit = (name: string): number => 1 << semanticModifiers.indexOf(name);

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
  // Like tsserver: auto-import entries whose module specifier is not resolved within TypeScript's
  // budget come back unresolved and the list is incomplete, so the editor asks again as the user
  // types. Without it, every completion resolved the specifier of every export (about 6 s).
  allowIncompleteCompletions: true,
};
// Renaming an imported symbol renames its declaration and every importer, across .meeko and
// .ts files, instead of introducing a local `import { a as b }` alias.
/** Trigger characters that TypeScript understands; `:` and others are Meeko's own. */
const typescriptTriggers = [".", '"', "'", "`", "/", "@", "<", "#", " "] as const;
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

/** Documentos virtuales de un componente: el del script y plantilla y, si existe, el del bloque server. */
export function virtualDocuments(component: VirtualComponent): VirtualComponent[] {
  return component.server ? [component, component.server] : [component];
}

/**
 * Contexto cuyo documento virtual contiene `offset`: dentro de `<script server>` es el módulo
 * del bloque; en cualquier otra posición, el del componente.
 */
export function contextAt(context: FeatureContext, offset: number): FeatureContext {
  const server = context.component.server;
  return server && server.toGenerated(offset) !== undefined ? { ...context, component: server } : context;
}

function contextAtPosition(context: FeatureContext, position: Position): FeatureContext {
  return contextAt(context, context.document.offsetAt(position));
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
  /** `true` si el completado se pidió dentro del bloque `<script server>`. */
  readonly server?: boolean;
  readonly name: string;
  readonly source?: string;
  readonly data?: ts.CompletionEntryData;
}

/** Etiqueta PascalCase cuyo nombre, de apertura o de cierre, contiene `offset`. */
function componentTagAt(component: VirtualComponent, offset: number): ComponentTag | undefined {
  return component.componentTags?.find((tag) => [tag.start, tag.closeStart].some((start) =>
    start !== undefined && offset >= start && offset <= start + tag.name.length));
}

/** Nombres de evento tras `on:` en un componente, a partir de sus props callback `onEvento`. */
function componentEventCompletion(context: FeatureContext, span: { start: number; end: number }, sourceOffset: number): CompletionItem[] | undefined {
  const offset = context.component.toGenerated(sourceOffset);
  if (offset === undefined) return undefined;
  const result = context.project.service.getCompletionsAtPosition(context.component.virtualFilename, offset, userPreferences);
  return result?.entries.filter((entry) => /^on[A-Z]/.test(entry.name)).map((entry): CompletionItem => {
    const event = `${entry.name.charAt(2).toLowerCase()}${entry.name.slice(3)}`;
    const data: CompletionData = { uri: context.document.uri, offset, name: entry.name };
    return {
      label: event,
      kind: CompletionItemKind.Event,
      sortText: entry.sortText,
      textEdit: { range: toRange(context.document, span.start, span.end), newText: event },
      data,
    };
  });
}

/** Nombres de modelo tras `model:` en un componente, a partir de su defineModel. */
function componentModelCompletion(context: FeatureContext, span: { start: number; end: number }, sourceOffset: number): CompletionItem[] | undefined {
  const offset = context.component.toGenerated(sourceOffset);
  if (offset === undefined) return undefined;
  const result = context.project.service.getCompletionsAtPosition(context.component.virtualFilename, offset, userPreferences);
  return result?.entries.filter((entry) => entry.kind === ts.ScriptElementKind.memberVariableElement && /^[A-Za-z_$][\w$]*$/.test(entry.name))
    .map((entry): CompletionItem => ({
      label: entry.name,
      kind: CompletionItemKind.Property,
      sortText: entry.sortText,
      textEdit: { range: toRange(context.document, span.start, span.end), newText: entry.name },
      data: { uri: context.document.uri, offset, name: entry.name } satisfies CompletionData,
    }));
}

/** `<snippet>` cuyo `name` o `params` contiene `offset`. */
function snippetTagAt(component: VirtualComponent, offset: number, part: "name" | "params"): SnippetTag | undefined {
  return component.snippetTags?.find((tag) => part === "name"
    ? offset >= tag.nameStart && offset <= tag.nameEnd
    : tag.paramsStart !== undefined && tag.paramsEnd !== undefined && offset >= tag.paramsStart && offset <= tag.paramsEnd);
}

/** Nodo más interno del código virtual que contiene la posición fuente `sourceOffset`. */
function virtualNodeAt(context: FeatureContext, sourceOffset: number): { node: ts.Node; checker: ts.TypeChecker } | undefined {
  const offset = context.component.toGenerated(sourceOffset);
  const program = context.project.service.getProgram();
  const file = program?.getSourceFile(context.component.virtualFilename);
  if (offset === undefined || !program || !file) return undefined;
  let node: ts.Node | undefined;
  const visit = (current: ts.Node): void => {
    if (offset < current.getStart(file) || offset > current.end) return;
    node = current;
    ts.forEachChild(current, visit);
  };
  visit(file);
  return node ? { node, checker: program.getTypeChecker() } : undefined;
}

/**
 * Llamada `__meeko_snippet((params) => ...)` del código virtual de un `<snippet>`: el valor de su
 * nombre en el argumento de snippets de la comprobación de la etiqueta.
 */
function snippetCall(context: FeatureContext, tag: SnippetTag): { call: ts.CallExpression; checker: ts.TypeChecker } | undefined {
  const found = virtualNodeAt(context, tag.nameStart);
  let node: ts.Node | undefined = found?.node;
  while (node && !ts.isPropertyAssignment(node)) node = node.parent;
  const call = node && ts.isPropertyAssignment(node) ? node.initializer : undefined;
  return call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === "__meeko_snippet" && call.arguments[0]
    ? { call, checker: found!.checker }
    : undefined;
}

/** Snippets que declara el defineSnippets del hijo, o `undefined` si no declara ninguno. */
function childSnippets(call: ts.CallExpression, checker: ts.TypeChecker): ts.Symbol[] | undefined {
  // The snippets argument of the tag check, typed with the child's type parameters resolved.
  const object = call.parent.parent;
  const type = ts.isObjectLiteralExpression(object) ? checker.getContextualType(object) : undefined;
  const snippets = type && !(type.flags & ts.TypeFlags.Null) ? checker.getPropertiesOfType(type) : [];
  return snippets.length ? snippets : undefined;
}

/**
 * Resumen de una etiqueta de componente genérico con los parámetros de tipo que infieren sus props,
 * desde la comprobación de la etiqueta en el código virtual del padre.
 */
function genericTagMarkdown(context: FeatureContext, tag: ComponentTag): string | undefined {
  let node: ts.Node | undefined = virtualNodeAt(context, tag.start)?.node;
  while (node && !(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "__meeko_tag")) node = node.parent;
  const check = node?.parent;
  if (!node || !check || !ts.isCallExpression(check) || check.expression !== node) return undefined;
  const summary = tagSummary(context.project.service.getProgram()!.getTypeChecker(), check);
  return summary?.typeParameters ? componentSummaryMarkdown(summary).join("\n\n") : undefined;
}

/**
 * Parámetros que el hijo da a un `<snippet>`: el tipo contextual de la función que el código
 * virtual escribe para él.
 */
function snippetParameters(context: FeatureContext, tag: SnippetTag): { optional: boolean; parameters: Array<{ name: string; type: string }> } | undefined {
  const located = snippetCall(context, tag);
  if (!located) return undefined;
  const { call, checker } = located;
  const body = call.arguments[0]!;
  // The child's snippet, with its type parameters resolved, keeps the labels it declares.
  const key = (call.parent as ts.PropertyAssignment).name;
  const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : "";
  const entry = childSnippets(call, checker)?.find((symbol) => symbol.name === name);
  const snippet = entry ? checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(entry, call)) : undefined;
  const declared = snippet && (snippet.flags & ts.TypeFlags.Object) !== 0 && ((snippet as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0
    ? checker.getTypeArguments(snippet as ts.TypeReference)[0]
    : undefined;
  const rest = declared ? undefined : checker.getContextualType(body)?.getCallSignatures()[0]?.parameters[0];
  const tuple = declared ?? (rest ? checker.getTypeOfSymbolAtLocation(rest, body) : undefined);
  if (!tuple || !checker.isTupleType(tuple)) return undefined;
  const labels = (tuple as ts.TupleTypeReference).target.labeledElementDeclarations ?? [];
  const parameters = checker.getTypeArguments(tuple as ts.TypeReference).map((type, index) => {
    const label = labels[index];
    const labelName = label && (ts.isNamedTupleMember(label) || ts.isParameter(label)) && ts.isIdentifier(label.name) ? label.name.text : `arg${index}`;
    return { name: labelName, type: checker.typeToString(type, body) };
  });
  // The child's snippet map marks an optional snippet with `?`.
  return { optional: Boolean(entry && entry.flags & ts.SymbolFlags.Optional), parameters };
}

/** Nombres de snippet en `name` de un `<snippet>`, según el defineSnippets del hijo. */
function snippetNameCompletion(context: FeatureContext, tag: SnippetTag): CompletionItem[] | undefined {
  const located = snippetCall(context, tag);
  const snippets = located && childSnippets(located.call, located.checker);
  return snippets?.map((symbol): CompletionItem => ({
    label: symbol.name,
    kind: CompletionItemKind.Field,
    detail: `${symbol.name}${symbol.flags & ts.SymbolFlags.Optional ? "?" : ""}: ${located!.checker.typeToString(located!.checker.getTypeOfSymbolAtLocation(symbol, located!.call))}`,
    textEdit: { range: toRange(context.document, tag.nameStart, tag.nameEnd), newText: symbol.name },
  }));
}

/** Nombres de parámetro en `params` de un `<snippet>`, según los que le da el hijo. */
function snippetParamsCompletion(context: FeatureContext, tag: SnippetTag, sourceOffset: number): CompletionItem[] {
  const source = context.component.source;
  const value = source.slice(tag.paramsStart, tag.paramsEnd);
  const at = sourceOffset - tag.paramsStart!;
  const start = tag.paramsStart! + at - (/[\w$]*$/.exec(value.slice(0, at))?.[0].length ?? 0);
  const end = tag.paramsStart! + at + (/^[\w$]*/.exec(value.slice(at))?.[0].length ?? 0);
  const index = value.slice(0, at).split(",").length - 1;
  const parameters = snippetParameters(context, tag)?.parameters ?? [];
  const written = new Set(value.split(",").map((part) => part.trim()));
  return parameters.flatMap((parameter, position): CompletionItem[] => {
    if (written.has(parameter.name) && source.slice(start, end) !== parameter.name) return [];
    return [{
      label: parameter.name,
      kind: CompletionItemKind.Variable,
      detail: parameter.type,
      // The parameter in the position being written goes first.
      sortText: `${position === index ? 0 : 1}${String(position).padStart(3, "0")}`,
      textEdit: { range: toRange(context.document, start, end), newText: parameter.name },
    }];
  });
}

/**
 * Nombres de componente al escribir `<A` en la plantilla. No depende del modelo virtual, que
 * no se puede construir mientras la etiqueta está a medio escribir.
 */
export function componentNameCompletion(project: MeekoProject, document: TextDocument, filename: string, position: Position): CompletionItem[] | undefined {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const typed = /<([A-Z][\w$]*)$/.exec(source.slice(Math.max(0, offset - 256), offset))?.[1];
  if (typed === undefined) return undefined;
  const open = /<template(?=[\s>])[^>]*>/.exec(source);
  const close = source.lastIndexOf("</template>");
  if (!open || offset - typed.length <= open.index + open[0].length || (close >= 0 && offset > close)) return undefined;
  const script = /<script(?![^>]*\bserver\b)[^>]*>([\s\S]*?)<\/script>/.exec(source)?.[1] ?? "";
  const files = componentFiles(ts.createSourceFile(filename, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS), filename, project.autoImports());
  const start = document.positionAt(offset - typed.length);
  return [...files].map(([name, file]): CompletionItem => ({
    label: name,
    kind: CompletionItemKind.Class,
    detail: relative(project.root, file).replaceAll("\\", "/"),
    textEdit: { range: { start, end: position }, newText: name },
  }));
}

/** Una directiva de la plantilla: su nombre, lo que inserta y en qué etiquetas vale. */
interface TemplateDirective {
  readonly name: string;
  readonly detail: string;
  /** Snippet que inserta; un prefijo como `on:` vuelve a pedir el completado para su nombre. */
  readonly insert: string;
  readonly on: "all" | "element" | "component";
  /** Sólo en estos elementos HTML. */
  readonly elements?: readonly string[];
}

const templateDirectives: readonly TemplateDirective[] = [
  { name: "if:when", detail: "Muestra la etiqueta mientras la expresión es verdadera", insert: 'if:when="$1"', on: "all" },
  { name: "each:of", detail: "Repite la etiqueta por cada elemento de la lista", insert: 'each:of="$1"', on: "all" },
  { name: "each:as", detail: "Nombre de cada elemento de each:of", insert: 'each:as="$1"', on: "all" },
  { name: "each:key", detail: "Clave única de cada elemento de each:of (cadena o número)", insert: 'each:key="$1"', on: "all" },
  { name: "each:index", detail: "Nombre del índice de each:of (por defecto, index)", insert: 'each:index="$1"', on: "all" },
  { name: "bind:", detail: "Atributo o prop con el valor de una expresión", insert: "bind:", on: "all" },
  { name: "on:", detail: "Manejador de un evento", insert: "on:", on: "all" },
  { name: "ref:", detail: "Referencia a la etiqueta para useElementRef", insert: "ref:$1", on: "all" },
  { name: "model", detail: "Enlaza el valor del control con una señal", insert: 'model="$1"', on: "element", elements: ["input", "textarea", "select"] },
  { name: "html", detail: "Inserta la expresión como HTML sin escapar", insert: 'html="$1"', on: "element" },
  { name: "model:", detail: "Enlaza un modelo del componente (defineModel) con una señal", insert: "model:", on: "component" },
];

/**
 * Directivas de Meeko en el nombre de un atributo de una etiqueta de la plantilla (`each:`,
 * `if:when`, `bind:`…), también en las etiquetas de componente. Lee el texto, como
 * {@link componentNameCompletion}: la etiqueta suele estar a medio escribir.
 */
export function directiveNameCompletion(document: TextDocument, position: Position): CompletionItem[] | undefined {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const context = tagAt(source, offset);
  if (!context || context.value) return undefined;
  const word = /[\w:.-]*$/.exec(source.slice(context.tagStart, offset))![0];
  if (!/\s/.test(source[offset - word.length - 1] ?? "")) return undefined;
  // DOM events of an element after `on:`; a component's come from its props.
  if (/^on:/.test(word)) return context.component ? undefined : domEventCompletion(document, position, context, word);
  // `model:va`, `bind:ti`: the name after the prefix has its own completion.
  if (/^(?:model|bind|ref):./.test(word)) return undefined;
  const present = new Set([...source.slice(context.tagStart, context.tagEnd).matchAll(/\s([^\s=/>"']+)/g)].map((match) => match[1]!));
  present.delete(word);
  const start = document.positionAt(offset - word.length);
  const directives = templateDirectives
    .filter((directive) => directive.on === "all" || directive.on === (context.component ? "component" : "element"))
    .filter((directive) => !directive.elements || directive.elements.includes(context.tag.toLowerCase()))
    .filter((directive) => directive.name.endsWith(":") || !present.has(directive.name))
    .map((directive, index): CompletionItem => ({
      label: directive.name,
      kind: CompletionItemKind.Keyword,
      detail: directive.detail,
      sortText: `0${String(index).padStart(2, "0")}`,
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { range: { start, end: position }, newText: directive.insert },
      ...(directive.name.endsWith(":") ? { command: { title: "Completar", command: "editor.action.triggerSuggest" } } : {}),
    }));
  // The HTML attributes of an element (`type`, `href`, `aria-*`…) after Meeko's directives.
  return context.component ? directives : [...directives, ...htmlAttributeCompletion(document, position, present)];
}

export function completion(base: FeatureContext, position: Position): CompletionItem[] | undefined {
  return completionList(base, position)?.items;
}

/** Completado con `isIncomplete`: TypeScript no resolvió todavía todos los autoimports. */
export function completionList(base: FeatureContext, position: Position, triggerCharacter?: string): CompletionList | undefined {
  const list = (items: CompletionItem[] | undefined, isIncomplete = false): CompletionList | undefined => items && { isIncomplete, items };
  const sourceOffset = base.document.offsetAt(position);
  const event = base.component.componentEvents?.find((span) => sourceOffset >= span.start && sourceOffset <= span.end);
  if (event) return list(componentEventCompletion(base, event, sourceOffset));
  const model = base.component.componentModels?.find((span) => sourceOffset >= span.start && sourceOffset <= span.end);
  if (model) return list(componentModelCompletion(base, model, sourceOffset));
  const params = snippetTagAt(base.component, sourceOffset, "params");
  if (params) return list(snippetParamsCompletion(base, params, sourceOffset));
  const snippetName = snippetTagAt(base.component, sourceOffset, "name");
  if (snippetName) return list(snippetNameCompletion(base, snippetName));
  const context = contextAtPosition(base, position);
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  // TypeScript answers a trigger character only where it means something: "/" in an import path,
  // a quote in a string with known values (href("/…")), "<" in a type argument.
  const trigger = triggerCharacter && (typescriptTriggers as readonly string[]).includes(triggerCharacter)
    ? { triggerCharacter: triggerCharacter as ts.CompletionsTriggerCharacter, triggerKind: ts.CompletionTriggerKind.TriggerCharacter }
    : {};
  if (triggerCharacter && !("triggerCharacter" in trigger)) return undefined;
  const result = context.project.service.getCompletionsAtPosition(context.component.virtualFilename, offset, { ...userPreferences, ...trigger });
  if (!result) return undefined;
  return list(result.entries.map((entry) => {
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
      ...(context.component === base.component ? {} : { server: true }),
      name: entry.name,
      ...(entry.source === undefined ? {} : { source: entry.source }),
      ...(entry.data === undefined ? {} : { data: entry.data }),
    };
    item.data = data;
    return item;
  }), result.isIncomplete === true);
}

/** `{@link X}`, `{@link X texto}` o `{@link https://… texto}` como Markdown legible. */
function linkMarkdown(name: string, text: string): string {
  let target = name.trim();
  let label = text.trim();
  // `{@link https://example.com texto}`: TypeScript gives the URL and the label as one text part.
  if (!target && /^https?:\/\//.test(label)) {
    const space = label.search(/\s/);
    target = space < 0 ? label : label.slice(0, space);
    label = space < 0 ? "" : label.slice(space).trim();
  }
  if (/^https?:\/\//.test(target)) return `[${label || target}](${target})`;
  if (label) return label;
  return target ? `\`${target}\`` : "";
}

/**
 * Documentación de TypeScript como Markdown: igual que `displayPartsToString`, pero cada
 * `{@link}`, `{@linkcode}` o `{@linkplain}` queda como su texto, un nombre en código o un enlace.
 */
export function documentationMarkdown(parts: readonly ts.SymbolDisplayPart[] | undefined): string {
  let result = "";
  let link: { name: string; text: string } | undefined;
  for (const part of parts ?? []) {
    if (part.kind === "link") {
      if (part.text.startsWith("{@")) link = { name: "", text: "" };
      else if (link) {
        result += linkMarkdown(link.name, link.text);
        link = undefined;
      }
      continue;
    }
    if (link) {
      if (part.kind === "linkName") link.name += part.text;
      else link.text += part.text;
      continue;
    }
    result += part.text;
  }
  if (link) result += linkMarkdown(link.name, link.text);
  return result;
}

export function resolveCompletion(base: FeatureContext, item: CompletionItem): CompletionItem {
  const data = item.data as CompletionData | undefined;
  if (!data) return item;
  const server = data.server ? base.component.server : undefined;
  if (data.server && !server) return item;
  const context = server ? { ...base, component: server } : base;
  const details = context.project.service.getCompletionEntryDetails(
    context.component.virtualFilename, data.offset, data.name, formatSettings({ tabSize: 2, insertSpaces: true }),
    data.source, userPreferences, data.data,
  );
  if (!details) return item;
  const detail = ts.displayPartsToString(details.displayParts);
  if (detail) item.detail = detail;
  const documentation = documentationMarkdown(details.documentation);
  if (documentation) item.documentation = { kind: MarkupKind.Markdown, value: documentation };
  const edits = details.codeActions?.flatMap((action) => {
    const mapped = mapFileChanges(context, action.changes);
    return mapped?.[context.document.uri] ?? [];
  }) ?? [];
  if (edits.length) item.additionalTextEdits = edits;
  return item;
}

export function hover(base: FeatureContext, position: Position): Hover | undefined {
  const sourceOffset = base.document.offsetAt(position);
  const tag = componentTagAt(base.component, sourceOffset);
  if (tag?.file) {
    const start = tag.closeStart !== undefined && sourceOffset >= tag.closeStart ? tag.closeStart : tag.start;
    const path = relative(base.project.root, tag.file).replaceAll("\\", "/");
    const child = base.project.component(tag.file);
    // A generic child shows its type parameters as this tag's props resolve them.
    const summary = genericTagMarkdown(base, tag) ?? (child && componentMarkdown(base, child));
    return {
      contents: { kind: MarkupKind.Markdown, value: ["```typescript", `(componente) ${tag.name}`, "```", "", `\`${path}\``, ...(summary ? ["", summary] : [])].join("\n") },
      range: toRange(base.document, start, start + tag.name.length),
    };
  }
  // The `html` directive inserts unescaped HTML: its hover carries the safety warning.
  const htmlDirective = base.component.htmlDirectives?.find((span) => sourceOffset >= span.start && sourceOffset < span.end);
  if (htmlDirective) {
    return { contents: { kind: MarkupKind.Markdown, value: htmlDirectiveDocs }, range: toRange(base.document, htmlDirective.start, htmlDirective.end) };
  }
  const snippet = snippetTagAt(base.component, sourceOffset, "name");
  const snippetSignature = snippet ? snippetParameters(base, snippet) : undefined;
  if (snippet && snippetSignature) {
    const name = base.component.source.slice(snippet.nameStart, snippet.nameEnd);
    const parameters = snippetSignature.parameters.map((parameter) => `${parameter.name}: ${parameter.type}`).join(", ");
    return {
      contents: { kind: MarkupKind.Markdown, value: ["```typescript", `(snippet) ${name}${snippetSignature.optional ? "?" : ""}(${parameters})`, "```"].join("\n") },
      range: toRange(base.document, snippet.nameStart, snippet.nameEnd),
    };
  }
  const context = contextAtPosition(base, position);
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  // Meeko's own sections: routes, endpoints and procedures, child components and reactive values.
  const sections: HoverSection[] = [];
  const target = appTargetHover(context, offset);
  if (target) sections.push(target);
  if (context.component === base.component) {
    const module = componentModuleAt(context, offset);
    const summary = module && componentMarkdown(context, module.component);
    if (module && summary) sections.push({ markdown: `\`${relative(context.project.root, module.component.filename).replaceAll("\\", "/")}\`\n\n${summary}` });
    const reactive = reactiveHover(context, sourceOffset);
    if (reactive) sections.push(reactive);
  }
  const info = context.project.service.getQuickInfoAtPosition(context.component.virtualFilename, offset);
  if (!info && !sections.length) return undefined;
  const parts: string[] = [];
  let range: readonly [number, number] | undefined;
  if (info) {
    const signature = ts.displayPartsToString(info.displayParts ?? []);
    const documentation = documentationMarkdown(info.documentation);
    const tags = (info.tags ?? []).map((tag) => `*@${tag.name}*${tag.text ? ` — ${documentationMarkdown(tag.text)}` : ""}`);
    parts.push(["```typescript", signature, "```", ...(documentation ? ["", documentation] : []), ...(tags.length ? ["", tags.join("\n\n")] : [])].join("\n"));
    range = sourceRange(context.component, info.textSpan.start, info.textSpan.length);
  }
  for (const section of sections) {
    parts.push(section.markdown);
    range ??= section.range;
  }
  const value = parts.join("\n\n---\n\n");
  return { contents: { kind: MarkupKind.Markdown, value }, ...(range ? { range: toRange(context.document, range[0], range[1]) } : {}) };
}

export function definition(base: FeatureContext, position: Position): Location[] | undefined {
  // A component tag goes to its `.meeko`, also when it is an autoimport without a source import.
  const tag = componentTagAt(base.component, base.document.offsetAt(position));
  const target = tag?.file ? base.locate(tag.file) : undefined;
  if (target) return [{ uri: target.uri, range: toRange(target.document, 0, 0) }];
  const context = contextAtPosition(base, position);
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  // A route id goes to its page and an endpoint or procedure to its handler.
  const app = appTargetDefinition(context, offset);
  if (app) return app;
  const definitions = context.project.service.getDefinitionAtPosition(context.component.virtualFilename, offset) ?? [];
  return dedupeLocations(definitions.flatMap((item) => serverExportLocation(context, item.fileName, item.textSpan) ?? locationOf(context, item.fileName, item.textSpan) ?? []));
}

/** A page-data declaration goes to the export of `<script server>` that it stands for. */
function serverExportLocation(context: FeatureContext, fileName: string, span: ts.TextSpan): Location | undefined {
  const virtual = context.project.virtualEntry(fileName);
  const declaration = virtual?.serverExports?.find((entry) => span.start >= entry.generatedStart && span.start < entry.generatedEnd);
  const target = declaration && context.locate(virtual!.filename);
  return declaration && target ? { uri: target.uri, range: toRange(target.document, declaration.sourceStart, declaration.sourceEnd) } : undefined;
}

export function references(base: FeatureContext, position: Position, includeDeclaration: boolean): Location[] | undefined {
  const context = contextAtPosition(base, position);
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  const symbols = context.project.service.findReferences(context.component.virtualFilename, offset) ?? [];
  const declarations = new Set(symbols.map((symbol) => `${symbol.definition.fileName}:${symbol.definition.textSpan.start}`));
  const locations = symbols.flatMap((symbol) => symbol.references
    .filter((reference) => includeDeclaration || (!reference.isDefinition && !declarations.has(`${reference.fileName}:${reference.textSpan.start}`)))
    .flatMap((reference) => locationOf(context, reference.fileName, reference.textSpan) ?? []));
  return dedupeLocations(locations);
}

export function prepareRename(base: FeatureContext, position: Position): { range: Range; placeholder: string } | undefined {
  const context = contextAtPosition(base, position);
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  const info = context.project.service.getRenameInfo(context.component.virtualFilename, offset, renamePreferences);
  if (!info.canRename) return undefined;
  const range = sourceRange(context.component, info.triggerSpan.start, info.triggerSpan.length);
  return range ? { range: toRange(context.document, range[0], range[1]), placeholder: context.document.getText().slice(range[0], range[1]) } : undefined;
}

export function rename(base: FeatureContext, position: Position, newName: string): WorkspaceEdit | undefined {
  const context = contextAtPosition(base, position);
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

/**
 * Edits that replace every use of the variable declared at `position` (not its declaration), in
 * the script and the template: `replacement` receives the name and gives the new text. A
 * shorthand property keeps its key (`{ x }` → `{ x: x.value }`).
 */
export function usageEdits(base: FeatureContext, position: Position, replacement: (name: string) => string): TextEdit[] | undefined {
  const context = contextAtPosition(base, position);
  const offset = generatedOffset(context, position);
  if (offset === undefined) return undefined;
  const locations = context.project.service.findRenameLocations(context.component.virtualFilename, offset, false, false, { ...userPreferences, providePrefixAndSuffixTextForRename: true }) ?? [];
  const declaration = base.document.offsetAt(position);
  const edits: TextEdit[] = [];
  const seen = new Set<string>();
  for (const location of locations) {
    const target = locationOf(context, location.fileName, location.textSpan);
    if (!target || target.uri !== base.document.uri) continue;
    const start = base.document.offsetAt(target.range.start);
    const key = `${start}:${base.document.offsetAt(target.range.end)}`;
    if (start === declaration || seen.has(key)) continue;
    seen.add(key);
    const name = base.document.getText(target.range);
    edits.push({ range: target.range, newText: `${location.prefixText ?? ""}${replacement(name)}${location.suffixText ?? ""}` });
  }
  return edits;
}

export function signatureHelp(base: FeatureContext, position: Position): SignatureHelp | undefined {
  const context = contextAtPosition(base, position);
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
      const documentation = documentationMarkdown(parameter.documentation);
      return { label: [start, label.length], ...(documentation ? { documentation } : {}) };
    });
    label += ts.displayPartsToString(item.suffixDisplayParts);
    const documentation = documentationMarkdown(item.documentation);
    return { label, parameters, ...(documentation ? { documentation: { kind: MarkupKind.Markdown, value: documentation } } : {}) };
  });
  return { signatures, activeSignature: help.selectedItemIndex, activeParameter: help.argumentIndex };
}

/** Tokens semánticos de script y expresiones de plantilla; los multilínea se dividen por línea. */
export function semanticTokens(context: FeatureContext): SemanticTokens {
  const { document } = context;
  const tokens: Array<{ start: number; end: number; type: number; modifiers: number }> = [];
  for (const component of virtualDocuments(context.component)) {
    const encoded = context.project.service.getEncodedSemanticClassifications(
      component.virtualFilename,
      { start: 0, length: component.code.length },
      ts.SemanticClassificationFormat.TwentyTwenty,
    ).spans;
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
  }
  addReactiveModifiers(context, tokens);
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

/**
 * Marks reactive declarations and their uses (`signal`, `computed`, `resource`), writes of `.value`
 * (`modification`) and the tokens of template expressions that read a reactive value (`reactive`).
 */
function addReactiveModifiers(context: FeatureContext, tokens: Array<{ start: number; end: number; type: number; modifiers: number }>): void {
  const analysis = analyzeReactivity(context.project.service, context.component);
  const extra = new Map<number, { end: number; type: number; modifiers: number }>();
  const add = (start: number, end: number, type: string, modifiers: number): void => {
    const previous = extra.get(start);
    extra.set(start, { end, type: semanticTypes.indexOf(type), modifiers: (previous?.modifiers ?? 0) | modifiers });
  };
  for (const declaration of analysis.declarations) {
    const kind = modifierBit(declaration.kind);
    add(declaration.start, declaration.end, "variable", kind);
    for (const access of declaration.accesses) {
      add(access.start, access.end, "variable", kind);
      if (access.write && access.member) add(access.member.start, access.member.end, access.member.name === "value" ? "property" : "method", modifierBit("modification"));
    }
  }
  // A template expression may appear more than once in the virtual code: every copy gets the modifiers.
  const starts = new Set<number>();
  for (const token of tokens) {
    const found = extra.get(token.start);
    if (!found) continue;
    token.modifiers |= found.modifiers;
    starts.add(token.start);
  }
  for (const [start, token] of extra) {
    if (!starts.has(start)) tokens.push({ start, end: token.end, type: token.type, modifiers: token.modifiers });
  }
  if (!analysis.reactiveExpressions.length) return;
  const reactive = modifierBit("reactive");
  for (const token of tokens) {
    if (analysis.reactiveExpressions.some(([start, end]) => token.start >= start && token.end <= end)) token.modifiers |= reactive;
  }
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
  // The implicit script of a file without `<script lang="ts">` has no text to edit or navigate.
  return [...(parsed.script.implicit ? [] : [parsed.script]), ...(parsed.server ? [parsed.server] : []), parsed.template, ...(parsed.style ? [parsed.style] : [])]
    .sort((left, right) => left.start - right.start);
}

/** Documento virtual de una sección TypeScript (`<script>` o `<script server>`). */
function sectionDocument(component: VirtualComponent, section: SfcSection): VirtualComponent | undefined {
  return section.name === "server" ? component.server : section.name === "script" ? component : undefined;
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
  const { document } = context;
  const byPosition = (left: DocumentSymbol, right: DocumentSymbol) =>
    left.range.start.line - right.range.start.line || left.range.start.character - right.range.start.character;
  const scriptSymbols = (component: VirtualComponent): DocumentSymbol[] => {
    const convert = (item: ts.NavigationTree): DocumentSymbol | undefined => {
      const span = item.spans[0];
      const body = span && sourceRange(component, span.start, span.length);
      if (!body || item.text.startsWith("__meeko_")) return undefined;
      const name = (item.nameSpan && sourceRange(component, item.nameSpan.start, item.nameSpan.length)) ?? [body[0], body[0]];
      // The selection must lie inside the range: in `sender.value = () => {}` TypeScript gives the
      // function as the span and `value` as the name, so the range grows to cover both.
      const range: [number, number] = [Math.min(body[0], name[0]), Math.max(body[1], name[1])];
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
    return (tree.childItems ?? []).flatMap((item) => convert(item) ?? []).sort(byPosition);
  };
  return sections(document.getText(), context.component.filename).map((section) => {
    let children: DocumentSymbol[] = [];
    const virtual = sectionDocument(context.component, section);
    if (virtual) children = scriptSymbols(virtual);
    else if (section.name === "template") {
      const html = maskedSection(document, section, "html");
      children = htmlLanguageService.findDocumentSymbols2(html, htmlLanguageService.parseHTMLDocument(html));
    } else if (section.name === "style") {
      const css = maskedSection(document, section, "css");
      children = cssLanguageService.findDocumentSymbols2(css, cssLanguageService.parseStylesheet(css));
    }
    const tagEnd = section.contentStart;
    return {
      name: section.name === "server" ? "<script server>" : `<${section.name}>`,
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
  for (const virtual of virtualDocuments(component)) for (const span of context.project.service.getOutliningSpans(virtual.virtualFilename)) {
    const range = sourceRange(virtual, span.textSpan.start, span.textSpan.length);
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

function formatSettings(options: Pick<FormattingOptions, "tabSize" | "insertSpaces">, newline = "\n"): ts.FormatCodeSettings {
  return {
    tabSize: options.tabSize,
    indentSize: options.tabSize,
    convertTabsToSpaces: options.insertSpaces,
    newLineCharacter: newline,
    insertSpaceBeforeAndAfterBinaryOperators: true,
    insertSpaceAfterCommaDelimiter: true,
    insertSpaceAfterSemicolonInForStatements: true,
  };
}

/** Opciones de formato de Meeko; el servidor las lee de la sección `meeko.format`. */
export interface MeekoFormatSettings {
  /**
   * Indenta un nivel el contenido de `<script>`, `<script server>`, `<template>` y `<style>`,
   * como `vueIndentScriptAndStyle` de Prettier. Con `false` (por defecto) se quita esa indentación.
   */
  readonly indentSections?: boolean;
}

/**
 * Formatea los scripts con TypeScript y plantilla y estilos con los servicios HTML y CSS.
 * Formatear es idempotente con y sin `indentSections`.
 */
/** Entorno del formateo que decide el servidor, no el usuario. */
export interface FormattingEnvironment {
  /** `false` en workspaces no confiables: no se carga el Prettier del proyecto. Por defecto `true`. */
  readonly trusted?: boolean;
  readonly log?: (message: string) => void;
}

/**
 * Formatea el documento completo con Prettier y el plugin `@meekojs/meeko/prettier`: el Prettier
 * del proyecto con su configuración si el workspace es confiable y lo tiene, o el incluido con las
 * opciones del editor. El formateador anterior sólo se usa si no hay ningún Prettier disponible.
 * Un archivo que no compila no se formatea. No admite formateo de rango.
 */
export async function formatting(
  context: FeatureContext, options: FormattingOptions, settings: MeekoFormatSettings = {}, environment: FormattingEnvironment = {},
): Promise<TextEdit[]> {
  const { component, document } = context;
  const source = document.getText();
  const describe = (error: unknown): string => error instanceof Error ? error.message : String(error);
  let editor: typeof import("../prettier/editor.js") | undefined;
  try { editor = await import("../prettier/editor.js"); }
  catch (error) { environment.log?.(`Prettier no está disponible; se usa el formateador incluido: ${describe(error)}`); }
  if (editor) {
    try {
      const result = await editor.formatWithPrettier({
        text: source,
        filename: component.filename,
        tabSize: options.tabSize,
        insertSpaces: options.insertSpaces,
        ...(settings.indentSections !== undefined ? { indentSections: settings.indentSections } : {}),
        trusted: environment.trusted !== false,
      });
      if (result) return result.text === source ? [] : [{ range: toRange(document, 0, source.length), newText: result.text }];
      environment.log?.("Prettier no está instalado; se usa el formateador incluido");
    } catch (error) {
      environment.log?.(`${component.filename}: no se pudo formatear: ${describe(error)}`);
      return [];
    }
  }
  return builtinFormatting(context, options, settings);
}

/** Formateador anterior (TypeScript, HTML y CSS por sección), último recurso sin Prettier. */
function builtinFormatting(context: FeatureContext, options: FormattingOptions, settings: MeekoFormatSettings): TextEdit[] {
  const { component, document } = context;
  const source = document.getText();
  const edits: TextEdit[] = [];
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const indent = settings.indentSections === true;
  const unit = options.insertSpaces ? " ".repeat(options.tabSize) : "\t";
  for (const section of sections(source, component.filename)) {
    const virtual = sectionDocument(component, section);
    if (virtual) {
      const script = virtual.spans[0]!;
      const generated = context.project.service.getFormattingEditsForRange(
        virtual.virtualFilename, script.generatedStart, script.generatedEnd,
        { ...formatSettings(options, newline), baseIndentSize: indent ? options.tabSize : 0 },
      );
      for (const edit of generated) {
        const range = sourceRange(virtual, edit.span.start, edit.span.length);
        if (!range || range[1] > section.contentEnd) continue;
        // Code that starts on the opening tag's line stays right after it.
        if (indent && range[0] === section.contentStart && !edit.newText.trim() && !/[\r\n]/.test(edit.newText)) continue;
        edits.push({ range: toRange(document, range[0], range[1]), newText: edit.newText });
      }
      continue;
    }
    const language = section.name === "template" ? "html" : "css";
    // The HTML formatter has no base indentation: wrapping the template in an
    // element makes it indent every top-level node one level while still
    // leaving `pre`, `textarea` and other unformatted content untouched.
    const wrap = language === "html" && indent;
    const wrapperStart = `<meeko-template>${newline}`;
    const wrapperEnd = `${newline}</meeko-template>`;
    const input = wrap ? `${wrapperStart}${section.content.trim()}${wrapperEnd}` : section.content;
    const embedded = TextDocument.create(`${document.uri}#${language}`, language, document.version, input);
    const generated = language === "html"
      ? htmlLanguageService.format(embedded, undefined, { tabSize: options.tabSize, insertSpaces: options.insertSpaces })
      : cssLanguageService.format(embedded, undefined, { tabSize: options.tabSize, insertSpaces: options.insertSpaces });
    let formatted = input;
    for (const edit of [...generated].sort((a, b) => embedded.offsetAt(b.range.start) - embedded.offsetAt(a.range.start))) {
      formatted = formatted.slice(0, embedded.offsetAt(edit.range.start)) + edit.newText + formatted.slice(embedded.offsetAt(edit.range.end));
    }
    if (wrap) {
      const start = formatted.indexOf(">") + 1;
      const end = formatted.lastIndexOf("</meeko-template>");
      formatted = formatted.slice(start, end).replace(/^[ \t]*(?:\r\n|\r|\n)/, "").replace(/(?:\r\n|\r|\n)[ \t]*$/, "");
    }
    // The HTML and CSS formatters may emit LF in a CRLF document.
    formatted = formatted.replace(/\r\n|\r|\n/g, newline);
    if (language === "css") {
      // The CSS formatter starts every rule at column 0; the base level is added afterwards.
      formatted = formatted.split(/\r\n|\r|\n/).map((line) => indent && line.trim() ? `${unit}${line}` : line).join(newline);
    }
    if (formatted.trim()) {
      if (!formatted.startsWith("\n") && !formatted.startsWith("\r\n")) formatted = newline + formatted;
      if (!formatted.endsWith("\n")) formatted += newline;
    }
    if (formatted !== section.content) edits.push({ range: toRange(document, section.contentStart, section.contentEnd), newText: formatted });
  }
  return edits;
}

/** `code` wrapped in the `<script lang="ts">` that a file without one gets before its template. */
function implicitScriptText(source: string, code: string): string {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const body = code.endsWith("\n") ? code : `${code}${newline}`;
  return `<script lang="ts">${newline}${body}</script>${newline}${newline}`;
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
          // A file without <script lang="ts"> gets one, before its template.
          if (virtual.implicitScript) {
            (result[target.uri] ??= []).push({ range: toRange(target.document, at, at), newText: implicitScriptText(text, textChange.newText) });
            continue;
          }
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

/**
 * Correcciones rápidas: imports de TypeScript, autoimports ambiguos, `params` en rutas estáticas y
 * `each:key` en listas; y la refactorización de un sidecar `x.route.ts` a `<script server>`.
 */
export function codeActions(
  context: FeatureContext, range: Range, diagnostics: readonly Diagnostic[], capabilities: EditCapabilities = {}, only?: readonly string[],
): CodeAction[] {
  const { document } = context;
  const actions: CodeAction[] = [];
  const service = context.project.service;
  const fixable = new Set(service.getSupportedCodeFixes().map(Number));
  for (const diagnostic of diagnostics) {
    const code = typeof diagnostic.code === "string" ? Number(/^TS(\d+)$/.exec(diagnostic.code)?.[1]) : diagnostic.code;
    if (code === undefined || !Number.isFinite(code) || !fixable.has(code)) continue;
    const scoped = contextAt(context, document.offsetAt(diagnostic.range.start));
    const component = scoped.component;
    const start = component.toGenerated(document.offsetAt(diagnostic.range.start));
    const end = component.toGenerated(document.offsetAt(diagnostic.range.end));
    if (start === undefined || end === undefined) continue;
    let fixes: readonly ts.CodeFixAction[];
    try { fixes = service.getCodeFixesAtPosition(component.virtualFilename, start, Math.max(start, end), [code], formatSettings({ tabSize: 2, insertSpaces: true }), userPreferences); }
    catch { continue; }
    for (const fix of fixes) {
      const changes = mapFileChanges(scoped, fix.changes);
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
  for (const component of virtualDocuments(context.component)) {
    const scoped = { ...context, component };
    actions.push(...autoImportActions(scoped, range, diagnostics));
    actions.push(...staticHrefActions(scoped, range, diagnostics));
  }
  actions.push(...eachKeyActions(context, range));
  actions.push(...sidecarActions(context, range, capabilities, only));
  if (!only?.length) return actions;
  // A client that asks for some kinds only gets those and their subkinds.
  return actions.filter((action) => action.kind !== undefined && only.some((kind) => action.kind === kind || action.kind!.startsWith(`${kind}.`)));
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
  const reported = diagnostics.filter((item) => item.code === "MEEK_AUTOIMPORT");
  for (const problem of context.component.problems) {
    if (problem.kind !== "ambiguous") continue;
    const occurrence = identifierRange(context, problem.name);
    // A component and its <script server> block resolve autoimports separately.
    const related = occurrence ? reported.filter((item) => overlaps(item.range, occurrence)) : reported;
    if (!related.length && !(occurrence && overlaps(occurrence, range))) continue;
    for (const candidate of problem.candidates) {
      const statement = importStatement(context.component, candidate);
      const newline = context.document.getText().includes("\r\n") ? "\r\n" : "\n";
      actions.push({
        title: `Importar ${problem.name} desde ${candidate.specifier ?? relative(dirname(context.component.filename), candidate.file).replaceAll("\\", "/")}`,
        kind: CodeActionKind.QuickFix,
        ...(related.length ? { diagnostics: related } : {}),
        edit: { changes: { [context.document.uri]: [{
          range: scriptInsertion(context),
          newText: context.component.implicitScript ? implicitScriptText(context.document.getText(), `${statement}${newline}`) : `${statement}${newline}`,
        }] } },
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
      // `href(id, options)` or `href(routes, id, options)`.
      const [first, second, third] = node.arguments;
      const [id, options] = first && ts.isStringLiteralLike(first) ? [first, second] : [second, third];
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
                title: `Quitar params de la ruta estática ${JSON.stringify(id.text)}`,
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
