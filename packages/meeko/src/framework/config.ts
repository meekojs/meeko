import { realpath, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { composeFrameworkRoutes } from "./modules.js";
import { normalizeDocumentConfig } from "./head.js";
import type { RouteRecord } from "./router.js";
import type { MeekoConfig } from "./config-type.js";

export type { MeekoConfig } from "./config-type.js";

/**
 * Una fuente de páginas y autoimports del proyecto: la aplicación, un layer de `extends` o un
 * módulo de `modules`. La devuelve {@link resolveConfigSources}.
 *
 * @example
 * ```ts
 * import { resolveConfigSources } from "@meekojs/meeko/build";
 *
 * for (const source of await resolveConfigSources(process.cwd())) {
 *   console.log(source.kind, source.name, source.root); // "app" "app" "/ruta/al/proyecto"
 * }
 * ```
 */
export interface ConfigSource {
  /** Nombre en los diagnósticos: `"app"` o el nombre de la carpeta del layer o módulo. */
  readonly name: string;
  /** Carpeta absoluta de la fuente, que contiene `app/pages`. */
  readonly root: string;
  /** Tipo de fuente. */
  readonly kind: "app" | "layer" | "module";
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function configFile(root: string): Promise<string | undefined> {
  const files = ["meeko.config.ts", "meeko.config.mts", "meeko.config.js", "meeko.config.mjs"];
  const found: string[] = [];
  for (const name of files) {
    const file = resolve(root, name);
    try { if ((await stat(file)).isFile()) found.push(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (found.length > 1) throw new Error(`Multiple Meeko configuration files: ${found.join(", ")}`);
  return found[0];
}

/**
 * Carga la configuración opcional del proyecto (`meeko.config.ts`, `.mts`, `.js` o `.mjs`) con el
 * soporte de TypeScript de Node 24 y valida sus campos. Sin archivo devuelve `{}`.
 *
 * @param projectRoot Carpeta del proyecto.
 * @returns La configuración exportada por defecto.
 * @throws {Error} Si hay varios archivos de configuración o el archivo no se puede cargar.
 * @throws {TypeError} Si el export no es un objeto o un campo no es válido.
 * @example
 * ```ts
 * import { loadMeekoConfig } from "@meekojs/meeko/build";
 *
 * const config = await loadMeekoConfig(process.cwd());
 * const adapter = config.server?.adapter ?? "node";
 * ```
 */
export async function loadMeekoConfig(projectRoot: string): Promise<MeekoConfig> {
  const root = resolve(projectRoot);
  const file = await configFile(root);
  if (!file) return {};
  const url = pathToFileURL(file);
  url.searchParams.set("mtime", String((await stat(file)).mtimeMs));
  let loaded: unknown;
  try { loaded = (await import(url.href) as { default?: unknown }).default; }
  catch (error) { throw new Error(`Cannot load ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new TypeError(`${file} must export a Meeko configuration object`);
  const config = loaded as MeekoConfig;
  for (const [key, entries] of [["extends", config.extends], ["modules", config.modules], ["imports.serverDirs", config.imports?.serverDirs]] as const) {
    if (entries !== undefined && (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string" || !entry))) {
      throw new TypeError(`${file}: ${key} must be an array of nonempty paths`);
    }
  }
  const css = config.css as Record<string, unknown> | undefined;
  if (css !== undefined) {
    if (!css || typeof css !== "object" || Array.isArray(css)) throw new TypeError(`${file}: css must be an object`);
    if (css.scopeAttribute !== undefined && css.scopeAttribute !== "all" && css.scopeAttribute !== "matched") {
      throw new TypeError(`${file}: css.scopeAttribute must be "all" or "matched"`);
    }
  }
  // The build bakes `document` as JSON: a function titleTemplate fails here, not in production.
  normalizeDocumentConfig(config.document, `${file}: document`);
  const server = config.server as Record<string, unknown> | undefined;
  if (server !== undefined) {
    if (!server || typeof server !== "object" || !["node", "cloudflare", "deno", "bun"].includes(server.adapter as string)) {
      throw new TypeError(`${file}: server.adapter must be "node", "cloudflare", "deno" or "bun"`);
    }
    if (server.host !== undefined && (typeof server.host !== "string" || !server.host)) throw new TypeError(`${file}: server.host must be a nonempty string`);
    if (server.port !== undefined && (!Number.isInteger(server.port) || (server.port as number) < 0 || (server.port as number) > 65535)) {
      throw new TypeError(`${file}: server.port must be an integer between 0 and 65535`);
    }
    if (server.adapter === "cloudflare") {
      if (server.name !== undefined && (typeof server.name !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(server.name))) {
        throw new TypeError(`${file}: server.name must be a Worker name (lowercase letters, digits and dashes)`);
      }
      if (server.socketClassName !== undefined && (typeof server.socketClassName !== "string" || !/^[A-Za-z_$][\w$]*$/.test(server.socketClassName))) {
        throw new TypeError(`${file}: server.socketClassName must be a JavaScript class name`);
      }
      if (server.compatibilityDate !== undefined && (typeof server.compatibilityDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(server.compatibilityDate))) {
        throw new TypeError(`${file}: server.compatibilityDate must use YYYY-MM-DD`);
      }
      if (server.wrangler !== undefined && (!server.wrangler || typeof server.wrangler !== "object" || Array.isArray(server.wrangler))) {
        throw new TypeError(`${file}: server.wrangler must be an object of wrangler.jsonc fields`);
      }
    }
  }
  return config;
}

/**
 * Lee `extends`, `modules` e `imports.serverDirs` de la configuración sin ejecutarla, analizando el
 * archivo. Sólo reconoce arrays literales de cadenas; es lo que usa el editor en un workspace no
 * confiable. Los demás campos no se leen.
 *
 * @param projectRoot Carpeta del proyecto.
 * @returns Los campos estáticos encontrados, o `{}`.
 * @throws {TypeError} Si uno de esos campos no es un array literal de cadenas.
 * @example
 * ```ts
 * import { readMeekoConfigSync } from "@meekojs/meeko/build";
 *
 * const { extends: layers = [], imports } = readMeekoConfigSync(process.cwd());
 * const serverDirs = imports?.serverDirs ?? [];
 * ```
 */
export function readMeekoConfigSync(projectRoot: string): MeekoConfig {
  const file = ["meeko.config.ts", "meeko.config.mts", "meeko.config.js", "meeko.config.mjs"]
    .map((name) => resolve(projectRoot, name)).find(existsSync);
  if (!file) return {};
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const exported = source.statements.find(ts.isExportAssignment);
  const expression = exported?.expression;
  const config = expression && ts.isCallExpression(expression) ? expression.arguments[0] : expression;
  if (!config || !ts.isObjectLiteralExpression(config)) return {};
  const property = (node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined => {
    const item = node.properties.find((entry) => ts.isPropertyAssignment(entry) &&
      ((ts.isIdentifier(entry.name) && entry.name.text === name) || (ts.isStringLiteral(entry.name) && entry.name.text === name)));
    return item && ts.isPropertyAssignment(item) ? item.initializer : undefined;
  };
  const strings = (node: ts.ObjectLiteralExpression, name: string): readonly string[] | undefined => {
    const value = property(node, name);
    if (!value) return undefined;
    if (!ts.isArrayLiteralExpression(value) || value.elements.some((entry) => !ts.isStringLiteral(entry))) {
      throw new TypeError(`${file}: ${name} must be a static string array for editor discovery`);
    }
    return value.elements.map((entry) => (entry as ts.StringLiteral).text);
  };
  const imports = property(config, "imports");
  const serverDirs = imports && ts.isObjectLiteralExpression(imports) ? strings(imports, "serverDirs") : undefined;
  const extensions = strings(config, "extends");
  const modules = strings(config, "modules");
  return {
    ...(extensions ? { extends: extensions } : {}),
    ...(modules ? { modules } : {}),
    ...(serverDirs ? { imports: { serverDirs } } : {}),
  };
}

/**
 * Resuelve las fuentes del proyecto en orden (aplicación, `extends` y `modules`) y rechaza, antes
 * de descubrir rutas, las que salen del proyecto, no existen, no tienen `app/pages`, se repiten o
 * tienen un nombre no válido.
 *
 * @param projectRoot Carpeta del proyecto.
 * @param config Configuración ya cargada; si falta, se carga con {@link loadMeekoConfig}.
 * @returns Las fuentes, empezando por la aplicación.
 * @throws {Error} Si una fuente no es válida.
 * @example
 * ```ts
 * import { resolveConfigSources } from "@meekojs/meeko/build";
 *
 * const layers = (await resolveConfigSources(process.cwd())).filter((source) => source.kind !== "app");
 * ```
 */
export async function resolveConfigSources(projectRoot: string, config?: MeekoConfig): Promise<readonly ConfigSource[]> {
  config ??= await loadMeekoConfig(projectRoot);
  const root = resolve(projectRoot);
  const actualRoot = await realpath(root);
  const result: ConfigSource[] = [{ name: "app", root, kind: "app" }];
  const names = new Set(["app"]);
  const roots = new Set([actualRoot.toLowerCase()]);
  for (const [kind, entries] of [["layer", config.extends], ["module", config.modules]] as const) {
    for (const entry of entries ?? []) {
      const target = resolve(root, entry);
      if (!inside(root, target)) throw new Error(`${kind} ${entry} escapes project root ${root}`);
      let actualTarget: string;
      try { actualTarget = await realpath(target); }
      catch { throw new Error(`${kind} ${entry} does not exist: ${target}`); }
      if (!inside(actualRoot, actualTarget)) throw new Error(`${kind} ${entry} escapes project root ${root}`);
      if (roots.has(actualTarget.toLowerCase())) throw new Error(`Duplicate Meeko source root: ${target}`);
      const name = basename(target, extname(target));
      if (!/^[a-z][a-z0-9-]*$/.test(name) || names.has(name)) throw new Error(`Invalid or duplicate Meeko source name ${name}: ${target}`);
      try { if (!(await stat(resolve(target, "app", "pages"))).isDirectory()) throw new Error("not a directory"); }
      catch { throw new Error(`${kind} ${entry} has no app/pages directory: ${target}`); }
      roots.add(actualTarget.toLowerCase()); names.add(name);
      result.push({ name, root: target, kind });
    }
  }
  return result;
}

/**
 * Descubre las rutas de la aplicación y de los layers y módulos de `meeko.config.ts` en un solo
 * manifiesto. Las páginas de layers y módulos usan el shell del proyecto. Una colisión de URL falla.
 *
 * @param projectRoot Carpeta del proyecto.
 * @returns El manifiesto de rutas ordenado.
 * @throws {Error} Si una fuente no es válida o dos rutas colisionan.
 * @example
 * ```ts
 * import { discoverConfiguredRoutes } from "@meekojs/meeko/build";
 *
 * const routes = await discoverConfiguredRoutes(process.cwd());
 * console.log(routes.map((route) => route.id));
 * ```
 */
export async function discoverConfiguredRoutes(projectRoot: string): Promise<readonly RouteRecord[]> {
  const sources = await resolveConfigSources(projectRoot);
  return composeFrameworkRoutes({
    projectRoot,
    layers: sources.slice(1).map(({ name, root }) => ({ name, root })),
  });
}
