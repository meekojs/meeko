// The look of <UITabs>: a row of tabs over a line, with an indicator under the chosen one, and its panels.
// The ring is inside, since the row clips its overflow. What stays in tabs.css: the pseudo-elements of the
// View Transition that moves the indicator, which belong to the document. Each property is set by one part only.
import { tv } from 'tailwind-variants/lite'

/** The keyboard ring, inside the element. */
const ring = 'ui:focus-visible:outline-(length:--ui-focus-ring-width) ui:focus-visible:outline-solid ui:focus-visible:outline-focus ui:focus-visible:-outline-offset-(--ui-focus-ring-offset)'

export const tabs = tv({
	slots: {
		base: 'ui:font-sans ui:text-md ui:text-text',
		list: 'ui:flex ui:gap-1 ui:overflow-x-auto ui:[scrollbar-width:none] ui:[box-shadow:inset_0_calc(var(--ui-border-width)*-1)_var(--ui-color-border)]',
		tab: [
			'ui:relative ui:m-0 ui:min-h-(--ui-control-height-lg) ui:flex-none ui:cursor-pointer ui:p-(--ui-control-padding-md)',
			'ui:rounded-t-sm ui:rounded-b-none ui:[border:0] ui:bg-transparent',
			'ui:font-sans ui:text-control-md ui:leading-tight ui:font-control ui:tracking-snug',
			'ui:text-text-soft ui:enabled:hover:text-text ui:aria-selected:text-text',
			'ui:disabled:cursor-not-allowed ui:disabled:opacity-(--ui-opacity-disabled)',
			'ui:transition-[color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
			ring,
		],
		/**
		 * Under the chosen tab only. During a change of tab it is named only in the group that changed
		 * (`data-ui-tabs-active`, from utils/tabs): two groups would share the name, and a duplicated name
		 * cancels the animation. `ui-navigation-tabs-indicator` is reserved for the route tabs.
		 */
		indicator: [
			'ui:absolute ui:inset-x-0 ui:top-auto ui:bottom-0 ui:hidden ui:h-(--ui-tabs-indicator-height) ui:bg-primary ui:[[aria-selected=true]>&]:block',
			'ui:[html:active-view-transition-type(ui-tab)_[data-ui-tabs-active]_[aria-selected=true]>&]:[view-transition-name:ui-tabs-indicator]',
		],
		panel: ['ui:py-4 ui:[&[hidden]]:hidden', ring],
	},
})
