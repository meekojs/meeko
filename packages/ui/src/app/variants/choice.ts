// The look of <UICheckbox>, <UISwitch>, <UIRadioGroup> and <UISegmentedControl>: a label that holds a native
// input and its text. The browser's own box has a border of its own colour, and only --ui-color-control-border
// reaches 3:1 in both themes: the inputs drop their appearance and draw the box, except in forced colours, where
// the native control keeps every state visible. Each property is set by one part only.
import { tv } from '../utils/theme'

/** The label: the whole row takes the click, and dims when its input is disabled. */
const labelLayout = 'group flex items-center gap-2'
const labelState = 'cursor-pointer has-disabled:cursor-not-allowed has-disabled:opacity-(--ui-opacity-disabled)'
const label = [labelLayout, 'font-sans text-md leading-normal font-regular text-text', labelState]

/** A row as tall as a control, and as a large one under a coarse pointer. */
const row = 'min-h-(--ui-control-height-md) pointer-coarse:min-h-(--ui-control-height-lg)'

/** What every input of a choice shares. */
const input = [
	'm-0 box-border shrink-0 appearance-none accent-primary cursor-[inherit]',
	'transition-[background-color,border-color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
	'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid',
	'forced-colors:appearance-auto forced-colors:before:hidden',
]

/** The box of a checkbox or a radio: filled when checked, with a mark drawn by ::before. */
const box = 'inline-grid place-content-center bg-control group-hover:not-disabled:not-checked:bg-control-hover checked:bg-primary checked:before:bg-primary-contrast'

/** The border of a visible box: the checked colour wins over the invalid one. */
const boxBorder = 'size-4 border-(length:--ui-border-width) border-solid border-control-border checked:border-primary aria-[invalid=true]:not-checked:border-danger'

/** The tick of a checkbox. */
const tick = 'rounded-xs checked:before:size-3 checked:before:[clip-path:polygon(14%_52%,0_66%,38%_100%,100%_20%,85%_6%,36%_72%)]'

/** The dot of a radio. */
const dot = 'rounded-full checked:before:size-1.5 checked:before:rounded-full'

/** The text next to the input, and its description in soft text. */
const text = {
	content: 'grid gap-0.5',
	description: 'text-sm text-text-soft',
}

/** The look of <UICheckbox>. */
export const checkbox = tv({
	slots: {
		base: [...label, row],
		input: [...input, box, boxBorder, tick],
		...text,
	},
})

/** The look of <UISwitch>: a track whose thumb, drawn by ::before, travels to the end when checked. */
export const toggle = tv({
	slots: {
		base: [...label, row],
		input: [
			...input,
			'h-(--ui-switch-height) w-(--ui-switch-width) rounded-full',
			// Unlike the box, an invalid switch keeps the danger border when checked.
			'border-(length:--ui-border-width) border-solid border-control-border checked:border-primary aria-[invalid=true]:border-danger',
			'bg-control group-hover:not-disabled:not-checked:bg-control-hover checked:bg-primary',
			'before:m-0.5 before:block before:size-(--ui-switch-thumb) before:rounded-full before:bg-text-soft checked:before:bg-primary-contrast',
			'checked:before:[translate:var(--ui-switch-travel)] [&:dir(rtl)]:checked:before:[translate:calc(-1*var(--ui-switch-travel))]',
			'before:transition-[translate] before:duration-(--ui-duration-fast) before:ease-out motion-reduce:before:transition-none motion-reduce:before:duration-0',
		],
		...text,
	},
})

/** The <fieldset> of a group of radios: no frame of its own, and dimmed when disabled. */
const group = 'm-0 min-w-0 p-0 [border:0] font-sans text-text disabled:cursor-not-allowed disabled:opacity-(--ui-opacity-disabled)'

/** The visible <legend> of a group. */
const legend = 'mb-2 p-0 text-sm font-medium'

/** The track of a segmented control: a framed row whose segments are the labels. */
const track = 'gap-0.5 rounded-lg border-(length:--ui-border-width) border-solid border-control-border bg-control p-0.5'

/** A segment: the label of a radio, filled when checked. Its height and its text come from its size. */
const segment = [
	'relative rounded-md',
	'transition-[background-color,color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
	'[&:hover:not(:has(:disabled,:checked))]:bg-control-hover has-checked:bg-primary-soft has-checked:font-semibold has-checked:text-primary-text',
	'has-focus-visible:outline-(length:--ui-focus-ring-width) has-focus-visible:outline-focus has-focus-visible:outline-solid',
]

/** The input covers its segment, unseen: the label is the segment. */
const coveringInput = 'absolute inset-0 size-full [border:0] opacity-(--ui-opacity-hidden)'

/** The look of <UIRadioGroup>: a list of radios, or a segmented control whose options are the labels. */
export const radioGroup = tv({
	slots: {
		base: group,
		legend,
		options: 'flex flex-wrap',
		option: label,
		input: [...input, box, dot],
	},
	variants: {
		variant: {
			default: {
				options: 'gap-2',
				option: row,
				input: boxBorder,
			},
			segmented: {
				options: ['w-fit', track],
				option: [...segment, 'min-h-(--ui-control-height-sm) px-3 has-focus-visible:outline-offset-(--ui-focus-ring-offset)'],
				input: coveringInput,
			},
		},
	},
	defaultVariants: {
		variant: 'default',
	},
})

/**
 * The look of <UISegmentedControl>: the segments of <UIRadioGroup variant="segmented"> on a track that never
 * wraps. When the segments do not fit, the track scrolls sideways inside its own width, so the page does not
 * grow and no segment breaks into lines; the focus ring goes inside the segment, where the scroll does not
 * cut it.
 */
export const segmentedControl = tv({
	slots: {
		base: ['max-w-full', group],
		legend,
		options: ['flex w-fit max-w-full flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:thin]', track],
		option: [labelLayout, 'font-sans leading-tight font-regular text-text', labelState, 'shrink-0 justify-center whitespace-nowrap', ...segment, 'has-focus-visible:outline-offset-[calc(var(--ui-focus-ring-width)*-1)]'],
		input: [...input, coveringInput],
	},
	variants: {
		/** The size of the whole control, track included, is the one of a control of that size: a button beside it lines up. */
		size: {
			sm: { option: 'min-h-[calc(var(--ui-control-height-sm)-var(--ui-space-1)-var(--ui-border-width)*2)] px-2 text-control-sm' },
			md: { option: 'min-h-[calc(var(--ui-control-height-md)-var(--ui-space-1)-var(--ui-border-width)*2)] px-3 text-control-md' },
		},
		/** A legend only for screen readers: the group keeps its name. */
		hideLegend: {
			true: { legend: 'absolute size-(--ui-border-width) overflow-hidden whitespace-nowrap [clip-path:inset(50%)]' },
			false: '',
		},
	},
	defaultVariants: {
		size: 'md',
		hideLegend: false,
	},
})
