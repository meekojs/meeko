import ts from "@typescript/typescript6";

import { tagsAccepting } from "../../shared/html-attributes";

/** A string literal among the results of the expression of `<component is>`, at its offset in it. */
export interface TagLiteral {
  readonly tag: string;
  /** Offset of the literal, quotes included, inside the expression. */
  readonly offset: number;
  readonly length: number;
}

/** The possible results of the expression of `<component is>`, read from its syntax. */
export interface IsCandidates {
  /** String literals: tags. */
  readonly tags: readonly TagLiteral[];
  /** Any other result, as its source text: a component or a value whose type decides. */
  readonly others: readonly string[];
}

/**
 * The results of `is`: the branches of `?:` and the operand of parentheses, `as`, `satisfies` and
 * `!`. `props.href ? 'a' : 'button'` has two tag literals; `Card` and `props.as` are others, whose
 * types decide what they are.
 */
export function isCandidates(expression: string): IsCandidates {
  const prefix = "(";
  const file = ts.createSourceFile("is.ts", `${prefix}${expression})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statement = file.statements[0];
  const tags: TagLiteral[] = [];
  const others: string[] = [];
  const visit = (node: ts.Expression): void => {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      visit(node.whenTrue);
      visit(node.whenFalse);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const start = node.getStart(file) - prefix.length;
      tags.push({ tag: node.text, offset: start, length: node.getEnd() - node.getStart(file) });
      return;
    }
    others.push(node.getText(file));
  };
  if (statement && ts.isExpressionStatement(statement)) visit(statement.expression);
  else others.push(expression);
  return { tags, others };
}

/** A condition of `?:` on the way to a result of `is`: its source text, at its offset, and whether it must be false. */
export interface IsCondition {
  readonly text: string;
  /** Offset of the condition inside the expression of `is`. */
  readonly offset: number;
  readonly negated: boolean;
}

/** A result of the expression of `is` with the conditions of `?:` that lead to it. */
export interface IsLeaf {
  /** Text of a string literal; `undefined` for any other expression. */
  readonly literal?: string;
  /** Offset of the result, quotes included, inside the expression. */
  readonly offset: number;
  readonly length: number;
  readonly path: readonly IsCondition[];
}

/**
 * The results of `is` with their paths: `to ? 'MeekoLink' : href ? 'a' : 'button'` gives
 * `'MeekoLink'` under `to`, `'a'` under `!to && href` and `'button'` under `!to && !href`.
 * Parentheses, `as`, `satisfies` and `!` keep the path of their operand.
 */
export function isLeaves(expression: string): IsLeaf[] {
  const prefix = "(";
  const file = ts.createSourceFile("is.ts", `${prefix}${expression})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const statement = file.statements[0];
  const leaves: IsLeaf[] = [];
  const at = (node: ts.Node): number => node.getStart(file) - prefix.length;
  const visit = (node: ts.Expression, path: readonly IsCondition[]): void => {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
      visit(node.expression, path);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      const condition = { text: node.condition.getText(file), offset: at(node.condition) };
      visit(node.whenTrue, [...path, { ...condition, negated: false }]);
      visit(node.whenFalse, [...path, { ...condition, negated: true }]);
      return;
    }
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
    leaves.push({ ...(literal === undefined ? {} : { literal }), offset: at(node), length: node.getEnd() - node.getStart(file), path });
  };
  if (statement && ts.isExpressionStatement(statement)) visit(statement.expression, []);
  else leaves.push({ offset: 0, length: expression.length, path: [] });
  return leaves;
}

/**
 * Whether a string literal of `is` names a component (since 1.8): PascalCase, like `'MeekoLink'` or
 * `'UICard'`. HTML tags are written in lowercase, so `'button'` is the tag and `'Button'` a component.
 */
export function isComponentName(literal: string): boolean {
  return /^[A-Z][\w$]*$/.test(literal);
}

/** Attributes of `<MeekoLink>` that build its href: only its branch of `is` takes them. */
const linkAttributes = new Set(["to", "bind:to", "bind:params", "bind:search", "match", "bind:match"]);

/** A branch of `<component is>` with names: the `<a>` of `<MeekoLink>`, some HTML tags, or a component. */
export type IsBranchTarget = { readonly kind: "link" } | { readonly kind: "tags"; readonly tags: readonly string[] } | { readonly kind: "component" };

/**
 * Whether a branch of `<component is>` with names takes an attribute, by its name as written
 * (`raw`, such as `bind:params`) and as parsed (`name`, in lowercase). `<MeekoLink>` takes `to`,
 * `params`, `search` and `match` and the other attributes of its `<a>` except `href`; the tags, the
 * attributes of the HTML data that one of them accepts; a component, every prop, model and event.
 */
export function branchTakes(attribute: { readonly name: string }, raw: string, target: IsBranchTarget): boolean {
  const name = attribute.name;
  if (name.startsWith("ref:") || name === "bind" || name.startsWith(":")) return true;
  if (target.kind === "component") {
    if (name === "html") return false;
    if (raw === "model" || raw.startsWith("model:") || raw.startsWith("on:")) return true;
    const prop = raw.startsWith("bind:") ? raw.slice(5) : raw;
    return (/^[a-zA-Z_$][\w$]*$/.test(prop) && (raw.startsWith("bind:") || !["is", "ref", "html"].includes(prop))) || /^(?:aria|data)-/i.test(prop);
  }
  const link = target.kind === "link";
  const tags = target.kind === "link" ? ["a"] : target.tags;
  if (linkAttributes.has(raw)) return link;
  if (link && (raw === "href" || raw === "bind:href")) return false;
  if (name === "html") return true;
  if (raw === "model" || raw.startsWith("model:")) return false;
  if (name.startsWith("on:")) return /^[a-z]+$/.test(raw.slice(3));
  const attributeName = name.startsWith("bind:") ? name.slice(5) : name;
  if (name.startsWith("bind:") && (!/^[a-z][a-z0-9:.-]*$/.test(attributeName) || attributeName.startsWith("on"))) return false;
  const accepting = tagsAccepting(attributeName, tags);
  return accepting === null || accepting.length > 0;
}

/**
 * Condition of a branch of `is` with names: the conditions of `?:` that lead to one of its
 * literals, `!!(c1) && !(c2)`, joined with `||`. `map` writes each condition at its offset in the
 * expression of `is`.
 */
export function isBranchCondition(leaves: readonly IsLeaf[], map: (text: string, offset: number) => string): string {
  return leaves.map((leaf) => `(${leaf.path.length ? leaf.path.map((part) => `${part.negated ? "!" : "!!"}(${map(part.text, part.offset)})`).join(" && ") : "true"})`).join(" || ");
}

/** Names declared at the top level of the script: imports that are values, variables, functions and classes. */
export function scriptValueNames(script: string): Set<string> {
  const names = new Set<string>();
  const file = ts.createSourceFile("script.ts", script, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name);
  };
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (!clause || clause.isTypeOnly) continue;
      if (clause.name) names.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
      else if (bindings) for (const element of bindings.elements) if (!element.isTypeOnly) names.add(element.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) bind(declaration.name);
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      names.add(statement.name.text);
    }
  }
  return names;
}

/** Names that the script imports from a `.meeko` module: components, whatever their binding. */
export function importedComponents(script: string): Set<string> {
  const names = new Set<string>();
  if (!script.includes(".meeko")) return names;
  const file = ts.createSourceFile("script.ts", script, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.endsWith(".meeko")) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
  }
  return names;
}
