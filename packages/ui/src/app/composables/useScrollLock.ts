import { effect, onCleanup } from '@meekojs/meeko'

/** How many active locks the document has: the first one locks it, the last one to leave restores it. */
let locks = 0
/** The inline styles of `<html>` before the first lock, to put back exactly what the app had. */
let previous: { overflow: string; scrollbarGutter: string } | undefined

function acquire() {
	if (locks++ > 0) return
	const root = document.documentElement
	previous = { overflow: root.style.overflow, scrollbarGutter: root.style.scrollbarGutter }
	// `stable` keeps the gutter of the scrollbar when it disappears, so the page does not move sideways.
	root.style.scrollbarGutter = 'stable'
	root.style.overflow = 'hidden'
}

function release() {
	if (locks === 0 || --locks > 0) return
	const root = document.documentElement
	root.style.overflow = previous?.overflow ?? ''
	root.style.scrollbarGutter = previous?.scrollbarGutter ?? ''
	previous = undefined
}

/**
 * Bloquea el desplazamiento del documento mientras `active` devuelve `true`, como hace `UIDrawer`:
 * para un cajón, una hoja o un panel propio. Pone `overflow: hidden` en `<html>` con `scrollbar-gutter: stable`,
 * así que la página no salta de lado cuando desaparece la barra. Varios bloqueos a la vez se suman: el documento
 * vuelve a desplazarse cuando se suelta el último, con los estilos en línea que tenía `<html>`. Se suelta solo al
 * destruirse el componente. En el servidor no hace nada. Llámalo durante el setup, no tras un `await`.
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
