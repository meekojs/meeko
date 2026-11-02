/**
 * HTML attributes of each element, for `<component is>` with a tag and for `bind="obj"`.
 *
 * The lists come from the HTML data that `scripts/html-data.ts` generates from the standard
 * (`src/shared/html-data/attribute-names.ts`). Event handler attributes (`on*`) are left out,
 * because Meeko writes events as `on:event`, and so is `is`, the directive of `<component>`.
 * `type` is left out of `<a>` and `<area>`: there it is only a MIME hint, and with
 * `is="href ? 'a' : 'button'"` `bind:type` is the type of the button.
 */
import type { ariaAttributes } from './html-data/aria'

import { elementAttributeNames, globalAttributeNames } from './html-data/attribute-names'

export { elementAttributeNames, globalAttributeNames }

/** The words of a list separated by spaces, as a union. */
export type Words<List extends string> = List extends `${infer Word} ${infer Rest}` ? Word | Words<Rest> : List extends '' ? never : List

/** Elements of the HTML data. */
export type HtmlTagName = keyof typeof elementAttributeNames

/**
 * Attributes of every HTML element: the global ones, `aria-*` and `data-*`. The ARIA attributes of
 * the standard are also listed by name, which `aria-${string}` already covers, so that completion
 * offers them.
 */
export type GlobalAttributeName = Words<typeof globalAttributeNames> | AriaAttributeName | `aria-${string}` | `data-${string}`

/** ARIA attributes of the standard (`aria-pressed`, `aria-expanded`…). */
type AriaAttributeName = keyof typeof ariaAttributes & string

/**
 * Attribute names of `Tag`: the global ones and its own. Distributive, so a union of tags accepts
 * the attributes of any of them; an element outside the HTML data (a custom element, SVG) accepts
 * any name.
 */
export type AttributeNameOf<Tag extends string> = Tag extends HtmlTagName ? GlobalAttributeName | Words<(typeof elementAttributeNames)[Tag]> : string

/** Value of an attribute: `null`, `undefined` and `false` leave it out; `true` writes it empty. */
export type AttributeValue = string | number | boolean | null | undefined

// Built on first use: a bundle that never checks an attribute (no `<component is>` with a tag) drops the lists.
let globalNames: ReadonlySet<string> | undefined

/** Whether `name` is a global attribute: one of the list, `aria-*` or `data-*`. */
export function isGlobalAttribute(name: string): boolean {
	globalNames ??= new Set(globalAttributeNames.split(' '))
	return globalNames.has(name) || name.startsWith('aria-') || name.startsWith('data-')
}

let ownNames: Map<string, ReadonlySet<string>> | undefined

/** Own attributes of an element of the HTML data, or `undefined` for another tag. */
function ownAttributes(tag: string): ReadonlySet<string> | undefined {
	ownNames ??= new Map(Object.entries(elementAttributeNames).map(([name, list]) => [name, new Set<string>(list ? list.split(' ') : [])]))
	return ownNames.get(tag)
}

/** Whether the element `tag` of the HTML data accepts the attribute `name` (always for a global one). */
export function elementAccepts(tag: string, name: string): boolean {
	return isGlobalAttribute(name) || (ownAttributes(tag)?.has(name) ?? false)
}

/**
 * Tags among `tags` whose own attributes include `name`, or `null` for a global attribute, which
 * every tag accepts. The compiler writes this list next to each attribute of `<component is>`.
 */
export function tagsAccepting(name: string, tags: Iterable<string>): string[] | null {
	if (isGlobalAttribute(name)) return null
	return [...tags].filter((tag) => ownAttributes(tag)?.has(name) ?? false)
}
