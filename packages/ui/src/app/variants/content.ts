// The look of the content that the components paint themselves: <UICodeBlock>, <UIDiff> and the internal <Icon>.
// What dresses HTML they do not write (a snapshot inside <UIProse>, the spans of Shiki) stays in prose.css and
// code.css. Each property is set by one part only; what a component decides by itself (its verdict, the state of
// the copy button, the kind of a line) lives in its own constant, so that it never becomes a prop.
import { tv } from 'tailwind-variants/lite'

import { inProse } from './card'
import { focusRing, focusRingInset } from './focus'

/** No transition when the reader asks for less motion. */
const still = 'ui:motion-reduce:transition-none ui:motion-reduce:duration-0'

/** The icons of the package: lines of the current color, of a size of the tokens. */
export const icon = tv({
	base: 'ui:flex-none ui:fill-none ui:stroke-current ui:[stroke-linecap:round] ui:[stroke-linejoin:round] ui:[stroke-width:var(--ui-icon-stroke-width)]',
	variants: {
		size: {
			md: 'ui:size-(--ui-icon-size)',
			sm: 'ui:size-(--ui-icon-size-sm)',
		},
	},
	defaultVariants: {
		size: 'md',
	},
})

/** The <pre> of a block, whether the component paints it or it comes in `html` or the snippet. */
const pre = [
	'ui:m-0 ui:rounded-none ui:px-4 ui:py-3 ui:max-phone:px-3 ui:overflow-auto',
	'ui:font-mono ui:text-sm ui:leading-relaxed ui:text-text ui:[tab-size:2] ui:[&_:is(code,span)]:[font-family:inherit]',
	focusRingInset,
].join(' ')

/**
 * The look of <UICodeBlock>: a frame with a header of the code colour and its code. The colors of the frame and
 * of the header come from `codeBlockTone`, the height and the wrapping of the code from `codeBlockMode`.
 */
export const codeBlock = tv({
	slots: {
		base: [
			'ui:m-0 ui:min-w-0 ui:overflow-hidden ui:rounded-lg ui:border-(length:--ui-border-width) ui:bg-bg-subtle ui:font-sans ui:text-text',
			// Shiki writes its own background on the <pre>.
			'ui:[&_.shiki]:bg-transparent!',
			inProse,
		],
		head: 'ui:flex ui:min-h-(--ui-control-height-md) ui:items-center ui:gap-2 ui:border-b-(length:--ui-border-width) ui:py-1 ui:ps-4 ui:pe-1.5 ui:text-sm',
		verdict: 'ui:inline-flex ui:items-center ui:gap-1 ui:font-semibold',
		label: 'ui:font-medium',
		lang: 'ui:font-mono',
		// A button that needs the script waits for it (`codeBlockCopy.waiting`), in a header whose height is reserved.
		copy: [
			'ui:ms-auto ui:cursor-pointer ui:rounded-sm ui:[border:0] ui:bg-transparent ui:px-2 ui:py-0.5 ui:hover:bg-control-hover',
			'ui:font-sans ui:text-xs ui:leading-normal ui:font-medium',
			'ui:transition-[color,background-color] ui:duration-(--ui-duration-fast)',
			still,
			focusRingInset,
		],
		/** The <pre> that the component paints from `code`. */
		code: ['ui:block ui:min-w-0', pre],
		/** The <div> around the `html` or the snippet: its <pre> gets the look of `code`. */
		content: [
			'ui:m-0 ui:block ui:min-w-0 ui:[&_:is(code,span)]:[font-family:inherit]',
			'ui:[&>pre]:m-0 ui:[&>pre]:rounded-none ui:[&>pre]:px-4 ui:[&>pre]:py-3 ui:max-phone:[&>pre]:px-3 ui:[&>pre]:overflow-auto ui:[&>pre]:max-h-(--ui-code-max-height)',
			'ui:[&>pre]:font-mono ui:[&>pre]:text-sm ui:[&>pre]:leading-relaxed ui:[&>pre]:text-text ui:[&>pre]:[tab-size:2]',
			'ui:[&_pre]:focus-visible:outline-(length:--ui-focus-ring-width) ui:[&_pre]:focus-visible:outline-solid ui:[&_pre]:focus-visible:outline-focus ui:[&_pre]:focus-visible:-outline-offset-(--ui-focus-ring-width)',
		],
	},
})

/** The colors of the frame, of its header and of the texts that follow it, by the verdict of the example. */
export const codeBlockTone = {
	none: {
		base: 'ui:border-code-border',
		head: 'ui:border-b-code-border ui:bg-code-header ui:text-text-soft',
		label: 'ui:text-text',
	},
	good: {
		base: 'ui:border-success-border',
		head: 'ui:border-success-border ui:bg-success-soft ui:text-success-text',
		label: 'ui:text-inherit',
	},
	bad: {
		base: 'ui:border-danger-border',
		head: 'ui:border-danger-border ui:bg-danger-soft ui:text-danger-text',
		label: 'ui:text-inherit',
	},
} as const

/**
 * The color of the copy button: the one of a verdict's header whatever its state, or that of its state. A button
 * that is waiting for the script is hidden.
 */
export const codeBlockCopy = {
	verdict: 'ui:text-inherit',
	idle: 'ui:text-text-soft ui:hover:text-text',
	done: 'ui:text-success-text',
	error: 'ui:text-danger-text',
	waiting: 'ui:invisible',
} as const

/** How tall the painted code gets: a log is shorter and breaks its lines. */
export const codeBlockMode = {
	code: 'ui:max-h-(--ui-code-max-height)',
	log: 'ui:max-h-(--ui-log-max-height) ui:whitespace-pre-wrap ui:wrap-anywhere',
} as const

/** The look of <UIDiff>: one line per row, as wide as the longest, with the colour of its kind (`diffLine`). */
export const diff = tv({
	slots: {
		base: [
			'ui:m-0 ui:max-h-(--ui-code-max-height) ui:overflow-auto ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-border ui:bg-bg-subtle ui:py-2',
			'ui:font-mono ui:text-sm ui:leading-normal ui:whitespace-pre ui:text-text-soft',
			focusRing,
			inProse,
		],
		line: 'ui:block ui:min-h-lh ui:w-fit ui:min-w-full ui:px-4',
		empty: 'ui:m-0 ui:font-sans ui:text-md ui:text-text-soft',
	},
})

/** The colour of each kind of line of a diff; the context keeps the text of the block. */
export const diffLine = {
	add: 'ui:bg-success-soft ui:text-text',
	remove: 'ui:bg-danger-soft ui:text-text',
	hunk: 'ui:bg-primary-soft ui:text-primary-text',
	file: 'ui:font-medium ui:text-text-soft',
	context: '',
} as const
