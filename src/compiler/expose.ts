import ts from "@typescript/typescript6";

/** `defineExpose(value)` accepted by the compiler: a top-level expression statement. */
export interface ExposeDeclaration {
  readonly statement: ts.ExpressionStatement;
  readonly call: ts.CallExpression;
}

export class ExposeError extends Error {
  constructor(readonly code: string, message: string, readonly node: ts.Node) {
    super(message);
  }
}

/** Whether `node` is the identifier of a `defineExpose` reference, not a property name. */
function isMacroReference(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node) || node.text !== "defineExpose") return false;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return false;
  return true;
}

/**
 * Finds the only `defineExpose` of a script. It must be called once, as its own top-level
 * statement, with one argument and at most one type argument.
 */
export function analyzeExpose(file: ts.SourceFile): ExposeDeclaration | undefined {
  let found: ExposeDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (isMacroReference(node)) {
      const call = node.parent;
      const statement = ts.isCallExpression(call) && call.expression === node ? call.parent : undefined;
      const valid = statement !== undefined && ts.isExpressionStatement(statement) && statement.expression === call && ts.isSourceFile(statement.parent);
      if (!valid || found) {
        throw new ExposeError("MEEK050", "defineExpose debe aparecer una sola vez, como sentencia propia de nivel superior: defineExpose({ ... })", node);
      }
      const typed = call as ts.CallExpression;
      if (typed.arguments.length !== 1 || ts.isSpreadElement(typed.arguments[0]!)) {
        throw new ExposeError("MEEK051", "defineExpose necesita un argumento: el valor que recibe el padre a través de ref", typed.arguments[1] ?? typed);
      }
      if ((typed.typeArguments?.length ?? 0) > 1) throw new ExposeError("MEEK051", "defineExpose admite como mucho un argumento de tipo", typed.typeArguments![1]!);
      found = { statement: statement as ts.ExpressionStatement, call: typed };
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
