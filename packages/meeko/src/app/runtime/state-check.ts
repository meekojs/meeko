/**
 * Type-only check of what travels with the SSR state. A component module is code: it can never be
 * sent to the browser, so a signal of a component script or a `useState` that starts with one fails
 * in every server render. The check reads the initial value, not the type of the signal, so
 * `signal<ResolvedComponent | undefined>(undefined)`, which the browser fills later, stays valid.
 */

/** Anything with the render entry of a compiled component, also `Component<Props>`. */
interface ComponentModuleShape {
	readonly renderToString: (...args: never[]) => unknown
}

/** How deep the check looks inside the objects and arrays of a value. */
type StateDepth = [unknown, unknown, unknown, unknown, unknown]

/** Whether a value that is not a union holds a module: itself, an element of an array or a property. */
type MemberHoldsModule<V, Depth extends unknown[]> = V extends ComponentModuleShape ? true : V extends (...args: never[]) => unknown ? false : V extends readonly (infer Element)[] ? HoldsModule<Element, [...Depth, unknown]> : V extends object ? (true extends { [K in keyof V]-?: HoldsModule<V[K], [...Depth, unknown]> }[keyof V] ? true : false) : false

/**
 * Whether a value always holds a component module. A union counts only when every member does:
 * `AppCard | undefined` may be `undefined` in the server render, which fails nothing.
 */
export type HoldsModule<V, Depth extends unknown[] = []> = 0 extends 1 & V ? false : [V] extends [never] ? false : Depth['length'] extends StateDepth['length'] ? false : false extends (V extends unknown ? MemberHoldsModule<V, Depth> : never) ? false : true

/** Type text of MEEK136 for an initial value that holds a component module. */
export type StateModuleCheck<V> = HoldsModule<V> extends true ? 'MEEK136: un módulo de componente no puede viajar con el estado' : unknown

/** Type-only check of the initial value of a signal of the script; returns `value`. Only in the code of the type check. */
export function checkSignalState<V>(value: V, check: NoInfer<StateModuleCheck<V>>): V {
	void check
	return value
}

/** Type-only check of the factory of a `useState`; returns `factory`. Only in the code of the type check. */
export function checkStateFactory<V>(factory: () => V, check: NoInfer<StateModuleCheck<V>>): () => V {
	void check
	return factory
}

/** Path of the first component module in a value, such as `options[0].component`, or `undefined`. */
export function componentModulePath(value: unknown, path: string, seen: WeakSet<object> = new WeakSet()): string | undefined {
	if (value === null || typeof value !== 'object' || seen.has(value)) return undefined
	seen.add(value)
	if (typeof (value as { renderToString?: unknown }).renderToString === 'function') return path
	for (const [key, item] of Object.entries(value)) {
		const found = componentModulePath(item, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, seen)
		if (found) return found
	}
	return undefined
}

/** Text of the MEEK136 error at run time, for a module found in the state at `path`. */
export function stateModuleMessage(owner: string, path: string): string {
	return `MEEK136: ${owner} guarda un módulo de componente en ${path}, y un módulo es código: no puede viajar al navegador con el estado del SSR. Guarda en el estado qué entradas se pintan y léelas con un computed, o asígnalo sólo en el navegador partiendo de undefined`
}
