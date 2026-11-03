import type { ThemeChoice, ThemeToggleMessages } from '@meekojs/meeko/framework'

/**
 * Props de `<UIThemeToggle>`, el selector de tema claro/oscuro: un botón que pasa al tema siguiente
 * (`mode="cycle"`) o un grupo de radios (`mode="select"`). Necesita `theme` en `meeko.config.ts` y
 * cambia el tema sin JavaScript con el formulario de `POST /_meeko/theme`. Sustituye a la etiqueta
 * obsoleta `<MeekoThemeToggle>` del núcleo, con las mismas props, snippets y marcado.
 *
 * @since 1.8.0
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
	/** Nombres de cada elección; por defecto, los de `themeToggle.labels` en `ui.messages` y el nombre de los demás temas. */
	readonly labels?: Partial<Record<ThemeChoice, string>>
	/** Textos accesibles del botón y del grupo; ganan sobre los de `themeToggle` en `ui.messages`. */
	readonly messages?: ThemeToggleMessages
	/**
	 * Con `mode="cycle"`, pinta un icono de `light`, `dark` y `system` en lugar de su nombre, que sigue en el
	 * `aria-label`. Un snippet con el nombre de la elección gana sobre el icono, y otro tema muestra su nombre.
	 *
	 * @since 1.8.0
	 * @example
	 * ```html
	 * <UIThemeToggle icons />
	 * ```
	 */
	readonly icons?: boolean
	/** Clases del elemento raíz, el `<form>`. */
	readonly class?: string
	/** `id` del elemento raíz, el `<form>`. */
	readonly id?: string
}
