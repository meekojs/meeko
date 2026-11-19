import type { TSESTree } from '@typescript-eslint/utils'

import { ESLintUtils } from '@typescript-eslint/utils'

import type { MeekoParserServices } from '../parser'

type FunctionNode = TSESTree.ArrowFunctionExpression | TSESTree.FunctionDeclaration | TSESTree.FunctionExpression
type Owner = TSESTree.Node | number

/** Convención abierta `useX`: no depende de un catálogo de API del framework. */
const isComposable = (name: string): boolean => /^use[A-Z0-9_]/.test(name)
const isFunction = (node: TSESTree.Node): node is FunctionNode => ['ArrowFunctionExpression', 'FunctionDeclaration', 'FunctionExpression'].includes(node.type)

function propertyName(node: TSESTree.Node): string | undefined {
	if (node.type === 'Identifier') return node.name
	if (node.type === 'Literal' && typeof node.value === 'string') return node.value
	return undefined
}

function functionName(node: FunctionNode): string | undefined {
	if (node.type === 'FunctionDeclaration') return node.id?.name
	let parent: TSESTree.Node | undefined = node.parent
	while (parent && ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression'].includes(parent.type)) parent = parent.parent
	if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name
	if (parent?.type === 'Property' || parent?.type === 'MethodDefinition') return propertyName(parent.key)
	if (parent?.type === 'AssignmentExpression') return parent.left.type === 'Identifier' ? parent.left.name : parent.left.type === 'MemberExpression' ? propertyName(parent.left.property) : undefined
	return undefined
}

export default ESLintUtils.RuleCreator((name) => `https://github.com/meekojs/meeko/tree/main/packages/eslint-plugin/docs/rules/${name}.md`)({
	name: 'rules-of-composables',
	meta: {
		type: 'problem',
		docs: { description: 'Exige que useX se llame en la raíz del componente o de otro composable, sin callbacks ni ejecución condicional.' },
		schema: [],
		messages: {
			context: '{{name}}() debe llamarse en la raíz de <script> de un .meeko o en el cuerpo principal de otro composable useX(), no en handlers, funciones ordinarias ni expresiones de plantilla.',
			conditional: '{{name}}() no puede llamarse dentro de condiciones, bucles, try/catch ni expresiones de cortocircuito. Decláralo en el nivel superior y usa su resultado.',
			late: '{{name}}() debe ejecutarse antes de await o return previos de su mismo contexto.',
		},
	},
	defaultOptions: [],
	create(context) {
		const source = context.sourceCode
		const services = source.parserServices as Partial<MeekoParserServices>
		const calls: Array<{ node: TSESTree.CallExpression; name: string }> = []
		const boundaries: Array<{ node: TSESTree.Node; owner: Owner | undefined }> = []
		const scopeOf = (node: TSESTree.Node): { fn: FunctionNode | undefined; owner: Owner | undefined; script: boolean } => {
			let parent = node.parent
			while (parent && !isFunction(parent)) parent = parent.parent
			const fn = parent && isFunction(parent) ? parent : undefined
			const script = services.scriptRanges?.find((range) => node.range[0] >= range.start && node.range[1] <= range.end)
			return { fn, owner: fn ?? script?.start, script: Boolean(script) }
		}
		const calleeName = (node: TSESTree.Node, seen = new Set<string>()): string | undefined => {
			if (node.type === 'ChainExpression' || node.type === 'TSNonNullExpression' || node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' || node.type === 'TSInstantiationExpression') return calleeName(node.expression, seen)
			if (node.type === 'MemberExpression') {
				if (node.computed && node.property.type !== 'Literal') return undefined
				const name = propertyName(node.property)
				return name && isComposable(name) ? name : undefined
			}
			if (node.type !== 'Identifier') return undefined
			if (isComposable(node.name)) return node.name
			if (seen.has(node.name)) return undefined
			seen.add(node.name)
			let scope: ReturnType<typeof source.getScope> | null = source.getScope(node)
			while (scope) {
				const variable = scope.set.get(node.name)
				if (variable) {
					for (const definition of variable.defs) {
						if (definition.type === 'ImportBinding' && definition.node.type === 'ImportSpecifier') {
							const name = propertyName(definition.node.imported)
							if (name && isComposable(name)) return name
						}
						if (definition.type === 'Variable' && definition.parent.kind === 'const') {
							if (definition.node.id.type === 'Identifier' && definition.node.init) return calleeName(definition.node.init, seen)
							if (definition.node.id.type === 'ObjectPattern') {
								const property = definition.node.id.properties.find((entry) => entry.type === 'Property' && entry.value.type === 'Identifier' && entry.value.name === node.name)
								const name = property?.type === 'Property' ? propertyName(property.key) : undefined
								if (name && isComposable(name)) return name
							}
						}
					}
					return undefined
				}
				scope = scope.upper
			}
			return undefined
		}
		return {
			CallExpression(node) {
				const name = calleeName(node.callee)
				if (name) calls.push({ node, name })
			},
			'AwaitExpression, ReturnStatement'(node: TSESTree.AwaitExpression | TSESTree.ReturnStatement) {
				boundaries.push({ node, owner: scopeOf(node).owner })
			},
			'Program:exit'() {
				for (const { node, name } of calls) {
					const { fn, owner, script } = scopeOf(node)
					const ownName = fn ? functionName(fn) : undefined
					if ((services.isMeeko && !script) || (fn ? !ownName || !isComposable(ownName) || fn.generator || node.range[0] < fn.body.range[0] : !script)) {
						context.report({ node: node.callee, messageId: 'context', data: { name } })
						continue
					}
					let parent = node.parent
					let conditional = node.optional || (node.callee.type === 'MemberExpression' && node.callee.optional)
					while (parent && parent !== fn && parent.type !== 'Program') {
						if (['IfStatement', 'SwitchCase', 'ConditionalExpression', 'LogicalExpression', 'ForStatement', 'ForOfStatement', 'ForInStatement', 'WhileStatement', 'DoWhileStatement', 'TryStatement', 'CatchClause'].includes(parent.type)) conditional = true
						parent = parent.parent
					}
					if (conditional) context.report({ node: node.callee, messageId: 'conditional', data: { name } })
					else if (boundaries.some((boundary) => boundary.owner === owner && (boundary.node.range[1] <= node.range[0] || (boundary.node.type === 'AwaitExpression' && boundary.node.range[0] >= node.range[0] && boundary.node.range[1] <= node.range[1])))) context.report({ node: node.callee, messageId: 'late', data: { name } })
				}
			},
		}
	},
})
