import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { composeFrameworkRoutes } from "./modules.js";
import { contentSecurityPolicy } from "../framework-server/csp.js";
import type { ContentSecurityPolicy } from "../framework-server/csp.js";
import { normalizeDocumentConfig, siteOrigin } from "./head.js";
import { resolveThemeConfig } from "./theme.js";
import type { RouteRecord } from "./router.js";
import type { MeekoConfig } from "./config-type.js";
import { isMeekoModule } from "./module.js";
import { classifyModuleEntry, resolveMeekoModules, resolvedDocument } from "./module-loader.js";
import type { ResolvedModules } from "./module-loader.js";

export type { MeekoConfig } from "./config-type.js";

/**
 * Una fuente de páginas y autoimports del proyecto: la aplicación, un layer de `layers` (o
 * `extends`) o, con `kind: "module"`, un layer que aportan los módulos: el que añade un módulo con
 * `meeko.addLayer` o una carpeta con `app/pages` listada en `modules`. La devuelve
 * {@link resolveConfigSources}.
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
  /** Tipo de fuente: `"layer"` para `layers` y `extends`, `"module"` para las que aportan los módulos. */
  readonly kind: "app" | "layer" | "module";
}

/** Options of `imports` that add autoimport folders, and the source folder each one lives in. */
const importDirectoryRoots = { appDirs: "app", sharedDirs: "shared", serverDirs: "server" } as const;

/** An option of `imports` that adds autoimport folders. */
export type ImportDirectoryOption = keyof typeof importDirectoryRoots;

/** The options of `imports` that add autoimport folders, in the order of the scopes they reach. */
export const importDirectoryOptions: readonly ImportDirectoryOption[] = ["appDirs", "sharedDirs", "serverDirs"];

/**
 * The folder of an `imports.appDirs`, `sharedDirs` or `serverDirs` entry with `/` separators and no
 * trailing slash (`"app/services"`), or `undefined` if it is not a relative path below the folder of
 * its option (`app/`, `shared/` or `server/`) without `.` or `..` segments.
 */
export function normalizeImportDirectory(option: ImportDirectoryOption, raw: string): string | undefined {
  const directory = raw.replaceAll("\\", "/").replace(/\/+$/, "");
  const parts = directory.split("/");
  if (parts[0] !== importDirectoryRoots[option] || parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) return undefined;
  return directory;
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
  // The content, not the mtime, names the module: two writes within one mtime tick would
  // otherwise load the first version again from the import cache.
  url.searchParams.set("v", createHash("sha256").update(await readFile(file)).digest("hex").slice(0, 16));
  let loaded: unknown;
  try { loaded = (await import(url.href) as { default?: unknown }).default; }
  catch (error) { throw new Error(`Cannot load ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) throw new TypeError(`${file} must export a Meeko configuration object`);
  const config = loaded as MeekoConfig;
  const imports = config.imports as unknown;
  if (imports !== undefined && !isPlainObject(imports)) throw new TypeError(`${file}: imports must be an object`);
  for (const [key, entries] of [
    ["layers", config.layers], ["extends", config.extends],
    ...importDirectoryOptions.map((option) => [`imports.${option}`, config.imports?.[option]] as const),
  ] as const) {
    if (entries !== undefined && (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string" || !entry))) {
      throw new TypeError(`${file}: ${key} must be an array of nonempty paths`);
    }
  }
  for (const option of importDirectoryOptions) {
    config.imports?.[option]?.forEach((entry, index) => {
      if (normalizeImportDirectory(option, entry) === undefined) {
        throw new TypeError(`${file}: imports.${option}[${index}] must be a relative path inside ${importDirectoryRoots[option]}/: ${entry}`);
      }
    });
  }
  const modules = config.modules as unknown;
  if (modules !== undefined) {
    const reference = (value: unknown): boolean => (typeof value === "string" && value !== "") || isMeekoModule(value);
    const options = (value: unknown): boolean => value === undefined || (typeof value === "object" && value !== null && !Array.isArray(value));
    if (!Array.isArray(modules) || modules.some((entry: unknown) => !(reference(entry)
      || (Array.isArray(entry) && entry.length >= 1 && entry.length <= 2 && reference(entry[0]) && options(entry[1]))))) {
      throw new TypeError(`${file}: modules must be an array of modules created with defineMeekoModule, package names or paths, or [module, options]`);
    }
  }
  const document = config.document as Record<string, unknown> | undefined;
  if (document !== undefined) {
    if (!document || typeof document !== "object" || Array.isArray(document)) throw new TypeError(`${file}: document must be an object`);
    if (document.lang !== undefined && typeof document.lang !== "string") throw new TypeError(`${file}: document.lang must be a string`);
    if (document.head !== undefined && (!document.head || typeof document.head !== "object" || Array.isArray(document.head))) {
      throw new TypeError(`${file}: document.head must be an object`);
    }
  }
  const css = config.css as Record<string, unknown> | undefined;
  if (css !== undefined) {
    if (!css || typeof css !== "object" || Array.isArray(css)) throw new TypeError(`${file}: css must be an object`);
    if (css.scopeAttribute !== undefined && css.scopeAttribute !== "all" && css.scopeAttribute !== "matched") {
      throw new TypeError(`${file}: css.scopeAttribute must be "all" or "matched"`);
    }
  }
  const dev = config.dev as Record<string, unknown> | undefined;
  if (dev !== undefined) {
    if (!dev || typeof dev !== "object" || Array.isArray(dev)) throw new TypeError(`${file}: dev must be an object`);
    if (dev.serverLogs !== undefined && typeof dev.serverLogs !== "boolean") throw new TypeError(`${file}: dev.serverLogs must be a boolean`);
  }
  // `document.theme` is what the build bakes from `theme`; the configuration has one place for it.
  if (document !== undefined && document.theme !== undefined) throw new TypeError(`${file}: document.theme is not an option of meeko.config.ts; use theme at the top level`);
  try { resolveThemeConfig(config.theme, `${file}: theme`); }
  catch (error) {
    // Before 1.4, `theme` could hold the options of a module with `configKey: "theme"`.
    if (error instanceof TypeError && error.message.includes(": unknown field ")) {
      throw new TypeError(`${error.message}. Since 1.4, theme is Meeko's own light/dark theme option; if these are the options of a module with meta.configKey "theme", give that module another configKey and move them there (see docs/migration-1.4.md)`, { cause: error });
    }
    throw error;
  }
  // The build bakes `document` as JSON: a function titleTemplate fails here, not in production.
  normalizeDocumentConfig(config.document, `${file}: document`);
  if (config.site !== undefined) siteOrigin(config.site, `${file}: site`);
  validateSiteFiles(config, file);
  const server = config.server as Record<string, unknown> | undefined;
  if (server !== undefined) {
    if (!server || typeof server !== "object" || !["node", "cloudflare", "deno", "bun", "static"].includes(server.adapter as string)) {
      throw new TypeError(`${file}: server.adapter must be "node", "cloudflare", "deno", "bun" or "static"`);
    }
    if (server.adapter === "static") validateStaticServer(server, file);
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
  executedConfigs.add(config);
  return config;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown, label: string, check?: (entry: string) => boolean): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry || (check !== undefined && !check(entry)))) {
    throw new TypeError(`${label} must be an array of nonempty strings${check ? " that start with /" : ""}`);
  }
}

function onlyFields(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  for (const name of Object.keys(value)) if (!fields.includes(name)) throw new TypeError(`${label}: unknown field ${name}`);
}

/** Checks `sitemap` and `robots`. */
function validateSiteFiles(config: MeekoConfig, file: string): void {
  const path = (entry: string): boolean => entry.startsWith("/") && !/[\s#?]/.test(entry);
  const sitemap = config.sitemap as unknown;
  if (sitemap !== undefined && typeof sitemap !== "boolean") {
    if (!isPlainObject(sitemap)) throw new TypeError(`${file}: sitemap must be a boolean or an object`);
    onlyFields(sitemap, ["exclude"], `${file}: sitemap`);
    stringList(sitemap.exclude, `${file}: sitemap.exclude`, path);
  }
  const robots = config.robots as unknown;
  if (robots !== undefined && typeof robots !== "boolean") {
    if (!isPlainObject(robots)) throw new TypeError(`${file}: robots must be a boolean or an object`);
    onlyFields(robots, ["allow", "disallow"], `${file}: robots`);
    stringList(robots.allow, `${file}: robots.allow`, path);
    stringList(robots.disallow, `${file}: robots.disallow`, path);
  }
}

/** Header names of RFC 9110 (a token), and values without line breaks or controls. */
const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const headerValue = /^[^\u0000-\u0008\u000a-\u001f\u007f]*$/;

/** Checks the options of `server: { adapter: "static" }`. */
function validateStaticServer(server: Record<string, unknown>, file: string): void {
  onlyFields(server, ["adapter", "contentSecurityPolicy", "headers", "headerFiles"], `${file}: server (static)`);
  const policy = server.contentSecurityPolicy;
  if (policy !== undefined) {
    if (!isPlainObject(policy)) throw new TypeError(`${file}: server.contentSecurityPolicy must be an object of directives`);
    // The same checks as the header itself, with the file in the message.
    try { contentSecurityPolicy(policy as ContentSecurityPolicy); }
    catch (error) { throw new TypeError(`${file}: server.${(error as Error).message}`); }
  }
  const headers = server.headers;
  if (headers !== undefined) {
    if (!isPlainObject(headers)) throw new TypeError(`${file}: server.headers must be an object of header values`);
    for (const [name, value] of Object.entries(headers)) {
      if (!headerName.test(name)) throw new TypeError(`${file}: server.headers has an invalid header name ${JSON.stringify(name)}`);
      if (name.toLowerCase() === "content-security-policy") throw new TypeError(`${file}: server.headers cannot set Content-Security-Policy; use server.contentSecurityPolicy, which adds the script hashes`);
      if (typeof value !== "string" || !headerValue.test(value)) throw new TypeError(`${file}: server.headers.${name} must be a string without line breaks`);
    }
  }
  const files = server.headerFiles;
  if (files !== undefined && (!Array.isArray(files) || files.some((entry) => entry !== "_headers" && entry !== "nginx"))) {
    throw new TypeError(`${file}: server.headerFiles must be an array of "_headers" and "nginx"`);
  }
}

/** Configurations that `loadMeekoConfig` executed: only their modules may run. */
const executedConfigs = new WeakSet<object>();

/**
 * Lee `layers`, `extends`, `modules` e `imports` (`appDirs`, `sharedDirs` y `serverDirs`) de la
 * configuración sin ejecutarla, analizando el archivo; es lo que usa el editor en un workspace no
 * confiable. `layers`, `extends` y las listas de `imports` deben ser arrays literales de cadenas
 * (`appDirs` y `sharedDirs` se leen desde 1.3.0); de `modules` sólo se leen las cadenas literales,
 * porque un módulo importado no se conoce sin ejecutar la configuración. Los demás campos no se
 * leen.
 *
 * @param projectRoot Carpeta del proyecto.
 * @returns Los campos estáticos encontrados, o `{}`.
 * @throws {TypeError} Si uno de esos campos no es un array literal de cadenas.
 * @example
 * ```ts
 * import { readMeekoConfigSync } from "@meekojs/meeko/build";
 *
 * const { layers = [], imports } = readMeekoConfigSync(process.cwd());
 * const serverDirs = imports?.serverDirs ?? [];
 * ```
 */
export function readMeekoConfigSync(projectRoot: string): MeekoConfig {
  const file = configFileOf(projectRoot);
  if (!file) return {};
  const config = staticConfigObject(file);
  if (!config) return {};
  const strings = (node: ts.ObjectLiteralExpression, name: string): readonly string[] | undefined => {
    const value = property(node, name);
    if (!value) return undefined;
    if (!ts.isArrayLiteralExpression(value) || value.elements.some((entry) => !ts.isStringLiteral(entry))) {
      throw new TypeError(`${file}: ${name} must be a static string array for editor discovery`);
    }
    return value.elements.map((entry) => (entry as ts.StringLiteral).text);
  };
  const imports = property(config, "imports");
  const importDirs: { -readonly [Option in ImportDirectoryOption]?: readonly string[] } = {};
  for (const option of importDirectoryOptions) {
    const entries = imports && ts.isObjectLiteralExpression(imports) ? strings(imports, option) : undefined;
    if (entries) importDirs[option] = entries;
  }
  const layers = strings(config, "layers");
  const extensions = strings(config, "extends");
  const moduleList = property(config, "modules");
  // Imported modules and [module, options] entries need the configuration to run; only strings are known.
  const modules = moduleList && ts.isArrayLiteralExpression(moduleList)
    ? moduleList.elements.filter(ts.isStringLiteral).map((entry) => entry.text)
    : undefined;
  return {
    ...(layers ? { layers } : {}),
    ...(extensions ? { extends: extensions } : {}),
    ...(modules ? { modules } : {}),
    ...(Object.keys(importDirs).length ? { imports: importDirs } : {}),
  };
}

/** `meeko.config.*` of a project, if there is one. */
function configFileOf(projectRoot: string): string | undefined {
  return ["meeko.config.ts", "meeko.config.mts", "meeko.config.js", "meeko.config.mjs"]
    .map((name) => resolve(projectRoot, name)).find(existsSync);
}

/** The object literal that a configuration file exports, read without running it. */
function staticConfigObject(file: string): ts.ObjectLiteralExpression | undefined {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const exported = source.statements.find(ts.isExportAssignment);
  const expression = exported?.expression;
  const config = expression && ts.isCallExpression(expression) ? expression.arguments[0] : expression;
  return config && ts.isObjectLiteralExpression(config) ? config : undefined;
}

/** The value of the property `name` of an object literal, when it is a plain assignment. */
function property(node: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const item = node.properties.find((entry) => ts.isPropertyAssignment(entry) &&
    ((ts.isIdentifier(entry.name) && entry.name.text === name) || (ts.isStringLiteral(entry.name) && entry.name.text === name)));
  return item && ts.isPropertyAssignment(item) ? item.initializer : undefined;
}

/**
 * Whether `theme` is on in `meeko.config.*`, read without running it, as the editor and `meeko
 * check` need it for `<MeekoThemeToggle>`: `false` without `theme`, `undefined` when it is not
 * known: without a configuration (the folder may be a layer with its own `package.json`, whose
 * application has the configuration) or when only running it tells (`theme: someVariable`, a
 * configuration that is no literal). Unknown gives no MEEK111; the component reports it when it
 * renders without `theme`.
 */
export function readThemeEnabledSync(projectRoot: string): boolean | undefined {
  const file = configFileOf(projectRoot);
  if (!file) return undefined;
  const config = staticConfigObject(file);
  if (!config) return undefined;
  const named = config.properties.some((entry) => entry.name !== undefined && (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) && entry.name.text === "theme");
  if (!named) return config.properties.some(ts.isSpreadAssignment) ? undefined : false;
  const value = property(config, "theme");
  if (!value) return undefined;
  if (value.kind === ts.SyntaxKind.TrueKeyword || ts.isObjectLiteralExpression(value)) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** The value of a literal (`true`, `"dark"`, `["light", "dark"]`, `{ … }`), or `undefined` for an expression. */
function literalValue(node: ts.Expression): { readonly value: unknown } | undefined {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literalValue(node.expression);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { value: false };
  if (ts.isStringLiteralLike(node)) return { value: node.text };
  if (ts.isNumericLiteral(node)) return { value: Number(node.text) };
  if (ts.isArrayLiteralExpression(node)) {
    const values: unknown[] = [];
    for (const element of node.elements) {
      const item = ts.isSpreadElement(element) ? undefined : literalValue(element);
      if (!item) return undefined;
      values.push(item.value);
    }
    return { value: values };
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value: Record<string, unknown> = {};
    for (const entry of node.properties) {
      if (!ts.isPropertyAssignment(entry) || !(ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name))) return undefined;
      const item = literalValue(entry.initializer);
      if (!item) return undefined;
      value[entry.name.text] = item.value;
    }
    return { value };
  }
  return undefined;
}

/**
 * `theme` of `meeko.config.*` as the editor reads it, without running the configuration: its value
 * when it is a literal (`true`, `{ themes: ["light", "dark", "sepia"] }`), `undefined` otherwise
 * (no configuration, no `theme`, or a value that only running it tells).
 */
export function readThemeOptionSync(projectRoot: string): unknown {
  const file = configFileOf(projectRoot);
  const config = file ? staticConfigObject(file) : undefined;
  const value = config && property(config, "theme");
  return value ? literalValue(value)?.value : undefined;
}

/**
 * Resuelve las fuentes del proyecto en orden (aplicación, `extends`, `layers`, las carpetas de
 * layer listadas en `modules` y los layers que añaden los módulos con `meeko.addLayer`) y rechaza,
 * antes de descubrir rutas, las que salen del proyecto, no existen, no tienen `app/pages`, se
 * repiten o tienen un nombre no válido. Los módulos sólo se ejecutan con una configuración que cargó
 * {@link loadMeekoConfig} (o sin `config`); con la de {@link readMeekoConfigSync}, no.
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
  // A string of modules that is not a module (a folder with app/pages, or a missing path) is
  // checked as the layer it was before 1.2, with the same errors.
  const folderModules = (config.modules ?? []).filter((entry): entry is string => typeof entry === "string"
    && classifyModuleEntry(root, entry).kind !== "module");
  const moduleLayers = executedConfigs.has(config) ? (await resolveMeekoModules(root, config)).layers : [];
  for (const [kind, entries, linked] of [
    ["layer", config.extends, false], ["layer", config.layers, false], ["module", folderModules, false], ["module", moduleLayers, true],
  ] as const) {
    for (const entry of entries ?? []) {
      const target = resolve(root, entry);
      if (!inside(root, target)) throw new Error(`${kind} ${entry} escapes project root ${root}`);
      let actualTarget: string;
      try { actualTarget = await realpath(target); }
      catch { throw new Error(`${kind} ${entry} does not exist: ${target}`); }
      // A module's layer may live in a linked package (pnpm) whose real path is outside the project.
      if (!linked && !inside(actualRoot, actualTarget)) throw new Error(`${kind} ${entry} escapes project root ${root}`);
      if (roots.has(actualTarget.toLowerCase())) throw new Error(`Duplicate Meeko source root: ${target}`);
      let name = basename(target, extname(target));
      if (linked) {
        // A module chooses its layer folder, not the project: derive a valid name that is not taken.
        const base = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^[^a-z]+/, "").replace(/-+$/, "") || "layer";
        name = base;
        for (let index = 2; names.has(name); index++) name = `${base}-${index}`;
      }
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
 * Descubre las rutas de la aplicación y de los layers de `meeko.config.ts` (también los que aportan
 * los módulos) en un solo manifiesto. Las páginas de los layers usan el shell del proyecto. Una
 * colisión de URL falla.
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

/** The executed configuration of a project and what its modules added. */
export async function loadConfiguredModules(projectRoot: string): Promise<{ readonly config: MeekoConfig; readonly modules: ResolvedModules }> {
  const config = await loadMeekoConfig(projectRoot);
  return { config, modules: await resolveMeekoModules(projectRoot, config) };
}

/**
 * The executed configuration with the modules applied: `document` holds the `<head>` entries of
 * the modules followed by those of `meeko.config.ts` (see `resolvedDocument`). The document
 * renderer reads `document` from here, not from `loadMeekoConfig`.
 */
export async function resolveMeekoConfig(projectRoot: string): Promise<MeekoConfig> {
  const { config, modules } = await loadConfiguredModules(projectRoot);
  const document = resolvedDocument(config, modules);
  return document === undefined ? config : { ...config, document };
}
