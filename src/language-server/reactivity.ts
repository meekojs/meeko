import ts from "@typescript/typescript6";
import { analyzeComposables } from "../compiler/composables.js";
import { parseSfc } from "../compiler/sfc.js";
import type { SfcDocument } from "../compiler/sfc.js";
import type { VirtualComponent } from "./model.js";

/** Family of a reactive declaration of the script, as the editor colors and summarizes it. */
export type ReactiveKind = "signal" | "computed" | "resource";

/** What created a reactive declaration. `composable` is a call whose type is a signal or resource. */
export type ReactiveOrigin =
  | "signal" | "useState" | "defineModel" | "useElementRef" | "computed"
  | "useApi" | "useRpcQuery" | "useRpcMutation" | "composable";

/** One use of a reactive declaration, with source offsets of the `.meeko` file. */
export interface ReactiveAccess {
  /** The identifier. */
  readonly start: number;
  readonly end: number;
  readonly read: boolean;
  readonly write: boolean;
  /** The member read or written after the identifier, such as `value` in `count.value`. */
  readonly member?: { readonly name: string; readonly start: number; readonly end: number };
  readonly template: boolean;
  /**
   * Where the access happens: a template binding such as `bind:title`, `{…}` or `model`, or
   * in the script `effect`, `computed`, `onMounted`, `function name` or `setup`.
   */
  readonly where: string;
}

/** A top-level `const` of the `<script>` that holds a signal, a computed value or a data resource. */
export interface ReactiveDeclaration {
  readonly name: string;
  readonly kind: ReactiveKind;
  readonly origin: ReactiveOrigin;
  /** The declared name. */
  readonly start: number;
  readonly end: number;
  readonly awaited: boolean;
  /** Declared after the first browser `await`, in the browser continuation of the setup. */
  readonly browserOnly: boolean;
  /** Key of `useState("key", …)`. */
  readonly stateKey?: string;
  /** Name of `defineModel("name")`, `default` without a name. */
  readonly modelName?: string;
  /** The `computed` callback reads `props`, such as the data a page receives from the server. */
  readonly readsProps?: boolean;
  readonly type: string;
  readonly accesses: readonly ReactiveAccess[];
}

export interface ReactivityAnalysis {
  readonly declarations: readonly ReactiveDeclaration[];
  /** Source ranges of template expressions that read a reactive value. */
  readonly reactiveExpressions: ReadonlyArray<readonly [number, number]>;
}

const signalOrigins: Readonly<Record<string, ReactiveOrigin>> = {
  signal: "signal", useState: "useState", defineModel: "defineModel", useElementRef: "useElementRef",
};
const resourceOrigins = new Set(["useApi", "useRpcQuery", "useRpcMutation"]);
const resourceTriggers = new Set(["refresh", "mutate"]);
const scriptContexts = new Set(["effect", "computed", "onMounted", "watch"]);

/** `expression` without parentheses, `as`, `satisfies` and `!`. */
export function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression;
  }
  return current;
}

/** Deepest node of `file` whose token contains `offset`. */
export function nodeAt(file: ts.SourceFile, offset: number): ts.Node | undefined {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (offset < node.getStart(file) || offset >= node.getEnd()) return;
    found = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** `node` is written by an assignment (`=`) or read and written (`+=`, `++`). */
function assignment(node: ts.Node): { read: boolean; write: boolean } | undefined {
  let target = node;
  while (ts.isParenthesizedExpression(target.parent)) target = target.parent;
  const parent = target.parent;
  if (ts.isBinaryExpression(parent) && parent.left === target) {
    const operator = parent.operatorToken.kind;
    if (operator === ts.SyntaxKind.EqualsToken) return { read: false, write: true };
    if (operator >= ts.SyntaxKind.FirstCompoundAssignment && operator <= ts.SyntaxKind.LastCompoundAssignment) return { read: true, write: true };
  }
  if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
    && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) {
    return { read: true, write: true };
  }
  return undefined;
}

/** Name of the call that receives `node` as an argument, through an inline callback. */
function enclosingCallback(node: ts.Node, stop: ts.Node): string | undefined {
  for (let current: ts.Node | undefined = node; current && current !== stop; current = current.parent) {
    if (!ts.isArrowFunction(current) && !ts.isFunctionExpression(current)) continue;
    const call = current.parent;
    if (ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.arguments.includes(current as ts.Expression)) {
      if (scriptContexts.has(call.expression.text)) return call.expression.text;
    }
    const owner = current.parent;
    if (ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name)) return `function ${owner.name.text}`;
    if (ts.isPropertyAssignment(owner) && (ts.isIdentifier(owner.name) || ts.isStringLiteral(owner.name))) return `function ${owner.name.text}`;
    return "function";
  }
  return undefined;
}

/** Where a script access happens: the callback of `effect`/`computed`/`onMounted`, a named function or the setup. */
function scriptContext(node: ts.Node, file: ts.SourceFile): string {
  for (let current: ts.Node | undefined = node; current && current !== file; current = current.parent) {
    if (ts.isFunctionDeclaration(current)) return current.name ? `function ${current.name.text}` : "function";
    if (ts.isMethodDeclaration(current) && (ts.isIdentifier(current.name) || ts.isStringLiteral(current.name))) return `function ${current.name.text}`;
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return enclosingCallback(current, file) ?? "function";
  }
  return "setup";
}

/** The template binding around `offset`: the attribute name, `{…}` for interpolations. */
export function templateBinding(source: string, expressionStart: number): string {
  const before = source.slice(Math.max(0, expressionStart - 200), expressionStart);
  const attribute = /([^\s<>"'=/]+)\s*=\s*["']?$/.exec(before);
  if (attribute) return attribute[1]!;
  if (before.endsWith("{")) return "{…}";
  return "template";
}

/** Start of the mapped template expression that contains a source offset. */
function expressionStart(component: VirtualComponent, offset: number): number {
  const span = component.spans.find((candidate, index) => index > 0 && offset >= candidate.sourceStart && offset < candidate.sourceEnd);
  return span?.sourceStart ?? offset;
}

function templateSection(component: VirtualComponent): SfcDocument["template"] | undefined {
  try { return parseSfc(component.source, component.filename).template; }
  catch { return undefined; }
}

/** Source offset of the first statement of the browser continuation, if the setup has one. */
export function continuationStart(component: VirtualComponent): number | undefined {
  let document: SfcDocument;
  try { document = parseSfc(component.source, component.filename); }
  catch { return undefined; }
  const file = ts.createSourceFile(component.filename, document.script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  try {
    const { split } = analyzeComposables(file);
    const statement = split === undefined ? undefined : file.statements[split];
    return statement ? document.script.contentStart + statement.getStart(file) : undefined;
  } catch {
    // An invalid await is reported by `meeko check`; without the rules there is no split.
    return undefined;
  }
}

function classify(declaration: ts.VariableDeclaration, checker: ts.TypeChecker): { kind: ReactiveKind; origin: ReactiveOrigin; awaited: boolean; call: ts.CallExpression } | undefined {
  if (!declaration.initializer) return undefined;
  let expression = unwrap(declaration.initializer);
  const awaited = ts.isAwaitExpression(expression);
  if (ts.isAwaitExpression(expression)) expression = unwrap(expression.expression);
  if (!ts.isCallExpression(expression)) return undefined;
  const callee = ts.isIdentifier(expression.expression) ? expression.expression.text : undefined;
  if (callee && signalOrigins[callee]) {
    // An awaited element ref is the element itself, not a signal.
    if (callee === "useElementRef" && awaited) return undefined;
    return { kind: "signal", origin: signalOrigins[callee]!, awaited, call: expression };
  }
  if (callee === "computed") return { kind: "computed", origin: "computed", awaited, call: expression };
  if (callee && resourceOrigins.has(callee)) return { kind: "resource", origin: callee as ReactiveOrigin, awaited, call: expression };
  // Any other call: its type tells whether it returns a signal or a data resource.
  const type = checker.getTypeAtLocation(declaration.name);
  const name = type.aliasSymbol?.name ?? type.getSymbol()?.name;
  if (name === "Signal") return { kind: "signal", origin: "composable", awaited, call: expression };
  if (name === "ReadonlySignal") return { kind: "computed", origin: "composable", awaited, call: expression };
  if (name === "DataResource" || name === "LoadedResource" || name === "RpcMutation") return { kind: "resource", origin: "composable", awaited, call: expression };
  return undefined;
}

/** Interfaces of Meeko whose `value` is a reactive read: signals, computed values, models and resource fields. */
const signalInterfaces = new Set(["ReadonlySignal", "Signal"]);

/**
 * `access` reads or writes the `value` of a Meeko signal, by its type: every part of the object
 * type has a `value` declared by `Signal`/`ReadonlySignal` or by the component's generated
 * declarations (`useElementRef`). `props.value`, `input.value` or `event.currentTarget.value` are not.
 */
export function isSignalValue(checker: ts.TypeChecker, access: ts.PropertyAccessExpression, component: VirtualComponent): boolean {
  if (access.name.text !== "value") return false;
  const type = checker.getNonNullableType(checker.getTypeAtLocation(access.expression));
  const parts = type.isUnion() ? type.types : [type];
  return parts.length > 0 && parts.every((part) => {
    const declarations = part.getProperty("value")?.declarations ?? [];
    return declarations.length > 0 && declarations.every((declaration) => {
      const file = declaration.getSourceFile();
      if (file.fileName === component.virtualFilename) {
        // Generated code of the virtual document maps to no source offset.
        return component.toSource(declaration.getStart(file)) === undefined;
      }
      const owner = declaration.parent;
      return ts.isInterfaceDeclaration(owner) && signalInterfaces.has(owner.name.text);
    });
  });
}

/** A mapped template expression reads the `.value` of a signal. */
function readsSignalValue(file: ts.SourceFile, checker: ts.TypeChecker, component: VirtualComponent, span: { generatedStart: number; generatedEnd: number }): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || node.getEnd() <= span.generatedStart || node.getStart(file) >= span.generatedEnd) return;
    if (ts.isPropertyAccessExpression(node) && node.name.text === "value" && node.name.getStart(file) >= span.generatedStart
      && node.name.getEnd() <= span.generatedEnd && isSignalValue(checker, node, component)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function literal(node: ts.Expression | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

/**
 * Signals, computed values and data resources declared at the top level of the `<script>`, with
 * every read and write in the script and the template. It uses the editor's TypeScript project:
 * template expressions are part of the component's virtual document.
 */
export function analyzeReactivity(service: ts.LanguageService, component: VirtualComponent): ReactivityAnalysis {
  const empty: ReactivityAnalysis = { declarations: [], reactiveExpressions: [] };
  const program = service.getProgram();
  const file = program?.getSourceFile(component.virtualFilename);
  const script = component.spans[0];
  if (!program || !file || !script) return empty;
  const checker = program.getTypeChecker();
  const template = templateSection(component);
  const split = continuationStart(component);
  const inTemplate = (offset: number): boolean => template !== undefined && offset >= template.contentStart && offset < template.contentEnd;
  const declarations: ReactiveDeclaration[] = [];

  for (const statement of file.statements) {
    const start = statement.getStart(file);
    if (start < script.generatedStart || start >= script.generatedEnd || !ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const found = classify(declaration, checker);
      if (!found) continue;
      const nameStart = declaration.name.getStart(file);
      const sourceStart = component.toSource(nameStart);
      if (sourceStart === undefined) continue;
      const accesses = new Map<number, ReactiveAccess>();
      const highlights = service.getDocumentHighlights(component.virtualFilename, nameStart, [component.virtualFilename]) ?? [];
      for (const span of highlights.flatMap((highlight) => highlight.highlightSpans)) {
        if (span.textSpan.start === nameStart) continue;
        const accessStart = component.toSource(span.textSpan.start);
        if (accessStart === undefined) continue;
        const node = nodeAt(file, span.textSpan.start);
        if (!node || !ts.isIdentifier(node)) continue;
        let read = true;
        let write = false;
        let member: ReactiveAccess["member"];
        const parent = node.parent;
        if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
          const memberStart = component.toSource(parent.name.getStart(file));
          const name = parent.name.text;
          if (memberStart !== undefined) member = { name, start: memberStart, end: memberStart + name.length };
          if (found.kind === "resource") {
            write = resourceTriggers.has(name) && ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
            read = !write;
          } else if (name === "value") {
            const assigned = assignment(parent);
            if (assigned) ({ read, write } = assigned);
          }
        } else if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "__meeko_writable") {
          // `model="signal"`: a two-way binding reads and writes the signal.
          write = true;
        }
        const previous = accesses.get(accessStart);
        const template = inTemplate(accessStart);
        accesses.set(accessStart, {
          start: accessStart,
          end: accessStart + node.text.length,
          read: read || (previous?.read ?? false),
          write: write || (previous?.write ?? false),
          ...(member ?? previous?.member ? { member: member ?? previous!.member! } : {}),
          template,
          where: template ? templateBinding(component.source, expressionStart(component, accessStart)) : scriptContext(node, file),
        });
      }
      const call = found.call;
      const firstArgument = literal(call.arguments[0]);
      const type = checker.typeToString(checker.getTypeAtLocation(declaration.name), undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
      declarations.push({
        name: declaration.name.text,
        kind: found.kind,
        origin: found.origin,
        start: sourceStart,
        end: sourceStart + declaration.name.text.length,
        awaited: found.awaited,
        browserOnly: split !== undefined && sourceStart >= split,
        ...(found.origin === "useState" && firstArgument !== undefined ? { stateKey: firstArgument } : {}),
        ...(found.origin === "defineModel" ? { modelName: firstArgument ?? "default" } : {}),
        ...(found.origin === "computed" && call.arguments[0] && /\bprops\b/.test(call.arguments[0].getText(file)) ? { readsProps: true } : {}),
        type: type.length > 160 ? `${type.slice(0, 157)}...` : type,
        accesses: [...accesses.values()].sort((left, right) => left.start - right.start),
      });
    }
  }

  // A template expression is reactive when it reads a reactive declaration or the `.value` of a
  // signal. The type decides, not the name: `props.value` or `input.value` are plain reads.
  const reactiveExpressions: Array<[number, number]> = [];
  const accessStarts = declarations.flatMap((declaration) => declaration.accesses.filter((access) => access.template).map((access) => access.start));
  for (const span of component.spans.slice(1)) {
    if (!inTemplate(span.sourceStart) || span.sourceEnd <= span.sourceStart) continue;
    if (accessStarts.some((start) => start >= span.sourceStart && start < span.sourceEnd) || readsSignalValue(file, checker, component, span)) {
      if (!reactiveExpressions.some(([start, end]) => start === span.sourceStart && end === span.sourceEnd)) reactiveExpressions.push([span.sourceStart, span.sourceEnd]);
    }
  }
  return { declarations, reactiveExpressions };
}

/** Reactive declaration whose name or one of its uses contains `offset`. */
export function reactiveDeclarationAt(analysis: ReactivityAnalysis, offset: number): ReactiveDeclaration | undefined {
  return analysis.declarations.find((declaration) => (offset >= declaration.start && offset <= declaration.end)
    || declaration.accesses.some((access) => offset >= access.start && offset <= access.end));
}

/** How the value of a reactive declaration reaches the browser, in one sentence. */
export function crossing(declaration: ReactiveDeclaration): string {
  if (declaration.browserOnly) return "Sólo navegador: se declara después del primer `await` de navegador, en la continuación del setup; nunca llega desde el servidor.";
  switch (declaration.origin) {
    case "useState":
      return `Pasa al cliente en el estado de la aplicación${declaration.stateKey === undefined ? "" : ` con la clave \`${declaration.stateKey}\``}; un valor por petición, compartido por todos los componentes que usan la clave.`;
    case "defineModel":
      return `Modelo \`${declaration.modelName ?? "default"}\` del padre: el padre lo enlaza con \`${declaration.modelName && declaration.modelName !== "default" ? `model:${declaration.modelName}` : "model"}\` y el valor pertenece a su estado.`;
    case "useElementRef":
      return "Sólo navegador: una referencia a un elemento de esta plantilla, `null` durante el SSR.";
    case "computed":
      return declaration.readsProps
        ? "No pasa al cliente: se recalcula en el navegador a partir de sus dependencias, que incluyen props como los datos que el servidor envía a una página."
        : "No pasa al cliente: se recalcula en el navegador a partir de sus dependencias.";
    case "useApi": case "useRpcQuery":
      return declaration.awaited
        ? "Datos del servidor: se cargan antes del render, también durante el SSR, y viajan en el payload de la página, así que la hidratación los reutiliza sin una segunda petición."
        : "Se carga en el navegador después de montar el componente; el SSR lo renderiza mientras está pendiente.";
    case "useRpcMutation":
      return "Sólo navegador: llama al procedimiento bajo demanda y nunca se ejecuta durante el SSR.";
    case "signal":
      return "Pasa al cliente: su valor se serializa en el estado del componente tras el SSR y se restaura al hidratar, así que debe ser serializable en JSON.";
    default:
      return declaration.kind === "signal"
        ? "Pasa al cliente si es una señal editable del setup: su valor se serializa en el estado del componente tras el SSR."
        : declaration.kind === "computed" ? "No pasa al cliente: una señal de sólo lectura se recalcula en el navegador." : "Un recurso de datos de un composable.";
  }
}
