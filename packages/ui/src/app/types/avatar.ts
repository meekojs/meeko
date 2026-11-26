import type { avatarTheme, UIAvatarColor, UIAvatarRadius, UIAvatarSize, UIAvatarVariant } from '../theme/components/avatar'
import type { UIThemeProps } from './theme'

/**
 * Snippets de `<UIAvatar>`.
 *
 * @since 1.10.0
 * @example
 * ```html
 * <UIAvatar><snippet name="fallback">?</snippet></UIAvatar>
 * ```
 */
export interface AvatarSnippets {
	/** Contenido sin imagen ni nombre, en lugar del glifo de una persona. */
	fallback?: []
}

/**
 * Props de `<UIAvatar>`, la imagen o las iniciales de una persona. Sin `src` pinta las iniciales de `name`
 * (la primera letra de hasta dos palabras; de un correo, sólo la primera letra de lo que va antes de la `@`);
 * sin nombre, el snippet `fallback` o el glifo de una persona. Si la imagen no carga, pasa a las iniciales
 * al hidratar. El tamaño sale de los tokens `--ui-avatar-size-*`; el fondo y el texto, de la receta `avatarTheme`
 * de `@meekojs/ui/theme` (`variant` y `color`), y las esquinas, de `radius`. `ui` añade clases a sus slots: `base`,
 * `image` y `glyph`.
 *
 * @since 1.10.0
 * @since 1.11.0 `variant`, `color` y `radius` sustituyen a `shape` (`circle` es `radius="full"`, el valor por defecto, y `rounded`, `radius="md"`).
 * @example `<UIAvatar name="Ana Pérez" src="/avatars/ana.webp" size="sm" />`
 */
export type UIAvatarProps = UIThemeProps<
	typeof avatarTheme,
	{
		/** Nombre de la persona: da las iniciales y el nombre accesible. */
		name?: string
		/** URL de la imagen; su `alt` es el nombre accesible. */
		src?: string
		/** Lado, de `--ui-avatar-size-sm`, `-md` o `-lg`; `"md"` por defecto. */
		size?: UIAvatarSize
		/** Tratamiento visual: `soft`, `solid`, `surface` u `outline`; `"soft"` por defecto. */
		variant?: UIAvatarVariant
		/** Color semántico: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`; `"primary"` por defecto. */
		color?: UIAvatarColor
		/** Radio de la caja, de `none` a `full`; `"full"` (un círculo) por defecto. */
		radius?: UIAvatarRadius
		/** Nombre accesible en lugar de `name`, por ejemplo «Tu cuenta». */
		label?: string
		/** Lo oculta a los lectores de pantalla (`aria-hidden`), dentro de un control que ya tiene nombre. */
		decorative?: boolean
		/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
		class?: string
	}
>

export type { UIAvatarColor, UIAvatarRadius, UIAvatarSize, UIAvatarVariant }
