import { relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { DiagnosticSeverity, DiagnosticTag } from "vscode-languageserver/node";
import type { Diagnostic, Range } from "vscode-languageserver/node";
import { discoverAutoImportsSync } from "../autoimports.js";
import type { AutoImport } from "../autoimports.js";
import { checkSource } from "../check.js";
import { projectRoot } from "../compiler/project-root.js";
import { MeekoCompileError, parseSfc } from "../compiler/sfc.js";
import type { CompileDiagnostic } from "../compiler/sfc.js";
import { assertRouteBlockPlacement } from "../framework/route-block.js";
import { documentationMarkdown, identifierRange, sourceRange, virtualDocuments } from "./features.js";
import type { LocatedDocument } from "./features.js";
import type { VirtualComponent } from "./model.js";
import { pathKey } from "./project.js";
import type { MeekoProject } from "./project.js";

/** Fin del token que empieza en `offset`; un carácter si no hay token reconocible. */
export function tokenEnd(source: string, offset: number): number {
  if (offset >= source.length) return source.length;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source.slice(offset, offset + 4096));
  const kind = scanner.scan();
  const end = scanner.getTokenEnd();
  const trivia = kind === ts.SyntaxKind.WhitespaceTrivia || kind === ts.SyntaxKind.NewLineTrivia || kind === ts.SyntaxKind.Unknown || kind === ts.SyntaxKind.EndOfFileToken;
  return trivia || end <= 0 ? offset + 1 : offset + end;
}

function toRange(document: TextDocument, start: number, end: number): Range {
  return { start: document.positionAt(start), end: document.positionAt(end) };
}

function semanticDiagnostics(project: MeekoProject, component: VirtualComponent): readonly ts.Diagnostic[] {
  try {
    return [
      ...project.service.getSyntacticDiagnostics(component.virtualFilename),
      ...project.service.getSemanticDiagnostics(component.virtualFilename),
    ];
  } catch { return []; }
}

/** Primera línea del script; ubica errores que no pertenecen a una posición concreta. */
function scriptStart(source: string, filename: string): number {
  try { return parseSfc(source, filename).script.start; }
  catch { return 0; }
}

function lineRange(document: TextDocument, offset: number): Range {
  const start = document.positionAt(offset);
  const text = document.getText();
  const lineEnd = text.slice(offset).search(/\r?\n|\r|$/);
  return { start, end: document.positionAt(offset + Math.max(lineEnd, 0)) };
}

/** Etiqueta de apertura `<script ...>` que empieza en `offset`, si la hay. */
function openingTagRange(source: string, offset: number): [number, number] | undefined {
  const match = /<script\b[^>]*>/y;
  match.lastIndex = offset;
  return match.exec(source) ? [offset, match.lastIndex] : undefined;
}

/**
 * MEEK044: `<script server>` fuera de una página de `app/pages` de alguna raíz configurada.
 * MEEK100: `generic` en una página, un layout, `app.meeko` o una página de error.
 */
function placementDiagnostic(project: MeekoProject, source: string, filename: string): CompileDiagnostic | undefined {
  try { assertRouteBlockPlacement(source, filename, project.sourceRoots()); }
  catch (error) {
    // Other structural errors come from `meeko check` itself.
    if (error instanceof MeekoCompileError) return error.diagnostic.code === "MEEK044" || error.diagnostic.code === "MEEK100" ? error.diagnostic : undefined;
    throw error;
  }
  return undefined;
}

const severities: Partial<Record<ts.DiagnosticCategory, DiagnosticSeverity>> = {
  [ts.DiagnosticCategory.Error]: DiagnosticSeverity.Error,
  [ts.DiagnosticCategory.Warning]: DiagnosticSeverity.Warning,
};

/**
 * Diagnósticos de TypeScript y autoimports del bloque `<script server>`. `meeko check` sólo
 * compila el componente; el bloque se comprueba como un módulo propio en el proyecto del editor.
 */
function serverBlockDiagnostics(project: MeekoProject, component: VirtualComponent, document: TextDocument): Diagnostic[] {
  const server = component.server;
  if (!server) return [];
  const block = server.spans[0]!;
  const fallback = lineRange(document, block.sourceStart);
  const result: Diagnostic[] = [];
  for (const problem of server.problems) {
    result.push({
      range: identifierRange({ component: server, document }, problem.name) ?? fallback,
      message: problem.message, code: "MEEK_AUTOIMPORT", source: "Meeko", severity: DiagnosticSeverity.Error,
    });
  }
  for (const item of semanticDiagnostics(project, server)) {
    const severity = severities[item.category];
    if (severity === undefined) continue;
    const range = item.start === undefined ? undefined : sourceRange(server, item.start, item.length ?? 0);
    const message = ts.flattenDiagnosticMessageText(item.messageText, "\n");
    result.push({
      range: range ? toRange(document, range[0], range[1] > range[0] ? range[1] : tokenEnd(document.getText(), range[0])) : fallback,
      message: range ? message : `TypeScript generado: ${message}`,
      code: `TS${item.code}`, source: "Meeko", severity,
    });
  }
  return result;
}

/** Sugerencias de TypeScript para usos de un símbolo `@deprecated`: 6385 (símbolo) y 6387 (firma). */
const deprecatedCodes = new Set([6385, 6387]);

/**
 * Usos de símbolos marcados `@deprecated` en el script y la plantilla, como el alias `useSocket`
 * de `@meekojs/meeko/framework`: una pista tachada con el motivo de su etiqueta `@deprecated`.
 */
function deprecatedDiagnostics(project: MeekoProject, component: VirtualComponent, document: TextDocument): Diagnostic[] {
  const result: Diagnostic[] = [];
  const seen = new Set<string>();
  const source = document.getText();
  for (const virtual of virtualDocuments(component)) {
    let suggestions: readonly ts.DiagnosticWithLocation[];
    try { suggestions = project.service.getSuggestionDiagnostics(virtual.virtualFilename); }
    catch { continue; }
    for (const item of suggestions) {
      if (item.reportsDeprecated === undefined && !deprecatedCodes.has(item.code)) continue;
      const range = sourceRange(virtual, item.start, item.length);
      if (!range || range[1] <= range[0]) continue;
      const key = `${range[0]}:${range[1]}:${item.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const name = source.slice(range[0], range[1]);
      let reason: string | undefined;
      try {
        const tag = project.service.getQuickInfoAtPosition(virtual.virtualFilename, item.start)?.tags?.find((entry) => entry.name === "deprecated");
        reason = tag?.text ? documentationMarkdown(tag.text).trim() : undefined;
      } catch { reason = undefined; }
      const subject = item.code === 6387 ? `Esta firma de «${name}» está obsoleta` : `«${name}» está obsoleto`;
      result.push({
        range: toRange(document, range[0], range[1]),
        message: reason ? `${subject}: ${reason}` : `${subject}.`,
        code: `TS${item.code}`, source: "Meeko", severity: DiagnosticSeverity.Hint, tags: [DiagnosticTag.Deprecated],
      });
    }
  }
  return result;
}

function staticAutoImports(root: string): readonly AutoImport[] {
  try { return discoverAutoImportsSync(root); }
  catch { return []; }
}

/**
 * Diagnósticos de `meeko check` para un componente, con el rango completo de cada error.
 * El rango sale del diagnóstico equivalente del servicio TypeScript del editor o, si no
 * existe, del token que empieza en la posición informada por el CLI.
 */
export async function componentDiagnostics(
  project: MeekoProject,
  document: TextDocument,
  filename: string,
  locate: (filename: string) => LocatedDocument | undefined,
): Promise<Diagnostic[]> {
  await project.ready();
  const source = document.getText();
  const component = project.component(filename);
  const current = component && component.source === source ? component : undefined;
  const trusted = project.trusted;
  const placement = placementDiagnostic(project, source, filename);
  const blockDiagnostics = current ? [...serverBlockDiagnostics(project, current, document), ...deprecatedDiagnostics(project, current, document)] : [];
  let found: CompileDiagnostic[];
  try {
    found = await checkSource(source, filename, trusted ? {} : {
      autoImports: (root) => pathKey(root) === pathKey(project.root) ? project.autoImports() : staticAutoImports(root),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const autoImport = /^(?:Autoimport ambiguo (\S+?):|El autoimport (\S+) no está disponible)/.exec(message);
    const name = autoImport?.[1] ?? autoImport?.[2];
    const range = (name && component && component.source === source && identifierRange({ component, document }, name))
      || lineRange(document, scriptStart(source, filename));
    return [
      ...(placement ? [compileDiagnostic(document, placement)] : []),
      { range, message, code: name ? "MEEK_AUTOIMPORT" : "MEEK_CHECK", source: "Meeko", severity: DiagnosticSeverity.Error },
      ...blockDiagnostics,
    ];
  }
  if (placement) found = [placement, ...found];
  const typescript = current ? semanticDiagnostics(project, current) : [];
  const own = resolve(filename);
  // The compiler emits template expressions for several render paths; report each error once.
  const seen = new Set<string>();
  found = found.filter((item) => {
    const key = `${item.filename}:${item.code}:${item.location.offset}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return found.map((item): Diagnostic => {
    const diagnostic: Diagnostic = { range: toRange(document, 0, 0), message: item.message, code: item.code, source: "Meeko", severity: DiagnosticSeverity.Error };
    if (pathKey(item.filename) !== pathKey(own)) {
      // Errors in imported modules are reported where the component starts, with a link to their file.
      const target = locate(item.filename);
      diagnostic.range = lineRange(document, scriptStart(source, filename));
      diagnostic.message = `${relative(project.root, item.filename).replaceAll("\\", "/")}:${item.location.line}:${item.location.column} ${item.message}`;
      if (target) {
        const position = target.document.positionAt(item.location.offset);
        diagnostic.relatedInformation = [{
          location: { uri: target.uri, range: { start: position, end: target.document.positionAt(tokenEnd(target.document.getText(), item.location.offset)) } },
          message: item.message,
        }];
      }
      return diagnostic;
    }
    const offset = item.location.offset;
    const tag = item.code === "MEEK043" || item.code === "MEEK044" ? openingTagRange(source, offset) : undefined;
    if (tag) {
      diagnostic.range = toRange(document, tag[0], tag[1]);
      return diagnostic;
    }
    let end: number | undefined;
    if (component) {
      for (const candidate of typescript) {
        if (`TS${candidate.code}` !== item.code || candidate.start === undefined || candidate.length === undefined) continue;
        const range = sourceRange(component, candidate.start, candidate.length);
        if (range?.[0] === offset && range[1] > offset) { end = range[1]; break; }
      }
    }
    // `on:event`, `model:name` and `bind:prop` on a component are reported at the attribute name, and a missing
    // model, snippet or `<render args>` at the tag: mark the whole directive or tag name.
    // MEEK080 marks the whole `useElementRef("name")` call.
    const directive = end === undefined
      ? (item.code === "MEEK080" ? /^useElementRef\s*\(\s*(["'`])[^"'`]*\1\s*\)/ : /^(?:(?:on|model|bind):[\w$]+|model(?![\w$:])|<[A-Za-z][\w$.-]*)/).exec(source.slice(offset, offset + 256))
      : null;
    diagnostic.range = toRange(document, offset, end ?? (directive ? offset + directive[0].length : tokenEnd(source, offset)));
    return diagnostic;
  }).concat(blockDiagnostics);
}

function compileDiagnostic(document: TextDocument, item: CompileDiagnostic): Diagnostic {
  const source = document.getText();
  const [start, end] = openingTagRange(source, item.location.offset) ?? [item.location.offset, tokenEnd(source, item.location.offset)];
  return { range: toRange(document, start, end), message: item.message, code: item.code, source: "Meeko", severity: DiagnosticSeverity.Error };
}

/** Rango del tipo de `defineProps` (u otro tipo) que empieza en `offset` dentro del script. */
export function contractRange(source: string, filename: string, offset: number): [number, number] {
  try {
    const script = parseSfc(source, filename).script;
    const relativeOffset = offset - script.contentStart;
    const ast = ts.createSourceFile(filename, script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let end = -1;
    const visit = (node: ts.Node): void => {
      if (node.getStart(ast) === relativeOffset && ts.isTypeNode(node)) end = Math.max(end, node.getEnd());
      if (node.getStart(ast) <= relativeOffset && relativeOffset < node.getEnd()) ts.forEachChild(node, visit);
    };
    visit(ast);
    if (end > relativeOffset) return [offset, script.contentStart + end];
  } catch { /* Fall back to the token below. */ }
  return [offset, tokenEnd(source, offset)];
}

/** Raíz del proyecto cuyo contrato de páginas depende de este archivo, si lo hay. */
export function frameworkContractRoot(filename: string): string | undefined {
  const root = projectRoot(filename);
  const parts = relative(root, resolve(filename)).split(sep);
  const app = parts.indexOf("app");
  if (app < 0) return undefined;
  const area = parts[app + 1];
  const basename = parts.at(-1) ?? "";
  if (area === "pages" && (basename.endsWith(".meeko") || basename.endsWith(".route.ts"))) return root;
  if (area === "layouts" && basename.endsWith(".meeko")) return root;
  if (area === "app.meeko" || area === "error.meeko") return root;
  return undefined;
}
