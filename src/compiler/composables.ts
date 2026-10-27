import ts from "@typescript/typescript6";

/**
 * Composables that the compiler resolves from the top level of a `<script>`. Calling one inside
 * a function, handler, effect or `onMounted` is MEEK054. `useState`, `useSocket`,
 * `useSocketClient` and `useNavigation` keep their 1.0 behavior and may still be called from
 * nested code, as may `useRoute`.
 */
export const topLevelComposables: ReadonlySet<string> = new Set(["useElementRef", "useApi", "useRpcQuery", "useRpcMutation"]);

/**
 * `await` on these continues the setup in the browser, after the component mounts. `useSocket` is
 * the generated `useSocket(channel)` autoimport and the deprecated framework alias of
 * `useSocketClient`.
 */
export const browserAwaits: ReadonlySet<string> = new Set(["useElementRef", "useSocket", "useSocketClient"]);

/** `await` on these suspends the render until the data loads, also during SSR. */
export const dataAwaits: ReadonlySet<string> = new Set(["useApi", "useRpcQuery"]);

/** A top-level `await` that the compiler accepts. */
export interface AwaitSite {
  readonly statement: ts.Statement;
  readonly node: ts.AwaitExpression;
  readonly call: ts.CallExpression;
  readonly name: string;
  readonly browser: boolean;
}

/** A `useElementRef("name")` call. */
export interface ElementRefCall {
  readonly call: ts.CallExpression;
  readonly name: string;
  readonly nameNode: ts.StringLiteralLike;
  readonly awaited: boolean;
}

export interface ScriptComposables {
  /** At most one accepted `await` per top-level statement. */
  readonly awaits: ReadonlyMap<ts.Statement, AwaitSite>;
  /** Index in `file.statements` of the first statement with a browser `await`. */
  readonly split: number | undefined;
  readonly elementRefs: readonly ElementRefCall[];
}

export class ComposableError extends Error {
  constructor(readonly code: string, message: string, readonly node: ts.Node) {
    super(message);
  }
}

function isFunctionBoundary(node: ts.Node): boolean {
  return ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isClassStaticBlockDeclaration(node);
}

/** Identifier of a direct call `name(...)`, not a property or a shadowing declaration. */
function calleeName(call: ts.CallExpression): string | undefined {
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined;
}

const allowedAwaits = [...browserAwaits, ...dataAwaits].join(", ");

/**
 * Checks the composable rules of a script: the top-level-only composables, the top-level
 * `await` forms and the `useElementRef` argument. It finds the statement where the setup
 * splits: the first one that awaits a browser composable.
 */
export function analyzeComposables(file: ts.SourceFile): ScriptComposables {
  const awaits = new Map<ts.Statement, AwaitSite>();
  const elementRefs: ElementRefCall[] = [];
  let split: number | undefined;
  const statementIndex = new Map(file.statements.map((statement, index) => [statement, index]));

  const acceptAwait = (node: ts.AwaitExpression, statement: ts.Statement): void => {
    const parent = node.parent;
    const whole = (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isVariableStatement(statement))
      || (ts.isExpressionStatement(parent) && parent === statement);
    const call = ts.isCallExpression(node.expression) ? node.expression : undefined;
    const name = call ? calleeName(call) : undefined;
    if (name === "useRpcMutation") {
      throw new ComposableError("MEEK055", "useRpcMutation no se puede esperar con await; llámalo sin await y espera su mutate(input) en un handler", node);
    }
    if (!call || !name || (!browserAwaits.has(name) && !dataAwaits.has(name))) {
      throw new ComposableError("MEEK055", `El await de nivel superior sólo se admite sobre ${allowedAwaits}; mueve el resto del trabajo asíncrono a una función o a onMounted`, node);
    }
    if (!whole) {
      throw new ComposableError("MEEK055", `await ${name}(...) debe ser una sentencia completa o el inicializador completo de una declaración, como const value = await ${name}(...)`, node);
    }
    if (awaits.has(statement)) throw new ComposableError("MEEK055", "Usa un solo await de nivel superior por sentencia", node);
    const browser = browserAwaits.has(name);
    awaits.set(statement, { statement, node, call, name, browser });
    const index = statementIndex.get(statement)!;
    if (browser && (split === undefined || index < split)) split = index;
  };

  const visit = (node: ts.Node, statement: ts.Statement, nested: boolean): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && topLevelComposables.has(name) && nested) {
        throw new ComposableError("MEEK054", `${name}() debe llamarse en el nivel superior de <script>, no dentro de una función, un handler, un effect ni onMounted`, node.expression);
      }
      if (name === "useElementRef") {
        const argument = node.arguments[0];
        if (node.arguments.length !== 1 || !argument || !ts.isStringLiteralLike(argument)) {
          throw new ComposableError("MEEK056", "useElementRef necesita un literal de texto con el nombre de una directiva ref: de la plantilla, como useElementRef(\"input\")", argument ?? node);
        }
        const awaited = ts.isAwaitExpression(node.parent) && !nested;
        elementRefs.push({ call: node, name: argument.text, nameNode: argument, awaited });
      }
    }
    if (ts.isAwaitExpression(node) && !nested) acceptAwait(node, statement);
    if (ts.isForOfStatement(node) && node.awaitModifier && !nested) {
      throw new ComposableError("MEEK055", "for await no se admite en el nivel superior; muévelo a una función o a onMounted", node.awaitModifier);
    }
    if (ts.isVariableDeclarationList(node) && !nested && (node.flags & ts.NodeFlags.AwaitUsing) === ts.NodeFlags.AwaitUsing) {
      throw new ComposableError("MEEK055", "await using no se admite en el nivel superior", node);
    }
    const inner = nested || isFunctionBoundary(node);
    ts.forEachChild(node, (child) => visit(child, statement, inner));
  };
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    visit(statement, statement, false);
  }
  return { awaits, split, elementRefs };
}

/**
 * Whether a statement after the first browser await may run in the browser continuation, an
 * async function: any expression statement, and `if`, loops, `try`, `switch` and blocks.
 */
export function isContinuationStatement(statement: ts.Statement): boolean {
  return ts.isExpressionStatement(statement) || ts.isIfStatement(statement) || ts.isForStatement(statement)
    || ts.isForOfStatement(statement) || ts.isForInStatement(statement) || ts.isWhileStatement(statement)
    || ts.isDoStatement(statement) || ts.isTryStatement(statement) || ts.isSwitchStatement(statement) || ts.isBlock(statement);
}

/**
 * The first call of a top-level-only composable inside a control-flow statement of the
 * continuation: it would run conditionally or repeatedly, so it is MEEK054 like a nested call.
 */
export function conditionalComposable(statement: ts.Statement): ts.CallExpression | undefined {
  if (ts.isExpressionStatement(statement)) return undefined;
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && topLevelComposables.has(name)) {
        found = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(statement);
  return found;
}

/** A text edit inside a statement: an insertion, or the removal of a range. */
export type StatementEdit =
  | { readonly kind: "insert"; readonly at: number; readonly text: string; readonly depth: number; readonly closing: boolean }
  | { readonly kind: "remove"; readonly start: number; readonly end: number };

/** Nesting depth of `node` below `statement`, for the order of insertions at one position. */
export function nodeDepth(node: ts.Node, statement: ts.Node): number {
  let depth = 0;
  for (let current: ts.Node | undefined = node; current && current !== statement; current = current.parent) depth++;
  return depth;
}

/**
 * Free identifiers of a template expression, with their offset inside it. Property names,
 * object keys and parameters of arrow functions in the expression are not references.
 */
export function freeIdentifiers(expression: string): Array<{ name: string; offset: number }> {
  const prefix = "const __value = (";
  const file = ts.createSourceFile("template-expression.ts", `${prefix}${expression});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result: Array<{ name: string; offset: number }> = [];
  const shadowed = (node: ts.Identifier): boolean => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && parent.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === node.text)) return true;
      if (ts.isSourceFile(parent)) break;
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const reference = parent
        && !(ts.isPropertyAccessExpression(parent) && parent.name === node)
        && !(ts.isPropertyAssignment(parent) && parent.name === node)
        && !(ts.isParameter(parent) && parent.name === node)
        && !(ts.isVariableDeclaration(parent) && parent.name === node)
        && !ts.isTypeReferenceNode(parent);
      const offset = node.getStart(file) - prefix.length;
      if (reference && offset >= 0 && !shadowed(node)) result.push({ name: node.text, offset });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return result;
}
