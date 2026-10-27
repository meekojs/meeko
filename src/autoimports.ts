import { readdir, readFile } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import ts from "@typescript/typescript6";
import { compile } from "./compiler.js";
import type { CompileOptions, CompileResult } from "./compiler.js";
import { projectRoot } from "./compiler/project-root.js";
import { parseSfc } from "./compiler/sfc.js";
import { loadMeekoConfig, readMeekoConfigSync, resolveConfigSources } from "./framework/config.js";

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
}

const directories = [
  "app/components", "app/composables", "app/utils", "app/stores",
  "shared/types", "shared/schemas", "shared/utils", "shared/constants", "shared/enums",
  "server/utils",
] as const;

function scopeOf(file: string): ImportScope {
  if (/\.shared\.[cm]?tsx?$/.test(file)) return "shared";
  if (/\.server\.[cm]?tsx?$/.test(file)) return "server";
  if (/\.client\.[cm]?tsx?$/.test(file)) return "client";
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

function builtins(root: string): AutoImport[] {
  const entries: AutoImport[] = [
    ...["signal", "computed", "effect", "batch", "onCleanup", "onMounted", "provide", "inject", "createContext", "provideErrorHandler"].map((name): AutoImport => ({ name, imported: name, file: "@meekojs/meeko", specifier: "@meekojs/meeko", scope: "shared", typeOnly: false, component: false })),
    ...["useState", "href", "useRoute", "useForm", "useStorage"].map((name): AutoImport => ({ name, imported: name, file: "@meekojs/meeko/framework", specifier: "@meekojs/meeko/framework", scope: "shared", typeOnly: false, component: false })),
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
const yieldingBuiltins: ReadonlySet<string> = new Set(["useRoute", "useForm", "useStorage", "useApiMutation"]);

function isGeneratedClient(file: string): boolean {
  return /[\\/]\.meeko[\\/]generated[\\/]clients\.(?:client|server)\.ts$/.test(file);
}

function isYieldingBuiltin(entry: AutoImport): boolean {
  return yieldingBuiltins.has(entry.name) && (entry.specifier === "@meekojs/meeko/framework" || isGeneratedClient(entry.file));
}

function withoutShadowedBuiltins(result: AutoImport[]): AutoImport[] {
  return result.filter((entry) => !(isYieldingBuiltin(entry)
    && result.some((other) => other.name === entry.name && !isYieldingBuiltin(other))));
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

function addFileImports(result: AutoImport[], root: string, directory: string, file: string, source?: string): void {
  const scope = scopeOf(file);
  if (extname(file) === ".meeko") {
    if (directory !== "app/components") return;
    const path = relative(join(root, directory), file).replace(/\.meeko$/, "");
    const name = path.split(/[\\/]/).map((part) => part.replace(/(^|[-_])(\w)/g, (_, _dash: string, letter: string) => letter.toUpperCase())).join("");
    addAutoImport(result, { name, imported: "*", file, scope, typeOnly: false, component: true });
    return;
  }
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

/** Construye el registro a partir de exports sintácticos, sin ejecutar módulos de la aplicación. */
export async function discoverAutoImports(root: string): Promise<AutoImport[]> {
  const result: AutoImport[] = builtins(root);
  const config = await loadMeekoConfig(root);
  const sources = await resolveConfigSources(root, config);
  for (const source of sources) {
    for (const directory of configuredDirectories(config.imports?.serverDirs)) {
      for (const file of await filesIn(join(source.root, directory))) {
        addFileImports(result, source.root, directory, file, extname(file) === ".meeko" ? undefined : await readFile(file, "utf8"));
      }
    }
  }
  return withoutShadowedBuiltins(result);
}

/** Same static registry used by the synchronous VS Code Language Service. */
export function discoverAutoImportsSync(root: string): AutoImport[] {
  const result = builtins(root);
  const config = readMeekoConfigSync(root);
  const sourceRoots = [resolve(root)];
  for (const entry of [...(config.extends ?? []), ...(config.modules ?? [])]) {
    const sourceRoot = resolve(root, entry);
    const path = relative(root, sourceRoot);
    if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error(`Una fuente de autoimports configurada sale de la raíz del proyecto: ${entry}`);
    sourceRoots.push(sourceRoot);
  }
  for (const sourceRoot of sourceRoots) {
    for (const directory of configuredDirectories(config.imports?.serverDirs)) {
      for (const file of filesInSync(join(sourceRoot, directory))) {
        addFileImports(result, sourceRoot, directory, file, extname(file) === ".meeko" ? undefined : readFileSync(file, "utf8"));
      }
    }
  }
  return withoutShadowedBuiltins(result);
}

function configuredDirectories(serverDirs: readonly string[] | undefined): readonly string[] {
  const result = new Set<string>(directories);
  for (const raw of serverDirs ?? []) {
    const directory = raw.replaceAll("\\", "/").replace(/\/$/, "");
    const parts = directory.split("/");
    if (parts[0] !== "server" || parts.length < 2 || parts.some((part) => !part || part === "." || part === "..")) {
      throw new Error(`serverDir de autoimports debe ser una ruta relativa dentro de server/: ${raw}`);
    }
    result.add(directory);
  }
  return [...result];
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

/** Añade imports ESM para referencias libres del módulo generado. */
export function applyAutoImports(code: string, filename: string, registry: readonly AutoImport[], target: "client" | "server" | "shared"): string {
  const ast = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const referenced = new Set<string>();
  // Names read at runtime; the others only appear in types and need `import type`
  // under `verbatimModuleSyntax`, which keeps every value import in the output.
  const values = new Set<string>();
  const visit = (node: ts.Node, scopes: readonly Set<string>[], inType: boolean): void => {
    const active = introducesScope(node) ? [...scopes, scopeNames(node)] : scopes;
    const typePosition = inType || startsTypePosition(node);
    if (ts.isIdentifier(node) && isReference(node) && !active.some((scope) => scope.has(node.text))) {
      referenced.add(node.text);
      if (!typePosition) values.add(node.text);
    }
    ts.forEachChild(node, (child) => visit(child, active, typePosition));
  };
  visit(ast, [], false);
  const imports: string[] = [];
  for (const name of [...referenced].sort()) {
    const candidates = registry.filter((entry) => entry.name === name);
    if (candidates.length === 0) continue;
    const allowed = candidates.filter((entry) => entry.scope === "shared" || entry.scope === target || (target !== "shared" && entry.scope === "app"));
    if (allowed.length === 0) throw new Error(`El autoimport ${name} no está disponible en el ámbito ${target}`);
    if (allowed.length > 1) throw new Error(`Autoimport ambiguo ${name}: ${allowed.map((entry) => entry.file).join(", ")}`);
    const entry = allowed[0]!;
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
  return applyAutoImports(code, filename, registry, target);
}

/** Compile result shared by Vite, CLI checks and declaration generation. */
export async function compileWithAutoImports(source: string, filename: string, options: CompileOptions = {}, target: "client" | "server" = "client", knownRegistry?: readonly AutoImport[]): Promise<CompileResult> {
  const compiled = compile(source, filename, options);
  const registry = knownRegistry ?? await discoverAutoImports(projectRoot(filename));
  const code = transformAutoImports(source, filename, compiled.code, registry, target);
  const offset = code.length - compiled.code.length;
  return {
    ...compiled,
    code,
    mappings: offset ? compiled.mappings.map((mapping) => ({ ...mapping, generatedStart: mapping.generatedStart + offset, generatedEnd: mapping.generatedEnd + offset })) : compiled.mappings,
  };
}
