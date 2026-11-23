// The look of <UILocaleSwitcher> and <UILocaleSuggestion>. Each property is set by one part only.
import { tv } from 'tailwind-variants/lite'

import { focusRingInset } from './focus'

/** The look of <UILocaleSwitcher>: the codes of the languages in a frame as tall as a control. */
export const localeSwitcher = tv({
	slots: {
		base: [
			'ui:box-border ui:inline-flex ui:h-(--ui-control-height-md) ui:flex-none ui:items-center ui:[justify-self:start] ui:gap-0.5',
			'ui:rounded-md ui:border-(length:--ui-border-width) ui:border-border ui:p-0.5 ui:font-sans',
		],
		link: [
			'ui:grid ui:h-full ui:min-w-8 ui:place-items-center ui:rounded-sm ui:px-1.5',
			'ui:text-md ui:font-medium ui:text-text-soft ui:no-underline ui:decoration-current ui:hover:text-text',
			'ui:[&[aria-current]]:bg-control-active ui:[&[aria-current]]:text-text',
			'ui:transition-[background-color,color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
			focusRingInset,
		],
	},
})

/**
 * The look of <UILocaleSuggestion>: a panel that floats at the end of the screen, and enters with
 * @starting-style. A phone keeps the two choices in one row: the link already says what the message says,
 * which stays for a screen reader.
 */
export const localeSuggestion = tv({
	slots: {
		base: [
			'ui:fixed ui:end-5 ui:bottom-5 ui:z-(--ui-z-floating) ui:grid ui:grid-cols-[auto_minmax(0,1fr)] ui:[align-items:start] ui:gap-x-3 ui:gap-y-1.5',
			'ui:w-[min(var(--ui-floating-panel-width),calc(100vw-var(--ui-space-8)))] ui:p-4',
			'ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-border-strong ui:bg-surface-raised ui:[box-shadow:var(--ui-shadow-lg)]',
			'ui:font-sans ui:text-md ui:leading-normal ui:text-text',
			'ui:transition-[opacity,translate] ui:duration-(--ui-duration-slow) ui:ease-out ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
			'ui:starting:[translate:0_var(--ui-space-3)] ui:starting:opacity-(--ui-opacity-hidden)',
			'ui:max-phone:inset-x-4 ui:max-phone:bottom-4 ui:max-phone:w-auto ui:max-phone:grid-cols-[minmax(0,1fr)] ui:max-phone:p-2',
		],
		icon: 'ui:mt-0.5 ui:text-primary-text ui:max-phone:hidden',
		message: [
			'ui:m-0 ui:text-pretty',
			'ui:max-phone:absolute ui:max-phone:size-(--ui-border-width) ui:max-phone:overflow-hidden ui:max-phone:whitespace-nowrap ui:max-phone:[clip-path:inset(50%)]',
		],
		actions: 'ui:col-start-2 ui:mt-1.5 ui:flex ui:flex-wrap ui:gap-2 ui:max-phone:col-start-1 ui:max-phone:mt-0',
		// The two choices, buttons of variants/button: on a phone they share the row, at a smaller text size.
		go: 'ui:max-phone:flex-auto ui:max-phone:text-sm',
		stay: 'ui:max-phone:flex-auto ui:max-phone:text-sm',
	},
})
