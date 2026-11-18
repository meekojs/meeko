import type { ElementAttributes } from '@meekojs/meeko'

import type { card } from '../variants/card'
import type { UICardVariant } from './config'
import type { UIDensity } from './forms'
import type { UIThemeProps } from './theme'

/**
 * Superficie de contenido con cabecera, cuerpo y pie. Sus snippets son `default`, `header`, `actions`,
 * junto al título, y `footer`. Los demás atributos, como `id` o `aria-label`, llegan a la `<section>`.
 * Una `<UITable>` sola en el cuerpo llega hasta el borde de la card. `ui` añade clases a sus slots:
 * `base`, `header`, `title`, `description`, `actions`, `body` y `footer`.
 *
 * @example `<UICard title="Resumen" density="compact" padding="sm">Contenido</UICard>`
 */
export type UICardProps = Omit<ElementAttributes<'section'>, 'class' | 'title'> &
	Omit<
		UIThemeProps<
			typeof card,
			{
				/** Título de la sección. */
				title?: string
				/** `id` del título, que también recibe `tabindex="-1"`: sirve para llevarle el foco desde código. */
				headingId?: string
				/** Descripción de la sección. */
				description?: string
				/** Tratamiento visual. */
				variant?: UICardVariant
				/** Espacio predeterminado entre el contenido y el borde. */
				density?: UIDensity
				/** Padding explícito; gana sobre density. */
				padding?: 'none' | 'sm' | 'md' | 'lg'
				/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
				class?: string
			}
		>,
		// The columns of the header follow the `actions` snippet: it is not a prop.
		'actions'
	>
