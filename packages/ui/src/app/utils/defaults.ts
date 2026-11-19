import { createContext, inject } from '@meekojs/meeko'

import type { UIDefaults } from '../types/config'

export const uiDefaultsKey = createContext<UIDefaults>('@meekojs/ui/defaults')
const empty: UIDefaults = Object.freeze({})
const noSlots: Readonly<Record<string, string | undefined>> = Object.freeze({})

/** Lee los defaults del proveedor actual; el módulo sin opciones conserva sus valores de base. */
export function uiDefaults(): UIDefaults {
	try {
		return inject(uiDefaultsKey)
	} catch {
		return empty
	}
}

/** Las clases de `ui` de un componente de `UIDefaults`: un texto por slot. */
type Slots<K extends keyof UIDefaults> = NonNullable<UIDefaults[K]> extends { readonly ui?: infer S } ? Readonly<Record<keyof NonNullable<S>, string | undefined>> : Readonly<Record<string, string | undefined>>

/** Las clases propias de una instancia: su prop `class` y su prop `ui`. */
export interface UIOwnClasses {
	readonly class?: string | undefined
	readonly ui?: Readonly<Record<string, string | undefined>> | undefined
}

/**
 * Las clases de una instancia sumadas a las de `ui.defaults` de su componente, y sus defaults de
 * variantes. Las clases no se fusionan: van primero las de los defaults y después las de la instancia.
 */
export interface UITheme<K extends keyof UIDefaults> {
	/** `ui.defaults` del componente, para sus defaults de variantes: la prop explícita gana sobre ellos. */
	readonly defaults: NonNullable<UIDefaults[K]> | undefined
	/** `class` de los defaults seguida de la de la instancia; `undefined` sin ninguna. */
	readonly class: string | undefined
	/** `ui` de los defaults con la de la instancia, slot a slot; un slot sin clases es `undefined`. */
	readonly ui: Slots<K>
}

const join = (first: string | undefined, second: string | undefined): string | undefined => (first && second ? first + ' ' + second : first || second || undefined)

/**
 * Lee `ui.defaults` de un componente y lo combina con sus props. `own` devuelve las props de la instancia
 * y se lee en cada acceso, así que sigue sus cambios. Se llama una vez, al crear el componente.
 *
 * @since 1.11.0
 * @example
 * ```ts
 * const props = defineProps<UIStatProps>()
 * const theme = uiTheme('stat', () => props)
 * // en la plantilla: classes.value({ class: theme.ui.value }) y [theme.ui.base, theme.class]
 * ```
 */
export function uiTheme<K extends keyof UIDefaults>(name: K, own: () => UIOwnClasses): UITheme<K> {
	const defaults = uiDefaults()[name] as (NonNullable<UIDefaults[K]> & UIOwnClasses) | undefined
	const shared = defaults?.ui
	// The merge of the last `ui` of the instance: a template reads several slots of the same object.
	let last: UIOwnClasses['ui'] | null = null
	let merged: Readonly<Record<string, string | undefined>> = noSlots
	return {
		defaults,
		get class() {
			return join(defaults?.class, own().class)
		},
		get ui() {
			const mine = own().ui
			if (!shared) return (mine ?? noSlots) as Slots<K>
			if (mine === last) return merged as Slots<K>
			last = mine
			if (!mine) merged = shared
			else {
				const result: Record<string, string | undefined> = { ...shared }
				for (const [slot, classes] of Object.entries(mine)) result[slot] = join(shared[slot], classes)
				merged = result
			}
			return merged as Slots<K>
		},
	}
}
