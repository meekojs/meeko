import type { ElementAttributes } from '@meekojs/meeko'
import type { MeekoLinkProps, RouteId } from '@meekojs/meeko/framework'

import type { UIActionShape, UIActionSize, UIActionVariant } from './config'

/** Los params de la ruta K: `{ id: string }` en `/users/[id]`, `{}` en una ruta estática. */
type RouteParamsOf<K extends RouteId> = NonNullable<MeekoLinkProps<K>['params']>

/**
 * Destino tipado de `<UIButton to>` y `<UILink to>`: el ID de una ruta de la aplicación con sus
 * `params` correlacionados (obligatorios si la ruta tiene segmentos dinámicos, prohibidos si no) y
 * un `search` opcional. Una ruta que no existe es un error de tipos en `to`.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * const profile: UIRouteTarget = { to: '/users/[id]', params: { id: '7' }, search: { tab: 'actividad' } }
 * const home: UIRouteTarget = { to: '/' }
 * ```
 */
export type UIRouteTarget = {
	[K in RouteId]: { readonly to: K; readonly search?: MeekoLinkProps['search'] } & (string extends K ? { readonly params?: RouteParamsOf<K> } : keyof RouteParamsOf<K> extends never ? { readonly params?: never } : { readonly params: RouteParamsOf<K> })
}[RouteId]

/** Atributos comunes a `<a>` y `<button>`. */
type SharedAttributes = Pick<ElementAttributes<'a'>, keyof ElementAttributes<'a'> & keyof ElementAttributes<'button'>>

/**
 * Atributos HTML que `<UIButton>` y `<UILink>` reenvían tal cual al elemento que pintan: los
 * comunes a `<a>` y `<button>`, como `id`, `title`, `tabindex`, `aria-*` y `data-*`. `class` es una
 * prop propia, que se suma a la clase del componente.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIButton id="save" title="Guardar" aria-describedby="hint" data-testid="save">Guardar</UIButton>
 * ```
 */
export type UIForwardedAttributes = Omit<SharedAttributes, 'class' | 'type'>

/**
 * Aspecto compartido por `<UIButton>` y `<UILink>`: variante, tamaño, forma y clases. Sin ellas, se
 * usan los valores de `ui.defaults` en `meeko.config.ts` y, después, `primary`, `md` y `rounded`.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIButton variant="outline" size="sm" shape="pill" class="toolbar-action">Filtrar</UIButton>
 * ```
 */
export interface UIActionAppearance {
	/** Jerarquía visual de la acción; `"primary"` por defecto. */
	readonly variant?: UIActionVariant
	/** Tamaño del control; `"md"` por defecto. */
	readonly size?: UIActionSize
	/** Forma del contorno; `"rounded"` por defecto. */
	readonly shape?: UIActionShape
	/** Clases adicionales, tras la del componente. */
	readonly class?: string
}

/** `<UIButton to>`: navega a una ruta de la aplicación con `<MeekoLink>`. */
type UIButtonRouteProps = UIRouteTarget & {
	readonly href?: never
	readonly target?: never
	readonly rel?: never
	readonly download?: never
	readonly type?: never
	readonly disabled?: never
}

/** `<UIButton href>`: un `<a>` a cualquier URL. */
interface UIButtonAnchorProps {
	/** URL de destino; pinta un `<a>`. */
	readonly href: string
	/** Dónde se abre el enlace. Con `"_blank"` y sin `rel`, añade `rel="noopener noreferrer"`. */
	readonly target?: '_self' | '_blank' | '_parent' | '_top'
	/** Relación con el destino; gana sobre el valor por defecto de `target="_blank"`. */
	readonly rel?: string
	/** Descarga el destino, con el nombre de archivo indicado o el del servidor con `true`. */
	readonly download?: string | boolean
	readonly to?: never
	readonly params?: never
	readonly search?: never
	readonly type?: never
	readonly disabled?: never
}

/** `<UIButton>` sin `to` ni `href`: un `<button>` nativo. */
interface UIButtonNativeProps {
	/** Comportamiento en un formulario; `"button"` por defecto, así que nunca envía sin pedirlo. */
	readonly type?: 'button' | 'submit' | 'reset'
	/** Desactiva el botón nativo: no recibe foco ni clics. */
	readonly disabled?: boolean
	readonly to?: never
	readonly params?: never
	readonly search?: never
	readonly href?: never
	readonly target?: never
	readonly rel?: never
	readonly download?: never
}

/**
 * Props de `<UIButton>`, una acción con tres formas y el mismo aspecto: con `to` navega a una ruta
 * de la aplicación con `<MeekoLink>` (navegación del cliente, `params` y `search` tipados), con
 * `href` es un `<a>` (`target`, `rel` y `download`) y sin ninguno es un `<button>` (`type`, por
 * defecto `"button"`, y `disabled`). Las combinaciones que no tienen sentido son errores de tipos:
 * `to` con `href`, `type` o `disabled` en un enlace, `target` en un botón. Un enlace no se puede
 * deshabilitar: no lo pinte, o use un `<button disabled>`. Los atributos de
 * {@link UIForwardedAttributes} (`id`, `title`, `aria-*`, `data-*`…) llegan al elemento.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIButton to="/users/[id]" bind:params="{ id: user.id }">Perfil</UIButton>
 * <UIButton href="https://github.com/meekojs/meeko" target="_blank" variant="outline">GitHub</UIButton>
 * <UIButton type="submit" bind:disabled="saving.value" on:click="save">Guardar</UIButton>
 * ```
 */
export type UIButtonProps = (UIButtonAnchorProps | UIButtonNativeProps | UIButtonRouteProps) & UIActionAppearance & UIForwardedAttributes

/** `<UILink to>`: navega a una ruta de la aplicación con `<MeekoLink>`. */
type UILinkRouteProps = UIRouteTarget & {
	readonly href?: never
	readonly target?: never
	readonly rel?: never
}

/** `<UILink href>`: un `<a>` a cualquier URL. */
interface UILinkAnchorProps {
	/** URL de destino. */
	readonly href: string
	/** Dónde se abre el enlace. Con `"_blank"` y sin `rel`, añade `rel="noopener noreferrer"`. */
	readonly target?: '_self' | '_blank' | '_parent' | '_top'
	/** Relación con el destino; gana sobre el valor por defecto de `target="_blank"`. */
	readonly rel?: string
	readonly to?: never
	readonly params?: never
	readonly search?: never
}

/**
 * Props de `<UILink>`, un enlace con la API visual de `<UIButton>` y los defaults de
 * `ui.defaults.link`. Recibe `href` (cualquier URL) o, desde 0.2, `to` (una ruta de la aplicación
 * con `params` y `search` tipados, que navega con `<MeekoLink>`); los dos a la vez son un error de
 * tipos. `ariaLabel` sigue siendo el nombre accesible y reenvía además `id`, `title`, `aria-*` y
 * `data-*`.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UILink to="/installation">Instalación</UILink>
 * <UILink href="https://github.com/meekojs/meeko" target="_blank" variant="outline">GitHub</UILink>
 * ```
 */
export type UILinkProps = (UILinkAnchorProps | UILinkRouteProps) &
	UIActionAppearance &
	UIForwardedAttributes & {
		/** Nombre accesible cuando el contenido visible no basta; equivale a `aria-label`. */
		readonly ariaLabel?: string
	}
