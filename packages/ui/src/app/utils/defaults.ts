import type { ContextKey } from '@meekojs/meeko'

import { inject } from '@meekojs/meeko'

import type { UIDefaults } from '../types/config'

export const uiDefaultsKey = Symbol.for('@meekojs/ui/defaults') as ContextKey<UIDefaults>
const empty: UIDefaults = Object.freeze({})

/** Lee los defaults del proveedor actual; el módulo sin opciones conserva sus valores de base. */
export function uiDefaults(): UIDefaults {
	try {
		return inject(uiDefaultsKey)
	} catch {
		return empty
	}
}
