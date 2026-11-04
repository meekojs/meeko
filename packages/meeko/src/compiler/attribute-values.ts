import { ariaAttributes } from '../shared/html-data/aria'
import { htmlElementAttributes, htmlGlobalAttributes } from '../shared/html-data/attributes'

/**
 * Closed values of HTML attributes, from the HTML data, for the compiler and `meeko check`: the
 * same rule as the type `AttributeValues` of `src/shared/html-attribute-values.ts`. The compiler
 * only writes the check of a value (MEEK122) on the attributes that have them.
 */

interface ValueData {
	readonly values?: readonly string[]
	readonly freeform?: true
	readonly tokens?: true
	readonly type?: string
}

const elements = htmlElementAttributes as unknown as Readonly<Record<string, Readonly<Record<string, ValueData>>>>
const globals = htmlGlobalAttributes as unknown as Readonly<Record<string, ValueData>>
const aria = ariaAttributes as unknown as Readonly<Record<string, ValueData>>

/** The data of `name` on `tag`: its own, or else the global or ARIA one. */
function attributeData(tag: string, name: string): ValueData | undefined {
	const own = Object.hasOwn(elements, tag) ? elements[tag]! : undefined
	if (own && Object.hasOwn(own, name)) return own[name]
	if (Object.hasOwn(globals, name)) return globals[name]
	return Object.hasOwn(aria, name) ? aria[name] : undefined
}

/**
 * Values that the standard admits in the attribute `name` of `tag`, or `undefined` when its value
 * is free text, suggestions or a list of words, or the data do not know it.
 */
export function closedAttributeValues(tag: string, name: string): readonly string[] | undefined {
	const data = attributeData(tag, name)
	if (!data?.values || data.freeform || data.tokens || data.type === 'token list') return undefined
	return data.values
}

/** Closed values of `name` on any of `tags`, without repeats, or `undefined` when none has them. */
export function closedAttributeValuesOf(tags: Iterable<string>, name: string): readonly string[] | undefined {
	const values = new Set<string>()
	for (const tag of tags) for (const value of closedAttributeValues(tag, name) ?? []) values.add(value)
	return values.size ? [...values] : undefined
}
