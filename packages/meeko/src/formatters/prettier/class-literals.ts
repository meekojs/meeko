import type { ParserOptions } from "prettier";

import type { ClassOrder, ClassSortMode } from "./classes";

import { classOrderOption, classTokens, sortClassTokens, stylesheetClassOrder } from "./classes";
import { tailwindClassSorter } from "./tailwind";

/** Internal option the template printer sets on the expression of a `bind:class`. */
export const classExpressionOption = "__meekoClassExpression";

interface EstreeNode {
  readonly type: string;
  [key: string]: unknown;
}

/** How a literal joins the text around it, inside a `+` or a `${…}`. */
interface Edges {
  /** The text before and after is part of the same value: the outer whitespace is significant. */
  readonly keep: boolean;
  /** The first token continues the text before it (`${size}-b`), unless whitespace separates them. */
  readonly pinStart: boolean;
  /** The last token continues in the text after it (`p-${size}`), unless whitespace separates them. */
  readonly pinEnd: boolean;
}

const noEdges: Edges = { keep: false, pinStart: false, pinEnd: false };

/** Keys that hold back references or data, never a node to search for calls. */
const skippedKeys = new Set(["comments", "extra", "loc", "parent", "range", "tokens"]);

function isNode(value: unknown): value is EstreeNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function isStringLiteral(node: EstreeNode): boolean {
  return node.type === "StringLiteral" || (node.type === "Literal" && typeof node.value === "string");
}

/** The name of a call's callee: `tv` or, without computed members, `styles.cn`. */
function calleeName(callee: unknown): string | undefined {
  if (!isNode(callee)) return undefined;
  if (callee.type === "Identifier") return callee.name as string;
  if ((callee.type !== "MemberExpression" && callee.type !== "OptionalMemberExpression") || callee.computed) return undefined;
  const object = calleeName(callee.object);
  return object === undefined ? undefined : `${object}.${(callee.property as { name?: string }).name}`;
}

/**
 * Collects the literals whose value is a list of classes: only through the nodes that hand a value
 * on. A comparison, the test of a ternary, a key, a function's body or the arguments of a call that
 * is not named (`t('page title')`) are other strings.
 */
function collectValue(node: unknown, edges: Edges, targets: Map<EstreeNode, Edges>): void {
  if (!isNode(node)) return;
  if (isStringLiteral(node)) {
    if (!targets.has(node)) targets.set(node, edges);
    return;
  }
  switch (node.type) {
    case "TemplateLiteral": {
      const quasis = node.quasis as EstreeNode[];
      const expressions = node.expressions as unknown[];
      const hasExpressions = expressions.length > 0;
      quasis.forEach((quasi, index) => {
        if (targets.has(quasi)) return;
        targets.set(quasi, {
          keep: edges.keep || hasExpressions,
          pinStart: index > 0 || edges.pinStart,
          pinEnd: index < quasis.length - 1 || edges.pinEnd,
        });
      });
      expressions.forEach((expression, index) => {
        const before = (quasis[index]!.value as { raw: string }).raw;
        const after = (quasis[index + 1]!.value as { raw: string }).raw;
        collectValue(expression, { keep: true, pinStart: !/[\t\n\f\r ]$/.test(before), pinEnd: !/^[\t\n\f\r ]/.test(after) }, targets);
      });
      return;
    }
    case "ArrayExpression":
      for (const element of node.elements as unknown[]) collectValue(element, noEdges, targets);
      return;
    case "ObjectExpression":
      for (const property of node.properties as EstreeNode[]) {
        if (property.type === "SpreadElement") collectValue(property.argument, noEdges, targets);
        // Keys are never classes to sort; a method's value is a function, which is not followed.
        else if (property.type === "ObjectProperty" || property.type === "Property") collectValue(property.value, noEdges, targets);
      }
      return;
    case "SpreadElement":
      collectValue(node.argument, noEdges, targets);
      return;
    case "ConditionalExpression":
      collectValue(node.consequent, edges, targets);
      collectValue(node.alternate, edges, targets);
      return;
    case "LogicalExpression":
      collectValue(node.left, edges, targets);
      collectValue(node.right, edges, targets);
      return;
    case "BinaryExpression":
      if (node.operator !== "+") return;
      collectValue(node.left, { keep: true, pinStart: edges.pinStart, pinEnd: true }, targets);
      collectValue(node.right, { keep: true, pinStart: true, pinEnd: edges.pinEnd }, targets);
      return;
    case "AsConstExpression":
    case "AsExpression":
    case "ParenthesizedExpression":
    case "SatisfiesExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
    case "TypeCastExpression":
      collectValue(node.expression, edges, targets);
      return;
  }
}

/** Finds the calls to `functions` anywhere in the tree and collects the classes of their arguments. */
function collectCalls(root: unknown, functions: ReadonlySet<string>, targets: Map<EstreeNode, Edges>): void {
  const visited = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null || visited.has(value)) return;
    visited.add(value);
    if (isNode(value) && (value.type === "CallExpression" || value.type === "OptionalCallExpression")) {
      const name = calleeName(value.callee);
      if (name !== undefined && functions.has(name)) for (const argument of value.arguments as unknown[]) collectValue(argument, noEdges, targets);
    }
    for (const key of Object.keys(value)) if (!skippedKeys.has(key)) visit((value as Record<string, unknown>)[key]);
  };
  visit(root);
}

/**
 * The classes of `text` in order. Without edges, as a static `class`: collapsed, without repetitions
 * and trimmed. With edges, the outer whitespace stays as written and a token that touches the text
 * around it keeps its place, because it is only a part of a class.
 */
function sortedText(text: string, edges: Edges, sort: (tokens: readonly string[]) => string[]): string {
  // Whitespace alone separates two values; it holds no class.
  if (!classTokens(text).length) return text;
  if (!edges.keep) return sort(classTokens(text)).join(" ");
  const [, leading = "", body = "", trailing = ""] = /^([\t\n\f\r ]*)(.*?)([\t\n\f\r ]*)$/s.exec(text) ?? [];
  const tokens = body.split(/[\t\n\f\r ]+/);
  const first = edges.pinStart && !leading ? tokens.shift() : undefined;
  const last = edges.pinEnd && !trailing ? tokens.pop() : undefined;
  const sorted = sort(classTokens(tokens.join(" ")));
  return leading + [...(first === undefined ? [] : [first]), ...sorted, ...(last === undefined ? [] : [last])].join(" ") + trailing;
}

/** Rewrites a literal; a value with an escape sequence is left alone: its tokens are not the source text. */
function rewrite(node: EstreeNode, edges: Edges, sort: (tokens: readonly string[]) => string[]): void {
  if (node.type === "TemplateElement") {
    const value = node.value as { raw: string; cooked: string | null };
    if (value.raw.includes("\\")) return;
    const next = sortedText(value.raw, edges, sort);
    value.raw = next;
    value.cooked = next;
    return;
  }
  const extra = node.extra as { raw?: string; rawValue?: unknown } | undefined;
  const raw = extra?.raw ?? (node.raw as string | undefined);
  if (raw === undefined || raw.includes("\\")) return;
  const next = sortedText(raw.slice(1, -1), edges, sort);
  const nextRaw = `${raw[0]}${next}${raw[0]}`;
  node.value = next;
  if (node.raw !== undefined) node.raw = nextRaw;
  if (extra) {
    extra.raw = nextRaw;
    extra.rawValue = next;
  }
}

/** The order of the file's project, unless the `meeko` parser already passed the component's. */
async function orderFor(options: ParserOptions, mode: ClassSortMode): Promise<ClassOrder | undefined> {
  const passed = (options as unknown as Record<string, unknown>)[classOrderOption] as ClassOrder | undefined;
  if (passed) return passed;
  if (mode === "stylesheet") return stylesheetClassOrder(options.filepath);
  if (mode === "tailwind") return tailwindClassSorter(options.filepath, (options as { meekoTailwindStylesheet?: string }).meekoTailwindStylesheet);
  return undefined;
}

/**
 * Sorts, in the AST and before printing, the string literals of the calls to `meekoClassFunctions`
 * and of a `bind:class`, with the mode and the rules of `meekoSortClasses`. It does nothing, and
 * loads nothing, while there is no mode, nothing asks for it or the file has no such literal.
 */
export async function sortClassLiterals(ast: unknown, options: ParserOptions): Promise<void> {
  const { meekoClassFunctions: functions, meekoSortClasses: mode } = options as { meekoClassFunctions?: readonly string[]; meekoSortClasses?: ClassSortMode };
  const isClassExpression = (options as unknown as Record<string, unknown>)[classExpressionOption] === true;
  if (!mode || mode === "off" || (!functions?.length && !isClassExpression)) return;
  const targets = new Map<EstreeNode, Edges>();
  if (isClassExpression) collectValue((ast as { node?: unknown }).node ?? ast, noEdges, targets);
  if (functions?.length) collectCalls(ast, new Set(functions), targets);
  if (!targets.size) return;
  const order = await orderFor(options, mode);
  const sort = (tokens: readonly string[]): string[] => sortClassTokens(tokens, mode, order);
  for (const [node, edges] of targets) rewrite(node, edges, sort);
}
