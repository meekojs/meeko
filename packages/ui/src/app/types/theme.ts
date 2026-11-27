import type { OmitUndefined, VariantProps } from 'tailwind-variants/lite'

/** Aplana una intersección para que el editor muestre las props como un solo objeto. */
type Simplify<T> = { [K in keyof T]: T[K] } & {}

/**
 * Clases extra por slot de un componente, en la prop `ui`: `{ base: '…', dot: '…' }`. Un componente sin
 * slots no la tiene, porque su `class` ya llega al único elemento que pinta.
 *
 * @since 1.10.0
 * @example
 * ```meeko
 * <UIBadge color="success" dot bind:ui="{ dot: 'my-dot' }">Publicado</UIBadge>
 * ```
 */
export type UIVariantSlots<T extends (...args: never[]) => unknown> = OmitUndefined<ReturnType<T>> extends string ? {} : { ui?: { [Key in keyof OmitUndefined<ReturnType<T>>]?: string } }

/**
 * Las props de un componente con sus variantes de `tailwind-variants` y, si tiene slots, la prop `ui`.
 * `T` es la función que devuelve `tv()` y `P` las props propias del componente.
 *
 * @since 1.10.0
 * @example
 * ```ts
 * import { badgeTheme } from '../theme/components/badge'
 *
 * export type UIBadgeProps = UIThemeProps<typeof badgeTheme, { dot?: boolean; class?: string }>
 * ```
 */
export type UIThemeProps<T extends (...args: never[]) => unknown, P> = Simplify<P & VariantProps<T> & UIVariantSlots<T>>
