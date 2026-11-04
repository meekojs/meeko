import type { Signal } from '@meekojs/meeko'

import { computed, effect, signal, untrack } from '@meekojs/meeko'

import type { UITabsItem, UITabsProps } from '../types/tabs'

import { listKeyTarget } from './popover'
import { withViewTransition } from './view-transition'

/**
 * The tab that a key moves to from `current`, as the ARIA tabs pattern does: the arrows wrap and skip
 * disabled tabs, and in a right-to-left document the left arrow goes forward. `undefined` for any other key.
 */
export function tabsKeyTarget(key: string, current: number, disabled: readonly boolean[], rtl = false): number | undefined {
	const forward = rtl ? 'ArrowLeft' : 'ArrowRight'
	const back = rtl ? 'ArrowRight' : 'ArrowLeft'
	const mapped = key === forward ? 'ArrowDown' : key === back ? 'ArrowUp' : key === 'Home' || key === 'End' ? key : undefined
	return mapped && listKeyTarget(mapped, current, disabled.length, (index) => disabled[index] === true)
}

/** The value that a list of tabs shows: `value` if it can be chosen, or the first tab that can. */
export function selectedTab<Value extends string>(items: readonly UITabsItem<Value>[], value: Value | undefined): Value | undefined {
	return items.some((item) => item.value === value && !item.disabled) ? value : items.find((item) => !item.disabled)?.value
}

/** What the template of `<UITabs>` reads and the component runs. */
export function createTabs<Value extends string>(props: UITabsProps<Value>, model: Signal<Value | undefined>, id: string, emit: (value: Value) => void) {
	/** What is on screen: the model, once the View Transition has captured the page before the change. */
	const shown = signal(untrack(() => model.value))
	const selected = computed(() => selectedTab(props.items, shown.value))
	const position = (item: UITabsItem<Value>): number => props.items.indexOf(item)
	const choose = (item: UITabsItem<Value>): void => {
		if (item.disabled || item.value === selected.value) return
		model.value = item.value
		emit(item.value)
	}
	const keydown = (event: KeyboardEvent): void => {
		const list = event.currentTarget as HTMLElement
		const tabs = [...list.querySelectorAll<HTMLElement>('[role=tab]')]
		const rtl = list.ownerDocument.defaultView?.getComputedStyle(list).direction === 'rtl'
		const target = tabsKeyTarget(
			event.key,
			tabs.indexOf(event.target as HTMLElement),
			props.items.map((item) => item.disabled === true),
			rtl,
		)
		if (target === undefined || target < 0) return
		event.preventDefault()
		tabs[target]?.focus()
		choose(props.items[target]!)
	}
	/** Whichever way the model changes, the indicator moves; only this group gives it a name meanwhile. */
	const mount = (root: HTMLElement | null): (() => void) => {
		let moving = 0
		return effect(() => {
			const next = model.value
			untrack(() => {
				if (next === shown.value) return
				moving++
				root?.setAttribute('data-ui-tabs-active', '')
				const done = (): void => {
					if (--moving === 0) root?.removeAttribute('data-ui-tabs-active')
				}
				const transition = withViewTransition(
					() => {
						shown.value = next
					},
					{ types: ['ui-tab'] },
				)
				if (transition) void transition.finished.then(done, done)
				else done()
			})
		})
	}
	return { selected, choose, keydown, mount, tabId: (item: UITabsItem<Value>): string => `${id}-tab-${position(item)}`, panelId: (item: UITabsItem<Value>): string => `${id}-panel-${position(item)}` }
}
