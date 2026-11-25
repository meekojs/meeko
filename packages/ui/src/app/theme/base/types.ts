import type { variants } from './variants'

/** Catálogo de estilos compartidos. */
export type Variants = typeof variants
/** Propiedades que puede seleccionar una receta. */
export type VariantKey = keyof Variants
/** Valores disponibles para una propiedad. */
export type VariantValue<K extends VariantKey> = Extract<keyof Variants[K], string>

/** Habilita todos los valores con true o elige un subconjunto con una lista. */
export type AppearanceOptions = {
	[K in VariantKey]?: boolean | readonly VariantValue<K>[]
}

type EnabledSelection = true | readonly string[]

type SelectedValues<K extends VariantKey, Selection> = Selection extends true ? { -readonly [V in keyof Variants[K]]: Variants[K][V] } : Selection extends readonly string[] ? Pick<Variants[K], Extract<Selection[number], VariantValue<K>>> : never

/** Variantes habilitadas y sus valores, con las claves literales de cada selección. */
export type SelectedVariants<T extends AppearanceOptions> = {
	-readonly [K in keyof T & VariantKey as T[K] extends EnabledSelection ? K : never]: SelectedValues<K, T[K]>
}

export type AppearanceColor = VariantValue<'color'>
export type AppearanceVariant = VariantValue<'variant'>
export type AppearanceSize = VariantValue<'size'>
export type AppearanceRadius = VariantValue<'radius'>

export type Variant = AppearanceVariant
export type Color = AppearanceColor
export type Size = AppearanceSize
export type Radius = AppearanceRadius

export interface AppearanceProps {
	variant?: Variant
	color?: Color
	size?: Size
	radius?: Radius
}
