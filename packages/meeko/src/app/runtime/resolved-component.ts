import type { ComponentModule } from './renderer'

/** The render and tag contracts of a module whose required props have already been supplied. */
type BoundRender<Method> = Method extends (props: infer Props, ...rest: infer Rest) => infer Result ? (props?: Partial<Props>, ...rest: Rest) => Result : Method
type BoundHydrate<Method> = Method extends (target: infer Target, props: infer Props, ...rest: infer Rest) => infer Result ? (target: Target, props?: Partial<Props>, ...rest: Rest) => Result : Method

/** A renderable module with defaults for all its props; models, snippets and exposed values retain their contracts. */
export type ComponentWithProps<Module> = {
	[Key in keyof Module]: Key extends 'renderToString' | 'renderWithState' | '__meekoTag' ? BoundRender<Module[Key]> : Key extends 'hydrate' | 'hydrateScope' ? BoundHydrate<Module[Key]> : Module[Key]
}

interface Binding {
	readonly component: object
	readonly props: object
}
const bindings = new WeakMap<object, Binding>()

/** Combines bound defaults with explicit template props before creating the child's reactive view. */
export function resolvedComponentInput<Props extends object>(component: ComponentModule<Props>, props: Props): { component: ComponentModule<Props>; props: Props } | undefined {
	const binding = bindings.get(component)
	if (!binding) return undefined
	return { component: binding.component as ComponentModule<Props>, props: { ...binding.props, ...props } }
}

/** @internal Creates a fresh binding per resolver call; the cached original module is never modified. */
export function withComponentProps<Module>(component: Module, props: object): ComponentWithProps<Module> {
	if (typeof props !== 'object' || props === null || Array.isArray(props)) throw new TypeError('resolveComponent props must be an object')
	if (typeof component !== 'object' || component === null) throw new TypeError('resolveComponent must load a component module')
	const defaults = { ...props }
	const bound = Object.create(null) as object
	// Forward public exports and metadata without copying the module's mutable live bindings.
	for (const key of Reflect.ownKeys(component)) {
		Object.defineProperty(bound, key, {
			get: () => Reflect.get(component, key),
			enumerable: Object.getOwnPropertyDescriptor(component, key)?.enumerable ?? false,
			configurable: true,
		})
	}
	for (const [name, position] of [
		['renderToString', 0],
		['renderWithState', 0],
		['hydrate', 1],
		['hydrateScope', 1],
	] as const) {
		if (typeof Reflect.get(component, name) !== 'function') continue
		Object.defineProperty(bound, name, {
			value: (...args: unknown[]) => {
				args[position] = { ...defaults, ...(args[position] as object | undefined) }
				return Reflect.apply(Reflect.get(component, name) as (...args: unknown[]) => unknown, component, args)
			},
			enumerable: true,
			configurable: true,
		})
	}
	bindings.set(bound, { component, props: defaults })
	return Object.freeze(bound) as ComponentWithProps<Module>
}
