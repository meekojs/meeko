import type { CompletionItem, Range } from 'vscode-languageserver/node'

import ts from '@typescript/typescript6'
import { CompletionItemKind, InsertTextFormat, MarkupKind } from 'vscode-languageserver/node'

import { tagAt, templateRegion } from './embedded'
import { attributeValueType, closedValues, htmlAttributeSource } from './html-data-source'

// Completion of what goes inside the template's directives, from what the script declares:
// the names of `ref:`, and in the values (`on:click="…"`, `model="…"`, `if:when="…"`, `each:of="…"`,
// `bind:x="…"`, `<render snippet="…">`) the declarations whose type fits the directive first,
// with their signals (`name.value`), props (`props.title`) and snippets (`snippets.icon`).

/** Names that the script reads with `useElementRef("name")`, in order and without repeats. */
export function declaredRefNames(source: string): string[] {
	const template = templateRegion(source)
	const script = source.slice(0, template ? template.contentStart : source.length)
	const names = new Set<string>()
	for (const match of script.matchAll(/\buseElementRef\s*(?:<[^>()]*>)?\s*\(\s*(["'`])([\w$-]+)\1/g)) names.add(match[2]!)
	return [...names]
}

/**
 * `ref:name` for the names that the script reads with `useElementRef`: the ones that no tag has yet
 * first (`sortText` starting with `0`), then the others, as a list may repeat its name. `range` is
 * what the item replaces, `ref:` included.
 *
 * @example
 * refNameCompletion(source, range, new Set()) // [{ label: "ref:panel", textEdit: { newText: "ref:panel" } }]
 */
export function refNameCompletion(source: string, range: Range, present: ReadonlySet<string>): CompletionItem[] {
	const template = templateRegion(source)
	const body = template ? source.slice(template.contentStart, template.contentEnd) : ''
	const used = new Set([...body.matchAll(/\sref:([\w$-]+)/g)].map((match) => match[1]!))
	return declaredRefNames(source)
		.filter((name) => !present.has(`ref:${name}`))
		.map((name): CompletionItem => {
			const free = !used.has(name)
			return {
				label: `ref:${name}`,
				kind: CompletionItemKind.Reference,
				detail: `useElementRef("${name}")`,
				documentation: { kind: MarkupKind.Markdown, value: free ? `El script lee \`useElementRef("${name}")\` y ninguna etiqueta lo tiene todavía.` : `Otra etiqueta ya tiene \`ref:${name}\`; sólo una lista puede repetirlo.` },
				sortText: `${free ? '0' : '1'}${name}`,
				filterText: `ref:${name}`,
				textEdit: { range, newText: `ref:${name}` },
			}
		})
}

/** Where the cursor is: the value of a directive of a tag, or an interpolation `{…}`. */
export interface ValueSite {
	/** Attribute whose value holds the cursor (`on:click`, `if:when`); `undefined` in `{…}`. */
	readonly attribute?: string
	readonly tag?: string
	readonly component?: boolean
}

/** The value or interpolation of the template that holds `offset`, if any. */
export function valueSiteAt(source: string, offset: number): ValueSite | undefined {
	const template = templateRegion(source)
	if (!template || offset <= template.contentStart || offset > template.contentEnd) return undefined
	const context = tagAt(source, offset)
	if (context?.value) {
		// `title="{x}"`: an interpolation inside a static value.
		const open = source.lastIndexOf('{', offset - 1)
		if (open >= context.value.start && open > source.lastIndexOf('}', offset - 1)) return {}
		// A static value (`variant="primary"`) is text: TypeScript completes its literals.
		const expression = /^(?:(?:bind|on|model|if|each)(?::|$)|html$)/.test(context.value.attribute) || (context.tag === 'render' && context.value.attribute === 'snippet')
		return expression ? { attribute: context.value.attribute, tag: context.tag, component: context.component } : undefined
	}
	if (context) return undefined
	const open = source.lastIndexOf('{', offset - 1)
	return open >= template.contentStart && open > source.lastIndexOf('}', offset - 1) ? {} : undefined
}

/** How well a type fits a directive: `0` best, `1` acceptable, `undefined` not at all. */
type Fit = (type: ts.Type) => number | undefined

interface Candidate {
	readonly text: string
	readonly type: ts.Type
	readonly rank: number
	readonly kind: CompletionItemKind
	/** A name that TypeScript already lists (a declaration), not a member path. */
	readonly direct: boolean
}

/** Inputs of {@link typedValueCompletion}. */
export interface TypedValueInput {
	readonly program: ts.Program
	readonly file: ts.SourceFile
	/** Offset of the cursor in the virtual code. */
	readonly offset: number
	readonly site: ValueSite
	/**
	 * What a new item replaces: the whole identifier around the cursor with the members already
	 * written after it (`ch|ecked.value`), or the cursor.
	 */
	readonly range: Range
	/** The range of the `.meeko` that a span of the virtual code covers, if it maps to one. */
	readonly sourceRange: (start: number, end: number) => Range | undefined
	/** TypeScript's items, by label; the declarations that fit get a better `sortText`. */
	readonly items: readonly CompletionItem[]
	/** Whether TypeScript's item is a local declaration (not an import to add). */
	readonly local: (item: CompletionItem) => boolean
}

/**
 * TypeScript's completion of a template value, ordered by the type that the directive expects:
 * the declarations of the script and the template that fit go first, plus their member paths
 * (`name.value` of a signal, `props.title`, `snippets.icon`, `item.id`) and the enumerated values
 * of an HTML attribute (`'submit'`). The expected type is TypeScript's contextual type in the
 * virtual code (an event handler, a model, a prop, a key) or, where the virtual code has none, the
 * directive's (a condition, a list, an HTML attribute's value).
 */
export function typedValueCompletion(input: TypedValueInput): CompletionItem[] {
	const { program, file, site } = input
	// Inside a string literal (`bind:variant="'pr|'"`): only the contents of the string.
	const literal = stringAt(file, input.offset)
	if (literal) return stringValueCompletion(input, literal)
	const checker = program.getTypeChecker()
	// An empty value is `undefined` in the virtual code, after the cursor: its context is the value's.
	let offset = input.offset
	while (offset < file.text.length && /[ 	]/.test(file.text[offset]!)) offset++
	const location = nodeAt(file, offset)
	if (!location) return [...input.items]
	const expected = expectedType(checker, location, offset)
	const template = enclosingTemplate(location)
	const fit = site.attribute === undefined ? undefined : fitFor(checker, site, expected)
	const items = input.items.map((item) => ({ ...item }))
	const byLabel = new Map(items.filter(input.local).map((item) => [item.label, item]))
	const candidates: Array<Candidate & { readonly own: number }> = []
	for (const symbol of checker.getSymbolsInScope(location, ts.SymbolFlags.Value)) {
		const declaration = symbol.declarations?.find((candidate) => candidate.getSourceFile() === file)
		const item = byLabel.get(symbol.name)
		// Never the macros and helpers that the virtual code declares (`defineProps`, `__meeko_*`).
		if (!declaration || !item || symbol.name.startsWith('__') || ambient(declaration)) continue
		const inTemplate = template !== undefined && declaration.pos >= template.pos && declaration.end <= template.end
		const imported = ts.isImportSpecifier(declaration) || ts.isImportClause(declaration) || ts.isNamespaceImport(declaration) || ts.isImportEqualsDeclaration(declaration)
		// The template's names, then the script's, before its imports and the globals.
		const own = inTemplate ? 0 : 1
		if (!imported) item.sortText = `09${own}${item.label}`
		if (!fit) continue
		const type = checker.getTypeOfSymbolAtLocation(symbol, location)
		// `never` (a ref that no tag has yet) is assignable to anything, but fits nothing.
		if (type.flags & ts.TypeFlags.Never) continue
		const rank = fit(type)
		if (rank !== undefined) candidates.push({ text: symbol.name, type, rank, kind: item.kind ?? CompletionItemKind.Variable, direct: true, own })
		if (imported) continue
		for (const member of memberPaths(checker, symbol, type, location, inTemplate)) {
			const memberRank = member.snippetOnly ? (site.tag === 'render' && site.attribute === 'snippet' ? 0 : fit(member.type)) : fit(member.type)
			if (memberRank !== undefined) candidates.push({ text: member.text, type: member.type, rank: memberRank, kind: CompletionItemKind.Field, direct: false, own })
		}
	}
	const added: CompletionItem[] = []
	for (const candidate of candidates) {
		const typeText = checker.typeToString(candidate.type, location, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope)
		const sortText = `0${candidate.rank}${candidate.own}${candidate.text}`
		if (candidate.direct) {
			const item = byLabel.get(candidate.text)!
			item.sortText = sortText
			item.detail ??= `${candidate.text}: ${typeText}`
			continue
		}
		const label = candidate.text.replace('$1', '')
		if (items.some((item) => item.label === label) || added.some((item) => item.label === label)) continue
		const snippet = candidate.text.includes('$1')
		added.push({
			label,
			kind: candidate.kind,
			detail: `${candidate.text.replace('$1', '…')}: ${typeText}`,
			sortText,
			filterText: label,
			...(snippet ? { insertTextFormat: InsertTextFormat.Snippet } : {}),
			textEdit: { range: input.range, newText: candidate.text },
		})
	}
	// TypeScript's own literals of the expected union (`"primary"`) go first too.
	const quoted = items.filter((item) => /^["'`]/.test(item.label))
	for (const item of quoted) item.sortText = `00${item.label}`
	return [...(quoted.length ? [] : literalItems(site, expected, input.range)), ...added, ...items]
}

/** The string literal of the virtual code whose contents hold `offset`, if any. */
function stringAt(file: ts.SourceFile, offset: number): ts.StringLiteralLike | undefined {
	const node = nodeAt(file, offset)
	if (!node || !ts.isStringLiteralLike(node)) return undefined
	const start = node.getStart(file)
	return offset > start && (offset < node.end || node.isUnterminated === true || node.end - start < 2) ? node : undefined
}

/**
 * Completion inside a string literal of a value: TypeScript's items keep their own range, the
 * contents of the string, and go first; the enumerated values of an HTML attribute in `bind:attr`
 * that TypeScript does not list insert only their text, without quotes.
 */
function stringValueCompletion(input: TypedValueInput, literal: ts.StringLiteralLike): CompletionItem[] {
	const items = input.items.map((item) => ({ ...item, sortText: `00${item.sortText ?? item.label}` }))
	const { site, file } = input
	if (!site.attribute?.startsWith('bind:') || site.component || !site.tag) return items
	const info = htmlAttributeSource()
		.attributes(site.tag)
		.find((candidate) => candidate.name === site.attribute!.slice(5))
	const values = info?.values?.filter((value) => value !== '' && !items.some((item) => item.label === value)) ?? []
	const start = literal.getStart(file) + 1
	// Up to the closing quote; an unterminated string ends where its text does.
	const range = input.sourceRange(start, Math.max(start, literal.isUnterminated ? literal.end : literal.end - 1))
	if (!range || !info) return items
	const detail = `${site.attribute}: ${attributeValueType(info)}`
	return [
		...values.map((value, index): CompletionItem => ({
			label: value,
			kind: CompletionItemKind.EnumMember,
			detail,
			sortText: `00${String(index).padStart(3, '0')}`,
			filterText: value,
			textEdit: { range, newText: value },
		})),
		...items,
	]
}

/** A declaration of the virtual code's own helpers: `declare function defineProps…`. */
function ambient(declaration: ts.Declaration): boolean {
	for (let current: ts.Node | undefined = declaration; current && !ts.isSourceFile(current); current = current.parent) {
		if (ts.canHaveModifiers(current) && ts.getModifiers(current)?.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return true
	}
	return false
}

/** The deepest node of `file` around `offset`. */
function nodeAt(file: ts.SourceFile, offset: number): ts.Node | undefined {
	let found: ts.Node | undefined
	const visit = (node: ts.Node): void => {
		if (offset < node.getStart(file) || offset > node.end) return
		found = node
		ts.forEachChild(node, visit)
	}
	visit(file)
	return found
}

/** The function of the virtual code that holds the template's expressions. */
function enclosingTemplate(node: ts.Node): ts.Node | undefined {
	for (let current: ts.Node | undefined = node; current; current = current.parent) {
		if (ts.isFunctionDeclaration(current) && current.name?.text === '__meeko_template') return current
	}
	return undefined
}

/**
 * TypeScript's contextual type at `offset`: of the expression being written (or the `undefined`
 * that stands for an empty value), or of the first argument of an empty call, as
 * `((handler: (event: MouseEvent) => unknown) => handler)()` of an empty `on:click=""`.
 */
function expectedType(checker: ts.TypeChecker, node: ts.Node, offset: number): ts.Type | undefined {
	if (ts.isExpression(node) && !ts.isCallExpression(node)) {
		const type = checker.getContextualType(node)
		if (type) return type
	}
	for (let current: ts.Node | undefined = node; current; current = current.parent) {
		if (ts.isCallExpression(current) && current.arguments.length === 0 && offset >= current.arguments.pos && offset <= current.arguments.end) {
			const parameter = checker.getResolvedSignature(current)?.parameters[0]
			return parameter ? checker.getTypeOfSymbolAtLocation(parameter, current) : undefined
		}
		if (ts.isStatement(current)) break
	}
	return undefined
}

const nullable = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void

/** The members of a type without `null` and `undefined`, and whether it had any. */
function parts(type: ts.Type): { members: ts.Type[]; optional: boolean } {
	const all = type.isUnion() ? type.types : [type]
	// `never` (a ref that no tag has yet) fits nothing.
	const members = all.filter((member) => !(member.flags & (nullable | ts.TypeFlags.Never)))
	return { members, optional: members.length < all.length }
}

const loose = ts.TypeFlags.Any | ts.TypeFlags.Unknown

/** How a value fits the directive at `site`. */
function fitFor(checker: ts.TypeChecker, site: ValueSite, expected: ts.Type | undefined): Fit | undefined {
	const attribute = site.attribute!
	const usable = expected && !(expected.flags & loose) ? expected : undefined
	const callable = (type: ts.Type): boolean => parts(type).members.some((member) => member.getCallSignatures().length > 0)
	if (attribute.startsWith('on:')) {
		// A handler whose signature fits the event; one without parameters is also valid.
		return (type) => {
			if (!callable(type) || (usable && !checker.isTypeAssignableTo(type, usable))) return undefined
			return parts(type).members.some((member) => member.getCallSignatures().some((signature) => signature.parameters.length > 0)) ? 0 : 1
		}
	}
	if (attribute === 'model' || attribute.startsWith('model:')) {
		// A writable signal whose value is the control's or the model's type: never a computed.
		return (type) => {
			const value = type.getProperty('value')
			if (!value || !writable(value) || callable(type)) return undefined
			return !usable || checker.isTypeAssignableTo(type, usable) ? 0 : undefined
		}
	}
	if (attribute === 'if:when') {
		// A condition: a boolean first, then a value that may be missing (an optional snippet).
		return (type) => {
			if (callable(type)) return undefined
			const { members, optional } = parts(type)
			if (members.length && members.every((member) => member.flags & ts.TypeFlags.BooleanLike)) return 0
			return optional && members.length ? 1 : undefined
		}
	}
	if (attribute === 'each:of') {
		return (type) => {
			const { members } = parts(type)
			if (!members.length || members.some((member) => member.flags & (ts.TypeFlags.StringLike | loose))) return undefined
			return members.every((member) => checker.isArrayLikeType(member) || member.getProperties().some((property) => String(property.escapedName).startsWith('__@iterator'))) ? 0 : undefined
		}
	}
	if (attribute === 'bind') {
		// `bind="obj"`: an object of attributes or props.
		return (type) => {
			const { members } = parts(type)
			return members.length && !callable(type) && members.every((member) => member.flags & ts.TypeFlags.Object && !checker.isArrayLikeType(member)) ? 0 : undefined
		}
	}
	if (site.tag === 'render' && attribute === 'snippet') return () => undefined
	if (attribute.startsWith('bind:') && !site.component && site.tag) {
		const info = htmlAttributeSource()
			.attributes(site.tag)
			.find((candidate) => candidate.name === attribute.slice(5))
		if (info?.boolean) return (type) => scalarFit(type, ts.TypeFlags.BooleanLike)
		const closed = info && closedValues(info)
		if (closed) {
			const values = new Set(closed)
			return (type) => {
				const { members } = parts(type)
				if (!members.length) return undefined
				// `true` writes the empty value (`hidden`, `popover`), when the attribute admits it.
				if (members.every((member) => (member.isStringLiteral() && values.has(member.value)) || (values.has('') && member.flags & ts.TypeFlags.BooleanLike))) return 0
				return members.every((member) => member.flags & ts.TypeFlags.StringLike) ? 1 : undefined
			}
		}
		return (type) => scalarFit(type, ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike)
	}
	if (attribute === 'each:key' && !usable) return (type) => scalarFit(type, ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike)
	if (!usable) return undefined
	// A prop of a component, a key: what the virtual code expects.
	return (type) => (!callable(type) || callable(usable) ? (checker.isTypeAssignableTo(type, usable) ? 0 : undefined) : undefined)
}

/** `0` when every member of `type` (without `null` and `undefined`) has one of `flags`. */
function scalarFit(type: ts.Type, flags: ts.TypeFlags): number | undefined {
	const { members } = parts(type)
	return members.length && members.every((member) => member.flags & flags) ? 0 : undefined
}

/** Whether a `value` property may be assigned: neither `readonly` nor a getter alone. */
function writable(property: ts.Symbol): boolean {
	const declarations = property.declarations ?? []
	if (declarations.some((declaration) => ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly)) return false
	return !(declarations.some(ts.isGetAccessorDeclaration) && !declarations.some(ts.isSetAccessorDeclaration))
}

interface MemberPath {
	readonly text: string
	readonly type: ts.Type
	/** A snippet of `defineSnippets`: valid in `<render snippet>` whatever its type. */
	readonly snippetOnly?: boolean
}

/**
 * The member paths of a declaration worth offering in a value: `name.value` of a signal or a
 * computed, the props of `defineProps` (`props.title`), the snippets of `defineSnippets`
 * (`snippets.icon`, `snippets['cell-$1']`) and the fields of a template name (`item.id`).
 */
function memberPaths(checker: ts.TypeChecker, symbol: ts.Symbol, type: ts.Type, location: ts.Node, inTemplate: boolean): MemberPath[] {
	const macro = macroOf(symbol)
	const path = (name: string): string => (/^[A-Za-z_$][\w$]*$/.test(name) ? `${symbol.name}.${name}` : `${symbol.name}['${name}']`)
	if (macro === 'defineSnippets') {
		const paths: MemberPath[] = type.getProperties().map((property) => ({ text: path(property.name), type: checker.getTypeOfSymbolAtLocation(property, location), snippetOnly: true }))
		// `[name: \`cell-${string}\`]`: a dynamic name, with the cursor after its prefix.
		for (const info of checker.getIndexInfosOfType(type)) {
			const key = info.keyType
			if (key.flags & ts.TypeFlags.TemplateLiteral) paths.push({ text: `${symbol.name}['${(key as ts.TemplateLiteralType).texts[0]}$1']`, type: info.type, snippetOnly: true })
		}
		return paths
	}
	if (macro === 'defineProps' || (inTemplate && (type.flags & ts.TypeFlags.Object) !== 0)) {
		if (checker.isArrayLikeType(type) || type.getCallSignatures().length) return []
		return type
			.getProperties()
			.filter((property) => !property.name.startsWith('__'))
			.map((property) => ({ text: path(property.name), type: checker.getTypeOfSymbolAtLocation(property, location) }))
	}
	const value = type.getProperty('value')
	if (value && type.getCallSignatures().length === 0) return [{ text: `${symbol.name}.value`, type: checker.getTypeOfSymbolAtLocation(value, location) }]
	return []
}

/** The macro that initializes a declaration (`defineProps`, `defineSnippets`), if any. */
function macroOf(symbol: ts.Symbol): string | undefined {
	for (const declaration of symbol.declarations ?? []) {
		if (!ts.isVariableDeclaration(declaration) || !declaration.initializer) continue
		let initializer: ts.Expression = declaration.initializer
		while (ts.isAsExpression(initializer) || ts.isParenthesizedExpression(initializer) || ts.isSatisfiesExpression(initializer)) initializer = initializer.expression
		if (ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression)) return initializer.expression.text
	}
	return undefined
}

/**
 * The enumerated values that fit, as string literals: those of an HTML attribute in `bind:attr`
 * (`'submit'` for `bind:type` of a `<button>`) or of a literal union that the value expects.
 */
function literalItems(site: ValueSite, expected: ts.Type | undefined, range: Range): CompletionItem[] {
	let values: string[] = []
	let detail: string | undefined
	if (site.attribute?.startsWith('bind:') && !site.component && site.tag) {
		const info = htmlAttributeSource()
			.attributes(site.tag)
			.find((candidate) => candidate.name === site.attribute!.slice(5))
		if (info?.values?.length) {
			values = info.values.filter((value) => value !== '')
			detail = `${site.attribute}: ${attributeValueType(info)}`
		}
	}
	if (!values.length && expected && site.attribute && !site.attribute.startsWith('on:')) {
		const { members } = parts(expected)
		if (members.length && members.every((member) => member.isStringLiteral())) values = members.map((member) => (member as ts.StringLiteralType).value)
	}
	return values.map((value, index): CompletionItem => ({
		label: `'${value}'`,
		kind: CompletionItemKind.EnumMember,
		...(detail ? { detail } : {}),
		sortText: `00${String(index).padStart(3, '0')}`,
		filterText: `'${value}'`,
		textEdit: { range, newText: `'${value}'` },
	}))
}
