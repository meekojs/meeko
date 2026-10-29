import { readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";

/** Files of `app/middleware` that are never route middleware. */
const excludedScript = /\.(?:test|spec|d|client)\.ts$/;

/** A server route middleware file: `app/middleware/*.server.ts` (since 1.6). */
const serverScript = /\.server\.ts$/;

/**
 * Whether `file` (a path or a module key) is a server route middleware of `app/middleware`, which
 * only runs on the server: `*.server.ts`.
 */
export function isServerRouteMiddleware(file: string): boolean {
  return serverScript.test(file);
}

/** Names of named route middleware: the path under `app/middleware` without `.ts`, with `/` between folders. */
export const routeMiddlewareNamePattern = /^[A-Za-z0-9][\w-]*(?:\/[A-Za-z0-9][\w-]*)*$/;

/**
 * Middleware de ruta de un proyecto, tal como lo descubre {@link discoverRouteMiddleware}.
 *
 * @since 1.6.0
 * @example
 * ```ts
 * import type { RouteMiddlewareDiscovery } from "@meekojs/meeko/build";
 *
 * const middleware: RouteMiddlewareDiscovery = {
 *   global: ["/srv/app/app/middleware/10-locale.ts"],
 *   serverGlobal: ["/srv/app/app/middleware/session.server.ts"],
 *   named: { admin: "/srv/app/app/middleware/admin.ts", auth: "/srv/app/app/middleware/auth.server.ts" },
 * };
 * ```
 */
export interface RouteMiddlewareDiscovery {
  /** Archivos absolutos de los middleware globales isomórficos, en orden de ejecución (por ruta del archivo). */
  readonly global: readonly string[];
  /** Archivos absolutos de los middleware globales de servidor (`*.server.ts`), en orden de ejecución. */
  readonly serverGlobal: readonly string[];
  /**
   * Archivo absoluto de cada middleware con nombre (`{ global: false }`), por nombre: los isomórficos
   * (`*.ts`) y los de servidor (`*.server.ts`), que comparten los nombres.
   */
  readonly named: Readonly<Record<string, string>>;
}

async function scripts(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
  const found: string[] = [];
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await scripts(file));
    else if (entry.isFile() && entry.name.endsWith(".ts") && !excludedScript.test(entry.name)) found.push(file);
  }
  return found;
}

/**
 * `app/middleware/10-auth.ts` is `auth`, `app/middleware/admin/20-role.ts` is `admin/role`, and
 * `app/middleware/auth.server.ts` is `auth` too.
 */
function middlewareName(path: string): string {
  const extension = serverScript.test(path) ? ".server.ts" : ".ts";
  return path.slice(0, -extension.length).split("/").map((part) => part.replace(/^\d+[-_.]/, "")).join("/");
}

/** The two definitions of route middleware: `*.ts` files use the first, `*.server.ts` the second. */
const definitions = ["defineRouteMiddleware", "defineServerRouteMiddleware"] as const;
type Definition = typeof definitions[number];

function unwrapValue(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
  return current;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return undefined;
}

/**
 * Reads `{ global }` from the second argument of the `defineRouteMiddleware(...)` call that a
 * route middleware file exports by default, without executing it. Any other default export (a
 * plain function, a re-export) is global, as every route middleware was before 1.6. A server route
 * middleware (`*.server.ts`, since 1.6) reads `defineServerRouteMiddleware(...)` the same way, but
 * its default export must resolve to that call: these files were ignored until 1.5, so a helper
 * there (no default export, or a default export of anything else) stops discovery instead of
 * becoming global server middleware.
 */
export function extractRouteMiddlewareOptions(file: string, source: string): { readonly global: boolean } {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const server = serverScript.test(file);
  const expected: Definition = server ? "defineServerRouteMiddleware" : "defineRouteMiddleware";
  // Until 1.6 these files were not discovered: a helper there must move, not become middleware silently.
  const notMiddleware = (): Error => new Error(`${file}: un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware(...); desde 1.6, los archivos *.server.ts de app/middleware son middleware de ruta de servidor, así que mueve los helpers a server/utils`);
  // The autoimported names, and those an import binds to them.
  const callees = new Map<string, Definition>(definitions.map((name) => [name, name]));
  const constants = new Map<string, ts.Expression>();
  let definition: ts.Expression | undefined;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          const kind = definitions.find((name) => name === imported);
          if (kind) callees.set(element.name.text, kind);
        }
      }
    } else if (ts.isExportAssignment(statement) && !statement.isExportEquals) definition = statement.expression;
    else if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      const element = statement.exportClause.elements.find((candidate) => candidate.name.text === "default");
      if (element) definition = ts.factory.createIdentifier((element.propertyName ?? element.name).text);
    } else if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) constants.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  const resolveConstant = (expression: ts.Expression): ts.Expression => {
    let current = unwrapValue(expression);
    const visited = new Set<string>();
    while (ts.isIdentifier(current) && constants.has(current.text) && !visited.has(current.text)) {
      visited.add(current.text);
      current = unwrapValue(constants.get(current.text)!);
    }
    return current;
  };
  if (!definition) {
    if (server) throw notMiddleware();
    return { global: true };
  }
  const call = resolveConstant(definition);
  if (!ts.isCallExpression(call)) {
    if (server) throw notMiddleware();
    return { global: true };
  }
  const callee = call.expression;
  const kind = ts.isIdentifier(callee) ? callees.get(callee.text)
    : ts.isPropertyAccessExpression(callee) ? definitions.find((name) => name === callee.name.text) : undefined;
  if (kind === undefined) {
    if (server) throw notMiddleware();
    return { global: true };
  }
  if (kind !== expected) {
    throw new Error(server
      ? `${file}: un archivo *.server.ts de app/middleware es middleware de ruta de servidor; decláralo con defineServerRouteMiddleware en lugar de defineRouteMiddleware`
      : `${file}: defineServerRouteMiddleware sólo se admite en un archivo *.server.ts de app/middleware, que nunca llega al navegador; renombra el archivo a ${basename(file).replace(/\.ts$/, ".server.ts")}`);
  }
  const argument = call.arguments[1];
  if (!argument) return { global: true };
  const literal = `${file}: las opciones de ${kind} deben ser un objeto literal, como { global: false }, para que Meeko pueda leerlas sin ejecutar el archivo`;
  const options = ts.isSpreadElement(argument) ? argument : resolveConstant(argument);
  if (!ts.isObjectLiteralExpression(options)) throw new Error(literal);
  let global = true;
  for (const property of options.properties) {
    const key = property.name && !ts.isComputedPropertyName(property.name) ? propertyName(property.name) : undefined;
    if (!ts.isPropertyAssignment(property) || key === undefined) throw new Error(literal);
    if (key !== "global") throw new Error(`${file}: opción de middleware desconocida "${key}"; ${kind} admite global`);
    const value = unwrapValue(property.initializer);
    if (value.kind === ts.SyntaxKind.TrueKeyword) global = true;
    else if (value.kind === ts.SyntaxKind.FalseKeyword) global = false;
    else throw new Error(`${file}: global debe ser el literal true o false para que Meeko pueda leerlo sin ejecutar el archivo`);
  }
  return { global };
}

/**
 * Descubre el middleware de ruta de `app/middleware` de un proyecto, también en subcarpetas, sin
 * ejecutarlo. Un archivo es global, como hasta `1.5`, salvo que exporte
 * `defineRouteMiddleware(fn, { global: false })`: entonces es un middleware con nombre, que las rutas
 * eligen con `middleware` en `definePage` o en un `+group.ts`. El nombre es la ruta del archivo sin
 * `.ts` ni el prefijo numérico de orden de cada parte (`10-auth.ts` es `"auth"`,
 * `admin/20-role.ts` es `"admin/role"`). Los `*.server.ts` son middleware de ruta de servidor, con
 * `defineServerRouteMiddleware` y la misma regla de nombres (`auth.server.ts` es `"auth"`). Se
 * excluyen `*.test.ts`, `*.spec.ts`, `*.d.ts` y `*.client.ts`.
 *
 * @param projectRoot Carpeta que contiene `app/middleware`.
 * @returns Los archivos globales isomórficos y de servidor en orden de ejecución, y los middleware
 * con nombre de las dos clases.
 * @throws {Error} Si las opciones de un archivo no son un objeto literal, un middleware con nombre
 * no tiene un nombre válido, dos archivos dan el mismo nombre y uno de ellos es con nombre
 * (también `auth.ts` y `auth.server.ts`), o un `*.server.ts` no exporta por defecto un
 * `defineServerRouteMiddleware(...)`.
 * @since 1.6.0
 * @example
 * ```ts
 * import { discoverRouteMiddleware } from "@meekojs/meeko/build";
 *
 * const { global, named } = await discoverRouteMiddleware(process.cwd());
 * console.log(global.length, Object.keys(named)); // 1 ["auth", "admin/role"]
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#middleware-de-rutas-y-servidor
 */
export async function discoverRouteMiddleware(projectRoot: string): Promise<RouteMiddlewareDiscovery> {
  const directory = resolve(projectRoot, "app", "middleware");
  const entries = (await scripts(directory))
    .map((file) => ({ file, path: relative(directory, file).split(sep).join("/") }))
    // The order of their module keys, as the server ran them before 1.6.
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const global: string[] = [];
  const serverGlobal: string[] = [];
  const named: Record<string, string> = {};
  const byName = new Map<string, { file: string; global: boolean }[]>();
  for (const { file, path } of entries) {
    const options = extractRouteMiddlewareOptions(file, await readFile(file, "utf8"));
    const name = middlewareName(path);
    if (options.global) (serverScript.test(file) ? serverGlobal : global).push(file);
    else {
      if (!routeMiddlewareNamePattern.test(name)) {
        throw new Error(`${file}: "${name}" no es un nombre de middleware válido; usa letras, dígitos, - y _ (y / entre carpetas)`);
      }
      named[name] = file;
    }
    byName.set(name, [...byName.get(name) ?? [], { file, global: options.global }]);
  }
  for (const [name, files] of byName) {
    if (files.length > 1 && files.some((entry) => !entry.global)) {
      throw new Error(`${files.map((entry) => entry.file).join(" y ")} declaran el mismo middleware "${name}"; cambia el nombre de uno de ellos`);
    }
  }
  return { global, serverGlobal, named };
}

/**
 * The name of each global route middleware of `projectRoot`, isomorphic or server, for the error
 * of a route that lists one.
 */
export function globalMiddlewareNames(projectRoot: string, discovery: RouteMiddlewareDiscovery): ReadonlyMap<string, string> {
  const directory = resolve(projectRoot, "app", "middleware");
  const names = new Map<string, string>();
  for (const file of [...discovery.global, ...discovery.serverGlobal]) {
    const name = middlewareName(relative(directory, file).split(sep).join("/"));
    if (!names.has(name)) names.set(name, file);
  }
  return names;
}
