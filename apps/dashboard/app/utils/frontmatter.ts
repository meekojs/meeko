// The frontmatter as fields, outside the Markdown editor: Crepe never sees it. It is the subset of
// YAML that the reference pages use (packages/docs-content/src/content/reference.ts): `key: value`,
// `key: [a, b]` and a list of `- item` lines under `key:`. A field that does not change keeps its
// lines, so that a stamp or an edit of one key does not rewrite the others.

/** One key of a frontmatter, with the lines it was written in. */
export interface FrontmatterField {
	readonly key: string
	/** A list is edited with one item per line. */
	readonly kind: 'list' | 'text'
	/** The value without quotes; for a list, its items separated by line breaks. */
	readonly value: string
	/** Its line in the file, starting at 1: where a warning of the preview sends the caret. */
	readonly line: number
	readonly lines: readonly string[]
}

/** The keys that the site accepts, in the order the pages write them. */
export const frontmatterKeys: readonly { readonly key: string; readonly kind: FrontmatterField['kind'] }[] = [
	{ key: 'title', kind: 'text' },
	{ key: 'group', kind: 'text' },
	{ key: 'since', kind: 'text' },
	{ key: 'description', kind: 'text' },
	{ key: 'signature', kind: 'text' },
	{ key: 'symbols', kind: 'list' },
	{ key: 'types', kind: 'list' },
	{ key: 'related', kind: 'list' },
	{ key: 'source-hash', kind: 'text' },
]

const delimiters = /^---\n([\s\S]*?)\n---\n(\s*)$/

function unquote(value: string): string {
	const trimmed = value.trim()
	if (/^".*"$/.test(trimmed)) {
		try {
			return JSON.parse(trimmed) as string
		} catch {
			return trimmed
		}
	}
	if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replaceAll("''", "'")
	return trimmed
}

/**
 * The fields of `head`, the frontmatter that `splitMarkdownSource` separates, or `null` when it has
 * something the fields could not write back as it was: then it is edited as text.
 */
export function readFrontmatter(head: string): FrontmatterField[] | null {
	if (!head) return []
	const match = delimiters.exec(head)
	if (!match) return null
	const fields: { key: string; kind: FrontmatterField['kind']; line: number; lines: string[]; items: string[]; text: string }[] = []
	for (const [index, line] of match[1]!.split('\n').entries()) {
		const item = /^\s+-\s+(.*)$/.exec(line)
		if (item) {
			const field = fields.at(-1)
			if (field?.kind !== 'list' || field.text) return null
			field.lines.push(line)
			field.items.push(unquote(item[1]!))
			continue
		}
		const pair = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line)
		if (!pair || fields.some((field) => field.key === pair[1])) return null
		const value = pair[2]?.trim() ?? ''
		// `key: [a, b]`, which no page uses today, stays in the text form rather than being rewritten.
		if (value.startsWith('[')) return null
		fields.push({ key: pair[1]!, kind: value ? 'text' : 'list', line: index + 2, lines: [line], items: [], text: value ? unquote(value) : '' })
	}
	return fields.map(({ key, kind, line, lines, items, text }) => ({ key, kind, line, lines, value: kind === 'list' ? items.join('\n') : text }))
}

/** A scalar as YAML, quoted only when the plain form would read as something else. */
function quote(value: string): string {
	return /^[\s"'[\]{}&*!|>%@`#-]|: |\s#|\s$|:$/.test(value) ? JSON.stringify(value) : value
}

function writtenLines(field: FrontmatterField | undefined, key: string, kind: FrontmatterField['kind'], value: string): string[] {
	if (kind === 'text') return value.trim() ? [`${key}: ${quote(value.trim())}`] : []
	const items = value
		.split('\n')
		.map((item) => item.trim())
		.filter(Boolean)
	if (!items.length) return []
	// An item that stays keeps its line, with its quotes.
	const previous = new Map<string, string>()
	if (field) for (const line of field.lines.slice(1)) previous.set(unquote(/^\s+-\s+(.*)$/.exec(line)![1]!), line)
	return [`${key}:`, ...items.map((item) => previous.get(item) ?? `  - ${quote(item)}`)]
}

/**
 * `head` with a new value for `key`; an empty value removes the key, and removing the last one removes
 * the frontmatter. What the other keys wrote stays as it was.
 */
export function writeFrontmatter(head: string, key: string, kind: FrontmatterField['kind'], value: string): string {
	const fields = readFrontmatter(head)
	if (!fields) throw new Error('This frontmatter is edited as text')
	const field = fields.find((candidate) => candidate.key === key)
	// A value that reads the same keeps its bytes: `"a"` is still `"a"` after a blur without changes.
	if (field ? field.value === (kind === 'list' ? value : value.trim()) : !value.trim()) return head
	const lines = writtenLines(field, key, kind, value)
	const output: string[] = []
	for (const current of fields) output.push(...(current.key === key ? lines : current.lines))
	if (!field) output.push(...lines)
	if (!output.length) return ''
	return `---\n${output.join('\n')}\n---\n${delimiters.exec(head)?.[2] ?? '\n'}`
}

/** The lines that `head` takes in the file: the first line of the body is this plus one. */
export function headLineCount(head: string): number {
	return head ? head.split('\n').length - 1 : 0
}

/** The offsets of a line of `text`, starting at 1, without its line break. */
export function lineRange(text: string, line: number): readonly [number, number] {
	const lines = text.split('\n')
	const index = Math.min(Math.max(line, 1), lines.length) - 1
	const start = lines.slice(0, index).reduce((sum, current) => sum + current.length + 1, 0)
	return [start, start + lines[index]!.length]
}
