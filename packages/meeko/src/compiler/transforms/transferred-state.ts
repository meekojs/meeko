import ts from '@typescript/typescript6'

/** The call that creates state which travels with the SSR, and the code that checks it. */
export interface TransferredState {
	/** The initial value of `signal(value)`, or the factory of `useState(key, factory)`. */
	readonly value: ts.Expression
	readonly check: 'checkSignalState' | 'checkStateFactory'
}

/** Module that gives each name, for a script that imports it instead of relying on its autoimport. */
const stateSources: Readonly<Record<string, string>> = { signal: '@meekojs/meeko', useState: '@meekojs/meeko/framework' }

/**
 * The state of the script that travels to the browser: `signal(value)` and `useState(key, factory)`
 * as the whole initializer of a top-level declaration. A signal inside a function or an object does
 * not travel. A name that the script declares itself, or imports from another module, is not Meeko's.
 */
export function transferredStates(file: ts.SourceFile): TransferredState[] {
	const names = new Map(Object.keys(stateSources).map((name) => [name, name]))
	for (const statement of file.statements) {
		if (ts.isImportDeclaration(statement)) {
			const bindings = statement.importClause?.namedBindings
			if (!bindings || !ts.isNamedImports(bindings) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
			for (const element of bindings.elements) {
				const imported = (element.propertyName ?? element.name).text
				if (stateSources[imported] === statement.moduleSpecifier.text) names.set(element.name.text, imported)
				else names.delete(element.name.text)
			}
		} else if (ts.isFunctionDeclaration(statement) && statement.name) names.delete(statement.name.text)
		else if (ts.isVariableStatement(statement)) for (const { name } of statement.declarationList.declarations) if (ts.isIdentifier(name)) names.delete(name.text)
	}
	const found: TransferredState[] = []
	for (const statement of file.statements) {
		if (!ts.isVariableStatement(statement)) continue
		for (const declaration of statement.declarationList.declarations) {
			let call = declaration.initializer
			while (call && (ts.isParenthesizedExpression(call) || ts.isAsExpression(call) || ts.isSatisfiesExpression(call) || ts.isNonNullExpression(call))) call = call.expression
			if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.arguments.some(ts.isSpreadElement)) continue
			const kind = names.get(call.expression.text)
			const value = kind === 'signal' ? call.arguments[0] : kind === 'useState' ? call.arguments[1] : undefined
			if (value) found.push({ value, check: kind === 'signal' ? 'checkSignalState' : 'checkStateFactory' })
		}
	}
	return found
}

/**
 * The first `typeof name` of a type declaration whose `name` is a declaration of the setup. The
 * types of the script go to the module, where that name does not exist. A parameter of a function
 * type with that name is its own.
 */
export function setupTypeQuery(statement: ts.Statement, setupNames: ReadonlySet<string>): ts.Identifier | undefined {
	const shadowed = (node: ts.Node, name: string): boolean => {
		for (let current = node.parent; current && current !== statement.parent; current = current.parent) {
			if (ts.isFunctionTypeNode(current) || ts.isConstructorTypeNode(current) || ts.isMethodSignature(current) || ts.isCallSignatureDeclaration(current)) {
				if (current.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name)) return true
			}
		}
		return false
	}
	let found: ts.Identifier | undefined
	const visit = (node: ts.Node): void => {
		if (found) return
		if (ts.isTypeQueryNode(node)) {
			let root = node.exprName
			while (ts.isQualifiedName(root)) root = root.left
			if (setupNames.has(root.text) && !shadowed(node, root.text)) {
				found = root
				return
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(statement)
	return found
}

/** Names that the setup declares at the top level: its variables, functions and classes, not its imports. */
export function setupValueNames(file: ts.SourceFile): Set<string> {
	const names = new Set<string>()
	const bind = (name: ts.BindingName): void => {
		if (ts.isIdentifier(name)) names.add(name.text)
		else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name)
	}
	for (const statement of file.statements) {
		if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) bind(declaration.name)
		else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) names.add(statement.name.text)
	}
	return names
}
