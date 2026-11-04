import type { TemplateAttribute, TemplateNode } from '@meekojs/meeko/parse'

import { parseSfc, parseTemplate } from '@meekojs/meeko/parse'

/** Comment-only lines before the first line that says what language a block is. */
const leadingComments = /^(?:\s*(?:#|\/\/)[^\n]*\n|\s*\/\*[\s\S]*?\*\/)*\s*/

/** Commands that open a block of a terminal. */
const shellCommand = /^(?:\$ )?(?:pnpm|npm|npx|yarn|bun|bunx|deno|meeko|node|git|curl|cd|mkdir|docker|code)\b/

/** A rule of a stylesheet: a selector or an at-rule, then a block with a declaration or a nested rule. */
const stylesheet = /^(?:@[a-z-]+\b[^;{]*[;{]|(?:[.#:*[]|[a-z][a-z0-9-]*(?:[\s,.[>+~{]|:[a-z:]))[^;{}()=]*(?:\([^;{}]*\)[^;{}()=]*)*\{\s*(?:--|[a-z-]+\s*:\s*[^\s{]|[.#:&@]))/

/** Extension of the file that names a block, such as `app/styles/main.css`. */
const languageOfExtension: Readonly<Record<string, string>> = { ts: 'ts', mts: 'ts', js: 'js', mjs: 'js', css: 'css', json: 'json', html: 'html', meeko: 'html', sh: 'sh', ps1: 'powershell' }

/**
 * The fence language of a code block that does not declare one, for {@link blockLanguage}: the
 * extension of the file that names it or, without one, what its text starts with. It is `ts` for
 * anything else, which is what these documents show unless they say otherwise.
 */
export function codeLanguage(code: string, label?: string): string {
	const extension = /\.([a-z0-9]+)$/.exec(label?.trim().toLowerCase() ?? '')?.[1]
	const named = extension && languageOfExtension[extension]
	if (named) return named
	if (code.trimStart().startsWith('<')) return 'html'
	const start = code.replace(leadingComments, '')
	if (code.includes('\n') ? code.split('\n').every((line) => !line.trim() || line.trim().startsWith('#') || shellCommand.test(line.trim())) : shellCommand.test(start)) return 'sh'
	if (/^[{[]/.test(start)) {
		try {
			JSON.parse(code)
			return 'json'
		} catch {
			/* An object in another language, or JSON with comments. */
		}
	}
	// A stylesheet has no `//` comments.
	return !code.trimStart().startsWith('//') && stylesheet.test(start) ? 'css' : 'ts'
}

/** What {@link transformCodeTags} needs from the build that calls it. */
export interface CodeTagOptions {
	/** Component whose tags it resolves. */
	readonly tag: string
	/** The text of a `bind:code` expression, or `undefined` when only the running page can know it. */
	readonly evaluate: (expression: string) => string | undefined
	/** The highlighted `<pre>` of a block, and the language to show in its header. */
	readonly highlight: (code: string, label: string | undefined) => { readonly html: string; readonly label: string }
}

/** A JavaScript string literal that is safe inside a double-quoted attribute of a template. */
function stringLiteral(value: string): string {
	return `'${value.replace(/[^\x20-\x7e]|[\\'"<>&]/g, (character) => (character === '\\' ? '\\\\' : character === "'" ? "\\'" : `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`))}'`
}

function* elements(node: TemplateNode): Generator<TemplateNode> {
	if (node.tagName) yield node
	for (const child of [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])]) yield* elements(child)
}

/**
 * Highlights at build time the code of every `<tag>` of a component source, before Meeko compiles
 * it: `code="…"` or `bind:code="examples.button"` becomes `bind:highlighted` with the `<pre>` and,
 * unless the tag declares it, `lang` with its language. The chunk of each page carries the code it
 * shows, in the same text for the server and the browser, so hydration matches and the browser
 * never needs a highlighter. A tag whose text is not known at build time stays as it is, in plain text.
 *
 * @param source Text of the `.meeko` file.
 * @param filename Its path, for parse errors.
 * @param options The tag, how to read an expression and how to highlight.
 * @returns The new source, or `undefined` when nothing changes.
 */
export function transformCodeTags(source: string, filename: string, options: CodeTagOptions): string | undefined {
	if (!source.includes(`<${options.tag}`)) return undefined
	const document = parseSfc(source, filename)
	const edits: Array<{ readonly start: number; readonly end: number; readonly text: string }> = []
	for (const element of elements(parseTemplate(source, document.template, filename))) {
		if (element.componentName !== options.tag) continue
		const attribute = (name: string): TemplateAttribute | undefined => element.attrs?.find((candidate) => candidate.name === name)
		const literal = attribute('code')
		const bound = attribute('bind:code')
		const code = literal ? literal.value : bound ? options.evaluate(bound.value.trim()) : undefined
		const range = literal ?? bound
		if (code === undefined || !range) continue
		const { html, label } = options.highlight(code, attribute('label')?.value)
		const lang = attribute('lang') || attribute('bind:lang') ? '' : ` lang="${label}"`
		edits.push({ start: range.start, end: range.end, text: `bind:highlighted="${stringLiteral(html)}"${lang}` })
	}
	if (!edits.length) return undefined
	let result = source
	for (const { start, end, text } of edits.reverse()) result = result.slice(0, start) + text + result.slice(end)
	return result
}
