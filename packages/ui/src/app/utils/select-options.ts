import type { SelectEntry, SelectGroup, SelectOptionSettings } from '../types/select'

/** A value of the record of an object option, or `undefined`. */
function field(option: unknown, key: string): unknown {
	return option !== null && typeof option === 'object' ? (option as Record<string, unknown>)[key] : undefined
}

/** The label of an option: `labelBy`, the text of a primitive, or `label`/`name` of an object. */
export function selectLabel<T>(option: T, labelBy?: SelectOptionSettings<T>['labelBy']): string {
	if (typeof labelBy === 'function') return labelBy(option)
	if (typeof labelBy === 'string') return String(field(option, labelBy) ?? '')
	if (option === null || typeof option !== 'object') return String(option ?? '')
	const named = field(option, 'label') ?? field(option, 'name')
	return named === undefined ? String(option) : String(named)
}

/** Whether two options are the same for `by`. */
export function sameOption<T>(a: T, b: T, by?: SelectOptionSettings<T>['by']): boolean {
	if (typeof by === 'function') return by(a, b)
	if (typeof by === 'string') return a !== null && b !== null && typeof a === 'object' && typeof b === 'object' ? Object.is(field(a, by), field(b, by)) : Object.is(a, b)
	return Object.is(a, b)
}

/** The value of an option in a hidden input: its `by` key, the primitive, or its label. */
export function selectValue<T>(option: T, settings: Pick<SelectOptionSettings<T>, 'by' | 'labelBy'>): string {
	if (typeof settings.by === 'string' && option !== null && typeof option === 'object') return String(field(option, settings.by) ?? '')
	if (option === null || typeof option !== 'object') return String(option ?? '')
	return selectLabel(option, settings.labelBy)
}

/** Whether an option is disabled: `disabledBy`, or `disabled: true` on an object. */
export function selectDisabled<T>(option: T, disabledBy?: SelectOptionSettings<T>['disabledBy']): boolean {
	if (typeof disabledBy === 'function') return disabledBy(option)
	return field(option, typeof disabledBy === 'string' ? disabledBy : 'disabled') === true
}

/** The group of an option for `groupBy`, or `undefined`. */
export function selectGroupOf<T>(option: T, groupBy?: SelectOptionSettings<T>['groupBy']): string | undefined {
	if (typeof groupBy === 'function') return groupBy(option)
	if (typeof groupBy !== 'string') return undefined
	const value = field(option, groupBy)
	return value === undefined || value === null ? undefined : String(value)
}

/**
 * The options grouped as the list shows them: the groups in the order their first option appears,
 * each with its options in order, and every option with its position in that order.
 */
export function groupOptions<T>(options: readonly T[], settings: Pick<SelectOptionSettings<T>, 'groupBy' | 'labelBy' | 'disabledBy'>, listboxId: string): SelectGroup<T>[] {
	const groups = new Map<string, { name: string | undefined; options: T[] }>()
	for (const option of options) {
		const name = selectGroupOf(option, settings.groupBy)
		const key = name === undefined ? '' : `g:${name}`
		const group = groups.get(key) ?? { name, options: [] }
		group.options.push(option)
		groups.set(key, group)
	}
	let index = 0
	let count = 0
	return [...groups].map(([key, group]) => {
		const groupIndex = count++
		return {
			key: key || '-',
			name: group.name,
			id: group.name === undefined ? undefined : `${listboxId}-g${groupIndex}`,
			entries: group.options.map((option): SelectEntry<T> => {
				const position = index++
				return {
					option,
					index: position,
					key: String(position),
					id: `${listboxId}-${position}`,
					label: selectLabel(option, settings.labelBy),
					disabled: selectDisabled(option, settings.disabledBy),
				}
			}),
		}
	})
}
