import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { routeBlockId, tryRouteBlockSource } from "./route-block.js";
import { discoverRouteMiddleware, globalMiddlewareNames, isServerRouteMiddleware, routeMiddlewareNamePattern } from "./route-middleware-discovery.js";
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
 * Opciones de {@link discoverErrorPage}.
 *
 * @since 1.5.0
 * @example
 * ```ts
 * import { discoverErrorPage } from "@meekojs/meeko/build";
 *
 * const errorPage = await discoverErrorPage(process.cwd(), { layouts: { default: "/srv/ui/layouts/default.meeko" } });
 * ```
 */
export interface DiscoverErrorPageOptions {
  /**
   * Layouts con nombre de los módulos (`meeko.addLayout`), por nombre. Su `default` envuelve la
   * página de error si el proyecto no tiene `app/layouts/default.meeko`.
   */
  readonly layouts?: Readonly<Record<string, string>>;
}

/**
 * Descubre `app/error.meeko` con los layouts raíz que lo envuelven: `app/app.meeko`, el layout
 * `default` (`app/layouts/default.meeko` o, desde `1.5`, el de un módulo) y `app/pages/+layout.meeko`.
 *
 * @param projectRoot Carpeta del proyecto.
 * @param options Layouts con nombre de los módulos, desde `1.5`.
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
export async function discoverErrorPage(projectRoot: string, options: DiscoverErrorPageOptions = {}): Promise<ErrorPageRecord | undefined> {
  const root = await rootFiles(projectRoot);
  if (!root.hasAppError) return undefined;
  if (await isFile(root.rootError)) throw rootErrorConflict(root.appError, root.rootError);
  const layouts: string[] = root.hasAppShell ? [root.appShell] : [];
  const defaultFile = root.hasDefaultLayout ? root.defaultLayout : options.layouts?.default;
  if (defaultFile) layouts.push(defaultFile);
  if (!root.hasDefaultLayout && await isFile(root.rootLayout)) layouts.push(root.rootLayout);
  return { file: root.appError, layouts, ...(defaultFile ? { layout: { name: "default", file: defaultFile } } : {}) };
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

/** `layout` of route or group options: a string literal naming a layout of `app/layouts`, or `false`. */
function literalLayout(file: string, value: ts.Expression): string | false {
  const expression = unwrap(value);
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (!ts.isStringLiteral(expression) && !ts.isNoSubstitutionTemplateLiteral(expression)) {
    throw new Error(`${file}: layout debe ser un literal de texto (el nombre de un layout de app/layouts) o false para que Meeko pueda leerlo durante el build`);
  }
  if (!layoutNamePattern.test(expression.text)) throw new Error(`${file}: "${expression.text}" no es un nombre de layout válido`);
  return expression.text;
}

/** `middleware` of route or group options: an array literal of names of `app/middleware`, or `false`. */
function literalMiddleware(file: string, value: ts.Expression): readonly string[] | false {
  const expression = unwrapValue(value);
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  const message = `${file}: middleware debe ser un array literal de nombres de app/middleware, o false, para que Meeko pueda leerlo durante el build`;
  if (!ts.isArrayLiteralExpression(expression)) throw new Error(message);
  return expression.elements.map((element) => {
    const item = unwrapValue(element);
    if (!ts.isStringLiteral(item) && !ts.isNoSubstitutionTemplateLiteral(item)) throw new Error(message);
    if (!routeMiddlewareNamePattern.test(item.text)) throw new Error(`${file}: "${item.text}" no es un nombre de middleware válido`);
    return item.text;
  });
}

/**
 * Opciones de ruta que Meeko lee sin ejecutar el archivo: `render`, desde `1.5`, `layout` y, desde
 * `1.6`, `middleware`.
 *
 * @since 1.5.0
 * @example
 * ```ts
 * import type { StaticRouteOptions } from "@meekojs/meeko/build";
 *
 * const options: StaticRouteOptions = { render: "prerender", layout: "dashboard" };
 * ```
 */
export interface StaticRouteOptions {
  /** Modo de render, si lo declara. */
  readonly render?: PageRender;
  /** Layout con nombre que elige la página, o `false` para quitarlo; sin él, el heredado. */
  readonly layout?: string | false;
  /**
   * Middleware con nombre que añade la página a los heredados de sus `+group.ts`, o `false` para
   * quitar los heredados.
   * @since 1.6.0
   */
  readonly middleware?: readonly string[] | false;
}

/**
 * Reads `render` from a route sidecar without executing it. The value must be
 * a string literal in the exported `definePage({...})` call or object literal.
 */
export function extractRouteRender(file: string, source: string): PageRender | undefined {
  return extractRouteOptions(file, source).render;
}

/**
 * Reads `render`, `layout` and `middleware` from route options without executing them. Each must
 * be a literal in the exported `definePage({...})` call or object literal.
 */
export function extractRouteOptions(file: string, source: string): StaticRouteOptions {
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
    return namedRender ? { render: literalRender(file, namedRender) } : {};
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
  let layout: string | false | undefined;
  let middleware: readonly string[] | false | undefined;
  // Members after the last explicit render that could set it at run time.
  let spread = false;
  let computed = false;
  let prerenderEntries = false;
  // A spread after the last explicit middleware that may carry one: the build would not see it.
  let middlewareSpread: ts.SpreadAssignment | undefined;
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) {
      spread = true;
      if (spreadMayDeclare(property.expression, "middleware", constants)) middlewareSpread = property;
      continue;
    }
    if (property.name && ts.isComputedPropertyName(property.name)) { computed = true; continue; }
    const name = property.name ? propertyName(property.name) : undefined;
    if (name === "prerenderEntries") prerenderEntries = true;
    if (name === "layout") {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error(`${file}: layout debe ser un literal de texto (el nombre de un layout de app/layouts) o false para que Meeko pueda leerlo durante el build`);
      }
      layout = literalLayout(file, property.initializer);
      continue;
    }
    if (name === "middleware") {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error(`${file}: middleware debe ser un array literal de nombres de app/middleware, o false, para que Meeko pueda leerlo durante el build`);
      }
      middleware = literalMiddleware(file, property.initializer);
      middlewareSpread = undefined;
      continue;
    }
    if (name !== "render") continue;
    if (!ts.isPropertyAssignment(property)) throw new Error(`${file}: render debe ser un literal de texto para que Meeko pueda leerlo durante el build`);
    render = literalRender(file, property.initializer);
    spread = false;
    computed = false;
  }
  if (computed) throw new Error(`${file}: las claves calculadas de las opciones de ruta no se pueden leer durante el build; escribe render como una propiedad normal`);
  if (spread && render === undefined) throw new Error(`${file}: declara render de forma explícita; las opciones de ruta con spread no se pueden leer durante el build`);
  if (spread) throw new Error(`${file}: declara render después de cualquier spread; las opciones de ruta con spread no se pueden leer durante el build`);
  if (middlewareSpread) {
    throw new Error(`${file}: el spread ${middlewareSpread.expression.getText()} puede llevar middleware, que Meeko no lee durante el build y la ruta se serviría sin él; declara middleware de forma explícita después del último spread (middleware: ["auth"], o middleware: [] si no añade ninguno)`);
  }
  if (render === "client" && prerenderEntries) {
    throw new Error(`${file}: una página render: "client" no se puede prerenderizar; quita prerenderEntries o usa render: "prerender"`);
  }
  return { ...(render ? { render } : {}), ...(layout === undefined ? {} : { layout }), ...(middleware === undefined ? {} : { middleware }) };
}

/**
 * Opciones de un `+group.ts`, leídas sin ejecutarlo.
 *
 * @since 1.5.0
 * @example
 * ```ts
 * import type { StaticGroupOptions } from "@meekojs/meeko/build";
 *
 * const group: StaticGroupOptions = { layout: "dashboard", layoutProps: { showAlert: false } };
 * ```
 */
export interface StaticGroupOptions {
  /** Layout con nombre de las páginas de la carpeta, o `false`. */
  readonly layout?: string | false;
  /** Props del layout, que heredan las páginas de la carpeta y de sus subcarpetas. */
  readonly layoutProps?: Readonly<Record<string, unknown>>;
  /**
   * Middleware con nombre de las páginas de la carpeta y de sus subcarpetas, después de los de los
   * grupos exteriores, o `false` para quitar los heredados.
   * @since 1.6.0
   */
  readonly middleware?: readonly string[] | false;
}

/**
 * Whether the object that `expression` spreads may set `key`: a spread of a module-level `const`
 * object literal of the same file is read (with its own spreads); anything else (an import, a
 * call, a parameter) may set anything.
 */
function spreadMayDeclare(expression: ts.Expression, key: string, constants: ReadonlyMap<string, ts.Expression>, visited = new Set<string>()): boolean {
  let object = unwrapValue(expression);
  while (ts.isIdentifier(object) && constants.has(object.text) && !visited.has(object.text)) {
    visited.add(object.text);
    object = unwrapValue(constants.get(object.text)!);
  }
  if (!ts.isObjectLiteralExpression(object)) return true;
  return object.properties.some((property) => {
    if (ts.isSpreadAssignment(property)) return spreadMayDeclare(property.expression, key, constants, visited);
    if (!property.name || ts.isComputedPropertyName(property.name)) return true;
    return propertyName(property.name) === key;
  });
}

/** Like {@link unwrap}, without entering calls: a literal value is never a call. */
function unwrapValue(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
  return current;
}

/** A JSON value written as a literal: strings, numbers, booleans, null, arrays and plain objects. */
function literalValue(file: string, value: ts.Expression, path: string): unknown {
  const expression = unwrapValue(value);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(expression.operand)) {
    return -Number(expression.operand.text);
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.map((element, index) => literalValue(file, element, `${path}[${index}]`));
  if (ts.isObjectLiteralExpression(expression)) {
    const result: Record<string, unknown> = {};
    for (const property of expression.properties) {
      const name = property.name && !ts.isComputedPropertyName(property.name) ? propertyName(property.name) : undefined;
      if (!ts.isPropertyAssignment(property) || name === undefined || name === "__proto__") {
        throw new Error(`${file}: ${path} debe ser un objeto literal con claves normales para que Meeko pueda leerlo durante el build`);
      }
      result[name] = literalValue(file, property.initializer, `${path}.${name}`);
    }
    return result;
  }
  throw new Error(`${file}: ${path} debe ser un valor literal (texto, número, booleano, null, array u objeto) para que Meeko pueda leerlo durante el build`);
}

/**
 * Reads the options of a `+group.ts` without executing it: `export default defineGroup({ ... })`
 * (or an object literal) with a literal `layout`, literal `layoutProps` and a literal `middleware`.
 */
export function extractGroupOptions(file: string, source: string): StaticGroupOptions {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let definition: ts.Expression | undefined;
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) definition = statement.expression;
    else if (ts.isExportDeclaration(statement) && (!statement.exportClause || (ts.isNamedExports(statement.exportClause)
      && statement.exportClause.elements.some((element) => element.name.text === "default")))) {
      throw new Error(`${file}: las opciones del grupo reexportadas no se pueden leer durante el build; escribe export default defineGroup({ ... }) en este archivo`);
    }
  }
  if (!definition) throw new Error(`${file}: un +group.ts debe exportar por defecto defineGroup({ ... })`);
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
    throw new Error(`${file}: exporta por defecto defineGroup({ ... }) con un objeto literal para que Meeko pueda leerlo durante el build`);
  }
  let layout: string | false | undefined;
  let layoutProps: Record<string, unknown> | undefined;
  let middleware: readonly string[] | false | undefined;
  for (const property of object.properties) {
    const name = property.name && !ts.isComputedPropertyName(property.name) ? propertyName(property.name) : undefined;
    if (!ts.isPropertyAssignment(property) || name === undefined) {
      throw new Error(`${file}: las opciones del grupo deben ser propiedades normales (sin spread, métodos ni claves calculadas) para que Meeko pueda leerlas durante el build`);
    }
    if (name === "layout") layout = literalLayout(file, property.initializer);
    else if (name === "layoutProps") {
      const value = literalValue(file, property.initializer, "layoutProps");
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${file}: layoutProps debe ser un objeto literal`);
      layoutProps = value as Record<string, unknown>;
    } else if (name === "middleware") middleware = literalMiddleware(file, property.initializer);
    else throw new Error(`${file}: opción de grupo desconocida "${name}"; un +group.ts admite layout, layoutProps y middleware`);
  }
  return { ...(layout === undefined ? {} : { layout }), ...(layoutProps ? { layoutProps } : {}), ...(middleware === undefined ? {} : { middleware }) };
}

/** Names of named layouts: the path under `app/layouts` without `.meeko`, with `/` between folders. */
const layoutNamePattern = /^[A-Za-z0-9][\w-]*(?:\/[A-Za-z0-9][\w-]*)*$/;

/**
 * Descubre los layouts con nombre de `app/layouts` de un proyecto, layer o módulo: cada
 * `app/layouts/<nombre>.meeko`, también en subcarpetas (`app/layouts/admin/panel.meeko` es
 * `"admin/panel"`). Los enlaces simbólicos no cuentan, como `app/layouts/default.meeko` hasta `1.4`,
 * y un archivo cuya ruta no es un nombre válido (`_partes.meeko`, `mi layout.meeko`) tampoco.
 *
 * @param sourceRoot Carpeta que contiene `app/layouts`.
 * @returns El archivo absoluto de cada layout, por nombre.
 * @since 1.5.0
 * @example
 * ```ts
 * import { discoverLayouts } from "@meekojs/meeko/build";
 *
 * const layouts = await discoverLayouts(process.cwd());
 * console.log(Object.keys(layouts)); // ["admin/panel", "dashboard", "default"]
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#layouts-con-nombre
 */
export async function discoverLayouts(sourceRoot: string): Promise<Readonly<Record<string, string>>> {
  const base = resolve(sourceRoot, "app", "layouts");
  const result: Record<string, string> = {};
  async function walk(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".meeko")) {
        const name = relative(base, path).slice(0, -".meeko".length).split(sep).join("/");
        // A file whose path is not a layout name (`_parts.meeko`, `my layout.meeko`) is not a
        // layout: before 1.5 only default.meeko was, and such files may hold other components.
        if (layoutNamePattern.test(name)) result[name] = path;
      }
    }
  }
  await walk(base);
  return result;
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
   * la página de error raíz del proyecto. Desde `1.5`, sus layouts con nombre ganan a los de la
   * fuente.
   */
  readonly shell?: string;
  /**
   * Layouts con nombre de las demás fuentes (layers y módulos), por nombre, para los nombres que no
   * tienen ni el proyecto ni la fuente. `composeFrameworkRoutes` los reúne: los de los layers sin su
   * `default` y después los de `meeko.addLayout`.
   * @since 1.5.0
   */
  readonly layouts?: Readonly<Record<string, string>>;
}

/** The shell, root layout and root error page that a project lends to its layers and modules. */
async function projectShell(projectRoot: string): Promise<{ appShell?: string; plusLayout?: string; error?: string; layouts: Readonly<Record<string, string>> }> {
  const root = await rootFiles(projectRoot);
  // The project's app/pages/+layout.meeko stays the root layout of its layers, as before 1.5.
  const plusLayout = !root.hasDefaultLayout && await isFile(root.rootLayout) ? root.rootLayout : undefined;
  const error = root.hasAppError ? root.appError : await isFile(root.rootError) ? root.rootError : undefined;
  return {
    ...(root.hasAppShell ? { appShell: root.appShell } : {}),
    ...(plusLayout ? { plusLayout } : {}),
    ...(error ? { error } : {}),
    layouts: await discoverLayouts(projectRoot),
  };
}

const groupFile = "+group.ts";

/**
 * Descubre las páginas de `app/pages` con sus layouts, su `+error.meeko` más cercano y sus opciones
 * de ruta (`<script server>` o sidecar `*.route.ts`), y lee `render` y, desde `1.5`, `layout` y los
 * `+group.ts` de sus carpetas sin ejecutar código. El manifiesto resultante se puede serializar para
 * el navegador.
 *
 * Los layouts de una página van de fuera hacia dentro: `app/app.meeko`, el layout con nombre que
 * elige (o hereda de sus `+group.ts`, o `default`) y los `+layout.meeko` de sus carpetas. Desde
 * `1.6`, el `middleware` de sus `+group.ts` y de la página se resuelve, de fuera hacia dentro y sin
 * repetir, contra los middleware con nombre de `app/middleware` del proyecto (el de `shell`, si se
 * pasa): los isomórficos van a `middleware` y los de servidor (`*.server.ts`), a `serverMiddleware`,
 * que lleva la cadena completa de la ruta: los globales de servidor y después los con nombre (ninguno
 * en las páginas `render: "client"` y `"prerender"`).
 *
 * @param projectRoot Carpeta que contiene `app/pages`.
 * @param options `shell` para descubrir un layer o módulo dentro del proyecto y `layouts` de las
 * demás fuentes.
 * @returns El manifiesto de rutas ordenado, con rutas de archivo absolutas.
 * @throws {Error} Si hay dos layouts o páginas de error raíz, una página declara sus opciones dos
 * veces, `render` o `layout` no son literales válidos, un layout no existe o dos rutas colisionan;
 * desde `1.6`, también si un middleware no existe o es global, o si una página `render: "client"` o
 * `"prerender"` pide un middleware de ruta de servidor (`*.server.ts`).
 * @example
 * ```ts
 * import { discoverRoutes } from "@meekojs/meeko/build";
 *
 * const routes = await discoverRoutes(process.cwd());
 * for (const route of routes) console.log(route.id, route.render ?? "ssr", route.layout?.name ?? "(sin layout)");
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#routing-layouts-y-ssr
 */
export async function discoverRoutes(projectRoot: string, options: DiscoverRoutesOptions = {}): Promise<readonly RouteRecord[]> {
  const { pagesRoot, appShell, defaultLayout, appError, hasAppShell, hasDefaultLayout, hasAppError } = await rootFiles(projectRoot);
  const shell = options.shell !== undefined && resolve(options.shell).toLowerCase() !== resolve(projectRoot).toLowerCase()
    ? await projectShell(options.shell) : undefined;
  // The project's files win over the source's files of the same role, as in a single application.
  const shellApp = shell?.appShell ?? (hasAppShell ? appShell : undefined);
  const own = await discoverLayouts(projectRoot);
  const projectLayouts = shell?.layouts ?? own;
  const others = options.layouts ?? {};
  // `default` comes from the project, then from the source itself (unless the project's
  // app/pages/+layout.meeko is the root layout), then from a module.
  const implicitDefault = projectLayouts.default ?? (shell?.plusLayout ? undefined : own.default ?? others.default);
  const available = (): string => [...new Set([...Object.keys(projectLayouts), ...Object.keys(own), ...Object.keys(others)])].sort()
    .map((name) => `"${name}"`).join(", ") || "ninguno";
  const named = (name: string, file: string): string => {
    const found = name === "default" ? implicitDefault : projectLayouts[name] ?? own[name] ?? others[name];
    if (!found) throw new Error(`${file}: el layout "${name}" no existe; crea app/layouts/${name}.meeko (layouts disponibles: ${available()})`);
    return found;
  };
  // Named route middleware lives in the project's app/middleware, which also serves its layers.
  const middlewareRoot = options.shell ?? projectRoot;
  const routeMiddleware = await discoverRouteMiddleware(middlewareRoot);
  const globalMiddleware = globalMiddlewareNames(middlewareRoot, routeMiddleware);
  const middlewareFile = (name: string, origin: string): string => {
    const found = routeMiddleware.named[name];
    if (found) return found;
    const global = globalMiddleware.get(name);
    if (global) {
      const definition = isServerRouteMiddleware(global) ? "defineServerRouteMiddleware" : "defineRouteMiddleware";
      throw new Error(`${origin}: el middleware "${name}" (${global}) es global y ya se ejecuta en todas las rutas; quítalo de middleware o decláralo con ${definition}(..., { global: false })`);
    }
    const available = Object.keys(routeMiddleware.named).sort().map((candidate) => `"${candidate}"`).join(", ") || "ninguno";
    throw new Error(`${origin}: el middleware "${name}" no existe; crea app/middleware/${name}.ts con defineRouteMiddleware(..., { global: false }) (middleware con nombre disponibles: ${available}), o app/middleware/${name}.server.ts con defineServerRouteMiddleware para uno que sólo se ejecuta en el servidor`);
  };
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
  const groups = new Map<string, StaticGroupOptions>();
  for (const file of files) {
    if (basename(file) !== groupFile) continue;
    const group = extractGroupOptions(file, await readFile(file, "utf8"));
    // A group without pages still names existing middleware.
    if (group.middleware) for (const name of group.middleware) middlewareFile(name, file);
    groups.set(dirname(file), group);
  }
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
    // The folders from app/pages down to the page's, outermost first.
    const folders = [pagesRoot];
    const relativeDirectory = relative(pagesRoot, directory);
    if (relativeDirectory) for (const segment of relativeDirectory.split(sep)) folders.push(join(folders.at(-1)!, segment));
    const plusLayouts = folders.map((folder) => join(folder, "+layout.meeko")).filter((candidate) => files.has(candidate));
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
    const optionsFile = block !== undefined ? file : sidecar;
    const routeOptions = block !== undefined ? extractRouteOptions(file, block)
      : hasSidecar ? extractRouteOptions(sidecar, await readFile(sidecar, "utf8")) : {};
    // The layout cascades from the outermost +group.ts to the page. Props inherited for one layout
    // do not reach another: choosing a different layout starts with its own props.
    let layoutName: string | false = "default";
    let explicit = false;
    let chosenIn = file;
    let props: Record<string, unknown> = {};
    const choose = (layout: string | false | undefined, origin: string): void => {
      if (layout === undefined) return;
      if (layout !== layoutName) props = {};
      layoutName = layout;
      explicit = true;
      chosenIn = origin;
    };
    // Named middleware accumulates the same way, without repeats; false drops what is inherited.
    // Server route middleware (*.server.ts) keeps its own list: it runs after the isomorphic one.
    let middleware: string[] = [];
    let serverMiddleware: { readonly name: string; readonly file: string; readonly origin: string }[] = [];
    const use = (names: readonly string[] | false | undefined, origin: string): void => {
      if (names === undefined) return;
      if (names === false) { middleware = []; serverMiddleware = []; return; }
      for (const name of names) {
        const middlewareModule = middlewareFile(name, origin);
        if (isServerRouteMiddleware(middlewareModule)) {
          if (!serverMiddleware.some((entry) => entry.file === middlewareModule)) serverMiddleware.push({ name, file: middlewareModule, origin });
        } else if (!middleware.includes(middlewareModule)) middleware.push(middlewareModule);
      }
    };
    for (const folder of folders) {
      const group = groups.get(folder);
      if (!group) continue;
      choose(group.layout, join(folder, groupFile));
      if (group.layoutProps) props = { ...props, ...group.layoutProps };
      use(group.middleware, join(folder, groupFile));
    }
    choose(routeOptions.layout, optionsFile ?? file);
    use(routeOptions.middleware, optionsFile ?? file);
    // A client or prerendered page has no request of its own on which to check the session.
    const render = routeOptions.render;
    const guard = serverMiddleware[0];
    if (guard && (render === "client" || render === "prerender")) {
      const reason = render === "client"
        ? "su navegación no pide datos al servidor, así que el middleware de servidor no tendría una petición en la que ejecutarse"
        : "se renderiza al hacer el build, sin la petición ni la sesión de cada visitante";
      throw new Error(`${guard.origin}: el middleware de servidor "${guard.name}" (${guard.file}) necesita una página con datos del servidor, pero ${optionsFile ?? file} usa render: "${render}" y ${reason}. Usa render: "ssr" o "stream", o quítalo de esa página con middleware: false`);
    }
    // The whole server chain: the global ones, which `middleware: false` does not drop, then the
    // named ones. Pages that do not ask the server for their data run none.
    const serverChain = render === "client" || render === "prerender" ? []
      : [...routeMiddleware.serverGlobal, ...serverMiddleware.map((entry) => entry.file)];
    const finalName = layoutName as string | false;
    const layoutFile = finalName === false ? undefined : explicit ? named(finalName, chosenIn) : implicitDefault;
    const layouts: string[] = [
      ...shellApp ? [shellApp] : [],
      ...layoutFile ? [layoutFile] : [],
      ...shell?.plusLayout ? [shell.plusLayout] : [],
      ...plusLayouts,
    ];
    routes.push({
      id: routeId(relative(pagesRoot, file)),
      file,
      layouts,
      ...(error ? { error } : {}),
      ...(hasSidecar ? { sidecar } : {}),
      ...(routeOptions.render ? { render: routeOptions.render } : {}),
      ...(layoutFile && finalName !== false
        ? { layout: { name: finalName, file: layoutFile, ...(Object.keys(props).length ? { props } : {}) } }
        : {}),
      ...(middleware.length ? { middleware } : {}),
      ...(serverChain.length ? { serverMiddleware: serverChain } : {}),
    });
  }
  return createRouteManifest(routes);
}
