import type { ElementAttributes } from '@meekojs/meeko'
import type { MeekoLinkProps, RouteId } from '@meekojs/meeko/framework'

import type { UIButtonColor, UIButtonElevation, UIButtonRadius, UIButtonSize, UIButtonVariant, UIButtonWidth } from '../theme/components/button'
import type { linkCardTheme, UICardColor, UICardElevation, UICardRadius, UICardVariant } from '../theme/components/card'
import type { copyButtonTheme } from '../theme/components/copy-button'
import type { iconButtonTheme } from '../theme/components/icon-button'
import type { icons } from '../utils/icons'
import type { PopoverPlacement } from './popover'
import type { UIThemeProps } from './theme'

/** Los params de la ruta K: `{ id: string }` en `/users/[id]`, `{}` en una ruta estática. */
type RouteParamsOf<K extends RouteId> = NonNullable<MeekoLinkProps<K>['params']>

/**
 * Destino tipado de `<UIButton to>` y `<UILink to>`: el ID de una ruta de la aplicación con sus
 * `params` correlacionados (obligatorios si la ruta tiene segmentos dinámicos, prohibidos si no) y
 * un `search` opcional. Una ruta que no existe es un error de tipos en `to`.
 *
 * @since 1.8.0
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
 * @since 1.8.0
 * @example
 * ```html
 * <UIButton id="save" title="Guardar" aria-describedby="hint" data-testid="save">Guardar</UIButton>
 * ```
 */
export type UIForwardedAttributes = Omit<SharedAttributes, 'class' | 'type'>

/**
 * Atributos propios de `<a>` que `<UILink>` y `<UIButton>` reenvían cuando pintan un enlace (con
 * `to` o `href`), con el tipado de `ElementAttributes<'a'>`: `hreflang`, `ping`, `referrerpolicy`…
 * `target`, `rel` y `download` son props propias; `lang` y los demás globales están en
 * {@link UIForwardedAttributes}. Con `to`, `hreflang` también elige el idioma del enlace cuando la
 * aplicación usa `@meekojs/i18n`.
 *
 * @since 1.8.0
 * @example
 * ```html
 * <UILink href="https://example.com/en" hreflang="en" lang="en">English</UILink>
 * <UILink to="/guide" hreflang="en">Guide</UILink>
 * ```
 */
export type UIAnchorAttributes = Omit<ElementAttributes<'a'>, keyof SharedAttributes | 'href' | 'target' | 'rel' | 'download' | 'type' | 'aria-current'>

/** Los atributos de {@link UIAnchorAttributes} prohibidos en un `<button>`. */
type NoAnchorAttributes = { readonly [Name in keyof UIAnchorAttributes]?: never }

/** `target`, `rel` y `download` de un enlace, con `to` o con `href`. */
interface UILinkTargetProps {
	/** Dónde se abre el enlace. Con `"_blank"` y sin `rel`, añade `rel="noopener noreferrer"`. */
	readonly target?: '_self' | '_blank' | '_parent' | '_top'
	/** Relación con el destino; gana sobre el valor por defecto de `target="_blank"`. */
	readonly rel?: string
	/** Descarga el destino, con el nombre de archivo indicado o el del servidor con `true`. */
	readonly download?: string | boolean
}

/** `resolve` de un enlace con `to`: si su `href` pasa por los resolvedores de enlaces de la aplicación. */
interface UIRouteResolveProps {
	/**
	 * Si el `href` pasa por los resolvedores de enlaces de la aplicación, como el prefijo de idioma
	 * de `@meekojs/i18n`. `true` por defecto; `bind:resolve="false"` deja el `href` de la ruta tal
	 * cual, como `<MeekoLink bind:resolve="false">`.
	 *
	 * @since 1.8.0
	 */
	readonly resolve?: boolean
}

/**
 * Aspecto compartido por `<UIButton>` y `<UILink>`, el de la receta `buttonTheme` de `@meekojs/ui/theme`:
 * tratamiento (`variant`), color semántico (`color`), tamaño, radio, ancho, sombra y clases. Sin ellas, se
 * usan los valores de `ui.defaults` en `meeko.config.ts` y, después, `solid`, `primary`, `md` y radio `md`.
 * `class` se fusiona con Tailwind Merge: una utilidad tuya gana a la de la receta que fija la misma propiedad.
 *
 * @since 1.8.0
 * @example
 * ```html
 * <UIButton variant="outline" color="neutral" size="sm" radius="full" class="toolbar-action">Filtrar</UIButton>
 * ```
 */
export interface UIActionAppearance {
	/** Tratamiento visual: `solid`, `soft`, `surface`, `outline`, `subtle`, `ghost` o `link`; `"solid"` por defecto. */
	readonly variant?: UIButtonVariant
	/** Color semántico: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`; `"primary"` por defecto. */
	readonly color?: UIButtonColor
	/** Tamaño del control, de `xs` a `xl`; `"md"` por defecto. */
	readonly size?: UIButtonSize
	/** Radio del contorno, de `none` a `full`; `"md"` por defecto. */
	readonly radius?: UIButtonRadius
	/** Ancho: `auto` (el de su contenido) o `full` (el de su contenedor). */
	readonly width?: UIButtonWidth
	/** Sombra, de `none` a `2xl`. */
	readonly elevation?: UIButtonElevation
	/** Clases adicionales, fusionadas tras las de la receta: ganan en un conflicto. */
	readonly class?: string
}

export type { UIButtonColor, UIButtonElevation, UIButtonRadius, UIButtonSize, UIButtonVariant, UIButtonWidth }

/** `<UIButton to>`: navega a una ruta de la aplicación con `<MeekoLink>`. */
type UIButtonRouteProps = UIRouteTarget &
	UILinkTargetProps &
	UIRouteResolveProps &
	UIAnchorAttributes & {
		readonly href?: never
		readonly type?: never
		readonly disabled?: never
	}

/** `<UIButton href>`: un `<a>` a cualquier URL. */
interface UIButtonAnchorProps extends UILinkTargetProps, UIAnchorAttributes {
	/** URL de destino; pinta un `<a>`. */
	readonly href: string
	readonly to?: never
	readonly params?: never
	readonly search?: never
	readonly resolve?: never
	readonly type?: never
	readonly disabled?: never
}

/** `<UIButton>` sin `to` ni `href`: un `<button>` nativo. */
interface UIButtonNativeProps extends NoAnchorAttributes {
	/** Nombre del submitter enviado por el formulario. */
	readonly name?: string
	/** Valor del submitter. */
	readonly value?: string
	/** ID del formulario asociado. */
	readonly form?: string
	/** Comportamiento en un formulario; `"button"` por defecto, así que nunca envía sin pedirlo. */
	readonly type?: 'button' | 'submit' | 'reset'
	/** Desactiva el botón nativo: no recibe foco ni clics. */
	readonly disabled?: boolean
	readonly to?: never
	readonly params?: never
	readonly search?: never
	readonly resolve?: never
	readonly href?: never
	readonly target?: never
	readonly rel?: never
	readonly download?: never
}

/** `pressed` sólo existe en un `<button>`: un enlace no es un conmutador. */
interface UIToggleLinkState {
	readonly pressed?: never
}

/** `pressed` de un `<button>` conmutador. */
interface UIToggleState {
	/**
	 * Estado de un conmutador: pinta `aria-pressed` (`"true"` o `"false"`) y el aspecto de activo. Sin ella,
	 * el botón no es un conmutador y no lleva `aria-pressed`.
	 *
	 * @since 1.11.0 en `<UIButton>`; en `<UIIconButton>`, desde 1.10.0.
	 */
	readonly pressed?: boolean
}

/**
 * Props de `<UIButton>`, una acción con tres formas y el mismo aspecto: con `to` navega a una ruta
 * de la aplicación con `<MeekoLink>` (navegación del cliente, `params` y `search` tipados), con
 * `href` es un `<a>` (`target`, `rel` y `download`) y sin ninguno es un `<button>` (`type`, por
 * defecto `"button"`, `disabled` y, en un conmutador, `pressed`). Las combinaciones que no tienen sentido son errores de tipos:
 * `to` con `href`, `type` o `disabled` en un enlace, `target` o `hreflang` en un botón. Un enlace
 * no se puede deshabilitar: no lo pinte, o use un `<button disabled>`. Los atributos de
 * {@link UIForwardedAttributes} (`id`, `title`, `aria-*`, `data-*`…) llegan al elemento, y los de
 * {@link UIAnchorAttributes} (`hreflang`…), a un enlace. Con `to`, el `href` pasa por los
 * resolvedores de enlaces de la aplicación, como en `<MeekoLink>` (`bind:resolve="false"` lo evita).
 *
 * @since 1.8.0
 * @example
 * ```html
 * <UIButton to="/users/[id]" bind:params="{ id: user.id }">Perfil</UIButton>
 * <UIButton href="https://github.com/meekojs/meeko" target="_blank" variant="outline" color="neutral">GitHub</UIButton>
 * <UIButton type="submit" bind:disabled="saving.value" on:click="save">Guardar</UIButton>
 * <UIButton variant="outline" bind:pressed="paid.value" on:click="() => (paid.value = !paid.value)">Pagadas</UIButton>
 * ```
 */
export type UIButtonProps = ((UIButtonAnchorProps & UIToggleLinkState) | (UIButtonNativeProps & UIToggleState) | (UIButtonRouteProps & UIToggleLinkState)) &
	UIActionAppearance &
	UIForwardedAttributes & {
		/** Ocupado: anuncia el estado y bloquea la activación. Conserva el texto visible. */
		readonly loading?: boolean
		/** Contenido sólo de icono: requiere un nombre accesible. */
		readonly iconOnly?: boolean
		/** Nombre accesible, necesario para iconOnly. */
		readonly ariaLabel?: string
	} & ({ readonly iconOnly?: false; readonly ariaLabel?: string } | { readonly iconOnly?: boolean; readonly ariaLabel: string } | { readonly iconOnly?: boolean; readonly 'aria-label': string; readonly ariaLabel?: string })

/**
 * Nombre de un icono propio del paquete para `<UIIconButton icon>`: los trazos que pintan sus componentes, en
 * una rejilla de 16 por 16 (`close`, `menu`, `check`, `info`…).
 *
 * @since 1.10.0
 * @example
 * ```ts
 * const icon: UIIconName = 'close'
 * ```
 */
export type UIIconName = keyof typeof icons

/**
 * Props de `<UIIconButton>`, una acción de sólo icono con las tres formas de `<UIButton>`: con `to` navega a
 * una ruta de la aplicación, con `href` es un `<a>` y sin ninguno es un `<button>` (`type`, `disabled` y, para
 * un conmutador, `pressed`). `label` es obligatorio: es su nombre accesible (`aria-label`) y el texto de su
 * tooltip, que no se anuncia como descripción para no leerlo dos veces; `tooltip="false"` lo quita cuando el
 * contexto ya explica la acción. El icono es `icon`, el nombre de un icono del paquete ({@link UIIconName}) o el
 * trazo `d` de un `<path>` en una rejilla de 16 por 16, o el snippet `default`, con un `<svg aria-hidden="true">`
 * propio. Tiene los `variant`, `color`, `size`, `radius` y `elevation` de `<UIButton>` (receta `iconButtonTheme`) y,
 * sin ellos, es `ghost` y `neutral`. Es contenido de frase: vale dentro de un párrafo o de un encabezado. `ui`
 * añade clases a sus slots: `base` (el botón o el enlace; equivale a `class`), `icon` y `tooltip`.
 *
 * @since 1.10.0
 * @example
 * ```html
 * <UIIconButton label="Cerrar" icon="close" on:click="close" />
 * <UIIconButton label="Fijar" bind:pressed="pinned.value" on:click="() => (pinned.value = !pinned.value)">
 *   <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12" /></svg>
 * </UIIconButton>
 * <UIIconButton label="Ajustes" to="/settings" variant="outline" size="sm" />
 * <UIIconButton label="Eliminar" color="danger" bind:loading="removing.value" icon="close" />
 * ```
 */
export type UIIconButtonProps = ((UIButtonAnchorProps & UIToggleLinkState) | (UIButtonNativeProps & UIToggleState) | (UIButtonRouteProps & UIToggleLinkState)) &
	Omit<UIForwardedAttributes, 'aria-label' | 'title'> &
	UIThemeProps<
		typeof iconButtonTheme,
		{
			/** Nombre accesible del botón y texto de su tooltip. Obligatorio: el icono no se lee. */
			readonly label: string
			/** El nombre accesible es `label`. */
			readonly 'aria-label'?: never
			/** Nombre de un icono del paquete o trazo `d` de un `<path>` de 16 por 16; sin ella, el snippet `default`. */
			readonly icon?: UIIconName | (string & {})
			/** Con `false`, sin tooltip: el nombre accesible sigue siendo `label`. `true` por defecto. */
			readonly tooltip?: boolean
			/** Dónde se abre el tooltip; `"top"` por defecto. */
			readonly placement?: PopoverPlacement
			/** Ocupado: cambia el icono por el spinner, anuncia `aria-busy` y bloquea la activación sin quitarle el foco. */
			readonly loading?: boolean
			/** Clases adicionales del botón o del enlace; equivale a `ui.base`. */
			readonly class?: string
		}
	>

/** `<UILink to>`: navega a una ruta de la aplicación con `<MeekoLink>`. */
type UILinkRouteProps = UIRouteTarget &
	UIRouteResolveProps & {
		readonly href?: never
	}

/** `<UILink href>`: un `<a>` a cualquier URL. */
interface UILinkAnchorProps {
	/** URL de destino. */
	readonly href: string
	readonly to?: never
	readonly params?: never
	readonly search?: never
	readonly resolve?: never
}

/**
 * Props de `<UILinkCard>`, una superficie enlazada. Recibe `href` (cualquier URL) o `to` (una ruta
 * de la aplicación con `params` y `search` tipados, que navega con `<MeekoLink>`), como `<UILink>`:
 * los dos a la vez son un error de tipos, y con `to` el `href` pasa por los resolvedores de enlaces
 * de la aplicación, así que con `@meekojs/i18n` apunta al idioma del documento o al de `hreflang`.
 * `title` es el texto principal de la card, no el atributo HTML; los demás atributos llegan al `<a>`.
 * Su aspecto es la receta `linkCardTheme` de `@meekojs/ui/theme`, con los `variant`, `color`, `radius` y
 * `elevation` de `<UICard>` y sus mismos valores por defecto (`surface`, `neutral` y radio `lg`), más los
 * estados del puntero. `ui` añade clases a sus slots: `base`, `title` y `description`.
 *
 * @since 1.8.0
 * @example
 * ```html
 * <UILinkCard to="/theming" title="Personalización" description="Conecta los tokens con tu marca." />
 * <UILinkCard to="/users/[id]" bind:params="{ id: user.id }" bind:title="user.name" />
 * <UILinkCard href="https://github.com/meekojs/meeko" target="_blank" title="GitHub" />
 * ```
 */
export type UILinkCardProps = (UILinkAnchorProps | UILinkRouteProps) &
	UILinkTargetProps &
	UIAnchorAttributes &
	Omit<UIForwardedAttributes, 'title'> &
	UIThemeProps<
		typeof linkCardTheme,
		{
			/** Tratamiento visual, como en `<UICard>`; `"surface"` por defecto. */
			readonly variant?: UICardVariant
			/** Color semántico, como en `<UICard>`; `"neutral"` por defecto. */
			readonly color?: UICardColor
			/** Radio del contorno, de `none` a `full`; `"lg"` por defecto. */
			readonly radius?: UICardRadius
			/** Sombra, de `none` a `2xl`. */
			readonly elevation?: UICardElevation
			/** Texto principal de la card. */
			readonly title: string
			/** Texto de apoyo, bajo el título. */
			readonly description?: string
			/** Clases adicionales del `<a>`; equivale a `ui.base`. */
			readonly class?: string
		}
	>

/**
 * Props de `<UILink>`, un enlace con la API visual de `<UIButton>` y los defaults de
 * `ui.defaults.link`. Recibe `href` (cualquier URL) o, desde 0.2, `to` (una ruta de la aplicación
 * con `params` y `search` tipados, que navega con `<MeekoLink>`); los dos a la vez son un error de
 * tipos. `ariaLabel` sigue siendo el nombre accesible y reenvía además `id`, `title`, `lang`,
 * `aria-*`, `data-*` y los atributos de `<a>` (`target`, `rel`, `download`, `hreflang`…)
 * con `to` o con `href`. Con `to`, el `href` pasa por los resolvedores de enlaces de la aplicación
 * como en `<MeekoLink>`: con `@meekojs/i18n` apunta al idioma del documento o al de `hreflang`.
 *
 * @since 1.8.0
 * @example
 * ```html
 * <UILink to="/installation">Instalación</UILink>
 * <UILink to="/installation" hreflang="en">Installation</UILink>
 * <UILink href="https://github.com/meekojs/meeko" target="_blank" variant="outline" color="neutral">GitHub</UILink>
 * ```
 */
export type UILinkProps = (UILinkAnchorProps | UILinkRouteProps) &
	UILinkTargetProps &
	UIAnchorAttributes &
	UIActionAppearance &
	UIForwardedAttributes & {
		/** Nombre accesible cuando el contenido visible no basta; equivale a `aria-label`. */
		readonly ariaLabel?: string
	}

/**
 * Props de `<UICopyButton>`, un `<button>` que copia `value` al portapapeles. Con texto tiene el aspecto
 * de `<UIButton>` (`variant="surface"` y `color="neutral"` por defecto) y su texto pasa a «Copiado» o «No se pudo copiar» durante un
 * instante; con `iconOnly`, el de `<UIIconButton>` (`ghost` por defecto), con su tooltip, y el icono pasa a
 * una marca. Admite `variant`, `color`, `size` y `radius`, que llegan al botón. El resultado se anuncia en una región `role="status"` y llega con los eventos `copy` (el texto
 * copiado) o `copyError` (el error). Sin JavaScript no puede copiar: espera oculto, sin mover nada, hasta que
 * el navegador lo hidrata. Los textos salen de los mensajes `copyButton.*` si no se pasan. Los colores del
 * resultado son los tokens `--ui-copy-button-copied-color` y `--ui-copy-button-failed-color`. `ui` añade
 * clases a sus slots: `base` (el botón; equivale a `class`) y `status` (el aviso).
 *
 * @since 1.10.0
 * @example
 * ```html
 * <UICopyButton value="pnpm add @meekojs/ui" />
 * <UICopyButton bind:value="token.value" iconOnly label="Copiar el token" on:copy="() => track('token')" />
 * ```
 */
export type UICopyButtonProps = Omit<UIForwardedAttributes, 'aria-label' | 'title'> &
	UIThemeProps<
		typeof copyButtonTheme,
		{
			/** Obligatoria. El texto que se copia. */
			readonly value: string
			/** Texto del botón y, con `iconOnly`, su nombre accesible y su tooltip; por defecto, `copyButton.copy`. */
			readonly label?: string
			/** Texto y aviso tras copiar; por defecto, `copyButton.copied`. */
			readonly copiedLabel?: string
			/** Texto y aviso si la copia falla; por defecto, `copyButton.failed`. */
			readonly failedLabel?: string
			/** Sólo icono, con el aspecto de `<UIIconButton>`. */
			readonly iconOnly?: boolean
			/** Con `iconOnly` y `false`, sin tooltip. `true` por defecto. */
			readonly tooltip?: boolean
			/** Con `iconOnly`, dónde se abre el tooltip; `"top"` por defecto. */
			readonly placement?: PopoverPlacement
			/** Desactiva el botón nativo. */
			readonly disabled?: boolean
			/** Clases adicionales del botón; equivale a `ui.base`. */
			readonly class?: string
		}
	>
