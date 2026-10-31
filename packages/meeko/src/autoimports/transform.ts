import { join, relative, resolve } from "node:path";
import ts from "@typescript/typescript6";
import { compile } from "../compiler";
import type { CompileOptions, CompileResult } from "../compiler";
import type { PathAlias } from "../compiler/aliases";
import { checkClientBoundary } from "../compiler/transforms/client-boundary";
import { projectRoot } from "../compiler/project-root";
import { parseSfc } from "../compiler/parser/sfc";
import type { CompileDiagnostic } from "../compiler/parser/sfc";
import { readThemeEnabledSync } from "../framework/config";
import { resolveProjectAliases, resolveProjectAliasesSync } from "../framework/aliases";
import type { ProjectAliases } from "../framework/aliases";
import { autoImportCollision, discoverAutoImports } from "./registry";
import type { AutoImport, ImportScope } from "./registry";

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
    if (allowed.length > 1) throw autoImportCollision(name, allowed);
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
