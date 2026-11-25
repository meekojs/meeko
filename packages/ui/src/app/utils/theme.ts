import { createTV } from 'tailwind-variants'

export type { VariantProps as ThemeVariants } from 'tailwind-variants'

/** Crea recetas de tema tipadas y resuelve conflictos entre utilidades de Tailwind. */
export const defineTheme = createTV({
	twMerge: true,
})
