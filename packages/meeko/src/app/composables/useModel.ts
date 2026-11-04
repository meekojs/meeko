import type { ModelOptions } from '../../app/definitions/define-model'
import type { Signal } from '../../core/reactivity'

import { logClientError } from '../../core/error-observer'
import { effect, interceptedSignal, isWritableSignal, onCleanup, signal, untrack } from '../../core/reactivity'
import { modelEventName, modelPropName } from '../../shared/model-names'
import { readChannels } from '../runtime/channels'
import { componentErrorReporter } from '../runtime/component-errors'
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
 * A handler that returns a promise is a parent that needs time to decide: what was written stays
 * until its last write settles, also if the prop changes meanwhile, and then the prop decides. A
 * rejection goes to the error handler. Once released, a pending write does nothing.
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
	const report = componentErrorReporter()
	let released = false
	onCleanup(() => {
		released = true
	})
	/** The last write, the only one whose end decides the value. */
	let latest = 0
	/** Writes whose parent has not answered: until then, the prop does not touch the written value. */
	let pending = 0
	const reconcile = (): void => model.commit(resolve(Reflect.get(props, prop)))
	const model = interceptedSignal<T>(resolve(initial), (next) => {
		untrack(() => {
			const controlled = Reflect.has(props, prop) && typeof Reflect.get(props, handler) === 'function'
			if (!controlled) model.commit(next)
			const write = ++latest
			const result: unknown = emit(modelEventName(name), next)
			if (typeof (result as { then?: unknown } | null | undefined)?.then === 'function') {
				if (controlled) {
					pending++
					model.commit(next)
				}
				const settle = (): void => {
					if (released || !controlled) return
					pending--
					if (write === latest) reconcile()
				}
				void Promise.resolve(result).then(settle, (error: unknown) => {
					if (released) logClientError('Meeko model update failed after its component was released', error)
					else report(error)
					settle()
				})
				return
			}
			if (!controlled) return
			if (pending) reconcile()
			// The parent kept the prop: whoever shows the written value goes back to it.
			if (!Object.is(model.signal.value, next)) model.refresh()
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
				if (!pending) model.commit(resolve(value))
			})
		})
	}
	return model.signal
}
