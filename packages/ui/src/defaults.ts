// What `ui.defaults` accepts for each component, read from its tv(): the slots of `ui` and the values of the
// variants that take an application default. It runs only in Node, when the module loads: the components
// read the validated defaults, never this table, so the browser does not get every variant.
import type { UIDefaults } from './app/types/config'

import { alertTheme } from './app/theme/components/alert'
import { avatarTheme } from './app/theme/components/avatar'
import { badgeTheme } from './app/theme/components/badge'
import { buttonTheme } from './app/theme/components/button'
import { cardTheme, linkCardTheme } from './app/theme/components/card'
import { checkboxTheme } from './app/theme/components/checkbox'
import { codeBlockTheme } from './app/theme/components/code-block'
import { comboboxTheme } from './app/theme/components/combobox'
import { commandPaletteTheme } from './app/theme/components/command-palette'
import { containerTheme } from './app/theme/components/container'
import { copyButtonTheme } from './app/theme/components/copy-button'
import { dateRangeTheme } from './app/theme/components/date-range'
import { descriptionListTheme } from './app/theme/components/description-list'
import { diffTheme } from './app/theme/components/diff'
import { disclosureTheme } from './app/theme/components/disclosure'
import { drawerTheme } from './app/theme/components/drawer'
import { emptyTheme } from './app/theme/components/empty'
import { fieldTheme } from './app/theme/components/field'
import { footerTheme, headerTheme } from './app/theme/components/header'
import { hintTheme } from './app/theme/components/hint'
import { iconButtonTheme } from './app/theme/components/icon-button'
import { inputTheme } from './app/theme/components/input'
import { localeSuggestionTheme, localeSwitcherTheme } from './app/theme/components/locale'
import { markdownEditorTheme } from './app/theme/components/markdown-editor'
import { menuTheme } from './app/theme/components/menu'
import { modalTheme } from './app/theme/components/modal'
import { breadcrumbTheme, navigationTabsTheme, navigationTreeTheme, pageNavigationTheme, paginationTheme, tableOfContentsTheme } from './app/theme/components/navigation'
import { pageHeaderTheme, pageTheme } from './app/theme/components/page'
import { radioGroupTheme } from './app/theme/components/radio-group'
import { segmentedControlTheme } from './app/theme/components/segmented-control'
import { selectTheme } from './app/theme/components/select'
import { skeletonTheme } from './app/theme/components/skeleton'
import { sliderTheme } from './app/theme/components/slider'
import { sparklineTheme } from './app/theme/components/sparkline'
import { statTheme } from './app/theme/components/stat'
import { switchTheme } from './app/theme/components/switch'
import { tableTheme } from './app/theme/components/table'
import { tabsTheme } from './app/theme/components/tabs'
import { textareaTheme } from './app/theme/components/textarea'
import { themeToggleTheme } from './app/theme/components/theme-toggle'
import { toastTheme } from './app/theme/components/toast'

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

/** The variants of a button that take an application default. */
const buttonChoices = ['variant', 'color', 'size', 'radius'] as const

const action = { look: buttonTheme, variants: buttonChoices } as const

/** The variants of a text field that take an application default: the same as those of a button. */
const inputChoices = buttonChoices

const components = {
	alert: { look: alertTheme },
	avatar: { look: avatarTheme, variants: ['size', 'variant', 'color', 'radius'] },
	badge: { look: badgeTheme, variants: ['variant', 'color', 'radius'] },
	breadcrumb: { look: breadcrumbTheme },
	button: action,
	card: { look: cardTheme, variants: ['variant', 'color', 'radius', 'elevation', 'padding', 'actionsWrap'], props: { density: ['compact', 'normal', 'comfortable'] } },
	checkbox: { look: checkboxTheme },
	codeBlock: { look: codeBlockTheme },
	combobox: { look: comboboxTheme },
	commandPalette: { look: commandPaletteTheme },
	container: { look: containerTheme },
	copyButton: { look: copyButtonTheme, variants: buttonChoices },
	dateRange: { look: dateRangeTheme },
	descriptionList: { look: descriptionListTheme },
	diff: { look: diffTheme },
	disclosure: { look: disclosureTheme },
	drawer: { look: drawerTheme },
	empty: { look: emptyTheme },
	field: { look: fieldTheme },
	footer: { look: footerTheme },
	header: { look: headerTheme },
	hint: { look: hintTheme },
	iconButton: { look: iconButtonTheme, variants: buttonChoices },
	input: { look: inputTheme, variants: inputChoices },
	link: action,
	linkCard: { look: linkCardTheme, variants: ['variant', 'color', 'radius', 'elevation'] },
	localeSuggestion: { look: localeSuggestionTheme },
	localeSwitcher: { look: localeSwitcherTheme },
	markdownEditor: { look: markdownEditorTheme },
	menu: { look: menuTheme },
	modal: { look: modalTheme },
	navigationTabs: { look: navigationTabsTheme },
	navigationTree: { look: navigationTreeTheme },
	page: { look: pageTheme },
	pageHeader: { look: pageHeaderTheme },
	pageNavigation: { look: pageNavigationTheme },
	pagination: { look: paginationTheme },
	popover: {},
	prose: {},
	radioGroup: { look: radioGroupTheme },
	segmentedControl: { look: segmentedControlTheme, variants: ['size'] },
	select: { look: selectTheme },
	skeleton: { look: skeletonTheme },
	slider: { look: sliderTheme },
	sparkline: { look: sparklineTheme },
	stat: { look: statTheme },
	switch: { look: switchTheme },
	table: { look: tableTheme, variants: ['density'] },
	tableOfContents: { look: tableOfContentsTheme },
	tabs: { look: tabsTheme },
	textarea: { look: textareaTheme },
	themeToggle: { look: themeToggleTheme },
	toast: { look: toastTheme, noClass: true },
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
