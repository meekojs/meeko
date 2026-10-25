import { relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import type { Diagnostic, Range } from "vscode-languageserver/node";
import { discoverAutoImportsSync } from "../autoimports.js";
import type { AutoImport } from "../autoimports.js";
import { checkSource } from "../check.js";
import { projectRoot } from "../compiler/project-root.js";
import { parseSfc } from "../compiler/sfc.js";
import { identifierRange, sourceRange } from "./features.js";
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
  const trusted = project.trusted;
  let found;
  try {
    found = await checkSource(source, filename, trusted ? {} : {
      autoImports: (root) => pathKey(root) === pathKey(project.root) ? project.autoImports() : staticAutoImports(root),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const autoImport = /^(?:Ambiguous autoimport (\S+?):|Autoimport (\S+) is unavailable)/.exec(message);
    const name = autoImport?.[1] ?? autoImport?.[2];
    const range = (name && component && component.source === source && identifierRange({ component, document }, name))
      || lineRange(document, scriptStart(source, filename));
    return [{ range, message, code: name ? "MEEK_AUTOIMPORT" : "MEEK_CHECK", source: "Meeko", severity: DiagnosticSeverity.Error }];
  }
  const typescript = component && component.source === source ? semanticDiagnostics(project, component) : [];
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
    let end: number | undefined;
    if (component) {
      for (const candidate of typescript) {
        if (`TS${candidate.code}` !== item.code || candidate.start === undefined || candidate.length === undefined) continue;
        const range = sourceRange(component, candidate.start, candidate.length);
        if (range?.[0] === offset && range[1] > offset) { end = range[1]; break; }
      }
    }
    diagnostic.range = toRange(document, offset, end ?? tokenEnd(source, offset));
    return diagnostic;
  });
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
