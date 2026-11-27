import type { Signal } from '@meekojs/meeko'

/**
 * `<UISelect>`: what `Select.meeko` needs besides its template. It is a combobox that only selects, so its
 * state, its keyboard and its list are the ones of `createCombobox` (./combobox.ts) with one value and no
 * search. What is its own stays here: a trigger that the browser opens by itself until the script arrives
 * (`popovertarget`), the focus back on the trigger after a choice, and the reset of its form.
 */
import { computed, untrack } from '@meekojs/meeko'

import type { ComboboxSettings } from '../types/combobox'
import type { SelectEntry, SelectOptionState, SelectSettings } from '../types/select'

import { createCombobox } from './combobox'

/** What the template of `<UISelect>` reads and the component runs. */
export function createSelect<T>(props: SelectSettings<T>, model: Signal<unknown>, id: string, emit: (value: unknown) => void) {
	// The props that belong to <UICombobox> are a type error here; without the types they would still arrive.
	const settings = Object.create(props, { multiple: { value: false }, searchable: { value: false }, filter: { value: undefined }, max: { value: undefined } }) as ComboboxSettings<T>
	const list = createCombobox<T>(settings, model, id, emit)
	const chosen = computed(() => list.selected.value.length > 0)
	/** The chosen option, for the `value` snippet; only read while there is one. */
	const value = computed(() => list.selected.value[0] as T)
	const stateOf = (entry: SelectEntry<T>): SelectOptionState => ({ selected: list.isSelected(entry), disabled: entry.disabled })

	let root: HTMLElement | null = null
	const focusTrigger = (): void => root?.querySelector<HTMLElement>('[data-meeko-select-trigger]')?.focus()
	/**
	 * `popovertarget` opens the list while there is no script, and tells the browser that a press on the
	 * trigger is not a press outside the list. Once the script is here it opens and closes, with its state.
	 */
	const triggerClick = (event: Event): void => {
		event.preventDefault()
		list.triggerClick()
	}
	/** A choice closes the list: the focus goes back to the trigger, also where a press does not focus a button. */
	const optionClick = (event: Event): void => {
		list.optionClick(event)
		if (!list.open.value) focusTrigger()
	}

	/** In the browser: what `createCombobox` attaches, and the reset of the form that holds the select. */
	const mount = (element: HTMLElement | null): (() => void) => {
		const release = list.mount(element)
		if (!element) return release
		root = element
		// A reset goes back to the value the select was mounted with, as in a native control, and tells the model.
		const initial = untrack(list.current)
		const form = element.closest('form')
		const reset = (event: Event): void => {
			if (event.defaultPrevented) return
			list.close()
			list.failed.value = false
			if (!Object.is(untrack(list.current), initial)) list.write(initial)
		}
		form?.addEventListener('reset', reset)
		return () => {
			form?.removeEventListener('reset', reset)
			release()
			root = null
		}
	}

	return {
		listboxId: list.listboxId,
		triggerId: list.triggerId,
		triggerAttributes: list.triggerAttributes,
		listOption: list.listOption,
		open: list.open,
		rendered: list.rendered,
		active: list.active,
		groups: list.groups,
		entries: list.entries,
		chosen,
		value,
		label: list.valueText,
		hiddenValues: list.hiddenValues,
		name: list.name,
		showClear: list.showClear,
		isSelected: list.isSelected,
		stateOf,
		keydown: list.keydown,
		keyup: list.keyup,
		triggerClick,
		keepFocus: list.keepFocus,
		optionClick,
		optionHover: list.optionHover,
		reportInvalid: list.reportInvalid,
		clear: list.clear,
		mount,
		openList: list.openList,
		close: list.close,
		choose: list.choose,
	}
}
