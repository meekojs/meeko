import type { ModelOptions } from '../../app/definitions/define-model'
import type { Signal } from '../../core/reactivity'

import { effect, interceptedSignal, isWritableSignal, signal, untrack } from '../../core/reactivity'
import { modelEventName, modelPropName } from '../../shared/model-names'
import { readChannels } from '../runtime/channels'
import { createEmit, emitPropName } from '../runtime/emits'
import { isReactiveProps } from '../runtime/props'

function attributeOf(name: string): string {
	return name === 'default' ? 'model' : `model:${name}`
}

/**
 * The model `name` of a component instance. With `model="signal"`, the parent's signal. Otherwise a
 * signal of its own that follows the prop (`modelValue`, or the model's name) if the parent passes
 * one, from `default` if not. A write stays local unless the parent passes the prop and its event
 * (`on:update:modelValue`): then the parent decides, and the value only changes if the prop does.
 *
 * `borrowed` collects what the parent owns, so the instance does not snapshot it: its signal, or
 * the one that follows a prop, whose value the parent already has and gives back when hydrating.
 */
export function useModel<T>(props: object, name: string, borrowed: Set<unknown>, options?: ModelOptions<T>): Signal<T> {
	const passed = readChannels(props)?.models[name]
	if (passed !== undefined) {
		if (!isWritableSignal(passed)) throw new TypeError(`Meeko ${attributeOf(name)} expects a writable signal, not a computed signal or a plain value`)
		borrowed.add(passed)
		return passed as Signal<T>
	}
	const prop = modelPropName(name)
	const handler = emitPropName(modelEventName(name))
	const hasDefault = options !== undefined && Object.hasOwn(options, 'default')
	if (!hasDefault && !Reflect.has(props, prop)) {
		throw new TypeError(`Meeko model "${name}" is required: pass ${attributeOf(name)}="signal" or bind:${prop}="value", or give defineModel a default`)
	}
	const reactive = isReactiveProps(props)
	const initial: unknown = Reflect.get(props, prop)
	const resolve = (value: unknown): T => (value === undefined && hasDefault ? options.default : value) as T
	// Props that never change and pass neither the prop nor its event: a plain local signal.
	if (!reactive && initial === undefined && Reflect.get(props, handler) === undefined) return signal(resolve(initial))
	const emit = createEmit<Record<string, [next: T]>>(props)
	const model = interceptedSignal<T>(resolve(initial), (next) => {
		untrack(() => {
			const controlled = Reflect.has(props, prop) && typeof Reflect.get(props, handler) === 'function'
			if (!controlled) model.commit(next)
			emit(modelEventName(name), next)
			// The parent kept the prop: whoever shows the written value goes back to it.
			if (controlled && !Object.is(model.signal.value, next)) model.refresh()
		})
	})
	const own = (value: unknown): void => {
		if (value === undefined) borrowed.delete(model.signal)
		else borrowed.add(model.signal)
	}
	own(initial)
	if (reactive) {
		effect(() => {
			const value: unknown = Reflect.get(props, prop)
			untrack(() => {
				own(value)
				model.commit(resolve(value))
			})
		})
	}
	return model.signal
}
