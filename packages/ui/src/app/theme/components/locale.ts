// The look of <UILocaleSwitcher> and <UILocaleSuggestion>. Each property is set by one part only.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { focusRingInset } from '../base/focus'

/** The look of <UILocaleSwitcher>: the codes of the languages in a frame as tall as a control. */
export const localeSwitcherTheme = defineTheme({
	slots: {
		base: [
			'box-border inline-flex h-(--ui-control-height-md) flex-none items-center [justify-self:start] gap-0.5',
			'rounded-md border-(length:--ui-border-width) border-border p-0.5 font-sans',
		],
		link: [
			'grid h-full min-w-8 place-items-center rounded-sm px-1.5',
			'text-md font-medium text-text-soft no-underline decoration-current hover:text-text',
			'[&[aria-current]]:bg-control-active [&[aria-current]]:text-text',
			'transition-[background-color,color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
			focusRingInset,
		],
	},
})

/**
 * The look of <UILocaleSuggestion>: a panel that floats at the end of the screen, and enters with
 * @starting-style. A phone keeps the two choices in one row: the link already says what the message says,
 * which stays for a screen reader.
 */
export const localeSuggestionTheme = defineTheme({
	slots: {
		base: [
			'fixed end-5 bottom-5 z-(--ui-z-floating) grid grid-cols-[auto_minmax(0,1fr)] [align-items:start] gap-x-3 gap-y-1.5',
			'w-[min(var(--ui-floating-panel-width),calc(100vw-var(--ui-space-8)))] p-4',
			'rounded-lg border-(length:--ui-border-width) border-border-strong bg-surface-raised [box-shadow:var(--ui-shadow-lg)]',
			'font-sans text-md leading-normal text-text',
			'transition-[opacity,translate] duration-(--ui-duration-slow) ease-out motion-reduce:transition-none motion-reduce:duration-0',
			'starting:[translate:0_var(--ui-space-3)] starting:opacity-(--ui-opacity-hidden)',
			'max-phone:inset-x-4 max-phone:bottom-4 max-phone:w-auto max-phone:grid-cols-[minmax(0,1fr)] max-phone:p-2',
		],
		icon: 'mt-0.5 text-primary-text max-phone:hidden',
		message: [
			'm-0 text-pretty',
			'max-phone:absolute max-phone:size-(--ui-border-width) max-phone:overflow-hidden max-phone:whitespace-nowrap max-phone:[clip-path:inset(50%)]',
		],
		actions: 'col-start-2 mt-1.5 flex flex-wrap gap-2 max-phone:col-start-1 max-phone:mt-0',
		// The two choices, buttons of theme/components/button: on a phone they share the row, at a smaller text size.
		go: 'max-phone:flex-auto max-phone:text-sm',
		stay: 'max-phone:flex-auto max-phone:text-sm',
	},
})

/** Variantes de la receta `localeSwitcherTheme`, derivadas de ella. */
export type LocaleSwitcherThemeProps = ThemeVariants<typeof localeSwitcherTheme>

/** Variantes de la receta `localeSuggestionTheme`, derivadas de ella. */
export type LocaleSuggestionThemeProps = ThemeVariants<typeof localeSuggestionTheme>
