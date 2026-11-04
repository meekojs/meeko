import type { ReadonlySignal, Signal } from '@meekojs/meeko'

/**
 * `<UIPopover>`: what `Popover.meeko` needs besides its template. The pure helpers (the keys of a
 * menu, typeahead) are tested on their own; `createPopover` wires them to the elements once the
 * component is mounted.
 *
 * Nothing here runs on the server but the computed values that the template reads: the content is
 * hidden by its `popover` attribute from the first byte, and its place comes from `popover.css` with
 * CSS anchor positioning. The offset goes through CSSOM, so a strict CSP without `'unsafe-inline'` is
 * enough.
 */
import { batch, computed, effect, untrack } from '@meekojs/meeko'

import type { PopoverMode, PopoverPlacement, PopoverRole, PopoverTrigger, UIPopoverProps } from '../types/popover'

/** The placements that `popover.css` knows. */
const placements: readonly PopoverPlacement[] = ['top', 'top-start', 'top-end', 'bottom', 'bottom-start', 'bottom-end', 'left', 'left-start', 'left-end', 'right', 'right-start', 'right-end']

/** A placement of the list, or `"bottom-start"`. */
export function popoverPlacement(value: unknown): PopoverPlacement {
	return placements.includes(value as PopoverPlacement) ? (value as PopoverPlacement) : 'bottom-start'
}

/** Text for typeahead and search: lowercase and without accents (`"Árbol"` → `"arbol"`). */
export function normalizeText(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * The item that typeahead reaches: the first one after `current` (wrapping around) whose label
 * starts with `query`, skipping those that `skip` leaves out. With the same letter repeated
 * (`"aa"`), it cycles through the items that start with that letter. `-1` when none matches.
 */
export function typeaheadIndex(labels: readonly string[], query: string, current: number, skip: (index: number) => boolean = () => false): number {
	const wanted = normalizeText(query)
	if (!wanted || !labels.length) return -1
	const same = [...wanted].every((letter) => letter === wanted[0])
	const needle = same ? wanted[0]! : wanted
	// A longer query keeps the current item while it still matches; a new or repeated letter moves on.
	const start = current < 0 ? 0 : current + (same ? 1 : 0)
	for (let step = 0; step < labels.length; step++) {
		const index = (start + step) % labels.length
		if (!skip(index) && normalizeText(labels[index]!.trim()).startsWith(needle)) return index
	}
	return -1
}

/**
 * The item that a key moves to in a list of `count` items from `current`: the arrows (wrapping
 * when `wrap`), `Home`, `End`, `PageUp` and `PageDown` (ten items), skipping those that `skip`
 * leaves out. `undefined` for any other key.
 */
export function listKeyTarget(key: string, current: number, count: number, skip: (index: number) => boolean = () => false, wrap = true): number | undefined {
	if (count === 0) return undefined
	const first = (from: number, direction: 1 | -1): number => {
		for (let index = from; index >= 0 && index < count; index += direction) if (!skip(index)) return index
		return -1
	}
	const step = (direction: 1 | -1): number => {
		for (let moved = 1; moved <= count; moved++) {
			let index = current + direction * moved
			if (index < 0 || index >= count) {
				if (!wrap) return current
				index = (index + count) % count
			}
			if (!skip(index)) return index
		}
		return current
	}
	switch (key) {
		case 'ArrowDown':
			return current < 0 ? first(0, 1) : step(1)
		case 'ArrowUp':
			return current < 0 ? first(count - 1, -1) : step(-1)
		case 'Home':
			return first(0, 1)
		case 'End':
			return first(count - 1, -1)
		case 'PageDown': {
			const target = first(Math.min(count - 1, Math.max(current, 0) + 10), -1)
			return target < 0 ? first(0, 1) : target
		}
		case 'PageUp': {
			const target = first(Math.max(0, current - 10), 1)
			return target < 0 ? first(count - 1, -1) : target
		}
		default:
			return undefined
	}
}

/** A printable key for typeahead: one character, without Control, Alt or Meta. */
export function typeaheadKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>): boolean {
	return event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.altKey && !event.metaKey
}

/** The typed characters of a typeahead, cleared after half a second without a key. */
export function createTypeahead(): { push(key: string): string; clear(): void } {
	let buffer = ''
	let timer: ReturnType<typeof setTimeout> | undefined
	return {
		push(key) {
			if (timer !== undefined) clearTimeout(timer)
			buffer += key
			timer = setTimeout(() => {
				buffer = ''
				timer = undefined
			}, 500)
			return buffer
		},
		clear() {
			if (timer !== undefined) clearTimeout(timer)
			buffer = ''
			timer = undefined
		},
	}
}

/** Whether a popover element is open (`:popover-open`, or the flag of a DOM without it). */
export function popoverOpen(element: Element): boolean {
	try {
		return element.matches(':popover-open')
	} catch {
		return element.hasAttribute('data-meeko-popover-open')
	}
}

/** Whether an element could take the focus. */
function focusable(element: Element): element is HTMLElement {
	const node = element as HTMLElement
	if (node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true' || node.hidden) return false
	return node.tabIndex >= 0 || node.hasAttribute('tabindex') || /^(?:a|button|input|select|textarea)$/.test(node.localName)
}

/** The items of a menu: its `menuitem`, `menuitemcheckbox` and `menuitemradio`, in order. */
export function menuItems(content: ParentNode): HTMLElement[] {
	return [...content.querySelectorAll<HTMLElement>('[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]')]
}

/** The hints of a document waiting for the pointer or the focus, by the `id` of their trigger. */
interface TriggerWatches {
	readonly byId: Map<string, Set<() => void>>
	release(): void
}

/** Written only from the browser, when a hint mounts: the server never touches it. */
const triggerWatches = new WeakMap<Document, TriggerWatches>()

function triggerWatchesOf(document: Document): TriggerWatches {
	const known = triggerWatches.get(document)
	if (known) return known
	const byId = new Map<string, Set<() => void>>()
	const search = (event: Event): void => {
		for (let node = event.target as Element | null; node; node = node.parentElement) {
			const waiting = node.id ? byId.get(node.id) : undefined
			if (waiting) for (const call of [...waiting]) call()
		}
	}
	document.addEventListener('pointerover', search, true)
	document.addEventListener('focusin', search, true)
	const watches: TriggerWatches = {
		byId,
		release() {
			document.removeEventListener('pointerover', search, true)
			document.removeEventListener('focusin', search, true)
			triggerWatches.delete(document)
		},
	}
	triggerWatches.set(document, watches)
	return watches
}

/**
 * Calls `reached` when the pointer or the focus reaches the element with this `id`, or something inside it.
 * The capture phase comes first, so `reached` can still give that element listeners for this same event.
 * A page with a thousand tooltips has a single pair of listeners per document, the first call adds them and
 * the last release removes them, and an event costs a lookup per ancestor, however many tooltips there are.
 */
export function watchTriggerId(document: Document, id: string, reached: () => void): () => void {
	const watches = triggerWatchesOf(document)
	const waiting = watches.byId.get(id) ?? new Set()
	watches.byId.set(id, waiting)
	waiting.add(reached)
	return () => {
		if (!waiting.delete(reached)) return
		if (waiting.size === 0) watches.byId.delete(id)
		if (watches.byId.size === 0) watches.release()
	}
}

/** What the template of `<UIPopover>` reads and the component runs. */
export interface PopoverController {
	readonly triggerId: ReadonlySignal<string>
	readonly contentId: string
	readonly mode: ReadonlySignal<PopoverMode>
	readonly role: ReadonlySignal<PopoverRole | undefined>
	readonly labelledBy: ReadonlySignal<string | undefined>
	readonly placement: ReadonlySignal<PopoverPlacement>
	readonly trigger: ReadonlySignal<PopoverTrigger>
	/** Attaches the behavior to the mounted elements; returns its cleanup. */
	mount(content: HTMLElement | null): () => void
	show(): void
	hide(): void
	toggle(): void
}

/**
 * The state of a `<UIPopover>`: the IDs and ARIA attributes the template renders (the same in
 * SSR and hydration, from `useId`), and the behavior that `mount` attaches in the browser.
 */
export function createPopover(props: UIPopoverProps, open: Signal<boolean>, id: string, emit: (open: boolean) => void): PopoverController {
	const contentId = `${id}-content`
	const triggerId = computed(() => props.triggerId ?? `${id}-trigger`)
	const mode = computed((): PopoverMode => (props.mode === 'manual' || props.mode === 'hint' ? props.mode : 'auto'))
	const role = computed((): PopoverRole | undefined => (props.role === 'menu' || props.role === 'dialog' || props.role === 'tooltip' ? props.role : mode.value === 'hint' ? 'tooltip' : undefined))
	const labelledBy = computed(() => (props.label === undefined && (role.value === 'menu' || role.value === 'dialog') ? triggerId.value : undefined))
	const placement = computed(() => popoverPlacement(props.placement))
	const trigger = computed((): PopoverTrigger => {
		const hint = mode.value === 'hint'
		return {
			id: triggerId.value,
			popovertarget: hint ? undefined : contentId,
			'aria-controls': hint ? undefined : contentId,
			'aria-expanded': hint ? undefined : open.value ? 'true' : 'false',
			'aria-haspopup': role.value === 'menu' || role.value === 'dialog' ? role.value : undefined,
			'aria-describedby': hint ? contentId : undefined,
		}
	})
	let element: HTMLElement | null = null
	/** The trigger, found by its id; again when the anchor snippet replaced it. */
	let triggerElement = (): HTMLElement | null => null
	/** Where the focus goes when a menu opens: its first or last item. */
	let pending: 'first' | 'last' = 'first'
	const show = (): void => {
		if (!element) {
			open.value = true
			return
		}
		if (!popoverOpen(element) && element.isConnected) {
			try {
				// Without `source` the content has no anchor unless the browser remembers an older one.
				element.showPopover({ source: triggerElement() ?? undefined })
			} catch {
				/* Already open, or a disconnected element: nothing to show. */
			}
		}
	}
	const hide = (): void => {
		if (!element) {
			open.value = false
			return
		}
		if (popoverOpen(element)) {
			try {
				element.hidePopover()
			} catch {
				/* Already closed. */
			}
		}
	}
	const toggle = (): void => {
		if (element ? popoverOpen(element) : open.value) hide()
		else show()
	}

	const mount = (root: HTMLElement | null): (() => void) => {
		if (!root) return () => {}
		const content: HTMLElement = root
		element = content
		const document = content.ownerDocument
		const releases: Array<() => void> = []
		const listen = <K extends string>(target: EventTarget, type: K, listener: (event: Event) => void, options?: AddEventListenerOptions): void => {
			target.addEventListener(type, listener, options)
			releases.push(() => target.removeEventListener(type, listener, options))
		}
		let anchor: HTMLElement | null = null
		let releaseTrigger = (): void => {}
		releases.push(() => releaseTrigger())
		triggerElement = (): HTMLElement | null => {
			if (anchor?.isConnected && anchor.id === untrack(() => triggerId.value)) return anchor
			releaseTrigger()
			anchor = document.getElementById(untrack(() => triggerId.value))
			if (anchor) attachTrigger(anchor)
			return anchor
		}

		// The place is CSS: only the offset, a free number, reaches the content as a custom property.
		releases.push(
			effect(() => {
				const offset = props.offset ?? 0
				if (Number.isFinite(offset) && offset > 0) content.style.setProperty('--popover-offset', `${offset}px`)
				else content.style.removeProperty('--popover-offset')
			}),
		)

		/** Moves the focus into an opened menu or dialog. */
		const focusInside = (): void => {
			const kind = untrack(() => role.value)
			if (kind === 'menu') {
				const items = menuItems(content).filter(focusable)
				for (const item of menuItems(content)) if (!item.hasAttribute('tabindex')) item.tabIndex = -1
				const target = pending === 'last' ? items.at(-1) : items[0]
				target?.focus()
			} else if (kind === 'dialog') {
				const target = content.querySelector<HTMLElement>('[autofocus]') ?? [...content.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')].find((node) => focusable(node) && node.tabIndex >= 0)
				;(target ?? content).focus()
			}
			pending = 'first'
		}
		/** Closes and gives the focus back to the trigger. */
		const closeToTrigger = (): void => {
			hide()
			triggerElement()?.focus()
		}
		/** The state that the attributes, the model and the `toggle` event last reported. */
		let last = untrack(() => open.value)
		/** Changes that `beforetoggle` announced since then: it fires on each one, `toggle` does not. */
		let started = 0
		const apply = (now: boolean): void => {
			last = now
			if (now) {
				content.setAttribute('data-open', '')
				if (untrack(() => mode.value) !== 'hint' && popoverOpen(content)) focusInside()
			} else {
				content.removeAttribute('data-open')
			}
			emit(now)
		}
		const synced = (now: boolean): void => {
			// The content closed and opened again (or the reverse) before the `toggle` event of the first
			// change: the browser coalesces both into one event whose state equals the last one reported.
			// Both changes are applied in order, the model batched so that the effect below does not act
			// on the intermediate state.
			const missed = now === last && started > 0
			started = 0
			if (missed) {
				batch(() => {
					open.value = !now
					apply(!now)
					open.value = now
					apply(now)
				})
				return
			}
			if (open.value !== now) open.value = now
			if (now !== last) apply(now)
		}
		const hinting = (): boolean => untrack(() => mode.value) === 'hint'
		// Nothing else closes a hint whose trigger left the document: no pointer leaves it. From `beforetoggle`,
		// because `toggle` comes too late for a trigger that leaves right after the opening.
		let triggerWatch: MutationObserver | undefined
		// Only while open, so that a closed tooltip costs nothing on every key of the page.
		const closeOnEscape = (event: Event): void => {
			if ((event as KeyboardEvent).key === 'Escape' && popoverOpen(content)) hide()
		}
		function watchTrigger(opening: boolean): void {
			triggerWatch?.disconnect()
			document.removeEventListener('keydown', closeOnEscape)
			if (!opening || !hinting()) return
			document.addEventListener('keydown', closeOnEscape)
			const target = triggerElement()
			if (!target || typeof MutationObserver === 'undefined') return
			triggerWatch = new MutationObserver(() => {
				if (!target.isConnected) hide()
			})
			triggerWatch.observe(document, { childList: true, subtree: true })
		}
		releases.push(() => watchTrigger(false))
		listen(content, 'beforetoggle', (event) => {
			started++
			watchTrigger((event as ToggleEvent).newState === 'open')
		})
		listen(content, 'toggle', (event) => synced((event as ToggleEvent).newState ? (event as ToggleEvent).newState === 'open' : popoverOpen(content)))

		// The model opens and closes the content.
		releases.push(
			effect(() => {
				const wanted = open.value
				untrack(() => {
					if (wanted === popoverOpen(content)) return
					if (wanted) show()
					else hide()
					// A DOM without the toggle event (a test DOM) settles the state here.
					if (popoverOpen(content) === wanted)
						queueMicrotask(() => {
							if (popoverOpen(content) === wanted) synced(wanted)
						})
				})
			}),
		)

		const typeahead = createTypeahead()
		listen(content, 'keydown', (event) => {
			const key = event as KeyboardEvent
			if (key.defaultPrevented) return
			if (key.key === 'Escape' && popoverOpen(content)) {
				key.preventDefault()
				key.stopPropagation()
				closeToTrigger()
				return
			}
			if (untrack(() => role.value) !== 'menu') return
			const items = menuItems(content)
			const current = items.indexOf((document.activeElement as HTMLElement | null) ?? content)
			const skip = (index: number): boolean => !focusable(items[index]!)
			if (key.key === 'Tab') {
				if (key.shiftKey) key.preventDefault()
				closeToTrigger()
				return
			}
			if ((key.key === 'Enter' || key.key === ' ') && current >= 0 && !/^(?:button|a)$/.test(items[current]!.localName)) {
				key.preventDefault()
				items[current]!.click()
				return
			}
			let target = listKeyTarget(key.key, current, items.length, skip)
			if (target === undefined && typeaheadKey(key)) {
				target = typeaheadIndex(
					items.map((item) => item.textContent ?? ''),
					typeahead.push(key.key),
					current,
					skip,
				)
			}
			if (target === undefined || target < 0) return
			key.preventDefault()
			items[target]!.focus()
		})
		// Choosing an item closes the menu; a checkbox or radio item keeps it open.
		listen(content, 'click', (event) => {
			if (untrack(() => role.value) !== 'menu') return
			const item = (event.target as Element | null)?.closest?.('[role=menuitem]')
			if (!item || !content.contains(item) || item.getAttribute('aria-disabled') === 'true') return
			queueMicrotask(closeToTrigger)
		})

		// Hint: hover and focus open it after a delay, without taking the focus.
		let hintTimer: ReturnType<typeof setTimeout> | undefined
		const later = (work: () => void, delay: number): void => {
			if (hintTimer !== undefined) clearTimeout(hintTimer)
			hintTimer = setTimeout(() => {
				hintTimer = undefined
				work()
			}, delay)
		}
		releases.push(() => {
			if (hintTimer !== undefined) clearTimeout(hintTimer)
		})
		listen(content, 'pointerenter', () => {
			if (hinting() && hintTimer !== undefined) clearTimeout(hintTimer)
		})
		listen(content, 'pointerleave', () => {
			if (hinting())
				later(
					hide,
					untrack(() => props.closeDelay ?? 150),
				)
		})

		// A declaration, because a model that starts open reaches it from the effect above, before this line.
		function attachTrigger(target: HTMLElement): void {
			const own: Array<() => void> = []
			const on = (type: string, listener: (event: Event) => void): void => {
				target.addEventListener(type, listener)
				own.push(() => target.removeEventListener(type, listener))
			}
			releaseTrigger = () => {
				for (const release of own.splice(0)) release()
			}
			on('keydown', (event) => {
				const key = event as KeyboardEvent
				if (key.defaultPrevented) return
				if (key.key === 'Escape' && popoverOpen(content)) {
					key.preventDefault()
					hide()
					return
				}
				if (untrack(() => role.value) !== 'menu') return
				if (key.key === 'ArrowDown' || key.key === 'ArrowUp') {
					key.preventDefault()
					pending = key.key === 'ArrowUp' ? 'last' : 'first'
					if (popoverOpen(content)) focusInside()
					else show()
				} else if (key.key === 'Enter' || key.key === ' ') pending = 'first'
			})
			on('pointerenter', () => {
				if (hinting())
					later(
						show,
						untrack(() => props.delay ?? 300),
					)
			})
			on('pointerleave', () => {
				if (hinting())
					later(
						hide,
						untrack(() => props.closeDelay ?? 150),
					)
			})
			on('focusin', () => {
				if (hinting()) {
					if (hintTimer !== undefined) clearTimeout(hintTimer)
					show()
				}
			})
			on('focusout', () => {
				if (hinting()) hide()
			})
		}
		triggerElement()
		// A trigger replaced under the same `id` (an `if:when` in the anchor snippet) is found when it is reached.
		const reached = (): void => {
			if (!anchor?.isConnected) triggerElement()
		}
		let stopWatchingId = (): void => {}
		releases.push(() => stopWatchingId())
		// Another `triggerId` moves the listeners and closes the hint. The template writes the new `id` in
		// the same flush, so the search waits for it.
		releases.push(
			effect(() => {
				const id = triggerId.value
				const hint = mode.value === 'hint'
				stopWatchingId()
				stopWatchingId = hint ? watchTriggerId(document, id, reached) : () => {}
				if (id === anchor?.id) return
				queueMicrotask(() => {
					if (element !== content) return
					const before = anchor
					if (triggerElement() !== before && before && hinting()) hide()
				})
			}),
		)
		if (untrack(() => open.value) && !popoverOpen(content)) show()
		// A model that starts open shows the content while mounting: not a change to report.
		started = 0
		return () => {
			for (const release of releases.splice(0).reverse()) release()
			typeahead.clear()
			element = null
			triggerElement = () => null
		}
	}

	return { triggerId, contentId, mode, role, labelledBy, placement, trigger, mount, show, hide, toggle }
}
