/**
 * HTML data of Meeko (elements, attributes with their values, ARIA and event handlers), generated
 * from the specifications instead of written by hand.
 *
 * Sources, and what each one gives:
 * - WHATWG HTML Living Standard (one page): the indices of elements, attributes and event handler
 *   attributes, the void elements and the enumerated values (`attr-value` definitions).
 * - WAI-ARIA 1.3 (editor's draft), DPUB-ARIA and Graphics ARIA: states and properties with their
 *   values, and the roles.
 * - Referrer Policy: the values of `referrerpolicy`.
 * - `@mdn/browser-compat-data` (devDependency): whether an element or attribute is experimental or
 *   deprecated, and the standard-track attributes of other specifications (`part`, `exportparts`…).
 * - `scripts/html-data/meeko-1.7.json`: what Meeko accepted before these data, written from MDN.
 *   Whatever is no longer in a specification stays accepted and is marked deprecated.
 *
 * The specifications are fetched once into the snapshots of `scripts/html-data/` (committed), so
 * generating is offline and reproducible: `pnpm run html-data` fetches them again and rewrites
 * `src/shared/html-data/`; `--offline` only regenerates from the snapshots. `tests/html-data.test.ts`
 * fails when a generated module is out of date.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type DefaultTreeAdapterMap, parse } from 'parse5'
import { format } from 'prettier'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const snapshotDir = join(packageRoot, 'scripts/html-data')

/** Pages read by `--fetch`, by key. `--source-dir` reads `<key>.html` from a folder instead. */
export const sourceUrls = {
	html: 'https://html.spec.whatwg.org/',
	aria: 'https://w3c.github.io/aria/',
	'dpub-aria': 'https://w3c.github.io/dpub-aria/',
	'graphics-aria': 'https://w3c.github.io/graphics-aria/',
	'referrer-policy': 'https://w3c.github.io/webappsec-referrer-policy/',
} as const

type SourceKey = keyof typeof sourceUrls

// ---------------------------------------------------------------------------------------------
// Snapshots

/** One row of the WHATWG attribute index for one element (`*` for the global attributes). */
export interface WhatwgAttribute {
	readonly name: string
	readonly element: string
	readonly description: string
	/** The value column as text, such as `Valid non-negative integer`. */
	readonly value: string
	readonly boolean: boolean
	/** Keywords written in the value column (`"any"; "closerequest"; "none"`), `""` for the empty string. */
	readonly keywords: readonly string[]
	/** Fragment of the definition in the specification. */
	readonly anchor: string
}

/** What `scripts/html-data/whatwg-html.json` holds. */
export interface WhatwgSnapshot {
	readonly source: string
	readonly commit: string
	readonly date: string
	readonly elements: ReadonlyArray<{ readonly name: string; readonly description: string; readonly categories: readonly string[]; readonly interface: string; readonly anchor: string }>
	readonly voidElements: readonly string[]
	readonly attributes: readonly WhatwgAttribute[]
	/** Keywords of the `attr-value` definitions, by `element/attribute` (`html-global/…` for the global ones). */
	readonly attributeValues: Readonly<Record<string, readonly string[]>>
	readonly eventHandlers: ReadonlyArray<{ readonly name: string; readonly element: string }>
	readonly referrerPolicy: { readonly source: string; readonly values: readonly string[] }
}

/** A state or property of WAI-ARIA. */
export interface AriaAttribute {
	readonly name: string
	readonly description: string
	/** Value type, such as `true/false`, `token` or `ID reference list`. */
	readonly type: string
	readonly values: readonly string[]
	readonly deprecated: boolean
}

/** What `scripts/html-data/wai-aria.json` holds. */
export interface AriaSnapshot {
	readonly sources: ReadonlyArray<{ readonly url: string; readonly date: string }>
	readonly attributes: readonly AriaAttribute[]
	readonly roles: ReadonlyArray<{ readonly name: string; readonly description: string; readonly abstract: boolean; readonly deprecated: boolean }>
}

/** What `scripts/html-data/meeko-1.7.json` holds: the attributes Meeko 1.7 accepted. */
export interface LegacySnapshot {
	readonly source: string
	readonly globalAttributes: readonly string[]
	readonly elements: Readonly<Record<string, readonly string[]>>
	readonly booleanAttributes: readonly string[]
}

// ---------------------------------------------------------------------------------------------
// HTML helpers

function isElement(node: Node): node is Element {
	return 'tagName' in node
}

function* descendants(node: Node): Generator<Element> {
	if (!('childNodes' in node)) return
	for (const child of node.childNodes) {
		if (!isElement(child)) continue
		yield child
		yield* descendants(child)
	}
	if (isElement(node) && node.tagName === 'template') yield* descendants((node as DefaultTreeAdapterMap['template']).content)
}

function attribute(element: Element, name: string): string | undefined {
	return element.attrs.find((item) => item.name === name)?.value
}

function hasClass(element: Element, name: string): boolean {
	return (attribute(element, 'class') ?? '').split(/\s+/).includes(name)
}

function textOf(node: Node): string {
	if (node.nodeName === '#text') return (node as DefaultTreeAdapterMap['textNode']).value
	return 'childNodes' in node ? node.childNodes.map(textOf).join('') : ''
}

function clean(text: string): string {
	return text.replace(/\s+/g, ' ').trim()
}

function childElements(element: Element, tag?: string): Element[] {
	return element.childNodes.filter(isElement).filter((child) => !tag || child.tagName === tag)
}

function find(root: Node, test: (element: Element) => boolean): Element | undefined {
	for (const element of descendants(root)) if (test(element)) return element
	return undefined
}

function findAll(root: Node, test: (element: Element) => boolean): Element[] {
	return [...descendants(root)].filter(test)
}

/** Rows of a table body, each one as its cells. */
function rows(table: Element): Element[][] {
	return findAll(table, (element) => element.tagName === 'tr' && element.parentNode !== null && isElement(element.parentNode) && element.parentNode.tagName === 'tbody').map((row) => childElements(row).filter((cell) => cell.tagName === 'td' || cell.tagName === 'th'))
}

function codes(cell: Element): string[] {
	return findAll(cell, (element) => element.tagName === 'code').map((code) => clean(textOf(code)))
}

function fragment(href: string | undefined): string {
	return href?.split('#')[1] ?? ''
}

// ---------------------------------------------------------------------------------------------
// Extraction

/** The WHATWG snapshot from the one-page HTML standard and the Referrer Policy specification. */
export function extractWhatwg(html: string, referrerPolicy: string): WhatwgSnapshot {
	const document = parse(html)
	const commit = /\/commit-snapshots\/([0-9a-f]{40})\//.exec(html)?.[1] ?? ''
	const date = clean(textOf(find(document, (element) => hasClass(element, 'pubdate')) ?? document))
	const table = (test: (element: Element) => boolean): Element => {
		const found = find(document, (element) => element.tagName === 'table' && test(element))
		if (!found) throw new Error('html-data: a table of the HTML standard is missing')
		return found
	}
	const caption = (text: string) => (element: Element) => childElements(element, 'caption').some((item) => clean(textOf(item)) === text)

	const elements: Array<WhatwgSnapshot['elements'][number]> = []
	for (const [head, description, categories, , , , face] of rows(table(caption('List of elements')))) {
		if (!head || !description || !categories || !face) continue
		const label = clean(textOf(head))
		if (/^(MathML|SVG)\b|custom elements/.test(label)) continue
		for (const code of findAll(head, (element) => element.tagName === 'code')) {
			const link = find(code, (element) => element.tagName === 'a')
			elements.push({
				name: clean(textOf(code)),
				description: clean(textOf(description)),
				categories: [...new Set(findAll(categories, (element) => element.tagName === 'a').map((link) => clean(textOf(link))))],
				interface: codes(face)[0] ?? '',
				anchor: fragment(link && attribute(link, 'href')),
			})
		}
	}

	const voidTerm = find(document, (element) => element.tagName === 'dfn' && attribute(element, 'id') === 'void-elements')
	const voidDetails = voidTerm?.parentNode && isElement(voidTerm.parentNode) ? nextElement(voidTerm.parentNode) : undefined
	if (!voidDetails) throw new Error('html-data: the list of void elements is missing')
	const voidElements = codes(voidDetails)

	const attributes: WhatwgAttribute[] = []
	for (const [head, owners, description, value] of rows(table((element) => attribute(element, 'id') === 'attributes-1'))) {
		if (!head || !owners || !description || !value) continue
		const name = clean(textOf(head))
		const valueText = clean(textOf(value))
		// Quoted keywords, but not the ones of a condition such as `for rel="preload"`.
		const keywords = [...valueText.matchAll(/(?<![=\w])"([^"]*)"/g)].map((match) => match[1]!)
		if (/the empty string/.test(valueText)) keywords.push('')
		const row = { name, description: clean(textOf(description)), value: valueText, boolean: /Boolean attribute/.test(valueText), keywords }
		const links = findAll(owners, (element) => element.tagName === 'a')
		for (const link of links) {
			const label = clean(textOf(link))
			const element = label === 'HTML elements' ? '*' : link.parentNode && isElement(link.parentNode) && link.parentNode.tagName === 'code' ? label : undefined
			if (element) attributes.push({ ...row, element, anchor: fragment(attribute(link, 'href')) })
		}
	}

	const attributeValues: Record<string, string[]> = {}
	for (const definition of findAll(document, (element) => element.tagName === 'dfn' && attribute(element, 'data-dfn-type') === 'attr-value')) {
		const code = find(definition, (element) => element.tagName === 'code')
		if (!code) continue
		const keyword = clean(textOf(code))
		for (const owner of (attribute(definition, 'data-dfn-for') ?? '').split(',')) {
			if (!owner) continue
			const list = (attributeValues[owner] ??= [])
			if (!list.includes(keyword)) list.push(keyword)
		}
	}

	const eventHandlers: Array<WhatwgSnapshot['eventHandlers'][number]> = []
	for (const [head, owners] of rows(table((element) => attribute(element, 'id') === 'ix-event-handlers'))) {
		if (!head || !owners) continue
		const name = clean(textOf(head))
		const label = clean(textOf(owners))
		const elements = label.includes('HTML elements') ? ['*'] : codes(owners)
		for (const element of elements) eventHandlers.push({ name, element })
	}

	const policy = /enum ReferrerPolicy \{([^}]*)\}/.exec(clean(textOf(parse(referrerPolicy))))
	if (!policy) throw new Error('html-data: enum ReferrerPolicy is missing from the Referrer Policy specification')
	const referrer = { source: sourceUrls['referrer-policy'], values: [...policy[1]!.matchAll(/"([^"]*)"/g)].map((match) => match[1]!) }

	return { source: sourceUrls.html, commit, date, elements, voidElements, attributes, attributeValues, eventHandlers, referrerPolicy: referrer }
}

function nextElement(element: Element): Element | undefined {
	const siblings = element.parentNode?.childNodes ?? []
	const index = siblings.indexOf(element)
	return siblings.slice(index + 1).find(isElement)
}

/** The rows of a characteristics table (`Value:`, `Is Abstract:`…), by heading. */
function characteristics(section: Element): Map<string, Element> {
	const result = new Map<string, Element>()
	for (const table of findAll(section, (element) => element.tagName === 'table' && childElements(element, 'caption').some((caption) => clean(textOf(caption)) === 'Characteristics:'))) {
		for (const [head, value] of rows(table)) if (head && value) result.set(clean(textOf(head)).replace(/:$/, ''), value)
	}
	return result
}

/** The first paragraph of a section, and whether it starts with a note like `[Deprecated in ARIA 1.1]`. */
function summary(section: Element): { readonly description: string; readonly deprecated: boolean } {
	const description = find(section, (element) => /-description$/.test(attribute(element, 'class') ?? ''))
	const paragraph = description && find(description, (element) => element.tagName === 'p')
	const text = clean(textOf(paragraph ?? section))
	const note = /^\[Deprecated[^\]]*\]\s*/.exec(text)
	return { description: note ? text.slice(note[0].length) : text, deprecated: hasClass(section, 'deprecated') || note !== null }
}

/** Values implied by an ARIA value type without a table of values. */
const ariaTypeValues: Readonly<Record<string, readonly string[]>> = {
	'true/false': ['false', 'true'],
	'true/false/undefined': ['false', 'true', 'undefined'],
	tristate: ['false', 'mixed', 'true'],
}

/** The ARIA snapshot from WAI-ARIA, DPUB-ARIA and Graphics ARIA. */
export function extractAria(pages: Readonly<Record<'aria' | 'dpub-aria' | 'graphics-aria', string>>): AriaSnapshot {
	const sources: Array<AriaSnapshot['sources'][number]> = []
	const attributes: AriaAttribute[] = []
	const roles: Array<AriaSnapshot['roles'][number]> = []
	for (const key of ['aria', 'dpub-aria', 'graphics-aria'] as const) {
		const document = parse(pages[key])
		const published = find(document, (element) => element.tagName === 'time' && hasClass(element, 'dt-published'))
		sources.push({ url: sourceUrls[key], date: published ? (attribute(published, 'datetime') ?? '') : '' })
		for (const section of findAll(document, (element) => element.tagName === 'section')) {
			const id = attribute(section, 'id') ?? ''
			if (hasClass(section, 'role')) {
				const abstract = clean(textOf(characteristics(section).get('Is Abstract') ?? section)) === 'True'
				roles.push({ name: id, ...summary(section), abstract })
			} else if ((hasClass(section, 'state') || hasClass(section, 'property')) && id.startsWith('aria-')) {
				const type = clean(textOf(characteristics(section).get('Value') ?? section))
				const table = find(section, (element) => element.tagName === 'table' && childElements(element, 'caption').some((caption) => clean(textOf(caption)) === 'Values:'))
				const listed = table ? findAll(table, (element) => hasClass(element, 'value-name')).map((cell) => clean(textOf(cell)).replace(/\s*\(default\):?$/, '')) : []
				attributes.push({ name: id, ...summary(section), type, values: listed.length ? listed : (ariaTypeValues[type] ?? []) })
			}
		}
	}
	return { sources, attributes: attributes.sort(byName), roles: roles.sort(byName) }
}

function byName(first: { readonly name: string }, second: { readonly name: string }): number {
	return first.name < second.name ? -1 : first.name > second.name ? 1 : 0
}

// ---------------------------------------------------------------------------------------------
// Generation

/** Status of an element or attribute in `@mdn/browser-compat-data`. */
interface Status {
	readonly experimental?: boolean
	readonly deprecated?: boolean
	readonly standard_track?: boolean
}

interface CompatNode {
	readonly __compat?: { readonly status?: Status; readonly spec_url?: string | readonly string[] }
	readonly [key: string]: CompatNode | { readonly status?: Status } | undefined
}

interface CompatData {
	readonly html: { readonly elements: Readonly<Record<string, CompatNode>>; readonly global_attributes: Readonly<Record<string, CompatNode>> }
	readonly api: { readonly Element: CompatNode; readonly HTMLElement: CompatNode }
	readonly __meta: { readonly version: string }
}

/**
 * Meeko's rules on top of the data, for the attribute names that `bind="obj"` and `<component is>`
 * check: `is` is the directive of `<component>`, and `type` of `<a>` and `<area>` is only a MIME
 * hint, so that with `is="href ? 'a' : 'button'"` `bind:type` is the type of the button.
 */
const omittedNames: { readonly global: readonly string[]; readonly elements: Readonly<Record<string, readonly string[]>> } = { global: ['is'], elements: { a: ['type'], area: ['type'] } }

/**
 * Elements that `<component is>` refuses: the document and its metadata, scripts, embedded
 * documents, raw text and the elements that only work in a fixed place.
 */
const forbiddenComponentTags = ['base', 'body', 'embed', 'fencedframe', 'head', 'html', 'iframe', 'link', 'meta', 'noscript', 'object', 'param', 'script', 'slot', 'style', 'template', 'textarea', 'title']

/**
 * Proposals that browsers ship outside the standard track: `@mdn/browser-compat-data` lists them
 * as experimental on the elements and interfaces they apply to, and they stay marked so.
 */
const proposedAttributes: readonly string[] = ['interestfor']
const proposedEvents: readonly string[] = ['interest', 'loseinterest']

/** Data of one attribute in the generated modules. */
interface AttributeData {
	description?: string
	value?: string
	values?: string[]
	freeform?: true
	tokens?: true
	boolean?: true
	experimental?: true
	deprecated?: true
	spec?: string
}

/**
 * How the value syntax of the standard reads its keywords: `freeform` when other values are valid
 * too (`step`: a number or `"any"`), `tokens` for a set of space-separated keywords (`sandbox`).
 * Keywords taken from the `attr-value` definitions instead of the index are closed only for a
 * `… keyword` syntax (`input type keyword`).
 */
function valueShape(syntax: string, inline: boolean): Pick<AttributeData, 'freeform' | 'tokens'> {
	const tokens = /space-separated tokens|related tokens/.test(syntax)
	const rest = syntax
		.replace(/(?<![=\w])"[^"]*"/g, ' ')
		.replace(/the empty string|ASCII case-insensitive( match for)?|(Unordered|Ordered) set of unique space-separated tokens|consisting of/g, ' ')
		.replace(/[\s;,]+/g, ' ')
		.trim()
	const closed = inline ? rest === '' : /\bkeyword$/.test(syntax)
	return { ...(closed ? {} : { freeform: true as const }), ...(tokens ? { tokens: true as const } : {}) }
}

function compareNames(first: string, second: string): number {
	return first < second ? -1 : first > second ? 1 : 0
}

function sortedRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
	return Object.fromEntries([...entries].sort(([first], [second]) => compareNames(first, second)))
}

function statusOf(compat: CompatNode | undefined): Status {
	return compat?.__compat?.status ?? {}
}

function flags(status: Status): Pick<AttributeData, 'deprecated' | 'experimental'> {
	return { ...(status.experimental ? { experimental: true as const } : {}), ...(status.deprecated ? { deprecated: true as const } : {}) }
}

/** The modules of `src/shared/html-data/`, by path relative to the package, from the snapshots. */
export async function generateHtmlData(sources: { readonly whatwg: WhatwgSnapshot; readonly aria: AriaSnapshot; readonly legacy: LegacySnapshot; readonly compat: CompatData }): Promise<Record<string, string>> {
	const { whatwg, aria, legacy, compat } = sources
	const specUrl = (anchor: string) => (anchor ? `${whatwg.source}#${anchor}` : undefined)

	// Elements: the standard, the standard-track ones of other specifications, and Meeko 1.7's.
	const elements = new Map<string, { description?: string; categories?: string[]; interface?: string; void?: true; experimental?: true; deprecated?: true; spec?: string }>()
	for (const element of whatwg.elements) {
		elements.set(element.name, {
			description: element.description,
			categories: [...element.categories],
			...(element.interface ? { interface: element.interface } : {}),
			...(whatwg.voidElements.includes(element.name) ? { void: true as const } : {}),
			...flags(statusOf(compat.html.elements[element.name])),
			...(element.anchor ? { spec: specUrl(element.anchor)! } : {}),
		})
	}
	for (const [name, node] of Object.entries(compat.html.elements)) {
		const status = statusOf(node)
		if (elements.has(name) || !status.standard_track || status.deprecated) continue
		const spec = [node.__compat?.spec_url ?? []].flat()[0]
		elements.set(name, { ...flags(status), ...(spec ? { spec } : {}) })
	}
	for (const name of Object.keys(legacy.elements)) {
		if (elements.has(name)) continue
		const status = statusOf(compat.html.elements[name])
		elements.set(name, { ...(status.experimental ? { experimental: true as const } : {}), ...(status.standard_track && !status.deprecated ? {} : { deprecated: true as const }) })
	}

	// Attributes: the index of the standard, completed with the `attr-value` definitions.
	const global = new Map<string, AttributeData>()
	const own = new Map<string, Map<string, AttributeData>>([...elements.keys()].map((name) => [name, new Map()]))
	const merge = (target: Map<string, AttributeData>, name: string, data: AttributeData): void => {
		const previous = target.get(name)
		if (!previous) return void target.set(name, data)
		target.set(name, {
			...previous,
			...data,
			...(previous.description && data.description && previous.description !== data.description ? { description: `${previous.description}; ${data.description}` } : {}),
			...(previous.values || data.values ? { values: [...new Set([...(previous.values ?? []), ...(data.values ?? [])])] } : {}),
		})
	}
	for (const row of whatwg.attributes) {
		if (/^on/.test(row.name)) continue
		const definitions = whatwg.attributeValues[`${row.element === '*' ? 'html-global' : row.element}/${row.name}`] ?? (row.element === '*' ? undefined : whatwg.attributeValues[`html-global/${row.name}`])
		const inline = row.keywords.some((keyword) => keyword !== '')
		const values = row.boolean ? [] : inline ? [...row.keywords] : row.name === 'referrerpolicy' ? [...whatwg.referrerPolicy.values] : [...(definitions ?? [])].filter((value) => !value.endsWith('-'))
		// `referrerpolicy` takes exactly the values of the Referrer Policy specification.
		const shape = row.name === 'referrerpolicy' ? {} : values.length ? valueShape(row.value, inline) : {}
		const status = row.element === '*' ? statusOf(compat.html.global_attributes[row.name]) : statusOf(compat.html.elements[row.element]?.[row.name] as CompatNode | undefined)
		const data: AttributeData = {
			description: row.description,
			value: row.value,
			...(values.length ? { values, ...shape } : {}),
			...(row.boolean ? { boolean: true as const } : {}),
			...flags(status),
			...(row.anchor ? { spec: specUrl(row.anchor)! } : {}),
		}
		if (row.element === '*') merge(global, row.name, data)
		else if (own.has(row.element)) merge(own.get(row.element)!, row.name, data)
	}
	// Standard-track attributes of other specifications (not the obsolete ones), as
	// `@mdn/browser-compat-data` lists them.
	// Its keys with `_` are values (`type_checkbox`) or notes, not attributes.
	for (const [key, node] of Object.entries(compat.html.global_attributes)) {
		const name = key.toLowerCase()
		const status = statusOf(node)
		if (global.has(name) || name.includes('_') || !status.standard_track || status.deprecated) continue
		global.set(name, flags(status))
	}
	for (const [tag, attributes] of own) {
		for (const [key, node] of Object.entries(compat.html.elements[tag] ?? {})) {
			const name = key.toLowerCase()
			if (name === '__compat' || name.includes('_') || attributes.has(name) || global.has(name)) continue
			const status = statusOf(node as CompatNode)
			if ((status.standard_track || proposedAttributes.includes(name)) && !status.deprecated) attributes.set(name, flags(status))
		}
	}
	// `role` belongs to WAI-ARIA: a list of roles, the first one the user agent knows applies.
	global.set('role', { description: 'ARIA role of the element, and fallback roles after it', value: 'Unordered set of unique space-separated tokens', values: aria.roles.filter((role) => !role.abstract).map((role) => role.name), tokens: true, spec: 'https://w3c.github.io/aria/#host_general_role' })
	// What Meeko 1.7 accepted and no specification has any more: accepted still, deprecated.
	const legacyBoolean = new Set(legacy.booleanAttributes)
	const kept = (name: string): AttributeData => ({ ...(legacyBoolean.has(name) ? { boolean: true as const } : {}), deprecated: true })
	for (const name of legacy.globalAttributes) if (!global.has(name)) global.set(name, kept(name))
	for (const [tag, names] of Object.entries(legacy.elements)) {
		const attributes = own.get(tag)!
		for (const name of names) if (!attributes.has(name) && !global.has(name)) attributes.set(name, kept(name))
	}

	// ARIA: the states and properties, and the concrete roles.
	const ariaApi = new Map(
		Object.keys(compat.api.Element)
			.filter((key) => key.startsWith('aria'))
			.map((key) => [key.replace(/Elements?$/, '').toLowerCase(), key]),
	)
	const ariaAttributes = sortedRecord(
		aria.attributes.map((item) => {
			const api = ariaApi.get(item.name.replace(/-/g, ''))
			const status = api ? statusOf(compat.api.Element[api] as CompatNode) : {}
			return [item.name, { description: item.description, type: item.type, ...(item.values.length ? { values: [...item.values] } : {}), ...(status.experimental ? { experimental: true as const } : {}), ...(item.deprecated ? { deprecated: true as const } : {}) }] as const
		}),
	)
	const ariaRoles = sortedRecord(aria.roles.filter((role) => !role.abstract).map((role) => [role.name, { description: role.description, ...(role.deprecated ? { deprecated: true as const } : {}) }] as const))

	// Names for the runtime and the checks of the compiler.
	const tagNames = [...elements.keys()].sort(compareNames)
	const ownNames = (tag: string) =>
		[...own.get(tag)!.keys()]
			.filter((name) => !global.has(name) && !(omittedNames.elements[tag] ?? []).includes(name))
			.sort(compareNames)
			.join(' ')
	const booleanNames = new Set<string>()
	for (const [name, data] of global) if (data.boolean) booleanNames.add(name)
	for (const attributes of own.values()) for (const [name, data] of attributes) if (data.boolean) booleanNames.add(name)

	// Events an element dispatches, for `on:event`: the handlers of the standard and the events of
	// `Element` and `HTMLElement` in `@mdn/browser-compat-data` (pointer, animation, transition…).
	const elementEvents = new Set(whatwg.eventHandlers.filter((handler) => handler.element === '*').map((handler) => handler.name.replace(/^on/, '')))
	for (const face of [compat.api.Element, compat.api.HTMLElement]) {
		for (const [key, node] of Object.entries(face)) {
			const status = statusOf(node as CompatNode)
			const event = key.slice(0, -'_event'.length)
			if (key.endsWith('_event') && (status.standard_track || proposedEvents.includes(event)) && !status.deprecated) elementEvents.add(event)
		}
	}
	const handlers = new Map<string, Set<string>>()
	for (const handler of whatwg.eventHandlers) {
		const set = handlers.get(handler.element) ?? new Set()
		set.add(handler.name.replace(/^on/, ''))
		handlers.set(handler.element, set)
	}

	const header = (purpose: string) =>
		[
			`// Generated by scripts/html-data.ts (\`pnpm -F @meekojs/meeko html-data\`): do not edit.`,
			`// HTML Living Standard ${whatwg.date} (commit ${whatwg.commit.slice(0, 12)}), ${aria.sources.map((source) => `${source.url} ${source.date}`).join(', ')}, @mdn/browser-compat-data ${compat.__meta.version}.`,
			'',
			`/**\n * ${purpose}\n */`,
		].join('\n')
	const literal = (value: unknown): string => JSON.stringify(value, null, '\t')
	const words = (list: Iterable<string>) => [...list].sort(compareNames).join(' ')

	const tags = [
		header('HTML elements for the runtime: the ones `<component is>` accepts and the void ones. Lists of names\n * separated by spaces, so that a bundle that never checks a tag keeps only short strings.'),
		'',
		'/** Every HTML element of the data, the deprecated ones included. */',
		`export const htmlTagNames = ${literal(tagNames.join(' '))}`,
		'',
		'/** Elements without content (`void elements` of the standard): they have no end tag. */',
		`export const voidTagNames = ${literal(words(whatwg.voidElements))}`,
		'',
		'/** Elements that `<component is>` refuses: document metadata, scripts, embedded documents and raw text. */',
		`export const forbiddenComponentTagNames = ${literal(words(forbiddenComponentTags))}`,
		'',
		'/** Elements kept only for compatibility: obsolete or outside the standard. */',
		`export const deprecatedTagNames = ${literal(words(tagNames.filter((name) => elements.get(name)!.deprecated)))}`,
		'',
		'/** Experimental elements, according to `@mdn/browser-compat-data`. */',
		`export const experimentalTagNames = ${literal(words(tagNames.filter((name) => elements.get(name)!.experimental)))}`,
		'',
	].join('\n')

	const names = [
		header('Attribute names that each HTML element accepts, for `bind="obj"` and `<component is>`: lists separated\n * by spaces, without the event handlers (`on*`: Meeko writes `on:event`), `is` (the directive of\n * `<component>`) nor `type` of `<a>` and `<area>` (a MIME hint there).'),
		'',
		'/** Attributes that every HTML element accepts, besides `aria-*` and `data-*`. */',
		`export const globalAttributeNames = ${literal(words([...global.keys()].filter((name) => !omittedNames.global.includes(name))))}`,
		'',
		'/** Attributes of each HTML element, besides the global ones. */',
		`export const elementAttributeNames = ${literal(Object.fromEntries(tagNames.map((tag) => [tag, ownNames(tag)])))} as const`,
		'',
		'/** Boolean attributes: present when true, absent when false. */',
		`export const booleanAttributeNames = ${literal(words(booleanNames))}`,
		'',
	].join('\n')

	const details = [
		header('HTML elements and attributes in detail, for the compiler and the editor (not for the browser):\n * description, enumerated values, whether an attribute is boolean, and whether it is experimental\n * or deprecated. An attribute without `experimental` nor `deprecated` is standard; `value` is the\n * value syntax of the standard and `spec` the link to its definition.'),
		'',
		'/** Data of an HTML attribute. */',
		'export interface HtmlAttributeData {',
		'\treadonly description?: string',
		'\treadonly value?: string',
		'\treadonly values?: readonly string[]',
		'\t/** `values` are suggestions: other values are valid too. */',
		'\treadonly freeform?: true',
		'\t/** The value is a set of `values` separated by spaces. */',
		'\treadonly tokens?: true',
		'\treadonly boolean?: true',
		'\treadonly experimental?: true',
		'\treadonly deprecated?: true',
		'\treadonly spec?: string',
		'}',
		'',
		'/** Data of an HTML element. */',
		'export interface HtmlElementData {',
		'\treadonly description?: string',
		'\treadonly categories?: readonly string[]',
		'\treadonly interface?: string',
		'\treadonly void?: true',
		'\treadonly experimental?: true',
		'\treadonly deprecated?: true',
		'\treadonly spec?: string',
		'}',
		'',
		'/** HTML elements: description, content categories, DOM interface and status. */',
		`export const htmlElements = ${literal(Object.fromEntries(tagNames.map((tag) => [tag, elements.get(tag)])))} as const satisfies Readonly<Record<string, HtmlElementData>>`,
		'',
		'/** Attributes that every HTML element accepts. */',
		`export const htmlGlobalAttributes = ${literal(sortedRecord(global))} as const satisfies Readonly<Record<string, HtmlAttributeData>>`,
		'',
		'/** Own attributes of each HTML element. */',
		`export const htmlElementAttributes = ${literal(Object.fromEntries(tagNames.map((tag) => [tag, sortedRecord(own.get(tag)!)])))} as const satisfies Readonly<Record<string, Readonly<Record<string, HtmlAttributeData>>>>`,
		'',
	].join('\n')

	const ariaModule = [
		header('WAI-ARIA for the compiler and the editor: the `aria-*` states and properties with their value type and\n * values, and the roles that `role` accepts (abstract roles left out), with DPUB-ARIA and Graphics ARIA.'),
		'',
		'/** Data of an `aria-*` attribute. */',
		'export interface AriaAttributeData {',
		'\treadonly description: string',
		'\treadonly type: string',
		'\treadonly values?: readonly string[]',
		'\treadonly experimental?: true',
		'\treadonly deprecated?: true',
		'}',
		'',
		'/** The `aria-*` states and properties. */',
		`export const ariaAttributes = ${literal(ariaAttributes)} as const satisfies Readonly<Record<string, AriaAttributeData>>`,
		'',
		'/** Roles that `role` accepts. */',
		`export const ariaRoles = ${literal(ariaRoles)} as const satisfies Readonly<Record<string, { readonly description: string; readonly deprecated?: true }>>`,
		'',
	].join('\n')

	const events = [
		header('Event names without the `on` prefix, for `on:event` in the compiler and the editor.'),
		'',
		'/** Events with an event handler content attribute (`onclick`…): on every HTML element (`*`) and on `<body>` (the handlers of `Window`). */',
		`export const htmlEventNames = ${literal(sortedRecord([...handlers].map(([element, set]) => [element, words(set)] as const)))} as const`,
		'',
		'/** Every event an HTML element dispatches: the handlers of `*` and the standard events of `Element` and `HTMLElement` (pointer, animation, transition…). */',
		`export const elementEventNames = ${literal(words(elementEvents))}`,
		'',
	].join('\n')

	const options = { parser: 'typescript', printWidth: 800, semi: false, singleQuote: true, tabWidth: 2, useTabs: true } as const
	return {
		'src/shared/html-data/tags.ts': await format(tags, options),
		'src/shared/html-data/attribute-names.ts': await format(names, options),
		'src/shared/html-data/attributes.ts': await format(details, options),
		'src/shared/html-data/aria.ts': await format(ariaModule, options),
		'src/shared/html-data/events.ts': await format(events, options),
	}
}

// ---------------------------------------------------------------------------------------------
// Files

const snapshotFiles = { whatwg: 'whatwg-html.json', aria: 'wai-aria.json', legacy: 'meeko-1.7.json' } as const

/** The snapshots and `@mdn/browser-compat-data`, as {@link generateHtmlData} takes them. */
export async function readSources(): Promise<Parameters<typeof generateHtmlData>[0]> {
	const read = async <T>(name: string): Promise<T> => JSON.parse(await readFile(join(snapshotDir, name), 'utf8')) as T
	return {
		whatwg: await read<WhatwgSnapshot>(snapshotFiles.whatwg),
		aria: await read<AriaSnapshot>(snapshotFiles.aria),
		legacy: await read<LegacySnapshot>(snapshotFiles.legacy),
		compat: createRequire(import.meta.url)('@mdn/browser-compat-data') as CompatData,
	}
}

async function fetchPages(sourceDir?: string): Promise<Record<SourceKey, string>> {
	const entries = await Promise.all(
		(Object.keys(sourceUrls) as SourceKey[]).map(async (key) => {
			if (sourceDir) return [key, await readFile(join(sourceDir, `${key}.html`), 'utf8')] as const
			const response = await fetch(sourceUrls[key], { signal: AbortSignal.timeout(120_000) })
			if (!response.ok) throw new Error(`html-data: ${sourceUrls[key]} answered ${response.status}`)
			return [key, await response.text()] as const
		}),
	)
	return Object.fromEntries(entries) as Record<SourceKey, string>
}

async function writeJson(name: string, value: unknown): Promise<void> {
	await writeFile(join(snapshotDir, name), await format(JSON.stringify(value), { parser: 'json', printWidth: 800, useTabs: true }))
}

async function main(argv: readonly string[]): Promise<void> {
	if (!argv.includes('--offline')) {
		const sourceIndex = argv.indexOf('--source-dir')
		const pages = await fetchPages(sourceIndex >= 0 ? argv[sourceIndex + 1] : undefined)
		await writeJson(snapshotFiles.whatwg, extractWhatwg(pages.html, pages['referrer-policy']))
		await writeJson(snapshotFiles.aria, extractAria(pages))
	}
	const files = await generateHtmlData(await readSources())
	for (const [path, content] of Object.entries(files)) await writeFile(join(packageRoot, path), content)
	console.log(`html-data: ${Object.keys(files).length} modules written in src/shared/html-data/`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2))
