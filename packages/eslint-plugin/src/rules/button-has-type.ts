import { ESLintUtils } from '@typescript-eslint/utils'

import { template, visit } from '../template'

export default ESLintUtils.RuleCreator((name) => `https://github.com/meekojs/meeko/tree/main/packages/eslint-plugin/docs/rules/${name}.md`)({
	name: 'button-has-type',
	meta: {
		type: 'problem',
		docs: { description: 'Exige un tipo explícito en los botones HTML para evitar envíos accidentales.' },
		schema: [],
		hasSuggestions: true,
		messages: {
			missing: 'Indica type en este botón: button, submit o reset.',
			button: 'Usar type="button" para una acción local.',
			submit: 'Usar type="submit" para enviar el formulario.',
		},
	},
	defaultOptions: [],
	create(context) {
		return {
			'Program:exit'() {
				const body = template(context)
				if (!body) return
				visit(body, (node) => {
					if (node.tagName !== 'button' || node.componentName || node.attrs?.some((attribute) => attribute.name === 'type' || attribute.name === 'bind:type')) return
					context.report({
						loc: context.sourceCode.getLocFromIndex(node.start + 1),
						messageId: 'missing',
						suggest: (['button', 'submit'] as const).map((type) => ({
							messageId: type,
							fix: (fixer) => fixer.insertTextAfterRange([node.start, node.start + 7], ` type="${type}"`),
						})),
					})
				})
			},
		}
	},
})
