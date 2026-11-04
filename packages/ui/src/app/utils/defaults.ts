import { createContext, inject } from '@meekojs/meeko'

import type { UIDefaults } from '../types/config'

export const uiDefaultsKey = createContext<UIDefaults>('@meekojs/ui/defaults')
const empty: UIDefaults = Object.freeze({})

/** Lee los defaults del proveedor actual; el módulo sin opciones conserva sus valores de base. */
export function uiDefaults(): UIDefaults {
	try {
		return inject(uiDefaultsKey)
	} catch {
		return empty
	}
}
