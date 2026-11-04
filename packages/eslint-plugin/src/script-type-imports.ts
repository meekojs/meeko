import type { TSESTree } from '@typescript-eslint/utils'

import { parseSfc } from '@meekojs/meeko/parse'
import typescript from '@typescript-eslint/eslint-plugin'

const original = typescript.rules['consistent-type-imports']

/** The upstream rule groups imports by module source; an SFC contains two separate modules. */
export default {
	...original,
	create(context) {
		const component = original.create(context)
		const { server } = parseSfc(context.sourceCode.text, context.filename)
		if (!server) return component
		const backend = original.create(context)
		const selectors = new Set([...Object.keys(component), ...Object.keys(backend)])
		return Object.fromEntries(
			[...selectors].map((selector) => [
				selector,
				(node: TSESTree.Node) => {
					const listeners = selector === 'Program' || selector === 'Program:exit' ? [backend, component] : [node.range[0] >= server.contentStart && node.range[1] <= server.contentEnd ? backend : component]
					for (const listener of listeners) {
						const callback = listener[selector] as ((node: TSESTree.Node) => void) | undefined
						callback?.(node)
					}
				},
			]),
		)
	},
} satisfies typeof original
