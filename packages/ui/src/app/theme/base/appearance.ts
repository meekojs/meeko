import type { AppearanceOptions, SelectedVariants, VariantKey } from './types'

import { variants } from './variants'

/** Selecciona las variantes compartidas que una receta de Tailwind Variants admite. */
export function appearance<const T extends AppearanceOptions>(options: T & Record<Exclude<keyof T, VariantKey>, never>): { variants: SelectedVariants<T> } {
	const selected: Record<string, Record<string, string>> = {}

	for (const key of Object.keys(options) as VariantKey[]) {
		const values = options[key]
		if (!values || !Object.hasOwn(variants, key)) continue

		const source: Readonly<Record<string, string>> = variants[key]
		selected[key] =
			values === true
				? { ...source }
				: Object.fromEntries(
						values.flatMap((value) => {
							const className = source[value]
							return typeof className === 'string' ? [[value, className]] : []
						}),
					)
	}

	return { variants: selected as SelectedVariants<T> }
}
