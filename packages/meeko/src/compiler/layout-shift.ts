/**
 * MEEK117: a hint of a layout shift. A page or a layout that loads a list with `useApi` or
 * `useRpcQuery` without `await` sends it empty in the server's HTML; when the data arrives the
 * list grows and moves what comes after it. Only that case warns: the result goes to an `each:of`
 * and nothing in the component deals with its loading (`pending`, `refreshing`, `<MeekoAwait>`, an
 * `if:when` on its data). A result passed whole elsewhere (`bind:items="users"`, a function) is
 * left alone, because its loading may be handled there.
 */
import ts from "@typescript/typescript6";
import { scanInterpolations } from "./interpolation.js";
import { locate } from "./sfc.js";
import type { CompileDiagnostic } from "./sfc.js";
import type { TemplateNode } from "./template.js";

/** Pages, layouts and `app/app.meeko`: the components whose HTML is the first paint. */
export function isPageOrLayout(filename: string): boolean {
  return /[\\/]app[\\/](?:pages|layouts)[\\/].+\.meeko$|[\\/]app[\\/]app\.meeko$|[\\/]\+layout\.meeko$/.test(filename);
}

/** Properties of a resource that tell its loading: reading one means the component handles it. */
const loadingProperties = new Set(["pending", "refreshing"]);

interface Candidate {
  readonly name: string;
  readonly offset: number;
  readonly composable: string;
  /** Read as `name.pending`, passed whole or awaited later: never warned. */
  handled: boolean;
  /** Its data feeds an `each:of` outside any guard of its loading. */
  risky: boolean;
}

/**
 * How `expression` uses `name`: `"loading"` reads `pending` or `refreshing`, `"whole"` passes the
 * resource itself, `"data"` reads its data, `"none"` does not use it.
 */
function usage(expression: string, name: string): "loading" | "whole" | "data" | "none" {
  const pattern = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])(\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*))?`, "g");
  let result: "whole" | "data" | "none" = "none";
  for (const match of expression.matchAll(pattern)) {
    const property = match[2];
    if (property === undefined) result = "whole";
    else if (loadingProperties.has(property)) return "loading";
    else if (result === "none") result = "data";
  }
  return result;
}

/** Template expressions of a node: its attribute values and, for text, its interpolations. */
function expressionsOf(node: TemplateNode, source: string): string[] {
  if (node.nodeName === "#text") {
    return scanInterpolations(source.slice(node.start, node.end)).segments.flatMap((segment) => segment.expression ? [segment.expression] : []);
  }
  return (node.attrs ?? []).map((attribute) => attribute.value);
}

/**
 * The MEEK117 warnings of a component: none outside pages and layouts. `script` is the content of
 * `<script>` and `scriptStart` its offset in `source`.
 */
export function layoutShiftHints(source: string, filename: string, script: string, scriptStart: number, root: TemplateNode): CompileDiagnostic[] {
  if (!isPageOrLayout(filename) || !/\buse(?:Api|RpcQuery)\s*\(/.test(script)) return [];
  const file = ts.createSourceFile("script.ts", script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const candidates: Candidate[] = [];
  const declarations = new Set<ts.Identifier>();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!ts.isIdentifier(declaration.name) || !call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
      if (call.expression.text !== "useApi" && call.expression.text !== "useRpcQuery") continue;
      declarations.add(declaration.name);
      candidates.push({ name: declaration.name.text, offset: scriptStart + call.getStart(file), composable: call.expression.text, handled: false, risky: false });
    }
  }
  if (!candidates.length) return [];
  const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]));
  // In the script: `users.pending` handles it; `users` alone passes it on (to a composable, a prop…).
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !declarations.has(node)) {
      const candidate = byName.get(node.text);
      const parent = node.parent;
      if (candidate && !(ts.isPropertyAccessExpression(parent) && parent.name === node) && !(ts.isPropertyAssignment(parent) && parent.name === node)) {
        if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node) candidate.handled = true;
        else if (loadingProperties.has(parent.name.text)) candidate.handled = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  // In the template: the `each:of` that reads the data outside an `if:when` or a `<MeekoAwait>` that handles it.
  const walk = (node: TemplateNode, guarded: ReadonlySet<string>): void => {
    const inner = new Set(guarded);
    if (node.componentName === "MeekoAwait") for (const candidate of candidates) inner.add(candidate.name);
    const condition = node.attrs?.find((attribute) => attribute.name === "if:when");
    for (const candidate of candidates) {
      if (condition && usage(condition.value, candidate.name) !== "none") inner.add(candidate.name);
      for (const expression of expressionsOf(node, source)) {
        const use = usage(expression, candidate.name);
        if (use === "loading" || use === "whole") candidate.handled = true;
      }
      const list = node.attrs?.find((attribute) => attribute.name === "each:of");
      if (list && !inner.has(candidate.name) && usage(list.value, candidate.name) === "data") candidate.risky = true;
    }
    for (const child of node.childNodes ?? []) walk(child, inner);
    for (const child of node.content?.childNodes ?? []) walk(child, inner);
  };
  walk(root, new Set());
  return candidates.filter((candidate) => candidate.risky && !candidate.handled).map((candidate): CompileDiagnostic => ({
    code: "MEEK117",
    severity: "warning",
    filename,
    location: locate(source, candidate.offset),
    message: `${candidate.name} se carga con ${candidate.composable} sin await y su lista sale vacía en el HTML del servidor: crecerá al llegar los datos y moverá lo que viene después (salto de diseño). `
      + `Cárguela con await, envuélvala en <MeekoAwait for="${candidate.name}" reserve> o muestre un esqueleto con if:when="${candidate.name}.pending.value"`,
  }));
}
