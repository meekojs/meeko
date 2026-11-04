import type { TSESTree } from '@typescript-eslint/utils'

import { parseSfc } from '@meekojs/meeko/parse'
import { ESLintUtils } from '@typescript-eslint/utils'

import type { MacroName } from '../macros'

import { macroStatement, macroNames as names } from '../macros'
import { template } from '../template'

export type { MacroName } from '../macros'

function literal(node: TSESTree.Node): boolean {
	if (node.type === 'Literal') return !('regex' in node)
	if (node.type === 'ArrayExpression') return node.elements.every((entry) => entry === null || literal(entry))
	if (node.type === 'ObjectExpression') return node.properties.every((entry) => entry.type === 'Property' && !entry.computed && !entry.method && !entry.shorthand && literal(entry.value))
	return false
}

export default ESLintUtils.RuleCreator((name) => `https://github.com/meekojs/meeko/tree/main/packages/eslint-plugin/docs/rules/${name}.md`)({
	name: 'order-macros',
	meta: {
		type: 'layout',
		docs: { description: 'Ordena las macros de Meeko y sitúa defineExpose después de la lógica del script.' },
		fixable: 'code',
		schema: [{ type: 'object', properties: { order: { type: 'array', items: { type: 'string', enum: [...names] }, uniqueItems: true, minItems: 1 } }, additionalProperties: false }],
		messages: { order: 'La macro {{name}} debe aparecer antes de {{previous}}.', expose: 'Sitúa defineExpose después de las declaraciones y la lógica del script.' },
	},
	defaultOptions: [{}] as [{ order?: MacroName[] }],
	create(context, [options]) {
		const statements: TSESTree.Node[] = []
		function collect(node: TSESTree.Node): void {
			const parentType: string | undefined = node.parent?.type
			if (parentType === 'Program' || parentType === 'MeekoScope') statements.push(node)
		}
		return {
			'VariableDeclaration, ExpressionStatement, FunctionDeclaration, ClassDeclaration, IfStatement, ForStatement, ThrowStatement, TryStatement, WhileStatement, SwitchStatement': collect,
			'Program:exit'() {
				if (!template(context)) return
				const source = context.sourceCode
				const document = parseSfc(source.text, context.filename)
				const order = [...(options.order ?? []), ...names.filter((name) => !options.order?.includes(name))]
				for (const section of [document.server, document.script]) {
					if (!section || section.implicit) continue
					const entries = statements.filter((node) => node.range[0] >= section.contentStart && node.range[1] <= section.contentEnd).sort((a, b) => a.range[0] - b.range[0])
					const macros = entries.flatMap((node) => {
						const macro = macroStatement(source, node)
						if (!macro) return []
						const { name, expression } = macro
						const safe = name !== 'defineExpose' && expression.arguments.every(literal) && (node.type !== 'VariableDeclaration' || node.declarations[0]!.id.type === 'Identifier')
						return [{ node, name, safe }]
					})
					let highest: (typeof macros)[number] | undefined
					let reported = false
					for (const macro of macros) {
						if (macro.name === 'defineExpose' && entries.some((entry) => entry.range[0] > macro.node.range[1])) {
							context.report({ node: macro.node, messageId: 'expose' })
						}
						if (highest && order.indexOf(macro.name) < order.indexOf(highest.name)) {
							// Only reorder the whole consecutive literal-only block once. Whitespace-only
							// gaps deliberately exclude comments and any unrelated script statement.
							const gaps = macros.slice(1).map((entry, index) => source.text.slice(macros[index]!.node.range[1], entry.node.range[0]))
							const commented = source.getAllComments().some((comment) => comment.range[0] >= section.contentStart && comment.range[1] <= section.contentEnd)
							const safe = !reported && !commented && macros.every((entry) => entry.safe) && gaps.every((gap) => /^\s*$/.test(gap))
							context.report({
								node: macro.node,
								messageId: 'order',
								data: { name: macro.name, previous: highest.name },
								fix: safe
									? (fixer) =>
											fixer.replaceTextRange(
												[macros[0]!.node.range[0], macros.at(-1)!.node.range[1]],
												[...macros]
													.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
													.map((entry, index) => source.getText(entry.node) + (gaps[index] ?? ''))
													.join(''),
											)
									: null,
							})
							reported = true
						} else highest = macro
					}
				}
			},
		}
	},
})
