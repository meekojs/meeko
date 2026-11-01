import type { ThemeChoice, ThemeToggleMessages } from '@meekojs/meeko/framework'

/**
 * Props de `<UIThemeToggle>`, el selector de tema claro/oscuro: un botón que pasa al tema siguiente
 * (`mode="cycle"`) o un grupo de radios (`mode="select"`). Necesita `theme` en `meeko.config.ts` y
 * cambia el tema sin JavaScript con el formulario de `POST /_meeko/theme`. Sustituye a la etiqueta
 * obsoleta `<MeekoThemeToggle>` del núcleo, con las mismas props, snippets y marcado.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIThemeToggle mode="select" bind:labels="{ light: 'Light', dark: 'Dark', system: 'System' }" />
 * ```
 */
export interface UIThemeToggleProps {
	/** `"cycle"` (por defecto), un botón que pasa al tema siguiente; `"select"`, un grupo de radios. */
	readonly mode?: 'cycle' | 'select'
	/** Elecciones y su orden; por defecto, los temas de la configuración y `"system"` si está activo. */
	readonly themes?: readonly ThemeChoice[]
	/** Nombres de cada elección; por defecto, «Claro», «Oscuro», «Sistema» y el nombre de los demás temas. */
	readonly labels?: Partial<Record<ThemeChoice, string>>
	/** Textos accesibles del botón y del grupo, para traducirlos. */
	readonly messages?: ThemeToggleMessages
	/** Clases del elemento raíz, el `<form>`. */
	readonly class?: string
	/** `id` del elemento raíz, el `<form>`. */
	readonly id?: string
}
