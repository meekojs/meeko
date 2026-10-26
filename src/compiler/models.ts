import ts from "@typescript/typescript6";

/** `const name = defineModel<T>(modelName?, options?)` accepted by the compiler. */
export interface ModelDeclaration {
  readonly declaration: ts.VariableDeclaration & { readonly name: ts.Identifier };
  readonly call: ts.CallExpression;
  /** `default` for `defineModel<T>()`, or the literal name of a named model. */
  readonly name: string;
  readonly typeArgument: ts.TypeNode;
  /** `{ default: value }`, if the model has a default. */
  readonly options?: ts.ObjectLiteralExpression;
}

export class ModelError extends Error {
  constructor(readonly code: string, message: string, readonly node: ts.Node) {
    super(message);
  }
}

/** Whether `node` is the identifier of a `defineModel` reference, not a property name. */
function isMacroReference(node: ts.Node): node is ts.Identifier {
  if (!ts.isIdentifier(node) || node.text !== "defineModel") return false;
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return false;
  return true;
}

/** Whether an options object only has `default`, written as a property or shorthand. */
function defaultOnly(options: ts.ObjectLiteralExpression): ts.Node | undefined {
  const names = new Set<string>();
  for (const property of options.properties) {
    const name = (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : undefined;
    if (name !== "default" || names.has(name)) return property;
    names.add(name);
  }
  return names.has("default") ? undefined : options;
}

/**
 * Finds the `defineModel` calls of a script. Each one is its own top-level `const` with a simple
 * name, one type argument, an optional literal model name and optional `{ default }` options;
 * each model name appears once.
 */
export function analyzeModels(file: ts.SourceFile): ModelDeclaration[] {
  const found: ModelDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (isMacroReference(node)) {
      const call = node.parent;
      const declaration = ts.isCallExpression(call) && call.expression === node ? call.parent : undefined;
      const list = declaration && ts.isVariableDeclaration(declaration) ? declaration.parent : undefined;
      const valid = declaration !== undefined && ts.isVariableDeclaration(declaration) && declaration.initializer === call
        && ts.isIdentifier(declaration.name)
        && list !== undefined && ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0 && list.declarations.length === 1
        && ts.isVariableStatement(list.parent) && ts.isSourceFile(list.parent.parent);
      if (!valid) throw new ModelError("MEEK063", "defineModel debe ir en su propia declaración const de nivel superior con un nombre simple", node);
      const typed = call as ts.CallExpression;
      if (typed.typeArguments?.length !== 1) throw new ModelError("MEEK064", "defineModel necesita un argumento de tipo, como defineModel<string>()", typed);
      const [first, second, extra] = typed.arguments;
      if (extra) throw new ModelError("MEEK064", "defineModel admite un nombre de modelo y unas opciones: defineModel<T>(\"name\", { default: value })", extra);
      let nameNode: ts.Expression | undefined;
      let options: ts.Expression | undefined;
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
        nameNode = first;
        options = second;
      } else if (first && second) {
        throw new ModelError("MEEK064", "El nombre de modelo de defineModel debe ser un literal de texto, como defineModel<boolean>(\"open\")", first);
      } else options = first;
      const name = nameNode && (ts.isStringLiteral(nameNode) || ts.isNoSubstitutionTemplateLiteral(nameNode)) ? nameNode.text : "default";
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new ModelError("MEEK063", `Nombre de modelo no válido: "${name}"; usa un identificador, como "open"`, nameNode ?? typed);
      if (options && !ts.isObjectLiteralExpression(options)) {
        throw new ModelError("MEEK064", "defineModel recibe un nombre como literal de texto y un objeto literal: defineModel<T>(\"name\", { default: value })", options);
      }
      if (options) {
        const invalid = defaultOnly(options);
        if (invalid) throw new ModelError("MEEK064", "Las opciones de defineModel sólo admiten default: { default: value }", invalid);
      }
      const previous = found.find((model) => model.name === name);
      if (previous) {
        throw new ModelError("MEEK063", name === "default" ? "El modelo default ya está declarado; da nombre a los demás modelos: defineModel<T>(\"name\")" : `El modelo "${name}" ya está declarado`, nameNode ?? typed);
      }
      found.push({
        declaration: declaration as ModelDeclaration["declaration"],
        call: typed,
        name,
        typeArgument: typed.typeArguments[0]!,
        ...(options ? { options } : {}),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
