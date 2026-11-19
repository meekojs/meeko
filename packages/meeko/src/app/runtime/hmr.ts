import type { DomScope } from './renderer'

import { captureParentOwner, isExternalSignal, isWritableSignal, restoreSignal } from '../../core/reactivity'
import { serializeJson } from '../../core/server'
import { borrowedKey } from './models'
import { parseRegionHtml } from './renderer'
import { componentModulePath, stateModuleMessage } from './state-check'
import { lateRender } from './suspense'

/**
 * Valores de las señales editables de un componente, por nombre, que HMR transfiere en memoria
 * entre dos versiones del módulo. Es independiente del estado JSON que viaja del servidor al
 * navegador.
 *
 * @example
 * ```ts
 * import type { HotState } from "@meekojs/meeko";
 *
 * // Lo que conserva un contador al editar su .meeko durante el desarrollo.
 * const state: HotState = { count: 3 };
 * ```
 */
export type HotState = Record<string, unknown>

/** Contrato mínimo de un módulo Meeko reemplazable en desarrollo. */
export interface HotComponent<Props = unknown> {
	renderToString(props: Props, state?: HotState): string
	hydrate(root: Element, props: Props, state?: HotState): () => void
	hydrateScope?(scope: DomScope, props: Props, state?: HotState): () => void
	css?: string
}

interface HotInstance {
	target: { kind: 'root'; root: Element } | { kind: 'scope'; scope: DomScope }
	props: unknown
	component: HotComponent
	snapshot: () => HotState
	dispose: () => void
	withParent: <T>(work: () => T) => T
}

interface HotSlot {
	current: HotInstance
	stop: () => void
	forget: () => void
}

const enabled = new Set<string>()
const instances = new Map<string, Map<Element | Comment, HotSlot>>()

/** Copia solo las señales editables de un setup, sin serializarlas. */
export function snapshotSignals(bindings: Record<string, unknown>): HotState {
	const state: HotState = {}
	// Models shared by the parent belong to the parent's state, not to this instance's.
	const borrowed = (bindings as { [borrowedKey]?: ReadonlySet<unknown> })[borrowedKey]
	for (const [name, value] of Object.entries(bindings)) {
		// A signal kept outside the component (useStorage) has its own source of truth.
		if (isWritableSignal(value) && !borrowed?.has(value) && !isExternalSignal(value)) state[name] = value.value
	}
	return state
}

/**
 * Key of the transferred state that lists the signals holding `undefined`, which JSON cannot carry.
 * It is not an identifier, so no binding of a component can have that name.
 */
const undefinedKey = 'meeko:undefined'

/**
 * The editable signals of a server render, as they travel to the browser: checked as JSON, with
 * the signals that hold `undefined` listed under {@link undefinedKey}. A value that JSON cannot
 * carry fails with the component and the signal. The generated `renderWithState` calls it.
 */
export function transferState(bindings: Record<string, unknown>, component: string): HotState {
	const state: HotState = {}
	const missing: string[] = []
	for (const [name, value] of Object.entries(snapshotSignals(bindings))) {
		if (value === undefined) {
			missing.push(name)
			continue
		}
		try {
			serializeJson({ [name]: value })
		} catch (error) {
			const module = componentModulePath(value, name)
			if (module) throw new TypeError(`${component}: ${stateModuleMessage(`la señal "${name}"`, module)}`, { cause: error })
			const reason = error instanceof Error ? error.message : String(error)
			throw new TypeError(`${component}: the signal "${name}" cannot be sent to the browser with the SSR state (${reason}). ` + 'The signals of a component script travel as JSON: keep strings, finite numbers, booleans, null, arrays and plain objects in them, or undefined as the whole value ' + '(a Date as an ISO string, a Map as an object), or keep the value out of the state: only the writable signals declared at the top level of the script travel, not a constant, a computed or a signal kept inside an object.', { cause: error })
		}
		state[name] = value
	}
	if (missing.length) state[undefinedKey] = missing
	return state
}

/** Restaura señales compatibles antes de renderizar o hidratar la nueva versión. */
export function restoreSignals(bindings: Record<string, unknown>, state?: HotState): void {
	if (!state) return
	const borrowed = (bindings as { [borrowedKey]?: ReadonlySet<unknown> })[borrowedKey]
	const restore = (name: string, value: unknown): void => {
		const target = bindings[name]
		if (isWritableSignal(target) && !isExternalSignal(target) && !borrowed?.has(target)) restoreSignal(target, value)
	}
	for (const [name, value] of Object.entries(state)) {
		if (name === undefinedKey) continue
		restore(name, value)
	}
	// Signals that held `undefined` in the server render (see `transferState`).
	const missing = state[undefinedKey]
	if (Array.isArray(missing)) for (const name of missing) if (typeof name === 'string') restore(name, undefined)
}

/** Activa el seguimiento de instancias solo para módulos servidos por Vite. */
export function enableHotModule(id: string): void {
	enabled.add(id)
}

function registerHotTarget<Props>(id: string, key: Element | Comment, target: HotInstance['target'], props: Props, component: HotComponent<Props>, snapshot: () => HotState, dispose: () => void): () => void {
	if (!enabled.has(id)) return dispose
	const entry: HotInstance = { target, props, component: component as HotComponent, snapshot, dispose, withParent: captureParentOwner() }
	let group = instances.get(id)
	if (!group) {
		group = new Map()
		instances.set(id, group)
	}
	const existing = group.get(key)
	if (existing) {
		existing.current = entry
		return existing.stop
	}
	const slot: HotSlot = {
		current: entry,
		forget: () => {
			if (group.get(key) !== slot) return
			group.delete(key)
			if (group.size === 0) instances.delete(id)
		},
		stop: () => {
			if (group.get(key) !== slot) return
			slot.forget()
			slot.current.dispose()
		},
	}
	group.set(key, slot)
	return slot.stop
}

/** Registra una raíz hidratada y elimina el registro al liberarla. */
export function registerHotInstance<Props>(id: string, root: Element, props: Props, component: HotComponent<Props>, snapshot: () => HotState, dispose: () => void): () => void {
	return registerHotTarget(id, root, { kind: 'root', root }, props, component, snapshot, dispose)
}

/** Registra un componente hijo delimitado por comentarios para actualizarlo sin tocar al padre. */
export function registerHotScope<Props>(id: string, scope: DomScope, props: Props, component: HotComponent<Props>, snapshot: () => HotState, dispose: () => void): () => void {
	if (!scope.start || !scope.end) throw new Error('Hot child component requires a bounded scope')
	return registerHotTarget(id, scope.start, { kind: 'scope', scope }, props, component, snapshot, dispose)
}

function scopeRange(scope: DomScope): Range {
	if (!scope.start || !scope.end) throw new Error('Hot child component lost its markers')
	const range = scope.start.ownerDocument.createRange()
	range.setStartAfter(scope.start)
	range.setEndBefore(scope.end)
	return range
}

function replaceScope(scope: DomScope, html: string): void {
	const range = scopeRange(scope)
	// Same parser as a late mount: the scripts of `html="..."` content never run.
	const content = parseRegionHtml(scope.start!.parentNode!, html)
	range.deleteContents()
	range.insertNode(content)
}

/** Aplica CSS nuevo después de la hoja virtual cargada por Vite. */
export function replaceHotStyle(id: string, css: string): void {
	if (typeof document === 'undefined') return
	// Module IDs are file paths and may contain CSS selector metacharacters.
	let style = [...document.querySelectorAll<HTMLStyleElement>('style[data-meeko-hot]')].find((candidate) => candidate.dataset.meekoHot === id)
	if (!style) {
		style = document.createElement('style')
		style.dataset.meekoHot = id
		document.head.appendChild(style)
	}
	style.textContent = css
}

/**
 * Some instance of a hot module could be neither updated nor restored: it is no longer live, and
 * only a full reload brings it back (see {@link acceptHotModule}).
 */
export class HotRecoveryError extends AggregateError {}

/**
 * HTML of a hot instance rendered in the browser, as a region that mounts after its page: state
 * that exists only in the browser (`useStorage`, the theme) shows its current value instead of the
 * SSR one, so the hydration that follows matches the DOM it has just inserted. The live DOM may
 * have diverged from the SSR long ago, so it is never hydrated as is.
 */
function renderHot(entry: HotInstance, component: HotComponent, state: HotState): string {
	return entry.withParent(() => lateRender(() => component.renderToString(entry.props, state)))
}

function mountHot(entry: HotInstance, component: HotComponent, state: HotState, content: string | DocumentFragment): void {
	if (entry.target.kind === 'root') {
		const { root } = entry.target
		if (typeof content === 'string') root.innerHTML = content
		else root.replaceChildren(content)
		entry.withParent(() => component.hydrate(root, entry.props, state))
		return
	}
	const hydrateScope = component.hydrateScope
	if (!hydrateScope) throw new Error('Updated Meeko child component has no hydrateScope export')
	const { scope } = entry.target
	if (typeof content === 'string') replaceScope(scope, content)
	else {
		const range = scopeRange(scope)
		range.deleteContents()
		range.insertNode(content)
	}
	entry.withParent(() => hydrateScope(scope, entry.props, state))
}

/**
 * Sustituye las instancias activas sin recargar la página y conserva señales editables. Cada
 * instancia se libera y se vuelve a montar en el navegador: la nueva versión renderiza con el estado
 * actual del cliente y se hidrata contra ese HTML, nunca contra un DOM que ya divergió del SSR. Si
 * falla, las instancias vuelven a la versión anterior y el error se relanza; si tampoco se pueden
 * restaurar, lanza {@link HotRecoveryError}.
 */
export function replaceHotModule(id: string, next: unknown): void {
	const component = hotComponent(next)
	// Every snapshot first: releasing one instance may change what another one holds.
	const prepared = [...(instances.get(id)?.values() ?? [])].map((slot) => {
		const entry = slot.current
		const state = entry.snapshot()
		const previous = entry.target.kind === 'root' ? entry.target.root.innerHTML : scopeRange(entry.target.scope).cloneContents()
		return { slot, entry, state, previous }
	})
	type Prepared = (typeof prepared)[number]
	const committed: Prepared[] = []
	const rollback = ({ slot, entry, state, previous }: Prepared, failures: unknown[]): void => {
		const partial = slot.current !== entry ? slot.current : undefined
		if (partial) {
			try {
				partial.dispose()
			} catch (cleanupError) {
				failures.push(cleanupError)
			}
		}
		try {
			let content: string | DocumentFragment
			try {
				content = renderHot(entry, entry.component, state)
			} catch {
				// The previous version no longer renders here: hydrate the nodes it left.
				content = typeof previous === 'string' ? previous : (previous.cloneNode(true) as DocumentFragment)
			}
			mountHot(entry, entry.component, state, content)
			if (slot.current === entry || slot.current === partial) throw new Error('Restored Meeko component did not register its hydrated instance')
		} catch (rollbackError) {
			failures.push(rollbackError)
			if (slot.current !== entry && slot.current !== partial) {
				try {
					slot.current.dispose()
				} catch (cleanupError) {
					failures.push(cleanupError)
				}
			}
			slot.forget()
		}
	}
	for (const item of prepared) {
		const { slot, entry, state } = item
		try {
			// Released before rendering: the new version acquires browser state (useStorage) afresh.
			entry.dispose()
			mountHot(entry, component, state, renderHot(entry, component, state))
			if (slot.current === entry) throw new Error('Updated Meeko component did not register its hydrated instance')
			committed.push(item)
		} catch (error) {
			const failures: unknown[] = [error]
			rollback(item, failures)
			for (const previous of committed.reverse()) rollback(previous, failures)
			if (failures.length === 1) throw error
			throw new HotRecoveryError(failures, 'Meeko hot replacement and recovery failed')
		}
	}
	replaceHotStyle(id, component.css ?? '')
}

function hotComponent(next: unknown): HotComponent {
	if (typeof next !== 'object' || next === null || !('renderToString' in next) || !('hydrate' in next) || typeof next.renderToString !== 'function' || typeof next.hydrate !== 'function') {
		throw new TypeError('Invalid Meeko hot module')
	}
	return next as HotComponent
}

/** Opciones de {@link acceptHotModule}. */
export interface AcceptHotOptions {
	/** Sólo cambió el CSS del componente: se sustituye la hoja y las instancias siguen montadas. */
	readonly styleOnly?: boolean
	/** Recarga completa cuando una instancia queda sin recuperar; por defecto `location.reload()`. */
	readonly reload?: () => void
	/** Destino de los fallos; por defecto `console.error`. */
	readonly report?: (message: string, error: unknown) => void
}

/**
 * Aplica la versión nueva de un módulo `.meeko` que Vite envía por HMR. Un cambio que sólo toca
 * `<style>` sustituye la hoja sin volver a montar las instancias. Si la actualización falla, las
 * instancias siguen con la versión anterior y el fallo se informa; si alguna no se puede
 * restaurar, la página se recarga entera en lugar de dejar el componente sin actualizar.
 */
export function acceptHotModule(id: string, next: unknown, options: AcceptHotOptions = {}): void {
	const report = options.report ?? ((message: string, error: unknown) => console.error(message, error))
	try {
		const component = hotComponent(next)
		if (options.styleOnly) {
			replaceHotStyle(id, component.css ?? '')
			return
		}
		replaceHotModule(id, component)
	} catch (error) {
		if (error instanceof HotRecoveryError || (error instanceof TypeError && error.message === 'Invalid Meeko hot module')) {
			report(`[meeko] Hot update of ${id} failed and could not be undone; reloading the page.`, error)
			;(options.reload ?? (() => location.reload()))()
			return
		}
		report(`[meeko] Hot update of ${id} failed; the previous version stays mounted. Save the file again once it is fixed.`, error)
	}
}
