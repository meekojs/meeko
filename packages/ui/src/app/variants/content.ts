// The look of the content that the components paint themselves: <UICodeBlock>, <UIDiff> and the internal <Icon>.
// What dresses HTML they do not write (a snapshot inside <UIProse>, the spans of Shiki) stays in prose.css and
// code.css. Each property is set by one part only; what a component decides by itself (its verdict, the state of
// the copy button, the kind of a line) lives in its own constant, so that it never becomes a prop.
import { inProse } from '../theme/components/card'
import { tv } from '../utils/theme'
import { focusRing, focusRingInset } from './focus'

/** No transition when the reader asks for less motion. */
const still = 'motion-reduce:transition-none motion-reduce:duration-0'

/** The icons of the package: lines of the current color, of a size of the tokens. */
export const icon = tv({
	base: 'flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:var(--ui-icon-stroke-width)]',
	variants: {
		size: {
			md: 'size-(--ui-icon-size)',
			sm: 'size-(--ui-icon-size-sm)',
			// The size of the text around it, for an icon inside a sentence or a heading.
			text: 'size-(--ui-icon-size-text)',
		},
	},
	defaultVariants: {
		size: 'md',
	},
})

/** The <pre> of a block, whether the component paints it or it comes in `html` or the snippet. */
const pre = [
	'm-0 rounded-none px-4 py-3 max-phone:px-3 overflow-auto',
	'font-mono text-sm leading-relaxed text-text [tab-size:2] [&_:is(code,span)]:[font-family:inherit]',
	focusRingInset,
].join(' ')

/**
 * The look of <UICodeBlock>: a frame with a header of the code colour and its code. The colors of the frame and
 * of the header come from `codeBlockTone`, the height and the wrapping of the code from `codeBlockMode`.
 */
export const codeBlock = tv({
	slots: {
		base: [
			'm-0 min-w-0 overflow-hidden rounded-lg border-(length:--ui-border-width) bg-bg-subtle font-sans text-text',
			// Shiki writes its own background on the <pre>.
			'[&_.shiki]:bg-transparent!',
			inProse,
		],
		head: 'flex min-h-(--ui-control-height-md) items-center gap-2 border-b-(length:--ui-border-width) py-1 ps-4 pe-1.5 text-sm',
		verdict: 'inline-flex items-center gap-1 font-semibold',
		label: 'font-medium',
		lang: 'font-mono',
		// A button that needs the script waits for it (`codeBlockCopy.waiting`), in a header whose height is reserved.
		copy: [
			'ms-auto cursor-pointer rounded-sm [border:0] bg-transparent px-2 py-0.5 hover:bg-control-hover',
			'font-sans text-xs leading-normal font-medium',
			'transition-[color,background-color] duration-(--ui-duration-fast)',
			still,
			focusRingInset,
		],
		/** The <pre> that the component paints from `code`. */
		code: ['block min-w-0', pre],
		/** The <div> around the `html` or the snippet: its <pre> gets the look of `code`. */
		content: [
			'm-0 block min-w-0 [&_:is(code,span)]:[font-family:inherit]',
			'[&>pre]:m-0 [&>pre]:rounded-none [&>pre]:px-4 [&>pre]:py-3 max-phone:[&>pre]:px-3 [&>pre]:overflow-auto [&>pre]:max-h-(--ui-code-max-height)',
			'[&>pre]:font-mono [&>pre]:text-sm [&>pre]:leading-relaxed [&>pre]:text-text [&>pre]:[tab-size:2]',
			'[&_pre]:focus-visible:outline-(length:--ui-focus-ring-width) [&_pre]:focus-visible:outline-solid [&_pre]:focus-visible:outline-focus [&_pre]:focus-visible:-outline-offset-(--ui-focus-ring-width)',
		],
	},
})

/** The colors of the frame, of its header and of the texts that follow it, by the verdict of the example. */
export const codeBlockTone = {
	none: {
		base: 'border-code-border',
		head: 'border-b-code-border bg-code-header text-text-soft',
		label: 'text-text',
	},
	good: {
		base: 'border-success-border',
		head: 'border-success-border bg-success-soft text-success-text',
		label: 'text-inherit',
	},
	bad: {
		base: 'border-danger-border',
		head: 'border-danger-border bg-danger-soft text-danger-text',
		label: 'text-inherit',
	},
} as const

/**
 * The color of the copy button: the one of a verdict's header whatever its state, or that of its state. A button
 * that is waiting for the script is hidden.
 */
export const codeBlockCopy = {
	verdict: 'text-inherit',
	idle: 'text-text-soft hover:text-text',
	done: 'text-success-text',
	error: 'text-danger-text',
	waiting: 'invisible',
} as const

/** How tall the painted code gets: a log is shorter and breaks its lines. */
export const codeBlockMode = {
	code: 'max-h-(--ui-code-max-height)',
	log: 'max-h-(--ui-log-max-height) whitespace-pre-wrap wrap-anywhere',
} as const

/** The look of <UIDiff>: one line per row, as wide as the longest, with the colour of its kind (`diffLine`). */
export const diff = tv({
	slots: {
		base: [
			'm-0 max-h-(--ui-code-max-height) overflow-auto rounded-lg border-(length:--ui-border-width) border-border bg-bg-subtle py-2',
			'font-mono text-sm leading-normal whitespace-pre text-text-soft',
			focusRing,
			inProse,
		],
		line: 'block min-h-lh w-fit min-w-full px-4',
		empty: 'm-0 font-sans text-md text-text-soft',
	},
})

/** The colour of each kind of line of a diff; the context keeps the text of the block. */
export const diffLine = {
	add: 'bg-success-soft text-text',
	remove: 'bg-danger-soft text-text',
	hunk: 'bg-primary-soft text-primary-text',
	file: 'font-medium text-text-soft',
	context: '',
} as const
