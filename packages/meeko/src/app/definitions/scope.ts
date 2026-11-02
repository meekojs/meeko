import ts from '@typescript/typescript6'

/**
 * Lexical scopes of a TypeScript AST, enough to tell whether an identifier reads a name that a
 * scope below a root declares (a parameter, a local `const`, a `catch` variable…) or a name of the
 * root scope itself. The destructured props of `defineProps` use it: a read of `label` becomes
 * `props.label` unless a closer scope shadows `label`.
 */

/** Names that a binding name declares: `a`, `{ a, b: c, ...d }`, `[a, , b]`. */
export function bindingNames(name: ts.BindingName, found: string[] = []): string[] {
	if (ts.isIdentifier(name)) found.push(name.text)
	else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bindingNames(element.name, found)
	return found
}

const declaredCache = new WeakMap<ts.Node, ReadonlySet<string>>()

/** `var` declarations of a function body, which belong to the function scope, without crossing nested functions. */
function hoistedVars(node: ts.Node, found: string[]): void {
	if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.BlockScoped) === 0) {
		for (const declaration of node.declarations) bindingNames(declaration.name, found)
	}
	if (ts.isFunctionLike(node) || ts.isClassLike(node)) return
	ts.forEachChild(node, (child) => hoistedVars(child, found))
}

/** Block-scoped declarations directly in a list of statements, and function declarations. */
function statementDeclarations(statements: readonly ts.Statement[], found: string[]): void {
	for (const statement of statements) {
		if (ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.BlockScoped) !== 0) {
			for (const declaration of statement.declarationList.declarations) bindingNames(declaration.name, found)
		} else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
			found.push(statement.name.text)
		}
	}
}

/** Names that `node` declares for the code inside it, if it is a scope; the source file is not. */
function declaredNames(node: ts.Node): ReadonlySet<string> | undefined {
	const cached = declaredCache.get(node)
	if (cached) return cached
	const found: string[] = []
	if (ts.isFunctionLike(node)) {
		for (const parameter of node.parameters) bindingNames(parameter.name, found)
		if (ts.isFunctionExpression(node) && node.name) found.push(node.name.text)
		const body = (node as ts.FunctionLikeDeclaration).body
		if (body) hoistedVars(body, found)
	} else if (ts.isClassExpression(node) && node.name) {
		found.push(node.name.text)
	} else if (ts.isBlock(node) || ts.isModuleBlock(node)) {
		statementDeclarations(node.statements, found)
	} else if (ts.isCaseBlock(node)) {
		for (const clause of node.clauses) statementDeclarations(clause.statements, found)
	} else if ((ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
		for (const declaration of node.initializer.declarations) bindingNames(declaration.name, found)
	} else if (ts.isCatchClause(node) && node.variableDeclaration) {
		bindingNames(node.variableDeclaration.name, found)
	} else {
		return undefined
	}
	const names = new Set(found)
	declaredCache.set(node, names)
	return names
}

/** Whether a scope between `node` and `root` (included, unless it is the source file) declares `node.text`. */
export function shadowedBelow(node: ts.Identifier, root: ts.Node): boolean {
	for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
		if (!ts.isSourceFile(current) && declaredNames(current)?.has(node.text)) return true
		if (current === root) break
	}
	return false
}

/** Whether `node` reads or writes a variable: not a property name, a declared name, a label or a type. */
export function isValueReference(node: ts.Identifier): boolean {
	const parent = node.parent
	if (!parent) return false
	if (ts.isPropertyAccessExpression(parent)) return parent.expression === node
	if (ts.isQualifiedName(parent)) return parent.left === node
	if (ts.isBindingElement(parent)) return parent.initializer === node
	if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isEnumMember(parent)) && parent.name === node) return false
	if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) || ts.isClassExpression(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) || ts.isTypeParameterDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isModuleDeclaration(parent)) && parent.name === node) return false
	if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent) || ts.isImportEqualsDeclaration(parent) || ts.isNamespaceExport(parent)) return false
	if ((ts.isLabeledStatement(parent) || ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node) return false
	if (ts.isMetaProperty(parent) || ts.isTypeReferenceNode(parent)) return false
	return true
}

/**
 * Value references inside `root` whose name `accept` takes and that no scope below `root` shadows:
 * reads of the root scope's own names, or of free names. Type positions are skipped, except the
 * name that a type query reads (`typeof label`) when `typeQueries` is set: it names a value too.
 */
export function rootReferences(root: ts.Node, accept: (name: string) => boolean, typeQueries = false): ts.Identifier[] {
	const found: ts.Identifier[] = []
	const visit = (node: ts.Node): void => {
		if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return
		if (ts.isTypeNode(node)) {
			if (typeQueries) visitTypeQueries(node)
			return
		}
		if (ts.isIdentifier(node)) {
			if (accept(node.text) && isValueReference(node) && !shadowedBelow(node, root)) found.push(node)
			return
		}
		ts.forEachChild(node, visit)
	}
	const visitTypeQueries = (node: ts.Node): void => {
		if (ts.isTypeQueryNode(node)) {
			const name = typeQueryRoot(node)
			if (accept(name.text) && !shadowedBelow(name, root)) found.push(name)
		}
		ts.forEachChild(node, visitTypeQueries)
	}
	visit(root)
	return found
}

/** The first name of a type query: `label` in `typeof label` and in `typeof label.length`. */
export function typeQueryRoot(query: ts.TypeQueryNode): ts.Identifier {
	let name: ts.EntityName = query.exprName
	while (ts.isQualifiedName(name)) name = name.left
	return name
}

/** Whether `node` is written: the target of `=`, of a compound assignment, of `++`/`--`, of `delete` or of a destructuring assignment. */
export function isWriteTarget(node: ts.Identifier): boolean {
	let child: ts.Node = node
	let parent = node.parent
	while (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isTypeAssertionExpression(parent)) {
		child = parent
		parent = parent.parent
	}
	if (ts.isBinaryExpression(parent) && parent.left === child) {
		const operator = parent.operatorToken.kind
		return operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment
	}
	if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) && (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) return true
	// `delete label` would remove the prop from the props object, which may be the parent's own.
	if (ts.isDeleteExpression(parent) && parent.expression === child) return true
	if ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === child) return true
	// `[a] = value`, `({ a } = value)`, `({ x: a } = value)`.
	let current: ts.Node = child
	let inPattern = false
	for (;;) {
		const outer = current.parent
		if ((ts.isShorthandPropertyAssignment(outer) && outer.name === current) || (ts.isPropertyAssignment(outer) && outer.initializer === current) || ts.isSpreadElement(outer) || ts.isSpreadAssignment(outer) || ts.isParenthesizedExpression(outer)) {
			current = outer
			continue
		}
		if (ts.isArrayLiteralExpression(outer) || ts.isObjectLiteralExpression(outer)) {
			current = outer
			inPattern = true
			continue
		}
		break
	}
	if (!inPattern) return false
	const target = current.parent
	return (ts.isBinaryExpression(target) && target.left === current && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) || ((ts.isForInStatement(target) || ts.isForOfStatement(target)) && target.initializer === current)
}
