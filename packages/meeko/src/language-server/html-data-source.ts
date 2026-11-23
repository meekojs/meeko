import type { AttributeData } from '../compiler/attribute-values'
import type { HtmlAttributeData } from '../shared/html-data/attributes'

import { attributeTypeText, isSvgTag, plainTagName, svgAttributes, svgTagNames, svgTagPrefix } from '../compiler/attribute-values'
import { ariaAttributes } from '../shared/html-data/aria'
import { elementAttributeNames, globalAttributeNames } from '../shared/html-data/attribute-names'
import { htmlElementAttributes, htmlGlobalAttributes } from '../shared/html-data/attributes'

// What the editor knows about the attributes of each native element, HTML and SVG: the names that
// `bind:` offers, their values and the type that a `bind:attr` expression should have. Completion
// reads it through `htmlAttributeSource()`; by default it is Meeko's data (`shared/html-data`:
// WHATWG, WAI-ARIA, browser-compat-data and the SVG specifications), the same that the compiler and
// `meeko check` read through `compiler/attribute-values`, and `setHtmlAttributeSource` may replace
// it in a single place. A tag inside `<svg>` is asked with the prefix `svg:` (`svg:a`); a name that
// only SVG has (`circle`) is found without it.

/** Un atributo HTML de un elemento, como lo usa el completado de la plantilla. */
export interface HtmlAttributeInfo {
	readonly name: string
	/** Qué es su valor: booleano, valores cerrados (`enum`), ID, lista, número, URL o texto. */
	readonly kind?: HtmlAttributeData['kind']
	/** Además de `values`, cualquier valor que empiece por uno de ellos (`--` en `command`). */
	readonly prefixes?: readonly string[]
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
const ariaData = ariaAttributes as Readonly<Record<string, { readonly kind: HtmlAttributeData['kind']; readonly description: string; readonly type: string; readonly values?: readonly string[]; readonly experimental?: true; readonly deprecated?: true }>>

function info(name: string, data: AttributeData | undefined, global: boolean): HtmlAttributeInfo {
	return {
		name,
		global,
		...(data?.kind ? { kind: data.kind } : {}),
		...(data?.prefixes?.length ? { prefixes: data.prefixes } : {}),
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
		if (isSvgTag(tag)) return [...svgAttributes(tag).map(([name, data, global]) => info(name, data, global)), ...ariaInfo()]
		const own = elementNames[tag]
		const found: HtmlAttributeInfo[] = (own ? words(own) : []).map((name) => info(name, elementData[tag]?.[name] ?? globalData[name], false))
		for (const name of globalNames) found.push(info(name, elementData[tag]?.[name] ?? globalData[name], true))
		found.push(...ariaInfo())
		return found
	},
}

/** The `aria-*` states and properties, which every element accepts. */
function ariaInfo(): HtmlAttributeInfo[] {
	return Object.entries(ariaData).map(([name, data]) => ({
		name,
		global: true,
		kind: data.kind,
		description: data.description,
		...(data.values?.length ? { values: data.values } : {}),
		...(data.type.includes('list') ? { tokens: true } : {}),
		...(data.deprecated ? { deprecated: true } : {}),
		...(data.experimental ? { experimental: true } : {}),
	}))
}

let svgNames: ReadonlyMap<string, string> | undefined

/**
 * The key of a tag in the source: an SVG element keeps its case (`linearGradient`, also written
 * `lineargradient`) and its prefix; any other tag is lowercase, as HTML reads it.
 */
function sourceKey(tag: string): string {
	svgNames ??= new Map(svgTagNames().map((name) => [name.toLowerCase(), name]))
	const plain = plainTagName(tag)
	const lower = plain.toLowerCase()
	if (tag.startsWith(svgTagPrefix)) return `${svgTagPrefix}${svgNames.get(lower) ?? plain}`
	const named = svgNames.get(lower)
	return named !== undefined && isSvgTag(named) ? named : lower
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
			const key = sourceKey(tag)
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
 * Tipo, como texto, de la expresión de `bind:attr` para un atributo, el mismo que comprueba
 * `meeko check`: `boolean` para un atributo booleano; la unión de sus valores cuando son los únicos
 * válidos (hasta ocho; con más, `string`), con `boolean` si `"true"` y `"false"` están entre ellos;
 * `string | number` para un número o un `aria-*`, y `string` en los demás. Todos acaban en
 * `| null | undefined`, que omiten cualquier atributo.
 *
 * @example
 * attributeValueType({ name: "popovertargetaction", kind: "enum", values: ["toggle", "show", "hide"], global: false })
 * // "'toggle' | 'show' | 'hide' | null | undefined"
 */
export function attributeValueType(attribute: HtmlAttributeInfo): string {
	const kind = attribute.kind ?? (attribute.boolean ? 'boolean' : closedValues(attribute) ? 'enum' : 'text')
	return attributeTypeText(attribute.name, { kind, ...(attribute.values ? { values: attribute.values } : {}), ...(attribute.prefixes ? { prefixes: attribute.prefixes } : {}) })
}
