import ts from "@typescript/typescript6";

/** `const name = defineEmits<T>()` accepted by the compiler. */
export interface EmitsDeclaration {
  readonly declaration: ts.VariableDeclaration & { readonly name: ts.Identifier };
  readonly typeArgument: ts.TypeNode;
}

export class EmitsError extends Error {
  constructor(readonly code: string, message: string, readonly node: ts.Node) {
    super(message);
  }
}

/** Whether `node` is the identifier of a `defineEmits` reference, not a property name. */
function isMacroReference(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node) || node.text !== "defineEmits") return false;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return false;
  return true;
}

/**
 * Finds the only `defineEmits` of a script. It must be called once, in its own top-level
 * `const` with a simple name, with one type argument and no runtime arguments.
 */
export function analyzeEmits(file: ts.SourceFile): EmitsDeclaration | undefined {
  let found: EmitsDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (isMacroReference(node)) {
      const call = node.parent;
      const declaration = ts.isCallExpression(call) && call.expression === node ? call.parent : undefined;
      const list = declaration && ts.isVariableDeclaration(declaration) ? declaration.parent : undefined;
      const valid = declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer === call
        && ts.isIdentifier(declaration.name)
        && list !== undefined && ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0 && list.declarations.length === 1
        && ts.isVariableStatement(list.parent) && ts.isSourceFile(list.parent.parent);
      if (!valid || found) {
        throw new EmitsError("MEEK045", "defineEmits debe aparecer una sola vez, en su propia declaración const de nivel superior con un nombre simple", node);
      }
      const typed = call as ts.CallExpression;
      if (typed.typeArguments?.length !== 1) throw new EmitsError("MEEK046", "defineEmits necesita un argumento de tipo, como defineEmits<{ save: [id: number] }>()", typed);
      if (typed.arguments.length > 0) throw new EmitsError("MEEK047", "defineEmits no admite argumentos en tiempo de ejecución; declara los eventos en su argumento de tipo", typed.arguments[0]!);
      found = { declaration: declaration as EmitsDeclaration["declaration"], typeArgument: typed.typeArguments[0]! };
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
