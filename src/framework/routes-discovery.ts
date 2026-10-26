import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { routeBlockId, tryRouteBlockSource } from "./route-block.js";
import { createRouteManifest } from "./router.js";
import type { ErrorPageRecord, RouteRecord } from "./router.js";
import type { PageRender } from "./page.js";

async function isFile(path: string, follow = true): Promise<boolean> {
  try { return (await (follow ? stat(path) : lstat(path))).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return false; }
}

/** Root files around `app/pages`: the app shell, the root layout and the application error page. */
async function rootFiles(projectRoot: string) {
  const pagesRoot = resolve(projectRoot, "app", "pages");
  const appShell = resolve(projectRoot, "app", "app.meeko");
  const defaultLayout = resolve(projectRoot, "app", "layouts", "default.meeko");
  const appError = resolve(projectRoot, "app", "error.meeko");
  const rootLayout = join(pagesRoot, "+layout.meeko");
  const rootError = join(pagesRoot, "+error.meeko");
  return {
    pagesRoot, appShell, defaultLayout, appError, rootLayout, rootError,
    hasAppShell: await isFile(appShell),
    hasDefaultLayout: await isFile(defaultLayout, false),
    hasAppError: await isFile(appError),
  };
}

function rootErrorConflict(appError: string, rootError: string): Error {
  return new Error(`${appError} y ${rootError} definen los dos la página de error raíz`);
}

/**
 * Descubre `app/error.meeko` con los layouts raíz que lo envuelven: `app/app.meeko` y
 * `app/layouts/default.meeko` (o `app/pages/+layout.meeko`).
 *
 * @param projectRoot Carpeta del proyecto.
 * @returns La página de error con rutas absolutas, o `undefined` si no existe `app/error.meeko`.
 * @throws {Error} Si también existe `app/pages/+error.meeko`, que define el mismo nivel.
 * @since 1.1.0
 * @example
 * ```ts
 * import { discoverErrorPage, discoverRoutes } from "@meekojs/meeko/build";
 *
 * const routes = await discoverRoutes(process.cwd());
 * const errorPage = await discoverErrorPage(process.cwd());
 * // Pase errorPage a createFrameworkHandler, mountClientApp o AppManifest.
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#página-de-error-de-la-aplicación-apperrormeeko
 */
export async function discoverErrorPage(projectRoot: string): Promise<ErrorPageRecord | undefined> {
  const root = await rootFiles(projectRoot);
  if (!root.hasAppError) return undefined;
  if (await isFile(root.rootError)) throw rootErrorConflict(root.appError, root.rootError);
  const layouts: string[] = root.hasAppShell ? [root.appShell] : [];
  if (root.hasDefaultLayout) layouts.push(root.defaultLayout);
  else if (await isFile(root.rootLayout)) layouts.push(root.rootLayout);
  return { file: root.appError, layouts };
}

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
    throw new Error(`${file}: render debe ser un literal de texto para que Meeko pueda leerlo durante el build`);
  }
  const render = expression.text as PageRender;
  if (!renderModes.includes(render)) {
    const modes = renderModes.map((mode) => `"${mode}"`);
    throw new Error(`${file}: modo de render no admitido: "${expression.text}"; usa ${modes.slice(0, -1).join(", ")} o ${modes.at(-1)}`);
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
    if (opaque) throw new Error(`${file}: las opciones de ruta reexportadas no se pueden leer durante el build; exporta definePage({ ... }) desde este archivo`);
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
    throw new Error(`${file}: exporta definePage({ ... }) o un objeto literal para que Meeko pueda leer render durante el build`);
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
    if (!ts.isPropertyAssignment(property)) throw new Error(`${file}: render debe ser un literal de texto para que Meeko pueda leerlo durante el build`);
    render = literalRender(file, property.initializer);
    spread = false;
    computed = false;
  }
  if (computed) throw new Error(`${file}: las claves calculadas de las opciones de ruta no se pueden leer durante el build; escribe render como una propiedad normal`);
  if (spread && render === undefined) throw new Error(`${file}: declara render de forma explícita; las opciones de ruta con spread no se pueden leer durante el build`);
  if (spread) throw new Error(`${file}: declara render después de cualquier spread; las opciones de ruta con spread no se pueden leer durante el build`);
  if (render === "client" && prerenderEntries) {
    throw new Error(`${file}: una página render: "client" no se puede prerenderizar; quita prerenderEntries o usa render: "prerender"`);
  }
  return render;
}

/**
 * Opciones de {@link discoverRoutes}.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * import { discoverRoutes } from "@meekojs/meeko/build";
 *
 * // Páginas de un layer dentro del shell del proyecto.
 * const routes = await discoverRoutes("layers/base", { shell: process.cwd() });
 * ```
 */
export interface DiscoverRoutesOptions {
  /**
   * Proyecto cuyo shell envuelve las páginas descubiertas, para el árbol `app/pages` de un layer o
   * módulo. Su `app/app.meeko` y su `app/layouts/default.meeko` (o `app/pages/+layout.meeko`) van
   * primero y sustituyen a los archivos de la fuente con el mismo papel; los `+layout.meeko` de la
   * fuente se anidan dentro. Sin `+error.meeko` ni `app/error.meeko` en la fuente, sus páginas usan
   * la página de error raíz del proyecto.
   */
  readonly shell?: string;
}

/** The shell, root layout and root error page that a project lends to its layers and modules. */
async function projectShell(projectRoot: string): Promise<{ appShell?: string; rootLayout?: string; error?: string }> {
  const root = await rootFiles(projectRoot);
  const rootLayout = root.hasDefaultLayout ? root.defaultLayout : await isFile(root.rootLayout) ? root.rootLayout : undefined;
  const error = root.hasAppError ? root.appError : await isFile(root.rootError) ? root.rootError : undefined;
  return {
    ...(root.hasAppShell ? { appShell: root.appShell } : {}),
    ...(rootLayout ? { rootLayout } : {}),
    ...(error ? { error } : {}),
  };
}

/**
 * Descubre las páginas de `app/pages` con sus layouts, su `+error.meeko` más cercano y sus opciones
 * de ruta (`<script server>` o sidecar `*.route.ts`), y lee `render` sin ejecutar código. El
 * manifiesto resultante se puede serializar para el navegador.
 *
 * @param projectRoot Carpeta que contiene `app/pages`.
 * @param options `shell` para descubrir un layer o módulo dentro del proyecto.
 * @returns El manifiesto de rutas ordenado, con rutas de archivo absolutas.
 * @throws {Error} Si hay dos layouts o páginas de error raíz, una página declara sus opciones dos
 * veces, `render` no es un literal válido o dos rutas colisionan.
 * @example
 * ```ts
 * import { discoverRoutes } from "@meekojs/meeko/build";
 *
 * const routes = await discoverRoutes(process.cwd());
 * for (const route of routes) console.log(route.id, route.render ?? "ssr");
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#routing-layouts-y-ssr
 */
export async function discoverRoutes(projectRoot: string, options: DiscoverRoutesOptions = {}): Promise<readonly RouteRecord[]> {
  const { pagesRoot, appShell, defaultLayout, appError, hasAppShell, hasDefaultLayout, hasAppError } = await rootFiles(projectRoot);
  const shell = options.shell !== undefined && resolve(options.shell).toLowerCase() !== resolve(projectRoot).toLowerCase()
    ? await projectShell(options.shell) : undefined;
  // The project's files win over the source's files of the same role, as in a single application.
  const shellLayouts: string[] = [];
  const shellApp = shell?.appShell ?? (hasAppShell ? appShell : undefined);
  if (shellApp) shellLayouts.push(shellApp);
  if (shell?.rootLayout) shellLayouts.push(shell.rootLayout);
  else if (hasDefaultLayout) shellLayouts.push(defaultLayout);
  const files = new Set<string>();
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.add(path);
    }
  }
  await walk(pagesRoot);
  if (hasDefaultLayout && files.has(join(pagesRoot, "+layout.meeko"))) {
    throw new Error(`${defaultLayout} y ${join(pagesRoot, "+layout.meeko")} definen los dos el layout raíz`);
  }
  if (hasAppError && files.has(join(pagesRoot, "+error.meeko"))) throw rootErrorConflict(appError, join(pagesRoot, "+error.meeko"));
  const routes: RouteRecord[] = [];
  for (const file of files) {
    if (!file.endsWith(".meeko")) continue;
    if (basename(file).startsWith("+")) {
      if (tryRouteBlockSource(await readFile(file, "utf8"), file) !== undefined) {
        throw new Error(`${file}: <script server> declara opciones de ruta y sólo se admite en las páginas`);
      }
      continue;
    }
    const directory = dirname(file);
    const layouts: string[] = [...shellLayouts];
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
    // Without a nearer +error.meeko, the source's app/error.meeko handles the
    // failure, and then the root error page of the project that lends its shell.
    if (!error) error = hasAppError ? appError : shell?.error;
    const sidecarFile = file.slice(0, -".meeko".length) + ".route.ts";
    const block = tryRouteBlockSource(await readFile(file, "utf8"), file);
    if (block !== undefined && files.has(sidecarFile)) {
      throw new Error(`${file}: las opciones de ruta están declaradas dos veces; deja <script server> o ${basename(sidecarFile)}`);
    }
    const sidecar = block !== undefined ? routeBlockId(file) : files.has(sidecarFile) ? sidecarFile : undefined;
    const hasSidecar = sidecar !== undefined;
    const render = block !== undefined ? extractRouteRender(file, block)
      : hasSidecar ? extractRouteRender(sidecar, await readFile(sidecar, "utf8")) : undefined;
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
