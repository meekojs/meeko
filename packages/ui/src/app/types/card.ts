import type { ElementAttributes } from '@meekojs/meeko'

import type { cardTheme, UICardColor, UICardElevation, UICardPadding, UICardRadius, UICardVariant } from '../theme/components/card'
import type { UICardActionsWrap } from './config'
import type { UIDensity } from './forms'
import type { UIThemeProps } from './theme'

/**
 * Superficie de contenido con cabecera, cuerpo y pie. Sus snippets son `default`, `header`, `actions`,
 * junto al título, y `footer`. Los demás atributos, como `id` o `aria-label`, llegan a la `<section>`.
 * Una `<UITable>` sola en el cuerpo llega hasta el borde de la card. Su aspecto es la receta `cardTheme` de
 * `@meekojs/ui/theme`: `variant`, `color`, `radius` y `elevation`, del catálogo compartido; sin ellas, los
 * valores de `ui.defaults.card` y, después, `surface`, `neutral` y radio `lg`. `class` se fusiona con
 * Tailwind Merge: una utilidad tuya gana a la de la receta que fija la misma propiedad. `ui` añade clases a
 * sus slots: `base`, `header`, `title`, `description`, `actions`, `body` y `footer`.
 *
 * @example `<UICard title="Resumen" variant="soft" color="primary" density="compact" padding="sm">Contenido</UICard>`
 */
export type UICardProps = Omit<ElementAttributes<'section'>, 'class' | 'title'> &
	Omit<
		UIThemeProps<
			typeof cardTheme,
			{
				/** Título de la sección. */
				title?: string
				/** `id` del título, que también recibe `tabindex="-1"`: sirve para llevarle el foco desde código. */
				headingId?: string
				/** Descripción de la sección. */
				description?: string
				/**
				 * Tratamiento visual: `surface`, `outline`, `soft`, `subtle`, `solid`, `glass` o `plain`; `"surface"`
				 * por defecto. `plain` no pinta fondo, borde ni color.
				 */
				variant?: UICardVariant
				/** Color semántico: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`; `"neutral"` por defecto. */
				color?: UICardColor
				/** Radio del contorno, de `none` a `full`; `"lg"` por defecto. */
				radius?: UICardRadius
				/** Sombra, de `none` a `2xl`; sin ella, ninguna. */
				elevation?: UICardElevation
				/** Espacio predeterminado entre el contenido y el borde. */
				density?: UIDensity
				/** Padding explícito; gana sobre density. */
				padding?: UICardPadding
				/**
				 * Dónde van las acciones del snippet `actions` respecto al título: `inline` (por defecto) a su lado,
				 * `below` siempre debajo y `auto` debajo cuando la cabecera es más estrecha que el tamaño de
				 * contenedor `card-narrow` del tema (24rem). Es CSS puro, con una container query sobre la cabecera,
				 * así que no salta al hidratar, y el orden del DOM no cambia: título, descripción y acciones. Con
				 * `auto` la cabecera no aporta ancho intrínseco a la card. Admite `ui.defaults.card.actionsWrap`.
				 *
				 * @since 1.10.0
				 * @example
				 * ```meeko
				 * <UICard title="Pedidos" actionsWrap="auto">
				 * 	<snippet name="actions"><UIButton>Exportar</UIButton></snippet>
				 * 	Contenido
				 * </UICard>
				 * ```
				 */
				actionsWrap?: UICardActionsWrap
				/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
				class?: string
			}
		>,
		// The columns of the header follow the `actions` snippet: it is not a prop.
		'actions'
	>

export type { UICardColor, UICardElevation, UICardPadding, UICardRadius, UICardVariant }
