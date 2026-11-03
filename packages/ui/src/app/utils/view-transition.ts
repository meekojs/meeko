import { isTooLargeToAnimate } from '@meekojs/meeko'

/** Whether the browser can run a View Transition with `types`, and the reader has not asked for less motion. */
function animates(types: readonly string[]): boolean {
	if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') return false
	if (document.visibilityState === 'hidden' || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
	// Names are limited to a type: without types they would never apply, so nothing would move.
	if (types.length && !('types' in (globalThis.ViewTransition?.prototype ?? {}))) return false
	return !isTooLargeToAnimate(document)
}

/**
 * Aplica `update` dentro de una View Transition si el navegador puede; si no, sin animar: sin la API,
 * sin soporte de tipos cuando se piden, con la pestaña oculta, con `prefers-reduced-motion` o en una
 * página demasiado grande (véase `isTooLargeToAnimate` de `@meekojs/meeko`), antes o después del cambio.
 * `update` se ejecuta siempre, una sola vez, aunque otra transición corte a ésta; dentro de una
 * transición lo hace de forma asíncrona, después de capturar la página.
 *
 * Reglas para no interferir con otras transiciones: da `view-transition-name` sólo durante tu tipo
 * (`html:active-view-transition-type(mi-tipo) .x { view-transition-name: x; }`), porque toda transición
 * captura todos los elementos con nombre, y procura que dure 250 ms o menos, porque los clics durante
 * una transición se pierden.
 *
 * @param update El cambio del DOM. Un error aquí rechaza `finished` de la transición devuelta.
 * @param options `types`: los tipos de la transición, para limitar con ellos su CSS.
 * @returns La transición, o `undefined` si `update` ya se aplicó sin animar.
 * @since 0.2.0
 * @example
 * ```ts
 * import { withViewTransition } from '@meekojs/ui/runtime'
 *
 * withViewTransition(() => (section.value = 'team'), { types: ['app-section'] })
 * ```
 */
export function withViewTransition(update: () => void, options: { readonly types?: readonly string[] } = {}): ViewTransition | undefined {
	const types = options.types ?? []
	if (!animates(types)) {
		update()
		return undefined
	}
	const guarded = (): unknown => {
		// An update that returns a promise still holds the transition until it settles, as in the native API.
		const result: unknown = update()
		// What the update brought in can be the large part: the old state is captured, but the frames are not paid for.
		if (isTooLargeToAnimate(document)) transition.skipTransition()
		return result
	}
	const transition = document.startViewTransition(types.length ? { update: guarded, types: [...types] } : guarded)
	// Skipping the animation rejects `ready`, and that is not an error of the page. `finished` stays
	// available to the caller, who sees the same rejection through its own handlers.
	transition.ready.catch(() => {})
	transition.finished.catch(() => {})
	return transition
}
