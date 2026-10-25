import ts from "@typescript/typescript6";

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
    throw new PropsDefaultsError("MEEK040", "defineProps defaults require one object literal", call.arguments[0] ?? call);
  }
  const argument = call.arguments[0];
  const keys: string[] = [];
  for (const property of argument.properties) {
    if (!ts.isPropertyAssignment(property) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
      throw new PropsDefaultsError("MEEK041", "defineProps defaults require named properties", property);
    }
    const key = property.name.text;
    if (key === "__proto__" || keys.includes(key)) {
      throw new PropsDefaultsError("MEEK042", `Duplicate or unsafe default prop: ${key}`, property.name);
    }
    keys.push(key);
  }
  return { argument, keys };
}
