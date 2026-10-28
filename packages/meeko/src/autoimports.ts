import { readdir, readFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { compile } from "./compiler.js";
import type { CompileOptions, CompileResult } from "./compiler.js";
import type { PathAlias } from "./compiler/aliases.js";
import { checkClientBoundary } from "./compiler/client-boundary.js";
import { projectRoot } from "./compiler/project-root.js";
import { parseSfc } from "./compiler/sfc.js";
import type { CompileDiagnostic } from "./compiler/sfc.js";
import { importDirectoryOptions, loadMeekoConfig, normalizeImportDirectory, readMeekoConfigSync, readThemeEnabledSync, resolveConfigSources } from "./framework/config.js";
import type { MeekoConfig } from "./framework/config.js";
import { legacyLayerEntries, resolveMeekoModules } from "./framework/module-loader.js";
import { resolveProjectAliases, resolveProjectAliasesSync } from "./framework/aliases.js";
import type { ProjectAliases } from "./framework/aliases.js";

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
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
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
    ...["useState", "href", "useRoute", "useForm", "useStorage", "useHead", "useSeoMeta", "useTheme", "useLayout", "definePage", "defineGroup", "defineRouteMiddleware", "definePlugin"].map((name): AutoImport => ({ name, imported: name, file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "shared", typeOnly: false, component: false })),
    // The definitions of server/ (contract discovery reads the call by name, not by its import).
    ...["defineApiRoute", "defineRpc", "defineServerMiddleware", "defineSocketChannel", "defineServerRuntime"].map((name): AutoImport => ({ name, imported: name, file: "@meekojs/meeko/server", specifier: "@meekojs/meeko/server", scope: "server", typeOnly: false, component: false })),
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
const yieldingBuiltins: ReadonlySet<string> = new Set(["useRoute", "useForm", "useStorage", "useApiMutation", "useHead", "useSeoMeta", "useTheme", "useId", "useLayout", "defineGroup", "ClientError", "isClientError", ...frameworkTypes]);

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
  readonly components?: boolean;
  readonly prefix?: string;
  readonly scope?: ImportScope;
}

function addFileImports(result: AutoImport[], root: string, directory: string, file: string, source?: string, module?: ModuleDirectory): void {
  const scope = module?.scope && !/\.(?:shared|server|client)\.[cm]?tsx?$/.test(file) ? module.scope : scopeOf(file, module ? undefined : directory);
  if (extname(file) === ".meeko") {
    if (!(module ? module.components : directory === "app/components")) return;
    const path = relative(join(root, directory), file).replace(/\.meeko$/, "");
    const name = (module?.prefix ?? "") + path.split(/[\\/]/).map((part) => part.replace(/(^|[-_])(\w)/g, (_, _dash: string, letter: string) => letter.toUpperCase())).join("");
    addAutoImport(result, { name, imported: "*", file, scope, typeOnly: false, component: true });
    for (const [suffix, imported] of componentTypes) {
      addAutoImport(result, { name: `${name}${suffix}`, imported, file, scope, typeOnly: true, component: false, componentType: true });
    }
    return;
  }
  if (module?.components) return;
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

/**
 * Construye el registro a partir de exports sintácticos, sin ejecutar módulos de la aplicación. La
 * configuración sí se ejecuta, con sus módulos: sus carpetas de componentes y autoimports y sus
 * entradas de `addAutoImports` forman parte del registro.
 */
export async function discoverAutoImports(root: string): Promise<AutoImport[]> {
  const result: AutoImport[] = builtins(root);
  const config = await loadMeekoConfig(root);
  const sources = await resolveConfigSources(root, config);
  for (const source of sources) {
    for (const directory of autoImportDirectories(config.imports)) {
      for (const file of await filesIn(join(source.root, directory))) {
        addFileImports(result, source.root, directory, file, extname(file) === ".meeko" ? undefined : await readFile(file, "utf8"));
      }
    }
  }
  const modules = await resolveMeekoModules(root, config);
  for (const { dir, prefix } of modules.componentsDirs) {
    for (const file of await filesIn(dir)) addFileImports(result, dir, "", file, undefined, { components: true, prefix, scope: "app" });
  }
  for (const { dir, scope } of modules.autoImportsDirs) {
    for (const file of await filesIn(dir)) {
      if (extname(file) !== ".meeko") addFileImports(result, dir, "", file, await readFile(file, "utf8"), { scope });
    }
  }
  for (const entry of modules.autoImports) {
    addAutoImport(result, {
      name: entry.as, imported: entry.name, file: entry.from, scope: entry.scope, typeOnly: entry.type, component: false,
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
        addFileImports(result, sourceRoot, directory, file, extname(file) === ".meeko" ? undefined : readFileSync(file, "utf8"));
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

function bindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) names.add(name.text);
  else for (const element of name.elements) if (ts.isBindingElement(element)) bindingNames(element.name, names);
}

function scopeNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  if (ts.isFunctionLike(node)) {
    for (const parameter of node.parameters) bindingNames(parameter.name, names);
    for (const parameter of node.typeParameters ?? []) names.add(parameter.name.text);
  }
  if (ts.isCatchClause(node) && node.variableDeclaration) bindingNames(node.variableDeclaration.name, names);
  if (ts.isForStatement(node) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
    for (const declaration of node.initializer.declarations) bindingNames(declaration.name, names);
  }
  if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && ts.isVariableDeclarationList(node.initializer)) {
    for (const declaration of node.initializer.declarations) bindingNames(declaration.name, names);
  }
  // The clauses of a `switch` share one scope.
  const statements = ts.isSourceFile(node) || ts.isBlock(node) ? node.statements
    : ts.isCaseBlock(node) ? node.clauses.flatMap((clause) => [...clause.statements]) : undefined;
  if (statements) {
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, names);
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) names.add(statement.name.text);
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.name) names.add(clause.name.text);
        if (clause?.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) names.add(clause.namedBindings.name.text);
          else for (const element of clause.namedBindings.elements) names.add(element.name.text);
        }
      }
    }
  }
  return names;
}

function introducesScope(node: ts.Node): boolean {
  return ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node) || ts.isCatchClause(node)
    || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isCaseBlock(node);
}

function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isPropertyDeclaration(parent) && parent.name === node) return false;
  if (ts.isMethodDeclaration(parent) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  if (ts.isTypeReferenceNode(parent) && parent.typeName === node) return true;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isTypeParameterDeclaration(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)) && parent.name === node) return false;
  if (ts.isPropertySignature(parent) && parent.name === node) return false;
  // Labels of `outer: for (...)`, `break outer` and `continue outer` name no value.
  if ((ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) && parent.label === node) return false;
  return true;
}

/**
 * Whether a node starts a type-only position. `ExpressionWithTypeArguments` is a type node
 * only in `implements` and interface `extends`; a class `extends` and an instantiation
 * expression evaluate it. `typeof X` in a type is allowed on a type-only import.
 */
function startsTypePosition(node: ts.Node): boolean {
  if (ts.isExpressionWithTypeArguments(node)) {
    const clause = node.parent;
    return ts.isHeritageClause(clause) && (clause.token === ts.SyntaxKind.ImplementsKeyword || ts.isInterfaceDeclaration(clause.parent));
  }
  return ts.isTypeNode(node);
}

/** Names that the registry imports as values; a component named like a built-in tag replaces it. */
export function autoImportedValues(registry: readonly AutoImport[]): string[] {
  return registry.filter((entry) => !entry.typeOnly).map((entry) => entry.name);
}

/** A free reference of a module: a name that no declaration or import of the module binds. */
export interface FreeReference {
  readonly name: string;
  /** Offset of the identifier in the module. */
  readonly start: number;
  /** Read at run time; `false` for a name that only appears in a type. */
  readonly value: boolean;
}

/**
 * The free references of a module, in source order: the names that `applyAutoImports` would
 * resolve against the registry.
 */
export function freeReferences(code: string, filename: string): FreeReference[] {
  const ast = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: FreeReference[] = [];
  const visit = (node: ts.Node, scopes: readonly Set<string>[], inType: boolean): void => {
    const active = introducesScope(node) ? [...scopes, scopeNames(node)] : scopes;
    const typePosition = inType || startsTypePosition(node);
    if (ts.isIdentifier(node) && isReference(node) && !active.some((scope) => scope.has(node.text))) {
      found.push({ name: node.text, start: node.getStart(ast), value: !typePosition });
    }
    ts.forEachChild(node, (child) => visit(child, active, typePosition));
  };
  visit(ast, [], false);
  return found;
}

/**
 * Route ID of a page component (`app/pages/**` without a `+` file), from the `.meeko` file or the
 * editor's virtual `.meeko.ts` of its `<script>`; undefined for anything else.
 */
function pageComponentRouteId(filename: string): string | undefined {
  const path = filename.replaceAll("\\", "/");
  const match = /\/app\/pages\/(.+)\.meeko(?:\.ts)?$/.exec(path);
  if (!match) return undefined;
  const parts = match[1]!.split("/");
  if (parts.at(-1)!.startsWith("+")) return undefined;
  if (parts.at(-1) === "index") parts.pop();
  const visible = parts.filter((part) => !/^\([^/()]+\)$/.test(part));
  return visible.length ? `/${visible.join("/")}` : "/";
}

/**
 * Añade imports ESM para referencias libres del módulo generado. `source` es el ámbito del archivo
 * cuando difiere del grafo que lo carga: `"app"` para un componente o un módulo de `app/` en el
 * grafo SSR. Por defecto, el de `target`.
 */
export function applyAutoImports(code: string, filename: string, registry: readonly AutoImport[], target: "client" | "server" | "shared", source: ImportScope = target): string {
  const referenced = new Set<string>();
  // Names read at runtime; the others only appear in types and need `import type`
  // under `verbatimModuleSyntax`, which keeps every value import in the output.
  const values = new Set<string>();
  for (const reference of freeReferences(code, filename)) {
    referenced.add(reference.name);
    if (reference.value) values.add(reference.name);
  }
  const imports: string[] = [];
  for (const name of [...referenced].sort()) {
    const candidates = registry.filter((entry) => entry.name === name);
    if (candidates.length === 0) continue;
    const allowed = candidates.filter((entry) => (entry.scope === "shared" || entry.scope === target || (target !== "shared" && entry.scope === "app"))
      && !(entry.browserCode && source === "server"));
    if (allowed.length === 0) throw new Error(`El autoimport ${name} no está disponible en el ámbito ${target}`);
    if (allowed.length > 1) throw new Error(`Autoimport ambiguo ${name}: ${allowed.map((entry) => entry.file).join(", ")}`);
    const entry = allowed[0]!;
    const layoutRoute = name === "useLayout" && entry.specifier === "@meekojs/meeko/framework" && values.has(name) ? pageComponentRouteId(filename) : undefined;
    if (layoutRoute !== undefined) {
      // In a page, useLayout() is typed with the page's own layout; the type argument is erased.
      imports.push(
        'import { useLayout as __meeko_useLayout } from "@meekojs/meeko/framework";',
        `const useLayout = __meeko_useLayout<import("@meekojs/meeko/framework").PageLayout<${JSON.stringify(layoutRoute)}>>;`,
      );
      continue;
    }
    let specifier = entry.specifier ?? relative(resolve(filename, ".."), entry.file).replaceAll("\\", "/");
    if (!entry.specifier && !specifier.startsWith(".")) specifier = `./${specifier}`;
    if (!entry.component && !entry.specifier) specifier = specifier.replace(/\.[cm]?ts$/, ".js");
    if (entry.component) imports.push(`import * as ${name} from ${JSON.stringify(specifier)};`);
    else imports.push(`import ${entry.typeOnly || !values.has(name) ? "type " : ""}{ ${entry.imported} as ${name} } from ${JSON.stringify(specifier)};`);
  }
  return imports.length ? `${imports.join("\n")}\n${code}` : code;
}

/** Transforma un SFC usando exactamente el mismo compilador que el plugin Vite. */
export function transformAutoImports(source: string, filename: string, code: string, registry: readonly AutoImport[], target: "client" | "server"): string {
  parseSfc(source, filename);
  // A component outside server/ also runs in the browser, even when the SSR graph loads it.
  const scope = target === "server" && !/^server[\\/]/.test(relative(projectRoot(filename), resolve(filename))) ? "app" : target;
  return applyAutoImports(code, filename, registry, target, scope);
}

/**
 * `MEEK108`, `MEEK073` and `MEEK109` of a compiled browser component (one outside `server/`), whose
 * `<script>` and template also run in the browser: throws the first error, returns the warnings.
 */
export function checkComponentBoundary(
  source: string, filename: string, compiled: Pick<CompileResult, "code" | "mappings">, registry: readonly AutoImport[],
  serverDirectories: readonly string[], aliases?: readonly PathAlias[],
): CompileDiagnostic[] {
  return checkClientBoundary({
    source, filename, code: compiled.code, mappings: compiled.mappings, registry, serverDirectories,
    references: freeReferences(compiled.code, filename), ...(aliases ? { aliases } : {}),
  });
}

/**
 * Compile result shared by Vite, CLI checks and declaration generation. `knownAliases` are the
 * project's path aliases; without them, the configuration is loaded as `meeko check` does, or read
 * without running it when `knownRegistry` is given.
 */
export async function compileWithAutoImports(
  source: string, filename: string, options: CompileOptions = {}, target: "client" | "server" = "client",
  knownRegistry?: readonly AutoImport[], knownAliases?: ProjectAliases,
): Promise<CompileResult> {
  const root = projectRoot(filename);
  const registry = knownRegistry ?? await discoverAutoImports(root);
  // `<MeekoThemeToggle>` needs `theme`; the configuration is read without running it, as in the editor.
  const theme = options.theme ?? readThemeEnabledSync(root);
  const compiled = compile(source, filename, { ...options, projectComponents: autoImportedValues(registry), ...(theme === undefined ? {} : { theme }) });
  // Before the autoimports, which would only report a server autoimport as unavailable.
  let boundary: CompileDiagnostic[] = [];
  if (target === "client") {
    // A known registry comes from the editor, which may not run the configuration: read it statically.
    const project = knownAliases ?? (knownRegistry ? resolveProjectAliasesSync(root) : await resolveProjectAliases(root));
    const serverDirectories = [...new Set([join(root, "server"), ...project.sourceRoots.map((entry) => join(entry, "server"))])];
    boundary = checkComponentBoundary(source, filename, compiled, registry, serverDirectories, project.aliases);
  }
  const code = transformAutoImports(source, filename, compiled.code, registry, target);
  const offset = code.length - compiled.code.length;
  const warnings = [...compiled.warnings ?? [], ...boundary];
  return {
    ...compiled,
    code,
    mappings: offset ? compiled.mappings.map((mapping) => ({ ...mapping, generatedStart: mapping.generatedStart + offset, generatedEnd: mapping.generatedEnd + offset })) : compiled.mappings,
    ...(warnings.length ? { warnings } : {}),
  };
}
