import type { HtmlAttributeData } from '../shared/html-data/attributes'

import { ariaAttributes } from '../shared/html-data/aria'
import { htmlElementAttributes, htmlGlobalAttributes } from '../shared/html-data/attributes'
import { svgElementAttributes, svgGlobalAttributes } from '../shared/html-data/svg'

/**
 * The data of native attributes, HTML and SVG, for the compiler, `meeko check` and the editor: the
 * same lookup and the same rules as the types of `src/shared/html-attribute-values.ts`
 * (`AttributeValues`, `InvalidAttributeLiterals`). The compiler only writes the check of a value
 * (MEEK122) on the attributes that {@link checksAttributeValue} names.
 *
 * A tag is an HTML element (`button`), or an SVG one with the prefix `svg:` (`svg:circle`), as the
 * compiler writes every element inside `<svg>`.
 */

/** The data of an attribute, of HTML, SVG or ARIA. */
export type AttributeData = Pick<HtmlAttributeData, 'kind'> & Partial<Omit<HtmlAttributeData, 'kind'>> & { readonly type?: string }

type Table = Readonly<Record<string, AttributeData>>

const elements = htmlElementAttributes as unknown as Readonly<Record<string, Table>>
const globals = htmlGlobalAttributes as unknown as Table
const svgElements = svgElementAttributes as unknown as Readonly<Record<string, Table>>
const svgGlobals = svgGlobalAttributes as unknown as Table
const aria = ariaAttributes as unknown as Table

/** The prefix of an SVG element in a tag: `svg:circle`. */
export const svgTagPrefix = 'svg:'

/** Whether `tag` names an SVG element: `svg:a`, or a name that only the SVG data has (`circle`). */
export function isSvgTag(tag: string): boolean {
	return tag.startsWith(svgTagPrefix) || (!Object.hasOwn(elements, tag) && Object.hasOwn(svgElements, tag))
}

/** The name of `tag` as written in the template, without the SVG prefix. */
export function plainTagName(tag: string): string {
	return tag.startsWith(svgTagPrefix) ? tag.slice(svgTagPrefix.length) : tag
}

/** The SVG elements of the data. */
export function svgTagNames(): readonly string[] {
	return Object.keys(svgElements)
}

/** The data of `name` on `tag`: its own, or else the global or ARIA one. */
export function attributeData(tag: string, name: string): AttributeData | undefined {
	const svg = isSvgTag(tag)
	const own = svg ? svgElements[plainTagName(tag)] : Object.hasOwn(elements, tag) ? elements[tag] : undefined
	const shared = svg ? svgGlobals : globals
	if (own && Object.hasOwn(own, name)) return own[name]
	if (Object.hasOwn(shared, name)) return shared[name]
	return Object.hasOwn(aria, name) ? aria[name] : undefined
}

/** The attributes of the SVG element `tag` in the data: its own and the ones of every SVG element. */
export function svgAttributes(tag: string): ReadonlyArray<readonly [name: string, data: AttributeData, global: boolean]> {
	const own = svgElements[plainTagName(tag)] ?? {}
	return [...Object.entries(own).map(([name, data]) => [name, data, false] as const), ...Object.entries(svgGlobals).flatMap(([name, data]) => (Object.hasOwn(own, name) ? [] : [[name, data, true] as const]))]
}

/**
 * Values that the standard admits in the attribute `name` of `tag`, or `undefined` when its value
 * is free text, suggestions or a list of words, or the data do not know it. A boolean attribute
 * admits the empty string and its own name. Besides them, an attribute may admit what starts with
 * one of its `prefixes` (see {@link attributeData}).
 */
export function closedAttributeValues(tag: string, name: string): readonly string[] | undefined {
	const data = attributeData(tag, name)
	if (data?.kind === 'boolean') return ['', name]
	return data?.kind === 'enum' ? data.values : undefined
}

/** Closed values of `name` on any of `tags`, without repeats, or `undefined` when none has them. */
export function closedAttributeValuesOf(tags: Iterable<string>, name: string): readonly string[] | undefined {
	const values = new Set<string>()
	for (const tag of tags) for (const value of closedAttributeValues(tag, name) ?? []) values.add(value)
	return values.size ? [...values] : undefined
}

/**
 * Whether the type check reads the value of `name` on `tag` (MEEK122): an attribute with closed
 * values, or a reference to one element (`popovertarget`), whose ID is never empty nor has spaces.
 */
export function checksAttributeValue(tag: string, name: string): boolean {
	return closedAttributeValues(tag, name) !== undefined || attributeData(tag, name)?.kind === 'id'
}

/**
 * The type of a value of `name` on `tag` as text, for the editor and the messages: `boolean` for a
 * boolean attribute; the union of the values of a closed set (up to eight; with more, `string`),
 * with `boolean` when `"true"` and `"false"` are among them; `string | number` for a number, and
 * `string` otherwise. `null` and `undefined` leave any attribute out.
 */
export function attributeTypeText(name: string, data: AttributeData | undefined): string {
	if (name === 'class') return 'ClassValue'
	if (name === 'style') return 'StyleValue'
	if (data?.kind === 'boolean') return 'boolean | null | undefined'
	const optional = ' | null | undefined'
	if (data?.kind === 'enum' && data.values && data.values.length <= 8) {
		const values = data.values.map((value) => `'${value}'`)
		const custom = (data.prefixes ?? []).map((prefix) => `\`${prefix}\${string}\``)
		const boolean = (data.values.includes('true') && data.values.includes('false')) || name === 'hidden'
		return [...values, ...custom, ...(boolean ? ['boolean'] : [])].join(' | ') + optional
	}
	return (data?.kind === 'number' || name.startsWith('aria-') ? 'string | number' : 'string') + optional
}

/** What the value of an attribute is, in a few words, for hover and completion: `ID de un elemento`. */
export function attributeKindLabel(data: AttributeData | undefined): string | undefined {
	switch (data?.kind) {
		case 'boolean':
			return 'atributo booleano: presente o ausente'
		case 'enum':
			return 'uno de sus valores'
		case 'id':
			return 'ID de un elemento'
		case 'ids':
			return 'lista de IDs separados por espacios'
		case 'number':
			return 'número'
		case 'tokens':
			return 'lista de valores separados por espacios'
		case 'url':
			return 'URL'
		default:
			return undefined
	}
}
