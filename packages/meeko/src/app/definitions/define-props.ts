import ts from "@typescript/typescript6";

/** A `defineProps(...)` call anywhere inside `node`; only a top-level declaration accepts it. */
export function definePropsCall(node: ts.Node): ts.CallExpression | undefined {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "defineProps") return node;
  return ts.forEachChild(node, definePropsCall);
}

/** The initializer of a `defineProps` declaration, if this declaration uses the macro. */
export function definePropsInitializer(declaration: ts.VariableDeclaration): ts.CallExpression | undefined {
  const initializer = declaration.initializer;
  return initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === "defineProps"
    ? initializer
    : undefined;
}

/** Type and defaults declared by a valid top-level `defineProps` binding. */
export interface PropsDeclaration {
  readonly typeArgument: ts.TypeNode | undefined;
  readonly defaults: PropsDefaults | undefined;
}

export function analyzePropsDeclaration(call: ts.CallExpression): PropsDeclaration {
  return { typeArgument: call.typeArguments?.[0], defaults: analyzePropsDefaults(call) };
}

/** A local interface passed to defineProps should use the shared component convention. */
export function nonstandardLocalPropsInterface(call: ts.CallExpression, file: ts.SourceFile): ts.Identifier | undefined {
  const argument = call.typeArguments?.[0];
  if (!argument || !ts.isTypeReferenceNode(argument) || !ts.isIdentifier(argument.typeName)) return undefined;
  const name = argument.typeName;
  if (name.text === "Props") return undefined;
  return file.statements.some((statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === name.text)
    ? name
    : undefined;
}

/** AST analysis shared by the compiler and the editor for defineProps defaults. */
export interface PropsDefaults {
  readonly argument: ts.ObjectLiteralExpression;
  readonly keys: readonly string[];
}

export class PropsDefaultsError extends Error {
  constructor(readonly code: string, message: string, readonly node: ts.Node) {
    super(message);
  }
}

export function analyzePropsDefaults(call: ts.CallExpression): PropsDefaults | undefined {
  if (call.arguments.length === 0) return undefined;
  if (call.arguments.length !== 1 || !ts.isObjectLiteralExpression(call.arguments[0]!)) {
    throw new PropsDefaultsError("MEEK040", "Los valores por defecto de defineProps necesitan un solo objeto literal", call.arguments[0] ?? call);
  }
  const argument = call.arguments[0];
  const keys: string[] = [];
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      throw new PropsDefaultsError("MEEK041", "Los valores por defecto de defineProps necesitan propiedades con nombre", property);
    }
    const key = property.name.text;
    if (key === "__proto__" || keys.includes(key)) {
      throw new PropsDefaultsError("MEEK042", `Valor por defecto de prop duplicado o inseguro: ${key}`, property.name);
    }
    keys.push(key);
  }
  return { argument, keys };
}

import { apiDocs, jsdoc } from "./compiler-docs";

export const definePropsDocs = jsdoc(
    "Macro de compilación: declara las props del componente con el tipo `T` y devuelve el objeto de props.",
    "No se importa ni existe en tiempo de ejecución.",
    "",
    "El argumento opcional es un objeto literal de valores por defecto: esas props pasan a ser opcionales",
    "para el padre y, dentro del componente, nunca son `undefined`. Debe aparecer una sola vez, en su",
    "propia declaración (`MEEK016`), y con argumento de tipo (`MEEK017`).",
    "Una interfaz declarada en este mismo <script> debe llamarse `Props` (`MEEK120`, aviso).",
    "",
    "@example",
    "```html",
    "<script lang=\"ts\">",
    "interface Props { title: string; count?: number }",
    "const props = defineProps<Props>({ count: 0 });",
    "</script>",
    "<template><h2>{props.title} ({props.count})</h2></template>",
    "```",
    `@see ${apiDocs}#valores-por-defecto-en-defineprops`,
  );
