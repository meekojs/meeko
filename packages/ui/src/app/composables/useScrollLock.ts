import { effect, onCleanup } from '@meekojs/meeko'

import { gutterAttribute, gutterProperty, measureScrollbarGutter } from '../utils/scrollbar-gutter'

/** The inline styles of `<html>` that a lock touches. */
type LockedStyles = Record<'overflow' | 'paddingLeft' | 'paddingRight' | 'scrollbarGutter', string>

/** How many active locks the document has: the first one locks it, the last one to leave restores it. */
let locks = 0
/** The inline styles of `<html>` before the first lock, to put back exactly what the app had. */
let previous: LockedStyles | undefined

function acquire() {
	if (locks++ > 0) return
	const root = document.documentElement
	// The width of right now, before the scrollbar leaves: the plugin may not be there, or not have seen the last change.
	measureScrollbarGutter()
	const { overflow, paddingLeft, paddingRight, scrollbarGutter } = root.style
	previous = { overflow, paddingLeft, paddingRight, scrollbarGutter }
	const side = root.getAttribute(gutterAttribute)
	if (side === 'left' || side === 'right') {
		// The gutter goes back to the viewport, so a panel of the app reaches the edge of the window, and the
		// root keeps its width as padding, so the page does not move (utils/scrollbar-gutter).
		root.style.scrollbarGutter = 'auto'
		root.style[side === 'left' ? 'paddingLeft' : 'paddingRight'] = `var(${gutterProperty})`
	}
	// Without the width, `stable` keeps the gutter of the scrollbar when it disappears, so the page does not move sideways.
	else root.style.scrollbarGutter = 'stable'
	root.style.overflow = 'hidden'
}

function release() {
	if (locks === 0 || --locks > 0) return
	const root = document.documentElement
	root.style.overflow = previous?.overflow ?? ''
	root.style.scrollbarGutter = previous?.scrollbarGutter ?? ''
	root.style.paddingLeft = previous?.paddingLeft ?? ''
	root.style.paddingRight = previous?.paddingRight ?? ''
	previous = undefined
	measureScrollbarGutter()
}

/**
 * Bloquea el desplazamiento del documento mientras `active` devuelve `true`, como hace `UIDrawer`:
 * para un cajón, una hoja o un panel propio. Pone `overflow: hidden` en `<html>` y la página no salta de lado
 * cuando desaparece la barra: el canal que ocupaba vuelve a la ventana y `<html>` recibe su ancho,
 * `--ui-scrollbar-gutter`, como relleno en ese lado. Así un panel fijo con `right: 0` o `inset-inline-end: 0`
 * y su fondo llegan hasta el borde de la ventana. Sin ese ancho medido, deja el canal con
 * `scrollbar-gutter: stable`. Varios bloqueos a la vez se suman: el documento vuelve a desplazarse cuando se
 * suelta el último, con los estilos en línea que tenía `<html>`. Se suelta solo al destruirse el componente.
 * En el servidor no hace nada. Llámalo durante el setup, no tras un `await`.
 * @since 1.10.0
 * @example
 * ```ts
 * import { signal } from '@meekojs/meeko'
 * import { useScrollLock } from '@meekojs/ui/runtime'
 *
 * const open = signal(false)
 * useScrollLock(() => open.value)
 * ```
 */
export function useScrollLock(active: () => boolean | undefined): void {
	let held = false
	effect(() => {
		const wanted = active() === true
		if (wanted === held || typeof document === 'undefined') return
		if (wanted) acquire()
		else release()
		held = wanted
	})
	onCleanup(() => {
		if (held) release()
		held = false
	})
}
