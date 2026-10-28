import ts from "@typescript/typescript6";

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
