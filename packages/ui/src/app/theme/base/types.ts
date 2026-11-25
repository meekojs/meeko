import type { hueNames } from './hues'
import type { variants } from './variants'

/** Catálogo de estilos compartidos. */
export type Variants = typeof variants
/** Propiedades que puede seleccionar una receta. */
export type VariantKey = keyof Variants

/** Color semántico: los que usan los componentes de `@meekojs/ui`. */
export type AppearanceColor = Extract<keyof Variants['color'], string>
/** Tono crudo de Radix Colors; solo se acepta si `appearance()` recibe la paleta `hues`. */
export type Hue = (typeof hueNames)[number]
/** Tratamiento visual que se combina con un color. */
export type AppearanceVariant = Extract<keyof Variants['variant'], string>
/** Tamaño de control. */
export type AppearanceSize = Extract<keyof Variants['size'], string>
/** Radio del contorno. */
export type AppearanceRadius = Extract<keyof Variants['radius'], string>

/** Una pareja color × variante con sus clases literales completas. */
export interface AppearanceCompound<C extends string = AppearanceColor | Hue> {
	readonly color: C
	readonly variant: Exclude<AppearanceVariant, 'plain'>
	readonly class: string
}

/** Paleta opcional de tonos crudos que exporta `@meekojs/ui/theme/hues`. */
export interface HuePalette {
	readonly names: readonly Hue[]
	readonly compoundVariants: readonly AppearanceCompound<Hue>[]
}

/** Segundo argumento de `appearance()`. */
export interface AppearanceConfig {
	/** Slot de una receta con `slots` que recibe las clases; sin él van a la raíz (`base`). */
	readonly slot?: string
	/** Habilita los tonos crudos de Radix Colors además de los colores semánticos. */
	readonly hues?: HuePalette
}

/** `true` si la configuración incluye la paleta de tonos crudos. */
export type HasHues<C> = C extends { readonly hues: HuePalette } ? true : false
/** Slot elegido en la configuración, o `undefined`. */
export type SlotOf<C> = C extends { readonly slot: infer S extends string } ? S : undefined

/** Catálogo efectivo: con tonos crudos, `color` también admite los nombres de Radix. */
type Catalog<H extends boolean> = Omit<Variants, 'color'> & { readonly color: { readonly [K in AppearanceColor | (H extends true ? Hue : never)]: '' } }

/** Valores disponibles para una propiedad. */
export type VariantValue<K extends VariantKey, H extends boolean = false> = Extract<keyof Catalog<H>[K], string>

/** Habilita todos los valores con true o elige un subconjunto con una lista. */
export type AppearanceOptions<H extends boolean = false> = {
	[K in VariantKey]?: boolean | readonly VariantValue<K, H>[]
}

type EnabledSelection = true | readonly string[]

/** Las clases de un valor, dirigidas a un slot si se pidió; un valor vacío no necesita slot. */
type SlotClass<Class, S> = [S] extends [string] ? (Class extends '' ? '' : { [K in S]: Class }) : Class

type SelectedValues<K extends VariantKey, Selection, S, H extends boolean> = Selection extends true ? { -readonly [V in keyof Catalog<H>[K]]: SlotClass<Catalog<H>[K][V], S> } : Selection extends readonly string[] ? { -readonly [V in Extract<Selection[number], VariantValue<K, H>>]: SlotClass<Catalog<H>[K][V & keyof Catalog<H>[K]], S> } : never

/** Variantes habilitadas y sus valores, con las claves literales de cada selección. */
export type SelectedVariants<T extends AppearanceOptions<H>, S = undefined, H extends boolean = false> = {
	-readonly [K in keyof T & VariantKey as T[K] extends EnabledSelection ? K : never]: SelectedValues<K, T[K], S, H>
}

/** Valores elegidos para una propiedad, o `never` si no está habilitada. */
type Chosen<T, K extends VariantKey, H extends boolean> = K extends keyof T ? (T[K] extends true ? VariantValue<K, H> : T[K] extends readonly (infer V)[] ? Extract<V, VariantValue<K, H>> : never) : never

/** Compuestas color × variante que sobreviven al filtro; vacías si falta alguno de los dos ejes. */
export type SelectedCompoundVariants<T, S = undefined, H extends boolean = false> = [Chosen<T, 'color', H>] extends [never] ? [] : [Exclude<Chosen<T, 'variant', H>, 'plain'>] extends [never] ? [] : { color: Chosen<T, 'color', H>; variant: Exclude<Chosen<T, 'variant', H>, 'plain'>; class: SlotClass<string, S> }[]

/** Resultado de `appearance()`, listo para extenderse en `defineTheme()`. */
export interface Appearance<T extends AppearanceOptions<H>, S = undefined, H extends boolean = false> {
	variants: SelectedVariants<T, S, H>
	compoundVariants: SelectedCompoundVariants<T, S, H>
}

/** Props de una receta que habilita las propiedades principales del catálogo con sus colores semánticos. */
export interface AppearanceProps {
	variant?: AppearanceVariant
	color?: AppearanceColor
	size?: AppearanceSize
	radius?: AppearanceRadius
}
