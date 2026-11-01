import type { ResolvedComponent } from '@meekojs/meeko'
import type { PluginApp } from '@meekojs/meeko/framework'

import { createContext, inject, onCleanup, provide, signal } from '@meekojs/meeko'

import type { ModalArgs, ModalContext, ModalInstance, ModalInstanceContext, ModalName, ModalResolver } from '../types/modal'

const modalKey = createContext<ModalContext>('@meekojs/ui/modal')
const instanceKey = createContext<ModalInstanceContext>('@meekojs/ui/modal.instance')

const duplicateHost = 'Only one UIApp modal host can be mounted per provider'

interface PendingModal {
	id: number
	closing?: boolean
	component?: ResolvedComponent<ModalName>
	resolve(result: unknown): void
	reject(error: unknown): void
}

interface ModalManagerOptions {
	/**
	 * Admite el relevo de host propio de la HMR: `replaceHotModule` ejecuta el setup del `UIApp` nuevo antes
	 * de liberar el anterior para poder volver atrás. Por defecto es `import.meta.hot`, que Vite define sólo en
	 * el cliente de desarrollo y sustituye por `undefined` en producción, SSR y Node.
	 */
	hot?: boolean
}

/** Estado por proveedor; las promesas y los resolvers no forman parte del estado reactivo. */
export function createModalManager(load: ModalResolver, options: ModalManagerOptions = {}) {
	const hot = options.hot ?? (import.meta as { hot?: unknown }).hot !== undefined
	const instances = signal<ReadonlyMap<number, ModalInstance>>(new Map())
	const pending = new Map<number, PendingModal>()
	const exits = new Map<number, () => Promise<void>>()
	let nextId = 0
	let disposed = false
	const hosts = new Set<object>()

	function publish() {
		const ready = new Map<number, ModalInstance>()
		for (const entry of pending.values()) {
			// Un import lento no debe invertir el orden de las capas de diálogo.
			if (!entry.component) break
			ready.set(entry.id, { id: entry.id, component: entry.component })
		}
		instances.value = ready
	}

	function settle(entry: PendingModal, result: unknown) {
		if (pending.get(entry.id) !== entry) return
		pending.delete(entry.id)
		exits.delete(entry.id)
		try {
			publish()
		} finally {
			entry.resolve(result)
		}
	}

	function finish(id: number, result: unknown) {
		const entry = pending.get(id)
		if (!entry || entry.closing) return
		entry.closing = true
		const exit = exits.get(id)
		if (!exit) return settle(entry, result)
		try {
			void exit().then(
				() => settle(entry, result),
				() => settle(entry, result),
			)
		} catch {
			// Un fallo visual no debe dejar pendiente la promesa del modal.
			settle(entry, result)
		}
	}

	function clear() {
		const entries = [...pending.values()]
		pending.clear()
		exits.clear()
		try {
			publish()
		} finally {
			for (const entry of entries) entry.resolve(undefined)
		}
	}

	const manager = {
		instances: Object.freeze({
			get value() {
				return instances.value
			},
		}),
		open<R = unknown>(...request: ModalArgs): Promise<R | undefined> {
			if (disposed) return Promise.reject(new Error('The modal provider has been disposed'))
			const id = ++nextId
			return new Promise<R | undefined>((resolve, reject) => {
				const entry: PendingModal = { id, resolve: (result) => resolve(result as R | undefined), reject }
				pending.set(id, entry)
				void Promise.resolve().then(async () => {
					if (!pending.has(id)) return
					try {
						const component = await load(...request)
						if (!pending.has(id)) return
						entry.component = component
						publish()
					} catch (error) {
						if (!pending.has(id)) return
						pending.delete(id)
						publish()
						entry.reject(error)
					}
				})
			})
		},
		dismiss(id: number) {
			finish(id, undefined)
		},
		dismissAll() {
			for (const id of [...pending.keys()]) finish(id, undefined)
		},
		close: finish,
		registerExit(id: number, exit: () => Promise<void>) {
			exits.set(id, exit)
			return () => {
				if (exits.get(id) === exit) exits.delete(id)
			}
		},
		get hosted() {
			return hosts.size > 0
		},
		attachHost() {
			if (hosts.size > 0 && !hot) throw new Error(duplicateHost)
			const host = {}
			hosts.add(host)
			// En HMR el host anterior se libera justo después, en la misma tarea; si sigue ahí es un duplicado real.
			if (hosts.size > 1) queueMicrotask(() => hosts.size > 1 && console.error(new Error(duplicateHost)))
			return () => {
				if (!hosts.delete(host) || hosts.size > 0) return
				// Un host relevado no vacía los modales: pasan al host nuevo. La HMR libera el anterior y monta el nuevo
				// en la misma tarea (el setup de prueba del nuevo ya se liberó), así que el vaciado espera a ese relevo.
				if (hot) queueMicrotask(() => hosts.size === 0 && clear())
				else clear()
			}
		},
		dispose() {
			disposed = true
			clear()
		},
	}
	return manager
}

function modalContext(manager: ReturnType<typeof createModalManager>, client: () => boolean): ModalContext {
	return {
		instances: manager.instances,
		open: <R = unknown>(...request: ModalArgs) => {
			if (!client()) return Promise.reject<R | undefined>(new Error('Modals can only be opened in the browser'))
			if (!manager.hosted) return Promise.reject<R | undefined>(new Error('Mount UIApp before opening a modal'))
			return manager.open<R>(...request)
		},
		dismiss: manager.dismiss,
		dismissAll: manager.dismissAll,
	}
}

/** Crea un proveedor local opcional en el setup; el módulo UI ya instala uno por aplicación. */
export function provideModal(resolve: ModalResolver): ModalContext {
	const manager = createModalManager(resolve)
	const context = modalContext(manager, () => typeof document !== 'undefined')
	provide(modalKey, context)
	provide(managerKey, manager)
	onCleanup(manager.dispose)
	return context
}

const managerKey = createContext<ReturnType<typeof createModalManager>>('@meekojs/ui/modal.manager')

/** Registro del módulo: estado nuevo por aplicación y por petición SSR. */
export function installModalPlugin(app: Pick<PluginApp, 'provide' | 'side'>, resolve: ModalResolver): void {
	const manager = createModalManager(resolve)
	app.provide(
		modalKey,
		modalContext(manager, () => app.side === 'client'),
	)
	app.provide(managerKey, manager)
}

/** Vincula la vida del host con sus instancias y sus cargas pendientes. */
export function useModalHost(): ModalContext {
	const manager = inject(managerKey)
	onCleanup(manager.attachHost())
	return useModal()
}

/** Obtiene el gestor del UIApp más cercano. Llámalo durante el setup, antes de await. */
export function useModal(): ModalContext {
	return inject(modalKey)
}

/** Obtiene la instancia actual; close devuelve el resultado a quien llamó a open. */
export function useModalInstance<R = unknown>(): ModalInstanceContext<R> {
	return inject(instanceKey) as ModalInstanceContext<R>
}

/** Conecta el componente dinámico con su propia instancia; uso interno del host. */
export function provideModalInstance(id: number): void {
	const manager = inject(managerKey)
	provide(instanceKey, { id, close: (result) => manager.close(id, result), dismiss: () => manager.dismiss(id) })
}

/** Contexto opcional para que UIModal también funcione de forma declarativa. */
export function optionalModalInstance(): ModalInstanceContext | undefined {
	try {
		return inject(instanceKey)
	} catch {
		return undefined
	}
}

/** Captura durante setup el registro privado que aplaza el desmontaje hasta terminar la salida. */
export function modalExitRegistration(): ((exit: () => Promise<void>) => () => void) | undefined {
	const instance = optionalModalInstance()
	if (!instance) return undefined
	const manager = inject(managerKey)
	// Un proveedor creado antes de actualizar el paquete por HMR puede no tener todavía este hook.
	if (typeof manager.registerExit !== 'function') return undefined
	return (exit) => manager.registerExit(instance.id, exit)
}
