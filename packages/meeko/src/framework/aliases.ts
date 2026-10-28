import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { aliasImporterScope, aliasScopeProblem, aliasTsconfigPaths, matchPathAlias } from "../compiler/aliases.js";
import type { AliasImporterScope, PathAlias, PathAliasScope } from "../compiler/aliases.js";
import { moduleSpecifiers } from "../compiler/import-graph.js";
import type { CompileDiagnostic } from "../compiler/sfc.js";
import { locate } from "../compiler/sfc.js";
import type { MeekoConfig } from "./config-type.js";
import { isExecutedConfig, loadMeekoConfig, readMeekoConfigSync, resolveConfigSources } from "./config.js";
import { legacyLayerEntries, resolveMeekoModules } from "./module-loader.js";

/**
 * The default path aliases: each prefix and the folder it names in the project and in each layer
 * (`""` is the folder itself), with the scope of that folder.
 */
const defaultAliases: ReadonlyArray<readonly [prefix: string, folder: string, scope: PathAliasScope]> = [
  ["~/", "", "shared"],
  ["@/", "app", "app"],
  ["#shared/", "shared", "shared"],
  ["#server/", "server", "server"],
];

/** The prefixes of the default path aliases, in their documented order. */
export const defaultAliasPrefixes: readonly string[] = defaultAliases.map(([prefix]) => prefix);

/** The aliases of a project and the source roots (project first, then its layers) they resolve in. */
export interface ProjectAliases {
  readonly aliases: readonly PathAlias[];
  readonly sourceRoots: readonly string[];
}

function inside(root: string, target: string): string | undefined {
  const path = relative(root, target);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path) ? undefined : path.replaceAll("\\", "/");
}

/** The scope of a folder that an alias of `alias` names, as the autoimports take it: from `app/`, `server/` or the rest. */
function folderScope(target: string, sourceRoots: readonly string[]): PathAliasScope {
  for (const root of [...sourceRoots].sort((a, b) => b.length - a.length)) {
    const path = inside(root, target);
    if (path === undefined) continue;
    const top = path.split("/")[0];
    return top === "server" ? "server" : top === "app" ? "app" : "shared";
  }
  return "shared";
}

/** The keys of `imports` in the project's `package.json` (Node subpath imports, `#name`). */
function packageImports(root: string): readonly string[] {
  try {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { imports?: unknown };
    return manifest.imports && typeof manifest.imports === "object" && !Array.isArray(manifest.imports) ? Object.keys(manifest.imports) : [];
  } catch {
    return [];
  }
}

/** The subpath import of `package.json` that a `#` alias would shadow, or `undefined`. */
function importsConflict(prefix: string, keys: readonly string[]): string | undefined {
  if (!prefix.startsWith("#")) return undefined;
  return keys.find((key) => {
    const star = key.indexOf("*");
    if (star < 0) return key.startsWith(prefix);
    const base = key.slice(0, star);
    return base.startsWith(prefix) || prefix.startsWith(base);
  });
}

const warnedConflicts = new Set<string>();

function warnConflict(root: string, prefix: string, key: string): void {
  const id = `${root}\0${prefix}`;
  if (warnedConflicts.has(id)) return;
  warnedConflicts.add(id);
  process.stderr.write(`[meeko] Aviso: package.json declara "imports" con ${JSON.stringify(key)}, que coincide con el alias ${prefix} de Meeko. Gana el de package.json: Meeko no define ${prefix} en este proyecto (ni en Vite ni en los tsconfig generados). Para usar el de Meeko, quita esa entrada de "imports"; para quitar este aviso, desactiva el alias con alias: { ${JSON.stringify(prefix)}: false } en meeko.config.ts.\n`);
}

/**
 * The `find` of a Vite `resolve.alias` (an object or an array of `{ find }`) that takes the specifiers
 * of `prefix` before Meeko, as Vite matches it: a string equal to the specifier or followed by `/`, or
 * a regular expression. `undefined` when none does.
 */
export function viteAliasShadow(alias: unknown, prefix: string): string | undefined {
  const finds: unknown[] = Array.isArray(alias)
    ? alias.map((entry: unknown) => entry && typeof entry === "object" ? (entry as { find?: unknown }).find : undefined)
    : alias && typeof alias === "object" ? Object.keys(alias) : [];
  const probe = `${prefix}meeko-alias-probe`;
  for (const find of finds) {
    if (typeof find === "string" && (probe === find || probe.startsWith(`${find}/`))) return find;
    if (find instanceof RegExp) {
      find.lastIndex = 0;
      if (find.test(probe)) return String(find);
    }
  }
  return undefined;
}

/**
 * The pattern of the project's `tsconfig.json` `paths` that redefines `alias` (`@/*` to another
 * folder), or `undefined`. The same folders Meeko would give it are not a redefinition.
 */
function tsconfigShadow(alias: PathAlias, root: string, user: Readonly<Record<string, readonly string[]>>): string | undefined {
  const pattern = `${alias.prefix}*`;
  const targets = user[pattern];
  if (!targets) return undefined;
  const own = new Set<string>();
  for (const target of alias.targets) {
    own.add(resolve(target, "*"));
    const mirrored = inside(root, target);
    if (mirrored !== undefined) own.add(resolve(root, ".meeko", "types", mirrored, "*"));
  }
  return targets.every((target) => own.has(resolve(target))) ? undefined : pattern;
}

const warnedShadows = new Set<string>();

function warnShadow(root: string, prefix: string, source: string): void {
  const id = `${root}\0${prefix}`;
  if (warnedShadows.has(id)) return;
  warnedShadows.add(id);
  process.stderr.write(`[meeko] Aviso: ${source} redefine el alias ${prefix} de Meeko. Gana esa definición: Meeko no aplica ${prefix} en este proyecto (ni al resolver ni en sus comprobaciones de ámbito MEEK108 y MEEK118). Para usar el de Meeko, quita esa definición; para quitar este aviso, desactiva el alias con alias: { ${JSON.stringify(prefix)}: false } en meeko.config.ts.\n`);
}

/** How {@link buildProjectAliases} reports and detects the prefixes that the project redefines. */
export interface AliasShadowOptions {
  /** Prints each conflict once per process. */
  readonly warn?: boolean;
  /**
   * The `resolve.alias` of Vite, from the project or the modules (`extendViteConfig`); an alias of
   * Meeko that it takes first is left out.
   */
  readonly viteAlias?: unknown;
}

/**
 * The aliases of a project: the default ones (in the project and then each layer) without those
 * that `alias` of `meeko.config.ts` replaces or turns off, then the configured ones, each with the
 * scope of the folder it names. A `#` alias that a subpath import of the project's `package.json`
 * also names is left out, so Node's wins; so is one whose prefix the `paths` of the project's
 * `tsconfig.json` or a Vite `resolve.alias` redefine. `warn` prints each case once per process.
 */
export function buildProjectAliases(projectRoot: string, sourceRoots: readonly string[], option: MeekoConfig["alias"], warn: boolean | AliasShadowOptions = false): ProjectAliases {
  const shadows: AliasShadowOptions = typeof warn === "boolean" ? { warn } : warn;
  const root = resolve(projectRoot);
  const roots = sourceRoots.length ? sourceRoots.map((entry) => resolve(entry)) : [root];
  const configured = option ?? {};
  const aliases: PathAlias[] = [];
  for (const [prefix, folder, scope] of defaultAliases) {
    if (Object.hasOwn(configured, prefix)) continue;
    aliases.push({ prefix, targets: roots.map((entry) => folder ? join(entry, folder) : entry), scope });
  }
  for (const [prefix, value] of Object.entries(configured)) {
    if (value === false) continue;
    const target = resolve(root, value);
    // `loadMeekoConfig` rejects a folder outside the project; the editor's static reader does not.
    if (isAbsolute(value) || inside(root, target) === undefined) continue;
    aliases.push({ prefix, targets: [target], scope: folderScope(target, roots) });
  }
  const imports = packageImports(root);
  const userPaths = userTsconfigPaths(root);
  return {
    sourceRoots: roots,
    aliases: aliases.filter((alias) => {
      const key = importsConflict(alias.prefix, imports);
      if (key !== undefined) {
        if (shadows.warn) warnConflict(root, alias.prefix, key);
        return false;
      }
      const pattern = tsconfigShadow(alias, root, userPaths);
      const find = pattern === undefined ? viteAliasShadow(shadows.viteAlias, alias.prefix) : undefined;
      if (pattern === undefined && find === undefined) return true;
      if (shadows.warn) {
        warnShadow(root, alias.prefix, pattern !== undefined
          ? `"paths" de tsconfig.json con ${JSON.stringify(pattern)}`
          : `resolve.alias de Vite (de la configuración de Vite o de extendViteConfig de un módulo) con ${find!.startsWith("/") ? find! : JSON.stringify(find)}`);
      }
      return false;
    }),
  };
}

/**
 * The `resolve.alias` that the modules of an executed configuration add with `extendViteConfig`,
 * run on an empty configuration; one that fails there adds none.
 */
async function moduleViteAlias(root: string, config: MeekoConfig): Promise<unknown[]> {
  if (!isExecutedConfig(config)) return [];
  let extenders: Awaited<ReturnType<typeof resolveMeekoModules>>["viteExtenders"];
  try { extenders = (await resolveMeekoModules(root, config)).viteExtenders; }
  catch { return []; }
  const found: unknown[] = [];
  for (const extend of extenders) {
    try {
      const probe: Record<string, unknown> = { resolve: {}, plugins: [] };
      const result = extend(probe, { command: "build", ssr: false }) ?? probe;
      found.push(...viteAliasEntries((result as { resolve?: { alias?: unknown } }).resolve?.alias));
    } catch { /* The real build reports it. */ }
  }
  return found;
}

/** A Vite `resolve.alias` (an object or an array) as an array of `{ find }`. */
function viteAliasEntries(alias: unknown): unknown[] {
  if (Array.isArray(alias)) return alias;
  return alias && typeof alias === "object" ? Object.keys(alias).map((find) => ({ find })) : [];
}

/**
 * The aliases of a project with its configuration loaded (and run), as `meeko dev`, `meeko build`
 * and `meeko check` see them: without the prefixes that `package.json` `imports`, the `paths` of
 * `tsconfig.json`, a `resolve.alias` of a module or `viteAlias` (the one Vite resolved) redefine.
 * Prints each of those once per process, unless `warn` is `false` (the editor).
 */
export async function resolveProjectAliases(projectRoot: string, config?: MeekoConfig, options: { readonly warn?: boolean; readonly viteAlias?: unknown } = {}): Promise<ProjectAliases> {
  const root = resolve(projectRoot);
  config ??= await loadMeekoConfig(root);
  const sources = await resolveConfigSources(root, config);
  const viteAlias = [...await moduleViteAlias(root, config), ...viteAliasEntries(options.viteAlias)];
  return buildProjectAliases(root, sources.map((source) => source.root), config.alias, { warn: options.warn ?? true, viteAlias });
}

/**
 * The aliases of a project without running its configuration, as the editor reads it: `layers`,
 * `extends` and `alias` as literals. A configuration that cannot be read gives the default aliases.
 */
export function resolveProjectAliasesSync(projectRoot: string): ProjectAliases {
  const root = resolve(projectRoot);
  let config: MeekoConfig = {};
  try { config = readMeekoConfigSync(root); }
  catch { /* The editor reports the configuration problem elsewhere. */ }
  const legacy = ((): string[] => {
    try { return legacyLayerEntries(root, config); }
    catch { return []; }
  })();
  const layers = [...config.extends ?? [], ...config.layers ?? [], ...legacy].map((entry) => resolve(root, entry));
  return buildProjectAliases(root, [root, ...layers], config.alias);
}

/** The aliases a TypeScript project of `scope` declares; `"all"` for a component, whose `<script server>` sees them all. */
export function aliasesForScope(aliases: readonly PathAlias[], scope: AliasImporterScope | "all"): PathAlias[] {
  return aliases.filter((alias) => scope === "all" || alias.scope === "shared" || (alias.scope === "app" ? scope !== "shared" : scope === "server"));
}

/**
 * `options` with the aliases of `scope` as `paths` to absolute folders, so `ts.resolveModuleName`
 * and a program resolve `#shared/x` as the generated tsconfigs do. The `paths` that `options`
 * already has (the project's own tsconfig) win for the same pattern.
 */
export function withAliasPaths(options: ts.CompilerOptions, project: ProjectAliases, scope: AliasImporterScope | "all"): ts.CompilerOptions {
  const paths = aliasTsconfigPaths(aliasesForScope(project.aliases, scope), (target) => target.replaceAll("\\", "/"));
  return { ...options, paths: { ...paths, ...options.paths } };
}

/**
 * `paths` of the project's own `tsconfig.json`, as absolute targets: they win over the aliases of
 * Meeko with the same pattern. `{}` without a tsconfig or `paths`.
 */
export function userTsconfigPaths(projectRoot: string): Record<string, string[]> {
  const file = join(resolve(projectRoot), "tsconfig.json");
  let parsed: ts.ParsedCommandLine | undefined;
  try {
    if (!ts.sys.fileExists(file)) return {};
    const loaded = ts.readConfigFile(file, ts.sys.readFile);
    if (loaded.error || !loaded.config) return {};
    // Only the options matter: no walk of the project for `include`.
    parsed = ts.parseJsonConfigFileContent(loaded.config, { ...ts.sys, readDirectory: () => [] }, dirname(file), undefined, file);
  } catch {
    return {};
  }
  const options = parsed.options;
  const base = typeof options.baseUrl === "string" ? options.baseUrl
    : typeof options["pathsBasePath"] === "string" ? options["pathsBasePath"] : dirname(file);
  const paths: Record<string, string[]> = {};
  for (const [pattern, targets] of Object.entries(options.paths ?? {})) paths[pattern] = targets.map((target) => resolve(base, target));
  return paths;
}

/**
 * `paths` for a generated tsconfig in `directory`: the aliases of `scope`, followed by the
 * declarations of `.meeko/types`, then the project's own `paths`, which win for the same pattern.
 */
export function frameworkTsconfigPaths(projectRoot: string, project: ProjectAliases, scope: AliasImporterScope | "all", directory: string): Record<string, string[]> {
  const root = resolve(projectRoot);
  const relativeTo = (target: string): string => {
    const path = relative(directory, target).replaceAll("\\", "/");
    return path === "" ? "." : path.startsWith(".") ? path : `./${path}`;
  };
  const own = aliasTsconfigPaths(aliasesForScope(project.aliases, scope), relativeTo, { root, directory: join(root, ".meeko", "types") });
  const user = userTsconfigPaths(root);
  for (const [pattern, targets] of Object.entries(user)) own[pattern] = targets.map(relativeTo);
  return own;
}

/**
 * `MEEK108` and `MEEK118` of the TypeScript modules of `app/` and `shared/` (in the project and its
 * layers) that import through an alias their scope does not see: `#server/` outside the server,
 * `@/` in `shared/`. The generated tsconfigs leave those aliases out, so TypeScript would only say
 * that the module does not exist.
 */
export async function checkAliasScopes(project: ProjectAliases, files: readonly string[], read: (file: string) => Promise<string>): Promise<CompileDiagnostic[]> {
  const diagnostics: CompileDiagnostic[] = [];
  for (const file of files) {
    const scope = aliasImporterScope(file, project.sourceRoots);
    if (scope === undefined || scope === "server") continue;
    const source = await read(file);
    for (const specifier of moduleSpecifiers(source, file)) {
      const match = matchPathAlias(project.aliases, specifier.value);
      const problem = match && aliasScopeProblem(match.alias, scope, specifier.value);
      if (problem) diagnostics.push({ ...problem, filename: file, location: locate(source, specifier.start) });
    }
  }
  return diagnostics;
}
