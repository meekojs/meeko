import type { UILinkTarget } from '../types/navigation'

/** What a link needs to tell whether it is the current page. */
interface CurrentCandidate {
	readonly href?: string | undefined
	readonly to?: string | undefined
	readonly current?: boolean | undefined
	readonly aliases?: readonly string[] | undefined
}

/** An explicit `current` wins; otherwise the link is current when its `href`, its `to` or an alias is the given path. */
export function isCurrentLink(item: CurrentCandidate, current: string | undefined): boolean {
	if (item.current !== undefined) return item.current
	if (current === undefined) return false
	return item.href === current || item.to === current || (item.aliases?.includes(current) ?? false)
}

/** The destination of an item and its own `current` flag, without the props that are not attributes of the link. */
export function linkTarget<Item extends UILinkTarget & { readonly current?: boolean | undefined }>(item: Item): UILinkTarget & { readonly current?: boolean | undefined } {
	return { href: item.href, to: item.to, params: item.params, search: item.search, resolve: item.resolve, match: item.match, target: item.target, rel: item.rel, download: item.download, hreflang: item.hreflang, lang: item.lang, title: item.title, current: item.current } as UILinkTarget & { readonly current?: boolean | undefined }
}

/** A click that follows a link in this tab: with a modifier, the reader is opening another one. */
export function followsLink(event: MouseEvent): boolean {
	return event.target instanceof Element && event.target.closest('a') !== null && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/** Brings `child` into the view of `scroller` without moving the document, as `scrollIntoView` would. */
export function revealInScroller(scroller: HTMLElement, child: HTMLElement, axis: 'block' | 'inline'): void {
	const box = scroller.getBoundingClientRect()
	const rect = child.getBoundingClientRect()
	if (axis === 'block') {
		if (rect.top < box.top || rect.bottom > box.bottom) scroller.scrollTop += rect.top - box.top - (scroller.clientHeight - rect.height) / 2
	} else if (rect.left < box.left || rect.right > box.right) scroller.scrollLeft += rect.left - box.left - (scroller.clientWidth - rect.width) / 2
}

/** The closest ancestor that scrolls vertically, the sidebar or the drawer that holds a navigation. */
export function scrollingAncestor(element: Element): HTMLElement | undefined {
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		if (parent === document.body || parent === document.documentElement) return undefined
		const { overflowY } = getComputedStyle(parent)
		if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) return parent
	}
	return undefined
}
