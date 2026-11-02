import type { ReadonlySignal } from '../../core/reactivity'
import type { DocumentConfig, HeadEntry, HeadInput, HeadSource, HeadTag, ResolvedSeo } from '../../shared/head'
import type { DocumentTheme, ThemeHead } from '../../shared/theme'
import type { ComponentRelease, DomScope } from './renderer'

import { createContext, createRoot, finishWithCleanup, provide } from '../../core/reactivity'
import { CONFIG_LEVEL, documentHeadInput, HEAD_END_MARKER, HEAD_START_MARKER, rawText, resolveHead, resolveSeo, ROUTE_LEVEL } from '../../shared/head'
import { withThemeAttributes } from '../../shared/theme'
import { applyColorScheme, applyThemeClass } from './theme-dom'

export interface LiveEntry {
	level: number
	order: number
	input: HeadInput | undefined
}

export interface HeadManager {
	readonly live: boolean
	add(level: number, read: () => HeadInput): void
	register?(level: number): LiveEntry
	update?(entry: LiveEntry, input: HeadInput | undefined): void
	remove?(entry: LiveEntry): void
}

// Pure: a component that only imports the runtime (no framework) leaves them out of its bundle.
export const headManagerKey = /*#__PURE__*/ createContext<HeadManager>('Meeko head')
export const headLevelKey = /*#__PURE__*/ createContext<number>('Meeko head level')

/** Makes a head manager available to the component tree of the active root. */
export function provideHead(manager: HeadManager): void {
	provide(headManagerKey, manager as HeadManager)
}

/**
 * Wraps a page, layout or `app.meeko` module so that the components it renders register their
 * head entries at `level`: `app.meeko` is 0, each layout one more and the page the deepest.
 */
export function withHeadLevel<M extends { renderWithState?: unknown; renderToString?: unknown; hydrateScope?: unknown }>(module: M, level: number): M {
	const scoped = <T>(work: () => T): T =>
		createRoot((dispose) => {
			provide(headLevelKey, level)
			return finishWithCleanup(work, dispose)
		})
	const source = module as unknown as {
		renderWithState?: (props: Record<string, unknown>) => { html: string; state: Record<string, unknown> }
		renderToString?: (props: Record<string, unknown>, state?: Record<string, unknown>) => string
		hydrateScope?: (scope: DomScope, props: Record<string, unknown>, state?: Record<string, unknown>) => ComponentRelease
	}
	const wrapped: Record<string, unknown> = { ...module }
	if (source.renderWithState) wrapped.renderWithState = (props: Record<string, unknown>) => scoped(() => source.renderWithState!(props))
	if (source.renderToString) wrapped.renderToString = (props: Record<string, unknown>, state?: Record<string, unknown>) => scoped(() => source.renderToString!(props, state))
	if (source.hydrateScope) {
		wrapped.hydrateScope = (scope: DomScope, props: Record<string, unknown>, state?: Record<string, unknown>): ComponentRelease =>
			createRoot((dispose) => {
				provide(headLevelKey, level)
				const release = source.hydrateScope!(scope, props, state)
				const result: ComponentRelease = () => finishWithCleanup(release, dispose)
				if (release.snapshot) result.snapshot = release.snapshot
				return 'exposed' in release ? Object.assign(result, { exposed: release.exposed }) : result
			})
	}
	return wrapped as M
}

/** Receives `useHead` of the top-level `<script server>` code of a page; set by the server handler. */
export let pageHeadSink: ((read: () => HeadInput) => boolean) | undefined

/** @internal The page body module routes `useHead` in top-level server code to its request. */
export function providePageHeadSink(sink: (read: () => HeadInput) => boolean): void {
	pageHeadSink = sink
}

export function reader<T>(source: HeadSource<T>): () => T {
	if (typeof source === 'function') return source as () => T
	if (typeof source === 'object' && source !== null && 'value' in source) return () => (source as ReadonlySignal<T>).value
	return () => source as T
}

/** Whether `element` already shows `tag`: the same name, attributes and text. */
function sameElement(element: Element, tag: HeadTag): boolean {
	if (element.localName !== tag.tag) return false
	for (const [name, value] of tag.attributes) {
		const current = element.getAttribute(name)
		if (value === true ? current === null : current !== value) return false
	}
	for (const attribute of [...element.attributes]) {
		if (attribute.name !== 'nonce' && !tag.attributes.some(([name]) => name === attribute.name)) return false
	}
	if (tag.tag === 'meta' || tag.tag === 'link') return true
	// SSR wrote the escaped text; an element created in the browser holds the code as given.
	const text = element.textContent
	return text === (tag.children ?? '') || text === rawText(tag)
}

function comment(node: Node, data: string): boolean {
	return node.nodeType === 8 && (node as Comment).data === data
}

/**
 * The head of a browser application. It adopts the tags that SSR wrote between the head markers,
 * keeps them in sync with the mounted entries and restores what an entry replaced once it leaves.
 */
export class BrowserHead implements ThemeHead {
	readonly live = true
	/** The theme of `<html>`, from the application's `BrowserTheme`. */
	private theme: DocumentTheme | undefined
	private readonly entries = new Set<LiveEntry>()
	private readonly config: LiveEntry
	private readonly route: LiveEntry = { level: ROUTE_LEVEL, order: 0, input: undefined }
	private errorTitle: HeadEntry | undefined
	private order = 0
	private holds = 0
	private dirty = false
	private disposed = false
	private adopted = false
	private start: Comment | undefined
	private end: Comment | undefined
	private readonly elements = new Map<string, Element>()
	private readonly attributeOwners = new Map<Element, Map<string, string | null>>()
	private readonly defaultTitle: string
	private readonly nonce: string | undefined
	private readonly seo: ResolvedSeo | undefined
	/** Pathname of the committed page for `document.seo`; `undefined` on an error page. */
	private pathname: string | undefined

	constructor(
		private readonly document: Document,
		config: DocumentConfig | undefined,
	) {
		this.config = { level: CONFIG_LEVEL, order: 0, input: documentHeadInput(config) }
		this.seo = resolveSeo(config?.seo, 'document.seo')
		const head = document.head
		if (head) {
			for (const node of [...head.childNodes]) {
				if (comment(node, HEAD_START_MARKER)) this.start ??= node as Comment
				else if (comment(node, HEAD_END_MARKER) && this.start) this.end ??= node as Comment
			}
		}
		// The host's title outside the markers is what a page without a title shows.
		const titles = [...(document.head?.querySelectorAll('title') ?? [])]
		const host = titles.find((title) => !this.inside(title))
		this.defaultTitle = (host?.textContent ?? '').replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '')
		const script = document.querySelector<HTMLScriptElement>('script[nonce]')
		this.nonce = script ? script.nonce || script.getAttribute('nonce') || undefined : undefined
	}

	private inside(node: Node): boolean {
		if (!this.start || !this.end) return false
		for (let current = this.start.nextSibling; current && current !== this.end; current = current.nextSibling) if (current === node) return true
		return false
	}

	add(): void {
		throw new Error('A browser head registers live entries')
	}

	register(level: number): LiveEntry {
		const entry: LiveEntry = { level, order: ++this.order, input: undefined }
		this.entries.add(entry)
		return entry
	}

	update(entry: LiveEntry, input: HeadInput | undefined): void {
		entry.input = input
		if (this.entries.has(entry)) this.changed()
	}

	remove(entry: LiveEntry): void {
		if (this.entries.delete(entry)) this.changed()
	}

	/**
	 * Replaces the route head: the payload or the client route `head` of the committed page, and
	 * its pathname for `document.seo` (`undefined` on an error page), whose default title is
	 * `errorTitle`.
	 */
	setRoute(input: HeadInput | undefined, pathname?: string, errorTitle?: HeadEntry): void {
		this.route.input = input
		this.pathname = pathname
		this.errorTitle = errorTitle
		this.changed()
	}

	/**
	 * Replaces the theme attributes of `<html>`. Before hydration adopts the SSR head nothing is
	 * written: the inline script already applied the same theme, and the first flush keeps it.
	 */
	setTheme(theme: DocumentTheme | undefined): void {
		this.theme = theme
		if (this.adopted) this.changed()
	}

	/** Runs `work` with updates deferred until it finishes, then applies them once. */
	hold<T>(work: () => T): T {
		this.holds++
		let completed = false
		try {
			const result = work()
			completed = true
			return result
		} finally {
			this.holds--
			// A failed hydration leaves the SSR head untouched; a failed navigation shows what stays mounted.
			if (this.holds === 0 && this.dirty && (completed || this.adopted)) this.flush()
		}
	}

	/** Stops updating the document; a disposed application leaves its head as it is. */
	dispose(): void {
		this.disposed = true
	}

	private changed(): void {
		this.dirty = true
		if (this.holds === 0) this.flush()
	}

	private flush(): void {
		this.dirty = false
		if (this.disposed) return
		const resolved = resolveHead([this.config, ...this.entries, ...(this.errorTitle ? [this.errorTitle] : []), this.route], { seo: this.seo, pathname: this.pathname })
		const document = this.document
		const title = resolved.title ?? this.defaultTitle
		if (document.title !== title) document.title = title
		this.syncAttributes(document.documentElement, withThemeAttributes(resolved.htmlAttrs, this.theme, true))
		// After the attributes: a `class` of htmlAttrs replaces the attribute and its theme class, and
		// a `style` the attribute and its color-scheme.
		applyThemeClass(document.documentElement, this.theme)
		applyColorScheme(document.documentElement, this.theme)
		if (document.body) this.syncAttributes(document.body, resolved.bodyAttrs)
		this.syncTags(resolved.tags)
		this.adopted = true
	}

	private syncAttributes(element: Element, desired: ReadonlyMap<string, string>): void {
		let owned = this.attributeOwners.get(element)
		if (!owned) this.attributeOwners.set(element, (owned = new Map()))
		for (const [name, previous] of owned) {
			if (desired.has(name)) continue
			if (previous === null) element.removeAttribute(name)
			else element.setAttribute(name, previous)
			owned.delete(name)
		}
		for (const [name, value] of desired) {
			// SSR wrote the attributes of the first resolution; one added later restores what it replaced.
			if (!owned.has(name)) owned.set(name, this.adopted ? element.getAttribute(name) : null)
			if (element.getAttribute(name) !== value) element.setAttribute(name, value)
		}
	}

	private markers(): Comment {
		if (!this.start || !this.end) {
			const head = this.document.head ?? this.document.documentElement
			this.start = this.document.createComment(HEAD_START_MARKER)
			this.end = this.document.createComment(HEAD_END_MARKER)
			head.append(this.start, this.end)
		}
		return this.end
	}

	private create(tag: HeadTag): Element {
		const element = this.document.createElement(tag.tag)
		for (const [name, value] of tag.attributes) element.setAttribute(name, value === true ? '' : value)
		if (this.nonce && (tag.tag === 'script' || tag.tag === 'style')) element.setAttribute('nonce', this.nonce)
		if (tag.children !== undefined) element.textContent = tag.children
		return element
	}

	private syncTags(tags: readonly HeadTag[]): void {
		const end = this.markers()
		if (!this.adopted) {
			// Hydration: claim the tags SSR wrote; the default ones sit before the markers.
			const managed: Element[] = []
			for (let node = this.start!.nextSibling; node && node !== end; node = node.nextSibling) {
				if (node.nodeType === 1 && (node as Element).localName !== 'title') managed.push(node as Element)
			}
			const head = this.document.head
			const fallbacks = head ? [...head.children].filter((element) => !managed.includes(element) && !this.inside(element)) : []
			for (const tag of tags) {
				const pool = tag.fallback ? fallbacks : managed
				const index = pool.findIndex((element) => sameElement(element, tag))
				if (index < 0) continue
				this.elements.set(tag.key, pool[index]!)
				pool.splice(index, 1)
			}
			// What SSR managed and this resolution does not want is stale.
			for (const element of managed) element.remove()
		}
		const wanted = new Set(tags.map((tag) => tag.key))
		for (const [key, element] of this.elements) {
			if (wanted.has(key)) continue
			element.remove()
			this.elements.delete(key)
		}
		for (const tag of tags) {
			const current = this.elements.get(tag.key)
			if (current && sameElement(current, tag)) continue
			const element = this.create(tag)
			// A changed script is a new element, so the browser runs it.
			if (current) current.replaceWith(element)
			else end.parentNode!.insertBefore(element, end)
			this.elements.set(tag.key, element)
		}
	}
}
