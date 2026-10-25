import ts from "@typescript/typescript6";
import { markSource } from "./mapping.js";
import { locate } from "./sfc.js";

/** Archivo `.meeko` cuyos desplazamientos describen las ubicaciones emitidas para DevTools. */
export interface DevtoolsSourceContext {
  source: string;
  filename: string;
}

type ReadKind = "text" | "attribute" | "computed" | "if" | "each" | "prop";

const maxExpressionLength = 200;

function shorten(expression: string): string {
  const compact = expression.replace(/\s+/g, " ").trim();
  return compact.length > maxExpressionLength ? `${compact.slice(0, maxExpressionLength - 1)}…` : compact;
}

function position(context: DevtoolsSourceContext, offset: number): string {
  const point = locate(context.source, offset);
  return `file: ${JSON.stringify(context.filename)}, line: ${point.line}, column: ${point.column}`;
}

/** Literal de una ubicación de lectura; sólo se emite en compilaciones `hot`. */
export function readSiteLiteral(context: DevtoolsSourceContext, offset: number, expression: string, kind: ReadKind, name?: string): string {
  const named = name === undefined ? "" : `, name: ${JSON.stringify(name)}`;
  return `{ ${position(context, offset)}, expression: ${JSON.stringify(shorten(expression))}, kind: ${JSON.stringify(kind)}${named} }`;
}

/** Envuelve una lectura reactiva para atribuir sus dependencias a una ubicación de la plantilla. */
export function trackedRead(context: DevtoolsSourceContext, offset: number, expression: string, kind: ReadKind, code: string, name?: string): string {
  return `__meeko.trackReadSite(${readSiteLiteral(context, offset, expression, kind, name)}, () => ${code})`;
}

function writeSiteLiteral(context: DevtoolsSourceContext, offset: number, expression: string): string {
  return `{ kind: "assignment", ${position(context, offset)}, expression: ${JSON.stringify(shorten(expression))} }`;
}

/** Acepta sólo destinos sin efectos al evaluarse dos veces: identificadores, `this` y accesos encadenados. */
function isStableReference(node: ts.Expression): boolean {
  if (ts.isIdentifier(node) || node.kind === ts.SyntaxKind.ThisKeyword) return true;
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return isStableReference(node.expression);
  return ts.isPropertyAccessExpression(node) && !node.questionDotToken && ts.isIdentifier(node.name) && isStableReference(node.expression);
}

function signalTarget(node: ts.Expression): ts.Expression | undefined {
  if (!ts.isPropertyAccessExpression(node) || node.questionDotToken || !ts.isIdentifier(node.name) || node.name.text !== "value") return undefined;
  return isStableReference(node.expression) ? node.expression : undefined;
}

function isFunctionBoundary(node: ts.Node): boolean {
  return ts.isFunctionLike(node) || ts.isClassLike(node);
}

/** Una envoltura en función flecha cambiaría el significado de `await` o `yield` directos. */
function suspends(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found || isFunctionBoundary(child)) return;
    if (ts.isAwaitExpression(child) || ts.isYieldExpression(child)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

const passThroughAssignments = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

function isCompoundAssignment(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstCompoundAssignment && kind <= ts.SyntaxKind.LastCompoundAssignment && !passThroughAssignments.has(kind);
}

interface Insertion {
  at: number;
  text: string;
  /** Las aperturas exteriores van antes y sus cierres después de las interiores. */
  depth: number;
  closing: boolean;
}

/**
 * Inserta registros de DevTools en las escrituras `.value` y en `computed(...)` de `node`.
 * `sourceOffset` convierte una posición de `file` en un desplazamiento del `.meeko`.
 * Devuelve el texto marcado para el mapa de fuentes, o `undefined` si no hay nada que instrumentar.
 */
export function instrumentNode(file: ts.SourceFile, node: ts.Node, sourceOffset: (position: number) => number, context: DevtoolsSourceContext, options: { computed: boolean }): string | undefined {
  const insertions: Insertion[] = [];
  const wrap = (target: ts.Node, open: string, close: string, depth: number): void => {
    insertions.push({ at: target.getStart(file), text: open, depth, closing: false });
    insertions.push({ at: target.getEnd(), text: close, depth, closing: true });
  };
  const visit = (child: ts.Node, depth: number): void => {
    if (ts.isBinaryExpression(child)) {
      const target = signalTarget(child.left);
      const operator = child.operatorToken.kind;
      const site = () => writeSiteLiteral(context, sourceOffset(child.getStart(file)), child.getText(file));
      if (target && passThroughAssignments.has(operator)) {
        wrap(child.right, `__meeko.devtoolsWrite(${target.getText(file)}, ${site()}, `, ")", depth + 1);
      } else if (target && isCompoundAssignment(operator) && !suspends(child)) {
        wrap(child, `__meeko.devtoolsUpdate(${target.getText(file)}, ${site()}, () => (`, "))", depth);
      }
    } else if ((ts.isPrefixUnaryExpression(child) || ts.isPostfixUnaryExpression(child))
      && (child.operator === ts.SyntaxKind.PlusPlusToken || child.operator === ts.SyntaxKind.MinusMinusToken)) {
      const target = signalTarget(child.operand);
      if (target && !suspends(child)) {
        wrap(child, `__meeko.devtoolsUpdate(${target.getText(file)}, ${writeSiteLiteral(context, sourceOffset(child.getStart(file)), child.getText(file))}, () => (`, "))", depth);
      }
    } else if (options.computed && ts.isCallExpression(child) && ts.isIdentifier(child.expression) && child.expression.text === "computed"
      && child.arguments[0] !== undefined && (ts.isArrowFunction(child.arguments[0]) || ts.isFunctionExpression(child.arguments[0]))) {
      const argument = child.arguments[0]!;
      const site = readSiteLiteral(context, sourceOffset(argument.getStart(file)), argument.getText(file), "computed");
      wrap(argument, `__meeko.withReadSite(${site}, `, ")", depth + 1);
    }
    ts.forEachChild(child, (next) => visit(next, depth + 2));
  };
  visit(node, 0);
  if (insertions.length === 0) return undefined;
  insertions.sort((left, right) => left.at - right.at
    || Number(right.closing) - Number(left.closing)
    || (left.closing ? right.depth - left.depth : left.depth - right.depth));
  const start = node.getStart(file);
  const end = node.getEnd();
  const text = file.text;
  const parts: string[] = [];
  let cursor = start;
  for (const insertion of insertions) {
    if (insertion.at > cursor) parts.push(markSource(text.slice(cursor, insertion.at), sourceOffset(cursor)));
    parts.push(insertion.text);
    cursor = Math.max(cursor, insertion.at);
  }
  if (end > cursor) parts.push(markSource(text.slice(cursor, end), sourceOffset(cursor)));
  return parts.join("");
}

/** Instrumenta las escrituras `.value` de una expresión de evento de la plantilla. */
export function instrumentTemplateExpression(expression: string, offset: number, context: DevtoolsSourceContext): string {
  const prefix = "const __value = (";
  const file = ts.createSourceFile("template-expression.ts", `${prefix}${expression});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statement = file.statements[0];
  const declaration = statement && ts.isVariableStatement(statement) ? statement.declarationList.declarations[0] : undefined;
  const initializer = declaration?.initializer;
  const inner = initializer && ts.isParenthesizedExpression(initializer) ? initializer.expression : undefined;
  if (!inner) return expression;
  const leading = expression.slice(0, inner.getStart(file) - prefix.length);
  const trailing = expression.slice(inner.getEnd() - prefix.length);
  const instrumented = instrumentNode(file, inner, (position) => offset + position - prefix.length, context, { computed: false });
  return instrumented === undefined ? expression : `${leading}${instrumented}${trailing}`;
}
