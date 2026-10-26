import { relative, sep } from "node:path";
import ts from "@typescript/typescript6";
import type { CodeLens, Location } from "vscode-languageserver/node";
import { isPageFile } from "../framework/route-block.js";
import { extractRouteRender } from "../framework/routes-discovery.js";
import type { RouteRecord } from "../framework/router.js";
import type { FeatureContext } from "./features.js";
import type { VirtualComponent } from "./model.js";
import { pathKey } from "./project.js";
import { analyzeReactivity } from "./reactivity.js";
import type { ReactiveDeclaration } from "./reactivity.js";

/** VS Code's command to show a list of locations next to a position. */
export const showReferencesCommand = "editor.action.showReferences";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Title of the lens of a reactive declaration, such as `3 lecturas · 1 escritura · en la plantilla`. */
export function reactiveLensTitle(declaration: ReactiveDeclaration): string {
  const reads = declaration.accesses.filter((access) => access.read).length;
  const writes = declaration.accesses.filter((access) => access.write).length;
  const template = declaration.accesses.some((access) => access.template);
  return `${plural(reads, "lectura")} · ${plural(writes, "escritura")} · ${template ? "en la plantilla" : "fuera de la plantilla"}`;
}

function reactiveLenses(context: FeatureContext): CodeLens[] {
  const { document } = context;
  const analysis = analyzeReactivity(context.project.service, context.component);
  return analysis.declarations.map((declaration): CodeLens => {
    const range = { start: document.positionAt(declaration.start), end: document.positionAt(declaration.end) };
    const locations: Location[] = declaration.accesses.map((access) => ({
      uri: document.uri,
      range: { start: document.positionAt(access.start), end: document.positionAt(access.end) },
    }));
    return { range, command: { title: reactiveLensTitle(declaration), command: showReferencesCommand, arguments: [document.uri, range.start, locations] } };
  });
}

/** Route id of a page file, like the route discovery: `index` and `(group)` segments do not count. */
export function pageRouteId(filename: string, sourceRoots: readonly string[]): string | undefined {
  for (const root of sourceRoots) {
    const path = relative(root, filename);
    const parts = path.split(/[\\/]/);
    if (parts[0] !== "app" || parts[1] !== "pages" || !path.endsWith(".meeko")) continue;
    const segments = parts.slice(2);
    segments[segments.length - 1] = segments.at(-1)!.slice(0, -".meeko".length);
    if (segments.at(-1) === "index") segments.pop();
    const visible = segments.filter((segment) => !/^\([^/()]+\)$/.test(segment));
    return visible.length ? `/${visible.join("/")}` : "/";
  }
  return undefined;
}

/** Display path of a project file. */
export function projectPath(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

/** Problems of a payload type that `serializeJson` would reject, and its number of fields. */
export interface PayloadCheck {
  readonly fields: number;
  readonly issues: readonly string[];
}

const nonPlain = new Set([
  "Date", "Map", "Set", "WeakMap", "WeakSet", "RegExp", "URL", "URLSearchParams", "Promise", "Error", "Blob", "File",
  "ArrayBuffer", "SharedArrayBuffer", "DataView", "Headers", "Request", "Response", "ReadableStream", "FormData",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
  "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
]);

/** Fields beyond which the lens warns that a payload type is large. */
export const largePayloadFields = 150;

/**
 * Walks the type of a loader result and reports what JSON serialization rejects at run time:
 * functions, symbols, bigints and non-plain objects such as `Date` or `Map`.
 */
export function checkPayload(checker: ts.TypeChecker, type: ts.Type, at: ts.Node, root = "data"): PayloadCheck {
  const issues: string[] = [];
  let fields = 0;
  const seen = new Set<ts.Type>();
  const report = (path: string, problem: string): void => {
    if (issues.length < 3) issues.push(`${path} es ${problem}`);
  };
  const visit = (current: ts.Type, path: string, depth: number): void => {
    if (depth > 8 || issues.length >= 3 || fields > largePayloadFields * 4) return;
    if (current.isUnion()) { for (const part of current.types) visit(part, path, depth); return; }
    if (current.flags & (ts.TypeFlags.BigIntLike)) return report(path, "un bigint");
    if (current.flags & (ts.TypeFlags.ESSymbolLike)) return report(path, "un symbol");
    if (!(current.flags & ts.TypeFlags.Object) && !current.isIntersection()) return;
    if (seen.has(current)) return;
    seen.add(current);
    const symbol = current.aliasSymbol && nonPlain.has(current.aliasSymbol.name) ? current.aliasSymbol : current.getSymbol();
    if (current.getCallSignatures().length) return report(path, "una función");
    if (symbol && nonPlain.has(symbol.name)) return report(path, `un ${symbol.name}`);
    if (checker.isArrayType(current) || checker.isTupleType(current)) {
      for (const element of checker.getTypeArguments(current as ts.TypeReference)) visit(element, `${path}[]`, depth + 1);
      return;
    }
    if (symbol && symbol.flags & ts.SymbolFlags.Class) return report(path, `una instancia de la clase ${symbol.name}`);
    for (const property of checker.getPropertiesOfType(current)) {
      fields++;
      visit(checker.getTypeOfSymbolAtLocation(property, at), `${path}.${property.name}`, depth + 1);
    }
  };
  visit(type, root, 0);
  return { fields, issues };
}

function shortType(text: string): string {
  return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

/**
 * Type of the data a page's `<script server>` sends to the browser: the `export const|let` of its
 * top-level code, which the page reads by name, or else the result of `route.load`; `undefined`
 * when it sends none.
 */
export function pagePayload(program: ts.Program, server: VirtualComponent): { type: string; check: PayloadCheck } | undefined {
  const file = program.getSourceFile(server.virtualFilename);
  if (!file) return undefined;
  const checker = program.getTypeChecker();
  // Top-level code: every exported variable except route and head is page data (MEEK070 rejects route.load beside it).
  const exported: ts.Identifier[] = [];
  const collect = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) exported.push(name);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) collect(element.name);
  };
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const declarations = statement.declarationList.declarations;
    if (declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "route")) continue;
    for (const declaration of declarations) collect(declaration.name);
  }
  const data = exported.filter((identifier) => identifier.text !== "head");
  if (data.length) {
    let check: PayloadCheck = { fields: 0, issues: [] };
    const members = data.map((identifier) => {
      const type = checker.getTypeAtLocation(identifier);
      const next = checkPayload(checker, type, identifier, identifier.text);
      check = { fields: check.fields + 1 + next.fields, issues: [...check.issues, ...next.issues].slice(0, 3) };
      return `${identifier.text}: ${checker.typeToString(type, identifier)};`;
    });
    return { type: shortType(`{ ${members.join(" ")} }`), check };
  }
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "route") continue;
      const load = checker.getTypeAtLocation(declaration.name).getProperty("load");
      if (!load) return undefined;
      const signature = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(load, declaration)).getCallSignatures()[0];
      if (!signature) return undefined;
      const result = checker.getAwaitedType(signature.getReturnType()) ?? signature.getReturnType();
      // A loader may return a Response (a redirect); it never reaches the page as data.
      const parts = (result.isUnion() ? result.types : [result]).filter((part) => part.getSymbol()?.name !== "Response");
      const text = parts.map((part) => checker.typeToString(part, declaration)).join(" | ") || "never";
      const check = parts.reduce<PayloadCheck>((total, part) => {
        const next = checkPayload(checker, part, declaration);
        return { fields: total.fields + next.fields, issues: [...total.issues, ...next.issues].slice(0, 3) };
      }, { fields: 0, issues: [] });
      return { type: shortType(text), check };
    }
  }
  return undefined;
}

function pageLenses(context: FeatureContext): CodeLens[] {
  const { project, component } = context;
  const roots = project.sourceRoots();
  if (!isPageFile(component.filename, roots)) return [];
  const route: RouteRecord | undefined = context.app?.routes.find((candidate) => pathKey(candidate.file) === pathKey(component.filename));
  const id = route?.id ?? pageRouteId(component.filename, roots);
  if (id === undefined) return [];
  let render = route?.render;
  if (component.server) {
    // The open block wins over the saved route manifest.
    try { render = extractRouteRender(component.filename, context.document.getText().slice(component.server.spans[0]!.sourceStart, component.server.spans[0]!.sourceEnd)); }
    catch { /* Route discovery reports an invalid render. */ }
  }
  const layouts = route ? route.layouts.map((layout) => projectPath(project.root, layout)) : undefined;
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const lenses: CodeLens[] = [{
    range,
    command: {
      title: `Ruta ${id} · render ${render ?? "ssr"} · layouts: ${layouts === undefined ? "desconocidos" : layouts.length ? layouts.join(" › ") : "ninguno"}`,
      command: "",
    },
  }];
  const program = project.service.getProgram();
  if (component.server && program) {
    const payload = pagePayload(program, component.server);
    let title: string;
    if (!payload) title = "No envía datos al cliente";
    else if (render === "client") title = `El loader se ejecuta en el navegador: ${payload.type}`;
    else {
      title = `Envía al cliente: ${payload.type}`;
      if (payload.check.issues.length) title += ` · ⚠ no serializable: ${payload.check.issues.join("; ")}`;
      else if (payload.check.fields > largePayloadFields) title += ` · ⚠ tipo de payload grande (${payload.check.fields} campos)`;
    }
    lenses.push({ range, command: { title, command: "" } });
  }
  return lenses;
}

/**
 * Code lenses of a component: the reads and writes of each signal, computed value and data
 * resource, and on a page its route, render mode, layouts and the data its loader sends.
 */
export function codeLenses(context: FeatureContext): CodeLens[] {
  return [...pageLenses(context), ...reactiveLenses(context)];
}
