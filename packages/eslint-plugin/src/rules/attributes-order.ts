import type { TemplateAttribute, TemplateNode } from '@meekojs/meeko/parse'
import type { TSESLint, TSESTree } from '@typescript-eslint/utils'

import { parseForESLint } from '@typescript-eslint/parser'
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

// Reads count as free of effects, as a signal's `.value` is; creating a function runs none of its body.
function effectFree(node: TSESTree.Node): boolean {
	switch (node.type) {
		case 'ArrowFunctionExpression':
		case 'FunctionExpression':
		case 'Identifier':
		case 'Literal':
			return true
		case 'ArrayExpression':
			return node.elements.every((element) => element === null || effectFree(element))
		case 'BinaryExpression':
		case 'LogicalExpression':
			return effectFree(node.left) && effectFree(node.right)
		case 'ChainExpression':
		case 'TSAsExpression':
		case 'TSInstantiationExpression':
		case 'TSNonNullExpression':
		case 'TSSatisfiesExpression':
		case 'TSTypeAssertion':
			return effectFree(node.expression)
		case 'ConditionalExpression':
			return effectFree(node.test) && effectFree(node.consequent) && effectFree(node.alternate)
		case 'MemberExpression':
			return effectFree(node.object) && (!node.computed || effectFree(node.property))
		case 'ObjectExpression':
			return node.properties.every((property) => (property.type === 'SpreadElement' ? effectFree(property.argument) : (!property.computed || effectFree(property.key)) && effectFree(property.value)))
		case 'SequenceExpression':
		case 'TemplateLiteral':
			return node.expressions.every(effectFree)
		case 'UnaryExpression':
			return node.operator !== 'delete' && effectFree(node.argument)
		default:
			return false
	}
}

function hasNoEffects(attribute: TemplateAttribute): boolean {
	try {
		const { body } = parseForESLint(`(${attribute.value})`, { range: true }).ast
		return body.length === 1 && body[0]?.type === 'ExpressionStatement' && effectFree(body[0].expression)
	} catch {
		return false
	}
}

// The compiler evaluates a spread with its combined class and style, at the first of them written.
function spreadOrder(attrs: TemplateAttribute[], node: TemplateNode): TemplateAttribute[] {
	const combined = attrs.filter((attribute) => /^(?:bind|(?:bind:)?(?:class|style))$/.test(attribute.name))
	const evaluated = ['bind', 'bind:class', 'bind:style'].flatMap((name) => combined.filter((attribute) => attribute.name === name))
	return attrs.flatMap((attribute) => (attribute === combined[0] ? evaluated : combined.includes(attribute) || !expression(attribute, node) ? [] : [attribute]))
}

function swappedPairs(before: TemplateAttribute[], after: TemplateAttribute[]): Array<[TemplateAttribute, TemplateAttribute]> {
	return before.flatMap((attribute, index) => before.slice(index + 1).flatMap((later): Array<[TemplateAttribute, TemplateAttribute]> => (after.indexOf(later) < after.indexOf(attribute) ? [[attribute, later]] : [])))
}

// Each `bind:` writes in its own effect, in written order: a control clamps its value to the current min, max or step.
function writesControlState(pair: [TemplateAttribute, TemplateAttribute], node: TemplateNode): boolean {
	return !node.componentName && pair.every((attribute) => attribute.name.startsWith('bind:')) && pair.some((attribute) => /^bind:(?:checked|selected|value)$/.test(attribute.name))
}

// A swap is only safe between two expressions without effects: one with effects could change what the other reads.
function riskyAttributes(attrs: TemplateAttribute[], sorted: TemplateAttribute[], node: TemplateNode): TemplateAttribute[] {
	const inWrittenOrder = (list: TemplateAttribute[]): TemplateAttribute[] => list.filter((attribute) => expression(attribute, node))
	const pairs = [...swappedPairs(inWrittenOrder(attrs), inWrittenOrder(sorted)), ...(attrs.some((attribute) => attribute.name === 'bind') ? swappedPairs(spreadOrder(attrs, node), spreadOrder(sorted, node)) : [])]
	const risky = new Set(pairs.flatMap((pair) => (writesControlState(pair, node) ? pair : pair.filter((attribute) => !hasNoEffects(attribute)))))
	return attrs.filter((attribute) => risky.has(attribute))
}

export default ESLintUtils.RuleCreator((name) => `https://github.com/meekojs/meeko/tree/main/packages/eslint-plugin/docs/rules/${name}.md`)({
	name: 'attributes-order',
	meta: {
		type: 'layout',
		docs: { description: 'Ordena los atributos de elementos y componentes por grupos configurables.' },
		fixable: 'code',
		hasSuggestions: true,
		schema: [{ type: 'object', properties: { order: { type: 'array', items: { type: 'string', enum: [...groups] }, uniqueItems: true, minItems: 1 }, alphabetical: { type: 'boolean' } }, additionalProperties: false }],
		messages: {
			order: 'El atributo {{name}} debe aparecer antes de {{previous}}.',
			reorder: 'Ordena los atributos, aunque cambie cuándo se evalúa {{names}}: revisa que el resultado no dependa de ese orden.',
		},
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
					// parse5 drops repeated spellings: inspect the unclaimed tail as well as gaps.
					const location = node.sourceCodeLocation
					const openingEnd = location ? node.start - location.startOffset + (location.startTag?.endOffset ?? location.endOffset) : last.end
					const tail = source.text.slice(last.end, openingEnd)
					// A name and its `bind:` variant, as `id` and `bind:id`, are the one case where the written order decides the value.
					const movable = new Set(names).size === names.length && gaps.every((gap) => /^\s+$/.test(gap)) && /^\s*\/?>$/.test(tail)
					const risky = movable ? riskyAttributes(attrs, sorted, node) : []
					const reorder = (fixer: TSESLint.RuleFixer): TSESLint.RuleFix => fixer.replaceTextRange([first.start, last.end], sorted.map((entry, index) => source.text.slice(entry.start, entry.end) + (gaps[index] ?? '')).join(''))
					const attribute = attrs[misplaced]!
					context.report({
						loc: { start: source.getLocFromIndex(attribute.start), end: source.getLocFromIndex(attribute.end) },
						messageId: 'order',
						data: { name: attribute.name, previous: attrs[misplaced - 1]!.name },
						fix: movable && !risky.length ? reorder : null,
						suggest: risky.length ? [{ messageId: 'reorder', data: { names: risky.map((entry) => entry.name).join(', ') }, fix: reorder }] : [],
					})
				})
			},
		}
	},
})
