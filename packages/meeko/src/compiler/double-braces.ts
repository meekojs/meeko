import ts from '@typescript/typescript6'

// `{{ expr }}` and `{ {expr} }`, Vue's interpolation written in a Meeko template: the inner braces
// read as an object literal, so the compiler would report "',' expected" or render
// `[object Object]`. The compiler, `meeko check` and the editor share this module to name the
// mistake and to fix it.

/** Section of the documentation that explains how braces are written as text. */
export const doubleBracesDocs = 'https://github.com/meekojs/meeko/blob/main/docs/reference/syntax/interpolation.md#una-llave-sin-cerrar'

/** Message of the MEEK020 that a double-brace interpolation reports. */
export const doubleBracesMessage = `Meeko interpola con una sola llave: {expr}, no {{expr}}. Para mostrar las llaves como texto, escribe {"{texto}"} (${doubleBracesDocs})`

/** A double-brace interpolation: what it holds and its fixes. */
export interface DoubleBraces {
	/** The expression inside the inner braces (`props.label`), trimmed. */
	readonly inner: string
	/** Whether `inner` is a valid expression, so `{inner}` compiles. */
	readonly valid: boolean
	/** `{inner}`: Meeko's interpolation; only when {@link valid}. */
	readonly interpolation?: string
	/** `{"{inner}"}`: the braces as text. */
	readonly text: string
}

function parses(expression: string): ts.Expression | undefined {
	const file = ts.createSourceFile('interpolation.ts', `(${expression});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }
	const statement = file.statements[0]
	if (file.parseDiagnostics.length || file.statements.length !== 1 || !statement || !ts.isExpressionStatement(statement)) return undefined
	let expressionNode = statement.expression
	while (ts.isParenthesizedExpression(expressionNode)) expressionNode = expressionNode.expression
	return expressionNode
}

/**
 * Whether a parsed object literal reads as `{{name}}`: a single shorthand property and nothing
 * else. An object with keys, spreads, methods or several properties (`{ a, b: 2 }`,
 * `{ ...props, a }`, `{ a, b }`) is unambiguous and stays an object.
 */
function singleShorthand(expression: ts.Expression): boolean {
	return ts.isObjectLiteralExpression(expression) && expression.properties.length === 1 && ts.isShorthandPropertyAssignment(expression.properties[0]!) && expression.properties[0].objectAssignmentInitializer === undefined
}

/**
 * Whether the expression of a text interpolation (what lies between its braces) is a double-brace
 * one: it starts and ends with a brace and either does not compile (`{props.label}`) or is an
 * object literal of a single shorthand property (`{ name }`). Any other object literal
 * (`{ a: 1 }`, `{ a, b: 2 }`, `{ ...props, a }`) is a valid expression and is left alone.
 *
 * @example
 * doubleBraces("{ props.label }") // { inner: "props.label", valid: true, interpolation: "{props.label}", text: '{"{ props.label }"}' }
 * doubleBraces("{ a: 1 }") // undefined
 * doubleBraces("{ a, b: 2 }") // undefined
 */
export function doubleBraces(expression: string): DoubleBraces | undefined {
	const trimmed = expression.trim()
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined
	const parsed = parses(trimmed)
	if (parsed && !singleShorthand(parsed)) return undefined
	const inner = trimmed.slice(1, -1).trim()
	const valid = inner !== '' && parses(inner) !== undefined
	return { inner, valid, ...(valid ? { interpolation: `{${inner}}` } : {}), text: `{${JSON.stringify(trimmed)}}` }
}
