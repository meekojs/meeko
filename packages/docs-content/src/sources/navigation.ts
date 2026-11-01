import type TS from '@typescript/typescript6'

/** A page of the navigation of `apps/ui` or `apps/i18n`. */
export interface NavigationPage {
	readonly href: string
	readonly label: string
	readonly description: string | null
	/** Title of its section in the sidebar. */
	readonly section: string
}

/** A JSON-like value of a literal in the source. */
type Literal = boolean | Literal[] | null | number | string | { [key: string]: Literal }

/** Value of a literal expression: strings, numbers, booleans, null, arrays and objects. */
function evaluate(ts: typeof TS, node: TS.Expression, file: string): Literal {
	if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) return evaluate(ts, node.expression, file)
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
	if (ts.isNumericLiteral(node)) return Number(node.text)
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false
	if (node.kind === ts.SyntaxKind.NullKeyword) return null
	if (ts.isArrayLiteralExpression(node)) return node.elements.map((element) => evaluate(ts, element, file))
	if (ts.isObjectLiteralExpression(node)) {
		const value: { [key: string]: Literal } = {}
		for (const property of node.properties) {
			if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
				throw new Error(`${file}: the navigation must be a plain literal; found ${property.getText()}`)
			}
			value[property.name.text] = evaluate(ts, property.initializer, file)
		}
		return value
	}
	throw new Error(`${file}: the navigation must be a plain literal; found ${node.getText()}`)
}

function text(value: Literal | undefined, where: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${where} must be a non-empty string`)
	return value
}

/**
 * The pages of a `navigation.ts` of `apps/ui` or `apps/i18n`: `export const navigation = [{ title,
 * items: [{ label, href, description }] }]`, read from its syntax without running it. A page that
 * appears twice is listed once, at its first place.
 */
export async function parseNavigation(source: string, file: string): Promise<NavigationPage[]> {
	const ts = (await import('@typescript/typescript6')).default
	const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
	let literal: TS.Expression | undefined
	for (const statement of tree.statements) {
		if (!ts.isVariableStatement(statement)) continue
		for (const declaration of statement.declarationList.declarations) {
			if (ts.isIdentifier(declaration.name) && declaration.name.text === 'navigation' && declaration.initializer) literal = declaration.initializer
		}
	}
	if (!literal) throw new Error(`${file}: no "navigation" constant`)
	const sections = evaluate(ts, literal, file)
	if (!Array.isArray(sections)) throw new Error(`${file}: "navigation" must be an array`)
	const pages: NavigationPage[] = []
	const seen = new Set<string>()
	for (const [index, section] of sections.entries()) {
		if (!section || typeof section !== 'object' || Array.isArray(section)) throw new Error(`${file}: navigation[${index}] must be an object`)
		const title = text(section.title, `${file}: navigation[${index}].title`)
		if (!Array.isArray(section.items)) throw new Error(`${file}: navigation[${index}].items must be an array`)
		for (const [position, item] of section.items.entries()) {
			const where = `${file}: navigation[${index}].items[${position}]`
			if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${where} must be an object`)
			const href = text(item.href, `${where}.href`)
			if (!href.startsWith('/') || /[?#\s]/.test(href)) throw new Error(`${where}.href must be a path such as /installation`)
			if (seen.has(href)) continue
			seen.add(href)
			const description = typeof item.description === 'string' && item.description.trim() ? item.description : null
			pages.push({ href, label: text(item.label, `${where}.label`), description, section: title })
		}
	}
	return pages
}
