import type { TemplateAttribute, TemplateNode } from '@meekojs/meeko/parse'

import { ESLintUtils } from '@typescript-eslint/utils'

import { template, visit } from '../template'

const groups = ['ref', 'list', 'conditional', 'definition', 'attributes', 'model', 'bindings', 'spread', 'events', 'content'] as const

/** Grupos configurables del orden de atributos de plantilla. */
export type AttributeGroup = (typeof groups)[number]

function group(name: string, node: TemplateNode): AttributeGroup {
	if ((node.tagName === 'snippet' && ['name', 'params'].includes(name)) || (node.tagName === 'render' && ['snippet', 'args'].includes(name)) || name === 'html') return 'content'
	if (node.tagName === 'component' && name === 'is') return 'definition'
	if (name === 'if:when') return 'conditional'
	if (name.startsWith('each:')) return 'list'
	if (name.startsWith('ref:')) return 'ref'
	if (name === 'model' || name.startsWith('model:')) return 'model'
	if (name === 'bind') return 'spread'
	if (name.startsWith('bind:')) return 'bindings'
	if (name.startsWith('on:')) return 'events'
	return 'attributes'
}

// References name a target; other directives may evaluate user code, including getters.
function expression(attribute: TemplateAttribute, node: TemplateNode): boolean {
	return !attribute.name.startsWith('ref:') && (attribute.name.includes(':') || ['bind', 'model', 'html', 'is', 'args', 'snippet', 'params', 'for'].includes(attribute.name) || Boolean(node.componentName && attribute.name.startsWith('on')))
}

export default ESLintUtils.RuleCreator((name) => `https://github.com/meekojs/meeko/tree/main/packages/eslint-plugin/docs/rules/${name}.md`)({
	name: 'attributes-order',
	meta: {
		type: 'layout',
		docs: { description: 'Ordena los atributos de elementos y componentes por grupos configurables.' },
		fixable: 'code',
		schema: [{ type: 'object', properties: { order: { type: 'array', items: { type: 'string', enum: [...groups] }, uniqueItems: true, minItems: 1 }, alphabetical: { type: 'boolean' } }, additionalProperties: false }],
		messages: { order: 'El atributo {{name}} debe aparecer antes de {{previous}}.' },
	},
	defaultOptions: [{}] as [{ order?: AttributeGroup[]; alphabetical?: boolean }],
	create(context, [options]) {
		const order = [...(options.order ?? []), ...groups.filter((name) => !options.order?.includes(name))]
		return {
			'Program:exit'() {
				const body = template(context)
				if (!body) return
				const source = context.sourceCode
				visit(body, (node) => {
					const attrs = node.attrs
					if (!node.tagName || !attrs || attrs.length < 2) return
					const compare = (a: TemplateAttribute, b: TemplateAttribute): number => {
						const category = group(a.name, node)
						const difference = order.indexOf(category) - order.indexOf(group(b.name, node))
						if (difference) return difference
						const internal = category === 'list' ? ['each:of', 'each:as', 'each:index', 'each:key'] : category === 'content' ? ['name', 'params', 'snippet', 'args', 'html'] : undefined
						if (internal) return internal.indexOf(a.name) - internal.indexOf(b.name)
						const left = a.name.replace(/^bind:/, '')
						const right = b.name.replace(/^bind:/, '')
						return options.alphabetical ? Number(left > right) - Number(left < right) : 0
					}
					const sorted = [...attrs].sort(compare)
					const misplaced = attrs.findIndex((attribute, index) => index > 0 && compare(attrs[index - 1]!, attribute) > 0)
					if (misplaced < 0) return
					const first = attrs[0]!
					const last = attrs.at(-1)!
					const gaps = attrs.slice(1).map((attribute, index) => source.text.slice(attrs[index]!.end, attribute.start))
					const names = attrs.map((attribute) => attribute.name.replace(/^bind:/, ''))
					const dynamic = attrs.filter((attribute) => expression(attribute, node))
					const sortedDynamic = sorted.filter((attribute) => expression(attribute, node))
					// parse5 drops repeated spellings: inspect the unclaimed tail as well as gaps.
					const location = node.sourceCodeLocation
					const openingEnd = location ? node.start - location.startOffset + (location.startTag?.endOffset ?? location.endOffset) : last.end
					const tail = source.text.slice(last.end, openingEnd)
					// A spread combined with class/style can evaluate at their earlier position.
					const safe = new Set(names).size === names.length && gaps.every((gap) => /^\s+$/.test(gap)) && /^\s*\/?>$/.test(tail) && dynamic.every((attribute, index) => attribute === sortedDynamic[index]) && !(attrs.some((attribute) => attribute.name === 'bind') && attrs.some((attribute) => /^(?:bind:)?(?:class|style)$/.test(attribute.name)))
					const attribute = attrs[misplaced]!
					context.report({
						loc: { start: source.getLocFromIndex(attribute.start), end: source.getLocFromIndex(attribute.end) },
						messageId: 'order',
						data: { name: attribute.name, previous: attrs[misplaced - 1]!.name },
						fix: safe ? (fixer) => fixer.replaceTextRange([first.start, last.end], sorted.map((entry, index) => source.text.slice(entry.start, entry.end) + (gaps[index] ?? '')).join('')) : null,
					})
				})
			},
		}
	},
})
