import type { Signal } from '@meekojs/meeko'

import { effect } from '@meekojs/meeko'

import type { ModalDismissReason } from '../types/modal'

export interface ModalDialogOptions {
	closeOnEscape?: boolean
	closeOnBackdrop?: boolean
}

const orderAttribute = 'data-meeko-ui-modal-order'
const topAttribute = 'data-meeko-ui-modal-top'

function orderedDialogs(document: Document): HTMLDialogElement[] {
	return [...document.querySelectorAll<HTMLDialogElement>(`dialog[${orderAttribute}]`)]
}

/** Sólo el diálogo superior pinta el fondo; el orden DOM puede diferir del orden de apertura. */
function syncBackdrop(document: Document): void {
	const dialogs = orderedDialogs(document)
	const active = dialogs.filter((dialog) => dialog.open).sort((a, b) => Number(a.getAttribute(orderAttribute)) - Number(b.getAttribute(orderAttribute)))
	const top = active.at(-1)
	for (const dialog of dialogs) {
		const depth = Math.max(0, Math.min(2, active.length - 1 - active.indexOf(dialog)))
		dialog.toggleAttribute(topAttribute, dialog === top)
		dialog.toggleAttribute('data-meeko-ui-modal-behind', dialog.open && dialog !== top)
		dialog.style.setProperty('--meeko-ui-modal-depth', String(depth))
	}
}

function releaseBackdrop(element: HTMLDialogElement): void {
	element.removeAttribute(orderAttribute)
	element.removeAttribute(topAttribute)
	element.removeAttribute('data-meeko-ui-modal-behind')
	element.style.removeProperty('--meeko-ui-modal-depth')
	syncBackdrop(element.ownerDocument)
}

/** Controlador DOM montado sólo en navegador. Los diálogos nativos gestionan foco e inert. */
export function mountModalDialog(element: HTMLDialogElement, open: Signal<boolean>, options: ModalDialogOptions, dismiss: (reason: ModalDismissReason) => void): { close(): Promise<void>; dispose(): void } {
	let pointerOutside = false
	let animation: Animation | undefined
	let closing: Promise<void> | undefined
	let version = 0
	let disposed = false
	const reducedMotion = () => element.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches !== false
	const snapshot = () => {
		const css = element.ownerDocument.defaultView!.getComputedStyle(element)
		return { opacity: css.opacity, transform: css.transform }
	}
	function enter(from: Keyframe = { opacity: 0, transform: 'translateY(16px) scale(0.96)' }) {
		if (reducedMotion() || typeof element.animate !== 'function') return
		element.setAttribute('data-meeko-ui-modal-state', 'opening')
		const current = (animation = element.animate([from, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }))
		void current.finished.then(
			() => {
				if (animation === current) {
					animation = undefined
					element.removeAttribute('data-meeko-ui-modal-state')
				}
			},
			() => {},
		)
	}
	function closeElement() {
		if (element.open) element.close()
		element.removeAttribute('data-meeko-ui-modal-state')
		releaseBackdrop(element)
	}
	function exit(): Promise<void> {
		if (closing) return closing
		if (!element.open || disposed) return Promise.resolve()
		const from = snapshot()
		animation?.cancel()
		const currentVersion = ++version
		if (reducedMotion() || typeof element.animate !== 'function') {
			closeElement()
			return Promise.resolve()
		}
		element.setAttribute('data-meeko-ui-modal-state', 'closing')
		animation = element.animate([from, { opacity: 0, transform: 'translateY(12px) scale(0.96)' }], { duration: 160, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' })
		closing = animation.finished
			.catch(() => {})
			.then(() => {
				if (disposed || currentVersion !== version) return
				animation?.cancel()
				animation = undefined
				closing = undefined
				closeElement()
			})
		return closing
	}
	const outside = (event: MouseEvent) => {
		const rect = element.getBoundingClientRect()
		return event.target === element && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
	}
	const cancel = (event: Event) => {
		event.preventDefault()
		if (!closing && options.closeOnEscape !== false) dismiss('escape')
	}
	const close = () => {
		// Ignora un evento close encolado si el diálogo ya volvió a abrirse.
		if (!element.open) {
			releaseBackdrop(element)
			if (open.value) dismiss('native')
		}
	}
	const pointerdown = (event: PointerEvent) => {
		pointerOutside = outside(event)
	}
	const click = (event: MouseEvent) => {
		if (!closing && pointerOutside && outside(event) && options.closeOnBackdrop !== false) dismiss('backdrop')
		pointerOutside = false
	}
	element.addEventListener('cancel', cancel)
	element.addEventListener('close', close)
	element.addEventListener('pointerdown', pointerdown)
	element.addEventListener('click', click)
	const stop = effect(() => {
		if (open.value && closing) {
			const from = snapshot()
			version++
			closing = undefined
			animation?.cancel()
			element.removeAttribute('data-meeko-ui-modal-state')
			enter(from)
		}
		if (open.value && !element.open) {
			// Guardar el orden en el DOM también conserva la pila tras recargas del helper por HMR.
			const order = Math.max(0, ...orderedDialogs(element.ownerDocument).map((dialog) => Number(dialog.getAttribute(orderAttribute)))) + 1
			element.setAttribute(orderAttribute, String(order))
			try {
				element.showModal()
			} catch (error) {
				releaseBackdrop(element)
				throw error
			}
			syncBackdrop(element.ownerDocument)
			enter()
		} else if (!open.value && element.open) {
			void exit()
		}
	})
	return {
		close: exit,
		dispose() {
			disposed = true
			version++
			animation?.cancel()
			stop()
			element.removeEventListener('cancel', cancel)
			element.removeEventListener('close', close)
			element.removeEventListener('pointerdown', pointerdown)
			element.removeEventListener('click', click)
			closeElement()
		},
	}
}
