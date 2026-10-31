import type { AtRule, Container, Rule } from 'postcss'
import type { CompletionItem, Hover, Location, Position } from 'vscode-languageserver/node'

import { basename, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import postcss from 'postcss'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CompletionItemKind, MarkupKind } from 'vscode-languageserver/node'

import type { ClassSource, ClassView } from './classes'

import { literalAt } from './classes'
import { styleRegion, tagAt } from './embedded'

/** Una declaración o un registro @property, conservando posiciones del CSS original. */
export interface CssVariableRule {
	readonly name: string
	readonly value: string
	readonly start: number
	readonly end: number
	readonly context: readonly string[]
	readonly global: boolean
	readonly registered: boolean
}

const identifier = /^--[\w\u0080-\uffff-]+$/u
const word = /[\w\u0080-\uffff-]/u

/** Lee CSS sin ejecutar plugins ni configuración; undefined conserva la última versión válida. */
export function cssVariableRules(css: string, base = 0): CssVariableRule[] | undefined {
	let root: postcss.Root
	try {
		root = postcss.parse(css)
	} catch {
		return undefined
	}
	const found: CssVariableRule[] = []
	function contextOf(node: Container | undefined): string[] {
		if (!node || node.type === 'root') return []
		const own = node.type === 'rule' ? (node as Rule).selector : node.type === 'atrule' ? `@${(node as AtRule).name} ${(node as AtRule).params}`.trim() : undefined
		return [...contextOf(node.parent as Container | undefined), ...(own ? [own] : [])]
	}
	root.walkDecls((node) => {
		if (!identifier.test(node.prop) || node.source?.start?.offset === undefined) return
		const start = base + node.source.start.offset
		const context = contextOf(node.parent)
		found.push({ name: node.prop, value: node.value + (node.important ? ' !important' : ''), start, end: start + node.prop.length, context, global: context.some((selector) => /:global\(/.test(selector)), registered: false })
	})
	root.walkAtRules('property', (node) => {
		const name = node.params.trim()
		if (!identifier.test(name) || node.source?.start?.offset === undefined) return
		const start = base + css.indexOf(name, node.source.start.offset + '@property'.length)
		const initial = node.nodes?.find((entry) => entry.type === 'decl' && entry.prop === 'initial-value')
		found.push({ name, value: initial?.type === 'decl' ? initial.value : '', start, end: start + name.length, context: [...contextOf(node.parent), `@property ${name}`], global: true, registered: true })
	})
	return found
}

const parsed = new WeakMap<ClassSource, readonly CssVariableRule[]>()
const recovered = new WeakSet<ClassSource>()

/** Recupera sólo declaraciones terminadas; no incluye nombres de comentarios ni valores a medias. */
function completedPrefix(css: string): string {
	let comment = false,
		quote: string | undefined
	let depth = 0,
		parentheses = 0,
		end = 0,
		closing = 0
	for (let index = 0; index < css.length; index++) {
		const char = css[index]
		if (comment) {
			if (char === '*' && css[index + 1] === '/') {
				comment = false
				index++
			}
			continue
		}
		if (quote) {
			if (char === '\\') index++
			else if (char === quote) quote = undefined
			continue
		}
		if (char === '/' && css[index + 1] === '*') {
			comment = true
			index++
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			continue
		}
		if (char === '(') parentheses++
		else if (char === ')') parentheses--
		if (parentheses) continue
		if (char === '{') depth++
		else if (char === '}') depth--
		if (depth < 0) break
		if (char === ';' || char === '}') {
			end = index + 1
			closing = depth
		}
	}
	return css.slice(0, end) + '}'.repeat(closing)
}

function rulesOf(source: ClassSource): readonly CssVariableRule[] {
	const cached = parsed.get(source)
	if (cached) return cached
	const component = source.origin === 'own' || source.origin === 'component'
	const region = component ? styleRegion(source.text) : undefined
	const css = region ? source.text.slice(region.contentStart, region.contentEnd) : source.text
	let declarations = cssVariableRules(css, region?.contentStart ?? 0)
	if (!declarations && component) {
		declarations = cssVariableRules(completedPrefix(css), region?.contentStart ?? 0)
		if (declarations?.length) recovered.add(source)
	}
	let rules = declarations ?? []
	if (source.origin === 'component' && /\bscoped\b/.test(region?.attributes ?? '')) rules = rules.filter((rule) => rule.global)
	parsed.set(source, rules)
	return rules
}

interface VariableToken {
	readonly start: number
	readonly end: number
}

/** Nombre dentro de var(…), o una propiedad --nombre, en CSS o estilos inline literales. */
export function cssVariableTokenAt(source: string, offset: number): VariableToken | undefined {
	const region = styleRegion(source)
	let start: number, end: number
	if (region && offset >= region.contentStart && offset <= region.contentEnd) {
		start = region.contentStart
		end = region.contentEnd
	} else {
		const tag = tagAt(source, offset)
		const attribute = tag?.value
		if (!tag || !attribute || !['style', 'bind:style'].includes(attribute.attribute)) return undefined
		const quote = source[attribute.start - 1]
		if (quote !== '"' && quote !== "'") return undefined
		start = attribute.start
		end = source.indexOf(quote, offset)
		if (end < 0 || end > tag.tagEnd) end = tag.tagEnd
		if (attribute.attribute === 'bind:style') {
			const literal = literalAt(source.slice(start, end), offset - start)
			if (!literal) return undefined
			end = start + literal.end
			start += literal.start
		}
	}
	const css = source.slice(start, end)
	const at = offset - start
	const stack: { variable: boolean; first: boolean; start: number }[] = []
	let comment = false,
		quote: string | undefined
	for (let index = 0; index < at; index++) {
		const char = css[index]
		if (comment) {
			if (char === '*' && css[index + 1] === '/') {
				comment = false
				index++
			}
			continue
		}
		if (quote) {
			if (char === '\\') index++
			else if (char === quote) quote = undefined
			continue
		}
		if (char === '/' && css[index + 1] === '*') {
			comment = true
			index++
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			continue
		}
		if (char === '(') {
			let end = index
			while (end > 0 && /\s/.test(css[end - 1]!)) end--
			let begin = end
			while (begin > 0 && word.test(css[begin - 1]!)) begin--
			stack.push({ variable: css.slice(begin, end).toLowerCase() === 'var', first: true, start: index + 1 })
		} else if (char === ')') stack.pop()
		else if (char === ',' && stack.at(-1)) stack.at(-1)!.first = false
	}
	if (comment || quote) return undefined
	let from = at,
		to = at
	while (from > 0 && word.test(css[from - 1]!)) from--
	while (to < css.length && word.test(css[to]!)) to++
	const prefix = css.slice(from, at)
	const frame = stack.at(-1)
	const variable = frame?.variable && frame.first && !css.slice(frame.start, from).trim()
	const before = css.slice(0, from).trimEnd()
	const declaration = css.slice(from, to).startsWith('--') && (!before || /[;{]$/.test(before) || /@property\s*$/.test(before))
	if (!(variable && (!prefix || prefix === '-' || prefix.startsWith('--'))) && !declaration) return undefined
	return { start: start + from, end: start + to }
}

interface VariableDefinition {
	readonly source: ClassSource
	readonly rule: CssVariableRule
}
function definitions(view: ClassView): Map<string, VariableDefinition[]> {
	const found = new Map<string, VariableDefinition[]>()
	for (const source of view.sources)
		for (const rule of rulesOf(source)) {
			const entries = found.get(rule.name) ?? []
			entries.push({ source, rule })
			found.set(rule.name, entries)
		}
	return found
}

function origin(source: ClassSource, root?: string): string {
	if (source.origin === 'own') return 'este componente'
	const name = root && source.filename ? relative(root, source.filename).replaceAll('\\', '/') : source.filename ? basename(source.filename) : 'CSS'
	return `${name}${source.origin === 'snapshot' ? ' (procesado)' : ''}`
}

function markdown(view: ClassView, name: string) {
	const entries = definitions(view).get(name)
	if (!entries?.length) return undefined
	const snippets = entries.slice(0, 8).map(({ source, rule }) => {
		const contexts = rule.context
		const declaration = rule.registered ? `initial-value: ${rule.value || '(sin valor inicial)'};` : `${rule.name}: ${rule.value};`
		const css = [...contexts.map((line, index) => `${'  '.repeat(index)}${line} {`), `${'  '.repeat(contexts.length)}${declaration}`, ...contexts.map((_, index) => `${'  '.repeat(contexts.length - index - 1)}}`)].join('\n')
		return `**${origin(source, view.root)}**${source.stale ? (recovered.has(source) ? ' · declaraciones recuperadas de CSS incompleto' : ' · última versión CSS válida') : ''}\n\n\`\`\`css\n${css}\n\`\`\``
	})
	return { kind: MarkupKind.Markdown, value: [`**${name}** · variable CSS`, ...snippets, ...(entries.length > 8 ? [`${entries.length - 8} definiciones más.`] : [])].join('\n\n') }
}

export function isCssVariableCompletionData(data: unknown): data is { meekoCssVariable: string } {
	return typeof data === 'object' && data !== null && typeof (data as { meekoCssVariable?: unknown }).meekoCssVariable === 'string'
}

/** Completado diferido: las reglas completas sólo se leen al seleccionar una sugerencia. */
export function cssVariableCompletion(document: TextDocument, position: Position, view: () => ClassView): CompletionItem[] | undefined {
	const token = cssVariableTokenAt(document.getText(), document.offsetAt(position))
	if (!token) return undefined
	return [...definitions(view())].map(([name, entries]) => ({
		label: name,
		kind: CompletionItemKind.Variable,
		detail: `${entries[0]!.rule.value || '@property'} · ${origin(entries[0]!.source)}`,
		textEdit: { range: { start: document.positionAt(token.start), end: document.positionAt(token.end) }, newText: name },
		data: { meekoCssVariable: document.uri },
	}))
}

export function resolveCssVariableCompletion(item: CompletionItem, view: ClassView): CompletionItem {
	const documentation = markdown(view, item.label)
	return documentation ? { ...item, documentation } : item
}

export function cssVariableHover(document: TextDocument, position: Position, view: () => ClassView): Hover | undefined {
	const token = cssVariableTokenAt(document.getText(), document.offsetAt(position))
	if (!token || token.start === token.end) return undefined
	const contents = markdown(view(), document.getText().slice(token.start, token.end))
	return contents && { contents, range: { start: document.positionAt(token.start), end: document.positionAt(token.end) } }
}

const documents = new WeakMap<ClassSource, TextDocument>()
export function cssVariableDefinition(document: TextDocument, position: Position, view: () => ClassView): Location[] | undefined {
	const token = cssVariableTokenAt(document.getText(), document.offsetAt(position))
	if (!token || token.start === token.end) return undefined
	const entries = definitions(view()).get(document.getText().slice(token.start, token.end)) ?? []
	const authored = entries.filter(({ source }) => !source.stale && source.origin !== 'snapshot')
	const targets = authored.length ? authored : entries.filter(({ source }) => !source.stale)
	const locations = targets.flatMap(({ source, rule }) => {
		let target = source.origin === 'own' ? document : documents.get(source)
		if (!target && source.filename) {
			target = TextDocument.create(pathToFileURL(source.filename).href, 'css', 0, source.text)
			documents.set(source, target)
		}
		return target ? [{ uri: target.uri, range: { start: target.positionAt(rule.start), end: target.positionAt(rule.end) } }] : []
	})
	return locations.length ? locations : undefined
}
