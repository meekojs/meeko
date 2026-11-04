/**
 * IDs that the server render and the browser hydration agree on. An ID is made of the
 * application prefix, the position of the component instance in the tree (the IDs of the component
 * markers of each template, the keys of the `each` rows and the snippet regions that lead to it) and
 * the order of the call inside that instance's script. Every render and its hydration walk the same
 * positions, so they produce the same IDs without sending them to the browser.
 */

/** Prefix and tree position of the template that is rendering or hydrating. */
export interface IdBase {
	readonly prefix: string
	/** `""` for a root; each level adds `/` and a segment. */
	readonly path: string
}

/** Prefix of the IDs when the application does not configure `document.idPrefix`. */
export const defaultIdPrefix = 'm'

const idStateKey = Symbol.for('meeko.ids')

interface IdState {
	/** Position of the template that is rendering or hydrating. */
	base: IdBase
	/** The component instance whose script is running, with the number of IDs it has taken. */
	instance: { readonly base: IdBase; next: number } | undefined
	/** IDs taken outside a component script: unique in this process, not shared with hydration. */
	loose: number
}

/**
 * One state for every copy of the runtime in the process or the page: the framework server and the
 * components may load Meeko in separate module graphs (Vite's SSR graph, a linked package), and
 * the render that one copy positions must reach the `useId` of the other. It only changes
 * synchronously, while a render or a hydration runs.
 */
const state: IdState = ((globalThis as { [idStateKey]?: IdState })[idStateKey] ??= { base: { prefix: defaultIdPrefix, path: '' }, instance: undefined, loose: 0 })

/** Takes the next ID for the current component instance or a process-local loose ID. */
export function nextId(): string {
	const instance = state.instance
	if (!instance) return `${state.base.prefix}-u${(state.loose++).toString(36)}`
	return formatId(instance.base, instance.next++)
}

/** Starts the IDs of a component instance whose script is about to run; returns the restore. */
export function enterIdInstance(): () => void {
	const previous = state.instance
	state.instance = { base: state.base, next: 0 }
	return () => {
		state.instance = previous
	}
}

/** Position of the template that is rendering or hydrating, to capture it in a binding. */
export function currentIdBase(): IdBase {
	return state.base
}

/** Position of `segment` (a component marker, a list row or a snippet region) inside `parent`. */
export function childIdBase(parent: IdBase, segment: string): IdBase {
	return { prefix: parent.prefix, path: `${parent.path}/${segment}` }
}

/** Runs `work` with `next` as the position of the template. */
export function withIdBase<T>(next: IdBase, work: () => T): T {
	const previous = state.base
	state.base = next
	try {
		return work()
	} finally {
		state.base = previous
	}
}

/** Runs a root render or hydration of an application whose IDs start with `prefix`. */
export function withIdRoot<T>(prefix: string | undefined, work: () => T): T {
	return withIdBase({ prefix: prefix ?? defaultIdPrefix, path: '' }, work)
}

/** A path whose segments are letters and digits stays readable; any other is hashed. */
function formatId(at: IdBase, index: number): string {
	const counter = index.toString(36)
	if (at.path === '') return `${at.prefix}-${counter}`
	const readable = at.path.length <= 40 && /^(?:\/[A-Za-z0-9]+)+$/.test(at.path)
	return `${at.prefix}-${readable ? at.path.slice(1).replaceAll('/', '_') : `h${hashPath(at.path)}`}-${counter}`
}

/** Two 32-bit FNV-1a hashes with different offsets: 64 bits, so distinct rows do not collide. */
function hashPath(path: string): string {
	let first = 0x811c9dc5
	let second = 0x01000193 ^ 0x5bd1e995
	for (let index = 0; index < path.length; index++) {
		const code = path.charCodeAt(index)
		first = Math.imul(first ^ code, 0x01000193)
		second = Math.imul(second ^ code, 0x01000193) ^ (second >>> 15)
	}
	return (first >>> 0).toString(36) + (second >>> 0).toString(36).padStart(7, '0')
}
