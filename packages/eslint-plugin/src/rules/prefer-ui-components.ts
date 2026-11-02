import type { TemplateNode } from '@meekojs/meeko/parse'

import { ESLintUtils } from '@typescript-eslint/utils'

import { template, visit } from '../template'

type NativeControl = 'button' | 'dialog' | 'input' | 'select' | 'table' | 'textarea'

const replacements: Record<NativeControl, string> = {
	button: 'UIButton',
	dialog: 'UIModal',
	input: 'UIInput',
	select: 'UISelect',
	table: 'UITable',
	textarea: 'UITextarea',
}

/** An `<input>` of these types has its own component, with the same native control inside. */
const inputReplacements: Readonly<Record<string, string>> = {
	checkbox: 'UICheckbox',
	radio: 'UIRadioGroup',
	range: 'UISlider',
}

const isNativeControl = (tag: string | undefined): tag is NativeControl => tag !== undefined && Object.hasOwn(replacements, tag)

/** The static `type` of an element, in lower case like the browser reads it; a `bind:type` is unknown. */
function staticType(node: TemplateNode): string | undefined {
	return node.attrs?.find((attribute) => attribute.name === 'type')?.value?.toLowerCase()
}

export default ESLintUtils.RuleCreator((name) => `https://github.com/meekojs/meeko/tree/main/packages/eslint-plugin/docs/rules/${name}.md`)({
	name: 'prefer-ui-components',
	meta: {
		type: 'suggestion',
		docs: { description: 'Avisa de los controles HTML escritos a mano donde hay un componente de @meekojs/ui.' },
		schema: [
			{
				type: 'object',
				properties: {
					allow: {
						type: 'array',
						items: { type: 'string', enum: Object.keys(replacements) },
						uniqueItems: true,
					},
				},
				additionalProperties: false,
			},
		],
		messages: {
			prefer: 'Usa <{{component}}> de @meekojs/ui en lugar de <{{tag}}> escrito a mano.',
		},
	},
	defaultOptions: [{ allow: [] as string[] }],
	create(context, [{ allow = [] }]) {
		return {
			'Program:exit'() {
				const body = template(context)
				if (!body) return
				visit(body, (node) => {
					const tag = node.tagName
					if (node.componentName || !isNativeControl(tag) || allow.includes(tag)) return
					const type = tag === 'input' ? staticType(node) : undefined
					// A hidden input has no design: it only carries a value in a form.
					if (type === 'hidden') return
					context.report({
						loc: context.sourceCode.getLocFromIndex(node.start + 1),
						messageId: 'prefer',
						data: { tag, component: (type && inputReplacements[type]) ?? replacements[tag] },
					})
				})
			},
		}
	},
})
