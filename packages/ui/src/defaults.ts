// What `ui.defaults` accepts for each component, read from its tv(): the slots of `ui` and the values of the
// variants that take an application default. It runs only in Node, when the module loads: the components
// read the validated defaults, never this table, so the browser does not get every variant.
import type { UIDefaults } from './app/types/config'

import { badge } from './app/variants/badge'
import { button } from './app/variants/button'
import { card, linkCard } from './app/variants/card'
import { checkbox, radioGroup, toggle } from './app/variants/choice'
import { commandPalette } from './app/variants/command-palette'
import { container } from './app/variants/container'
import { codeBlock, diff } from './app/variants/content'
import { descriptionList, stat } from './app/variants/data'
import { drawer } from './app/variants/drawer'
import { alert, disclosure, empty, skeleton, toast } from './app/variants/feedback'
import { field } from './app/variants/field'
import { footer, header } from './app/variants/header'
import { input, textarea } from './app/variants/input'
import { localeSuggestion, localeSwitcher } from './app/variants/locale'
import { markdownEditor } from './app/variants/markdown-editor'
import { modal } from './app/variants/modal'
import { breadcrumb, navigationTabs, navigationTree, pageNavigation, pagination, tableOfContents } from './app/variants/navigation'
import { page, pageHeader } from './app/variants/page'
import { combobox, select } from './app/variants/select'
import { slider } from './app/variants/slider'
import { table } from './app/variants/table'
import { tabs } from './app/variants/tabs'
import { themeToggle } from './app/variants/theme-toggle'

/** The part of a tv() that the validation reads. */
interface Look {
	readonly slots?: Readonly<Record<string, unknown>>
	readonly variants?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
}

interface Entry {
	readonly look?: Look
	/** Variants of `look` that take an application default. */
	readonly variants?: readonly string[]
	/** Defaults that are props of the component, not variants of its tv(). */
	readonly props?: Readonly<Record<string, readonly string[]>>
	/** `UIToast` takes no `class`. */
	readonly noClass?: true
}

/** The variant defaults of the table, the same keys as those of `UIDefaults`. */
type Option<K extends keyof UIDefaults> = Exclude<keyof NonNullable<UIDefaults[K]>, 'class' | 'ui'>
interface Choices<K extends keyof UIDefaults> {
	readonly variants?: readonly Option<K>[]
	readonly props?: Readonly<Partial<Record<Option<K>, readonly string[]>>>
}

const action = { look: button, variants: ['variant', 'size', 'shape'] } as const

const components = {
	alert: { look: alert },
	badge: { look: badge },
	breadcrumb: { look: breadcrumb },
	button: action,
	card: { look: card, variants: ['variant', 'padding', 'actionsWrap'], props: { density: ['compact', 'normal', 'comfortable'] } },
	checkbox: { look: checkbox },
	codeBlock: { look: codeBlock },
	combobox: { look: combobox },
	commandPalette: { look: commandPalette },
	container: { look: container },
	descriptionList: { look: descriptionList },
	diff: { look: diff },
	disclosure: { look: disclosure },
	drawer: { look: drawer },
	empty: { look: empty },
	field: { look: field },
	footer: { look: footer },
	header: { look: header },
	input: { look: input },
	link: action,
	linkCard: { look: linkCard },
	localeSuggestion: { look: localeSuggestion },
	localeSwitcher: { look: localeSwitcher },
	markdownEditor: { look: markdownEditor },
	modal: { look: modal },
	navigationTabs: { look: navigationTabs },
	navigationTree: { look: navigationTree },
	page: { look: page },
	pageHeader: { look: pageHeader },
	pageNavigation: { look: pageNavigation },
	pagination: { look: pagination },
	popover: {},
	prose: {},
	radioGroup: { look: radioGroup },
	select: { look: select },
	skeleton: { look: skeleton },
	slider: { look: slider },
	stat: { look: stat },
	switch: { look: toggle },
	table: { look: table, variants: ['density'] },
	tableOfContents: { look: tableOfContents },
	tabs: { look: tabs },
	textarea: { look: textarea },
	themeToggle: { look: themeToggle },
	toast: { look: toast, noClass: true },
	tooltip: {},
} satisfies { readonly [K in keyof Required<UIDefaults>]: Entry & Choices<K> }

const list = (values: readonly string[]): string => values.join(', ')

function plainObject(value: unknown, name: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`ui: ${name} must be an object`)
}

function classes(value: unknown, name: string): void {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`ui: ${name} must be a non-empty string of classes`)
}

/** The slots of a component's `ui`: none when its tv() has a single element. */
const slotsOf = (entry: Entry): readonly string[] => Object.keys(entry.look?.slots ?? {})

/** The values that each variant default of a component accepts. */
function choicesOf(entry: Entry): Readonly<Record<string, readonly string[]>> {
	const choices: Record<string, readonly string[]> = { ...entry.props }
	for (const variant of entry.variants ?? []) choices[variant] = Object.keys(entry.look?.variants?.[variant] ?? {})
	return choices
}

/** Valida `ui.defaults`: componentes, claves, slots de `ui` y valores, con un error que dice qué se admite. */
export function validateDefaults(defaults: unknown): void {
	plainObject(defaults, 'defaults')
	for (const [component, settings] of Object.entries(defaults)) {
		if (!Object.hasOwn(components, component)) throw new TypeError(`ui: unknown defaults component ${component}; use one of ${list(Object.keys(components))}`)
		const entry: Entry = components[component as keyof typeof components]
		const name = `defaults.${component}`
		plainObject(settings, name)
		const choices = choicesOf(entry)
		const slots = slotsOf(entry)
		for (const [key, value] of Object.entries(settings)) {
			if (value === undefined) continue
			if (key === 'class' && !entry.noClass) {
				classes(value, `${name}.class`)
			} else if (key === 'ui' && slots.length) {
				plainObject(value, `${name}.ui`)
				for (const [slot, slotClasses] of Object.entries(value)) {
					if (!slots.includes(slot)) throw new TypeError(`ui: unknown slot ${slot} in ${name}.ui; its slots are ${list(slots)}`)
					if (slotClasses !== undefined) classes(slotClasses, `${name}.ui.${slot}`)
				}
			} else if (Object.hasOwn(choices, key)) {
				if (!choices[key]!.includes(value as string)) throw new TypeError(`ui: invalid ${name}.${key}; use one of ${list(choices[key]!)}`)
			} else {
				const accepted = [...(entry.noClass ? [] : ['class']), ...(slots.length ? ['ui'] : []), ...Object.keys(choices)]
				throw new TypeError(`ui: unknown option ${name}.${key}; ${component} accepts ${list(accepted)}`)
			}
		}
	}
}

/**
 * Una copia de `ui.defaults` ya validados con sólo lo que llega al cliente: objetos planos de textos, sin
 * claves `undefined` ni componentes vacíos.
 */
export function normalizeDefaults(defaults: UIDefaults): UIDefaults {
	const copy = (value: object): Record<string, unknown> => {
		const result: Record<string, unknown> = {}
		for (const [key, entry] of Object.entries(value)) {
			if (entry === undefined) continue
			const next = typeof entry === 'object' && entry !== null ? copy(entry) : entry
			if (typeof next !== 'object' || Object.keys(next as object).length) result[key] = next
		}
		return result
	}
	return copy(defaults) as UIDefaults
}
