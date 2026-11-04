import ts from '@typescript/typescript6'

export interface StandardSchemaTypes {
	readonly input: ts.Type
	readonly output: ts.Type
}

const unsafeFlags = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter

function isErased(type: ts.Type): boolean {
	return (type.flags & unsafeFlags) !== 0
}

function isUnsafe(type: ts.Type, checker: ts.TypeChecker, location: ts.Node, seen: Set<ts.Type>): boolean {
	if (isErased(type)) return true
	if (seen.has(type)) return false
	seen.add(type)

	if ((type.isUnionOrIntersection() && type.types.some((part) => isUnsafe(part, checker, location, seen))) || type.aliasTypeArguments?.some((argument) => isUnsafe(argument, checker, location, seen))) return true

	if (type.flags & ts.TypeFlags.Object) {
		const object = type as ts.ObjectType
		if ((object.objectFlags & ts.ObjectFlags.Reference) !== 0 && checker.getTypeArguments(object as ts.TypeReference).some((argument) => isUnsafe(argument, checker, location, seen))) return true

		const numberIndex = checker.getIndexTypeOfType(type, ts.IndexKind.Number)
		if (numberIndex && isUnsafe(numberIndex, checker, location, seen)) return true
		const stringIndex = checker.getIndexTypeOfType(type, ts.IndexKind.String)
		if (stringIndex && isUnsafe(stringIndex, checker, location, seen)) return true

		// Array and tuple methods contain library-level generics that are not part
		// of the serialized payload. Their element/type arguments above are.
		if (!checker.isArrayLikeType(type)) {
			for (const property of checker.getPropertiesOfType(type)) {
				if (isUnsafe(checker.getTypeOfSymbolAtLocation(property, location), checker, location, seen)) return true
			}
			for (const signature of [...checker.getSignaturesOfType(type, ts.SignatureKind.Call), ...checker.getSignaturesOfType(type, ts.SignatureKind.Construct)]) {
				if (signature.getParameters().some((parameter) => isUnsafe(checker.getTypeOfSymbolAtLocation(parameter, location), checker, location, seen)) || isUnsafe(signature.getReturnType(), checker, location, seen)) return true
			}
		}
	}
	return false
}

/**
 * The specifier of an import of `expression` that TypeScript could not resolve. Such an import has an
 * error type, which the checker reports as `any`: the cause is the import, not the schema.
 */
function unresolvedImport(expression: ts.Node, checker: ts.TypeChecker): string | undefined {
	if (ts.isIdentifier(expression)) {
		const declaration = checker.getSymbolAtLocation(expression)?.declarations?.[0]
		const statement = declaration && ts.findAncestor(declaration, ts.isImportDeclaration)
		if (statement && ts.isStringLiteral(statement.moduleSpecifier) && !checker.getSymbolAtLocation(statement.moduleSpecifier)) return statement.moduleSpecifier.text
	}
	return ts.forEachChild(expression, (child) => unresolvedImport(child, checker))
}

/** The error of a schema without concrete types, for `standardSchemaTypes`; `subject` says which schema it is. */
export function schemaTypesError(subject: string): (specifier?: string) => Error {
	return (specifier) => new Error(specifier === undefined ? `${subject} debe exponer tipos de entrada y salida de Standard Schema concretos` : `${subject} no tiene tipos porque TypeScript no resuelve el import "${specifier}". Revisa la ruta y moduleResolution en tsconfig.json: con NodeNext un import relativo necesita su extensión ("./schema.js"); con Bundler, no`)
}

/** Resolve the public Standard Schema contract without allowing erased client types. */
export function standardSchemaTypes(expression: ts.Expression, checker: ts.TypeChecker, invalid: (specifier?: string) => Error): StandardSchemaTypes {
	const schemaType = checker.getTypeAtLocation(expression)
	if (isErased(schemaType)) throw invalid(unresolvedImport(expression, checker))
	const standard = checker.getPropertyOfType(schemaType, '~standard')
	if (!standard) throw invalid()
	const standardType = checker.getTypeOfSymbolAtLocation(standard, expression)
	if (isErased(standardType)) throw invalid()
	const types = checker.getPropertyOfType(standardType, 'types')
	if (!types) throw invalid()
	const typesType = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(types, expression))
	if (isErased(typesType)) throw invalid()
	const input = checker.getPropertyOfType(typesType, 'input')
	const output = checker.getPropertyOfType(typesType, 'output')
	if (!input || !output) throw invalid()
	const inputType = checker.getTypeOfSymbolAtLocation(input, expression)
	const outputType = checker.getTypeOfSymbolAtLocation(output, expression)
	if (isUnsafe(inputType, checker, expression, new Set()) || isUnsafe(outputType, checker, expression, new Set())) throw invalid()
	return { input: inputType, output: outputType }
}
