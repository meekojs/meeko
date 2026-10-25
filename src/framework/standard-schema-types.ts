import ts from "@typescript/typescript6";

export interface StandardSchemaTypes {
  readonly input: ts.Type;
  readonly output: ts.Type;
}

const unsafeFlags = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter;

function isErased(type: ts.Type): boolean {
  return (type.flags & unsafeFlags) !== 0;
}

function isUnsafe(type: ts.Type, checker: ts.TypeChecker, location: ts.Node, seen: Set<ts.Type>): boolean {
  if (isErased(type)) return true;
  if (seen.has(type)) return false;
  seen.add(type);

  if ((type.isUnionOrIntersection() && type.types.some((part) => isUnsafe(part, checker, location, seen)))
    || type.aliasTypeArguments?.some((argument) => isUnsafe(argument, checker, location, seen))) return true;

  if (type.flags & ts.TypeFlags.Object) {
    const object = type as ts.ObjectType;
    if ((object.objectFlags & ts.ObjectFlags.Reference) !== 0
      && checker.getTypeArguments(object as ts.TypeReference).some((argument) => isUnsafe(argument, checker, location, seen))) return true;

    const numberIndex = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    if (numberIndex && isUnsafe(numberIndex, checker, location, seen)) return true;
    const stringIndex = checker.getIndexTypeOfType(type, ts.IndexKind.String);
    if (stringIndex && isUnsafe(stringIndex, checker, location, seen)) return true;

    // Array and tuple methods contain library-level generics that are not part
    // of the serialized payload. Their element/type arguments above are.
    if (!checker.isArrayLikeType(type)) {
      for (const property of checker.getPropertiesOfType(type)) {
        if (isUnsafe(checker.getTypeOfSymbolAtLocation(property, location), checker, location, seen)) return true;
      }
      for (const signature of [...checker.getSignaturesOfType(type, ts.SignatureKind.Call), ...checker.getSignaturesOfType(type, ts.SignatureKind.Construct)]) {
        if (signature.getParameters().some((parameter) =>
          isUnsafe(checker.getTypeOfSymbolAtLocation(parameter, location), checker, location, seen))
          || isUnsafe(signature.getReturnType(), checker, location, seen)) return true;
      }
    }
  }
  return false;
}

/** Resolve the public Standard Schema contract without allowing erased client types. */
export function standardSchemaTypes(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  invalid: () => Error,
): StandardSchemaTypes {
  const schemaType = checker.getTypeAtLocation(expression);
  if (isErased(schemaType)) throw invalid();
  const standard = checker.getPropertyOfType(schemaType, "~standard");
  if (!standard) throw invalid();
  const standardType = checker.getTypeOfSymbolAtLocation(standard, expression);
  if (isErased(standardType)) throw invalid();
  const types = checker.getPropertyOfType(standardType, "types");
  if (!types) throw invalid();
  const typesType = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(types, expression));
  if (isErased(typesType)) throw invalid();
  const input = checker.getPropertyOfType(typesType, "input");
  const output = checker.getPropertyOfType(typesType, "output");
  if (!input || !output) throw invalid();
  const inputType = checker.getTypeOfSymbolAtLocation(input, expression);
  const outputType = checker.getTypeOfSymbolAtLocation(output, expression);
  if (isUnsafe(inputType, checker, expression, new Set()) || isUnsafe(outputType, checker, expression, new Set())) throw invalid();
  return { input: inputType, output: outputType };
}
