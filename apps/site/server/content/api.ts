import { relative } from 'node:path'
import type TS from '@typescript/typescript6'
import type { ApiIndexGroup, ApiIndexItem, ApiKind, ApiLink, ApiMember, ApiPage, ApiParameter } from '../../shared/types/api.js'
import type { NavLink, Pager, TocEntry } from '../../shared/types/docs.js'
import { builtins } from './api-builtins.js'
import type { BuiltinEntry } from './api-builtins.js'
import { apiGroups, groupHref, referenceHref } from './api-groups.js'
import type { ApiGroup } from './api-groups.js'
import { catalog } from './catalog.js'
import { trustHtml } from '@meekojs/meeko'
import type { TrustedHtml } from '@meekojs/meeko'
import { blockLanguage, createTokenizer } from './highlight.js'
import type { HighlightedToken } from './highlight.js'
import { codeBlockHtml, documentHeadings, escapeHtml, renderFragment, renderInline, rewriteHref } from './markdown.js'
import { githubUrl, packageFolder, readRepositoryFile, repositoryRoot, repositoryUrl, sitePath } from './repository.js'

/*
 * The API reference, generated from the sources of `@meekojs/meeko`. For each export of each
 * public subpath (`package.json#exports`, see api-groups.ts) the TypeScript checker gives its kind,
 * signatures, members and JSDoc, the same documentation the editor shows; public-api-docs.test.ts
 * requires a description and an `@example` on every one. A new export gets its page on the next
 * build. The syntax of `.meeko` that is no export comes from api-builtins.ts, completed with the
 * documentation that the language server already carries.
 */

type Ts = typeof TS

/** A documented member, before rendering. */
interface MemberModel {
	readonly name: string
	readonly kind: string
	readonly lines: string[]
	readonly lang: string
	readonly description: string
	readonly since: string | null
	readonly deprecated: string | null
	readonly flags: string[]
}

/** A parameter before rendering: its type is code text. */
interface ParameterModel {
	readonly name: string
	readonly type: string
	readonly optional: boolean
	readonly description: string
}

/** Everything a page shows, as Markdown and code text, before rendering. */
interface SymbolModel {
	readonly name: string
	readonly slug: string
	readonly kind: ApiKind
	readonly group: ApiGroup
	importLine: string | null
	description: string
	since: string | null
	deprecated: string | null
	autoImport: string | null
	signatureTitle: string
	signatures: Array<{ code: string; lang: string; description: string | null }>
	typeParameters: ParameterModel[]
	parameters: ParameterModel[]
	returns: { type: string; description: string } | null
	throws: Array<{ type: string; description: string }>
	examples: string[]
	membersTitle: string
	members: MemberModel[]
	see: string[]
	/** Names that its signatures and members reference. */
	references: Set<string>
	related: string[]
	source: { path: string; line: number | null } | null
	editPath: string
}

/** A page that a name resolves to. */
interface Target {
	readonly name: string
	readonly slug: string
	readonly kind: ApiKind
	readonly group: ApiGroup
}

interface ApiModel {
	readonly symbols: readonly SymbolModel[]
	readonly bySlug: ReadonlyMap<string, SymbolModel>
	readonly resolve: (name: string, group?: ApiGroup) => Target | undefined
	/** Inline code of the guides and the page it names. */
	readonly codeLinks: ReadonlyMap<string, string>
}

/** Labels of each kind: on a page, as a heading of the index and on its filter. */
const kindLabels: Readonly<Record<ApiKind, readonly [singular: string, heading: string, filter: string]>> = {
	block: ['bloque', 'Bloques del componente', 'Bloques'],
	macro: ['macro', 'Macros del compilador', 'Macros'],
	tag: ['etiqueta', 'Etiquetas propias', 'Etiquetas'],
	directive: ['directiva', 'Directivas de la plantilla', 'Directivas'],
	function: ['función', 'Funciones', 'Funciones'],
	class: ['clase', 'Clases', 'Clases'],
	const: ['constante', 'Constantes', 'Constantes'],
	enum: ['enum', 'Enums', 'Enums'],
	interface: ['interfaz', 'Interfaces', 'Interfaces'],
	type: ['tipo', 'Tipos', 'Tipos'],
}

const kindOrder = Object.keys(kindLabels) as ApiKind[]

/** URL of the page of a slug. */
export function apiHref(slug: string): string {
	return `${referenceHref}/${slug}`
}

/** Path of `file` from the repository root, with forward slashes. */
function repositoryRelative(file: string): string {
	return relative(repositoryRoot(), file).replaceAll('\\', '/')
}

// ---------------------------------------------------------------------------------------------
// Code text

/** `text` without comments, keeping its layout; lines left empty by a comment are dropped. */
function stripComments(ts: Ts, text: string): string {
	const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
	// Open braces inside each `${…}` of a template literal type, to scan where it ends.
	const templates: number[] = []
	let output = ''
	for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
		if (token === ts.SyntaxKind.TemplateHead) templates.push(0)
		else if (token === ts.SyntaxKind.OpenBraceToken && templates.length) templates[templates.length - 1]!++
		else if (token === ts.SyntaxKind.CloseBraceToken && templates.length) {
			if (templates[templates.length - 1] === 0) {
				if (scanner.reScanTemplateToken(false) === ts.SyntaxKind.TemplateTail) templates.pop()
			} else templates[templates.length - 1]!--
		}
		if (token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia) continue
		output += scanner.getTokenText()
	}
	return output
		.split('\n')
		.map((line) => line.replace(/\s+$/, ''))
		.filter((line) => line !== '')
		.join('\n')
}

/** Removes the common indentation of every line but the first, as a declaration printed alone. */
function dedent(text: string): string {
	const lines = text.split('\n')
	const rest = lines.slice(1).filter((line) => line.trim())
	const indent = Math.min(...rest.map((line) => /^\s*/.exec(line)![0].length))
	if (!rest.length || !Number.isFinite(indent) || indent === 0) return text
	return [lines[0], ...lines.slice(1).map((line) => line.slice(indent))].join('\n')
}

/** Identifiers in PascalCase of a code text, the candidates for links to type pages. */
function typeWords(code: string): string[] {
	return [...code.matchAll(/(?<![\w$.])([A-Z][\w$]*)/g)].map((match) => match[1]!)
}

// ---------------------------------------------------------------------------------------------
// JSDoc

/** The documentation of a symbol or signature, in Markdown. */
interface DocModel {
	description: string
	since: string | null
	deprecated: string | null
	examples: string[]
	see: string[]
	params: Map<string, string>
	paramOrder: string[]
	typeParams: Map<string, string>
	returns: string | null
	throws: string[]
	defaultValue: string | null
	internal: boolean
}

/** Link of `{@link name}`: the page, and the member anchor after a dot. */
type LinkResolver = (name: string) => string | undefined

/** Markdown of JSDoc display parts, with `{@link}` as links to the reference where there is a page. */
function partsToMarkdown(parts: readonly TS.SymbolDisplayPart[] | undefined, resolveLink: LinkResolver): string {
	if (!parts) return ''
	let output = ''
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index]!
		if (part.kind === 'link' && part.text.startsWith('{@link')) {
			let name = ''
			let label = ''
			index++
			while (index < parts.length && parts[index]!.kind !== 'link') {
				if (parts[index]!.kind === 'linkName') name += parts[index]!.text
				else label += parts[index]!.text
				index++
			}
			name = name.trim()
			label = label.trim()
			if (!name && /^https?:\/\//.test(label)) {
				output += `<${label}>`
				continue
			}
			const href = name ? resolveLink(name) : undefined
			const text = label || name
			output += href ? (label ? `[${label}](${href})` : `[\`${name}\`](${href})`) : label ? text : `\`${name}\``
			continue
		}
		output += part.text
	}
	return output.trim()
}

/** Example text as Markdown: fenced as TypeScript unless it already has fences. */
function exampleMarkdown(text: string): string {
	const clean = text.trim()
	return clean.includes('```') ? clean : `\`\`\`ts\n${clean}\n\`\`\``
}

function docOf(parts: readonly TS.SymbolDisplayPart[], tags: readonly TS.JSDocTagInfo[], resolveLink: LinkResolver): DocModel {
	const doc: DocModel = {
		description: partsToMarkdown(parts, resolveLink),
		since: null,
		deprecated: null,
		examples: [],
		see: [],
		params: new Map(),
		paramOrder: [],
		typeParams: new Map(),
		returns: null,
		throws: [],
		defaultValue: null,
		internal: false,
	}
	for (const tag of tags) {
		const text = partsToMarkdown(tag.text, resolveLink)
		switch (tag.name) {
			case 'param': {
				const name = tag.text?.find((part) => part.kind === 'parameterName')?.text
				const description = partsToMarkdown(
					tag.text?.filter((part) => part.kind !== 'parameterName'),
					resolveLink,
				)
				if (name && !doc.params.has(name)) {
					doc.params.set(name, description)
					doc.paramOrder.push(name)
				}
				break
			}
			case 'typeParam':
			case 'template': {
				const match = /^(\S+)\s*([\s\S]*)$/.exec(text)
				if (match && !doc.typeParams.has(match[1]!)) doc.typeParams.set(match[1]!, match[2]!.replace(/^-\s*/, ''))
				break
			}
			case 'returns':
			case 'return':
				doc.returns ??= text
				break
			case 'throws':
			case 'exception':
				doc.throws.push(text)
				break
			case 'since':
				doc.since ??= text
				break
			case 'deprecated':
				doc.deprecated ??= text
				break
			case 'example':
				doc.examples.push(exampleMarkdown(text))
				break
			case 'see':
				doc.see.push(text)
				break
			case 'default':
			case 'defaultValue':
				doc.defaultValue ??= text
				break
			case 'internal':
				doc.internal = true
				break
		}
	}
	return doc
}

/** `{TypeError} Si …` → its type and the rest. */
function splitThrows(text: string): { type: string; description: string } {
	const match = /^\{([^}]+)\}\s*([\s\S]*)$/.exec(text)
	return match ? { type: match[1]!, description: match[2]! } : { type: '', description: text }
}

// ---------------------------------------------------------------------------------------------
// Exports

const formatFlags = (ts: Ts): TS.TypeFormatFlags => ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope

function kindOf(ts: Ts, symbol: TS.Symbol): ApiKind {
	const flags = symbol.flags
	if (flags & ts.SymbolFlags.Class) return 'class'
	if (flags & ts.SymbolFlags.Function) return 'function'
	if (flags & ts.SymbolFlags.Enum) return 'enum'
	if (flags & ts.SymbolFlags.Variable) return 'const'
	if (flags & ts.SymbolFlags.Interface) return 'interface'
	if (flags & ts.SymbolFlags.TypeAlias) return 'type'
	return 'const'
}

/** The type names that a declaration references, without descending into bodies or initializers. */
function referencedNames(ts: Ts, root: TS.Node): Set<string> {
	const names = new Set<string>()
	const leftmost = (name: TS.EntityName): string => (ts.isIdentifier(name) ? name.text : leftmost(name.left))
	const visit = (node: TS.Node): void => {
		if (ts.isTypeReferenceNode(node)) names.add(leftmost(node.typeName))
		else if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression)) names.add(node.expression.text)
		else if (ts.isTypeQueryNode(node)) names.add(leftmost(node.exprName))
		else if (ts.isImportTypeNode(node) && node.qualifier) names.add(ts.isIdentifier(node.qualifier) ? node.qualifier.text : node.qualifier.right.text)
		if (ts.isFunctionLike(node) || ts.isPropertyDeclaration(node) || ts.isVariableDeclaration(node)) {
			// Only the declared shape: type parameters, parameters and types.
			const declaration = node as TS.SignatureDeclaration & { readonly type?: TS.TypeNode }
			declaration.typeParameters?.forEach(visit)
			declaration.parameters?.forEach((parameter) => {
				if (parameter.type) visit(parameter.type)
			})
			if (declaration.type) visit(declaration.type)
			return
		}
		ts.forEachChild(node, visit)
	}
	visit(root)
	return names
}

/** `private`, `protected`, `#name` or `[symbol]` members, which consumers cannot name. */
function isHiddenMember(ts: Ts, member: TS.ClassElement | TS.TypeElement): boolean {
	if (member.name && (ts.isPrivateIdentifier(member.name) || ts.isComputedPropertyName(member.name))) return true
	return Boolean(ts.getCombinedModifierFlags(member as TS.Declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected))
}

/** The extractor of one TypeScript program over the public entries of the package. */
class ExportReader {
	readonly checker: TS.TypeChecker

	constructor(
		readonly ts: Ts,
		readonly program: TS.Program,
		readonly resolveLink: (group: ApiGroup) => LinkResolver,
	) {
		this.checker = program.getTypeChecker()
	}

	typeText(node: TS.TypeNode | undefined, fallback: () => TS.Type, at: TS.Node): string {
		if (node) return dedent(stripComments(this.ts, node.getText()))
		return this.checker.typeToString(fallback(), at, formatFlags(this.ts))
	}

	parameterText(parameter: TS.ParameterDeclaration): string {
		const optional = parameter.questionToken || (parameter.initializer && !parameter.dotDotDotToken) ? '?' : ''
		const type = this.typeText(parameter.type, () => this.checker.getTypeAtLocation(parameter), parameter)
		return `${parameter.dotDotDotToken ? '...' : ''}${parameter.name.getText()}${optional}: ${type}`
	}

	parameters(declaration: TS.SignatureDeclaration, doc: DocModel): ParameterModel[] {
		return declaration.parameters
			.filter((parameter) => parameter.name.getText() !== 'this')
			.map((parameter, index) => {
				const name = parameter.name.getText()
				// A destructured parameter is documented by its position.
				const destructured = this.ts.isObjectBindingPattern(parameter.name) || this.ts.isArrayBindingPattern(parameter.name)
				const description = doc.params.get(name) ?? (destructured ? doc.params.get(doc.paramOrder[index] ?? '') : undefined) ?? ''
				return {
					name: `${parameter.dotDotDotToken ? '...' : ''}${name}`,
					type: this.typeText(parameter.type, () => this.checker.getTypeAtLocation(parameter), parameter),
					optional: Boolean(parameter.questionToken || parameter.initializer),
					description,
				}
			})
	}

	typeParameters(declarations: ReadonlyArray<readonly TS.TypeParameterDeclaration[] | undefined>, doc: DocModel): ParameterModel[] {
		const seen = new Map<string, ParameterModel>()
		for (const list of declarations) {
			for (const parameter of list ?? []) {
				const name = parameter.name.text
				if (seen.has(name)) continue
				const constraint = parameter.constraint ? `extends ${stripComments(this.ts, parameter.constraint.getText())}` : ''
				const fallback = parameter.default ? `= ${stripComments(this.ts, parameter.default.getText())}` : ''
				seen.set(name, { name, type: [constraint, fallback].filter(Boolean).join(' '), optional: Boolean(parameter.default), description: doc.typeParams.get(name) ?? '' })
			}
		}
		return [...seen.values()]
	}

	signatureDoc(signature: TS.Signature, group: ApiGroup): DocModel {
		return docOf(signature.getDocumentationComment(this.checker), signature.getJsDocTags(), this.resolveLink(group))
	}

	symbolDoc(symbol: TS.Symbol, group: ApiGroup): DocModel {
		return docOf(symbol.getDocumentationComment(this.checker), symbol.getJsDocTags(this.checker), this.resolveLink(group))
	}

	/** Members of a class, an interface or an object type literal; overloads share one entry. */
	members(owner: TS.ClassDeclaration | TS.InterfaceDeclaration | TS.TypeLiteralNode, group: ApiGroup): MemberModel[] {
		const ts = this.ts
		const byName = new Map<string, MemberModel>()
		const order: MemberModel[] = []
		const elements = owner.members as TS.NodeArray<TS.ClassElement | TS.TypeElement>
		const nameOf = (member: TS.ClassElement | TS.TypeElement): string => (ts.isConstructorDeclaration(member) ? 'constructor' : (member.name?.getText() ?? ''))
		// With overloads, the implementation (the declaration with a body) is not part of the API.
		const isImplementation = (member: TS.ClassElement | TS.TypeElement): boolean => (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) && member.body !== undefined && elements.some((other) => other !== member && (ts.isMethodDeclaration(other) || ts.isConstructorDeclaration(other)) && other.body === undefined && nameOf(other) === nameOf(member))
		const noDoc = (): DocModel => docOf([], [], this.resolveLink(group))
		for (const member of elements) {
			if (isHiddenMember(ts, member) || isImplementation(member)) continue
			const modifiers = ts.getCombinedModifierFlags(member as TS.Declaration)
			const isStatic = Boolean(modifiers & ts.ModifierFlags.Static)
			const readonly = Boolean(modifiers & ts.ModifierFlags.Readonly)
			const optional = 'questionToken' in member && member.questionToken ? '?' : ''
			const prefix = `${isStatic ? 'static ' : ''}${modifiers & ts.ModifierFlags.Abstract ? 'abstract ' : ''}`
			const parameters = (declaration: TS.SignatureDeclaration): string => declaration.parameters.map((parameter) => this.parameterText(parameter)).join(', ')
			const symbolDoc = (name: TS.PropertyName): DocModel => {
				const symbol = this.checker.getSymbolAtLocation(name)
				return symbol ? this.symbolDoc(symbol, group) : noDoc()
			}
			let name: string
			let kind: string
			let line: string
			let doc: DocModel
			if (ts.isConstructorDeclaration(member)) {
				name = 'constructor'
				kind = 'constructor'
				line = `constructor(${parameters(member)})`
				doc = this.signatureDoc(this.checker.getSignatureFromDeclaration(member)!, group)
			} else if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
				name = member.name.getText()
				kind = 'método'
				const typeParameters = member.typeParameters?.length ? `<${member.typeParameters.map((parameter) => stripComments(ts, parameter.getText())).join(', ')}>` : ''
				const signature = this.checker.getSignatureFromDeclaration(member)!
				const returns = this.typeText(member.type, () => signature.getReturnType(), member)
				line = `${prefix}${name}${optional}${typeParameters}(${parameters(member)}): ${returns}`
				doc = this.signatureDoc(signature, group)
				if (!doc.description) doc = symbolDoc(member.name)
			} else if (ts.isPropertyDeclaration(member) || ts.isPropertySignature(member)) {
				name = member.name.getText().replace(/^["']|["']$/g, '')
				kind = 'propiedad'
				const type = this.typeText(member.type, () => this.checker.getTypeAtLocation(member), member)
				line = `${prefix}${readonly ? 'readonly ' : ''}${member.name.getText()}${optional}: ${type}`
				doc = symbolDoc(member.name)
			} else if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
				name = member.name.getText()
				kind = 'accesor'
				line = ts.isGetAccessorDeclaration(member) ? `${prefix}get ${name}(): ${this.typeText(member.type, () => this.checker.getTypeAtLocation(member), member)}` : `${prefix}set ${name}(${parameters(member)})`
				doc = symbolDoc(member.name)
			} else if (ts.isCallSignatureDeclaration(member) || ts.isConstructSignatureDeclaration(member)) {
				name = ts.isCallSignatureDeclaration(member) ? '(llamada)' : '(new)'
				kind = ts.isCallSignatureDeclaration(member) ? 'firma de llamada' : 'firma de construcción'
				line = stripComments(ts, member.getText()).replace(/;$/, '')
				doc = this.signatureDoc(this.checker.getSignatureFromDeclaration(member)!, group)
			} else if (ts.isIndexSignatureDeclaration(member)) {
				name = '[índice]'
				kind = 'firma de índice'
				line = stripComments(ts, member.getText()).replace(/;$/, '')
				doc = noDoc()
			} else continue
			if (doc.internal) continue
			const existing = byName.get(name)
			if (existing) {
				existing.lines.push(line)
				continue
			}
			const description = [doc.description, doc.defaultValue ? `Por defecto: \`${doc.defaultValue.replace(/^`|`$/g, '')}\`.` : ''].filter(Boolean).join('\n\n')
			const flags = [isStatic ? 'estático' : '', readonly ? 'sólo lectura' : '', optional ? 'opcional' : ''].filter(Boolean)
			const model: MemberModel = { name, kind, lines: [line], lang: 'typescript', description, since: doc.since, deprecated: doc.deprecated, flags }
			byName.set(name, model)
			order.push(model)
		}
		return order
	}

	/** The page model of an export. */
	read(target: Target, exported: TS.Symbol): SymbolModel {
		const ts = this.ts
		const checker = this.checker
		const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
		const group = target.group
		const declarations = symbol.declarations ?? []
		const doc = this.symbolDoc(symbol, group)
		const model = emptyModel(target)
		const main = declarations[0]
		if (main) {
			const file = main.getSourceFile()
			model.source = { path: repositoryRelative(file.fileName), line: file.getLineAndCharacterOfPosition(main.getStart(file)).line + 1 }
			model.editPath = model.source.path
		}
		const valueImport = target.kind === 'function' || target.kind === 'class' || target.kind === 'const' || target.kind === 'enum'
		const local = exported.name === 'default' && main && ts.isVariableDeclaration(main) && ts.isIdentifier(main.name) ? main.name.text : 'meeko'
		if (exported.name === 'default') {
			model.importLine = `import ${local} from "${group.specifier}";`
		} else model.importLine = `import ${valueImport ? '' : 'type '}{ ${exported.name} } from "${group.specifier}";`
		model.description = doc.description
		model.since = doc.since
		model.deprecated = doc.deprecated
		model.examples = doc.examples
		model.see = doc.see
		const references = new Set<string>()
		const addReferences = (node: TS.Node): void => {
			for (const name of referencedNames(ts, node)) references.add(name)
		}

		if (target.kind === 'function' || (target.kind === 'const' && main && checker.getTypeOfSymbolAtLocation(symbol, main).getCallSignatures().length > 0 && !(checker.getTypeOfSymbolAtLocation(symbol, main).getProperties().length > 0))) {
			const type = checker.getTypeOfSymbolAtLocation(symbol, main!)
			const signatures = type.getCallSignatures()
			const docs = signatures.map((signature) => this.signatureDoc(signature, group))
			const first = docs[0]
			if (first && target.kind === 'function') {
				model.description = first.description || doc.description
				model.since = first.since ?? doc.since
				model.deprecated = first.deprecated ?? doc.deprecated
				model.examples = docs.flatMap((entry) => entry.examples)
				model.see = [...new Set(docs.flatMap((entry) => entry.see))]
			}
			const overloads = signatures.length > 1
			model.signatureTitle = 'Firma'
			model.signatures = signatures.map((signature, index) => {
				const printed = checker.signatureToString(signature, main, formatFlags(ts))
				const code = target.kind === 'function' ? `function ${exported.name}${printed}` : `const ${exported.name}: ${checker.typeToString(type, main, formatFlags(ts))}`
				for (const word of typeWords(code)) references.add(word)
				// The first overload's description is the page's; the others show their own.
				const own = docs[index]!.description
				return { code, lang: 'typescript', description: overloads && own && own !== model.description ? own : null }
			})
			if (target.kind === 'const') model.signatures = model.signatures.slice(0, 1)
			const parameters = new Map<string, ParameterModel>()
			const typeParameters: Array<readonly TS.TypeParameterDeclaration[] | undefined> = []
			signatures.forEach((signature, index) => {
				const declaration = signature.getDeclaration() as TS.SignatureDeclaration | undefined
				if (!declaration) return
				addReferences(declaration)
				typeParameters.push(declaration.typeParameters)
				for (const parameter of this.parameters(declaration, docs[index]!)) if (!parameters.has(parameter.name)) parameters.set(parameter.name, parameter)
			})
			if (target.kind === 'const' && main && ts.isVariableDeclaration(main) && main.type) addReferences(main.type)
			model.parameters = [...parameters.values()]
			model.typeParameters = this.typeParameters(typeParameters, first ?? doc)
			const signature = signatures[0]
			if (signature) {
				const declaration = signature.getDeclaration() as TS.SignatureDeclaration | undefined
				const returnType = declaration?.type ? stripComments(ts, declaration.type.getText()) : checker.typeToString(signature.getReturnType(), main, formatFlags(ts))
				const description = first?.returns ?? ''
				if (returnType !== 'void' || description) model.returns = { type: returnType, description }
			}
			model.throws = (first ?? doc).throws.map(splitThrows)
		} else if (target.kind === 'class') {
			const declaration = declarations.find((node): node is TS.ClassDeclaration => ts.isClassDeclaration(node))!
			// What consumers see: type parameters, heritage and public members, not private fields.
			declaration.typeParameters?.forEach(addReferences)
			declaration.heritageClauses?.forEach(addReferences)
			for (const member of declaration.members) if (!isHiddenMember(ts, member)) addReferences(member)
			model.signatureTitle = 'Declaración'
			model.members = this.members(declaration, group)
			model.membersTitle = 'Miembros'
			const typeParameters = declaration.typeParameters?.length ? `<${declaration.typeParameters.map((parameter) => stripComments(ts, parameter.getText())).join(', ')}>` : ''
			const heritage = declaration.heritageClauses?.map((clause) => stripComments(ts, clause.getText())).join(' ') ?? ''
			const lines = model.members.flatMap((member) => member.lines.map((line) => `  ${line.replaceAll('\n', '\n  ')};`))
			const code = `class ${exported.name}${typeParameters}${heritage ? ` ${heritage}` : ''} {\n${lines.join('\n')}\n}`
			for (const word of typeWords(code)) references.add(word)
			model.signatures = [{ code, lang: 'typescript', description: null }]
			model.typeParameters = this.typeParameters([declaration.typeParameters], doc)
			const constructor = declaration.members.find((member): member is TS.ConstructorDeclaration => ts.isConstructorDeclaration(member) && !isHiddenMember(ts, member))
			if (constructor) {
				const signatureDoc = this.signatureDoc(checker.getSignatureFromDeclaration(constructor)!, group)
				model.parameters = this.parameters(constructor, signatureDoc)
				model.throws = [...doc.throws, ...signatureDoc.throws].map(splitThrows)
			} else model.throws = doc.throws.map(splitThrows)
		} else if (target.kind === 'interface' || target.kind === 'type' || target.kind === 'enum') {
			const typeDeclarations = declarations.filter((node): node is TS.InterfaceDeclaration | TS.TypeAliasDeclaration | TS.EnumDeclaration => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node))
			model.signatureTitle = 'Declaración'
			model.signatures = typeDeclarations.map((declaration) => {
				addReferences(declaration)
				const code = dedent(stripComments(ts, declaration.getText()).replace(/^(?:export\s+)?(?:default\s+)?(?:declare\s+)?/, ''))
				for (const word of typeWords(code)) references.add(word)
				return { code, lang: 'typescript', description: null }
			})
			model.typeParameters = this.typeParameters(
				typeDeclarations.map((declaration) => (ts.isEnumDeclaration(declaration) ? undefined : declaration.typeParameters)),
				doc,
			)
			model.membersTitle = 'Propiedades'
			for (const declaration of typeDeclarations) {
				if (ts.isInterfaceDeclaration(declaration)) model.members.push(...this.members(declaration, group))
				else if (ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)) model.members.push(...this.members(declaration.type, group))
			}
			if (model.members.some((member) => member.kind !== 'propiedad')) model.membersTitle = 'Miembros'
		} else {
			// A value that is not callable: its declared type.
			model.signatureTitle = 'Declaración'
			const type = main ? checker.getTypeOfSymbolAtLocation(symbol, main) : undefined
			const annotation = main && ts.isVariableDeclaration(main) ? main.type : undefined
			const typeText = annotation ? stripComments(ts, annotation.getText()) : type && main ? checker.typeToString(type, main, formatFlags(ts)) : 'unknown'
			const code =
				exported.name === 'default'
					? `declare const ${local}: ${typeText}
export default ${local}`
					: `const ${exported.name}: ${typeText}`
			if (annotation) addReferences(annotation)
			for (const word of typeWords(code)) references.add(word)
			model.signatures = [{ code, lang: 'typescript', description: null }]
		}
		for (const member of model.members) for (const line of member.lines) for (const word of typeWords(line)) references.add(word)
		references.delete(exported.name)
		for (const parameter of model.typeParameters) references.delete(parameter.name)
		model.references = references
		return model
	}
}

function emptyModel(target: Target): SymbolModel {
	return {
		name: target.name,
		slug: target.slug,
		kind: target.kind,
		group: target.group,
		importLine: null,
		description: '',
		since: null,
		deprecated: null,
		autoImport: null,
		signatureTitle: 'Firma',
		signatures: [],
		typeParameters: [],
		parameters: [],
		returns: null,
		throws: [],
		examples: [],
		membersTitle: 'Miembros',
		members: [],
		see: [],
		references: new Set(),
		related: [],
		source: null,
		editPath: '',
	}
}

// ---------------------------------------------------------------------------------------------
// Documentation that the language server and the compiler already carry

/** String value of an expression of string literals and of the constants in `values`. */
function stringValue(ts: Ts, node: TS.Expression, values: ReadonlyMap<string, string>, file: string): string {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
	if (ts.isIdentifier(node) && values.has(node.text)) return values.get(node.text)!
	if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => stringValue(ts, span.expression, values, file) + span.literal.text).join('')
	throw new Error(`${file}: the API reference cannot read ${node.getText()} as text; update apps/site/server/content/api.ts`)
}

/** Top-level `const` declarations of a source file by name. */
function constants(ts: Ts, file: TS.SourceFile): Map<string, TS.Expression> {
	const found = new Map<string, TS.Expression>()
	for (const statement of file.statements) {
		if (!ts.isVariableStatement(statement)) continue
		for (const declaration of statement.declarationList.declarations) {
			if (ts.isIdentifier(declaration.name) && declaration.initializer) found.set(declaration.name.text, declaration.initializer)
		}
	}
	return found
}

/** `expression as const` and `(expression)` without the wrappers. */
function unwrap(ts: Ts, node: TS.Expression): TS.Expression {
	while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression
	return node
}

/** JSDoc written as lines: description, `@since`, `@example` and `@see`. */
function parseDocLines(text: string): { description: string; since: string | null; examples: string[]; see: string[] } {
	const result = { description: '', since: null as string | null, examples: [] as string[], see: [] as string[] }
	const blocks: Array<{ tag: string; lines: string[] }> = [{ tag: '', lines: [] }]
	for (const line of text.split('\n')) {
		const tag = /^@(\w+)\s*(.*)$/.exec(line)
		if (tag) blocks.push({ tag: tag[1]!, lines: tag[2] ? [tag[2]] : [] })
		else blocks[blocks.length - 1]!.lines.push(line)
	}
	for (const block of blocks) {
		const body = block.lines.join('\n').trim()
		if (block.tag === '') result.description = body
		else if (block.tag === 'since') result.since = body
		else if (block.tag === 'example') result.examples.push(exampleMarkdown(body))
		else if (block.tag === 'see') result.see.push(body)
	}
	return result
}

interface SourceDocs {
	/** JSDoc of each compiler macro, as the editor shows it. */
	readonly macros: ReadonlyMap<string, ReturnType<typeof parseDocLines>>
	/** Documentation of the `html` directive. */
	readonly html: ReturnType<typeof parseDocLines>
	/** One-line detail of each directive, attribute and built-in tag that the editor completes. */
	readonly details: ReadonlyMap<string, string>
	/** Exports available without an import, by `specifier#name`. */
	readonly autoImports: ReadonlyMap<string, string>
}

function readSourceDocs(ts: Ts): SourceDocs {
	const parse = (path: string): TS.SourceFile => ts.createSourceFile(path, readRepositoryFile(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

	const modelPath = `${packageFolder}/src/language-server/model.ts`
	const model = parse(modelPath)
	const modelConstants = constants(ts, model)
	const values = new Map<string, string>()
	const apiDocs = modelConstants.get('apiDocs')
	if (apiDocs) values.set('apiDocs', stringValue(ts, apiDocs, values, modelPath))
	const macros = new Map<string, ReturnType<typeof parseDocLines>>()
	const macroObject = modelConstants.get('macroDocs')
	const macroLiteral = macroObject && unwrap(ts, macroObject)
	if (!macroLiteral || !ts.isObjectLiteralExpression(macroLiteral)) throw new Error(`${modelPath}: macroDocs not found; update apps/site/server/content/api.ts`)
	for (const property of macroLiteral.properties) {
		if (!ts.isPropertyAssignment(property) || !ts.isCallExpression(property.initializer)) continue
		const lines = property.initializer.arguments.map((argument) => stringValue(ts, argument, values, modelPath))
		macros.set(property.name.getText(), parseDocLines(lines.join('\n')))
	}
	const htmlDocs = modelConstants.get('htmlDirectiveDocs')
	const htmlCall = htmlDocs && unwrap(ts, htmlDocs)
	const htmlArray = htmlCall && ts.isCallExpression(htmlCall) && ts.isPropertyAccessExpression(htmlCall.expression) ? unwrap(ts, htmlCall.expression.expression) : undefined
	if (!htmlArray || !ts.isArrayLiteralExpression(htmlArray)) throw new Error(`${modelPath}: htmlDirectiveDocs not found; update apps/site/server/content/api.ts`)
	const html = parseDocLines(htmlArray.elements.map((element) => stringValue(ts, element, values, modelPath)).join('\n'))

	// `{ name: "if:when", detail: "…" }` of the completions of the template.
	const details = new Map<string, string>()
	const featuresPath = `${packageFolder}/src/language-server/features.ts`
	const visitDetails = (node: TS.Node): void => {
		if (ts.isObjectLiteralExpression(node)) {
			const text = (key: string): string | undefined => {
				const property = node.properties.find((candidate): candidate is TS.PropertyAssignment => ts.isPropertyAssignment(candidate) && candidate.name.getText() === key)
				return property && ts.isStringLiteral(property.initializer) ? property.initializer.text : undefined
			}
			const name = text('name')
			const detail = text('detail')
			if (name && detail && !details.has(name)) details.set(name, detail)
		}
		ts.forEachChild(node, visitDetails)
	}
	visitDetails(parse(featuresPath))

	// The builtins of autoimports.ts: `[...names].map((name) => ({ …, specifier, scope }))` and literal entries.
	const autoImports = new Map<string, string>()
	const autoImportsPath = `${packageFolder}/src/autoimports.ts`
	const property = (object: TS.ObjectLiteralExpression, key: string): TS.Expression | undefined => object.properties.find((candidate): candidate is TS.PropertyAssignment => ts.isPropertyAssignment(candidate) && candidate.name.getText() === key)?.initializer
	const literal = (node: TS.Expression | undefined): string | undefined => (node && ts.isStringLiteral(node) ? node.text : undefined)
	const visitImports = (node: TS.Node): void => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map' && ts.isArrayLiteralExpression(node.expression.expression)) {
			const callback = node.arguments[0]
			const body = callback && ts.isArrowFunction(callback) && !ts.isBlock(callback.body) ? unwrap(ts, callback.body) : undefined
			if (body && ts.isObjectLiteralExpression(body)) {
				const specifier = literal(property(body, 'specifier'))
				const scope = literal(property(body, 'scope'))
				if (specifier && scope) for (const element of node.expression.expression.elements) if (ts.isStringLiteral(element)) autoImports.set(`${specifier}#${element.text}`, scope)
			}
		} else if (ts.isObjectLiteralExpression(node)) {
			const name = literal(property(node, 'name'))
			const specifier = literal(property(node, 'specifier'))
			const scope = literal(property(node, 'scope'))
			// `useSocket` without generated clients is `useSocketClient` under another name: skipped.
			if (name && specifier && scope && literal(property(node, 'imported')) === name) autoImports.set(`${specifier}#${name}`, scope)
		}
		ts.forEachChild(node, visitImports)
	}
	visitImports(parse(autoImportsPath))
	if (!autoImports.size) throw new Error(`${autoImportsPath}: no builtin autoimports found; update apps/site/server/content/api.ts`)
	const serverScriptPath = `${packageFolder}/src/compiler/server-script.ts`
	const requestApis = constants(ts, parse(serverScriptPath)).get('pageRequestApis')
	const requestList = requestApis && unwrap(ts, requestApis)
	if (requestList && ts.isArrayLiteralExpression(requestList)) {
		for (const element of requestList.elements) if (ts.isStringLiteral(element)) autoImports.set(`@meekojs/meeko/framework#${element.text}`, 'page')
	}
	return { macros, html, details, autoImports }
}

const autoImportLabels: Readonly<Record<string, string>> = {
	shared: 'Se autoimporta en las aplicaciones del framework.',
	app: 'Se autoimporta en los componentes y en `app/`.',
	client: 'Se autoimporta en el código del navegador.',
	server: 'Se autoimporta en el código de servidor: `server/` y `<script server>`.',
	page: 'Se usa sin import en el nivel superior de `<script server>`.',
}

// ---------------------------------------------------------------------------------------------
// The model

/** First sentence of Markdown, outside inline code. */
function firstSentence(markdown: string): string {
	const text = markdown
		.split(/\n\s*\n/)[0]!
		.replace(/\s+/g, ' ')
		.trim()
	let code = false
	for (let index = 0; index < text.length; index++) {
		const character = text[index]
		if (character === '`') code = !code
		else if (!code && (character === '.' || character === ':') && (index === text.length - 1 || text[index + 1] === ' ')) {
			if (character === ':' && index < 40) continue
			return text.slice(0, index + 1)
		}
	}
	return text
}

/** Markdown without links, keeping their text. */
function withoutLinks(markdown: string): string {
	return markdown.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<(https?:[^>]+)>/g, '$1')
}

/** Plain text of inline Markdown. */
function plainText(markdown: string): string {
	return withoutLinks(markdown)
		.replace(/`([^`]*)`/g, '$1')
		.replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
}

/** Exports whose name the guides write without parentheses link only if it is distinctive. */
function codeLinkKeys(target: Target): string[] {
	const name = target.name
	if (target.kind === 'macro' || /[A-Z]/.test(name)) return [name]
	return []
}

let modelPromise: Promise<ApiModel> | undefined

function buildModel(): Promise<ApiModel> {
	modelPromise ??= (async () => {
		const ts = (await import('@typescript/typescript6')).default
		const groups = apiGroups()
		const root = repositoryRoot()
		const config = `${root}/${packageFolder}/tsconfig.json`
		const parsed = ts.getParsedCommandLineOfConfigFile(
			config,
			{},
			{
				...ts.sys,
				onUnRecoverableConfigFileDiagnostic(diagnostic) {
					throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
				},
			},
		)
		if (!parsed) throw new Error(`${config} could not be read`)
		const entries = groups.flatMap((group) => (group.entry ? [`${root}/${group.entry}`] : []))
		const program = ts.createProgram(entries, { ...parsed.options, noEmit: true })
		const checker = program.getTypeChecker()

		// Pass 1: every name and its page, so that links resolve while reading the documentation.
		const targets: Target[] = []
		const slugs = new Set<string>()
		const claim = (name: string, base: string, kind: ApiKind, group: ApiGroup): Target => {
			let slug = base
			// The same name in another subpath takes the subpath (`meekoconfig-build`); a name that
			// differs only in case takes its kind (`signal` and `signal-type`).
			const owner = targets.find((target) => target.slug === base)
			if (owner) slug = owner.name === name ? `${base}-${group.id}` : `${base}-${kind === 'interface' ? 'type' : kind}`
			if (slugs.has(slug)) throw new Error(`API reference: two pages want the slug ${slug}`)
			slugs.add(slug)
			const target = { name, slug, kind, group }
			targets.push(target)
			return target
		}
		const syntax = groups[0]!
		const builtinTargets = builtins.map((entry) => ({ entry, target: claim(entry.name, entry.slug, entry.kind, syntax) }))
		const exportTargets: Array<{ target: Target; exported: TS.Symbol }> = []
		for (const group of groups) {
			if (!group.entry) continue
			const file = program.getSourceFile(`${root}/${group.entry}`)
			const moduleSymbol = file && checker.getSymbolAtLocation(file)
			if (!moduleSymbol) throw new Error(`API reference: ${group.entry} is not a module`)
			for (const exported of checker.getExportsOfModule(moduleSymbol)) {
				const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
				const kind = kindOf(ts, symbol)
				const base = exported.name === 'default' ? `${group.id}-default` : exported.name.toLowerCase()
				exportTargets.push({ target: claim(exported.name, base, kind, group), exported })
			}
		}
		const byName = new Map<string, Target[]>()
		for (const target of targets) byName.set(target.name, [...(byName.get(target.name) ?? []), target])
		const resolve = (name: string, group?: ApiGroup): Target | undefined => {
			const candidates = byName.get(name)
			return candidates?.find((candidate) => candidate.group === group) ?? candidates?.[0]
		}
		const resolveLink =
			(group: ApiGroup): LinkResolver =>
			(name) => {
				const [owner, ...member] = name.split('.')
				const target = resolve(owner!, group)
				if (!target) return undefined
				return `${apiHref(target.slug)}${member.length ? `#${member.join('.')}` : ''}`
			}

		// Pass 2: the documentation of each page.
		const docs = readSourceDocs(ts)
		const reader = new ExportReader(ts, program, resolveLink)
		const symbols: SymbolModel[] = []
		for (const { entry, target } of builtinTargets) symbols.push(builtinModel(entry, target, docs))
		for (const { target, exported } of exportTargets) {
			const model = reader.read(target, exported)
			const scope = docs.autoImports.get(`${target.group.specifier}#${exported.name}`)
			if (scope) model.autoImport = autoImportLabels[scope] ?? null
			symbols.push(model)
		}

		// Reading order: groups, then kinds, then names; the syntax keeps the order of api-builtins.ts.
		const groupIndex = new Map(groups.map((group, index) => [group, index]))
		const builtinIndex = new Map(builtins.map((entry, index) => [entry.slug, index]))
		symbols.sort((left, right) => groupIndex.get(left.group)! - groupIndex.get(right.group)! || kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind) || (builtinIndex.get(left.slug) ?? 0) - (builtinIndex.get(right.slug) ?? 0) || left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }) || left.name.localeCompare(right.name, 'en'))

		const codeLinks = new Map<string, string>()
		for (const { entry, target } of builtinTargets) {
			// A bare word such as `html`, `model` or `generic` means other things in the guides too.
			const keys = /^[a-z]+$/.test(entry.name) ? (entry.aliases ?? []) : [entry.name, ...(entry.aliases ?? [])]
			for (const key of keys) if (!codeLinks.has(key)) codeLinks.set(key, apiHref(target.slug))
		}
		// A deprecated export keeps its page, but the guides mean the current API by its name: the
		// `useSocket` they describe is the generated client, not the deprecated framework alias.
		const deprecated = new Set(symbols.filter((symbol) => symbol.deprecated !== null).map((symbol) => symbol.slug))
		for (const { target } of exportTargets) {
			if (deprecated.has(target.slug)) continue
			for (const key of codeLinkKeys(target)) if (!codeLinks.has(key)) codeLinks.set(key, apiHref(target.slug))
		}
		return { symbols, bySlug: new Map(symbols.map((symbol) => [symbol.slug, symbol])), resolve, codeLinks }
	})()
	modelPromise.catch(() => {
		modelPromise = undefined
	})
	return modelPromise
}

function builtinModel(entry: BuiltinEntry, target: Target, docs: SourceDocs): SymbolModel {
	const model = emptyModel(target)
	const lang = entry.signatureLang === 'ts' ? 'typescript' : blockLanguage('html', entry.signature).lang
	model.signatureTitle = entry.kind === 'macro' ? 'Firma' : 'Sintaxis'
	model.signatures = [{ code: entry.signature, lang, description: null }]
	if (entry.signatureLang === 'ts') model.references = new Set(typeWords(entry.signature))
	model.since = entry.since ?? null
	model.examples = [...(entry.examples ?? [])]
	model.see = [...entry.see]
	model.related = [...(entry.related ?? [])]
	model.description = entry.description ?? ''
	const generated = entry.kind === 'macro' ? docs.macros.get(entry.name) : entry.slug === 'html' ? docs.html : undefined
	if (entry.kind === 'macro' && !generated) throw new Error(`API reference: the editor has no JSDoc for the macro ${entry.name}; update apps/site/server/content/api-builtins.ts`)
	if (generated) {
		model.description = [generated.description, entry.description ?? ''].filter(Boolean).join('\n\n')
		model.since = generated.since ?? model.since
		model.examples = [...generated.examples, ...model.examples]
		// The editor links to GitHub and api-builtins.ts to the document: the same page once.
		const seeKey = (see: string): string => see.trim().replace(`${repositoryUrl}/blob/main/`, '')
		model.see = [...new Map([...generated.see, ...model.see].map((see) => [seeKey(see), see])).values()]
	}
	model.membersTitle = 'Atributos'
	// The editor's details are short phrases without a final period.
	const sentence = (text: string | undefined): string => (text && !/[.!?]$/.test(text) ? `${text}.` : (text ?? ''))
	model.members = (entry.attributes ?? []).map((attribute) => ({
		name: attribute.name,
		kind: '',
		lines: [attribute.syntax],
		lang: 'meeko-template',
		description: attribute.description ?? sentence(docs.details.get(attribute.name)),
		since: null,
		deprecated: null,
		flags: [],
	}))
	// A directive without attributes shows the one-line detail of the editor in its description.
	const detail = docs.details.get(entry.name) ?? docs.details.get(entry.name.replace(/(?<=:).*$/, ''))
	if (detail && !model.members.length && entry.kind === 'directive') model.description = `${sentence(detail)}\n\n${model.description}`
	const file = readRepositoryFile(entry.source.file)
	const at = file.indexOf(entry.source.match)
	model.source = { path: entry.source.file, line: at < 0 ? null : file.slice(0, at).split('\n').length }
	model.editPath = entry.kind === 'macro' ? `${packageFolder}/src/language-server/model.ts` : 'apps/site/server/content/api-builtins.ts'
	return model
}

// ---------------------------------------------------------------------------------------------
// Rendering

let tokenizer: Promise<(code: string, lang: string) => HighlightedToken[][]> | undefined

/**
 * Highlighted `<pre>` of code, with the names in `links` as links to their pages. Trusted HTML: the
 * code comes from the package, and every token and link is escaped.
 */
async function highlightCode(code: string, lang: string, links: ReadonlyMap<string, string>, context?: 'interface' | 'class'): Promise<TrustedHtml> {
	tokenizer ??= createTokenizer()
	const tokenize = await tokenizer
	const wrapped = context === 'interface' ? `interface __ {\n${code}\n}` : context === 'class' ? `declare class __ {\n${code}\n}` : code
	let lines = tokenize(wrapped, lang)
	if (context) lines = lines.slice(1, -1)
	const html = lines
		.map((line) => {
			// A grammar may join a name with its neighbors in one token (`}): Signal`), so names are
			// linked inside the text of each token.
			const tokens = line.map((token) => `<span style="${escapeHtml(token.style)}">${linkTypes(escapeHtml(token.content), links)}</span>`)
			return `<span class="line">${tokens.join('')}</span>`
		})
		.join('\n')
	return trustHtml(`<pre class="shiki shiki-themes github-light-default github-dark-default" tabindex="0"><code>${html}</code></pre>`)
}

/** Escaped code with links on the PascalCase names of `links`. */
function linkTypes(html: string, links: ReadonlyMap<string, string>): string {
	if (!links.size) return html
	return html.replace(/(?<![\w$.&#])([A-Z][\w$]*)/g, (name) => {
		const href = links.get(name)
		return href ? `<a class="api-type-link" href="${escapeHtml(href)}">${name}</a>` : name
	})
}

/** Inline code of a type, with links on the names of `links`; empty without a type. */
function inlineType(text: string, links: ReadonlyMap<string, string>): TrustedHtml {
	return trustHtml(text ? `<code>${linkTypes(escapeHtml(text), links)}</code>` : '')
}

/** Label of a "see also" link to a document, from its heading; its text is escaped. */
async function seeEntry(see: string, source: string): Promise<TrustedHtml> {
	const url = see.trim()
	const documentLink = /^(?:https:\/\/github\.com\/meekojs\/meeko\/blob\/main\/)?([\w./-]+\.md)(?:#(.+))?$/.exec(url)
	if (documentLink) {
		const path = documentLink[1]!
		const anchor = documentLink[2] ? decodeURIComponent(documentLink[2]) : undefined
		const href = rewriteHref(`${repositoryUrl}/blob/main/${path}${anchor ? `#${anchor}` : ''}`, source)
		const page = catalog.find((entry) => entry.source === sitePath(path))
		let heading: string | undefined
		try {
			heading = anchor ? (await documentHeadings(path)).get(anchor) : undefined
		} catch {
			heading = undefined
		}
		if (anchor && !heading) console.warn(`[api] ${source}: ${path}#${anchor} is not a heading of the document`)
		const title = page?.label ?? sitePath(path)
		return trustHtml(`<a href="${escapeHtml(href)}">${escapeHtml(heading ?? title)}</a>${heading ? ` <span class="api-see-source">${escapeHtml(title)}</span>` : ''}`)
	}
	if (/^https?:\/\/\S+$/.test(url)) return trustHtml(`<a href="${escapeHtml(url)}" rel="noopener">${escapeHtml(url.replace(/^https?:\/\//, ''))}</a>`)
	return trustHtml((await renderFragment(url, source)).replace(/^<p>|<\/p>\n?$/g, ''))
}

/** Id of a member heading. */
function memberId(name: string): string {
	return name.replace(/[^\w$-]+/g, '-').replace(/^-|-$/g, '') || 'miembro'
}

async function renderPage(model: SymbolModel, api: ApiModel): Promise<ApiPage> {
	const source = model.source?.path ?? model.editPath
	const fragment = (text: string): Promise<TrustedHtml> => (text ? renderFragment(text, source) : Promise.resolve(trustHtml('')))
	const target = (name: string): Target | undefined => {
		const resolved = api.resolve(name, model.group)
		return resolved && resolved.slug !== model.slug ? resolved : undefined
	}
	const links = new Map<string, string>()
	for (const name of model.references) {
		const resolved = target(name)
		if (resolved && /^[A-Z]/.test(name)) links.set(name, apiHref(resolved.slug))
	}
	const related: ApiLink[] = []
	for (const name of [...model.related, ...[...model.references].sort((left, right) => left.localeCompare(right, 'en'))]) {
		const resolved = target(name)
		if (resolved && !related.some((link) => link.href === apiHref(resolved.slug))) related.push({ name: resolved.name, href: apiHref(resolved.slug), kind: resolved.kind })
	}
	const parameter = async (entry: ParameterModel): Promise<ApiParameter> => ({
		name: entry.name,
		type: inlineType(entry.type, links),
		optional: entry.optional,
		description: await fragment(entry.description),
	})
	const memberContext = model.kind === 'class' ? 'class' : 'interface'
	// Unique ids: `model` and `model:` would both be `model`, and no member may take a section's id.
	const taken = new Set(['firma', 'parametros-de-tipo', 'parametros', 'devuelve', 'lanza', 'ejemplos', 'miembros', 'vease-tambien'])
	const memberIds = model.members.map((member) => {
		const base = memberId(member.name)
		let id = base
		for (let suffix = 2; taken.has(id); suffix++) id = `${base}-${suffix}`
		taken.add(id)
		return id
	})
	const toc: TocEntry[] = []
	const plurals: Readonly<Record<string, string>> = { Firma: 'Firmas', Declaración: 'Declaraciones' }
	const signatureTitle = model.signatures.length > 1 ? (plurals[model.signatureTitle] ?? model.signatureTitle) : model.signatureTitle
	if (model.signatures.length) toc.push({ id: 'firma', text: signatureTitle, level: 2 })
	if (model.typeParameters.length) toc.push({ id: 'parametros-de-tipo', text: 'Parámetros de tipo', level: 2 })
	if (model.parameters.length) toc.push({ id: 'parametros', text: 'Parámetros', level: 2 })
	if (model.returns) toc.push({ id: 'devuelve', text: 'Devuelve', level: 2 })
	if (model.throws.length) toc.push({ id: 'lanza', text: 'Lanza', level: 2 })
	if (model.examples.length) toc.push({ id: 'ejemplos', text: model.examples.length > 1 ? 'Ejemplos' : 'Ejemplo', level: 2 })
	if (model.members.length) {
		toc.push({ id: 'miembros', text: model.membersTitle, level: 2 })
		for (const [index, member] of model.members.entries()) toc.push({ id: memberIds[index]!, text: member.name, level: 3 })
	}
	if (model.see.length || related.length) toc.push({ id: 'vease-tambien', text: 'Véase también', level: 2 })
	const group = model.group
	return {
		name: model.name,
		slug: model.slug,
		href: apiHref(model.slug),
		kind: model.kind,
		kindLabel: kindLabels[model.kind][0],
		group: { id: group.id, title: group.title, href: groupHref(group) },
		specifier: group.specifier,
		summary: plainText(firstSentence(model.description)),
		signatureTitle,
		importCode: model.importLine ? codeBlockHtml('ts', await highlightCode(model.importLine, 'typescript', new Map())) : null,
		description: await fragment(model.description),
		since: model.since,
		deprecated: model.deprecated === null ? null : await fragment(model.deprecated),
		autoImport: model.autoImport ? await renderInline(model.autoImport) : null,
		signatures: await Promise.all(
			model.signatures.map(async (signature) => ({
				code: codeBlockHtml(signature.lang === 'typescript' ? 'ts' : 'meeko', await highlightCode(signature.code, signature.lang, links)),
				description: signature.description ? await fragment(signature.description) : null,
			})),
		),
		typeParameters: await Promise.all(model.typeParameters.map(parameter)),
		parameters: await Promise.all(model.parameters.map(parameter)),
		returns: model.returns ? { type: inlineType(model.returns.type, links), description: await fragment(model.returns.description) } : null,
		throws: await Promise.all(model.throws.map(async (entry) => ({ type: inlineType(entry.type, links), description: await fragment(entry.description) }))),
		examples: await Promise.all(model.examples.map(fragment)),
		membersTitle: model.membersTitle,
		members: await Promise.all(
			model.members.map(async (member, index): Promise<ApiMember> => ({
				id: memberIds[index]!,
				name: member.name,
				kind: member.kind,
				signature: await highlightCode(member.lines.join('\n'), member.lang, links, member.lang === 'typescript' ? memberContext : undefined),
				description: await fragment(member.description),
				since: member.since,
				deprecated: member.deprecated === null ? null : await fragment(member.deprecated),
				flags: member.flags,
			})),
		),
		see: await Promise.all(model.see.map((entry) => seeEntry(entry, source))),
		related,
		sourceUrl: model.source ? `${githubUrl(model.source.path)}${model.source.line ? `#L${model.source.line}` : ''}` : null,
		sourceLabel: model.source ? `${model.source.path.replace(`${packageFolder}/`, '')}${model.source.line ? `:${model.source.line}` : ''}` : null,
		editUrl: githubUrl(model.editPath, 'edit'),
		editPath: model.editPath,
		toc,
	}
}

// ---------------------------------------------------------------------------------------------
// Public functions of the site

/** Slugs of every page of the reference, for `prerenderEntries`. */
export async function apiSlugs(): Promise<string[]> {
	return (await buildModel()).symbols.map((symbol) => symbol.slug)
}

/** The rendered page of a slug, or `undefined` if there is none. */
export async function apiPage(slug: string): Promise<ApiPage | undefined> {
	const api = await buildModel()
	const model = api.bySlug.get(slug)
	return model && renderPage(model, api)
}

/** Previous and next pages of a slug in the order of the index. */
export async function apiPager(slug: string): Promise<Pager> {
	const { symbols } = await buildModel()
	const index = symbols.findIndex((symbol) => symbol.slug === slug)
	const link = (symbol: SymbolModel | undefined): NavLink | null => (symbol ? { href: apiHref(symbol.slug), label: symbol.name } : null)
	return { previous: link(symbols[index - 1]), next: link(symbols[index + 1]) }
}

/** The index of the reference: groups, kinds and their symbols with a summary. */
export async function apiIndex(): Promise<ApiIndexGroup[]> {
	const { symbols } = await buildModel()
	const groups: ApiIndexGroup[] = []
	for (const group of apiGroups()) {
		const own = symbols.filter((symbol) => symbol.group === group)
		if (!own.length) continue
		const sections = []
		for (const kind of kindOrder) {
			const items = own.filter((symbol) => symbol.kind === kind)
			if (!items.length) continue
			sections.push({
				kind,
				title: kindLabels[kind][1],
				items: await Promise.all(
					items.map(async (symbol): Promise<ApiIndexItem> => ({
						name: symbol.name,
						href: apiHref(symbol.slug),
						kind: symbol.kind,
						summary: await renderInline(withoutLinks(firstSentence(symbol.description))),
						deprecated: symbol.deprecated !== null,
					})),
				),
			})
		}
		groups.push({ id: group.id, title: group.title, specifier: group.specifier, description: await renderInline(group.description), sections })
	}
	return groups
}

/** Labels of the kinds, singular and plural, for the filters of the index. */
export function apiKinds(): Array<{ kind: ApiKind; label: string }> {
	return kindOrder.map((kind) => ({ kind, label: kindLabels[kind][2] }))
}

/**
 * Links from the inline code of a guide to the reference: tags, directives and macros by their
 * name and aliases, exports with an uppercase letter by name, and any export written as a call,
 * such as `signal(initial)` or `href("/users/[id]")`.
 */
export async function apiCodeLinks(): Promise<(code: string) => string | undefined> {
	const api = await buildModel()
	return (code) => {
		const exact = api.codeLinks.get(code)
		if (exact) return exact
		const call = /^([A-Za-z_$][\w$]*)(?:<[^>]*>)?\(/.exec(code)
		const target = call ? api.resolve(call[1]!) : undefined
		if (!target || target.kind === 'tag' || target.kind === 'directive' || target.kind === 'block') return undefined
		return api.bySlug.get(target.slug)?.deprecated === null ? apiHref(target.slug) : undefined
	}
}
