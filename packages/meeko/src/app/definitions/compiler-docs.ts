/** Une las líneas de un JSDoc de macro. */
export function jsdoc(...lines: string[]): string {
	return ['/**', ...lines.map((line) => (line ? ` * ${line}` : ' *')), ' */'].join('\n')
}

export const apiDocs = 'https://github.com/meekojs/meeko/blob/main/docs/api.md'
