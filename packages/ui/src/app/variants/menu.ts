// The look of <UIMenu>: what the `menu` role of ../variants/popover.ts and the rules of ../styles/popover.css
// leave to it. The content of the menu, its padding and its shadow, and the box of an item (padding, width,
// hover and focus) come from there; these classes only add the parts of an item, the tone, the disabled state
// and the separator. They are in the utilities layer, after popover.css, so they win over it without a
// higher specificity. Each property is set by one part only: the background of a disabled item and the one of
// a danger item answer to selectors that never meet.
import { tv } from 'tailwind-variants/lite'

export const menu = tv({
	slots: {
		/** The content, the element with `popover`: its look is the `menu` role of <UIPopover>. */
		base: '',
		/** The trigger that <UIMenu> paints; its look is the one of `button` in ../variants/button.ts. */
		trigger: '',
		/** The chevron after the text of a trigger with `triggerLabel`. */
		chevron: 'motion-safe:transition-[rotate] duration-(--ui-duration-fast) in-aria-expanded:rotate-180',
		/** An item of the data: an action (<button>) or a link (<a>, <MeekoLink>). */
		item: [
			'box-border items-center gap-2 leading-snug',
			'aria-disabled:cursor-not-allowed aria-disabled:bg-transparent aria-disabled:opacity-(--ui-opacity-disabled)',
		],
		/** The icon of an item: it takes the colour of its text. */
		icon: '',
		/** The text of an item: it takes the free width, so the shortcut goes to the end. */
		label: 'min-w-0 flex-1',
		/** The shortcut of an item, after its text: a reminder, the app is the one that listens to it. */
		shortcut: 'ms-4 rounded-none [border:0] bg-transparent p-0 font-sans text-sm leading-snug font-regular text-text-soft',
		/** A line between two groups of items. */
		separator: 'my-1 block h-(--ui-border-width) bg-border',
	},
	variants: {
		/** The tone of an item: `danger` for an action that destroys or cannot be undone. */
		tone: {
			neutral: '',
			danger: { item: 'text-danger-text not-aria-disabled:hover:bg-danger-soft not-aria-disabled:focus:bg-danger-soft' },
		},
	},
	defaultVariants: {
		tone: 'neutral',
	},
})
