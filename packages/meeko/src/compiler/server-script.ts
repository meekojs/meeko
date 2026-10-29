import ts from "@typescript/typescript6";
import { compileError } from "./sfc.js";
import type { SfcSection } from "./sfc.js";

/** Request APIs of a page's top-level server code, exported by `@meekojs/meeko/framework`. */
export const pageRequestApis = ["usePage", "redirect", "notFound"] as const;
export type PageRequestApi = (typeof pageRequestApis)[number];

/**
 * Head APIs that, called at the top level of `<script server>`, add to the page head of each
 * request: the block then has top-level code. They also work in components, so the component
 * `<script>` may use them.
 */
const pageHeadApis: readonly string[] = ["useHead", "useSeoMeta"];

export const frameworkModule = "@meekojs/meeko/framework";

/** A name bound by `<script server>`; offsets are in the `.meeko` file. */
export interface ServerBinding {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

/** A top-level statement of the block and its role once the block has top-level code. */
export interface ServerStatement {
  readonly kind: "import" | "type" | "route" | "body";
  readonly start: number;
  readonly end: number;
  /** The `export` keyword of a data export, removed when the statement runs per request. */
  readonly exportKeyword?: { readonly start: number; readonly end: number };
}

/** What a page's `<script server lang="ts">` declares. */
export interface ServerScript {
  /**
   * The block has top-level server code: statements that run per request and
   * whose exports become the page's data. Without it the block only declares
   * `export const route = definePage({ ... })`, as before 1.1.
   */
  readonly body: boolean;
  readonly statements: readonly ServerStatement[];
  /** `export const|let` names sent to the page, in declaration order. */
  readonly exports: readonly ServerBinding[];
  /** `export const head`, which sets the page head and stays on the server. */
  readonly head?: ServerBinding | undefined;
  /** `export const route = ...`: the statement and its initializer. */
  readonly route?: { readonly start: number; readonly end: number; readonly initializerStart: number; readonly initializerEnd: number } | undefined;
  /** Request APIs used without an import or a declaration of the same name. */
  readonly implicit: readonly PageRequestApi[];
  /** `usePage` imports from the framework: the local name and the specifier text to drop in typed copies. */
  readonly usePageImports: ReadonlyArray<{ readonly local: string; readonly start: number; readonly end: number }>;
}

function bindingNames(name: ts.BindingName, names: Set<string>): void {
  if (ts.isIdentifier(name)) names.add(name.text);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, names);
}

/** Identifiers that a binding name declares: the name itself or each one of a destructuring pattern. */
export function bindingIdentifiers(name: ts.BindingName, found: ts.Identifier[]): void {
  if (ts.isIdentifier(name)) found.push(name);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingIdentifiers(element.name, found);
}

/** Names declared directly in a block-like scope or by a function-like node. */
function scopeNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  if (ts.isFunctionLike(node)) {
    for (const parameter of node.parameters) bindingNames(parameter.name, names);
    if (ts.isFunctionExpression(node) && node.name) names.add(node.name.text);
  }
  if (ts.isCatchClause(node) && node.variableDeclaration) bindingNames(node.variableDeclaration.name, names);
  if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
    for (const declaration of node.initializer.declarations) bindingNames(declaration.name, names);
  }
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node)) {
    const statements = ts.isCaseBlock(node) ? node.clauses.flatMap((clause) => [...clause.statements]) : node.statements;
    for (const statement of statements) {
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, names);
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) names.add(statement.name.text);
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
  return ts.isBlock(node) || ts.isFunctionLike(node) || ts.isCatchClause(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node)
    || ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node);
}

function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent)
    || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent)) && parent.name === node) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  if ((ts.isParameter(parent) || ts.isVariableDeclaration(parent) || ts.isBindingElement(parent) || ts.isTypeParameterDeclaration(parent)
    || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent)
    || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isModuleDeclaration(parent)) && parent.name === node) return false;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
  if (ts.isJsxAttribute(parent)) return false;
  return true;
}

/**
 * Calls `found` for each value reference under `root` that is not declared by a
 * scope inside it. `nested` is true inside a function, which runs later.
 */
function visitReferences(root: ts.Node, found: (identifier: ts.Identifier, nested: boolean) => void): void {
  const visit = (node: ts.Node, scopes: readonly Set<string>[], nested: boolean): void => {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return;
    if (ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent) && node.parent.token === ts.SyntaxKind.ImplementsKeyword) return;
    const active = introducesScope(node) ? [...scopes, scopeNames(node)] : scopes;
    const inFunction = nested || (ts.isFunctionLike(node) && node !== root);
    if (ts.isIdentifier(node) && isReference(node) && !active.some((scope) => scope.has(node.text))) found(node, nested);
    ts.forEachChild(node, (child) => visit(child, active, inFunction));
  };
  visit(root, [], false);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false);
}

function typeOnlyStatement(statement: ts.Statement): boolean {
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isModuleDeclaration(statement)) return true;
  if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) return true;
  return ts.isExportDeclaration(statement) && (statement.isTypeOnly
    || (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.length > 0
      && statement.exportClause.elements.every((element) => element.isTypeOnly)));
}

/** The expression inside parentheses, `as`, `satisfies`, `<T>` and `!`. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
  return current;
}

/**
 * The function around `node` that Meeko calls after the top-level code has run, to compute the
 * head: `export const head = () => ...` (`headFunction`) or the one passed to `useHead` or
 * `useSeoMeta`. Undefined when `node` is in no such function.
 */
function laterHeadFunction(node: ts.Node, headFunction: ts.Expression | undefined, headApis: ReadonlySet<string>): string | undefined {
  for (let current: ts.Node = node; !ts.isSourceFile(current); current = current.parent) {
    if (!ts.isArrowFunction(current) && !ts.isFunctionExpression(current)) continue;
    if (current === headFunction) return "export const head = () => ...";
    let argument: ts.Node = current;
    while (ts.isParenthesizedExpression(argument.parent) || ts.isAsExpression(argument.parent) || ts.isSatisfiesExpression(argument.parent)) argument = argument.parent;
    const call = argument.parent;
    if (ts.isCallExpression(call) && call.arguments.some((entry) => entry === argument) && ts.isIdentifier(call.expression) && headApis.has(call.expression.text)) {
      return `${call.expression.text}(() => ...)`;
    }
  }
  return undefined;
}

/** The options object of `definePage({ ... })`, `{ ... } satisfies X` and similar wrappers. */
function optionsObject(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  let current = expression;
  while (true) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
      || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)) current = current.expression;
    else if (ts.isCallExpression(current) && current.arguments.length > 0) current = current.arguments[0]!;
    else return ts.isObjectLiteralExpression(current) ? current : undefined;
  }
}

function optionProperty(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((property) => {
    const key = property.name;
    return key !== undefined && (ts.isIdentifier(key) || ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) && key.text === name;
  });
}

const emptyScript: ServerScript = { body: false, statements: [], exports: [], implicit: [], usePageImports: [] };

/**
 * What only exists in a component's `<script>`: the compiler macros, which the compiler replaces
 * there, and `onMounted`, which needs a component being mounted. `<script server>` runs outside any
 * component, before the page renders (or in the browser as the loader of a `render: "client"` page).
 */
const componentApis: ReadonlySet<string> = new Set(["defineProps", "defineEmits", "defineExpose", "defineModel", "defineSnippets", "useElementRef", "onMounted"]);

/** MEEK108: a component API used in `<script server>`, without a declaration of the same name, or `onMounted` imported. */
function checkComponentApis(file: ts.SourceFile, moduleNames: ReadonlySet<string>, fail: (code: string, message: string, node: ts.Node) => never): void {
  const report = (name: string, node: ts.Node): never => fail(
    "MEEK108",
    `${name}${name === "onMounted" ? "()" : ""} sólo existe en el <script> de un componente: <script server> se ejecuta fuera del componente, antes de renderizar la página. Muévelo al <script lang="ts">`,
    node,
  );
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      if (statement.importClause?.isTypeOnly || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "@meekojs/meeko" || !bindings || !ts.isNamedImports(bindings)) continue;
      const mounted = bindings.elements.find((element) => !element.isTypeOnly && (element.propertyName ?? element.name).text === "onMounted");
      if (mounted) report("onMounted", mounted);
      continue;
    }
    if (typeOnlyStatement(statement)) continue;
    visitReferences(statement, (identifier) => {
      if (componentApis.has(identifier.text) && !moduleNames.has(identifier.text)) report(identifier.text, identifier);
    });
  }
}

/**
 * Reads a page's `<script server lang="ts">` without running it. Rejects the
 * combinations that the generated route module cannot honour. A block with a
 * syntax error is reported as having no top-level code; TypeScript and the
 * bundler report the syntax error itself.
 */
export function analyzeServerScript(source: string, filename: string, section: SfcSection): ServerScript {
  const base = section.contentStart;
  const file = ts.createSourceFile(filename, section.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] };
  if (file.parseDiagnostics.length > 0) return emptyScript;
  const at = (node: ts.Node): number => base + node.getStart(file);
  const fail = (code: string, message: string, node: ts.Node): never => { throw compileError(source, filename, code, message, at(node)); };

  // Request APIs: imported from the framework under any local name, or used without any binding.
  const moduleNames = scopeNames(file);
  const apis = new Map<string, PageRequestApi>();
  const headApis = new Set(pageHeadApis.filter((name) => !moduleNames.has(name)));
  const usePageImports: Array<{ local: string; start: number; end: number }> = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== frameworkModule) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || statement.importClause?.isTypeOnly) continue;
    for (const [index, element] of bindings.elements.entries()) {
      const imported = (element.propertyName ?? element.name).text;
      if (!element.isTypeOnly && pageHeadApis.includes(imported)) headApis.add(element.name.text);
      if (element.isTypeOnly || !(pageRequestApis as readonly string[]).includes(imported)) continue;
      apis.set(element.name.text, imported as PageRequestApi);
      if (imported !== "usePage") continue;
      const elements = bindings.elements;
      const [start, end] = index < elements.length - 1 ? [element.getStart(file), elements[index + 1]!.getStart(file)]
        : index > 0 ? [elements[index - 1]!.getEnd(), element.getEnd()]
          : [element.getStart(file), element.getEnd()];
      usePageImports.push({ local: element.name.text, start: base + start, end: base + end });
    }
  }
  for (const api of pageRequestApis) if (!moduleNames.has(api)) apis.set(api, api);
  checkComponentApis(file, moduleNames, fail);

  const statements: ServerStatement[] = [];
  const exports: ServerBinding[] = [];
  let head: ServerBinding | undefined;
  /** `export const head = () => ...`: Meeko calls it after the top-level code, to compute the head. */
  let headFunction: ts.Expression | undefined;
  let route: { statement: ts.VariableStatement; declaration: ts.VariableDeclaration } | undefined;
  let unsupportedExport: ts.Statement | undefined;
  let body = false;
  const bodyNames = new Set<string>();
  for (const statement of file.statements) {
    const start = at(statement);
    const end = base + statement.getEnd();
    if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) {
      if (ts.isImportEqualsDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) unsupportedExport ??= statement;
      statements.push({ kind: "import", start, end });
      continue;
    }
    if (typeOnlyStatement(statement)) {
      statements.push({ kind: "type", start, end });
      continue;
    }
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    if (ts.isVariableStatement(statement) && exported) {
      const declarations = statement.declarationList.declarations;
      const routeDeclaration = declarations.find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "route");
      if (routeDeclaration) {
        if (declarations.length > 1) unsupportedExport ??= statement;
        route = { statement, declaration: routeDeclaration };
        statements.push({ kind: "route", start, end });
        continue;
      }
      body = true;
      const keyword = ts.getModifiers(statement)!.find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)!;
      statements.push({ kind: "body", start, end, exportKeyword: { start: at(keyword), end: base + keyword.getEnd() } });
      for (const declaration of declarations) {
        const identifiers: ts.Identifier[] = [];
        bindingIdentifiers(declaration.name, identifiers);
        for (const identifier of identifiers) {
          bodyNames.add(identifier.text);
          const binding = { name: identifier.text, start: at(identifier), end: base + identifier.getEnd() };
          if (identifier.text === "head") {
            head = binding;
            if (declaration.initializer && declaration.name === identifier) headFunction = unwrapExpression(declaration.initializer);
          } else exports.push(binding);
        }
      }
      continue;
    }
    // Other export forms were allowed beside route options; they only fail once the block has top-level code.
    if (exported || ts.isExportAssignment(statement) || ts.isExportDeclaration(statement)) unsupportedExport ??= statement;
    statements.push({ kind: "body", start, end });
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, bodyNames);
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) bodyNames.add(statement.name.text);
  }

  // A request API called outside any function runs per request: the block has top-level code.
  const references: Array<{ identifier: ts.Identifier; nested: boolean; inRoute: boolean }> = [];
  let headCall = false;
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) || typeOnlyStatement(statement)) continue;
    const inRoute = statement === route?.statement;
    visitReferences(statement, (identifier, nested) => {
      if (apis.has(identifier.text)) references.push({ identifier, nested, inRoute });
      // useHead() at the top level adds to the head of every request, like `export const head`.
      if (!nested && !inRoute && headApis.has(identifier.text)) headCall = true;
    });
  }
  if (headCall || references.some((reference) => !reference.nested && !reference.inRoute)) body = true;
  const implicit = [...new Set(references.map((reference) => apis.get(reference.identifier.text)!).filter((api) => !moduleNames.has(api)))];

  if (!body) {
    const misplaced = references[0];
    if (misplaced) {
      const api = apis.get(misplaced.identifier.text)!;
      fail("MEEK073", `${api}() sólo funciona en el código de nivel superior de <script server>, que se ejecuta en cada petición; llámala fuera de cualquier función y fuera de las opciones de ruta`, misplaced.identifier);
    }
    return { body: false, statements, exports: [], implicit: [], usePageImports };
  }
  if (unsupportedExport) {
    const kind = ts.isFunctionDeclaration(unsupportedExport) ? "export function"
      : ts.isClassDeclaration(unsupportedExport) ? "export class"
        : ts.isEnumDeclaration(unsupportedExport) ? "export enum"
          : ts.isExportAssignment(unsupportedExport) ? "export default"
            : ts.isVariableStatement(unsupportedExport) ? "export const route con otras declaraciones"
              : "Este export";
    fail("MEEK071", `${kind} no se admite en un <script server> con código de nivel superior: cada export const o export let es un dato de la página, que debe poder serializarse como JSON; declara las opciones de ruta como export const route = definePage({ ... }) en su propia sentencia`, unsupportedExport);
  }
  const misplaced = references.find((reference) => reference.inRoute);
  if (misplaced) {
    const api = apis.get(misplaced.identifier.text)!;
    fail("MEEK073", `${api}() no puede ejecutarse dentro de las opciones de ruta; llámala en el código de nivel superior de <script server>`, misplaced.identifier);
  }
  // A helper that the top-level code calls runs while the page does, so it may use the request
  // APIs. A function that Meeko calls later, to compute the head, has no page running (1.7).
  for (const reference of references) {
    if (!reference.nested) continue;
    const where = laterHeadFunction(reference.identifier, headFunction, headApis);
    if (!where) continue;
    const api = apis.get(reference.identifier.text)!;
    fail("MEEK073", `${api}() no funciona dentro de ${where}: Meeko llama a esa función al calcular el head, cuando el código de nivel superior de <script server> ya terminó. Llama a ${api}() en el nivel superior y usa su valor dentro de la función`, reference.identifier);
  }
  let routeInfo: ServerScript["route"];
  if (route) {
    const initializer = route.declaration.initializer;
    if (initializer) {
      // Route options are read once per module; top-level code runs per request.
      visitReferences(initializer, (identifier) => {
        if (bodyNames.has(identifier.text)) {
          fail("MEEK076", `Las opciones de ruta no pueden leer ${identifier.text}: el código de nivel superior de <script server> se ejecuta en cada petición, después de las opciones. Mueve los valores compartidos a un módulo importado`, identifier);
        }
      });
      const options = optionsObject(initializer);
      const load = options && optionProperty(options, "load");
      if (load) fail("MEEK070", "Un <script server> con código de nivel superior no puede declarar también route.load: sus exports son los datos de la página. Deja el código de nivel superior o el loader", load);
      const routeHead = options && head && optionProperty(options, "head");
      if (routeHead) fail("MEEK072", "<script server> exporta head y además declara route.head; deja sólo uno de los dos", routeHead);
      const render = options && optionProperty(options, "render");
      if (render && ts.isPropertyAssignment(render) && (ts.isStringLiteral(render.initializer) || ts.isNoSubstitutionTemplateLiteral(render.initializer)) && render.initializer.text === "client") {
        fail("MEEK074", 'Una página render: "client" no puede tener código de servidor de nivel superior: su <script server> se ejecuta en el navegador. Pide los datos con useApi o useRpcQuery, o renderiza en el servidor', render);
      }
    }
    routeInfo = {
      start: at(route.statement), end: base + route.statement.getEnd(),
      initializerStart: initializer ? at(initializer) : 0, initializerEnd: initializer ? base + initializer.getEnd() : 0,
    };
  }
  return { body: true, statements, exports, head, route: routeInfo, implicit, usePageImports };
}

/**
 * Checks a component `<script>` against its page's server exports: the request
 * APIs only exist on the server (MEEK073) and an export name must not be
 * declared again in the script (MEEK075).
 */
export function checkClientScript(source: string, filename: string, script: SfcSection, exports: readonly ServerBinding[]): void {
  const file = ts.createSourceFile(filename, script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exported = new Set(exports.map((binding) => binding.name));
  const at = (node: ts.Node): number => script.contentStart + node.getStart(file);
  const collision = (identifier: ts.Identifier): void => {
    if (!exported.has(identifier.text)) return;
    throw compileError(source, filename, "MEEK075", `${identifier.text} ya lo exporta <script server> y está en el ámbito como dato de la página; cambia el nombre de la declaración o del export`, at(identifier));
  };
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const fromFramework = ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === frameworkModule;
      if (clause?.name) collision(clause.name);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) collision(clause.namedBindings.name);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          if (fromFramework && !element.isTypeOnly && !clause.isTypeOnly && (pageRequestApis as readonly string[]).includes(imported)) {
            throw compileError(source, filename, "MEEK073", `${imported}() sólo funciona en el código de nivel superior del <script server> de una página; el <script> del componente también se ejecuta en el navegador`, at(element));
          }
          collision(element.name);
        }
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const identifiers: ts.Identifier[] = [];
        bindingIdentifiers(declaration.name, identifiers);
        identifiers.forEach(collision);
      }
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) collision(statement.name);
  }
}
