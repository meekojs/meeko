// The look of <UITabs>: a row of tabs over a line, with an indicator under the chosen one, and its panels.
// The ring is inside, since the row clips its overflow. What stays in tabs.css: the pseudo-elements of the
// View Transition that moves the indicator, which belong to the document. Each property is set by one part only.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'

/** The keyboard ring, inside the element. */
const ring = 'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-solid focus-visible:outline-focus focus-visible:-outline-offset-(--ui-focus-ring-offset)'

/**
 * Receta de `UITabs`, con los slots `base`, `list`, `tab`, `indicator` y `panel`.
 *
 * @example
 * ```ts
 * import { tabsTheme } from '@meekojs/ui/theme'
 *
 * const { list, tab } = tabsTheme()
 * ```
 */
export const tabsTheme = defineTheme({
	slots: {
		base: 'font-sans text-md text-text',
		list: 'flex gap-1 overflow-x-auto [scrollbar-width:none] [box-shadow:inset_0_calc(var(--ui-border-width)*-1)_var(--ui-color-border)]',
		tab: [
			'relative m-0 min-h-(--ui-control-height-lg) flex-none cursor-pointer p-(--ui-control-padding-md)',
			'rounded-t-sm rounded-b-none [border:0] bg-transparent',
			'font-sans text-control-md leading-tight font-control tracking-snug',
			'text-text-soft enabled:hover:text-text aria-selected:text-text',
			'disabled:cursor-not-allowed disabled:opacity-(--ui-opacity-disabled)',
			'transition-[color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
			ring,
		],
		/**
		 * Under the chosen tab only. During a change of tab it is named only in the group that changed
		 * (`data-ui-tabs-active`, from utils/tabs): two groups would share the name, and a duplicated name
		 * cancels the animation. `ui-navigation-tabs-indicator` is reserved for the route tabs.
		 */
		indicator: [
			'absolute inset-x-0 top-auto bottom-0 hidden h-(--ui-tabs-indicator-height) bg-primary [[aria-selected=true]>&]:block',
			'[html:active-view-transition-type(ui-tab)_[data-ui-tabs-active]_[aria-selected=true]>&]:[view-transition-name:ui-tabs-indicator]',
		],
		panel: ['py-4 [&[hidden]]:hidden', ring],
	},
})

/** Variantes de la receta de `UITabs`, derivadas de `tabsTheme`. */
export type TabsThemeProps = ThemeVariants<typeof tabsTheme>
