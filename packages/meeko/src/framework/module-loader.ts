import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { RouteRecord } from "../app/runtime/router";
import type { MeekoConfig } from "../modules/define-meeko-config";
import type { MeekoHooks, MeekoModule, MeekoModuleContext, ModuleAutoImport, ModulePlugin, ModulePublicFileOptions } from "../modules/define-meeko-module";
import type { DocumentConfig, DocumentHead, HeadInput } from "../shared/head";

import { isMeekoModule } from "../modules/define-meeko-module";
import { meekoEnv } from "../server/runtime/env";
import { normalizeHeadInput, resolveDocumentConfig, siteOrigin } from "../shared/head";
import { normalizeComponentExcludes } from "./component-exclusions";
import { validateHeaderValues } from "./header-values";

/**
 * Build-time half of the module system: it runs `defineMeekoModule` setups in Node and records
 * what they add. Nothing here reaches a runtime bundle; runtime code reads the result through
 * the generated virtual modules.
 */

/** How a string entry of `modules` resolves, without executing it. */
export type ModuleEntryTarget =
  /** `specifier` is the package specifier that resolved, `<package>/module` when the package exports it. */
  | { readonly kind: "module"; readonly file: string; readonly specifier?: string }
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

/** The package name and the subpath (`""` for the root) of a bare specifier. */
function splitSpecifier(specifier: string): { readonly name: string; readonly subpath: string } {
  const parts = specifier.split("/");
  const scoped = specifier.startsWith("@");
  return { name: (scoped ? parts.slice(0, 2) : parts.slice(0, 1)).join("/"), subpath: parts.slice(scoped ? 2 : 1).join("/") };
}

/** The folder of the package `name` installed for `root`, searching `node_modules` upwards. */
function installedPackageDirectory(root: string, name: string): string | undefined {
  for (let directory = resolve(root); ; directory = dirname(directory)) {
    const candidate = join(directory, "node_modules", ...name.split("/"));
    if (isDirectory(candidate)) return candidate;
    if (dirname(directory) === directory) return undefined;
  }
}

function readManifest(directory: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

/** Resolves a package specifier from the project, also for packages that only export `import`. */
function resolvePackage(root: string, specifier: string): string | undefined {
  try { return createRequire(join(root, "package.json")).resolve(specifier); }
  catch { /* ESM-only exports are resolved below. */ }
  const { name, subpath } = splitSpecifier(specifier);
  const directory = installedPackageDirectory(root, name);
  return directory ? packageEntry(directory, subpath ? `./${subpath}` : ".") : undefined;
}

/**
 * The specifier of the module of a package entry: `<specifier>/module` when the package exports
 * that subpath in `exports` (as `@meekojs/i18n`, whose root is its runtime, and
 * `@meekojs/meeko/i18n`), or the specifier itself, whose default export is then the module.
 */
export function moduleSpecifierOf(projectRoot: string, specifier: string): string {
  const { name, subpath } = splitSpecifier(specifier);
  const directory = installedPackageDirectory(projectRoot, name);
  const exports = directory ? readManifest(directory)?.exports : undefined;
  if (!exports || typeof exports !== "object" || Array.isArray(exports)) return specifier;
  const key = subpath ? `./${subpath}/module` : "./module";
  return Object.hasOwn(exports, key) ? `${specifier}/module` : specifier;
}

/** Keyword of `package.json` that marks a package as a Meeko module, for the editor and the messages. */
export const moduleKeyword = "meeko-module";

/**
 * The dependencies of the project's `package.json` (all of its dependency fields) that are
 * installed and have the keyword `meeko-module`, sorted. Nothing is executed.
 */
export function installedModulePackageNames(projectRoot: string): string[] {
  const root = resolve(projectRoot);
  const manifest = readManifest(root);
  if (!manifest) return [];
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const value = manifest[field];
    if (value && typeof value === "object" && !Array.isArray(value)) for (const name of Object.keys(value)) names.add(name);
  }
  return [...names].filter((name) => {
    const directory = installedPackageDirectory(root, name);
    const keywords = directory ? readManifest(directory)?.keywords : undefined;
    return Array.isArray(keywords) && keywords.includes(moduleKeyword);
  }).sort();
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
    const specifier = moduleSpecifierOf(root, entry);
    const file = resolvePackage(root, specifier);
    if (file) return { kind: "module", file, specifier };
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

/** The name of the project's configuration file, for the messages. */
function configFileName(projectRoot: string): string {
  return basename(["meeko.config.ts", "meeko.config.mts", "meeko.config.js", "meeko.config.mjs"].map((name) => join(resolve(projectRoot), name)).find(isFile) ?? "meeko.config.ts");
}

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

declare const __MEEKO_BUNDLED_VERSION__: string | undefined;

function meekoVersion(): string {
  // A single-file language server no longer has this module's package-relative URL.
  if (typeof __MEEKO_BUNDLED_VERSION__ === "string") return __MEEKO_BUNDLED_VERSION__;
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
  if (!match) throw new Error(`Comparador de rango de versiones no admitido: ${comparator}`);
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
  if (!parsed) throw new Error(`Versión no válida: ${version}`);
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
  readonly componentOnly: boolean;
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
  readonly componentsDirs: readonly { readonly dir: string; readonly prefix: string; readonly exclude?: readonly string[] }[];
  /** Named layouts of `addLayout`, in the order the modules add them. */
  readonly layouts: readonly { readonly name: string; readonly file: string; readonly module: string }[];
  /** Route manifest transforms of `extendRoutes`, in the order the modules add them. */
  readonly routeExtenders: readonly { readonly module: string; readonly extend: (routes: readonly RouteRecord[]) => readonly RouteRecord[] }[];
  readonly autoImports: readonly ResolvedModuleAutoImport[];
  readonly autoImportsDirs: readonly { readonly dir: string; readonly scope: "app" | "server" | "shared" }[];
  readonly plugins: readonly ResolvedModulePlugin[];
  readonly serverMiddleware: readonly string[];
  readonly serverHandlers: readonly { readonly route: string; readonly file: string }[];
  readonly publicFiles: ReadonlyMap<string, PublicFileContents>;
  /** The response headers of the public files that `addPublicFile` gives some, by path. */
  readonly publicFileHeaders: ReadonlyMap<string, Readonly<Record<string, string>>>;
  readonly stylesheets: readonly string[];
  readonly typeTemplates: ReadonlyMap<string, string>;
  /** `<head>` entries of the modules, before `document.head` of the configuration. */
  readonly head: HeadInput | undefined;
  readonly vitePlugins: readonly object[];
  readonly viteExtenders: readonly ((config: Record<string, any>, context: { readonly command: "serve" | "build"; readonly ssr: boolean }) => void | Record<string, any>)[];
  /** Directories a module owns, for the client boundary of their `.server.ts` files. */
  readonly ownedDirectories: readonly string[];
  callHook<Name extends keyof MeekoHooks>(name: Name, ...context: Parameters<MeekoHooks[Name]>): Promise<void>;
}

const emptyModules: ResolvedModules = Object.freeze({
  names: [], entryFiles: [], layers: [], componentsDirs: [], layouts: [], routeExtenders: [], autoImports: [], autoImportsDirs: [], plugins: [],
  serverMiddleware: [], serverHandlers: [], publicFiles: new Map(), publicFileHeaders: new Map(), stylesheets: [], typeTemplates: new Map(), head: undefined, vitePlugins: [], viteExtenders: [], ownedDirectories: [],
  callHook: async () => {},
});

/**
 * The keys of `MeekoConfig` itself, which `meta.configKey` cannot take: the module would read
 * Meeko's own option as its options, and its augmentation of `MeekoConfig` would clash with
 * Meeko's type. `satisfies` keeps the list in step with the interface.
 */
const ownConfigKeys = Object.keys({
  layers: true, extends: true, modules: true, imports: true, components: true, server: true, css: true, document: true,
  dev: true, site: true, sitemap: true, robots: true, theme: true, alias: true, viewTransitions: true,
  devtools: true,
} satisfies Record<keyof MeekoConfig, true>);

/** Version of Meeko that added each key of `ownConfigKeys` after 1.2, for the message. */
const ownConfigKeySince: Readonly<Record<string, string>> = {
  dev: "1.3", site: "1.3", sitemap: "1.3", robots: "1.3", theme: "1.4", alias: "1.5", viewTransitions: "1.7", devtools: "1.8",
};

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
    if (!isPlainObject(layer)) throw new TypeError("Las opciones de un módulo de Meeko deben ser objetos planos");
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
    if (value.protocol !== "file:") throw new TypeError(`Módulo de Meeko ${module}: ${what} debe ser una URL file: o una ruta`);
    return fileURLToPath(value);
  }
  if (typeof value !== "string" || !value) throw new TypeError(`Módulo de Meeko ${module}: ${what} debe ser una ruta no vacía`);
  if (value.startsWith("file:")) return fileURLToPath(value);
  return resolve(root, value);
}

export function pluginMode(file: string, mode: ModulePlugin["mode"]): "client" | "server" | "universal" {
  if (mode !== undefined) {
    if (mode !== "client" && mode !== "server" && mode !== "universal") throw new TypeError(`Modo de plugin no válido ${String(mode)}: use "client", "server" o "universal"`);
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
    throw new TypeError(`Módulo de Meeko ${module}: ruta de archivo público no válida ${path}`);
  }
  return parts.join("/");
}

type ModuleEntry = NonNullable<MeekoConfig["modules"]>[number];

/** The closest name of `candidates` to `value` when it looks like a typo, as for the keys of the configuration. */
function closestName(value: string, candidates: readonly string[]): string | undefined {
  let suggestion: string | undefined;
  let best = (value.length <= 3 ? 1 : Math.max(2, Math.floor(value.length / 3))) + 1;
  for (const candidate of candidates) {
    const distance = candidate.toLowerCase() === value.toLowerCase() ? 0 : editDistance(value, candidate);
    if (distance < best) { best = distance; suggestion = candidate; }
  }
  return suggestion;
}

/** Imports the module of a resolved entry; `reference` names it in the errors. */
async function importModule(file: string, reference: string, isPackage: boolean): Promise<MeekoModule<object>> {
  let loaded: unknown;
  try { loaded = (await import(pathToFileURL(file).href) as { default?: unknown }).default; }
  catch (error) { throw new Error(`No se puede cargar el módulo de Meeko ${reference}: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  if (!isMeekoModule(loaded)) {
    throw new TypeError(isPackage
      ? `El paquete ${reference} no es un módulo de Meeko: ${file} debe exportar por defecto defineMeekoModule(...), en su subpath ./module o en su raíz`
      : `${file} debe exportar por defecto defineMeekoModule(...)`);
  }
  return loaded;
}

interface LoadedModule {
  readonly module: MeekoModule<object>;
  readonly inline: unknown;
  readonly file?: string;
  /** The string of `modules` that named the module, if it was not imported. */
  readonly reference?: string;
  /** `object` for an imported module, `tuple` for `[module, options]`. */
  readonly deprecated?: "object" | "tuple";
}

async function loadModule(root: string, entry: ModuleEntry): Promise<LoadedModule | undefined> {
  const tuple = Array.isArray(entry);
  const [reference, inline] = tuple ? entry as readonly [unknown, unknown] : [entry, undefined];
  if (isMeekoModule(reference)) return { module: reference, inline, deprecated: tuple ? "tuple" : "object" };
  if (typeof reference !== "string") throw new TypeError("Cada entrada de modules debe ser el nombre de un paquete o la ruta de un módulo creado con defineMeekoModule");
  const target = classifyModuleEntry(root, reference);
  if (target.kind === "layer") {
    // A layer folder in `modules` stays a layer during 1.x; `[folder, options]` has no module to receive the options.
    if (inline !== undefined) throw new TypeError(`La entrada ${reference} de modules es una carpeta de layer, que no admite opciones; muévala a layers`);
    return undefined;
  }
  if (target.kind === "missing") {
    if (isPathEntry(reference)) throw new Error(`No se encuentra el módulo de Meeko ${reference}: ${target.path} no existe`);
    const suggestion = closestName(reference, installedModulePackageNames(root));
    throw new Error(`No se encuentra el módulo de Meeko ${reference}: no es un paquete instalado ni una ruta del proyecto. ${suggestion === undefined
      ? `Instale el paquete (pnpm add ${reference}) o escriba la ruta de un módulo con ./`
      : `¿Quisiste decir ${JSON.stringify(suggestion)}?`}`);
  }
  const module = await importModule(target.file, reference, target.specifier !== undefined);
  return { module, inline, file: target.file, reference, ...(tuple ? { deprecated: "tuple" as const } : {}) };
}

const warnedDeprecatedEntries = new Set<string>();

/**
 * The deprecation (`MEEK126`) of an imported module or a `[module, options]` entry: the message
 * names the string to write in `modules` and the key of the options. `null` for the entries in
 * the documented form.
 */
export function deprecatedModuleEntryMessage(projectRoot: string, loaded: Pick<LoadedModule, "module" | "inline" | "reference" | "deprecated">, index: number): string | null {
  if (!loaded.deprecated) return null;
  const { name, configKey } = loaded.module.meta;
  // An imported module is named by its package when that name resolves; otherwise by its path.
  const reference = loaded.reference
    ?? (!isPathEntry(name) && classifyModuleEntry(projectRoot, name).kind === "module" ? name : undefined);
  const entry = reference === undefined ? "<ruta del módulo, como ./modules/hello>" : reference;
  const form = loaded.deprecated === "tuple" ? `[módulo, opciones] con el módulo ${name}` : `el módulo importado ${name}`;
  const hasOptions = loaded.inline !== undefined && Object.keys(loaded.inline as object).length > 0;
  const target = configKey === undefined
    ? `modules: [${JSON.stringify(entry)}]${hasOptions ? ". El módulo no declara meta.configKey, así que sus opciones sólo caben en [módulo, opciones] durante 1.x: pida a su autor una configKey" : ""}`
    : `modules: [${JSON.stringify(entry)}] y sus opciones en ${configKey}: { … }`;
  return `[meeko] Aviso MEEK126: modules[${index}] de ${configFileName(projectRoot)} usa ${form}, obsoleto desde 1.8. Escríbalo por su nombre: ${target}. `
    + "Los módulos importados y [módulo, opciones] siguen funcionando en 1.x y dejarán de hacerlo en Meeko 2.0.\n";
}

/**
 * Finds, among the installed module packages that are not in `modules`, the one whose
 * `meta.configKey` is `key`. It imports their modules (never runs a setup); a package that fails
 * to load is skipped.
 */
async function unlistedModuleForKey(root: string, key: string, listed: readonly string[]): Promise<string | undefined> {
  for (const name of installedModulePackageNames(root)) {
    if (listed.includes(name)) continue;
    const target = classifyModuleEntry(root, name);
    if (target.kind !== "module") continue;
    try {
      const module = await importModule(target.file, name, true);
      if (module.meta.configKey === key && !listed.includes(module.meta.name)) return name;
    } catch { /* Not a loadable module: it cannot own the key. */ }
  }
  return undefined;
}

async function runModules(root: string, config: MeekoConfig, dev: boolean): Promise<ResolvedModules> {
  if (!config.modules?.length) {
    await warnConfigKeys(root, config, [], []);
    return emptyModules;
  }
  const configKeys: string[] = [];
  const configKeyOwners = new Map<string, string>();
  const names: string[] = [];
  const entryFiles: string[] = [];
  const layers: string[] = [];
  const componentsDirs: Array<{ dir: string; prefix: string; exclude?: readonly string[] }> = [];
  const layouts: Array<{ name: string; file: string; module: string }> = [];
  const routeExtenders: Array<ResolvedModules["routeExtenders"][number]> = [];
  const autoImports: ResolvedModuleAutoImport[] = [];
  const autoImportsDirs: Array<{ dir: string; scope: "app" | "server" | "shared" }> = [];
  const plugins: ResolvedModulePlugin[] = [];
  const serverMiddleware: string[] = [];
  const serverHandlers: Array<{ route: string; file: string }> = [];
  const publicFiles = new Map<string, PublicFileContents>();
  const publicFileHeaders = new Map<string, Readonly<Record<string, string>>>();
  const stylesheets: string[] = [];
  const typeTemplates = new Map<string, string>();
  let head: HeadInput | undefined;
  const vitePlugins: object[] = [];
  const viteExtenders: Array<ResolvedModules["viteExtenders"][number]> = [];
  const ownedDirectories = new Set<string>();
  const hooks = new Map<keyof MeekoHooks, Array<(...args: never[]) => unknown>>();
  const version = meekoVersion();
  for (const [index, entry] of config.modules.entries()) {
    const loaded = await loadModule(root, entry);
    if (!loaded) continue;
    const { module, inline, file } = loaded;
    const name = module.meta.name;
    if (names.includes(name)) throw new Error(`El módulo de Meeko ${name} aparece más de una vez`);
    names.push(name);
    const deprecation = deprecatedModuleEntryMessage(root, loaded, index);
    const warningKey = `${root}\0${index}\0${name}`;
    if (deprecation && !warnedDeprecatedEntries.has(warningKey)) {
      warnedDeprecatedEntries.add(warningKey);
      process.stderr.write(deprecation);
    }
    if (file) { entryFiles.push(file); ownedDirectories.add(dirname(file)); }
    const range = module.meta.compatibility?.meeko;
    if (range !== undefined && !satisfiesVersion(version, range)) {
      throw new Error(`El módulo de Meeko ${name} necesita Meeko ${range}; este proyecto usa ${version}`);
    }
    const configKey = module.meta.configKey;
    if (configKey !== undefined && ownConfigKeys.includes(configKey)) {
      const since = ownConfigKeySince[configKey];
      throw new Error(`El módulo de Meeko ${name} usa meta.configKey ${JSON.stringify(configKey)}, que es una opción del propio Meeko${since ? ` desde ${since}` : ""}: dé al módulo otra configKey y mueva sus opciones de meeko.config.* a esa clave (véase docs/migration-1.4.md)`);
    }
    if (configKey !== undefined) {
      const owner = configKeyOwners.get(configKey);
      if (owner !== undefined) throw new Error(`Los módulos de Meeko ${owner} y ${name} usan la misma meta.configKey ${JSON.stringify(configKey)}: quite uno de modules`);
      configKeyOwners.set(configKey, name);
      configKeys.push(configKey);
    }
    const configured = configKey === undefined ? undefined : (config as Record<string, unknown>)[configKey];
    const options = mergeModuleOptions(module.defaults, configured, inline);
    const path = (value: string | URL, what: string): string => toPath(root, value, what, name);
    const existingFile = (value: string | URL, what: string): string => {
      const file = path(value, what);
      if (!isFile(file)) throw new Error(`Módulo de Meeko ${name}: ${what} ${file} no existe`);
      ownedDirectories.add(dirname(file));
      return file;
    };
    const existingDirectory = (value: string | URL, what: string): string => {
      const directory = path(value, what);
      if (!isDirectory(directory)) throw new Error(`Módulo de Meeko ${name}: ${what} ${directory} no es un directorio`);
      ownedDirectories.add(directory);
      return directory;
    };
    const context: MeekoModuleContext = Object.freeze({
      rootDir: root,
      dev,
      config,
      hooks: Object.freeze({
        hook<Name extends keyof MeekoHooks>(hookName: Name, handler: MeekoHooks[Name]): () => void {
          if (typeof handler !== "function") throw new TypeError(`Módulo de Meeko ${name}: el hook ${hookName} necesita una función`);
          const list = hooks.get(hookName) ?? [];
          hooks.set(hookName, list);
          const registered = handler as (...args: never[]) => unknown;
          list.push(registered);
          return () => { const index = list.indexOf(registered); if (index >= 0) list.splice(index, 1); };
        },
      }),
      addLayer(dir: string | URL) { layers.push(existingDirectory(dir, "layer")); },
      addComponentsDir(dir: string | URL, componentOptions?: { readonly prefix?: string; readonly exclude?: readonly string[] }) {
        const prefix = componentOptions?.prefix === undefined ? "" : pascalCase(componentOptions.prefix);
        if (componentOptions?.prefix !== undefined && !/^[A-Z][A-Za-z0-9]*$/.test(prefix)) throw new TypeError(`Módulo de Meeko ${name}: prefijo de componentes no válido ${componentOptions.prefix}`);
        const exclude = normalizeComponentExcludes(componentOptions?.exclude);
        componentsDirs.push({ dir: existingDirectory(dir, "components directory"), prefix, ...(exclude.length ? { exclude } : {}) });
      },
      addLayout(layoutName: string, file: string | URL) {
        if (typeof layoutName !== "string" || !/^[A-Za-z0-9][\w-]*(?:\/[A-Za-z0-9][\w-]*)*$/.test(layoutName)) {
          throw new TypeError(`Módulo de Meeko ${name}: nombre de layout no válido ${String(layoutName)}; use letras, dígitos, - y _, con / entre carpetas`);
        }
        const layoutFile = existingFile(file, `layout ${layoutName}`);
        if (!layoutFile.endsWith(".meeko")) throw new TypeError(`Módulo de Meeko ${name}: el layout ${layoutName} debe ser un archivo .meeko`);
        const previous = layouts.find((entry) => entry.name === layoutName);
        if (previous) throw new Error(`Módulo de Meeko ${name}: el layout ${layoutName} ya lo añade ${previous.module}`);
        layouts.push({ name: layoutName, file: layoutFile, module: name });
      },
      extendRoutes(extend) {
        if (typeof extend !== "function") throw new TypeError(`Módulo de Meeko ${name}: extendRoutes necesita una función`);
        routeExtenders.push({ module: name, extend });
      },
      addAutoImports(entries: ModuleAutoImport | readonly ModuleAutoImport[]) {
        for (const item of (Array.isArray(entries) ? entries : [entries]) as readonly ModuleAutoImport[]) {
          if (!item || typeof item.name !== "string" || !/^[A-Za-z_$][\w$]*$/.test(item.name)) throw new TypeError(`Módulo de Meeko ${name}: nombre de autoimport no válido ${String(item?.name)}`);
          const as = item.as ?? item.name;
          if (!/^[A-Za-z_$][\w$]*$/.test(as)) throw new TypeError(`Módulo de Meeko ${name}: alias de autoimport no válido ${as}`);
          const scope = item.scope ?? "app";
          if (!["app", "client", "server", "shared"].includes(scope)) throw new TypeError(`Módulo de Meeko ${name}: ámbito de autoimport no válido ${scope}`);
          if (item.componentOnly && scope !== "app") throw new TypeError(`Módulo de Meeko ${name}: componentOnly requiere scope "app"`);
          const from = item.from instanceof URL || item.from.startsWith("file:") || item.from.startsWith(".") || isAbsolute(item.from)
            ? existingFile(item.from, `autoimport ${as}`) : item.from;
          autoImports.push({ name: item.name, as, from, specifier: from === item.from && !isAbsolute(from), type: item.type === true, scope, componentOnly: item.componentOnly === true });
        }
      },
      addAutoImportsDir(dir: string | URL, dirOptions: { readonly scope: "app" | "server" | "shared" }) {
        const scope = dirOptions?.scope;
        if (scope !== "app" && scope !== "server" && scope !== "shared") throw new TypeError(`Módulo de Meeko ${name}: addAutoImportsDir necesita scope "app", "server" o "shared"`);
        autoImportsDirs.push({ dir: existingDirectory(dir, "autoimports directory"), scope });
      },
      addPlugin(plugin: ModulePlugin | string | URL) {
        const definition: ModulePlugin = typeof plugin === "string" || plugin instanceof URL ? { src: plugin } : plugin;
        const pluginFile = existingFile(definition.src, "plugin");
        plugins.push({ file: pluginFile, mode: pluginMode(pluginFile, definition.mode), ...(definition.options === undefined ? {} : { options: definition.options }), module: name });
      },
      addServerMiddleware(middleware: string | URL) { serverMiddleware.push(existingFile(middleware, "server middleware")); },
      addServerHandler(handler) {
        if (typeof handler?.route !== "string" || !handler.route.startsWith("/")) throw new TypeError(`Módulo de Meeko ${name}: la ruta del handler de servidor debe empezar por /`);
        if (serverHandlers.some((existing) => existing.route === handler.route)) throw new Error(`Módulo de Meeko ${name}: handler de servidor repetido para ${handler.route}`);
        serverHandlers.push({ route: handler.route, file: existingFile(handler.handler, `server handler ${handler.route}`) });
      },
      addPublicFile(publicPath: string, contents: PublicFileContents, options?: ModulePublicFileOptions) {
        const key = normalizePublicPath(publicPath, name);
        if (publicFiles.has(key)) throw new Error(`Módulo de Meeko ${name}: el archivo público ${key} ya está añadido`);
        if (typeof contents !== "string" && typeof contents !== "function" && !(contents instanceof Uint8Array)) throw new TypeError(`Módulo de Meeko ${name}: el archivo público ${key} necesita una cadena, bytes o una función`);
        publicFiles.set(key, contents);
        if (options?.headers !== undefined) {
          if (!isPlainObject(options.headers)) throw new TypeError(`Módulo de Meeko ${name}: headers del archivo público ${key} debe ser un objeto de valores de cabecera`);
          validateHeaderValues(options.headers, `headers del archivo público ${key}`, `Módulo de Meeko ${name}`);
          publicFileHeaders.set(key, options.headers);
        }
      },
      addTypeTemplate(filename: string, contents: string) {
        if (!/^[A-Za-z0-9_-]+\.d\.ts$/.test(filename) || typeof contents !== "string") throw new TypeError(`Módulo ${name}: declaración de tipos no válida`);
        const key = `${encodeURIComponent(name)}/${filename}`;
        if (typeTemplates.has(key)) throw new Error(`Módulo ${name}: declaración repetida ${filename}`);
        typeTemplates.set(key, contents);
      },
      addStylesheet(value: string | URL) {
        const file = realpathSync.native(existingFile(value, "stylesheet"));
        if (!file.toLowerCase().endsWith(".css")) throw new TypeError(`Módulo de Meeko ${name}: la hoja de estilos debe ser un archivo .css: ${file}`);
        if (!stylesheets.includes(file)) stylesheets.push(file);
        ownedDirectories.add(dirname(file));
      },
      addHead(input: DocumentHead) {
        if (!input || typeof input !== "object") throw new TypeError(`Módulo de Meeko ${name}: addHead necesita un objeto de head`);
        // It joins `document`, which the build bakes as JSON: fail here, naming the module.
        head = mergeHeadInput(head, normalizeHeadInput(input, `Meeko module ${name}: addHead`, { serializable: true }));
      },
      addVitePlugin(plugin: object | readonly object[]) {
        for (const item of (Array.isArray(plugin) ? plugin : [plugin]) as readonly object[]) vitePlugins.push(item);
      },
      extendViteConfig(extend) {
        if (typeof extend !== "function") throw new TypeError(`Módulo de Meeko ${name}: extendViteConfig necesita una función`);
        viteExtenders.push(extend);
      },
      warn(message: string) { process.stderr.write(`[meeko] ${name}: ${message}\n`); },
    } satisfies MeekoModuleContext);
    try { await module.setup(options as never, context); }
    catch (error) { throw new Error(`El módulo de Meeko ${name} falló en setup: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
  }
  const resolved: ResolvedModules = {
    names, entryFiles, layers, componentsDirs, layouts, routeExtenders, autoImports, autoImportsDirs, plugins, serverMiddleware, serverHandlers,
    publicFiles, publicFileHeaders, stylesheets, typeTemplates, head, vitePlugins, viteExtenders, ownedDirectories: [...ownedDirectories],
    async callHook(hookName, ...args) {
      for (const handler of [...hooks.get(hookName) ?? []]) await (handler as (...values: unknown[]) => unknown)(...args);
    },
  };
  await resolved.callHook("ready");
  await warnConfigKeys(root, config, configKeys, names);
  return resolved;
}

/** Configurations whose unknown keys were already reported. */
const reportedConfigs = new WeakSet<object>();

/** Edit distance of two keys, for the suggestion of an unknown one. */
function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(previous[column]! + 1, current[column - 1]! + 1, previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[right.length]!;
}

/**
 * The keys of an executed configuration that neither Meeko nor a module (`meta.configKey`) reads,
 * each with the closest known key when it looks like a typo (`sitmap` for `sitemap`).
 */
export function unknownConfigKeys(config: MeekoConfig, moduleKeys: readonly string[]): Array<{ readonly key: string; readonly suggestion?: string }> {
  const known = [...ownConfigKeys, ...moduleKeys];
  const result: Array<{ key: string; suggestion?: string }> = [];
  for (const key of Object.keys(config)) {
    if (known.includes(key)) continue;
    const suggestion = closestName(key, known);
    result.push(suggestion === undefined ? { key } : { key, suggestion });
  }
  return result;
}

/**
 * Warns, once per configuration, of the keys that nothing reads: a typo such as `sitmap: true`
 * would otherwise be ignored in silence. It is a warning and not an error during 1.x, because such
 * a configuration loaded until 1.6.
 */
export function warnUnknownConfigKeys(projectRoot: string, config: MeekoConfig, moduleKeys: readonly string[], write: (text: string) => void = (text) => process.stderr.write(text)): void {
  if (reportedConfigs.has(config)) return;
  reportedConfigs.add(config);
  const file = configFileName(projectRoot);
  for (const { key, suggestion } of unknownConfigKeys(config, moduleKeys)) write(unknownKeyMessage(file, key, suggestion));
}

function unknownKeyMessage(file: string, key: string, suggestion: string | undefined): string {
  return `[meeko] Aviso: ${file} tiene la clave desconocida ${JSON.stringify(key)}, que Meeko ignora. ${suggestion === undefined
    ? "Si son las opciones de un módulo, añádalo a modules: su meta.configKey la declara."
    : `¿Quisiste decir ${JSON.stringify(suggestion)}?`}\n`;
}

/**
 * Like {@link warnUnknownConfigKeys}, once per configuration, but a key that is the
 * `meta.configKey` of an installed module package missing from `modules` (`i18n: { … }` without
 * `"@meekojs/i18n"`) is `MEEK127`, which names the entry to add. A warning in 1.x: the key is
 * ignored, as before 1.8.
 */
async function warnConfigKeys(projectRoot: string, config: MeekoConfig, moduleKeys: readonly string[], listed: readonly string[], write: (text: string) => void = (text) => process.stderr.write(text)): Promise<void> {
  if (reportedConfigs.has(config)) return;
  reportedConfigs.add(config);
  const file = configFileName(projectRoot);
  const listedNames = [...listed, ...(config.modules ?? []).filter((entry): entry is string => typeof entry === "string")];
  for (const { key, suggestion } of unknownConfigKeys(config, moduleKeys)) {
    const owner = await unlistedModuleForKey(resolve(projectRoot), key, listedNames);
    write(owner === undefined ? unknownKeyMessage(file, key, suggestion)
      : `[meeko] Aviso MEEK127: ${file} tiene la clave ${JSON.stringify(key)}, que es la configKey del módulo ${owner}, pero ${owner} no está en modules, así que Meeko ignora sus opciones. Añádalo: modules: [${JSON.stringify(owner)}].\n`);
  }
}

let developmentMode = false;

/** Name of the nearest `package.json` above `directory` that has one, without leaving its `node_modules` folder. */
function owningPackageName(directory: string): string | undefined {
  for (let current = directory; basename(current) !== "node_modules";) {
    const manifest = join(current, "package.json");
    if (isFile(manifest)) {
      let name: unknown;
      try { name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name; } catch { name = undefined; }
      // A nested manifest without a name (`{ "type": "module" }` in `dist/`) is not the package.
      if (typeof name === "string" && name) return name;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
  return undefined;
}

/**
 * Installed packages (their real path is under `node_modules`) that hold files of the modules:
 * the module entry, plugins, components, layouts, autoimports. A module's runtime code reaches Vite
 * by two paths: the package name of an autoimport (`@meekojs/ui/runtime`), and the files its setup
 * registers by path, which import their neighbours relatively. Vite's dependency optimizer (the dev
 * client) and the SSR externalization (the server build) treat only the first as a dependency, so
 * the same file ran twice: a context key from `createContext` provided by a plugin was not the one a
 * page read, and any other state of the module was split in two. Meeko compiles these packages as
 * source instead, as a linked package already is. `@meekojs/meeko` stays a single external copy.
 */
export function installedModulePackages(directories: readonly string[]): string[] {
  const names = new Set<string>();
  for (const directory of directories) {
    if (!directory.replaceAll("\\", "/").split("/").includes("node_modules")) continue;
    const name = owningPackageName(directory);
    if (name && name !== "@meekojs/meeko") names.add(name);
  }
  return [...names];
}

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
 * modules, validated and deduplicated like `useHead` (the configuration's entries win).
 */
export function resolvedDocument(config: MeekoConfig, modules: ResolvedModules): DocumentConfig | undefined {
  // The origin is resolved only when `document.seo` writes an absolute URL without its own origin.
  const origin = seoNeedsSiteOrigin(config.document?.seo) ? resolveSiteOrigin(config) : undefined;
  return resolveDocumentConfig(config.document, modules.head ? [modules.head] : [], origin, config.theme);
}

/** Whether a `document.seo` value writes `canonical` or `og:url` from the site's origin. */
function seoNeedsSiteOrigin(seo: unknown): boolean {
  if (seo === true) return true;
  if (seo === null || typeof seo !== "object") return false;
  const options = seo as Record<string, unknown>;
  return options.origin === undefined && (options.canonical !== false || options.ogUrl !== false);
}

/**
 * The public origin of the site for the absolute URLs the build writes (`sitemap.xml`,
 * `robots.txt`, `document.seo`): `site` of the configuration or, without it, `MEEKO_PUBLIC_ORIGIN`
 * of the build's environment. `site` must be a bare origin; `MEEKO_PUBLIC_ORIGIN` keeps only the
 * origin of its URL, as the server does with it (`https://example.com/app` gives
 * `https://example.com`). Call it only when an absolute URL is written.
 */
export function resolveSiteOrigin(config: MeekoConfig, env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  if (config.site !== undefined) return siteOrigin(config.site, "site");
  const fromEnv = meekoEnv(env, "PUBLIC_ORIGIN");
  return fromEnv ? publicOriginOf(fromEnv) : undefined;
}

/** The origin of `MEEKO_PUBLIC_ORIGIN`, accepted as the server accepts it. */
function publicOriginOf(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new TypeError(`MEEKO_PUBLIC_ORIGIN debe ser una URL absoluta, como "https://example.com"`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("MEEKO_PUBLIC_ORIGIN debe usar http: o https:");
  return url.origin;
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
