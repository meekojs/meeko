import type { DocsLocale } from '../locale'

/*
 * Where the translations of the documentation live and what they declare. A translation of
 * `docs/<path>` is `docs/en/<path>`; the guides whose original is outside `docs/` (the quick start
 * and the changelog of the package) are `docs/en/<slug>.md`. A translation starts with a
 * frontmatter whose `source-hash` is the SHA-256 of the Spanish original it was made from; the
 * guides have no other key, and the reference pages keep the keys of the original.
 */

/** The folder of the English translations. */
export const translationsFolder = 'docs/en'

/** The translation of an original outside `docs/`, by its path from the repository root. */
const outsideDocs: Readonly<Record<string, string>> = {
	'packages/meeko/README.md': 'docs/en/inicio-rapido.md',
	'packages/meeko/CHANGELOG.md': 'docs/en/changelog.md',
}

/**
 * The file of the `locale` translation of an original, both from the repository root
 * (`docs/api.md` → `docs/en/api.md`), or `null` when the original is not translated: Spanish, a
 * translation itself or a file outside `docs/` without a place in {@link translationsFolder}.
 */
export function translationFile(original: string, locale: DocsLocale): string | null {
	if (locale === 'es' || original.startsWith(`${translationsFolder}/`)) return null
	if (original.startsWith('docs/')) return `${translationsFolder}/${original.slice('docs/'.length)}`
	return outsideDocs[original] ?? null
}

/** The original of a translation file (`docs/en/api.md` → `docs/api.md`), or `null` when it is not one. */
export function originalFile(translation: string): string | null {
	if (!translation.startsWith(`${translationsFolder}/`)) return null
	for (const [original, file] of Object.entries(outsideDocs)) if (file === translation) return original
	return `docs/${translation.slice(translationsFolder.length + 1)}`
}

const hashPattern = /^[0-9a-f]{64}$/

/** A translation as the render reads it: its text without `source-hash`, and that hash. */
export interface TranslationText {
	/** The text without the `source-hash` line, and without the frontmatter when it had nothing else. */
	readonly text: string
	/** The `source-hash` it declares, or `null` when it has none or it is not a SHA-256 in hexadecimal. */
	readonly sourceHash: string | null
}

/** The frontmatter of `text` as its lines and the text after it, or `null` without one. */
function splitFrontmatter(text: string): { lines: string[]; rest: string } | null {
	const match = /^---\n([\s\S]*?)\n?---(?:\n|$)/.exec(text)
	if (!match) return null
	return { lines: match[1] ? match[1].split('\n') : [], rest: text.slice(match[0].length) }
}

const hashLine = /^source-hash:\s*(.*?)\s*$/

/**
 * The text of a translation without its `source-hash`, and that hash. A guide's frontmatter, which
 * only holds it, disappears; the frontmatter of a reference page keeps its other keys.
 */
export function readTranslation(text: string): TranslationText {
	const parts = splitFrontmatter(text)
	if (!parts) return { text, sourceHash: null }
	const index = parts.lines.findIndex((line) => hashLine.test(line))
	if (index < 0) return { text, sourceHash: null }
	const value = hashLine
		.exec(parts.lines[index]!)![1]!
		.replace(/^(["'])(.*)\1$/, '$2')
		.toLowerCase()
	const lines = parts.lines.filter((_, position) => position !== index)
	const body = lines.some((line) => line.trim()) ? `---\n${lines.join('\n')}\n---\n${parts.rest}` : parts.rest.replace(/^\n+/, '')
	return { text: body, sourceHash: hashPattern.test(value) ? value : null }
}

/**
 * `text` with `source-hash: <hash>` in its frontmatter: replaced when it has one, added at the end
 * of its frontmatter, or in a new frontmatter at the start. What `translations stamp` writes.
 */
export function stampTranslation(text: string, hash: string): string {
	if (!hashPattern.test(hash)) throw new TypeError('The source hash must be a SHA-256 in hexadecimal')
	const parts = splitFrontmatter(text)
	if (!parts) return `---\nsource-hash: ${hash}\n---\n\n${text.replace(/^\n+/, '')}`
	const index = parts.lines.findIndex((line) => hashLine.test(line))
	const lines = [...parts.lines]
	if (index < 0) lines.push(`source-hash: ${hash}`)
	else lines[index] = `source-hash: ${hash}`
	return `---\n${lines.join('\n')}\n---\n${parts.rest}`
}
