/**
 * Elements above which a View Transition stops being worth it. With a high pixel ratio or on a phone, Chrome
 * spends seconds per frame in Layerize once a page gets this big, and the page does not respond meanwhile.
 */
const MAX_ANIMATED_ELEMENTS = 4000

/**
 * Indica si un documento es demasiado grande para animarlo con una View Transition: en una página de
 * miles de elementos, con una pantalla de alta densidad o en un teléfono, cada frame de la transición
 * bloquea la página durante segundos. Contar es barato. Compruébalo antes de empezar y otra vez al
 * aplicar el cambio, porque ese cambio puede traer el contenido grande; en ese caso, salta la
 * animación con `skipTransition()`.
 *
 * Las navegaciones con `viewTransitions` y `withViewTransition()` de `@meekojs/ui/runtime` ya lo hacen;
 * úsalo solo si llamas a `document.startViewTransition()` por tu cuenta.
 *
 * @param target El documento, por defecto el global. Solo existe en el navegador.
 * @returns `true` si la transición debe omitirse y el cambio aplicarse sin animar.
 * @since 1.8.0
 * @example
 * ```ts
 * import { isTooLargeToAnimate } from '@meekojs/meeko'
 *
 * if (isTooLargeToAnimate()) update()
 * else document.startViewTransition(update)
 * ```
 */
export function isTooLargeToAnimate(target: Document = document): boolean {
	// A live collection: the browser caches its length until the DOM changes, and building no list keeps it cheap.
	return target.getElementsByTagName('*').length > MAX_ANIMATED_ELEMENTS
}

/**
 * Starts the transition of a navigation with its type, so CSS can tell it from a component's own
 * transition (`:active-view-transition-type(meeko-route)`). A browser without transition types
 * (Chrome before 125, Safari before 18.2, Firefox before 147) rejects the options object, so it
 * gets the callback alone: the navigation still animates and those rules do not apply.
 */
function startRouteTransition(browser: Window, update: () => void): ViewTransition {
	const prototype = (browser as unknown as { ViewTransition?: { prototype: object } }).ViewTransition?.prototype
	if (prototype && 'types' in prototype) return browser.document.startViewTransition({ update, types: ['meeko-route'] })
	return browser.document.startViewTransition(update)
}

/** Coordina las transiciones nativas de una aplicación sin retrasar la carga ni duplicar commits. */
export function createViewTransitionController(browser: Window) {
	let active: ViewTransition | undefined
	function skip(): void {
		active?.skipTransition()
		active = undefined
	}
	return {
		skip,
		async commit(update: () => void, signal: AbortSignal, enabled: boolean): Promise<boolean> {
			if (signal.aborted) return false
			let committed = false
			let started = false
			const apply = () => {
				if (signal.aborted) return
				started = true
				update()
				committed = true
			}
			const document = browser.document
			if (!enabled || typeof document.startViewTransition !== 'function' || document.visibilityState === 'hidden' || (typeof browser.matchMedia === 'function' && browser.matchMedia('(prefers-reduced-motion: reduce)').matches) || isTooLargeToAnimate(document)) {
				apply()
				return committed
			}
			skip()
			let transition: ViewTransition
			try {
				transition = startRouteTransition(browser, () => {
					apply()
					// The page that arrives can be the large one: the old state is captured, but the frames are not paid for.
					if (committed && isTooLargeToAnimate(document)) transition.skipTransition()
				})
			} catch (error) {
				// A browser failure before the callback falls back; a failed update is never retried.
				if (started) throw error
				apply()
				return committed
			}
			active = transition
			const abort = () => transition.skipTransition()
			signal.addEventListener('abort', abort, { once: true })
			if (signal.aborted) abort()
			// Duplicate names or a skipped animation reject `ready`, not the page's DOM update.
			void transition.ready.catch(() => {})
			void transition.finished
				.catch(() => {})
				.then(() => {
					signal.removeEventListener('abort', abort)
					if (active === transition) active = undefined
				})
			await transition.updateCallbackDone
			return committed
		},
	}
}
