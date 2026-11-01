import type { IconData } from './index'

/**
 * Atributos que `<UIIcon>` escribe en su `<svg>`, calculados por {@link iconView}.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { IconView } from '@meekojs/icon'
 *
 * const view: IconView = { body: '', height: '1em', hidden: 'true', label: undefined, missing: true, role: undefined, viewBox: undefined, width: '1em' }
 * ```
 */
export interface IconView {
	/** Contenido del `<svg>`; vacío si el icono no está disponible. */
	readonly body: string
	/** Alto: `size` o el tamaño por defecto. */
	readonly height: string
	/** `'true'` si el icono es decorativo (sin `label`). */
	readonly hidden: 'true' | undefined
	/** Texto accesible, si lo hay. */
	readonly label: string | undefined
	/** `true` si el nombre no se resolvió al compilar ni está en `icon.include`. */
	readonly missing: boolean
	/** `'img'` si el icono tiene `label`. */
	readonly role: 'img' | undefined
	/** `viewBox` del icono. */
	readonly viewBox: string | undefined
	/** Ancho proporcional al alto, o `undefined` si `size` no es una longitud simple. */
	readonly width: string | undefined
}

const length = /^(\d*\.?\d+)([a-z%]*)$/i

/** The width for `height`, following the ratio of `viewBox`. */
function widthFor(height: string, viewBox: string | undefined): string | undefined {
	const [, , width, tall] = viewBox?.split(/[\s,]+/).map(Number) ?? []
	if (!width || !tall || width === tall) return height
	const match = length.exec(height)
	if (!match) return undefined
	return `${Math.round((Number(match[1]) * width * 1000) / tall) / 1000}${match[2]}`
}

/**
 * Calcula los atributos del `<svg>` de un icono: busca `name` primero entre los iconos resueltos
 * al compilar para esa etiqueta y después en el registro de `icon.include`. Un icono ausente da un
 * `<svg>` vacío con `missing: true`.
 *
 * @param name Nombre del icono.
 * @param resolved Iconos que el compilador resolvió para la etiqueta.
 * @param registry Iconos de `icon.include`.
 * @param size Alto del icono, una longitud CSS.
 * @param label Texto accesible; sin él, el icono es decorativo.
 * @returns Los atributos del `<svg>`.
 * @since 0.1.0
 * @example
 * ```ts
 * import { iconView } from '@meekojs/icon'
 *
 * const view = iconView('lucide:x', { 'lucide:x': ['0 0 24 24', '<path d="M18 6L6 18"/>'] }, {}, '1em', 'Cerrar')
 * // view.role === 'img', view.label === 'Cerrar'
 * ```
 */
export function iconView(name: string, resolved: Readonly<Record<string, IconData>> | undefined, registry: Readonly<Record<string, IconData>>, size: string, label: string | undefined): IconView {
	const data = (resolved && Object.hasOwn(resolved, name) ? resolved[name] : undefined) ?? (Object.hasOwn(registry, name) ? registry[name] : undefined)
	const accessible = label?.trim() ? label : undefined
	return {
		body: data?.[1] ?? '',
		height: size,
		hidden: accessible ? undefined : 'true',
		label: accessible,
		missing: !data,
		role: accessible ? 'img' : undefined,
		viewBox: data?.[0],
		width: widthFor(size, data?.[0]),
	}
}
