import type { TemplateNode } from '@meekojs/meeko/parse'

import * as meekoParse from '@meekojs/meeko/parse'
import { ESLintUtils } from '@typescript-eslint/utils'

import { template, visit } from '../template'

/** Forma de cierre exigida para una categoría de elementos. */
export type SelfClosingMode = 'always' | 'never' | 'any'

/** Opciones de `meeko/html-self-closing`. */
export interface HtmlSelfClosingOptions {
	/** Elementos HTML: `normal` (`<div>`, `<my-element>`) y `void` (`<input>`, `<br>`). */
	html?: { normal?: SelfClosingMode; void?: SelfClosingMode }
	/** Etiquetas de componente (`<AppButton>`), `<component is>`, `<render>` y `<snippet>`. */
	component?: SelfClosingMode
	/** Elementos SVG, `<svg>` incluido. */
	svg?: SelfClosingMode
	/** Elementos MathML, `<math>` incluido. */
	math?: SelfClosingMode
	/** Trata como vacío el contenido formado sólo por saltos de línea y sangría. Por defecto, `false`. */
	ignoreWhitespace?: boolean
}

type Category = 'normal' | 'void' | 'component' | 'svg' | 'math'

const svgNamespace = 'http://www.w3.org/2000/svg'
const mathNamespace = 'http://www.w3.org/1998/Math/MathML'
// The parser's void elements: they never have content or an end tag.
const voidElements = new Set(['area', 'base', 'basefont', 'bgsound', 'br', 'col', 'embed', 'frame', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
const meekoTags = new Set(['component', 'render', 'snippet'])
// Meeko 1.7 (still in the peer range) neither exports it nor accepts `<div />`: no HTML element is then self-closable.
const isSelfClosableElement: (name: string) => boolean = (meekoParse as Partial<typeof meekoParse>).isSelfClosableElement ?? (() => false)
const mode = { type: 'string' as const, enum: ['always', 'never', 'any'] }

function category(node: TemplateNode): Category | undefined {
	const tag = node.tagName
	if (!tag) return undefined
	if (node.componentName || meekoTags.has(tag)) return 'component'
	if (node.namespaceURI === svgNamespace) return 'svg'
	if (node.namespaceURI === mathNamespace) return 'math'
	if (voidElements.has(tag)) return 'void'
	// `<template>`, `<script>`, `<style>` and unknown elements cannot close themselves.
	return isSelfClosableElement(tag) ? 'normal' : undefined
}

/** Only line breaks and their indentation: whitespace with at least one line break. */
const layoutWhitespace = /^[\t\f ]*(?:\r\n?|\n)[\t\n\f\r ]*$/

export default ESLintUtils.RuleCreator((name) => `https://github.com/meekojs/meeko/tree/main/packages/eslint-plugin/docs/rules/${name}.md`)({
	name: 'html-self-closing',
	meta: {
		type: 'layout',
		docs: { description: 'Exige o prohíbe cerrar con /> los elementos y componentes sin contenido de la plantilla.' },
		fixable: 'code',
		schema: [
			{
				type: 'object',
				properties: {
					html: { type: 'object', properties: { normal: mode, void: mode }, additionalProperties: false },
					component: mode,
					svg: mode,
					math: mode,
					ignoreWhitespace: { type: 'boolean' },
				},
				additionalProperties: false,
			},
		],
		messages: {
			always: 'Cierra <{{name}}> con /> porque no tiene contenido.',
			never: 'No cierres <{{name}}> con />; escribe {{replacement}}.',
		},
	},
	defaultOptions: [{}] as [HtmlSelfClosingOptions],
	create(context, [options]) {
		const modes: Record<Category, SelfClosingMode> = {
			normal: options.html?.normal ?? 'always',
			void: options.html?.void ?? 'always',
			component: options.component ?? 'always',
			svg: options.svg ?? 'always',
			math: options.math ?? 'always',
		}
		const empty = (node: TemplateNode): boolean => {
			const children = [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])]
			// A text node is rendered: whitespace counts unless the option says otherwise.
			return children.every((child) => options.ignoreWhitespace && child.nodeName === '#text' && layoutWhitespace.test(child.value ?? ''))
		}
		return {
			'Program:exit'() {
				const body = template(context)
				if (!body) return
				const text = context.sourceCode.text
				visit(body, (node) => {
					const kind = category(node)
					const location = node.sourceCodeLocation
					if (!kind || !location?.startTag || modes[kind] === 'any') return
					const base = node.start - location.startOffset
					const start = base + location.startTag.startOffset
					const close = base + location.startTag.endOffset - 1
					if (text[close] !== '>') return
					const name = /^<([^\s/>]+)/.exec(text.slice(start, start + 256))?.[1]
					if (!name) return
					// An unquoted value keeps its `/`: `<input value=a/>` is not self-closing.
					const lastAttribute = node.attrs?.at(-1)
					const selfClosing = text[close - 1] === '/' && (lastAttribute?.end ?? 0) < close
					const loc = { start: context.sourceCode.getLocFromIndex(start), end: context.sourceCode.getLocFromIndex(close + 1) }
					if (modes[kind] === 'always' && !selfClosing) {
						const endTag = location.endTag
						// An element without its end tag (`<li>` closed by the next one) is left alone.
						if (kind !== 'void' && (!endTag || !empty(node))) return
						const replacement = /\s/.test(text[close - 1] ?? '') ? '/>' : ' />'
						const end = kind === 'void' ? close + 1 : base + endTag!.endOffset
						context.report({ loc, messageId: 'always', data: { name }, fix: (fixer) => fixer.replaceTextRange([close, end], replacement) })
					} else if (modes[kind] === 'never' && selfClosing) {
						// `/` alone on its line keeps the layout of one attribute per line.
						let from = close - 1
						const lineStart = text.lastIndexOf('\n', from - 1)
						if (text.slice(lineStart + 1, from).trim()) while (from > start && /[\t ]/.test(text[from - 1]!)) from--
						const replacement = kind === 'void' ? '>' : `></${name}>`
						context.report({ loc, messageId: 'never', data: { name, replacement: kind === 'void' ? `<${name}>` : `<${name}></${name}>` }, fix: (fixer) => fixer.replaceTextRange([from, close + 1], replacement) })
					}
				})
			},
		}
	},
})
