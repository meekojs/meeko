import type { AstPath, Doc, Options, Parser, ParserOptions, Plugin, Printer } from 'prettier'

import { builders, utils } from 'prettier/doc'

import type { ClassOrder, ClassSortMode } from './classes'

import { scanInterpolations } from '../../compiler/parser/interpolation'
import { maskComponentTags } from '../../compiler/parser/sfc'
import { isCustomElementTag } from '../../compiler/parser/template'
import { classExpressionOption } from './class-literals'
import { classOrderOption, classTokens, sortClassTokens } from './classes'

const { group, indent, label, softline } = builders
const { mapDoc } = utils

/** Parser interno de la plantilla de un `.meeko`; sólo lo usa el parser `meeko` mediante `embed`. */
export const templateParserName = 'meeko-template'
const templateAstFormat = 'meeko-template'
/** Etiqueta de los docs de expresiones TypeScript; sus llaves nunca son marcadores de interpolación. */
const expressionLabel = 'meeko-expression'
const wrapperStart = '<template>'
const wrapperEnd = '</template>'

interface SourceLocation {
	readonly offset: number
	readonly line: number
	moveBy(delta: number): SourceLocation
}

interface SourceSpan {
	readonly start: SourceLocation
	readonly end: SourceLocation
}

/** Nodo del AST HTML de Prettier (`src/language-html/parse/ast.js`), sólo lo que usa el plugin. */
interface HtmlNode {
	kind: string
	name?: string
	fullName?: string
	rawName?: string
	value?: string | null
	children?: HtmlNode[]
	attrs?: HtmlNode[]
	sourceSpan: SourceSpan
	startSourceSpan?: SourceSpan | null
	endSourceSpan?: SourceSpan | null
	valueSpan?: SourceSpan
	readonly parent?: HtmlNode
	readonly prev?: HtmlNode
	readonly next?: HtmlNode
	isLeadingSpaceSensitive?: boolean
	hasLeadingSpaces?: boolean
	isTrailingSpaceSensitive?: boolean
	hasTrailingSpaces?: boolean
	hasDanglingSpaces?: boolean
	isDanglingSpaceSensitive?: boolean
	isWhitespaceSensitive?: boolean
	/** Expresión sin espacios exteriores de una interpolación `{expr}`. */
	meekoExpression?: string
	/** Fuente de la plantilla con los comentarios asociados a su elemento. */
	meekoOriginalText?: string
	setProperty(property: string, value: unknown): void
	createChild(node: Record<string, unknown>): HtmlNode
	insertChildBefore(target: HtmlNode, node: Record<string, unknown>): void
	removeChild(child: HtmlNode): void
	walk(fn: (node: HtmlNode) => void): void
}

type HtmlPrinter = Printer<HtmlNode> & {
	embed: NonNullable<Printer<HtmlNode>['embed']>
	preprocess: NonNullable<Printer<HtmlNode>['preprocess']>
}

interface HostHtml {
	readonly parser: Parser<HtmlNode>
	readonly printer: HtmlPrinter
}

type LazyRecord<T> = Record<string, T | (() => Promise<T>)>

const hostKey = Symbol.for('meeko.prettier.html')
type HostOptions = ParserOptions<HtmlNode> & { [hostKey]?: HostHtml }

async function resolveLazy<T>(record: LazyRecord<T> | undefined, name: string): Promise<T | undefined> {
	const value = record?.[name]
	return typeof value === 'function' ? await (value as () => Promise<T>)() : value
}

/**
 * Parser `vue` y printer `html` del Prettier que ejecuta el plugin. Se toman de `options.plugins`
 * en lugar de importar `prettier/plugins/html` para no mezclar dos versiones de Prettier.
 */
async function hostHtml(options: ParserOptions<HtmlNode>): Promise<HostHtml> {
	const plugins = ((options as { plugins?: unknown[] }).plugins ?? []) as Array<{ parsers?: LazyRecord<Parser<HtmlNode>>; printers?: LazyRecord<HtmlPrinter> }>
	for (const plugin of [...plugins].reverse()) {
		if (!plugin || typeof plugin !== 'object' || !plugin.parsers?.vue || !plugin.printers?.html) continue
		const parser = await resolveLazy(plugin.parsers, 'vue')
		const printer = await resolveLazy(plugin.printers, 'html')
		if (parser && printer) return { parser, printer }
	}
	// Standalone sin el plugin HTML entre los cargados: se usa el de esta instalación.
	const html = (await import('prettier/plugins/html')) as unknown as { parsers: Record<string, Parser<HtmlNode>>; printers: Record<string, HtmlPrinter> }
	return { parser: html.parsers.vue!, printer: html.printers.html! }
}

function host(options: ParserOptions<HtmlNode> | Options): HostHtml {
	const found = (options as HostOptions)[hostKey]
	if (!found) throw new Error('The meeko-template printer runs only after the meeko-template parser')
	return found
}

const templateParser: Parser<HtmlNode> = {
	astFormat: templateAstFormat,
	// The vue parser keeps the case of `<AppButton>` and accepts `<AppButton />` only inside a root
	// `<template>`; the wrapper keeps every position consistent with `options.originalText`.
	preprocess: (text) => `${wrapperStart}${text}${wrapperEnd}`,
	async parse(text, options) {
		const html = await hostHtml(options)
		;(options as HostOptions)[hostKey] = html
		let root = await html.parser.parse(maskInterpolatedLessThan(text), options)
		const normalized = attachLeadingComments(root, text, options.htmlWhitespaceSensitivity === 'ignore')
		if (normalized) {
			root = await html.parser.parse(maskInterpolatedLessThan(normalized), options)
			root.setProperty('meekoOriginalText', normalized)
		}
		restoreInterpolatedLessThan(root)
		const template = root.children?.find((child) => child.kind === 'element' && child.name === 'template')
		if (!template) throw new Error('The template wrapper was not parsed')
		// The template's children become the root's: they are printed without the wrapper.
		root.setProperty('children', template.children ?? [])
		return root
	},
	locStart: (node) => node.sourceSpan.start.offset,
	locEnd: (node) => node.sourceSpan.end.offset,
}

/** Lo que lee el parser HTML en lugar de un `<` de una interpolación; nunca está en la fuente. */
const interpolatedLessThan = ''

/**
 * Oculta al parser HTML cada `<` de una interpolación del texto (`{a < b}`, `{"<b>"}`) con las
 * mismas posiciones que el compilador, para que no abra una etiqueta.
 */
function maskInterpolatedLessThan(text: string): string {
	if (text.includes(interpolatedLessThan)) return text
	const { interpolated } = maskComponentTags(text)
	if (!interpolated.length) return text
	const chars = text.split('')
	for (const offset of interpolated) chars[offset] = interpolatedLessThan
	return chars.join('')
}

/** Devuelve su `<` a los textos que leyó el parser HTML. */
function restoreInterpolatedLessThan(ast: HtmlNode): void {
	ast.walk((node) => {
		if (node.kind === 'text' && node.value?.includes(interpolatedLessThan)) node.setProperty('value', node.value.replaceAll(interpolatedLessThan, '<'))
	})
}

/** Convierte cada `{expr}` de los textos en un nodo `interpolation`, como `{{ }}` en Vue. */
function extractInterpolations(ast: HtmlNode): void {
	ast.walk((node) => {
		if (!node.children || node.kind === 'interpolation' || (node.kind === 'element' && (node.name === 'script' || node.name === 'style'))) return
		for (const child of [...node.children]) {
			if (child.kind !== 'text' || !child.value?.includes('{')) continue
			const text = child.value
			const scan = scanInterpolations(text)
			if (!scan.segments.length) continue
			const start = child.sourceSpan.start
			const Span = child.sourceSpan.constructor as new (start: SourceLocation, end: SourceLocation) => SourceSpan
			const span = (from: number, to: number) => new Span(start.moveBy(from), start.moveBy(to))
			let index = 0
			for (const segment of scan.segments) {
				if (segment.start > index) node.insertChildBefore(child, { kind: 'text', value: text.slice(index, segment.start), sourceSpan: span(index, segment.start) })
				node.insertChildBefore(child, {
					kind: 'interpolation',
					sourceSpan: span(segment.start, segment.end),
					children: [
						{
							kind: 'text',
							value: text.slice(segment.start + 1, segment.end - 1),
							meekoExpression: segment.expression,
							sourceSpan: span(segment.start + 1, segment.end - 1),
						},
					],
				})
				index = segment.end
			}
			if (index < text.length) node.insertChildBefore(child, { kind: 'text', value: text.slice(index), sourceSpan: span(index, text.length) })
			node.removeChild(child)
		}
	})
}

/** What the HTML printer reads for a `}}` of the source, which `meekoBraces` would take for a marker. */
const textBraces = '\uE002\uE002'

/** Sustituye los marcadores `{{`/`}}` que imprime Prettier para una interpolación por `{`/`}`. */
function meekoBraces(input: Doc): Doc {
	const visit = (item: Doc): Doc => {
		if (typeof item === 'string') return item === '{{' ? '{' : item === '}}' ? '}' : item.replaceAll(textBraces, '}}')
		if (Array.isArray(item)) return item.map(visit)
		switch (item.type) {
			case 'label':
				return item.label === expressionLabel ? item : { ...item, contents: visit(item.contents) }
			case 'group':
				return { ...item, contents: visit(item.contents), ...(item.expandedStates ? { expandedStates: item.expandedStates.map(visit) } : {}) }
			case 'fill':
				return { ...item, parts: item.parts.map(visit) }
			case 'if-break':
				return { ...item, breakContents: visit(item.breakContents), flatContents: visit(item.flatContents) }
			case 'align':
			case 'indent':
			case 'indent-if-break':
			case 'line-suffix':
				return { ...item, contents: visit((item as { contents: Doc }).contents) } as Doc
			default:
				return item
		}
	}
	return visit(input)
}

const expressionParser = '__ts_expression'

/** Atributos cuyo valor es una expresión TypeScript. */
function isExpressionAttribute(name: string, element: HtmlNode | undefined): boolean {
	const tag = element?.name
	// On a custom element (`<x-markdown html="intro">`), `html` and `model` are plain HTML attributes;
	// the reserved SVG/MathML names (`<font-face>`) are standard elements, as in the compiler.
	const custom = tag !== undefined && !/^[A-Z]/.test(tag) && isCustomElementTag(tag)
	// `bind="obj"` (since 1.5) on an element or a component; on a custom element it stays an attribute.
	if (name === 'model' || name === 'bind' || /^model:./.test(name)) return !custom
	if (/^(?:bind|on):./.test(name) || name === 'if' || name === 'else-if' || name === 'if:when' || name === 'each:of' || name === 'each:key') return true
	if (name === 'is') return tag === 'component'
	// `html="expression"` on a standard element; a component tag rejects it (MEEK032).
	if (name === 'html') return tag !== undefined && !/^[A-Z]/.test(tag) && !custom
	if (name === 'snippet' || name === 'args') return tag === 'render'
	return false
}

/** Tags whose `class` is not the element's: a component prop, or a Meeko construct. */
const notElementClass = new Set(['component', 'render', 'snippet', 'template'])

/** A static `class` of an element; on a component tag (`<Card class="x">`) it is a text prop. */
function isElementClass(node: HtmlNode, element: HtmlNode | undefined): boolean {
	const tag = element?.name
	return node.fullName?.toLowerCase() === 'class' && element?.kind === 'element' && tag !== undefined && !/^[A-Z]/.test(tag) && !notElementClass.has(tag)
}

/** Whether `meekoSortClasses` asks for an order, which is what reaches beyond a static element `class`. */
function sortsClasses(options: Options): boolean {
	const mode = (options as { meekoSortClasses?: ClassSortMode }).meekoSortClasses
	return mode !== undefined && mode !== 'off'
}

/**
 * A static `class` of a component tag or `<component is>`: a text prop, which the component usually
 * forwards to its root. It is only rewritten when an order is asked for.
 */
function isComponentClass(node: HtmlNode, element: HtmlNode | undefined): boolean {
	const tag = element?.name
	return node.fullName?.toLowerCase() === 'class' && element?.kind === 'element' && tag !== undefined && (/^[A-Z]/.test(tag) || tag === 'component')
}

/**
 * The normalized, optionally sorted, value of a static `class`; `undefined` keeps it verbatim. A
 * value with a character reference or a `"` is left alone: its tokens are not the source text.
 */
function classValue(value: string, options: Options): string | undefined {
	if (value.includes('&') || value.includes('"')) return undefined
	const mode = (options as { meekoSortClasses?: ClassSortMode }).meekoSortClasses
	const order = (options as Record<string, unknown>)[classOrderOption] as ClassOrder | undefined
	return sortClassTokens(classTokens(value), mode, order).join(' ')
}

function unescapedValue(node: HtmlNode): string {
	return (node.value ?? '').replaceAll('&quot;', '"').replaceAll('&apos;', "'")
}

type TextToDoc = (text: string, options: Options) => Promise<Doc>

/** Formatea una expresión; `undefined` si Prettier no la entiende y debe quedar como está. */
async function expressionDoc(textToDoc: TextToDoc, text: string, extra: Options): Promise<{ doc: Doc; hug: boolean } | undefined> {
	if (!text.trim()) return undefined
	let hug = false
	let list = false
	try {
		const result = await textToDoc(text, {
			parser: expressionParser,
			__embeddedInHtml: true,
			__onHtmlBindingRoot: (ast: { type?: string; node?: { type?: string } }) => {
				const type = (ast.type === 'JsExpressionRoot' ? ast.node : ast)?.type
				hug = type === 'ObjectExpression' || type === 'ArrayExpression' || type === 'TemplateLiteral' || type === 'StringLiteral'
				list = type === 'SequenceExpression'
			},
			...extra,
		})
		// `a, b` is a list of values (`args`), not a comma expression: Prettier would add parentheses.
		return list ? undefined : { doc: result, hug }
	} catch {
		return undefined
	}
}

/** `<p></p\n>{x}`: the next node prints the `}` of this interpolation itself. */
function nextBorrowsClosingMarker(node: HtmlNode | undefined): boolean {
	return Boolean(node?.prev && node.prev.kind !== 'text' && node.prev.kind !== 'comment' && node.isLeadingSpaceSensitive && !node.hasLeadingSpaces)
}

/** Text and interpolations: the whitespace at their edges is part of a text node in the compiler. */
function isTextLike(node: HtmlNode): boolean {
	return node.kind === 'text' || node.kind === 'interpolation'
}

/** What Prettier's printer joins with a soft line, which would drop the whitespace between them. */
function isTextOrComment(node: HtmlNode): boolean {
	return node.kind === 'text' || node.kind === 'comment'
}

function startsOnItsOwnLine(child: HtmlNode, parent: HtmlNode): boolean {
	return Boolean(child.hasLeadingSpaces && parent.startSourceSpan && parent.startSourceSpan.end.line < child.sourceSpan.start.line)
}

function endsOnItsOwnLine(child: HtmlNode, parent: HtmlNode): boolean {
	return Boolean(child.hasTrailingSpaces && parent.endSourceSpan && child.sourceSpan.end.line < parent.endSourceSpan.start.line)
}

function contentSpansLines(node: HtmlNode): boolean {
	return Boolean(node.startSourceSpan && node.endSourceSpan && node.startSourceSpan.end.line < node.endSourceSpan.start.line)
}

/** What the HTML printer reads for the space at the edge of a `<snippet>`; it never reaches the output. */
const snippetEdgeSpace = '\uE001'

/**
 * `<snippet name="a"> <b>x</b> </snippet>`: for the compiler that space is content, and with a line
 * break it would be formatting, so no line may break there. Each one becomes a text node, which the
 * printer keeps attached to the tags around it: what does not fit breaks inside those tags, as
 * anywhere else without whitespace (`name="a"\n> <b`).
 */
function keepSnippetEdges(node: HtmlNode): void {
	const children = node.children!
	const opened = node.startSourceSpan?.end
	const closed = node.endSourceSpan?.start
	if (!opened || !closed) return
	const Span = node.sourceSpan.constructor as new (start: SourceLocation, end: SourceLocation) => SourceSpan
	const edge = (start: SourceLocation, end: SourceLocation): HtmlNode => node.createChild({ kind: 'text', value: snippetEdgeSpace, sourceSpan: new Span(start, end), isLeadingSpaceSensitive: true, hasLeadingSpaces: false, isTrailingSpaceSensitive: true, hasTrailingSpaces: false })
	const first = children[0]
	const last = children[children.length - 1]
	if (!first || !last) {
		if (!node.hasDanglingSpaces || contentSpansLines(node)) return
		node.hasDanglingSpaces = false
		children.push(edge(opened, closed))
		return
	}
	if (!isTextLike(first) && first.hasLeadingSpaces && !startsOnItsOwnLine(first, node)) {
		first.hasLeadingSpaces = false
		first.isLeadingSpaceSensitive = true
		children.unshift(edge(opened, first.sourceSpan.start))
	}
	if (!isTextLike(last) && last.hasTrailingSpaces && !endsOnItsOwnLine(last, node)) {
		last.hasTrailingSpaces = false
		last.isTrailingSpaceSensitive = true
		children.push(edge(last.sourceSpan.end, closed))
	}
}

/** Preformatted elements, whose parser also ignores a line feed right after the start tag. */
const preformattedTags = new Set(['pre', 'listing', 'textarea'])

/** A character reference to a line feed, which the HTML parser ignores there as it does a literal one. */
const lineFeedReference = /^&(?:#0*10|#[xX]0*[aA]|NewLine);?/

/**
 * The content of a preformatted element that only stays the same as written: whitespace, which the
 * printer would reduce to one line, and a first `&#10;`, which a line break before it turns into
 * content. Prettier prints as written a preformatted element with a child that is not text, so these
 * get one, empty and never printed.
 */
function hasOnlyItsWrittenForm(node: HtmlNode): boolean {
	if (node.kind !== 'element' || !preformattedTags.has(node.name ?? '')) return false
	const first = node.children?.[0]
	return first ? first.kind === 'text' && lineFeedReference.test(first.value ?? '') : Boolean(node.hasDanglingSpaces)
}

/** A preformatted element that Prettier prints as written: it has a child that is not text. */
function isPrintedAsWritten(node: HtmlNode): boolean {
	return node.kind === 'element' && preformattedTags.has(node.name ?? '') && (node.children ?? []).some((child) => !isTextLike(child))
}

/**
 * Prettier prints an element as written as `[prefix, opening tag, content, ...closing tag, suffix]`,
 * but the tags already have the prefix and the suffix, which is what it borrows from its neighbors:
 * `<i>a</i><pre><b>x</b></pre>` would get a second `>`.
 */
function writtenElement(printed: Doc): Doc {
	if (!Array.isArray(printed) || printed.length < 4 || typeof printed[0] !== 'string' || typeof printed[printed.length - 1] !== 'string') return printed
	return printed.slice(1, -1)
}

/** A component with `<snippet>` blocks and nothing else: the compiler reads no text among them. */
function holdsOnlySnippets(node: HtmlNode): boolean {
	return /^[A-Z]/.test(node.name ?? '') && (node.children ?? []).every((child) => child.kind === 'comment' || (child.kind === 'element' && child.name === 'snippet'))
}

/**
 * The compiler renders the whitespace of a template as text nodes, so saving a file must not add or
 * remove any: `<li each:of="a" each:as="b">{b}</li>` keeps its text node without whitespace, and
 * `Hi<b> you</b>` keeps its space. `"css"` and `"strict"` follow this rule. With an explicit
 * `"ignore"`, the user delegates whitespace to the HTML printer, including at element boundaries.
 * Formatting may still turn one whitespace into another (a space into a line break and indentation),
 * which renders the same outside `white-space: pre`. The compiler itself drops whitespace in two
 * places, which stay free: among the blocks of a component with only `<snippet>` content, and between
 * an element and the edge of a `<snippet>` when that whitespace has a line break.
 */
function keepWhitespace(ast: HtmlNode, options: ParserOptions<HtmlNode>): void {
	ast.walk((node) => {
		const children = node.children
		if (children && hasOnlyItsWrittenForm(node)) children.push(node.createChild({ kind: 'comment', value: '', sourceSpan: node.sourceSpan }))
		if (!children || (node.kind !== 'element' && node.kind !== 'root') || node.isWhitespaceSensitive) return
		// `ignore` también se aplica a los snippets. Los elementos preformateados conservan
		// su contenido literal, pero las demás etiquetas pueden separarse sin partir sus marcadores.
		if (options.htmlWhitespaceSensitivity === 'ignore') return
		if (holdsOnlySnippets(node)) {
			node.isDanglingSpaceSensitive = false
			for (const child of children) child.isLeadingSpaceSensitive = child.isTrailingSpaceSensitive = false
			return
		}
		const snippet = node.name === 'snippet'
		const first = children[0]
		const last = children[children.length - 1]
		if (!first || !last) {
			if (snippet) keepSnippetEdges(node)
			node.isDanglingSpaceSensitive = Boolean(node.hasDanglingSpaces && !snippet)
			return
		}
		// The whitespace at the edges of the root belongs to the `<template>` section: the `meeko` printer keeps it.
		if (node.kind === 'element') {
			first.isLeadingSpaceSensitive = !snippet || isTextLike(first)
			last.isTrailingSpaceSensitive = !snippet || isTextLike(last)
		}
		for (let index = 1; index < children.length; index++) {
			const previous = children[index - 1]!
			const next = children[index]!
			if (next.hasLeadingSpaces && !(isTextOrComment(previous) && isTextOrComment(next))) continue
			previous.isTrailingSpaceSensitive = true
			next.isLeadingSpaceSensitive = true
		}
		if (snippet) keepSnippetEdges(node)
	})
}

/**
 * A `}}` in a text, a comment, an ignored or preformatted element or a plain attribute is content, and
 * `meekoBraces` would take a line or a word with only that for the end of an interpolation. Everything
 * the printer can read it from hides it, with the same length; `meekoBraces` restores it. An expression
 * is printed from its own text, under a label that `meekoBraces` skips.
 */
function hideTextBraces(ast: HtmlNode, options: ParserOptions<HtmlNode>): void {
	options.originalText = options.originalText.replaceAll('}}', textBraces)
	ast.walk((node) => {
		const parent = node.parent
		const written = node.kind === 'text' ? parent?.kind !== 'interpolation' && parent?.name !== 'script' && parent?.name !== 'style' : node.kind === 'attribute' && !(node.fullName && isExpressionAttribute(node.fullName, parent))
		if (written && node.value?.includes('}}')) node.value = node.value.replaceAll('}}', textBraces)
	})
}

/** Content on its own lines stays there: `<p> text </p>` would render the same, but reads worse. */
function keepsLineBreaks(node: HtmlNode): boolean {
	if (node.kind !== 'element' || node.isWhitespaceSensitive) return false
	const first = node.children?.[0]
	const last = node.children?.[node.children.length - 1]
	return Boolean(first && last && (startsOnItsOwnLine(first, node) || endsOnItsOwnLine(last, node)))
}

const visitorKeys: Record<string, readonly string[]> = {
	root: ['children'],
	element: ['attrs', 'startTagComments', 'children'],
	ieConditionalComment: ['children'],
	interpolation: ['children'],
	text: ['children'],
}

/**
 * Un comentario en su propia línea explica el siguiente elemento. Conserva la separación anterior
 * y elimina las líneas vacías posteriores. Sólo cambia el espacio entre nodos, con la misma
 * longitud para conservar los offsets; nunca toca el cuerpo de comentarios ni contenido literal.
 * En modo `ignore`, anticipa los comentarios que el printer HTML pondrá en su propia línea.
 */
function attachLeadingComments(ast: HtmlNode, text: string, ignoreWhitespace: boolean): string | undefined {
	let characters: string[] | undefined
	ast.walk((node) => {
		if (!node.children) return
		for (let parent: HtmlNode | undefined = node; parent; parent = parent.parent) {
			let previous = parent.prev
			while (previous?.kind === 'text' && !previous.value?.trim()) previous = previous.prev
			if (preformattedTags.has(parent.name ?? '') || parent.name === 'script' || parent.name === 'style' || (previous?.kind === 'comment' && previous.value?.trim() === 'prettier-ignore')) return
		}
		for (let index = 0; index < node.children.length - 1; index++) {
			const comment = node.children[index]!
			let nextIndex = index + 1
			while (node.children[nextIndex]?.kind === 'text' && !node.children[nextIndex]?.value?.trim()) nextIndex++
			const next = node.children[nextIndex]
			if (!next) continue
			if (comment.kind !== 'comment' || (next.kind !== 'element' && next.kind !== 'interpolation')) continue
			let previous = comment.prev
			while (previous?.kind === 'text' && !previous.value?.trim()) previous = previous.prev
			if (previous?.kind === 'text' && previous.value?.trim()) continue
			const start = comment.sourceSpan.start.offset
			if (!ignoreWhitespace && text.slice(text.lastIndexOf('\n', start - 1) + 1, start).trim()) continue
			const end = comment.sourceSpan.end.offset
			const gap = text.slice(end, next.sourceSpan.start.offset)
			if (!/^[\t\n\f\r ]*$/.test(gap) || (gap.match(/\n/g)?.length ?? 0) < 2) continue
			characters ??= text.split('')
			for (let offset = end; offset < end + gap.lastIndexOf('\n'); offset++) {
				if (text[offset] === '\n' || text[offset] === '\r') characters[offset] = ' '
			}
		}
	})
	return characters?.join('')
}

/**
 * Los saltos entre atributos no deben partir también `>texto</Tag>`. El contenido sin espacios
 * exteriores conserva sus bordes pegados; si empieza en otra línea, conserva ese salto. Incluso
 * si el texto ocupa varias líneas, `</Tag>` queda completo. El printer HTML entrega apertura,
 * contenido y cierre como tres partes del grupo.
 */
function compactTextElement(node: HtmlNode, printed: Doc): Doc {
	const child = node.children?.[0]
	if (node.kind !== 'element' || node.isWhitespaceSensitive || node.children?.length !== 1 || child?.kind !== 'text' || child.hasTrailingSpaces) return printed
	if (!printed || typeof printed !== 'object' || Array.isArray(printed) || printed.type !== 'group' || !Array.isArray(printed.contents) || printed.contents.length !== 3) return printed
	const [opening, content, closing] = printed.contents
	if (!Array.isArray(content)) return printed
	const line = content.at(-1)
	if (!line || typeof line !== 'object' || Array.isArray(line) || line.type !== 'line' || !line.soft) return printed
	const tail = [content.slice(0, -1), closing!]
	return { ...printed, contents: [opening!, child.hasLeadingSpaces ? tail : group(tail)] }
}

const templatePrinter: Printer<HtmlNode> = {
	getVisitorKeys: (node) => (visitorKeys[node.kind] ?? []).filter((key) => Array.isArray((node as unknown as Record<string, unknown>)[key])),
	preprocess(ast, options) {
		if (ast.meekoOriginalText) options.originalText = ast.meekoOriginalText
		extractInterpolations(ast)
		// The HTML preprocess looks for `{{ }}` unless the parser is `html`; `{expr}` is already extracted.
		const parser = options.parser
		options.parser = 'html'
		try {
			const processed = host(options).printer.preprocess(ast, options) as HtmlNode
			keepWhitespace(processed, options)
			hideTextBraces(processed, options)
			return processed
		} finally {
			options.parser = parser
		}
	},
	print(path, options, print) {
		const { node } = path
		const original = host(options).printer.print(path, options, print)
		const printed = options.htmlWhitespaceSensitivity === 'ignore' ? original : compactTextElement(node, original)
		if (node.kind === 'text' && node.value === snippetEdgeSpace) return mapDoc(printed, (item) => (typeof item === 'string' ? item.replaceAll(snippetEdgeSpace, ' ') : item))
		if (node.kind === 'root') return meekoBraces(printed)
		if (isPrintedAsWritten(node)) return writtenElement(printed)
		const breaks = keepsLineBreaks(node) && typeof printed === 'object' && !Array.isArray(printed) && printed.type === 'group'
		return breaks ? { ...printed, break: true } : printed
	},
	embed(path: AstPath<HtmlNode>, options: Options) {
		const node = path.node
		const parent = node.parent
		if (node.kind === 'text' && parent?.kind === 'interpolation') {
			return async (textToDoc: TextToDoc) => {
				const printed = await expressionDoc(textToDoc, node.meekoExpression ?? node.value ?? '', {})
				if (!printed) return undefined
				const closing = nextBorrowsClosingMarker(parent.next) ? '' : softline
				return label(expressionLabel, [indent([softline, printed.doc]), closing])
			}
		}
		if (node.kind === 'attribute' && node.value != null && node.fullName && isExpressionAttribute(node.fullName, path.parent as HtmlNode | undefined)) {
			return async (textToDoc: TextToDoc) => {
				const isClassExpression = node.fullName === 'bind:class' && sortsClasses(options)
				const printed = await expressionDoc(textToDoc, unescapedValue(node), { __isInHtmlAttribute: true, ...(isClassExpression ? { [classExpressionOption]: true } : {}) })
				if (!printed) return undefined
				const value = mapDoc(printed.hug ? group(printed.doc) : [indent([softline, printed.doc]), softline], (item) => (typeof item === 'string' ? item.replaceAll('"', '&quot;') : item))
				return [node.rawName ?? node.fullName!, '="', label(expressionLabel, group(value)), '"']
			}
		}
		const element = path.parent as HtmlNode | undefined
		if (node.kind === 'attribute' && node.value != null && (isElementClass(node, element) || (sortsClasses(options) && isComponentClass(node, element)))) {
			const value = classValue(node.value, options)
			if (value !== undefined) return [node.rawName ?? node.fullName!, '="', value, '"']
		}
		return host(options as ParserOptions<HtmlNode>).printer.embed(path, options)
	},
}

/** Parser y printer de la plantilla; el plugin principal los incluye. */
export const templatePlugin: Pick<Plugin<HtmlNode>, 'parsers' | 'printers'> = {
	parsers: { [templateParserName]: templateParser },
	printers: { [templateAstFormat]: templatePrinter },
}
