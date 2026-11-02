import type { TSESTree } from '@typescript-eslint/utils'

import { parseSfc } from '@meekojs/meeko/parse'
import { ESLintUtils } from '@typescript-eslint/utils'

import { macroStatement } from '../macros'
import { template } from '../template'

export default ESLintUtils.RuleCreator((name) => `https://github.com/meekojs/meeko/tree/main/packages/eslint-plugin/docs/rules/${name}.md`)({
	name: 'padding-line-between-macros',
	meta: {
		type: 'layout',
		docs: { description: 'Exige una línea en blanco después de cada macro Meeko si hay otra declaración o instrucción.' },
		fixable: 'whitespace',
		schema: [],
		messages: { padding: 'Deja una línea en blanco después de la declaración de macro.' },
	},
	defaultOptions: [],
	create(context) {
		const statements: TSESTree.Node[] = []
		return {
			'*'(node: TSESTree.Node) {
				const parentType: string | undefined = node.parent?.type
				if ((parentType === 'Program' || parentType === 'MeekoScope') && (node.type as string) !== 'MeekoScope') statements.push(node)
			},
			'Program:exit'() {
				if (!template(context)) return
				const source = context.sourceCode
				const document = parseSfc(source.text, context.filename)
				const eol = source.text.includes('\r\n') ? '\r\n' : '\n'
				for (const section of [document.server, document.script]) {
					if (!section || section.implicit) continue
					const entries = statements.filter((node) => node.range[0] >= section.contentStart && node.range[1] <= section.contentEnd).sort((a, b) => a.range[0] - b.range[0])
					for (let index = 1; index < entries.length; index++) {
						const previous = entries[index - 1]!
						const current = entries[index]!
						if (!macroStatement(source, previous)) continue
						const comments = source.getAllComments().filter((comment) => comment.range[0] >= previous.range[1] && comment.range[1] <= current.range[0])
						const gap = source.text.slice(previous.range[1], current.range[0])
						const lines = gap.split(/\r\n|\r|\n/)
						const padded = lines.some((line, offset) => offset > 0 && offset < lines.length - 1 && line.trim() === '' && !comments.some((comment) => comment.loc.start.line <= previous.loc.end.line + offset && comment.loc.end.line >= previous.loc.end.line + offset))
						if (padded) continue
						context.report({
							node: current,
							messageId: 'padding',
							fix(fixer) {
								if (!comments.length) {
									const indent = lines.length > 1 ? lines.at(-1)! : /^\s*/.exec(source.lines[current.loc.start.line - 1]!)![0]
									return fixer.replaceTextRange([previous.range[1], current.range[0]], eol + eol + indent)
								}
								// Keep a trailing comment with its declaration and leading comments with the next.
								let end = previous.range[1]
								let line = previous.loc.end.line
								for (const comment of comments) {
									if (comment.loc.start.line !== line) break
									end = comment.range[1]
									line = comment.loc.end.line
								}
								const rest = source.text.slice(end, current.range[0])
								return fixer.insertTextAfterRange([end, end], eol + (/^[\t ]*\r?\n/.test(rest) ? '' : eol))
							},
						})
					}
				}
			},
		}
	},
})
