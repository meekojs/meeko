import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { MeekoConfig } from "./config-type.js";
import type { DocumentConfig, HeadInput } from "./head.js";
import { isMeekoModule } from "./module.js";
import type { MeekoHooks, MeekoModule, MeekoModuleContext, ModuleAutoImport, ModulePlugin } from "./module.js";

/**
 * Build-time half of the module system: it runs `defineMeekoModule` setups in Node and records
 * what they add. Nothing here reaches a runtime bundle; runtime code reads the result through
 * the generated virtual modules.
 */

/** How a string entry of `modules` resolves, without executing it. */
export type ModuleEntryTarget =
  | { readonly kind: "module"; readonly file: string }
  /** A folder with `app/pages` and no module entry: a layer kept for 1.x compatibility. */
  | { readonly kind: "layer"; readonly dir: string }
  | { readonly kind: "missing"; readonly path: string };

const moduleExtensions = [".ts", ".mts", ".js", ".mjs"] as const;

function isFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
}

function isDirectory(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

function isPathEntry(entry: string): boolean {
  return entry.startsWith(".") || entry.startsWith("/") || entry.startsWith("file:") || isAbsolute(entry);
}

/** The export of `exports` (or `main`) for the `import` condition, or undefined. */
function exportTarget(value: unknown, subpath: string): string | undefined {
  if (typeof value === "string") return subpath === "." ? value : undefined;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length && keys.every((key) => key.startsWith("."))) return exportTarget(record[subpath], ".");
  for (const condition of ["import", "node", "default"]) {
    if (condition in record) {
      const found = exportTarget(record[condition], ".");
      if (found) return found;
    }
  }
  return undefined;
}

function packageEntry(directory: string, subpath = "."): string | undefined {
  const file = join(directory, "package.json");
  if (!isFile(file)) return undefined;
  const metadata = JSON.parse(readFileSync(file, "utf8")) as { exports?: unknown; module?: unknown; main?: unknown };
  const target = metadata.exports !== undefined ? exportTarget(metadata.exports, subpath)
    : subpath === "." ? (typeof metadata.module === "string" ? metadata.module : typeof metadata.main === "string" ? metadata.main : undefined)
    : subpath;
  return target ? resolve(directory, target) : undefined;
}

/** Resolves a package specifier from the project, also for packages that only export `import`. */
function resolvePackage(root: string, specifier: string): string | undefined {
  try { return createRequire(join(root, "package.json")).resolve(specifier); }
  catch { /* ESM-only exports are resolved below. */ }
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  const subpath = parts.slice(specifier.startsWith("@") ? 2 : 1).join("/");
  for (let directory = resolve(root); ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", ...name.split("/"));
    if (isDirectory(candidate)) return packageEntry(candidate, subpath ? `./${subpath}` : ".");
    if (dirname(directory) === directory) return undefined;
  }
}

function moduleFileIn(directory: string): string | undefined {
  const fromPackage = packageEntry(directory);
  if (fromPackage) return fromPackage;
  return moduleExtensions.map((extension) => join(directory, `index${extension}`)).find(isFile);
}

/**
 * Classifies a string entry of `modules` from the file system, without executing anything: a
 * module file, a package, a folder with a module entry (`package.json` or `index.ts`), or a
 * folder with `app/pages` and no entry, which stays a layer during 1.x.
 */
export function classifyModuleEntry(projectRoot: string, entry: string): ModuleEntryTarget {
  const root = resolve(projectRoot);
  if (!isPathEntry(entry)) {
    const file = resolvePackage(root, entry);
    if (file) return { kind: "module", file };
    // Before 1.2 every entry was a path from the project root, also without "./" ("modules/auth").
    if (!isDirectory(resolve(root, entry))) return { kind: "missing", path: entry };
  }
  const target = entry.startsWith("file:") ? fileURLToPath(entry) : resolve(root, entry);
  if (isFile(target)) return { kind: "module", file: target };
  if (isDirectory(target)) {
    const file = moduleFileIn(target);
    if (file) return { kind: "module", file };
    if (isDirectory(join(target, "app", "pages"))) return { kind: "layer", dir: target };
    return { kind: "missing", path: target };
  }
  const withExtension = moduleExtensions.map((extension) => `${target}${extension}`).find(isFile);
  return withExtension ? { kind: "module", file: withExtension } : { kind: "missing", path: target };
}

/** The string entries of `modules` that are layer folders, in order. */
export function legacyLayerEntries(projectRoot: string, config: MeekoConfig): string[] {
  const result: string[] = [];
  for (const entry of config.modules ?? []) {
    const value = typeof entry === "string" ? entry : undefined;
    if (value !== undefined && classifyModuleEntry(projectRoot, value).kind === "layer") result.push(value);
  }
  return result;
}

const warnedLegacyEntries = new Set<string>();

/**
 * Prints, once per process and entry, the deprecation of a layer folder listed in `modules`.
 * `meeko dev`, `meeko build` and `meeko check` call it.
 */
export function warnLegacyLayerEntries(projectRoot: string, config: MeekoConfig, write: (text: string) => void = (text) => process.stderr.write(text)): void {
  for (const entry of legacyLayerEntries(projectRoot, config)) {
    const key = `${resolve(projectRoot)}\0${entry}`;
    if (warnedLegacyEntries.has(key)) continue;
    warnedLegacyEntries.add(key);
    write(`[meeko] Aviso: "${entry}" en modules de meeko.config.ts es una carpeta de layer (tiene app/pages y no es un módulo). Muévela a layers: ["${entry}"]; las carpetas en modules dejarán de funcionar en Meeko 2.0.\n`);
  }
}

// --- Version ranges -------------------------------------------------------------------------

function meekoVersion(): string {
  const metadata = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
  return metadata.version;
}

type Version = readonly [number, number, number];

function compare(left: Version, right: Version): number {
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index]! - right[index]!;
  return 0;
}

function comparatorMatches(version: Version, comparator: string): boolean {
  const match = /^(>=|<=|>|<|=|\^|~)?v?(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-[0-9A-Za-z.-]+)?$/.exec(comparator);
  if (!match) throw new Error(`Unsupported version range comparator: ${comparator}`);
  const [, operator = "", ...raw] = match;
  const parts = raw.map((part) => part === undefined || /^[xX*]$/.test(part) ? undefined : Number(part));
  const [major, minor, patch] = parts;
  if (major === undefined) return true;
  const low: Version = [major, minor ?? 0, patch ?? 0];
  // The first version above a partial version: 1.2 -> 1.3.0, 1 -> 2.0.0.
  const next: Version = minor === undefined ? [major + 1, 0, 0] : patch === undefined ? [major, minor + 1, 0] : [major, minor, patch + 1];
  switch (operator) {
    case ">=": return compare(version, low) >= 0;
    case ">": return compare(version, next) >= 0;
    case "<": return compare(version, low) < 0;
    case "<=": return compare(version, next) < 0;
    case "^": {
      const upper: Version = major > 0 || minor === undefined ? [major + 1, 0, 0] : minor > 0 || patch === undefined ? [0, minor + 1, 0] : [0, 0, patch + 1];
      return compare(version, low) >= 0 && compare(version, upper) < 0;
    }
    case "~": {
      const upper: Version = minor === undefined ? [major + 1, 0, 0] : [major, minor + 1, 0];
      return compare(version, low) >= 0 && compare(version, upper) < 0;
    }
    default: return compare(version, low) >= 0 && compare(version, next) < 0;
  }
}

/** Whether `version` satisfies an npm range: comparators joined by spaces, sets joined by `||`. */
export function satisfiesVersion(version: string, range: string): boolean {
  const parsed = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!parsed) throw new Error(`Invalid version: ${version}`);
  const current: Version = [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])];
  // Every comparator is evaluated, so an unsupported one fails even when another decides the result.
  const sets = range.split("||").map((set) => set.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1").split(/\s+/).filter(Boolean)
    .map((comparator) => comparatorMatches(current, comparator)));
  return sets.some((results) => results.every(Boolean));
}

// --- Resolution -----------------------------------------------------------------------------

/** A module-added autoimport with its origin resolved: a package specifier or an absolute file. */
export interface ResolvedModuleAutoImport {
  readonly name: string;
  readonly as: string;
  readonly from: string;
  /** `true` when `from` is a package specifier, not a file. */
  readonly specifier: boolean;
  readonly type: boolean;
  readonly scope: "app" | "client" | "server" | "shared";
}

/** A module-added app plugin. */
export interface ResolvedModulePlugin {
  readonly file: string;
  readonly mode: "client" | "server" | "universal";
  readonly options?: unknown;
  readonly module: string;
}

type PublicFileContents = string | Uint8Array | (() => string | Uint8Array | Promise<string | Uint8Array>);

/** Everything the modules of a configuration added, in the order they added it. */
export interface ResolvedModules {
  /** Names of the modules that ran, in order. */
  readonly names: readonly string[];
  /** Module files resolved from string entries; they never reach a browser bundle. */
  readonly entryFiles: readonly string[];
  readonly layers: readonly string[];
  readonly componentsDirs: readonly { readonly dir: string; readonly prefix: string }[];
  readonly autoImports: readonly ResolvedModuleAutoImport[];
  readonly autoImportsDirs: readonly { readonly dir: string; readonly scope: "app" | "server" | "shared" }[];
  readonly plugins: readonly ResolvedModulePlugin[];
  readonly serverMiddleware: readonly string[];
  readonly serverHandlers: readonly { readonly route: string; readonly file: string }[];
  readonly publicFiles: ReadonlyMap<string, PublicFileContents>;
  /** `<head>` entries of the modules, before `document.head` of the configuration. */
  readonly head: HeadInput | undefined;
  readonly vitePlugins: readonly object[];
  readonly viteExtenders: readonly ((config: Record<string, any>, context: { readonly command: "serve" | "build"; readonly ssr: boolean }) => void | Record<string, any>)[];
  /** Directories a module owns, for the client boundary of their `.server.ts` files. */
  readonly ownedDirectories: readonly string[];
  callHook<Name extends keyof MeekoHooks>(name: Name, ...context: Parameters<MeekoHooks[Name]>): Promise<void>;
}

const emptyModules: ResolvedModules = Object.freeze({
  names: [], entryFiles: [], layers: [], componentsDirs: [], autoImports: [], autoImportsDirs: [], plugins: [],
  serverMiddleware: [], serverHandlers: [], publicFiles: new Map(), head: undefined, vitePlugins: [], viteExtenders: [], ownedDirectories: [],
  callHook: async () => {},
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Merges plain objects recursively; later layers win, and arrays and other values are replaced. */
export function mergeModuleOptions(...layers: readonly unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const layer of layers) {
    if (layer === undefined) continue;
    if (!isPlainObject(layer)) throw new TypeError("Meeko module options must be plain objects");
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      const previous = result[key];
      result[key] = isPlainObject(previous) && isPlainObject(value) ? mergeModuleOptions(previous, value) : value;
    }
  }
  return result;
}

/** Concatenates the arrays of two head inputs; `title`, `titleTemplate` and attributes keep the later value. */
export function mergeHeadInput(first: HeadInput | undefined, second: HeadInput | undefined): HeadInput | undefined {
  if (!first) return second;
  if (!second) return first;
  const result: HeadInput = { ...first, ...second };
  for (const key of ["meta", "link", "script", "style"] as const) {
    const merged = [...first[key] ?? [], ...second[key] ?? []];
    if (merged.length) (result as Record<string, unknown>)[key] = merged;
  }
  for (const key of ["htmlAttrs", "bodyAttrs"] as const) {
    if (first[key] || second[key]) result[key] = { ...first[key], ...second[key] };
  }
  return result;
}

function toPath(root: string, value: string | URL, what: string, module: string): string {
  if (value instanceof URL) {
    if (value.protocol !== "file:") throw new TypeError(`Meeko module ${module}: ${what} must be a file URL or a path`);
    return fileURLToPath(value);
  }
  if (typeof value !== "string" || !value) throw new TypeError(`Meeko module ${module}: ${what} must be a nonempty path`);
  if (value.startsWith("file:")) return fileURLToPath(value);
  return resolve(root, value);
}

export function pluginMode(file: string, mode: ModulePlugin["mode"]): "client" | "server" | "universal" {
  if (mode !== undefined) {
    if (mode !== "client" && mode !== "server" && mode !== "universal") throw new TypeError(`Invalid plugin mode ${String(mode)}: use "client", "server" or "universal"`);
    return mode;
  }
  if (/\.client\.[cm]?[jt]s$/.test(file)) return "client";
  if (/\.server\.[cm]?[jt]s$/.test(file)) return "server";
  return "universal";
}

function pascalCase(value: string): string {
  return value.split(/[^A-Za-z0-9]+/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}

function normalizePublicPath(path: string, module: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/");
  if (!normalized || parts.some((part) => !part || part === "." || part === "..")) {
    throw new TypeError(`Meeko module ${module}: invalid public file path ${path}`);
  }
  return parts.join("/");
}

type ModuleEntry = NonNullable<MeekoConfig["modules"]>[number];

async function loadModule(root: string, entry: ModuleEntry): Promise<{ module: MeekoModule<object>; inline: unknown; file?: string } | undefined> {
  const [reference, inline] = Array.isArray(entry) ? entry as readonly [unknown, unknown] : [entry, undefined];
  if (isMeekoModule(reference)) return { module: reference, inline };
  if (typeof reference !== "string") throw new TypeError("Each entry of modules must be a module created with defineMeekoModule, a package name or path, or [module, options]");
  const target = classifyModuleEntry(root, reference);
  if (target.kind === "layer") {
    // A layer folder in `modules` stays a layer during 1.x; `[folder, options]` has no module to receive the options.
    if (inline !== undefined) throw new TypeError(`modules entry ${reference} is a layer folder, which takes no options; move it to layers`);
    return undefined;
  }
  if (target.kind === "missing") throw new Error(`Meeko module ${reference} not found: ${target.path}`);
  let loaded: unknown;
  try { loaded = (await import(pathToFileURL(target.file).href) as { default?: unknown }).default; }
  catch (error) { throw new Error(`Cannot load Meeko module ${reference}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  if (!isMeekoModule(loaded)) throw new TypeError(`${target.file} must default-export defineMeekoModule(...)`);
  return { module: loaded, inline, file: target.file };
}

async function runModules(root: string, config: MeekoConfig, dev: boolean): Promise<ResolvedModules> {
  if (!config.modules?.length) return emptyModules;
  const names: string[] = [];
  const entryFiles: string[] = [];
  const layers: string[] = [];
  const componentsDirs: Array<{ dir: string; prefix: string }> = [];
  const autoImports: ResolvedModuleAutoImport[] = [];
  const autoImportsDirs: Array<{ dir: string; scope: "app" | "server" | "shared" }> = [];
  const plugins: ResolvedModulePlugin[] = [];
  const serverMiddleware: string[] = [];
  const serverHandlers: Array<{ route: string; file: string }> = [];
  const publicFiles = new Map<string, PublicFileContents>();
  let head: HeadInput | undefined;
  const vitePlugins: object[] = [];
  const viteExtenders: Array<ResolvedModules["viteExtenders"][number]> = [];
  const ownedDirectories = new Set<string>();
  const hooks = new Map<keyof MeekoHooks, Array<(...args: never[]) => unknown>>();
  const version = meekoVersion();
  for (const entry of config.modules) {
    const loaded = await loadModule(root, entry);
    if (!loaded) continue;
    const { module, inline, file } = loaded;
    const name = module.meta.name;
    if (names.includes(name)) throw new Error(`Meeko module ${name} is listed more than once`);
    names.push(name);
    if (file) { entryFiles.push(file); ownedDirectories.add(dirname(file)); }
    const range = module.meta.compatibility?.meeko;
    if (range !== undefined && !satisfiesVersion(version, range)) {
      throw new Error(`Meeko module ${name} requires Meeko ${range}; this project uses ${version}`);
    }
    const configKey = module.meta.configKey;
    const configured = configKey === undefined ? undefined : (config as Record<string, unknown>)[configKey];
    const options = mergeModuleOptions(module.defaults, configured, inline);
    const path = (value: string | URL, what: string): string => toPath(root, value, what, name);
    const existingFile = (value: string | URL, what: string): string => {
      const file = path(value, what);
      if (!isFile(file)) throw new Error(`Meeko module ${name}: ${what} ${file} does not exist`);
      ownedDirectories.add(dirname(file));
      return file;
    };
    const existingDirectory = (value: string | URL, what: string): string => {
      const directory = path(value, what);
      if (!isDirectory(directory)) throw new Error(`Meeko module ${name}: ${what} ${directory} is not a directory`);
      ownedDirectories.add(directory);
      return directory;
    };
    const context: MeekoModuleContext = Object.freeze({
      rootDir: root,
      dev,
      config,
      hooks: Object.freeze({
        hook<Name extends keyof MeekoHooks>(hookName: Name, handler: MeekoHooks[Name]): () => void {
          if (typeof handler !== "function") throw new TypeError(`Meeko module ${name}: hook ${hookName} requires a function`);
          const list = hooks.get(hookName) ?? [];
          hooks.set(hookName, list);
          const registered = handler as (...args: never[]) => unknown;
          list.push(registered);
          return () => { const index = list.indexOf(registered); if (index >= 0) list.splice(index, 1); };
        },
      }),
      addLayer(dir: string | URL) { layers.push(existingDirectory(dir, "layer")); },
      addComponentsDir(dir: string | URL, componentOptions?: { readonly prefix?: string }) {
        const prefix = componentOptions?.prefix === undefined ? "" : pascalCase(componentOptions.prefix);
        if (componentOptions?.prefix !== undefined && !/^[A-Z][A-Za-z0-9]*$/.test(prefix)) throw new TypeError(`Meeko module ${name}: invalid component prefix ${componentOptions.prefix}`);
        componentsDirs.push({ dir: existingDirectory(dir, "components directory"), prefix });
      },
      addAutoImports(entries: ModuleAutoImport | readonly ModuleAutoImport[]) {
        for (const item of (Array.isArray(entries) ? entries : [entries]) as readonly ModuleAutoImport[]) {
          if (!item || typeof item.name !== "string" || !/^[A-Za-z_$][\w$]*$/.test(item.name)) throw new TypeError(`Meeko module ${name}: invalid autoimport name ${String(item?.name)}`);
          const as = item.as ?? item.name;
          if (!/^[A-Za-z_$][\w$]*$/.test(as)) throw new TypeError(`Meeko module ${name}: invalid autoimport alias ${as}`);
          const scope = item.scope ?? "app";
          if (!["app", "client", "server", "shared"].includes(scope)) throw new TypeError(`Meeko module ${name}: invalid autoimport scope ${scope}`);
          const from = item.from instanceof URL || item.from.startsWith("file:") || item.from.startsWith(".") || isAbsolute(item.from)
            ? existingFile(item.from, `autoimport ${as}`) : item.from;
          autoImports.push({ name: item.name, as, from, specifier: from === item.from && !isAbsolute(from), type: item.type === true, scope });
        }
      },
      addAutoImportsDir(dir: string | URL, dirOptions: { readonly scope: "app" | "server" | "shared" }) {
        const scope = dirOptions?.scope;
        if (scope !== "app" && scope !== "server" && scope !== "shared") throw new TypeError(`Meeko module ${name}: addAutoImportsDir requires scope "app", "server" or "shared"`);
        autoImportsDirs.push({ dir: existingDirectory(dir, "autoimports directory"), scope });
      },
      addPlugin(plugin: ModulePlugin | string | URL) {
        const definition: ModulePlugin = typeof plugin === "string" || plugin instanceof URL ? { src: plugin } : plugin;
        const pluginFile = existingFile(definition.src, "plugin");
        plugins.push({ file: pluginFile, mode: pluginMode(pluginFile, definition.mode), ...(definition.options === undefined ? {} : { options: definition.options }), module: name });
      },
      addServerMiddleware(middleware: string | URL) { serverMiddleware.push(existingFile(middleware, "server middleware")); },
      addServerHandler(handler) {
        if (typeof handler?.route !== "string" || !handler.route.startsWith("/")) throw new TypeError(`Meeko module ${name}: server handler route must start with /`);
        if (serverHandlers.some((existing) => existing.route === handler.route)) throw new Error(`Meeko module ${name}: duplicate server handler for ${handler.route}`);
        serverHandlers.push({ route: handler.route, file: existingFile(handler.handler, `server handler ${handler.route}`) });
      },
      addPublicFile(publicPath: string, contents: PublicFileContents) {
        const key = normalizePublicPath(publicPath, name);
        if (publicFiles.has(key)) throw new Error(`Meeko module ${name}: public file ${key} is already added`);
        if (typeof contents !== "string" && typeof contents !== "function" && !(contents instanceof Uint8Array)) throw new TypeError(`Meeko module ${name}: public file ${key} needs a string, bytes or a function`);
        publicFiles.set(key, contents);
      },
      addHead(input: HeadInput) {
        if (!input || typeof input !== "object") throw new TypeError(`Meeko module ${name}: addHead requires a head object`);
        head = mergeHeadInput(head, input);
      },
      addVitePlugin(plugin: object | readonly object[]) {
        for (const item of (Array.isArray(plugin) ? plugin : [plugin]) as readonly object[]) vitePlugins.push(item);
      },
      extendViteConfig(extend) {
        if (typeof extend !== "function") throw new TypeError(`Meeko module ${name}: extendViteConfig requires a function`);
        viteExtenders.push(extend);
      },
      warn(message: string) { process.stderr.write(`[meeko] ${name}: ${message}\n`); },
    } satisfies MeekoModuleContext);
    try { await module.setup(options as never, context); }
    catch (error) { throw new Error(`Meeko module ${name} failed during setup: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  }
  const resolved: ResolvedModules = {
    names, entryFiles, layers, componentsDirs, autoImports, autoImportsDirs, plugins, serverMiddleware, serverHandlers,
    publicFiles, head, vitePlugins, viteExtenders, ownedDirectories: [...ownedDirectories],
    async callHook(hookName, ...args) {
      for (const handler of [...hooks.get(hookName) ?? []]) await (handler as (...values: unknown[]) => unknown)(...args);
    },
  };
  await resolved.callHook("ready");
  return resolved;
}

let developmentMode = false;

/** `meeko dev` sets this before loading anything, so every resolution in the process sees `dev: true`. */
export function setModuleDevelopmentMode(dev: boolean): void {
  developmentMode = dev;
}

const resolutions = new WeakMap<object, Map<string, Promise<ResolvedModules>>>();

/**
 * Runs the modules of an executed configuration once per configuration object, project and
 * mode, and returns what they added. A configuration file that changes is a new object
 * (`loadMeekoConfig` imports it again), so its modules run again.
 */
export function resolveMeekoModules(projectRoot: string, config: MeekoConfig, options: { readonly dev?: boolean } = {}): Promise<ResolvedModules> {
  const root = resolve(projectRoot);
  const dev = options.dev ?? developmentMode;
  let byKey = resolutions.get(config);
  if (!byKey) { byKey = new Map(); resolutions.set(config, byKey); }
  const key = `${dev ? "dev" : "build"}\0${root}`;
  let pending = byKey.get(key);
  if (!pending) {
    pending = runModules(root, config, dev);
    byKey.set(key, pending);
    // A failed setup is retried by the next caller, after the cause is fixed.
    pending.catch(() => { if (byKey.get(key) === pending) byKey.delete(key); });
  }
  return pending;
}

/**
 * The document of every page: `document` of the configuration after the `<head>` entries of the
 * modules (arrays concatenated, the configuration's title and attributes win).
 */
export function resolvedDocument(config: MeekoConfig, modules: ResolvedModules): DocumentConfig | undefined {
  const head = mergeHeadInput(modules.head, config.document?.head);
  if (!head && config.document === undefined) return undefined;
  return { ...config.document, ...(head ? { head } : {}) };
}

/** Module-resolved paths are absolute; a key for a generated import is project-relative when possible. */
export function importSpecifier(projectRoot: string, file: string): string {
  const path = relative(resolve(projectRoot), file);
  if (path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)) return `/${path.replaceAll("\\", "/")}`;
  return file.replaceAll("\\", "/");
}

/** Public name of a module-added plugin in error messages. */
export function pluginName(projectRoot: string, file: string): string {
  const path = relative(resolve(projectRoot), file).replaceAll("\\", "/");
  return path.startsWith("../") || isAbsolute(path) ? basename(file, extname(file)) : path;
}
