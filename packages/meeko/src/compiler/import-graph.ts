import ts from "@typescript/typescript6";

export interface ModuleSpecifier {
  value: string;
  start: number;
  end: number;
}

/** Read static ESM edges from TypeScript instead of matching source text. */
export function moduleSpecifiers(code: string, filename: string): ModuleSpecifier[] {
  const file = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const result: ModuleSpecifier[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const literal = statement.moduleSpecifier;
    if (!literal || !ts.isStringLiteral(literal)) continue;
    result.push({ value: literal.text, start: literal.getStart(file) + 1, end: literal.getEnd() - 1 });
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]!)) {
      const literal = node.arguments[0];
      result.push({ value: literal.text, start: literal.getStart(file) + 1, end: literal.getEnd() - 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  result.sort((a, b) => a.start - b.start);
  return result;
}

export function replaceModuleSpecifiers(code: string, filename: string, convert: (specifier: ModuleSpecifier) => string): string {
  let output = code;
  for (const specifier of moduleSpecifiers(code, filename).reverse()) {
    const replacement = convert(specifier);
    output = output.slice(0, specifier.start) + replacement + output.slice(specifier.end);
  }
  return output;
}
