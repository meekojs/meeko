import type { SfcSection, TemplateAttribute, TemplateNode } from '@meekojs/meeko/parse'
import type { TSESTree } from '@typescript-eslint/utils'

import { attributeValueStart, decodeTemplateText, isCustomElementTag, parseSfc, parseTemplate, scanInterpolations } from '@meekojs/meeko/parse'
import { parseForESLint } from '@typescript-eslint/parser'

export interface Part {
	start: number
	end: number
	from: number
	to: number
	source: boolean
}

/** Source-preserving snippets interleaved with scope-only scaffolding. Nothing is executed. */
export class Source {
	code = ''
	readonly parts: Part[] = []
	readonly template: TemplateNode
	readonly scripts: readonly SfcSection[]
	serverRange?: [number, number]
	/** Value exports of the server block: the compiler reads them, no JavaScript in the file does. */
	readonly serverExports: string[] = []
	constructor(
		readonly text: string,
		readonly filename: string,
	) {
		const document = parseSfc(text, filename)
		this.scripts = [document.script, ...(document.server ? [document.server] : [])].filter((section) => !section.implicit)
		this.template = parseTemplate(text, document.template, filename)
		// Server data is available to the component, but its imports and locals have their own scope.
		if (document.server) this.server(document.server)
		this.generic(document.script)
		this.copy(document.script.contentStart, document.script.contentEnd)
		this.synthetic('\n{\n', document.template.start)
		this.node(this.template)
		this.synthetic('\n}\n', document.template.end)
	}
	synthetic(text: string, anchor = 0): void {
		const start = this.code.length
		this.code += text
		this.parts.push({ start, end: this.code.length, from: anchor, to: anchor, source: false })
	}
	copy(from: number, to: number, decode = false): void {
		if (to <= from) return
		const raw = this.text.slice(from, to)
		if (decode) {
			let cursor = 0
			for (const match of raw.matchAll(/&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]+);/g)) {
				this.copy(from + cursor, from + match.index)
				const decoded = decodeTemplateText(match[0])
				const start = this.code.length
				this.code += decoded
				this.parts.push({ start, end: this.code.length, from: from + match.index, to: from + match.index + match[0].length, source: true })
				cursor = match.index + match[0].length
			}
			this.copy(from + cursor, to)
			return
		}
		const start = this.code.length
		this.code += raw
		this.parts.push({ start, end: this.code.length, from, to, source: true })
	}
	attribute(attribute: TemplateAttribute): void {
		const start = attributeValueStart(this.text, attribute)
		if (start === undefined) return
		const quote = this.text[start - 1]
		const end = quote === '"' || quote === "'" ? attribute.end - 1 : attribute.end
		this.copy(start, end, true)
	}
	expression(attribute: TemplateAttribute): void {
		this.synthetic('\nvoid (', attribute.start)
		this.attribute(attribute)
		this.synthetic(');\n', attribute.end)
	}
	private generic(script: SfcSection): void {
		const generic = script.attributes.find((attribute) => attribute.name === 'generic')?.value
		if (!generic) return
		const parsed = parseForESLint(`function __generic<${generic}>(){}`, { range: true })
		const fn = parsed.ast.body[0]
		if (fn?.type !== 'FunctionDeclaration') return
		for (const parameter of fn.typeParameters?.params ?? []) {
			this.synthetic(`type ${parameter.name.name} = unknown;\n`, script.start)
		}
		// Constraints and defaults may themselves read imported types.
		this.synthetic(`function __meeko_generic<${generic}>(){}`, script.start)
	}
	private server(server: SfcSection): void {
		let parsed: ReturnType<typeof parseForESLint>
		try {
			parsed = parseForESLint(server.content, { range: true, sourceType: 'module' })
		} catch (error) {
			if (typeof error === 'object' && error !== null && 'index' in error && typeof error.index === 'number') {
				// The outer parser maps generated syntax errors; this one already refers to source text.
				const offset = server.contentStart + error.index
				const before = this.text.slice(0, offset).split(/\r\n|\r|\n/)
				throw relocate(error, offset, before.length, (before.at(-1)?.length ?? 0) + 1)
			}
			throw error
		}
		const exported: { name: string; type: boolean }[] = []
		const start = this.code.length
		this.synthetic('async function __meeko_server(){\n', server.start)
		let cursor = 0
		for (const statement of parsed.ast.body) {
			this.copy(server.contentStart + cursor, server.contentStart + statement.range[0])
			if (statement.type === 'ExportNamedDeclaration') {
				const declaration = statement.declaration
				if (declaration) {
					this.copy(server.contentStart + declaration.range[0], server.contentStart + declaration.range[1])
					if (declaration.type === 'VariableDeclaration') {
						for (const entry of declaration.declarations) for (const name of bindingNames(entry.id)) exported.push({ name, type: false })
					} else if ('id' in declaration && declaration.id?.type === 'Identifier') {
						exported.push({ name: declaration.id.name, type: declaration.type === 'TSTypeAliasDeclaration' || declaration.type === 'TSInterfaceDeclaration' })
					}
				} else if (!statement.source) {
					for (const specifier of statement.specifiers) exported.push({ name: specifier.local.name, type: statement.exportKind === 'type' || specifier.exportKind === 'type' })
				} else throw new SyntaxError('Server re-exports are not supported by the Meeko ESLint parser')
			} else if (statement.type === 'ExportDefaultDeclaration' || statement.type === 'ExportAllDeclaration') {
				throw new SyntaxError('Server default exports and re-exports are not supported by the Meeko ESLint parser')
			} else this.copy(server.contentStart + statement.range[0], server.contentStart + statement.range[1])
			this.synthetic('\n', server.end)
			cursor = statement.range[1]
		}
		this.copy(server.contentStart + cursor, server.contentEnd)
		for (const [index, entry] of exported.entries()) this.synthetic(entry.type ? `type __meeko_export_${index} = ${entry.name};\n` : `void ${entry.name};\n`, server.end)
		this.synthetic('}\n', server.end)
		this.serverRange = [start, this.code.length]
		for (const entry of exported) if (!entry.type) this.serverExports.push(entry.name)
		for (const entry of exported) if (!entry.type && entry.name !== 'route') this.synthetic(`declare const ${entry.name}: unknown;\n`, server.end)
	}
	private node(node: TemplateNode): void {
		const attributes = node.attrs ?? []
		const find = (name: string): TemplateAttribute | undefined => attributes.find((attribute) => attribute.name === name)
		const each = find('each:of')
		const snippet = node.tagName === 'snippet'
		if (snippet) {
			const condition = find('if:when')
			if (condition) this.expression(condition)
		}
		if (each) {
			this.synthetic('for (const ', node.start)
			const name = find('each:as')
			if (name) this.attribute(name)
			else this.synthetic('__meeko_item', node.start)
			this.synthetic(' of ', node.start)
			this.attribute(each)
			this.synthetic(') { const ', node.start)
			const index = find('each:index')
			if (index) this.attribute(index)
			else this.synthetic('index', node.start)
			this.synthetic(' = 0;\n', node.start)
		}
		if (snippet) {
			this.synthetic('((', node.start)
			const params = find('params')
			if (params) this.attribute(params)
			this.synthetic(') => {\n', node.start)
		}
		if (node.componentName) {
			this.synthetic('void ', node.start)
			this.copy(node.start + 1, node.start + 1 + node.componentName.length)
			this.synthetic(';\n', node.start)
		}
		for (const attribute of attributes) {
			const name = attribute.name
			const custom = node.tagName !== undefined && isCustomElementTag(node.tagName)
			if (name === 'bind' || name.startsWith('bind:') || name.startsWith('on:') || (!custom && (name === 'model' || name.startsWith('model:'))) || (name === 'if:when' && !snippet) || name === 'each:key' || (node.tagName === 'component' && name === 'is') || (node.tagName === 'render' && (name === 'snippet' || name === 'args')) || (name === 'html' && !node.componentName && !custom) || (node.componentName === 'MeekoAwait' && name === 'for')) this.expression(attribute)
		}
		if (node.nodeName === '#text') {
			const text = this.text.slice(node.start, node.end)
			for (const segment of scanInterpolations(text).segments) {
				this.synthetic('void (', node.start + segment.start)
				this.copy(node.start + segment.expressionStart, node.start + segment.expressionStart + segment.expression.length, true)
				this.synthetic(');\n', node.start + segment.end)
			}
		}
		for (const child of [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])]) this.node(child)
		if (snippet) this.synthetic('});\n', node.end)
		if (each) this.synthetic('}\n', node.end)
	}
	/** Translate either end of a generated range into the original UTF-16 offsets. */
	offset(position: number, end = false): number {
		const point = end ? position - 1 : position
		const part = this.parts[this.partIndex(point)] ?? this.parts.at(-1)
		if (!part) return 0
		if (!part.source) return part.from
		if (part.end - part.start !== part.to - part.from) return end ? part.to : part.from
		return part.from + position - part.start
	}
	original(start: number, end: number): boolean {
		const first = this.partIndex(start)
		if (!this.parts[first]?.source) return false
		for (let index = first; index < this.parts.length && this.parts[index].start < end; index++) if (!this.parts[index].source) return false
		return true
	}
	private partIndex(position: number): number {
		let low = 0
		let high = this.parts.length - 1
		while (low <= high) {
			const middle = (low + high) >>> 1
			const part = this.parts[middle]
			if (position < part.start) high = middle - 1
			else if (position >= part.end) low = middle + 1
			else return middle
		}
		return -1
	}
}

/**
 * Copy a parser error with ESLint's location fields. The TypeScript parser's errors expose `index`
 * as a read-only getter, so assigning over them throws; a fresh error accepts the fields.
 */
export function relocate(error: object, index: number, lineNumber: number, column: number): SyntaxError {
	const message = error instanceof Error ? error.message : String(error)
	return Object.assign(new SyntaxError(message), { index, lineNumber, column, cause: error })
}

function bindingNames(node: TSESTree.Node): string[] {
	if (node.type === 'Identifier') return [node.name]
	if (node.type === 'ArrayPattern') return node.elements.flatMap((element) => (element ? bindingNames(element) : []))
	if (node.type === 'ObjectPattern') return node.properties.flatMap((property) => bindingNames(property.type === 'RestElement' ? property.argument : property.value))
	if (node.type === 'AssignmentPattern') return bindingNames(node.left)
	if (node.type === 'RestElement') return bindingNames(node.argument)
	return []
}
