import type { Signal } from '@meekojs/meeko'

import { effect } from '@meekojs/meeko'

import type { ModalDismissReason } from '../types/modal'

import { withViewTransition } from './view-transition'

export interface ModalDialogOptions {
	closeOnEscape?: boolean
	closeOnBackdrop?: boolean
}

const orderAttribute = 'data-meeko-ui-modal-order'
const topAttribute = 'data-meeko-ui-modal-top'
const stateAttribute = 'data-meeko-ui-modal-state'

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
		dialog.style.setProperty('--ui-modal-depth', String(depth))
	}
}

function releaseBackdrop(element: HTMLDialogElement): void {
	element.removeAttribute(orderAttribute)
	element.removeAttribute(topAttribute)
	element.removeAttribute('data-meeko-ui-modal-behind')
	element.style.removeProperty('--ui-modal-depth')
	syncBackdrop(element.ownerDocument)
}

/**
 * Controlador DOM montado sólo en navegador. El `<dialog>` nativo gestiona foco, inert y capa superior,
 * `closedby` el cierre con Esc o clic fuera y `modal.css` la entrada; aquí quedan el modelo, la salida
 * con View Transition, el motivo de `dismiss`, el clic fuera donde `closedby` no llega y el fondo apilado.
 */
export function mountModalDialog(element: HTMLDialogElement, open: Signal<boolean>, options: ModalDialogOptions, dismiss: (reason: ModalDismissReason) => void): { close(): Promise<void>; dispose(): void } {
	let pointerOutside = false
	let closing: Promise<void> | undefined
	let version = 0
	function closeElement() {
		if (element.open) element.close()
		releaseBackdrop(element)
	}
	function exit(): Promise<void> {
		if (closing) return closing
		if (!element.open) return Promise.resolve()
		const current = ++version
		element.setAttribute(stateAttribute, 'closing')
		// Volver a abrir antes de la captura cancela el cierre: la actualización llega siempre, aunque tarde.
		const transition = withViewTransition(
			() => {
				if (current === version) closeElement()
			},
			{ types: ['ui-modal-close'] },
		)
		const done = () => {
			if (current !== version) return
			closing = undefined
			element.removeAttribute(stateAttribute)
		}
		if (!transition) {
			done()
			return Promise.resolve()
		}
		closing = transition.finished.then(done, done)
		return closing
	}
	const outside = (event: MouseEvent) => {
		const rect = element.getBoundingClientRect()
		return event.target === element && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
	}
	// `closedby` no distingue Esc de un clic fuera: el motivo sale del último `pointerdown`.
	const cancel = (event: Event) => {
		event.preventDefault()
		const reason = pointerOutside ? 'backdrop' : 'escape'
		pointerOutside = false
		if (!closing && (reason === 'backdrop' ? options.closeOnBackdrop : options.closeOnEscape) !== false) dismiss(reason)
	}
	const close = () => {
		// Ignora un evento close encolado si el diálogo ya volvió a abrirse, y el de su propia salida.
		if (element.open || closing) return
		releaseBackdrop(element)
		if (open.value) dismiss('native')
	}
	const pointerdown = (event: PointerEvent) => {
		pointerOutside = outside(event)
	}
	// El clic fuera sin `closedby="any"`: un navegador sin `closedby` o un modal que sólo admite ese cierre.
	const click = (event: MouseEvent) => {
		if (!closing && open.value && pointerOutside && outside(event) && options.closeOnBackdrop !== false) dismiss('backdrop')
		pointerOutside = false
	}
	element.addEventListener('cancel', cancel)
	element.addEventListener('close', close)
	element.addEventListener('pointerdown', pointerdown)
	element.addEventListener('click', click)
	const stop = effect(() => {
		if (open.value && closing) {
			version++
			closing = undefined
			element.removeAttribute(stateAttribute)
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
		} else if (!open.value && element.open) {
			void exit()
		}
	})
	return {
		close: exit,
		dispose() {
			version++
			stop()
			element.removeEventListener('cancel', cancel)
			element.removeEventListener('close', close)
			element.removeEventListener('pointerdown', pointerdown)
			element.removeEventListener('click', click)
			closeElement()
			element.removeAttribute(stateAttribute)
		},
	}
}
