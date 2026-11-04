/**
 * Cómo se edita el Markdown en `<UIMarkdownEditor>`: `visual` es Crepe y `code`, el texto tal cual.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { UIMarkdownEditorMode } from '@meekojs/ui/editor'
 *
 * const mode: UIMarkdownEditorMode = 'code'
 * ```
 */
export type UIMarkdownEditorMode = 'code' | 'visual'

/**
 * Props de `<UIMarkdownEditor>`. El texto va en `model` y el modo en `model:mode`.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { UIMarkdownEditorProps } from '@meekojs/ui/editor'
 *
 * const props: UIMarkdownEditorProps = { id: 'body', label: 'Contenido', readonly: true }
 * ```
 */
export interface UIMarkdownEditorProps {
	/** Nombre accesible y etiqueta visible del editor. */
	label: string
	/** `id` del área de texto del modo código. */
	id?: string
	/** Se puede leer y seleccionar, pero no cambiar. */
	readonly?: boolean
	/** Como `readonly`, y además se ve deshabilitado. */
	disabled?: boolean
	/** `id` del texto que describe el editor, como el de `<UIField>`. */
	describedBy?: string
	/** Texto del documento vacío, si no se quiere el de `ui.messages`. */
	placeholder?: string
	class?: string
}
