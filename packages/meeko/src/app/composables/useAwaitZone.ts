import type { ReadonlySignal } from '../../core/reactivity'
import type { HeadInput } from '../../shared/head'
import type { AwaitMessages, AwaitProps, AwaitState } from '../runtime/await'

import { computed, effect, isDryRender, untrack } from '../../core/reactivity'
import { useHead } from '../composables/use-head'
import { awaitRequestKeys, awaitResources, awaitStatus, hasData, minimumRule, prepareReserve, rememberHeight, reserveEnabled, reserveMinimum, reserveScript, reserveZoneKey } from '../runtime/await'
import { onMounted, setupPhase } from '../runtime/lifecycle'
/** Render-scoped state, reserve and focus for the built-in <MeekoAwait> component. */
import { useId } from './useId'
import { useRoute } from './useRoute'
import { currentBrowser } from './useStorage'

/** Key of the reserve entries in <head>. */
const HEAD_KEY = 'meeko:await'

/** The defaults of {@link AwaitMessages}. */
const defaultMessages: Required<AwaitMessages> = { error: 'No se pudieron cargar los datos.', retry: 'Reintentar' }

/** What the template of `<MeekoAwait>` reads. */
export interface AwaitZone {
	readonly state: ReadonlySignal<AwaitState>
	readonly refreshing: ReadonlySignal<boolean>
	/** `"true"` while the zone loads or reloads, for `aria-busy`. */
	readonly busy: ReadonlySignal<'true' | undefined>
	/** The failure that the `error` snippet receives; only read in the `error` state. */
	readonly error: ReadonlySignal<Error>
	/** `data-meeko-reserve`: the key of the zone in the memory, with `reserve`. */
	readonly reserve: ReadonlySignal<string | undefined>
	/** `data-meeko-reserve-min`: the explicit minimum of `reserve="320px"`. */
	readonly minimum: ReadonlySignal<string | undefined>
	readonly messages: ReadonlySignal<Required<AwaitMessages>>
	/** Asks again for the data of every failed resource without data. */
	retry(): void
}

/** The current route, or none outside an application of Meeko (a plain `renderToString`). */
function routeOrNone(): ReturnType<typeof useRoute> | undefined {
	try {
		return useRoute()
	} catch {
		return undefined
	}
}

/** The head entries of a zone with `reserve`: the script of the memory and the style of its minimum. */
function reserveHead(minimum: string | undefined): HeadInput {
	return {
		script: [{ key: HEAD_KEY, children: reserveScript }],
		...(minimum ? { style: [{ key: `${HEAD_KEY}:${minimum}`, children: minimumRule(minimum) }] } : {}),
	}
}

/**
 * The setup of `<MeekoAwait>`: its state, the reserve of its zone and the focus. `box` is the
 * container element, once mounted.
 */
export function useAwaitZone(props: AwaitProps, box: ReadonlySignal<Element | null | undefined>): AwaitZone {
	const phase = setupPhase()
	const dry = isDryRender()
	const resources = computed(() => awaitResources(props.for))
	const status = computed(() => awaitStatus(resources.value))
	const state = computed(() => status.value.state)
	const refreshing = computed(() => status.value.state === 'ready' && status.value.refreshing)
	const busy = computed(() => (state.value === 'pending' || refreshing.value ? ('true' as const) : undefined))
	const error = computed(() => status.value.error ?? new Error(defaultMessages.error))
	const messages = computed(() => ({ error: props.messages?.error ?? defaultMessages.error, retry: props.messages?.retry ?? defaultMessages.retry }))
	const retry = (): void => {
		for (const resource of untrack(() => resources.value)) {
			if (untrack(() => !hasData(resource) && resource.error.value && !resource.pending.value)) void resource.refresh()
		}
	}

	// The reserve: a key per route, requests and instance, and the head script that applies it.
	const minimum = computed(() => reserveMinimum(props.reserve))
	const route = routeOrNone()
	// The instance is the position of the zone in the tree (`useId`): the same in SSR, hydration and
	// a later visit, and its own for two zones of the same requests on one page.
	const instance = useId()
	const reserve = computed(() => (reserveEnabled(props.reserve) ? reserveZoneKey(route?.path.value ?? '', awaitRequestKeys(resources.value), instance) : undefined))
	// `bind:reserve` may change: the head script, the rules and the measurement follow it.
	const reserving = computed(() => reserveEnabled(props.reserve))
	if (!dry) useHead(() => (reserving.value ? reserveHead(minimum.value) : {}))
	const browser = currentBrowser()
	// Before the zone is inserted (a navigation, a late mount): the rules exist when it is painted.
	if (browser && !dry)
		effect(() => {
			if (reserving.value) prepareReserve(browser, minimum.value)
		})

	if (phase === 'mount' && !dry) {
		// Measure only with data, after layout (ResizeObserver), never blocking the render.
		onMounted(() => {
			const element = untrack(() => box.value)
			const view = element?.ownerDocument.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null | undefined
			const Observer = view?.ResizeObserver
			if (!element || !view || !Observer) return
			let observer: ResizeObserver | undefined
			// A new state or zone measures again, even when its size did not change; no zone, no observer.
			const stop = effect(() => {
				void state.value
				if (!reserve.value) {
					observer?.disconnect()
					observer = undefined
					return
				}
				if (observer) observer.unobserve(element)
				else {
					observer = new Observer((entries) => {
						const zone = untrack(() => reserve.value)
						const entry = entries.at(-1)
						if (!zone || !entry || untrack(() => state.value) !== 'ready') return
						const borderBox = view.getComputedStyle(element).boxSizing === 'border-box'
						const size = (borderBox ? entry.borderBoxSize : entry.contentBoxSize)?.[0]?.blockSize ?? (borderBox ? element.getBoundingClientRect().height : entry.contentRect.height)
						rememberHeight(view, zone, size)
					})
				}
				observer.observe(element)
			})
			return () => {
				stop()
				observer?.disconnect()
			}
		})
		// The focus never falls to <body>: when the node that had it leaves (a retry button, a
		// focusable skeleton), the zone takes it, without scrolling.
		let previous = untrack(() => state.value)
		effect(() => {
			const next = state.value
			if (next === previous) return
			previous = next
			const element = untrack(() => box.value)
			const document = element?.ownerDocument
			const active = document?.activeElement
			if (!element || !document || !active || active === element || !element.contains(active)) return
			queueMicrotask(() => {
				if (!element.isConnected) return
				const now = document.activeElement
				if (now && now !== document.body && now.isConnected) return
				if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1')
				;(element as HTMLElement).focus({ preventScroll: true })
			})
		})
	}
	return { state, refreshing, busy, error, reserve, minimum, messages, retry }
}
