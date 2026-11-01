import type { HtmlAttributeData } from '../shared/html-data/attributes'

import { ariaAttributes } from '../shared/html-data/aria'
import { elementAttributeNames, globalAttributeNames } from '../shared/html-data/attribute-names'
import { htmlElementAttributes, htmlGlobalAttributes } from '../shared/html-data/attributes'

// What the editor knows about the attributes of each HTML element: the names that `bind:` offers,
// their values and the type that a `bind:attr` expression should have. Completion reads it through
// `htmlAttributeSource()`; by default it is Meeko's HTML data (`shared/html-data`: WHATWG, WAI-ARIA
// and browser-compat-data), and `setHtmlAttributeSource` may replace it in a single place.

/** Un atributo HTML de un elemento, como lo usa el completado de la plantilla. */
export interface HtmlAttributeInfo {
	readonly name: string
	readonly description?: string
	/** Valores enumerados (`button`, `submit` y `reset` en `type` de `<button>`). */
	readonly values?: readonly string[]
	/** Los valores son sugerencias: se admiten otros (`autocomplete`). */
	readonly freeform?: boolean
	/** El valor es una lista de valores separados por espacios (`role`, `rel`). */
	readonly tokens?: boolean
	/** Atributo booleano: su presencia lo activa (`disabled`). */
	readonly boolean?: boolean
	/** Global: lo admiten todos los elementos (`class`, `id`, `aria-*`, `data-*`). */
	readonly global: boolean
	readonly deprecated?: boolean
	readonly experimental?: boolean
	/** Enlace a su definición en el estándar. */
	readonly spec?: string
}

/** Fuente de los atributos HTML de cada elemento. */
export interface HtmlAttributeSource {
	/** Los atributos de `tag` que Meeko escribe, sin los manejadores `on*`. */
	attributes(tag: string): readonly HtmlAttributeInfo[]
}

const words = (list: string): string[] => list.split(' ').filter(Boolean)
const globalNames = words(globalAttributeNames)
const elementNames = elementAttributeNames as Readonly<Record<string, string>>
const elementData = htmlElementAttributes as Readonly<Record<string, Readonly<Record<string, HtmlAttributeData>>>>
const globalData = htmlGlobalAttributes as Readonly<Record<string, HtmlAttributeData>>
const ariaData = ariaAttributes as Readonly<Record<string, { readonly description: string; readonly type: string; readonly values?: readonly string[]; readonly experimental?: true; readonly deprecated?: true }>>

function info(name: string, data: HtmlAttributeData | undefined, global: boolean): HtmlAttributeInfo {
	return {
		name,
		global,
		...(data?.description ? { description: data.description } : {}),
		...(data?.values?.length ? { values: data.values } : {}),
		...(data?.freeform ? { freeform: true } : {}),
		...(data?.tokens ? { tokens: true } : {}),
		...(data?.boolean ? { boolean: true } : {}),
		...(data?.deprecated ? { deprecated: true } : {}),
		...(data?.experimental ? { experimental: true } : {}),
		...(data?.spec ? { spec: data.spec } : {}),
	}
}

/**
 * Meeko's HTML data: the names of `attribute-names` (the element's own ones and the global ones,
 * the same table as the compiler: no `on*`, no `type` on `<a>`), with the details of `attributes`
 * and the `aria-*` of WAI-ARIA. An unknown tag (a custom element) has the global ones.
 */
const htmlDataSource: HtmlAttributeSource = {
	attributes(tag) {
		const own = elementNames[tag]
		const found: HtmlAttributeInfo[] = (own ? words(own) : []).map((name) => info(name, elementData[tag]?.[name] ?? globalData[name], false))
		for (const name of globalNames) found.push(info(name, elementData[tag]?.[name] ?? globalData[name], true))
		for (const [name, data] of Object.entries(ariaData)) {
			found.push({
				name,
				global: true,
				description: data.description,
				...(data.values?.length ? { values: data.values } : {}),
				...(data.type.includes('list') ? { tokens: true } : {}),
				...(data.deprecated ? { deprecated: true } : {}),
				...(data.experimental ? { experimental: true } : {}),
			})
		}
		return found
	},
}

let current: HtmlAttributeSource = htmlDataSource
const cache = new Map<string, readonly HtmlAttributeInfo[]>()

/**
 * Fuente de atributos HTML que usa el completado de la plantilla: por defecto, los datos HTML de
 * Meeko (`shared/html-data`), con la misma tabla de atributos que el compilador.
 *
 * @example
 * htmlAttributeSource().attributes("button").find((attribute) => attribute.name === "type")?.values
 * // ["submit", "reset", "button"]
 */
export function htmlAttributeSource(): HtmlAttributeSource {
	return {
		attributes: (tag) => {
			const key = tag.toLowerCase()
			let found = cache.get(key)
			if (!found) cache.set(key, (found = current.attributes(key)))
			return found
		},
	}
}

/**
 * Sustituye la fuente de atributos HTML del completado; `undefined` vuelve a los datos HTML de
 * Meeko.
 *
 * @example
 * setHtmlAttributeSource({ attributes: (tag) => myHtmlData.attributesOf(tag) })
 */
export function setHtmlAttributeSource(source: HtmlAttributeSource | undefined): void {
	current = source ?? htmlDataSource
	cache.clear()
}

/** Whether the values of an attribute are the only valid ones (not suggestions nor a token list). */
export function closedValues(attribute: HtmlAttributeInfo): readonly string[] | undefined {
	return attribute.values?.length && !attribute.freeform && !attribute.tokens ? attribute.values : undefined
}

/**
 * Tipo, como texto, de la expresión de `bind:attr` para un atributo: `boolean` para un atributo
 * booleano; la unión de sus valores cuando son los únicos válidos (hasta ocho; con más, `string`),
 * con `boolean` si admite la cadena vacía (`true` la escribe), y `string` en los demás. `null`,
 * `undefined` y `false` no escriben el atributo.
 *
 * @example
 * attributeValueType({ name: "type", values: ["submit", "reset", "button"], global: false }) // "'submit' | 'reset' | 'button'"
 */
export function attributeValueType(attribute: HtmlAttributeInfo): string {
	if (attribute.boolean) return 'boolean'
	const values = closedValues(attribute)
	// A long list (`input` `type`) reads as `string`; its values go in the documentation.
	if (values && values.length <= 8) {
		const named = values.filter((value) => value !== '').map((value) => `'${value}'`)
		return [...(values.includes('') ? ['boolean'] : []), ...named].join(' | ')
	}
	return attribute.name.startsWith('aria-') || attribute.name === 'tabindex' ? 'string | number' : 'string'
}
