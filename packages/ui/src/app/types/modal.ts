import type { ComponentArgs, ComponentName, ReadonlySignal, ResolvedComponent } from '@meekojs/meeko'

import type { modal } from '../variants/modal'
import type { UIThemeProps } from './theme'

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

/**
 * Props de `<UIModal>`, un `<dialog>` modal nativo con título, cuerpo y pie opcional.
 * @since 1.10.0
 * @example
 * ```html
 * <UIModal model="open" title="Renombrar" size="sm"><p>Contenido</p></UIModal>
 * ```
 */
export type UIModalProps = UIThemeProps<
	typeof modal,
	{
		/** Obligatoria. Nombre accesible del diálogo. */
		title: string
		/** Descripción asociada mediante `aria-describedby`. */
		description?: string
		/** Ancho máximo del diálogo; `md` por defecto. */
		size?: 'sm' | 'md' | 'lg'
		/** Permite descartar con Escape; `true` por defecto. */
		closeOnEscape?: boolean
		/** Permite descartar con un clic en el fondo; `true` por defecto. */
		closeOnBackdrop?: boolean
		/** Muestra el botón de cierre; `true` por defecto. */
		closeButton?: boolean
		/** Nombre accesible del botón de cierre; usa los mensajes de UI por defecto. */
		closeLabel?: string
		/** Clases adicionales del `<dialog>`; equivale a `ui.base`. */
		class?: string
	}
>
