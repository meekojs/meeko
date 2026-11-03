// Saving by blocks: what the editor did not touch keeps the bytes of the original. Crepe serializes
// a whole document in its own format (padded tables, blank lines), so comparing its output with the
// file would mark every document as changed; comparing it with its own first output does not.
// Nothing here imports Crepe: this module is part of the light half of `@meekojs/ui/editor`.

/** A node of the Markdown tree with the offsets that remark writes. */
export interface MarkdownBlockNode {
	readonly position?: { readonly start: { readonly offset?: number | undefined }; readonly end: { readonly offset?: number | undefined } } | undefined
}

/**
 * Lo que `createMarkdownSplicer` necesita de un parser de Markdown: los bloques de primer nivel y sus
 * posiciones en el texto. Es la forma que devuelve `remark.parse`.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { MarkdownBlockParser } from '@meekojs/ui/editor'
 *
 * const parse: MarkdownBlockParser = (markdown) => ({
 * 	children: [{ position: { start: { offset: 0 }, end: { offset: markdown.length } } }],
 * })
 * ```
 */
export type MarkdownBlockParser = (markdown: string) => { readonly children: readonly MarkdownBlockNode[] }

/**
 * Un archivo Markdown separado en su frontmatter y su cuerpo, con los saltos de línea ya en LF.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { MarkdownSource } from '@meekojs/ui/editor'
 *
 * const source: MarkdownSource = { head: '---\ntitle: Hola\n---\n\n', body: '# Hola\n' }
 * ```
 */
export interface MarkdownSource {
	/** El frontmatter con la línea en blanco que lo sigue, o una cadena vacía. */
	readonly head: string
	/** Lo que hay después de `head`. */
	readonly body: string
}

const frontmatter = /^---\n[\s\S]*?\n---\n\s*/

/**
 * Separa el frontmatter de un archivo Markdown, tal como lo escribe `head + body`, y normaliza los
 * saltos de línea a LF, igual que el hash de las revisiones.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import { splitMarkdownSource } from '@meekojs/ui/editor'
 *
 * const { head, body } = splitMarkdownSource('---\ntitle: Hola\n---\n\n# Hola\n')
 * // head: '---\ntitle: Hola\n---\n\n', body: '# Hola\n'
 * ```
 */
export function splitMarkdownSource(source: string): MarkdownSource {
	const text = source.replace(/\r\n?/g, '\n')
	const head = frontmatter.exec(text)?.[0] ?? ''
	return { head, body: text.slice(head.length) }
}

interface Block {
	readonly start: number
	readonly end: number
	readonly text: string
}

function blocksOf(parse: MarkdownBlockParser, markdown: string): Block[] {
	return parse(markdown).children.map((node) => {
		const start = node.position?.start.offset
		const end = node.position?.end.offset
		if (start === undefined || end === undefined) throw new Error('The Markdown parser must write the offsets of each block')
		return { start, end, text: markdown.slice(start, end) }
	})
}

/** Which block of the baseline (`-1`: none, it is new) each block of the edited text comes from. */
function alignBlocks(baseline: readonly Block[], edited: readonly Block[]): (readonly [number, number])[] {
	let head = 0
	while (head < baseline.length && head < edited.length && baseline[head]!.text === edited[head]!.text) head++
	let baselineEnd = baseline.length
	let editedEnd = edited.length
	while (baselineEnd > head && editedEnd > head && baseline[baselineEnd - 1]!.text === edited[editedEnd - 1]!.text) {
		baselineEnd--
		editedEnd--
	}
	const rows = baselineEnd - head
	const columns = editedEnd - head
	// The longest common subsequence of what is left: usually a block or two.
	const table = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1))
	for (let row = rows - 1; row >= 0; row--) {
		for (let column = columns - 1; column >= 0; column--) {
			table[row]![column] = baseline[head + row]!.text === edited[head + column]!.text ? table[row + 1]![column + 1]! + 1 : Math.max(table[row + 1]![column]!, table[row]![column + 1]!)
		}
	}
	const pairs: (readonly [number, number])[] = []
	for (let index = 0; index < head; index++) pairs.push([index, index])
	let row = 0
	let column = 0
	while (column < columns) {
		if (row < rows && baseline[head + row]!.text === edited[head + column]!.text) {
			pairs.push([head + row, head + column])
			row++
			column++
		} else if (row < rows && table[row + 1]![column]! >= table[row]![column + 1]!) {
			row++
		} else {
			pairs.push([-1, head + column])
			column++
		}
	}
	for (let index = 0; index < baseline.length - baselineEnd; index++) pairs.push([baselineEnd + index, editedEnd + index])
	return pairs
}

/**
 * El empalme de un documento: conserva analizados el original y su primera serialización, y sólo
 * analiza el texto editado en cada llamada.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { MarkdownSplicer } from '@meekojs/ui/editor'
 *
 * const write = (splicer: MarkdownSplicer, edited: string) => (splicer.aligned ? splicer.splice(edited) : null)
 * ```
 */
export interface MarkdownSplicer {
	/** Si el original y su serialización tienen los mismos bloques. Sin eso no se puede empalmar. */
	readonly aligned: boolean
	/** El original con sólo los bloques editados reescritos, o `null` si `aligned` es falso. */
	splice(edited: string): string | null
}

/**
 * Prepara el guardado por bloques de un documento. `baseline` es lo que el editor serializó nada más
 * cargar `original`: los bloques que siguen iguales que en él salen del original con sus bytes, y
 * sólo los cambiados salen del editor.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import { createMarkdownSplicer } from '@meekojs/ui/editor'
 * import type { MarkdownBlockParser } from '@meekojs/ui/editor'
 *
 * declare const parse: MarkdownBlockParser
 * const splicer = createMarkdownSplicer(parse, '| a |\n|---|\n\nHola\n', '| a |\n| - |\n\nHola\n')
 * splicer.splice('| a |\n| - |\n\nAdiós\n') // '| a |\n|---|\n\nAdiós\n'
 * ```
 */
export function createMarkdownSplicer(parse: MarkdownBlockParser, original: string, baseline: string): MarkdownSplicer {
	const originalBlocks = blocksOf(parse, original)
	const baselineBlocks = blocksOf(parse, baseline)
	const aligned = originalBlocks.length === baselineBlocks.length
	return {
		aligned,
		splice(edited) {
			if (!aligned) return null
			if (edited === baseline) return original
			const editedBlocks = blocksOf(parse, edited)
			const pairs = alignBlocks(baselineBlocks, editedBlocks)
			let output = originalBlocks.length ? original.slice(0, originalBlocks[0]!.start) : ''
			pairs.forEach(([from, to], index) => {
				if (index > 0) {
					const [previousFrom, previousTo] = pairs[index - 1]!
					output += from >= 0 && previousFrom >= 0 && from === previousFrom + 1 ? original.slice(originalBlocks[previousFrom]!.end, originalBlocks[from]!.start) : edited.slice(editedBlocks[previousTo]!.end, editedBlocks[to]!.start)
				}
				output += from >= 0 ? originalBlocks[from]!.text : editedBlocks[to]!.text
			})
			const last = originalBlocks.at(-1)
			return output + (last ? original.slice(last.end) : original)
		},
	}
}
