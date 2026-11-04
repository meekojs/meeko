import type { Signal } from '@meekojs/meeko'

/**
 * `<UISelect>`: what `Select.meeko` needs besides its template. The browser brings the list, the keyboard
 * and the form value; only the model, objects as values and what the copy of `<selectedcontent>` does not
 * do by itself are left here.
 */
import { computed, effect, signal, untrack } from '@meekojs/meeko'

import type { SelectEntry, SelectOptionState, SelectSettings } from '../types/select'

import { groupOptions, sameOption, selectLabel, selectValue } from './select-options'

/** What the template of `<UISelect>` reads and the component runs. */
export function createSelect<T>(props: SelectSettings<T>, model: Signal<unknown>, id: string, emit: (value: unknown) => void) {
	const triggerId = computed(() => props.id ?? props.field?.id ?? `${id}-trigger`)
	/** The signal that holds the value: the form field's, or the model. */
	const target = (): { value: unknown } => props.field?.value ?? model
	/** A required select that the form found empty, until it gets a value. */
	const failed = signal(false)
	/** Whether there is a value: `""`, the usual initial value of a form field, is no choice unless an option is `""`. */
	const chosen = computed(() => {
		const value = target().value
		return value !== null && value !== undefined && (value !== '' || props.options.some((option) => sameOption(option, '' as T, props.by)))
	})
	const value = computed(() => target().value as T)
	const groups = computed(() => groupOptions(props.options, props, `${id}-list`))
	const entries = computed(() => groups.value.flatMap((group) => group.entries))
	const isSelected = (entry: SelectEntry<T>): boolean => chosen.value && sameOption(value.value, entry.option, props.by)
	/**
	 * One plus the chosen option; `0` when the options do not hold it. Then, and only then, the `<select>`
	 * starts with a hidden option that stands for it: nothing chosen (the placeholder, so the browser does
	 * not pick an option on its own) or a value outside them, which the model keeps until the application
	 * changes it. Browsers still expose a hidden option to assistive technology.
	 */
	const nativeIndex = computed(() => entries.value.findIndex(isSelected) + 1)
	const blankValue = computed(() => (chosen.value ? selectValue(value.value, props) : ''))
	const label = computed(() => (chosen.value ? selectLabel(value.value, props.labelBy) : ''))
	const blankLabel = computed(() => (chosen.value ? label.value : (props.placeholder ?? '')))
	const showClear = computed(() => props.clearable === true && props.disabled !== true && chosen.value)
	const attributes = computed(() => ({
		id: triggerId.value,
		class: props.listClass,
		name: props.name ?? props.field?.name,
		required: props.required,
		disabled: props.disabled,
		'aria-label': props.label,
		'aria-describedby': props.describedBy ?? props.field?.describedBy.value,
		'aria-invalid': props.invalid === true || props.field?.invalid.value === true || (failed.value && !chosen.value) ? ('true' as const) : undefined,
		'data-placement': props.placement ?? 'bottom-start',
	}))
	const option = (entry: SelectEntry<T>) => ({ value: selectValue(entry.option, props), disabled: entry.disabled, selected: isSelected(entry) })
	const stateOf = (entry: SelectEntry<T>): SelectOptionState => ({ selected: isSelected(entry), disabled: entry.disabled })
	const write = (next: unknown): void => {
		target().value = next
		failed.value = false
		emit(next)
	}
	/** The option at a position of `select.options`, which holds the hidden one first when it is there. */
	const choose = (position: number): void => {
		const entry = entries.value[position - (nativeIndex.value === 0 ? 1 : 0)]
		if (entry && !isSelected(entry)) write(entry.option)
	}
	const change = (event: Event): void => choose((event.currentTarget as HTMLSelectElement).selectedIndex)
	/** The form found it empty: the select shows the error and takes the focus, without the browser's bubble. */
	const reportInvalid = (event: Event): void => {
		event.preventDefault()
		failed.value = true
		;(event.currentTarget as HTMLElement).focus()
	}
	let element: HTMLSelectElement | null = null
	const clear = (): void => {
		if (!showClear.value) return
		write(null)
		element?.focus()
	}
	/**
	 * A choice made before hydration wins over the model. After that the model leads, and setting
	 * `selectedIndex` also rebuilds the copy of `<selectedcontent>`, which is not reactive.
	 */
	const mount = (root: HTMLElement | null): (() => void) => {
		element = root?.querySelector('select') ?? null
		const position = (): number => Math.max(0, nativeIndex.value - 1)
		const early = element?.selectedIndex
		if (early !== undefined && early !== untrack(position)) choose(early)
		return effect(() => {
			const index = position()
			void entries.value
			const offset = props.offset
			// After this flush, which also renders the new options.
			queueMicrotask(() => {
				if (!element) return
				element.selectedIndex = index
				if (offset === undefined) element.style.removeProperty('--select-offset')
				else element.style.setProperty('--select-offset', `${offset}px`)
			})
		})
	}
	return { chosen, value, label, groups, nativeIndex, blankValue, blankLabel, showClear, attributes, option, stateOf, change, reportInvalid, clear, mount }
}
