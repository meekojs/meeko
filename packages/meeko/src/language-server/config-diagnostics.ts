import type { TextDocument } from 'vscode-languageserver-textdocument'
import type { Diagnostic } from 'vscode-languageserver/node'

import ts from '@typescript/typescript6'
import { DiagnosticSeverity, DiagnosticTag } from 'vscode-languageserver/node'

import { t } from './l10n'

/** An entry of `modules` in a deprecated form, found without running the configuration. */
export interface DeprecatedModuleEntry {
	readonly start: number
	readonly end: number
	readonly index: number
	/** The string to write in `modules`, when the source tells it (the specifier of an import). */
	readonly name?: string
	readonly message: string
}

function unwrap(node: ts.Expression): ts.Expression {
	let current = node
	while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current)) {
		current = current.expression
	}
	return current
}

/** The object literal of `export default defineMeekoConfig({ … })`, `export default { … }` or a constant of the same file. */
function configObject(source: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
	const exported = source.statements.find(ts.isExportAssignment)
	if (!exported) return undefined
	let current: ts.Expression | undefined = unwrap(exported.expression)
	if (ts.isIdentifier(current)) {
		const name = current.text
		const declaration = source.statements
			.filter(ts.isVariableStatement)
			.flatMap((statement) => [...statement.declarationList.declarations])
			.find((item) => ts.isIdentifier(item.name) && item.name.text === name)
		current = declaration?.initializer ? unwrap(declaration.initializer) : undefined
	}
	if (current && ts.isCallExpression(current)) current = current.arguments[0] ? unwrap(current.arguments[0]) : undefined
	return current && ts.isObjectLiteralExpression(current) ? current : undefined
}

/** The module specifier of a default or named import of `name`. */
function importedFrom(source: ts.SourceFile, name: string): string | undefined {
	for (const statement of source.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue
		const clause = statement.importClause
		const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.some((element) => element.name.text === name) : false
		if (clause?.name?.text === name || named) return statement.moduleSpecifier.text
	}
	return undefined
}

/** The name to write in `modules` for an import: a package without its `/module` subpath, a path as written. */
function entryName(specifier: string): string {
	if (specifier.startsWith('.') || specifier.startsWith('/')) return specifier.replace(/\/index\.[cm]?[jt]s$/, '').replace(/\.[cm]?[jt]s$/, '')
	return specifier.replace(/\/module$/, '')
}

/**
 * The entries of `modules` in `meeko.config.*` that are not strings: an imported module or
 * `[module, options]`, deprecated since 1.8 (`MEEK126`). Read from the text, without running
 * anything, as the editor of an untrusted workspace can.
 */
export function deprecatedModuleEntries(text: string, filename: string): DeprecatedModuleEntry[] {
	const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, /\.m?js$/.test(filename) ? ts.ScriptKind.JS : ts.ScriptKind.TS)
	const config = configObject(source)
	const modules = config?.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === 'modules')
	const list = modules ? unwrap(modules.initializer) : undefined
	if (!list || !ts.isArrayLiteralExpression(list)) return []
	const result: DeprecatedModuleEntry[] = []
	list.elements.forEach((element, index) => {
		const value = unwrap(element as ts.Expression)
		if (ts.isStringLiteralLike(value) || ts.isSpreadElement(element)) return
		const tuple = ts.isArrayLiteralExpression(value)
		const reference = tuple ? (value.elements[0] ? unwrap(value.elements[0] as ts.Expression) : undefined) : value
		const name =
			reference && ts.isStringLiteralLike(reference)
				? reference.text
				: reference && ts.isIdentifier(reference)
					? (() => {
							const from = importedFrom(source, reference.text)
							return from === undefined ? undefined : entryName(from)
						})()
					: undefined
		const written = name === undefined ? t('its package name or its path') : JSON.stringify(name)
		const form = tuple ? t('[module, options]') : t('an imported module')
		result.push({
			start: element.getStart(source),
			end: element.getEnd(),
			index,
			...(name === undefined ? {} : { name }),
			message: t('MEEK126: modules[{0}] uses {1}, deprecated since 1.8. Write it by its name, modules: [{2}], and pass its options under the meeko.config key that its meta.configKey declares. It keeps working in 1.x and will stop working in Meeko 2.0.', index, form, written),
		})
	})
	return result
}

/** The diagnostics of the deprecated entries of `modules` in an open or read `meeko.config.*`. */
export function configWarnings(document: TextDocument, filename: string): Diagnostic[] {
	let entries: DeprecatedModuleEntry[]
	try {
		entries = deprecatedModuleEntries(document.getText(), filename)
	} catch {
		return []
	}
	return entries.map((entry) => ({
		range: { start: document.positionAt(entry.start), end: document.positionAt(entry.end) },
		message: entry.message,
		code: 'MEEK126',
		source: 'Meeko',
		severity: DiagnosticSeverity.Warning,
		tags: [DiagnosticTag.Deprecated],
	}))
}
