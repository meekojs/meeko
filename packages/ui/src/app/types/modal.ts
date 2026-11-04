import type { ComponentArgs, ComponentName, ReadonlySignal, ResolvedComponent } from '@meekojs/meeko'

/** Nombres de componentes de aplicación que pueden abrirse como modales. */
export type ModalName = Extract<ComponentName, `Modal${string}`>
/** Pares correlacionados de nombre y props; conserva los requisitos de cada componente. */
export type ModalArgs = Extract<ComponentArgs, [name: ModalName, props: unknown]>
/** Componente listo para montar, con sus props ya resueltas. */
export interface ModalInstance {
	id: number
	component: ResolvedComponent<ModalName>
}
/** Gestor compartido por los descendientes de UIApp. */
export interface ModalContext {
	readonly instances: ReadonlySignal<ReadonlyMap<number, ModalInstance>>
	/** Devuelve undefined al cancelar. R es el contrato declarado por el consumidor. */
	open<R = unknown>(...request: ModalArgs): Promise<R | undefined>
	dismiss(id: number): void
	dismissAll(): void
}
/** Operaciones de la instancia actual, disponibles dentro de un componente Modal…. */
export interface ModalInstanceContext<R = unknown> {
	readonly id: number
	close(result: R): void
	dismiss(): void
}
export type ModalResolver = (...request: ModalArgs) => Promise<ResolvedComponent<ModalName>>

/** Motivo de cierre sin resultado del contenedor visual. */
export type ModalDismissReason = 'escape' | 'backdrop' | 'button' | 'native'
