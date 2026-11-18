import type { container } from '../variants/container'
import type { UIThemeProps } from './theme'

/** Anchos máximos del contenedor, en rem, desde contenido compacto hasta 4K. */
export type UIContainerSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4k' | 'full'

/** Espacio lateral fluido; none permite anidar contenedores sin duplicarlo. */
export type UIContainerGutter = 'none' | 'sm' | 'md' | 'lg'

/** Etiquetas estructurales que conserva el componente en SSR e hidratación. */
export type UIContainerTag = 'div' | 'section' | 'main' | 'article' | 'header' | 'footer' | 'nav' | 'aside'

/**
 * Props de `<UIContainer>`, que centra su contenido con un ancho máximo y un margen lateral. Las variables
 * `--ui-container-max-width` y `--ui-container-gutter` de la aplicación ganan a `size` y `gutter`.
 *
 * @since 1.10.0
 * @example `<UIContainer as="section" size="2xl" gutter="lg" ariaLabel="Novedades">…</UIContainer>`
 */
export type UIContainerProps = UIThemeProps<
	typeof container,
	{
		/** Etiqueta del elemento; `"div"` por defecto. */
		as?: UIContainerTag
		/** Ancho máximo; `"xl"` por defecto. */
		size?: UIContainerSize
		/** Margen lateral; `"md"` por defecto. */
		gutter?: UIContainerGutter
		/** `id` del elemento. */
		id?: string
		/** Nombre accesible, para una región con nombre. */
		ariaLabel?: string
		/** Clases adicionales. */
		class?: string
	}
>
