import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { createRouteManifest } from "./router.js";
import type { RouteRecord } from "./router.js";
import type { PageRender } from "./page.js";

const renderModes: readonly PageRender[] = ["ssr", "stream", "prerender", "client"];

function routeId(relativeFile: string): string {
  const parts = relativeFile.slice(0, -".meeko".length).split(sep);
  if (parts.at(-1) === "index") parts.pop();
  const visible = parts.filter((part) => !/^\([^/()]+\)$/.test(part));
  return visible.length ? `/${visible.join("/")}` : "/";
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (true) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
      || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
    else if (ts.isCallExpression(current) && current.arguments.length > 0) current = current.arguments[0]!;
    else return current;
  }
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return undefined;
}

function literalRender(file: string, value: ts.Expression): PageRender {
  const expression = unwrap(value);
  if (!ts.isStringLiteral(expression) && !ts.isNoSubstitutionTemplateLiteral(expression)) {
    throw new Error(`${file}: render must be a string literal so Meeko can read it at build time`);
  }
  const render = expression.text as PageRender;
  if (!renderModes.includes(render)) {
    const modes = renderModes.map((mode) => `"${mode}"`);
    throw new Error(`${file}: unsupported render mode "${expression.text}"; use ${modes.slice(0, -1).join(", ")} or ${modes.at(-1)}`);
  }
  return render;
}

/**
 * Reads `render` from a route sidecar without executing it. The value must be
 * a string literal in the exported `definePage({...})` call or object literal.
 */
export function extractRouteRender(file: string, source: string): PageRender | undefined {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let routeExport: ts.Expression | undefined;
  let defaultExport: ts.Expression | undefined;
  let namedRender: ts.Expression | undefined;
  let opaque = false;
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) defaultExport = statement.expression;
    else if (ts.isVariableStatement(statement) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (declaration.name.text === "route") routeExport = declaration.initializer;
        if (declaration.name.text === "render" && declaration.initializer) namedRender = declaration.initializer;
      }
    } else if (ts.isExportDeclaration(statement)) {
      const names = statement.exportClause && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.map((element) => element.name.text) : undefined;
      if (!names || names.some((name) => name === "route" || name === "default" || name === "render")) opaque = true;
    }
  }
  const definition = routeExport ?? defaultExport;
  if (!definition) {
    if (opaque) throw new Error(`${file}: re-exported route options cannot be read at build time; export definePage({ ... }) from this file`);
    return namedRender ? literalRender(file, namedRender) : undefined;
  }
  // Options may live in a module-level `const` of the same file.
  const constants = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) constants.set(declaration.name.text, declaration.initializer);
    }
  }
  let object = unwrap(definition);
  const visited = new Set<string>();
  while (ts.isIdentifier(object) && constants.has(object.text) && !visited.has(object.text)) {
    visited.add(object.text);
    object = unwrap(constants.get(object.text)!);
  }
  if (!ts.isObjectLiteralExpression(object)) {
    throw new Error(`${file}: export definePage({ ... }) or an object literal so Meeko can read render at build time`);
  }
  let render: PageRender | undefined;
  // Members after the last explicit render that could set it at run time.
  let spread = false;
  let computed = false;
  let prerenderEntries = false;
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) { spread = true; continue; }
    if (property.name && ts.isComputedPropertyName(property.name)) { computed = true; continue; }
    const name = property.name ? propertyName(property.name) : undefined;
    if (name === "prerenderEntries") prerenderEntries = true;
    if (name !== "render") continue;
    if (!ts.isPropertyAssignment(property)) throw new Error(`${file}: render must be a string literal so Meeko can read it at build time`);
    render = literalRender(file, property.initializer);
    spread = false;
    computed = false;
  }
  if (computed) throw new Error(`${file}: computed route option keys cannot be read at build time; write render as a plain property`);
  if (spread && render === undefined) throw new Error(`${file}: declare render explicitly; spread route options cannot be read at build time`);
  if (spread) throw new Error(`${file}: declare render after any spread; spread route options cannot be read at build time`);
  if (render === "client" && prerenderEntries) {
    throw new Error(`${file}: render: "client" cannot be prerendered; remove prerenderEntries or use render: "prerender"`);
  }
  return render;
}

/** Discovers pages once; the returned manifest is safe to serialize for the browser. */
export async function discoverRoutes(projectRoot: string): Promise<readonly RouteRecord[]> {
  const pagesRoot = resolve(projectRoot, "app", "pages");
  const files = new Set<string>();
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.add(path);
    }
  }
  await walk(pagesRoot);
  const appShell = resolve(projectRoot, "app", "app.meeko");
  const defaultLayout = resolve(projectRoot, "app", "layouts", "default.meeko");
  let hasAppShell = false;
  try { hasAppShell = (await stat(appShell)).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let hasDefaultLayout = false;
  try { hasDefaultLayout = (await lstat(defaultLayout)).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (hasDefaultLayout && files.has(join(pagesRoot, "+layout.meeko"))) {
    throw new Error(`Both ${defaultLayout} and ${join(pagesRoot, "+layout.meeko")} define the root layout`);
  }
  const routes: RouteRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".meeko") || basename(file).startsWith("+")) continue;
    const directory = dirname(file);
    const layouts: string[] = hasAppShell ? [appShell] : [];
    if (hasDefaultLayout) layouts.push(defaultLayout);
    let cursor = pagesRoot;
    const relativeDirectory = relative(pagesRoot, directory);
    if (files.has(join(cursor, "+layout.meeko"))) layouts.push(join(cursor, "+layout.meeko"));
    if (relativeDirectory) for (const segment of relativeDirectory.split(sep)) {
      cursor = join(cursor, segment);
      if (files.has(join(cursor, "+layout.meeko"))) layouts.push(join(cursor, "+layout.meeko"));
    }
    let error: string | undefined;
    let errorCursor = directory;
    while (errorCursor.startsWith(pagesRoot)) {
      const candidate = join(errorCursor, "+error.meeko");
      if (files.has(candidate)) { error = candidate; break; }
      if (errorCursor === pagesRoot) break;
      errorCursor = dirname(errorCursor);
    }
    const sidecar = file.slice(0, -".meeko".length) + ".route.ts";
    const hasSidecar = files.has(sidecar);
    const render = hasSidecar ? extractRouteRender(sidecar, await readFile(sidecar, "utf8")) : undefined;
    routes.push({
      id: routeId(relative(pagesRoot, file)),
      file,
      layouts,
      ...(error ? { error } : {}),
      ...(hasSidecar ? { sidecar } : {}),
      ...(render ? { render } : {}),
    });
  }
  return createRouteManifest(routes);
}
