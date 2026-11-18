import type { OmitUndefined, VariantProps } from 'tailwind-variants/lite'

/** Aplana una intersección para que el editor muestre las props como un solo objeto. */
type Simplify<T> = { [K in keyof T]: T[K] } & {}

/**
 * Clases extra por slot de un componente, en la prop `ui`: `{ base: '…', dot: '…' }`. Un componente sin
 * slots no la tiene, porque su `class` ya llega al único elemento que pinta.
 *
 * @example
 * ```meeko
 * <UIBadge tone="success" dot bind:ui="{ dot: 'my-dot' }">Publicado</UIBadge>
 * ```
 */
export type UIVariantSlots<T extends (...args: never[]) => unknown> = OmitUndefined<ReturnType<T>> extends string ? {} : { ui?: { [Key in keyof OmitUndefined<ReturnType<T>>]?: string } }

/**
 * Las props de un componente con sus variantes de `tailwind-variants` y, si tiene slots, la prop `ui`.
 * `T` es la función que devuelve `tv()` y `P` las props propias del componente.
 *
 * @example
 * ```ts
 * import { badge } from '../variants/badge'
 *
 * export type UIBadgeProps = UIThemeProps<typeof badge, { dot?: boolean; class?: string }>
 * ```
 */
export type UIThemeProps<T extends (...args: never[]) => unknown, P> = Simplify<P & VariantProps<T> & UIVariantSlots<T>>
