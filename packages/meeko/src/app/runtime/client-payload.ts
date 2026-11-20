import type { PageHead, PageRender } from '../definitions/define-page'
import type { PayloadDeferred } from './client-deferred'

import { PAYLOAD_VERSION, payloadHead } from '../definitions/define-page'
import { isRecord, readDeferredEntries } from './client-deferred'

export interface HydrationPayload {
	/** Empty in an application error page payload (`error: true`), which has no route. */
	route: string
	/** The payload renders `app/error.meeko` for a URL without a route; props are `{ status, message }`. */
	error: boolean
	render: PageRender
	props: Record<string, unknown>
	state: Record<string, unknown>
	sharedState: Record<string, unknown>
	head: PageHead
	deferred: readonly PayloadDeferred[]
	/** Data of the top-level data awaits that the server rendered, by request key. */
	resources: Record<string, unknown>
	/** Data keys that the page's loader declared with `depends`: an invalidation of one reruns it. */
	keys: readonly string[]
	/** Props the named layout rendered with, when the page has one. */
	layoutProps: Record<string, unknown> | undefined
	/**
	 * The URL the server rendered (path and query), when the payload says it. A prerendered page or
	 * the `404.html` of a static host may be served under another URL.
	 */
	url: string | undefined
	/**
	 * The identity of each `documentHtml` value that this document's payload replaced by a
	 * placeholder, by the position the placeholder names.
	 */
	documentHtml: readonly string[]
	/**
	 * The values of a navigation response that the server declares marked with `documentHtml`: where
	 * this payload has each one, by identity. Nothing else may be inserted in place of a placeholder.
	 */
	markedHtml: Readonly<Record<string, readonly (string | number)[]>>
}

function readDocumentHtmlIdentities(value: unknown): readonly string[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || !value.every((identity) => typeof identity === 'string')) throw new TypeError('Invalid Meeko document HTML identities')
	return value as string[]
}

function readMarkedHtml(value: unknown): HydrationPayload['markedHtml'] {
	if (value === undefined) return {}
	if (!isRecord(value) || !Object.values(value).every((path) => Array.isArray(path) && path.every((key) => typeof key === 'string' || typeof key === 'number'))) {
		throw new TypeError('Invalid Meeko marked HTML paths')
	}
	return value as HydrationPayload['markedHtml']
}

const pageRenders: readonly string[] = ['ssr', 'stream', 'prerender', 'client'] satisfies readonly PageRender[]

export function readPayload(value: unknown): HydrationPayload {
	const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
	if (isRecord(parsed) && parsed.v !== PAYLOAD_VERSION) {
		throw new TypeError(`Unsupported Meeko payload version ${String(parsed.v)}; the server and browser bundles must come from the same build`)
	}
	const error = isRecord(parsed) && parsed.error === true
	if (!isRecord(parsed) || (!error && typeof parsed.route !== 'string') || !isRecord(parsed.props) || !isRecord(parsed.state)) {
		throw new TypeError('Invalid Meeko hydration payload')
	}
	if (error) {
		if (typeof parsed.props.status !== 'number' || !Number.isInteger(parsed.props.status) || typeof parsed.props.message !== 'string') {
			throw new TypeError('Invalid Meeko error page props')
		}
	} else if (!isRecord(parsed.props.params) || !isRecord(parsed.props.search)) throw new TypeError('Invalid Meeko route props')
	if (parsed.sharedState !== undefined && !isRecord(parsed.sharedState)) throw new TypeError('Invalid Meeko shared state')
	if (parsed.resources !== undefined && !isRecord(parsed.resources)) throw new TypeError('Invalid Meeko page data')
	if (parsed.layoutProps !== undefined && !isRecord(parsed.layoutProps)) throw new TypeError('Invalid Meeko layout props')
	if (parsed.keys !== undefined && !(Array.isArray(parsed.keys) && parsed.keys.every((key) => typeof key === 'string'))) throw new TypeError('Invalid Meeko data keys')
	// A path and its query, as the server saw them: never another origin nor a fragment.
	if (parsed.url !== undefined && (typeof parsed.url !== 'string' || !parsed.url.startsWith('/') || parsed.url.includes('#'))) {
		throw new TypeError('Invalid Meeko payload URL')
	}
	const render = parsed.render ?? 'ssr'
	if (typeof render !== 'string' || !pageRenders.includes(render) || (error && render !== 'ssr')) throw new TypeError('Invalid Meeko page render mode')
	let head: PageHead
	try {
		head = payloadHead((parsed.head ?? {}) as PageHead)
	} catch (cause) {
		throw new TypeError('Invalid Meeko page head', { cause })
	}
	return {
		route: error ? '' : (parsed.route as string),
		error,
		render: render as PageRender,
		props: parsed.props,
		state: parsed.state,
		sharedState: parsed.sharedState ?? {},
		head,
		deferred: readDeferredEntries(parsed.deferred),
		resources: (parsed.resources as Record<string, unknown> | undefined) ?? {},
		keys: (parsed.keys as string[] | undefined) ?? [],
		layoutProps: parsed.layoutProps as Record<string, unknown> | undefined,
		url: parsed.url as string | undefined,
		documentHtml: readDocumentHtmlIdentities(parsed.documentHtml),
		markedHtml: readMarkedHtml(parsed.markedHtml),
	}
}

/**
 * Raíz y payload de hidratación que el servidor escribe en un documento Meeko.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * import { readHydrationDocument, type HydrationDocument } from "@meekojs/meeko/framework";
 *
 * const hydration: HydrationDocument = readHydrationDocument(document);
 * console.log(hydration.root.id, JSON.parse(hydration.payload).route);
 * ```
 */
export interface HydrationDocument {
	/** El `<div id="app">` hijo directo de `<body>` con la página renderizada. */
	readonly root: Element
	/** El texto JSON del `<script type="application/json" id="meeko-payload">` hijo directo de `<body>`. */
	readonly payload: string
}

/**
 * Localiza la raíz `#app` y el payload `#meeko-payload` que escribió el servidor, sin confundirlos
 * con elementos de la página que repitan esos `id`, como el HTML de usuario saneado, que conserva
 * los `id`. `document.getElementById` devuelve el primero del documento, que puede estar dentro de
 * la página. Aquí sólo cuentan los hijos directos de `<body>`: la raíz es el primer `<div id="app">`
 * y el payload, el último `<script type="application/json" id="meeko-payload">` posterior a ella. El
 * servidor escribe ambos alrededor de la página y de sus teleports, y tras el payload sólo van sus
 * propios scripts.
 *
 * @param document Documento servido por Meeko.
 * @returns La raíz y el texto del payload, para `mountClientApp`.
 * @throws {Error} Si falta la raíz o el payload.
 * @since 1.10.0
 * @example
 * ```ts
 * import { mountClientApp, readHydrationDocument } from "@meekojs/meeko/framework";
 *
 * const { root, payload } = readHydrationDocument(document);
 * await mountClientApp({ root, payload, routes, loadPage: (file) => import(`./pages/${file}`) });
 * ```
 */
export function readHydrationDocument(document: Document): HydrationDocument {
	let root: Element | undefined
	let payload: Element | undefined
	for (let element = document.body?.firstElementChild ?? null; element; element = element.nextElementSibling) {
		// `tagName` is uppercase only for HTML elements: an SVG or MathML element with that id does not count.
		if (element.tagName === 'DIV' && element.id === 'app') root ??= element
		else if (root && element.tagName === 'SCRIPT' && element.id === 'meeko-payload' && element.getAttribute('type') === 'application/json') payload = element
	}
	const text = payload?.textContent
	if (!root || !text) throw new Error('Missing Meeko SSR data')
	return { root, payload: text }
}
