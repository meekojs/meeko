import ts from "@typescript/typescript6";
import { parseSfc } from "../compiler/sfc.js";
import type { SfcDocument } from "../compiler/sfc.js";
import { isPageFile } from "../framework/route-block.js";
import { extractRouteRender } from "../framework/routes-discovery.js";
import type { PageRender } from "../framework/page.js";
import { continuationStart, nodeAt, templateBinding, unwrap } from "./reactivity.js";
import type { VirtualComponent } from "./model.js";

/** Where code of a `.meeko` runs. */
export type ExecutionZoneKind = "server" | "shared" | "browser";

/**
 * Why a range runs where it does. `browser-function` is a function of the setup used only from
 * the browser; `inline-handler` an inline function of an `on:*` of the template.
 */
export type ExecutionZoneReason = "server-block" | "client-route-block" | "setup" | "client-page" | "continuation" | "onMounted"
  | "browser-function" | "inline-handler";

/** A range of whole lines of the component and where it runs. */
export interface ExecutionZone {
  readonly kind: ExecutionZoneKind;
  readonly reason: ExecutionZoneReason;
  /** Zero-based, inclusive. */
  readonly startLine: number;
  readonly endLine: number;
  /** Short label, such as "Sólo servidor". */
  readonly label: string;
  /** One-paragraph explanation for a hover. */
  readonly detail: string;
}

const labels: Readonly<Record<ExecutionZoneKind, string>> = {
  server: "Sólo servidor",
  shared: "Servidor y navegador",
  browser: "Sólo navegador",
};

const details: Readonly<Record<ExecutionZoneReason, string>> = {
  "server-block": "`<script server>` declara las opciones de ruta y el loader de la página. Sólo se ejecuta en el servidor y nunca entra en el bundle del navegador.",
  "client-route-block": "Este `<script server>` declara `render: \"client\"`, así que sus opciones de ruta y su loader se ejecutan en el navegador.",
  setup: "El setup del componente se ejecuta en el servidor durante el SSR y otra vez en el navegador al hidratar. Mantenlo libre de APIs exclusivas del navegador.",
  "client-page": "La página declara `render: \"client\"`: el servidor sólo renderiza sus layouts y el setup de la página se ejecuta en el navegador.",
  continuation: "Después del primer `await` de un composable de navegador (`useElementRef`, `useSocket`), el setup continúa en el navegador, una vez montado el componente.",
  onMounted: "Los callbacks de `onMounted` se ejecutan en el navegador después de montar el componente, nunca durante el SSR.",
  "browser-function": "Esta función sólo se usa desde código de navegador (manejadores `on:*`, `onMounted` o la continuación del setup), así que nunca se ejecuta durante el SSR.",
  "inline-handler": "Este manejador `on:*` sólo se ejecuta en el navegador, cuando ocurre el evento.",
};

type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

/** A function declared at the top level of the setup and how it is used. */
interface SetupFunction {
  readonly name: string;
  /** Source range of the statement (or declaration) whose lines the zone covers. */
  readonly start: number;
  readonly end: number;
  /** Direct browser uses: `on:click`, `onMounted`, `continuation`. */
  readonly browserUses: Set<string>;
  /** Setup functions whose bodies use this one. */
  readonly callers: Set<SetupFunction>;
  /** A use runs during SSR or cannot be classified. */
  shared: boolean;
  browser: boolean;
}

/** A browser-only range found by the use analysis, with its explanation. */
interface BrowserRange {
  readonly start: number;
  readonly end: number;
  readonly reason: "browser-function" | "inline-handler";
  readonly detail: string;
}

/** Callbacks whose first run happens during SSR. */
const sharedCallbacks = new Set(["effect", "computed", "watch"]);

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

function isFunctionScope(node: ts.Node): node is ts.SignatureDeclaration {
  return isFunctionNode(node) || ts.isMethodDeclaration(node) || ts.isAccessor(node) || ts.isConstructorDeclaration(node);
}

function bindingNames(name: ts.BindingName, names: string[] = []): string[] {
  if (ts.isIdentifier(name)) names.push(name.text);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, names);
  return names;
}

/** `scope` declares `name` itself: a parameter, a local variable, function or class, a loop or catch variable. */
function declaresLocally(scope: ts.Node, name: string): boolean {
  if (isFunctionScope(scope)) {
    if (scope.parameters.some((parameter) => bindingNames(parameter.name).includes(name))) return true;
    if (ts.isFunctionExpression(scope) && scope.name?.text === name) return true;
  }
  if (ts.isBlock(scope) || ts.isCaseClause(scope) || ts.isDefaultClause(scope)) {
    return scope.statements.some((statement) => (ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some((declaration) => bindingNames(declaration.name).includes(name)))
      || ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name));
  }
  if ((ts.isForStatement(scope) || ts.isForOfStatement(scope) || ts.isForInStatement(scope)) && scope.initializer && ts.isVariableDeclarationList(scope.initializer)) {
    return scope.initializer.declarations.some((declaration) => bindingNames(declaration.name).includes(name));
  }
  if (ts.isCatchClause(scope) && scope.variableDeclaration) return bindingNames(scope.variableDeclaration.name).includes(name);
  return false;
}

/** `identifier` is a value reference, not a property name, a declared name or a type position. */
function isValueReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if ((parent as { readonly name?: ts.Node }).name === identifier) return false;
  if (ts.isQualifiedName(parent) || (ts.isBindingElement(parent) && parent.propertyName === identifier)) return false;
  for (let current: ts.Node | undefined = parent; current && !ts.isSourceFile(current); current = current.parent) {
    if (ts.isTypeNode(current) || ts.isTypeQueryNode(current)) return false;
    if (ts.isStatement(current) && !ts.isBlock(current)) break;
  }
  return true;
}

function joinList(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

/** Hover text of a browser function: where it is used. */
function browserFunctionDetail(fn: SetupFunction): string {
  const handlers = [...fn.browserUses].filter((use) => use.startsWith("on:")).sort();
  const parts: string[] = [];
  if (handlers.length) parts.push(`como manejador de ${joinList(handlers.map((handler) => `\`${handler}\``))}`);
  if (fn.browserUses.has("onMounted")) parts.push("en `onMounted`");
  if (fn.browserUses.has("continuation")) parts.push("en la continuación del setup, tras el primer `await` de navegador");
  const callers = [...fn.callers].filter((caller) => caller !== fn && caller.browser).map((caller) => `\`${caller.name}\``).sort();
  if (callers.length) parts.push(`desde ${callers.length === 1 ? "la función" : "las funciones"} de navegador ${joinList(callers)}`);
  return `Sólo se usa ${joinList(parts)}, así que nunca se ejecuta durante el SSR.`;
}

/** The source text around `[start, end)` holds only that code on its lines. */
function ownsLines(source: string, start: number, end: number, before = /^\s*$/, after = /^\s*;?\s*(\/\/.*)?$/): boolean {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const next = source.indexOf("\n", end);
  return before.test(source.slice(lineStart, start)) && after.test(source.slice(end, next < 0 ? source.length : next));
}

/**
 * Browser-only ranges of the setup and the template:
 *
 * - functions declared at the top level of the setup (`function f() {}`, `const f = () => {}`)
 *   whose every use runs in the browser: an `on:*` handler of the template (also on a component),
 *   the body of `onMounted`, the browser continuation or another browser function, to a fixed
 *   point. A call at the top level of the setup, a use inside `effect`/`computed`, a rendering
 *   template expression, `defineExpose`, a prop or model of a child or any use the analysis cannot
 *   classify keeps a function shared;
 * - inline functions of `on:*` attributes that sit on their own lines of the template.
 *
 * It is syntactic, over the component's virtual TypeScript, and only marks whole lines.
 */
function browserRanges(component: VirtualComponent, document: SfcDocument, split: number | undefined): BrowserRange[] {
  const script = component.spans[0];
  if (!script) return [];
  const source = component.source;
  const file = ts.createSourceFile(component.virtualFilename, component.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const template = document.template;
  const templateSpans = component.spans.slice(1).filter((span) => template !== undefined
    && span.sourceStart >= template.contentStart && span.sourceStart < template.contentEnd && span.generatedEnd > span.generatedStart);

  // Setup functions, before the browser continuation: the continuation is browser code already.
  const functions = new Map<string, SetupFunction>();
  const byNode = new Map<ts.Node, SetupFunction>();
  const duplicated = new Set<string>();
  const declare = (name: ts.Identifier, node: FunctionNode, owner: ts.Node): void => {
    const start = component.toSource(owner.getStart(file));
    const end = component.toSource(owner.getEnd());
    if (start === undefined || end === undefined) return;
    if (functions.has(name.text)) duplicated.add(name.text);
    const fn: SetupFunction = { name: name.text, start, end, browserUses: new Set(), callers: new Set(), shared: false, browser: false };
    functions.set(name.text, fn);
    byNode.set(node, fn);
  };
  for (const statement of file.statements) {
    const start = statement.getStart(file);
    if (start < script.generatedStart || start >= script.generatedEnd) continue;
    const sourceStart = component.toSource(start);
    if (sourceStart === undefined || (split !== undefined && sourceStart >= split)) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) declare(statement.name, statement, statement);
    else if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Const) {
      const { declarations } = statement.declarationList;
      for (const declaration of declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        const initializer = unwrap(declaration.initializer);
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) declare(declaration.name, initializer, declarations.length === 1 ? statement : declaration);
      }
    }
  }
  for (const name of duplicated) functions.get(name)!.shared = true;

  /** Where a script use runs: a browser reason, a setup function whose body holds it, or shared. */
  const scriptUse = (identifier: ts.Identifier): string | SetupFunction | undefined => {
    const offset = component.toSource(identifier.getStart(file));
    if (offset === undefined) return undefined;
    if (split !== undefined && offset >= split) return "continuation";
    let child: ts.Node = identifier;
    for (let current = identifier.parent; !ts.isSourceFile(current); child = current, current = current.parent) {
      if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.arguments.some((argument) => argument === child)) {
        if (current.expression.text === "onMounted") return "onMounted";
        if (sharedCallbacks.has(current.expression.text)) return undefined;
      }
      const owner = byNode.get(current);
      if (owner) return owner;
    }
    // The top level of the setup, or a function the analysis does not follow.
    return undefined;
  };

  /** Where a template use runs: the `on:*` event name, or shared. */
  const templateUse = (identifier: ts.Identifier, span: (typeof templateSpans)[number]): string | undefined => {
    const binding = templateBinding(source, span.sourceStart);
    if (!binding.startsWith("on:")) return undefined;
    const path: ts.Node[] = [];
    for (let current = identifier.parent; current.getStart(file) >= span.generatedStart && current.getEnd() <= span.generatedEnd; current = current.parent) {
      // Inside an inline function of the handler, such as `on:click="() => save()"`.
      if (isFunctionScope(current)) return binding;
      path.push(current);
    }
    // Called or passed to a call while the handler is bound, such as `on:click="make(save)"`: on a
    // component that happens during SSR.
    const evaluated = path.some((current) => ts.isCallExpression(current) || ts.isNewExpression(current) || ts.isTaggedTemplateExpression(current));
    return evaluated ? undefined : binding;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const fn = functions.get(node.text);
      if (fn && !fn.shared && isValueReference(node)) {
        let shadowed = false;
        for (let scope = node.parent; !ts.isSourceFile(scope) && !shadowed; scope = scope.parent) shadowed = declaresLocally(scope, node.text);
        const start = node.getStart(file);
        const span = templateSpans.find((candidate) => start >= candidate.generatedStart && start < candidate.generatedEnd);
        if (shadowed) { /* Another binding with the same name. */ }
        else if (start >= script.generatedStart && start < script.generatedEnd) {
          const use = scriptUse(node);
          if (use === undefined) fn.shared = true;
          else if (typeof use === "string") fn.browserUses.add(use);
          else if (use !== fn) fn.callers.add(use);
        } else if (span) {
          const use = templateUse(node, span);
          if (use === undefined) fn.shared = true;
          else fn.browserUses.add(use);
        } else if (component.toSource(start) !== undefined) {
          // A mapped use outside the script and the template expressions.
          fn.shared = true;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  // Greatest fixed point: a function stays a candidate while no use is shared and every caller is a candidate.
  const all = [...functions.values()];
  for (const fn of all) fn.browser = !fn.shared && (fn.browserUses.size > 0 || fn.callers.size > 0);
  for (let changed = true; changed;) {
    changed = false;
    for (const fn of all) {
      if (fn.browser && [...fn.callers].some((caller) => !caller.browser)) { fn.browser = false; changed = true; }
    }
  }
  // Least fixed point inside it: only functions reached from a direct browser use, not a cycle of unused functions.
  const anchored = new Set(all.filter((fn) => fn.browser && fn.browserUses.size > 0));
  for (let changed = true; changed;) {
    changed = false;
    for (const fn of all) {
      if (fn.browser && !anchored.has(fn) && [...fn.callers].some((caller) => caller !== fn && anchored.has(caller))) { anchored.add(fn); changed = true; }
    }
  }
  for (const fn of all) fn.browser = anchored.has(fn);

  const ranges: BrowserRange[] = [];
  for (const fn of all) {
    if (fn.browser && ownsLines(source, fn.start, fn.end)) ranges.push({ start: fn.start, end: fn.end, reason: "browser-function", detail: browserFunctionDetail(fn) });
  }
  // Inline handlers of the template, when the function owns its lines: `on:click="() => {` … `}"`.
  for (const span of templateSpans) {
    const binding = templateBinding(source, span.sourceStart);
    if (!binding.startsWith("on:")) continue;
    // From the deepest node at the start of the expression up to the expression itself.
    let node = nodeAt(file, span.generatedStart);
    while (node && !ts.isSourceFile(node) && node.getEnd() < span.generatedEnd) node = node.parent;
    if (!node || node.getStart(file) !== span.generatedStart || node.getEnd() !== span.generatedEnd) continue;
    if (!ts.isExpression(node) || !isFunctionNode(unwrap(node))) continue;
    const before = new RegExp(`^\\s*${binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*["']$`);
    if (!ownsLines(source, span.sourceStart, span.sourceEnd, before, /^["']\s*\/?>?\s*$/)) continue;
    ranges.push({
      start: span.sourceStart, end: span.sourceEnd, reason: "inline-handler",
      detail: `Esta función es el manejador de \`${binding}\`: sólo se ejecuta en el navegador, cuando ocurre el evento.`,
    });
  }
  return ranges;
}

/** `render` of the page: its `<script server>` block or its `.route.ts` sidecar. */
function pageRender(document: SfcDocument, filename: string): PageRender | undefined {
  try {
    if (document.server) return extractRouteRender(filename, document.server.content);
    const sidecar = `${filename.slice(0, -".meeko".length)}.route.ts`;
    const content = ts.sys.readFile(sidecar);
    return content === undefined ? undefined : extractRouteRender(sidecar, content);
  } catch {
    // An invalid render is reported by route discovery.
    return undefined;
  }
}

/** Bodies of `onMounted(callback)` calls of the script, with source offsets. */
function mountedCallbacks(document: SfcDocument, filename: string): Array<[number, number]> {
  const file = ts.createSourceFile(filename, document.script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ranges: Array<[number, number]> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "onMounted" && node.arguments[0]) {
      const callback = node.arguments[0];
      ranges.push([document.script.contentStart + callback.getStart(file), document.script.contentStart + callback.getEnd()]);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return ranges;
}

function lineAt(source: string, offset: number): number {
  let line = 0;
  for (let index = source.indexOf("\n"); index >= 0 && index < offset; index = source.indexOf("\n", index + 1)) line++;
  return line;
}

/**
 * Execution zones of a component, by whole lines: `<script server>` runs only on the server,
 * the setup on both sides, and only in the browser the continuation after the first browser
 * `await`, the `onMounted` callbacks, the setup functions used only from browser code and the
 * inline `on:*` handlers on their own lines. The rest of the template and the styles are not zones.
 */
export function executionZones(component: VirtualComponent, sourceRoots: readonly string[]): ExecutionZone[] {
  let document: SfcDocument;
  try { document = parseSfc(component.source, component.filename); }
  catch { return []; }
  const source = component.source;
  const kinds = new Map<number, { reason: ExecutionZoneReason; detail: string }>();
  const mark = (start: number, end: number, reason: ExecutionZoneReason, detail = details[reason]): void => {
    const last = lineAt(source, Math.max(start, end - 1));
    for (let line = lineAt(source, start); line <= last; line++) kinds.set(line, { reason, detail });
  };
  const page = isPageFile(component.filename, sourceRoots);
  const render = page ? pageRender(document, component.filename) : undefined;
  if (document.server) mark(document.server.start, document.server.end, render === "client" ? "client-route-block" : "server-block");
  const script = document.script;
  // A script without content still has its tags; an empty `<script>` has no zone.
  if (script.content.trim()) {
    if (render === "client") mark(script.start, script.end, "client-page");
    else {
      mark(script.start, script.end, "setup");
      const split = continuationStart(component);
      let ranges: BrowserRange[] = [];
      // The use analysis is best effort: without it, the setup keeps its zones.
      try { ranges = browserRanges(component, document, split); }
      catch { ranges = []; }
      for (const range of ranges) if (range.reason === "browser-function") mark(range.start, range.end, range.reason, range.detail);
      if (split !== undefined) mark(split, script.end, "continuation");
      for (const [start, end] of mountedCallbacks(document, component.filename)) {
        if (split === undefined || start < split) mark(start, end, "onMounted");
      }
      for (const range of ranges) if (range.reason === "inline-handler") mark(range.start, range.end, range.reason, range.detail);
    }
  }
  const zones: ExecutionZone[] = [];
  const reasonKind = (reason: ExecutionZoneReason): ExecutionZoneKind => reason === "server-block" ? "server"
    : reason === "setup" ? "shared" : "browser";
  for (const line of [...kinds.keys()].sort((left, right) => left - right)) {
    const { reason, detail } = kinds.get(line)!;
    const previous = zones.at(-1);
    if (previous && previous.reason === reason && previous.detail === detail && previous.endLine === line - 1) {
      zones[zones.length - 1] = { ...previous, endLine: line };
      continue;
    }
    const kind = reasonKind(reason);
    zones.push({ kind, reason, startLine: line, endLine: line, label: labels[kind], detail });
  }
  return zones;
}
