import type { ThemeToggleMessages, ThemeToggleState } from '@meekojs/meeko/framework'

import type { UIMessages } from '../types/messages'

import { builtinMessages, canonicalLocale, themeCycleLabel } from './messages'

/**
 * `<UIThemeToggle>`: what `ThemeToggle.meeko` needs besides its template. Pure helpers over the
 * public `useThemeToggle()` of the core, the same rules the deprecated `<MeekoThemeToggle>` follows.
 */

/** What the toggle receives besides its snippets. */
export interface ThemeToggleOptions {
	readonly mode?: string | undefined
	readonly themes?: readonly string[] | undefined
	readonly labels?: Readonly<Record<string, string | undefined>> | undefined
	readonly messages?: ThemeToggleMessages | undefined
	/** The texts of the document's locale, below `labels` and `messages`; Spanish without them. */
	readonly text?: UIMessages['themeToggle'] | undefined
	/** The locale of `text`: it lowers the labels of the `cycle` text. */
	readonly locale?: string | undefined
}

/** One choice of the toggle: what it paints, which does not depend on the current theme. */
export interface ThemeToggleItem {
	readonly name: string
	readonly label: string
	/**
	 * Tokens of `data-meeko-theme-icon` (cycle mode): the choice and, in a list without `"system"`,
	 * `system-light` or `system-dark` on the themes of `system`, which the style of `<head>` that
	 * `theme` adds shows in that mode.
	 */
	readonly icon: string
}

/** What the toggle says about the current theme; every field is a primitive. */
export interface ThemeToggleStatus {
	/** The choice the cycle button moves to. */
	readonly next: string
	/** `aria-label` of the cycle button. */
	readonly label: string
	/** The choice that `aria-checked` marks: only one this render knows. */
	readonly checked: string | undefined
	/** The radio with `tabindex="0"`, once the browser handles the arrow keys; `undefined` before. */
	readonly focused: string | undefined
}

const textOf = (options: ThemeToggleOptions): UIMessages['themeToggle'] => options.text ?? builtinMessages.es!.themeToggle

const labelOf = (options: ThemeToggleOptions, name: string): string => options.labels?.[name] ?? (Object.hasOwn(textOf(options).labels, name) ? textOf(options).labels[name] : undefined) ?? name

/** The `mode` of `<UIThemeToggle>`: `"cycle"` by default. */
export function themeToggleMode(mode: string | undefined): 'cycle' | 'select' {
	if (mode === undefined) return 'cycle'
	if (mode !== 'cycle' && mode !== 'select') throw new TypeError(`<UIThemeToggle>: mode must be "cycle" or "select", not ${JSON.stringify(mode)}`)
	return mode
}

/**
 * The choices of `<UIThemeToggle>`: `themes` (validated) or every choice of the configuration.
 * `previous` comes back when it paints the same choices, so a new array of props with the same
 * themes does not write every row again.
 */
export function themeToggleItems(toggle: Pick<ThemeToggleState<string, string>, 'choices' | 'system'>, options: ThemeToggleOptions, previous?: readonly ThemeToggleItem[]): readonly ThemeToggleItem[] {
	const items = themeToggleList(toggle, options)
	const same =
		previous?.length === items.length &&
		items.every((item, index) => {
			const before = previous[index]!
			return before.name === item.name && before.label === item.label && before.icon === item.icon
		})
	return same ? previous : items
}

function themeToggleList(toggle: Pick<ThemeToggleState<string, string>, 'choices' | 'system'>, options: ThemeToggleOptions): ThemeToggleItem[] {
	const list = options.themes === undefined ? [...toggle.choices] : [...new Set(options.themes)]
	for (const name of list) {
		if (!toggle.choices.includes(name)) throw new TypeError(`<UIThemeToggle>: themes has an unknown theme ${JSON.stringify(name)}; use ${toggle.choices.map((entry) => JSON.stringify(entry)).join(', ')}`)
	}
	if (!list.length) throw new TypeError('<UIThemeToggle>: themes must name at least one theme')
	const system = toggle.system && !list.includes('system') ? toggle.system : undefined
	return list.map((name): ThemeToggleItem => ({
		name,
		label: labelOf(options, name),
		icon: [name, ...(system?.light === name ? ['system-light'] : []), ...(system?.dark === name ? ['system-dark'] : [])].join(' '),
	}))
}

/** What `<UIThemeToggle>` says about the current theme; see {@link ThemeToggleStatus}. */
export function themeToggleStatus(toggle: Pick<ThemeToggleState<string, string>, 'theme' | 'known' | 'interactive'>, items: readonly ThemeToggleItem[], options: ThemeToggleOptions): ThemeToggleStatus {
	const list = items.map((item) => item.name)
	const choice = toggle.theme.theme.value
	const known = toggle.known.value
	// A choice outside the list ("system" in a light/dark toggle) moves on from the theme it shows.
	let index = list.indexOf(choice)
	if (index < 0) index = list.indexOf(toggle.theme.resolved.value)
	const next = list[(index + 1) % list.length]!
	const messages = options.messages
	const text = textOf(options)
	// `toLocaleLowerCase` throws on an invalid tag: a language never takes the toggle down.
	const lower = (label: string): string => label.toLocaleLowerCase(canonicalLocale(options.locale) ?? 'es')
	const label = !known ? (messages?.unknown ?? text.unknown) : messages?.cycle ? messages.cycle(labelOf(options, choice), labelOf(options, next)) : themeCycleLabel(text.cycle, lower(labelOf(options, choice)), lower(labelOf(options, next)))
	const checked = known && list.includes(choice) ? choice : undefined
	return { next, label, checked, focused: toggle.interactive.value ? (checked ?? list[0]) : undefined }
}

/** `aria-label` of the radio group of `<UIThemeToggle>`. */
export function themeToggleGroupLabel(messages: ThemeToggleMessages | undefined, text?: UIMessages['themeToggle']): string {
	return messages?.group ?? (text ?? builtinMessages.es!.themeToggle).group
}

/**
 * The radio that an arrow key, `Home` or `End` moves to in the radio group of `<UIThemeToggle>`,
 * as the ARIA radio group pattern does; `undefined` for any other key.
 */
export function themeToggleKeyTarget(key: string, current: number, count: number): number | undefined {
	if (count <= 0) return undefined
	if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count
	if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count
	if (key === 'Home') return 0
	if (key === 'End') return count - 1
	return undefined
}
