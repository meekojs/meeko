import type { ModelOptions } from '../../app/definitions/define-model'
import type { Signal } from '../../core/reactivity'

import { isWritableSignal, signal } from '../../core/reactivity'
import { readChannels } from '../runtime/channels'

function attributeOf(name: string): string {
	return name === 'default' ? 'model' : `model:${name}`
}

/**
 * The model `name` of a component instance: the parent's signal, or a local one from `default`.
 * `borrowed` collects the parent's signals so the instance does not snapshot them.
 */
export function useModel<T>(props: object, name: string, borrowed: Set<unknown>, options?: ModelOptions<T>): Signal<T> {
	const passed = readChannels(props)?.models[name]
	if (passed !== undefined) {
		if (!isWritableSignal(passed)) throw new TypeError(`Meeko ${attributeOf(name)} expects a writable signal, not a computed signal or a plain value`)
		borrowed.add(passed)
		return passed as Signal<T>
	}
	if (!options || !Object.hasOwn(options, 'default')) {
		throw new TypeError(`Meeko model "${name}" is required: pass ${attributeOf(name)}="signal", or give defineModel a default`)
	}
	return signal(options.default)
}
