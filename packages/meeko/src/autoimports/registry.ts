import { readdir, readFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { componentDirectories, importDirectoryOptions, loadMeekoConfig, normalizeImportDirectory, readMeekoConfigSync, resolveConfigSources } from "../framework/config";
import type { MeekoConfig } from "../framework/config";
import { legacyLayerEntries, resolveMeekoModules } from "../framework/module-loader";

export type ImportScope = "client" | "server" | "shared" | "app";
export interface AutoImport {
  name: string;
  imported: string;
  file: string;
  scope: ImportScope;
  typeOnly: boolean;
  component: boolean;
  specifier?: string;
  /** A value export that also names a type: a class, an enum or a value merged with a type. */
  alsoType?: boolean;
  /**
   * A type of an autoimported component (`AppCardProps`, `AppCardSnippets`…): `imported` is its
   * generic name in the component's module (`ComponentProps`…). Also the props type of a built-in
   * tag (`MeekoLinkProps`), from `@meekojs/meeko/framework`. It yields to any other autoimport with
   * the same name, such as a type of `app/types`; the type of a built-in tag also yields to the
   * types of a project component named like the tag.
   */
  componentType?: boolean;
  /**
   * Only for code that may run in the browser: components and modules of `app/`, but not the
   * sources of `server/`, `*.server.ts` or the route files, even though the scope is `app`.
   */
  browserCode?: boolean;
}

const directories = [
  "app/components", "app/composables", "app/utils", "app/stores", "app/types",
  "shared/types", "shared/schemas", "shared/utils", "shared/constants", "shared/enums",
  "server/utils",
] as const;

/**
 * `directory`, the folder of the file relative to its source root (`app/services`), gives the scope
 * of a file without suffix: the folders of `imports` take the scope of `app/`, `shared/` or `server/`
 * whatever the folders above the project are called.
 */
function scopeOf(file: string, directory?: string): ImportScope {
  if (/\.shared\.[cm]?tsx?$/.test(file)) return "shared";
  if (/\.server\.[cm]?tsx?$/.test(file)) return "server";
  if (/\.client\.[cm]?tsx?$/.test(file)) return "client";
  const base = directory?.split("/")[0];
  if (base === "server" || base === "app" || base === "shared") return base;
  if (file.includes(`${sep}server${sep}`)) return "server";
  // App modules render on both sides during SSR, but are not available to shared/ sources.
  if (file.includes(`${sep}app${sep}`)) return "app";
  return "shared";
}

async function filesIn(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const filename = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(filename));
    else if (/\.(?:meeko|[cm]?ts)$/.test(entry.name) && !/\.(?:test|spec|d)\.[cm]?ts$/.test(entry.name)) files.push(filename);
  }
  return files;
}

function filesInSync(path: string): string[] {
  let entries;
  try { entries = readdirSync(path, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const files: string[] = [];
  for (const entry of entries) {
    const filename = join(path, entry.name);
    if (entry.isDirectory()) files.push(...filesInSync(filename));
    else if (/\.(?:meeko|[cm]?ts)$/.test(entry.name) && !/\.(?:test|spec|d)\.[cm]?ts$/.test(entry.name)) files.push(filename);
  }
  return files;
}

/**
 * Props types of Meeko's own template tags, autoimported like the types of the project's components
 * (`AppCardProps`): with the scope of `app/` and from the public `@meekojs/meeko/framework`. A new
 * built-in tag adds its props type here and in the editor's table (`language-server/builtin-tags.ts`).
 */
export const builtinTagTypes: readonly string[] = ["MeekoLinkProps", "MeekoOutletProps", "MeekoThemeToggleProps", "MeekoAwaitProps", "MeekoTeleportProps", "MeekoPopoverProps", "MeekoSelectProps"];

/** Types of `@meekojs/meeko/framework` autoimported everywhere, like `href`: `RouteId`. */
const frameworkTypes: readonly string[] = ["RouteId", "LayoutProps"];

function builtins(root: string): AutoImport[] {
  const entries: AutoImport[] = [
    ...["signal", "computed", "effect", "batch", "untrack", "onCleanup", "onMounted", "provide", "inject", "createContext", "provideErrorHandler", "useId"].map((name): AutoImport => ({ name, imported: name, file: "@meekojs/meeko", specifier: "@meekojs/meeko", scope: "shared", typeOnly: false, component: false })),
    // Since 1.7: `createRoot`, which its siblings of `@meekojs/meeko` already were.
    { name: "createRoot", imported: "createRoot", file: "@meekojs/meeko", specifier: "@meekojs/meeko", scope: "shared", typeOnly: false, component: false },
    // Since 1.7: `useNavigation`, like `useRoute`; on the server it is a fixed state with `pending` false.
    { name: "useNavigation", imported: "useNavigation", file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "shared", typeOnly: false, component: false },
    ...["useState", "href", "useRoute", "definePage", "defineGroup", "defineRouteMiddleware", "definePlugin"].map((name): AutoImport => ({ name, imported: name, file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "shared", typeOnly: false, component: false })),
    // Form and storage run in app component setup on both SSR and hydration; no server/ or shared/ autoimport.
    ...["useForm", "useStorage", "useHead", "useSeoMeta", "useTheme", "useLayout"].map((name): AutoImport => ({ name, imported: name, file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "app", typeOnly: false, component: false, browserCode: true })),
    ...["Form", "FormField", "FormSubmission"].map((name): AutoImport => ({ name, imported: name, file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "app", typeOnly: true, component: false, browserCode: true })),
    { name: "ResolvedComponent", imported: "ResolvedComponent", file: "@meekojs/meeko", specifier: "@meekojs/meeko", scope: "app", typeOnly: true, component: false, browserCode: true },
    // The definitions of server/ (contract discovery reads the call by name, not by its import).
    ...["defineApiRoute", "defineRpc", "defineServerMiddleware", "defineSocketChannel", "defineServerRuntime"].map((name): AutoImport => ({ name, imported: name, file: "@meekojs/meeko/server", specifier: "@meekojs/meeko/server", scope: "server", typeOnly: false, component: false })),
    // Since 1.7, for `<script server>` (also inside the route options), `*.route.ts` sidecars and server/.
    { name: "defer", imported: "defer", file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "server", typeOnly: false, component: false },
    // Since 1.6, for app/middleware/*.server.ts: route middleware that only runs on the server.
    { name: "defineServerRouteMiddleware", imported: "defineServerRouteMiddleware", file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "server", typeOnly: false, component: false },
    { name: "ApiError", imported: "ApiError", file: "@meekojs/meeko/server", specifier: "@meekojs/meeko/server", scope: "server", typeOnly: false, component: false, alsoType: true },
    // What a component or a composable does with a failed request; server code throws ApiError instead.
    { name: "ClientError", imported: "ClientError", file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "app", typeOnly: false, component: false, alsoType: true, browserCode: true },
    { name: "isClientError", imported: "isClientError", file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "app", typeOnly: false, component: false, browserCode: true },
    ...frameworkTypes.map((name): AutoImport => ({ name, imported: name, file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "shared", typeOnly: true, component: false })),
    ...builtinTagTypes.map((name): AutoImport => ({ name, imported: name, file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "app", typeOnly: true, component: false, componentType: true })),
  ];
  for (const scope of ["client", "server"] as const) {
    const file = join(root, ".meeko", "generated", `clients.${scope}.ts`);
    if (!existsSync(file)) continue;
    for (const name of ["api", "rpc", "socket", "useSocket", "useApi", "useRpcQuery", "useRpcMutation", "useApiMutation"]) entries.push({ name, imported: name, file, scope, typeOnly: false, component: false });
  }
  const generatedComponents = join(root, ".meeko", "generated", "components.ts");
  if (existsSync(generatedComponents)) entries.push({ name: "resolveComponent", imported: "resolveComponent", file: generatedComponents, scope: "app", typeOnly: false, component: false, browserCode: true });
  if (!entries.some((entry) => entry.name === "useSocket")) {
    // Without generated clients, `useSocket` is the framework's `useSocketClient`: the same
    // function as the deprecated `useSocket` alias, without its deprecation mark.
    entries.push({ name: "useSocket", imported: "useSocketClient", file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "shared", typeOnly: false, component: false });
  }
  return entries;
}

/**
 * Framework autoimports added after 1.0 that a project may already export under the same name:
 * the project's own export wins, instead of making the name ambiguous. `useApiMutation` comes from
 * the generated clients; the others, from `@meekojs/meeko/framework`.
 */
const yieldingBuiltins: ReadonlySet<string> = new Set(["useRoute", "useForm", "useStorage", "useApiMutation", "useHead", "useSeoMeta", "useTheme", "useId", "useLayout", "defineGroup", "defineServerRouteMiddleware", "createRoot", "useNavigation", "defer", "ClientError", "isClientError", "Form", "FormField", "FormSubmission", ...frameworkTypes]);

/** `api`, `rpc`, `socket`… of `.meeko/generated/clients.client.ts` or `clients.server.ts`. */
export function isGeneratedClient(file: string): boolean {
  return /[\\/]\.meeko[\\/]generated[\\/]clients\.(?:client|server)\.ts$/.test(file);
}

function isYieldingBuiltin(entry: AutoImport): boolean {
  return yieldingBuiltins.has(entry.name) && (entry.specifier === "@meekojs/meeko/framework" || entry.specifier === "@meekojs/meeko" || isGeneratedClient(entry.file));
}

/**
 * The types that the module of each autoimported component exports, by the suffix of their name:
 * `<AppCard>` gives `AppCardProps`, `AppCardSnippets`, `AppCardModels` and `AppCardExposed`.
 */
const componentTypes = [["Props", "ComponentProps"], ["Snippets", "ComponentSnippets"], ["Models", "ComponentModels"], ["Exposed", "ComponentExposed"]] as const;

/**
 * How readily an entry steps aside for another autoimport with the same name: `0` never; `1` a type
 * of a project component or a framework autoimport added after 1.0, before any other export; `2`
 * the props type of a built-in tag, also before the types of a project component that takes the
 * tag's name (`app/components/MeekoLink.meeko` gives its own `MeekoLinkProps`, MEEK106).
 */
function yieldRank(entry: AutoImport): number {
  if (entry.componentType === true && entry.specifier === "@meekojs/meeko/framework") return 2;
  return entry.componentType === true || isYieldingBuiltin(entry) ? 1 : 0;
}

function withoutYieldedEntries(result: AutoImport[]): AutoImport[] {
  return result.filter((entry) => {
    const rank = yieldRank(entry);
    return rank === 0 || !result.some((other) => other.name === entry.name && yieldRank(other) < rank);
  });
}

/** Keeps the diagnostic prefix stable for the editor while explaining the collision to a user. */
export function autoImportCollision(name: string, entries: readonly AutoImport[], scope?: string): Error {
  const origins = entries.map((entry) => entry.specifier ?? entry.file).join(", ");
  return new Error(`Autoimport ambiguo ${name}${scope ? ` en el ámbito ${scope}` : ""}: ${origins}. Hay dos definiciones con este nombre disponibles aquí. Renombra una o importa la que quieres usar con un alias.`);
}

function addAutoImport(result: AutoImport[], entry: AutoImport): void {
  const previous = result.find((candidate) => candidate.name === entry.name
    && candidate.imported === entry.imported
    && candidate.file === entry.file
    && candidate.scope === entry.scope
    && candidate.component === entry.component);
  if (!previous) {
    result.push(entry);
    return;
  }
  // Function overloads and declaration merging describe one exported symbol.
  // Prefer the value-bearing form when a type and value share that symbol.
  if (previous.typeOnly !== entry.typeOnly || entry.alsoType) previous.alsoType = true;
  if (previous.typeOnly && !entry.typeOnly) previous.typeOnly = false;
}

/**
 * A directory a module adds: `components` names its `.meeko` files like `app/components`, after
 * `prefix`; `scope` is the scope of its files without a `.client`, `.server` or `.shared` suffix.
 */
interface ModuleDirectory {
  readonly scope?: ImportScope;
}

function addFileImports(result: AutoImport[], root: string, directory: string, file: string, source?: string, module?: ModuleDirectory): void {
  const scope = module?.scope && !/\.(?:shared|server|client)\.[cm]?tsx?$/.test(file) ? module.scope : scopeOf(file, module ? undefined : directory);
  if (extname(file) === ".meeko") return;
  const ast = ts.createSourceFile(file, source ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // Classes and enums are values that also name a type, also when a local export list exposes them.
  const localValueTypes = new Set<string>();
  for (const statement of ast.statements) {
    if ((ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) localValueTypes.add(statement.name.text);
  }
  for (const statement of ast.statements) {
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
      const valueType = ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement);
      addAutoImport(result, { name: statement.name.text, imported: statement.name.text, file, scope, typeOnly: ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement), component: false, ...(valueType ? { alsoType: true } : {}) });
    }
    if (exported && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) {
        addAutoImport(result, { name: declaration.name.text, imported: declaration.name.text, file, scope, typeOnly: false, component: false });
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const typeOnly = statement.isTypeOnly || element.isTypeOnly;
        const valueType = !typeOnly && !statement.moduleSpecifier && localValueTypes.has(element.propertyName?.text ?? element.name.text);
        addAutoImport(result, { name: element.name.text, imported: element.name.text, file, scope, typeOnly, component: false, ...(valueType ? { alsoType: true } : {}) });
      }
    }
  }
}

/** The canonical component catalog consumed by autoimports and generated runtime/types. */
export interface DiscoveredComponent {
  readonly name: string;
  readonly file: string;
  readonly source: string;
}

interface ComponentDirectory {
  readonly dir: string;
  readonly prefix: string;
  readonly source: string;
  readonly sourceRoot?: string;
  readonly priority: number;
}

function componentName(file: string, directory: ComponentDirectory): string {
  const path = relative(directory.dir, file).replace(/\.meeko$/, "");
  const name = directory.prefix + path.split(/[\\/]/).map((part) => part.replace(/(^|[-_])(\w)/g, (_, _dash: string, letter: string) => letter.toUpperCase())).join("");
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`Nombre de componente no válido ${name}: ${file}`);
  return name;
}

function componentDirectoriesForSources(sources: readonly { root: string; name: string }[], config: MeekoConfig, modules: readonly { dir: string; prefix: string }[] = []): ComponentDirectory[] {
  const directories: ComponentDirectory[] = [];
  for (const [priority, source] of sources.entries()) {
    for (const entry of componentDirectories(config.components)) directories.push({ dir: resolve(source.root, entry.path), prefix: entry.prefix, source: source.name, sourceRoot: source.root, priority });
  }
  for (const [index, entry] of modules.entries()) directories.push({ dir: resolve(entry.dir), prefix: entry.prefix, source: `module:${index}`, priority: sources.length + index });
  return directories;
}

function catalog(files: readonly { directory: ComponentDirectory; file: string; identity: string }[]): readonly DiscoveredComponent[] {
  const chosen = new Map<string, { directory: ComponentDirectory; file: string }>();
  for (const { directory, file, identity } of files) {
    const previous = chosen.get(identity);
    // The first source wins; within it the deepest configured directory owns an overlapping file.
    if (!previous || directory.priority < previous.directory.priority || (directory.priority === previous.directory.priority && directory.dir.length > previous.directory.dir.length)) {
      chosen.set(identity, { directory, file });
    }
  }
  const names = new Map<string, { component: DiscoveredComponent; priority: number }>();
  for (const { directory, file } of chosen.values()) {
    const name = componentName(file, directory);
    const previous = names.get(name);
    if (previous) {
      if (previous.priority === directory.priority && previous.component.file !== file) throw new Error(`Nombre de componente duplicado ${name}: ${previous.component.file}, ${file}`);
      if (previous.priority < directory.priority) continue;
    }
    names.set(name, { component: { name, file, source: directory.source }, priority: directory.priority });
  }
  return [...names.values()].map(({ component }) => component).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

function physicalIdentity(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

async function collectComponents(directories: readonly ComponentDirectory[]): Promise<readonly DiscoveredComponent[]> {
  const files: { directory: ComponentDirectory; file: string; identity: string }[] = [];
  for (const directory of directories) {
    if (directory.sourceRoot && existsSync(directory.dir)) {
      const path = relative(await realpath(directory.sourceRoot), await realpath(directory.dir));
      if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error(`Directorio de componentes fuera de su fuente: ${directory.dir}`);
    }
    for (const file of await filesIn(directory.dir)) if (file.endsWith(".meeko")) files.push({ directory, file, identity: physicalIdentity(await realpath(file)) });
  }
  return catalog(files);
}

function collectComponentsSync(directories: readonly ComponentDirectory[]): readonly DiscoveredComponent[] {
  const files: { directory: ComponentDirectory; file: string; identity: string }[] = [];
  for (const directory of directories) {
    if (directory.sourceRoot && existsSync(directory.dir)) {
      const path = relative(realpathSync(directory.sourceRoot), realpathSync(directory.dir));
      if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error(`Directorio de componentes fuera de su fuente: ${directory.dir}`);
    }
    for (const file of filesInSync(directory.dir)) if (file.endsWith(".meeko")) files.push({ directory, file, identity: physicalIdentity(realpathSync(file)) });
  }
  return catalog(files);
}

/** Discover configured, layered and module-provided `.meeko` components. */
export async function discoverComponents(root: string): Promise<readonly DiscoveredComponent[]> {
  const config = await loadMeekoConfig(root);
  const sources = await resolveConfigSources(root, config);
  const modules = await resolveMeekoModules(root, config);
  return collectComponents(componentDirectoriesForSources(sources, config, modules.componentsDirs));
}

/** Static counterpart for an untrusted editor workspace; does not execute modules. */
export function discoverComponentsSync(root: string): readonly DiscoveredComponent[] {
  const config = readMeekoConfigSync(root);
  return collectComponentsSync(componentDirectoriesForSources(staticComponentSources(root, config), config));
}

function staticComponentSources(root: string, config: MeekoConfig): readonly { root: string; name: string }[] {
  const sources = [{ root: resolve(root), name: "app" }];
  for (const entry of [...(config.extends ?? []), ...(config.layers ?? []), ...legacyLayerEntries(root, config)]) {
    const sourceRoot = resolve(root, entry);
    const path = relative(root, sourceRoot);
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error(`Una fuente de componentes configurada sale de la raíz del proyecto: ${entry}`);
    sources.push({ root: sourceRoot, name: entry });
  }
  return sources;
}

function addComponentImports(result: AutoImport[], components: readonly DiscoveredComponent[]): void {
  for (const { name, file } of components) {
    addAutoImport(result, { name, imported: "*", file, scope: "app", typeOnly: false, component: true });
    for (const [suffix, imported] of componentTypes) addAutoImport(result, { name: `${name}${suffix}`, imported, file, scope: "app", typeOnly: true, component: false, componentType: true });
  }
}

/**
 * Construye el registro a partir de exports sintácticos, sin ejecutar módulos de la aplicación. La
 * configuración sí se ejecuta, con sus módulos: sus carpetas de componentes y autoimports y sus
 * entradas de `addAutoImports` forman parte del registro.
 */
export async function discoverAutoImports(root: string): Promise<AutoImport[]> {
  const result: AutoImport[] = builtins(root);
  const config = await loadMeekoConfig(root);
  const sources = await resolveConfigSources(root, config);
  const modules = await resolveMeekoModules(root, config);
  addComponentImports(result, await collectComponents(componentDirectoriesForSources(sources, config, modules.componentsDirs)));
  for (const source of sources) {
    for (const directory of autoImportDirectories(config.imports)) {
      for (const file of await filesIn(join(source.root, directory))) {
        if (extname(file) !== ".meeko") addFileImports(result, source.root, directory, file, await readFile(file, "utf8"));
      }
    }
  }
  for (const { dir, scope } of modules.autoImportsDirs) {
    for (const file of await filesIn(dir)) {
      if (extname(file) !== ".meeko") addFileImports(result, dir, "", file, await readFile(file, "utf8"), { scope });
    }
  }
  for (const entry of modules.autoImports) {
    addAutoImport(result, {
      name: entry.as, imported: entry.name, file: entry.from, scope: entry.scope, typeOnly: entry.type, component: false, browserCode: entry.componentOnly,
      ...(entry.specifier ? { specifier: entry.from } : {}),
    });
  }
  return withoutYieldedEntries(result);
}

/**
 * Same static registry used by the synchronous VS Code Language Service. It never executes the
 * configuration: `layers`, `extends` and the layer folders listed in `modules` take part, the
 * modules do not.
 */
export function discoverAutoImportsSync(root: string): AutoImport[] {
  const result = builtins(root);
  const config = readMeekoConfigSync(root);
  addComponentImports(result, collectComponentsSync(componentDirectoriesForSources(staticComponentSources(root, config), config)));
  const sourceRoots = [resolve(root)];
  for (const entry of [...(config.extends ?? []), ...(config.layers ?? []), ...legacyLayerEntries(root, config)]) {
    const sourceRoot = resolve(root, entry);
    const path = relative(root, sourceRoot);
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error(`Una fuente de autoimports configurada sale de la raíz del proyecto: ${entry}`);
    sourceRoots.push(sourceRoot);
  }
  for (const sourceRoot of sourceRoots) {
    for (const directory of autoImportDirectories(config.imports)) {
      for (const file of filesInSync(join(sourceRoot, directory))) {
        if (extname(file) !== ".meeko") addFileImports(result, sourceRoot, directory, file, readFileSync(file, "utf8"));
      }
    }
  }
  return withoutYieldedEntries(result);
}

/**
 * The autoimport folders of each source root, relative to it with `/`: the default ones, then those
 * of `imports.appDirs`, `sharedDirs` and `serverDirs`. A configured folder that repeats a default
 * one, or lies inside another listed folder, is left out: that folder already reads its files.
 */
export function autoImportDirectories(imports: MeekoConfig["imports"]): readonly string[] {
  const result: string[] = [...directories];
  for (const option of importDirectoryOptions) {
    for (const raw of imports?.[option] ?? []) {
      const directory = normalizeImportDirectory(option, raw);
      if (directory === undefined) {
        throw new Error(`imports.${option} de autoimports debe ser una ruta relativa dentro de ${option.replace(/Dirs$/, "")}/: ${raw}`);
      }
      result.push(directory);
    }
  }
  const unique = [...new Set(result)];
  return unique.filter((directory) => !unique.some((other) => other !== directory && directory.startsWith(`${other}/`)));
}

