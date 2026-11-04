import ts from '@typescript/typescript6'

import { freeIdentifiers } from './composables'
import { markSource } from './mapping'
import { compileError } from './parser/sfc'

/**
 * An `if:when` condition around a template expression, as code of the render path that reads it,
 * and the names it reads. Only `meeko check` emits guards: TypeScript narrows the expressions
 * behind them, as `v-if` does in Vue, and the module is never run.
 */
export interface Guard {
	readonly code: string
	readonly names: ReadonlySet<string>
}

/** Free names of a template expression. */
export function namesOf(expression: string): ReadonlySet<string> {
	return new Set(freeIdentifiers(expression).map(({ name }) => name))
}

/**
 * `code` behind the conditions around it: TypeScript narrows each condition's references inside,
 * also in a callback, where the narrowing of the enclosing code does not reach. `!!` keeps a
 * function or a promise from being reported as always truthy. The type of the result is the type
 * of `code`; without guards it is `code` itself.
 */
export function narrowed(code: string, guards: readonly Guard[]): string {
	return guards.length ? `(${guards.map((guard) => `!!(${guard.code})`).join(' && ')} ? ${code} : null!)` : code
}

/** The guards that still mean the same where `names` (list items, snippet parameters) shadow names. */
export function unshadowed(guards: readonly Guard[], names: Iterable<string | undefined>): Guard[] {
	const shadowing = [...names].filter((name): name is string => name !== undefined)
	return guards.filter((guard) => !shadowing.some((name) => guard.names.has(name)))
}

export function validateExpression(expression: string, source: string, filename: string, offset: number, sourcePosition: (position: number) => number = (position) => position): void {
	const prefix = 'const __check = ('
	const parsed = ts.createSourceFile(filename, `${prefix}${expression});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }
	const error = parsed.parseDiagnostics[0]
	if (error) {
		const position = Math.max(0, Math.min(expression.length, (error.start ?? prefix.length) - prefix.length))
		throw compileError(source, filename, 'MEEK020', ts.flattenDiagnosticMessageText(error.messageText, '\n'), offset + sourcePosition(position))
	}
}

/**
 * Replaces the template locals of an expression (a snippet parameter, for example) with the code
 * that reads them in the hydration. With `offset`, the expression's source position, every kept
 * piece and every replacement is mapped to its own span, so a TypeScript error after a rewritten
 * name (`.name` in `row.name`) is placed exactly, as in the other render paths.
 */
export function rewriteLocals(expression: string, locals: ReadonlyMap<string, string>, offset?: number): string {
	if (locals.size === 0) return expression
	const prefix = 'const __value = ('
	const file = ts.createSourceFile('template-expression.ts', `${prefix}${expression});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	const changes: Array<{ start: number; end: number; text: string }> = []
	function isShadowed(node: ts.Identifier): boolean {
		for (let parent = node.parent; parent; parent = parent.parent) {
			if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && parent.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === node.text)) return true
			if (ts.isSourceFile(parent)) break
		}
		return false
	}
	function visit(node: ts.Node): void {
		if (ts.isIdentifier(node)) {
			const replacement = locals.get(node.text)
			const parent = node.parent
			if (replacement && parent && !isShadowed(node) && !(ts.isPropertyAccessExpression(parent) && parent.name === node) && !(ts.isPropertyAssignment(parent) && parent.name === node) && !(ts.isParameter(parent) && parent.name === node) && !(ts.isVariableDeclaration(parent) && parent.name === node)) {
				const shorthand = ts.isShorthandPropertyAssignment(parent) && parent.name === node
				changes.push({ start: node.getStart(file) - prefix.length, end: node.getEnd() - prefix.length, text: shorthand ? `${node.text}: (${replacement})` : `(${replacement})` })
			}
		}
		ts.forEachChild(node, visit)
	}
	visit(file)
	const valid = changes.filter((change) => change.start >= 0 && change.end <= expression.length)
	if (offset !== undefined && valid.length > 0) {
		const parts: string[] = []
		let cursor = 0
		for (const change of valid) {
			if (change.start > cursor) parts.push(markSource(expression.slice(cursor, change.start), offset + cursor))
			parts.push(markSource(change.text, offset + change.start, change.end - change.start))
			cursor = change.end
		}
		if (cursor < expression.length) parts.push(markSource(expression.slice(cursor), offset + cursor))
		return parts.join('')
	}
	let result = expression
	for (const change of changes.reverse()) {
		if (change.start >= 0 && change.end <= expression.length) result = result.slice(0, change.start) + change.text + result.slice(change.end)
	}
	return result
}

/** Whether a template expression is an arrow function or a function expression. */
export function isFunctionLiteral(expression: string): boolean {
	const file = ts.createSourceFile('template-expression.ts', `(${expression});`, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
	const statement = file.statements[0]
	let node: ts.Expression | undefined = statement && ts.isExpressionStatement(statement) ? statement.expression : undefined
	while (node && ts.isParenthesizedExpression(node)) node = node.expression
	return node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node))
}
