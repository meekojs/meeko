import { parseForESLint } from '@typescript-eslint/parser'
import { ESLintUtils } from '@typescript-eslint/utils'

import { template, visit } from '../template'

const booleanAttributes = new Set(['allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default', 'defer', 'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected'])
const reserved = new Set(['is', 'ref', 'html', 'bind', 'model'])

export default ESLintUtils.RuleCreator((name) => `https://github.com/meekojs/meeko/tree/main/packages/eslint-plugin/docs/rules/${name}.md`)({
	name: 'prefer-static-bindings',
	meta: {
		type: 'suggestion',
		docs: { description: 'Sustituye bindings literales por atributos estáticos equivalentes.' },
		fixable: 'code',
		schema: [],
		messages: { static: 'Usa un atributo estático para el binding literal {{name}}.' },
	},
	defaultOptions: [],
	create(context) {
		return {
			'Program:exit'() {
				const body = template(context)
				if (!body) return
				visit(body, (node) => {
					if (!node.tagName || node.tagName.includes('-') || node.tagName === 'component' || node.tagName.startsWith('Meeko') || node.namespaceURI !== 'http://www.w3.org/1999/xhtml') return
					for (const attribute of node.attrs ?? []) {
						if (!attribute.name.startsWith('bind:')) continue
						const name = attribute.name.slice(5)
						if (!/^[A-Za-z_$][\w$]*$/.test(name) || reserved.has(name) || /^on/i.test(name) || node.attrs?.some((entry) => entry !== attribute && entry.name === name)) continue
						let parsed: ReturnType<typeof parseForESLint>
						try {
							parsed = parseForESLint(`(${attribute.value})`, { range: true })
						} catch {
							continue
						}
						const statement = parsed.ast.body[0]
						const value = statement?.type === 'ExpressionStatement' ? statement.expression : undefined
						if (parsed.ast.body.length !== 1 || value?.type !== 'Literal') continue
						let replacement: string
						if (typeof value.value === 'string') {
							// HTML normalizes carriage returns and rejects several control references.
							if (/[\u0000-\u001f\u007f-\u009f\ufdd0-\ufdef\ufffe\uffff]/u.test(value.value)) continue
							// Native boolean attributes use truthiness; an empty string binding means false.
							if (!node.componentName && booleanAttributes.has(name)) continue
							replacement = `${name}="${value.value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}"`
						} else if (value.value === true && !node.componentName && booleanAttributes.has(name)) replacement = name
						else continue
						context.report({
							loc: { start: context.sourceCode.getLocFromIndex(attribute.start), end: context.sourceCode.getLocFromIndex(attribute.end) },
							messageId: 'static',
							data: { name },
							fix: (fixer) => fixer.replaceTextRange([attribute.start, attribute.end], replacement),
						})
					}
				})
			},
		}
	},
})
