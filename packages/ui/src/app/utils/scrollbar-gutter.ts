// The gutter of the scrollbar of the document, measured for CSS. With a gutter kept by `scrollbar-gutter:
// stable`, Chromium paints nothing in that strip but the background color of the root: a fixed panel, a modal
// <dialog> and its ::backdrop are clipped before it, even with a negative inset, and `100vw` already leaves it
// out. So a lock of the page (<UIDrawer>, useScrollLock) gives the strip back to the viewport and pads the root
// by its width instead: the page does not move, and a panel or a backdrop reaches the edge of the window.

/** The width of the gutter, in px, inline on `<html>`. tokens.css declares it as `0px` for a page without JavaScript. */
export const gutterProperty = '--ui-scrollbar-gutter'

/**
 * The physical side of the gutter (`left` or `right`), inline on `<html>`. It also says that the width was
 * measured: only then does a lock give the gutter back, since without the width the page would move.
 */
export const gutterAttribute = 'data-meeko-ui-scrollbar-gutter'

/** Whether a lock already gave the gutter back: then the root has none to measure, and the width of before stays. */
function locked(style: CSSStyleDeclaration): boolean {
	return (style.overflowY === 'hidden' || style.overflowY === 'clip') && style.scrollbarGutter === 'auto'
}

/**
 * Measures the gutter that the root keeps for its scrollbar, 0 with overlay scrollbars or without a gutter,
 * and writes it on `<html>`. While a lock holds the page it keeps the last width; while the page is zoomed
 * with the fingers, too, since then `innerWidth` is the visual viewport.
 */
export function measureScrollbarGutter(): void {
	if (typeof document === 'undefined' || typeof globalThis.getComputedStyle !== 'function') return
	const root = document.documentElement
	const style = globalThis.getComputedStyle(root)
	if (locked(style)) return
	if ((globalThis.visualViewport?.scale ?? 1) !== 1) return
	// The box of the root with its margins is the window without the gutter. Not `clientWidth`: with the
	// scrollbars hidden, as in a headless Chromium, it counts the gutter that the page still keeps.
	const box = root.getBoundingClientRect()
	const start = box.left - (parseFloat(style.marginLeft) || 0)
	const width = Math.max(0, Math.round(globalThis.innerWidth - box.width - (parseFloat(style.marginLeft) || 0) - (parseFloat(style.marginRight) || 0)))
	// Chromium and WebKit keep it on the right in both directions; a browser that moves it to the left in a
	// right-to-left page starts the root after it.
	const side = width > 0 && Math.round(start) >= width ? 'left' : 'right'
	if (root.style.getPropertyValue(gutterProperty) !== `${width}px`) root.style.setProperty(gutterProperty, `${width}px`)
	if (root.getAttribute(gutterAttribute) !== side) root.setAttribute(gutterAttribute, side)
}

let tracking = false

/**
 * Keeps the width up to date for the life of the page: when the window or the zoom changes, which resizes
 * the root, and when the scrollbar appears or leaves. Once per page; in the server it does nothing.
 */
export function trackScrollbarGutter(): void {
	if (tracking || typeof document === 'undefined' || typeof globalThis.addEventListener !== 'function') return
	tracking = true
	measureScrollbarGutter()
	globalThis.addEventListener('resize', measureScrollbarGutter, { passive: true })
	if (typeof ResizeObserver === 'function') new ResizeObserver(measureScrollbarGutter).observe(document.documentElement)
}
