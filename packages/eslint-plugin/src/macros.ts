import type { TSESLint, TSESTree } from '@typescript-eslint/utils'

export const macroNames = ['defineProps', 'defineEmits', 'defineModel', 'defineSnippets', 'useElementRef', 'defineExpose'] as const
export type MacroName = (typeof macroNames)[number]

/** Reconoce llamadas directas a macros sin confundir funciones o imports locales homónimos. */
export function macroStatement(source: Readonly<TSESLint.SourceCode>, node: TSESTree.Node): { name: MacroName; expression: TSESTree.CallExpression } | undefined {
	if (node.type !== 'ExpressionStatement' && node.type !== 'VariableDeclaration') return
	const expression = node.type === 'ExpressionStatement' ? node.expression : node.declarations.length === 1 ? node.declarations[0]!.init : undefined
	if (expression?.type !== 'CallExpression' || expression.callee.type !== 'Identifier' || !macroNames.includes(expression.callee.name as MacroName)) return
	const name = expression.callee.name as MacroName
	for (let scope = source.getScope(expression); scope; scope = scope.upper!) {
		if (scope.set.get(name)?.defs.length) return
	}
	return { name, expression }
}
