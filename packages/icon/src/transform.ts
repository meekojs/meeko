import type { IconData } from './index'

/**
 * Build-time resolution of `<UIIcon>` tags in the source of a `.meeko` component, before Meeko
 * compiles it. A literal `name="lucide:search"` gets `bind:resolved="{…}"` with that icon, so the
 * component chunk carries exactly the icons it uses. String literals inside `bind:name` are
 * resolved the same way, so `bind:name="open.value ? 'lucide:x' : 'lucide:menu'"` needs no
 * `icon.include`. The SSR and the browser builds see the same text, so hydration matches.
 */

/** Tag of the component that this module registers. */
export const iconTag = 'UIIcon'

interface Attribute {
	readonly name: string
	readonly value: string | undefined
}

/** Ranges that are not template markup: `<script>`, `<style>` and comments. */
function skippedRanges(source: string): Array<readonly [number, number]> {
	const ranges: Array<readonly [number, number]> = []
	const pattern = /<!--[\s\S]*?(?:-->|$)|<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi
	for (const match of source.matchAll(pattern)) ranges.push([match.index, match.index + match[0].length])
	return ranges
}

/** The attributes of the tag that starts at `start`, and the offset after its name. */
function readTag(source: string, start: number): { attributes: Attribute[]; end: number } | undefined {
	let cursor = start + 1 + iconTag.length
	const attributes: Attribute[] = []
	const pattern = /\s*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/y
	for (;;) {
		const close = /^\s*\/?>/.exec(source.slice(cursor, cursor + 64))
		if (close) return { attributes, end: cursor + close[0].length }
		pattern.lastIndex = cursor
		const match = pattern.exec(source)
		if (!match || match[0].length === 0) return undefined
		attributes.push({ name: match[1]!, value: match[2] ?? match[3] })
		cursor = pattern.lastIndex
	}
}

/** A JavaScript string literal that is safe inside a double-quoted attribute of a template. */
function stringLiteral(value: string): string {
	return `'${value.replace(/[^\x20-\x7e]|[\\'"<>&]/g, (character) => (character === '\\' ? '\\\\' : character === "'" ? "\\'" : `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`))}'`
}

/** The source of the object that `bind:resolved` receives. */
function resolvedExpression(icons: ReadonlyMap<string, IconData>): string {
	return `{${[...icons].map(([name, [viewBox, body]]) => `${stringLiteral(name)}:[${stringLiteral(viewBox)},${stringLiteral(body)}]`).join(',')}}`
}

/** Icon names written as string literals in a `bind:name` expression. */
export function literalNames(expression: string): string[] {
	return [...expression.matchAll(/(['`])([a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:[-_][a-z0-9]+)*)\1/g)].map((match) => match[2]!)
}

/**
 * Adds the resolved icons to every `<UIIcon>` of a component source.
 *
 * @param source Text of the `.meeko` file.
 * @param resolve Resolves a full icon name; throws for an unknown icon.
 * @returns The new source and the resolved names, or `undefined` when nothing changes.
 * @throws {Error} When a literal `name` does not resolve, with the offset of its tag in `offset`.
 */
export function transformIconTags(source: string, resolve: (name: string) => IconData): { code: string; names: string[] } | undefined {
	if (!source.includes(`<${iconTag}`)) return undefined
	const skipped = skippedRanges(source)
	const insertions: Array<{ offset: number; text: string }> = []
	const names = new Set<string>()
	const tag = new RegExp(`<${iconTag}(?=[\\s/>])`, 'g')
	for (const match of source.matchAll(tag)) {
		const offset = match.index
		if (skipped.some(([from, to]) => offset >= from && offset < to)) continue
		const parsed = readTag(source, offset)
		if (!parsed) continue
		if (parsed.attributes.some((attribute) => attribute.name === 'resolved' || attribute.name === 'bind:resolved')) continue
		const icons = new Map<string, IconData>()
		for (const attribute of parsed.attributes) {
			if (attribute.name === 'name' && attribute.value !== undefined) {
				try {
					icons.set(attribute.value, resolve(attribute.value))
				} catch (error) {
					throw Object.assign(new Error((error as Error).message, { cause: error }), { offset })
				}
			} else if (attribute.name === 'bind:name' && attribute.value !== undefined) {
				// A literal inside an expression may be any string: only the names that resolve are embedded.
				for (const name of literalNames(attribute.value)) {
					try {
						icons.set(name, resolve(name))
					} catch {
						/* the type of `name` reports it; the runtime falls back to the registry */
					}
				}
			}
		}
		if (!icons.size) continue
		for (const name of icons.keys()) names.add(name)
		insertions.push({ offset: offset + 1 + iconTag.length, text: ` bind:resolved="${resolvedExpression(icons)}"` })
	}
	if (!insertions.length) return undefined
	let code = source
	for (const { offset, text } of insertions.reverse()) code = code.slice(0, offset) + text + code.slice(offset)
	return { code, names: [...names] }
}

/** Line and column (1-based) of `offset`, for errors. */
export function position(source: string, offset: number): { column: number; line: number } {
	const before = source.slice(0, offset).split(/\r?\n/)
	return { column: before.at(-1)!.length + 1, line: before.length }
}
