import type { Appearance, AppearanceCompound, AppearanceConfig, AppearanceOptions, HasHues, SlotOf, VariantKey } from './types'

import { colorCompoundVariants } from './colors'
import { variants } from './variants'

/**
 * Selecciona del catálogo las variantes que admite una receta y las compuestas color × variante que les
 * corresponden, para extenderlas en `defineTheme()`.
 *
 * Solo conoce los colores semánticos. Los tonos crudos de Radix se habilitan pasando la paleta de
 * `@meekojs/ui/theme/hues` en `config.hues`; así no entran en el bundle de quien no la importa. Con
 * `config.slot`, las clases van a ese slot de una receta con `slots` en lugar de a `base`.
 *
 * @example
 * ```ts
 * const badge = defineTheme({
 * 	...appearance({ variant: ['solid', 'soft'], color: true, radius: ['sm', 'full'] }),
 * 	defaultVariants: { variant: 'soft', color: 'neutral', radius: 'full' },
 * })
 * ```
 */
export function appearance<const T extends AppearanceOptions<HasHues<C>>, const C extends AppearanceConfig = {}>(options: T & Record<Exclude<keyof T, VariantKey>, never>, config?: C): Appearance<T, SlotOf<C>, HasHues<C>> {
	const slot = config?.slot
	const target = (className: string) => (slot && className ? { [slot]: className } : className)
	const catalog = (key: VariantKey): Readonly<Record<string, string>> => (key === 'color' && config?.hues ? { ...variants.color, ...Object.fromEntries(config.hues.names.map((hue) => [hue, ''])) } : variants[key])

	const selected: Record<string, Record<string, unknown>> = {}
	for (const key of Object.keys(options) as VariantKey[]) {
		const values = options[key]
		if (!values || !Object.hasOwn(variants, key)) continue

		const source = catalog(key)
		const names = values === true ? Object.keys(source) : values.filter((value: string) => Object.hasOwn(source, value))
		selected[key] = Object.fromEntries(names.map((value) => [value, target(source[value] ?? '')]))
	}

	const colors = selected.color
	const treatments = selected.variant
	const compounds: readonly AppearanceCompound[] = config?.hues ? [...colorCompoundVariants, ...config.hues.compoundVariants] : colorCompoundVariants
	const compoundVariants = colors && treatments ? compounds.filter((entry) => Object.hasOwn(colors, entry.color) && Object.hasOwn(treatments, entry.variant)).map((entry) => ({ color: entry.color, variant: entry.variant, class: target(entry.class) })) : []

	return { variants: selected, compoundVariants } as unknown as Appearance<T, SlotOf<C>, HasHues<C>>
}
