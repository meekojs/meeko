import { relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItemKind, InlayHintKind, SymbolKind } from "vscode-languageserver/node";
import type { CompletionItem, DocumentLink, InlayHint, Position, Range, SymbolInformation } from "vscode-languageserver/node";
import { parseSfc } from "../compiler/sfc.js";
import { attributeValueStart, parseTemplate } from "../compiler/template.js";
import type { TemplateNode } from "../compiler/template.js";
import { appTargetAt } from "./app-index.js";
import type { AppIndex } from "./app-index.js";
import { tagAt } from "./embedded.js";
import { snippetParameters, sourceRange, toRange, virtualDocuments } from "./features.js";
import type { FeatureContext } from "./features.js";
import { appTargetDefinition } from "./insights.js";
import type { MeekoProject } from "./project.js";
import { nodeAt } from "./reactivity.js";

/**
 * Links on the strings that name a page or an endpoint: `href("/users/[id]")`, `useApi("/api/…")`,
 * `useApiMutation` and `useRpcQuery`/`useRpcMutation`. Ctrl+click opens the page or the handler.
 */
export function documentLinks(context: FeatureContext): DocumentLink[] {
  const program = context.project.service.getProgram();
  if (!program || !context.app) return [];
  const links: DocumentLink[] = [];
  const seen = new Set<string>();
  for (const component of virtualDocuments(context.component)) {
    const file = program.getSourceFile(component.virtualFilename);
    if (!file) continue;
    const scoped = { ...context, component };
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && ts.isCallExpression(node.parent) && node.getWidth(file) > 2) {
        const inside = node.getStart(file) + 1;
        const range = sourceRange(component, inside, node.getWidth(file) - 2);
        const target = range && appTargetAt(program, component.virtualFilename, inside, context.app!)
          ? appTargetDefinition(scoped, inside)?.[0]
          : undefined;
        const key = range ? `${range[0]}:${range[1]}` : "";
        if (range && target && !seen.has(key)) {
          seen.add(key);
          const line = target.range.start.line + 1;
          links.push({
            range: toRange(context.document, range[0], range[1]),
            target: line > 1 ? `${target.uri}#L${line},${target.range.start.character + 1}` : target.uri,
            tooltip: `Abrir ${relative(context.project.root, fileURLToPath(target.uri)).replaceAll("\\", "/")}`,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return links;
}

/** Inside `to="…"` of a `<MeekoLink>`: the routes of the project, with their page. */
export function linkRouteCompletion(document: TextDocument, position: Position, index: AppIndex, root: string, shadowed: ReadonlySet<string> = new Set()): CompletionItem[] | undefined {
  const source = document.getText();
  const context = tagAt(source, document.offsetAt(position));
  if (context?.tag !== "MeekoLink" || shadowed.has("MeekoLink") || context.value?.attribute !== "to") return undefined;
  const range = { start: document.positionAt(context.value.start), end: position };
  return index.routes.map((route): CompletionItem => ({
    label: route.id,
    kind: CompletionItemKind.File,
    detail: relative(root, route.file).replaceAll("\\", "/"),
    textEdit: { range, newText: route.id },
  }));
}

/** `query` as a subsequence of `name`, ignoring case: `uscd` matches `UiCardDetails`. */
function matches(name: string, query: string): boolean {
  const text = name.toLowerCase();
  let index = 0;
  for (const char of query.toLowerCase()) {
    index = text.indexOf(char, index);
    if (index < 0) return false;
    index++;
  }
  return true;
}

/**
 * Components, pages, API endpoints and RPC procedures of the projects, for the workspace symbol
 * search (Ctrl+T in VS Code).
 */
export async function workspaceSymbols(projects: readonly MeekoProject[], query: string): Promise<SymbolInformation[]> {
  const symbols: SymbolInformation[] = [];
  const start = { line: 0, character: 0 };
  const at = (file: string) => ({ uri: pathToFileURL(file).href, range: { start, end: start } });
  for (const project of projects) {
    await project.ready();
    const container = (file: string) => relative(project.root, file).replaceAll("\\", "/");
    for (const entry of project.autoImports()) {
      if (entry.component && entry.file.endsWith(".meeko")) {
        symbols.push({ name: entry.name, kind: SymbolKind.Class, location: at(entry.file), containerName: `componente · ${container(entry.file)}` });
      }
    }
    const index = await project.appIndex();
    for (const route of index.routes) {
      symbols.push({ name: route.id, kind: SymbolKind.File, location: at(route.file), containerName: `página · ${container(route.file)}` });
    }
    for (const endpoint of index.api) {
      symbols.push({ name: `${endpoint.method} ${endpoint.pathname}`, kind: SymbolKind.Function, location: at(endpoint.file), containerName: `API · ${container(endpoint.file)}` });
    }
    for (const endpoint of index.rpc) {
      symbols.push({ name: `rpc.${endpoint.id}`, kind: SymbolKind.Function, location: at(endpoint.file), containerName: `RPC · ${container(endpoint.file)}` });
    }
  }
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    const key = `${symbol.name}\0${symbol.location.uri}`;
    if (seen.has(key) || (query && !matches(symbol.name, query))) return false;
    seen.add(key);
    return true;
  });
}

/** Elements of the template, depth first. */
function elements(node: TemplateNode, found: TemplateNode[] = []): TemplateNode[] {
  for (const child of [...node.childNodes ?? [], ...node.content?.childNodes ?? []]) {
    if (child.attrs) found.push(child);
    elements(child, found);
  }
  return found;
}

/** A type for an inlay hint: one line, at most 60 characters. */
function shortType(type: string): string {
  const flat = type.replace(/\s+/g, " ");
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat;
}

/**
 * Types that the template does not show: the item of `each:as` and the parameters of a
 * `<snippet params>`, after their names (`each:as="user: User"`).
 */
export function inlayHints(context: FeatureContext, range: Range): InlayHint[] {
  const { component, document } = context;
  const source = component.source;
  const first = document.offsetAt(range.start);
  const last = document.offsetAt(range.end);
  const hints: InlayHint[] = [];
  const program = context.project.service.getProgram();
  const file = program?.getSourceFile(component.virtualFilename);
  if (program && file) {
    let root: TemplateNode | undefined;
    try { root = parseTemplate(source, parseSfc(source, component.filename).template, component.filename); }
    catch { root = undefined; }
    const checker = program.getTypeChecker();
    for (const element of root ? elements(root) : []) {
      const attributes = element.attrs ?? [];
      const list = attributes.find((attribute) => attribute.name === "each:of");
      const item = attributes.find((attribute) => attribute.name === "each:as");
      if (!list || !item) continue;
      const name = item.value.trim();
      const listStart = attributeValueStart(source, list);
      const itemStart = attributeValueStart(source, item);
      if (listStart === undefined || itemStart === undefined || itemStart < first || itemStart > last) continue;
      // The virtual code declares the item as `for (const item of (list))`.
      const generated = component.toGenerated(listStart);
      if (generated === undefined) continue;
      const declared = generated - " of (".length - name.length;
      if (component.code.slice(declared, declared + name.length) !== name) continue;
      const node = nodeAt(file, declared);
      if (!node || !ts.isIdentifier(node)) continue;
      const type = checker.getTypeAtLocation(node);
      if (type.flags & ts.TypeFlags.Any) continue;
      hints.push({
        position: document.positionAt(itemStart + source.slice(itemStart).indexOf(name) + name.length),
        label: `: ${shortType(checker.typeToString(type, node))}`,
        kind: InlayHintKind.Type,
        paddingLeft: false,
      });
    }
  }
  for (const tag of component.snippetTags ?? []) {
    if (tag.paramsStart === undefined || tag.paramsEnd === undefined || tag.paramsEnd < first || tag.paramsStart > last) continue;
    const parameters = snippetParameters(context, tag)?.parameters ?? [];
    const written = source.slice(tag.paramsStart, tag.paramsEnd);
    let index = 0;
    for (const match of written.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const parameter = parameters[index++];
      if (!parameter || parameter.type === "any") continue;
      hints.push({
        position: document.positionAt(tag.paramsStart + match.index + match[0].length),
        label: `: ${shortType(parameter.type)}`,
        kind: InlayHintKind.Type,
        paddingLeft: false,
      });
    }
  }
  return hints;
}
