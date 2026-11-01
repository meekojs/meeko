import type { PluginApp } from '@meekojs/meeko/framework'

import { createContext, inject, onCleanup, signal } from '@meekojs/meeko'

import type { UIToastContext, UIToastEntry, UIToastProps } from '../types/feedback'

const toastKey = createContext<UIToastContext>('@meekojs/ui/toast')

/**
 * Notificaciones de la aplicación con un host UIApp. El estado se aísla por petición SSR.
 * @since 0.2.0
 * @example
 * ```ts
 * import { useToast } from '@meekojs/ui/runtime'
 * const toast = useToast()
 * toast.add({ text: 'Cambios guardados', tone: 'success', duration: 5000 })
 * ```
 */
export function useToast(): UIToastContext {
	const context = inject(toastKey)
	if (!context) throw new Error('useToast requires a parent UIApp')
	return context
}

/** Estado privado del host; no se comparte entre peticiones ni aplicaciones. */
function createToastManager() {
	const entries = signal<readonly UIToastEntry[]>([])
	let nextId = 0
	const context: UIToastContext = {
		add(props: UIToastProps) {
			const id = ++nextId
			entries.value = [...entries.value, { ...props, id }]
			return id
		},
		remove(id) {
			entries.value = entries.value.filter((entry) => entry.id !== id)
		},
		clear() {
			entries.value = []
		},
	}
	return { ...context, entries }
}

const managerKey = createContext<ReturnType<typeof createToastManager>>('@meekojs/ui/toast.manager')

/** Registro privado por aplicación, antes de hidratar páginas y layouts. */
export function installToastPlugin(app: Pick<PluginApp, 'provide' | 'side'>): void {
	const manager = createToastManager()
	app.provide(managerKey, manager)
	app.provide(toastKey, {
		...manager,
		add(props) {
			if (app.side !== 'client') throw new Error('Toasts can only be opened in the browser')
			return manager.add(props)
		},
	})
}

/** Vincula el host visual a la vida de UIApp. */
export function useToastHost() {
	const manager = inject(managerKey)
	onCleanup(manager.clear)
	return manager
}
