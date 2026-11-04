import type { GroupDefinition, LayoutName } from '../layout'

/**
 * Declara las opciones de una carpeta de `app/pages` en su `+group.ts`: el layout con nombre y sus
 * props y, desde `1.6`, el middleware con nombre, que heredan todas las páginas de la carpeta y de
 * sus subcarpetas. Se autoimporta. Meeko lee el archivo sin ejecutarlo, así que sus valores deben
 * ser literales.
 *
 * @typeParam L Layout del grupo, inferido de `layout`.
 * @param definition Opciones del grupo.
 * @returns La misma definición.
 * @since 1.5.0
 * @example
 * ```ts
 * // app/pages/(dashboard)/+group.ts
 * export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false }, middleware: ["auth"] });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#opciones-por-carpeta-groupts
 */
export function defineGroup<const L extends LayoutName | false = LayoutName>(definition: GroupDefinition<L>): GroupDefinition<L> {
	return definition
}
