// The look of <UICheckbox>, <UISwitch>, <UIRadioGroup> and <UISegmentedControl>: a label that holds a native
// input and its text. The browser's own box has a border of its own colour, and only --ui-color-control-border
// reaches 3:1 in both themes: the inputs drop their appearance and draw the box, except in forced colours, where
// the native control keeps every state visible. Each property is set by one part only.
import { tv } from 'tailwind-variants/lite'

/** The label: the whole row takes the click, and dims when its input is disabled. */
const labelLayout = 'ui:group ui:flex ui:items-center ui:gap-2'
const labelState = 'ui:cursor-pointer ui:has-disabled:cursor-not-allowed ui:has-disabled:opacity-(--ui-opacity-disabled)'
const label = [labelLayout, 'ui:font-sans ui:text-md ui:leading-normal ui:font-regular ui:text-text', labelState]

/** A row as tall as a control, and as a large one under a coarse pointer. */
const row = 'ui:min-h-(--ui-control-height-md) ui:pointer-coarse:min-h-(--ui-control-height-lg)'

/** What every input of a choice shares. */
const input = [
	'ui:m-0 ui:box-border ui:shrink-0 ui:appearance-none ui:accent-primary ui:cursor-[inherit]',
	'ui:transition-[background-color,border-color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
	'ui:focus-visible:outline-(length:--ui-focus-ring-width) ui:focus-visible:outline-focus ui:focus-visible:outline-offset-(--ui-focus-ring-offset) ui:focus-visible:outline-solid',
	'ui:forced-colors:appearance-auto ui:forced-colors:before:hidden',
]

/** The box of a checkbox or a radio: filled when checked, with a mark drawn by ::before. */
const box = 'ui:inline-grid ui:place-content-center ui:bg-control ui:group-hover:not-disabled:not-checked:bg-control-hover ui:checked:bg-primary ui:checked:before:bg-primary-contrast'

/** The border of a visible box: the checked colour wins over the invalid one. */
const boxBorder = 'ui:size-4 ui:border-(length:--ui-border-width) ui:border-solid ui:border-control-border ui:checked:border-primary ui:aria-[invalid=true]:not-checked:border-danger'

/** The tick of a checkbox. */
const tick = 'ui:rounded-xs ui:checked:before:size-3 ui:checked:before:[clip-path:polygon(14%_52%,0_66%,38%_100%,100%_20%,85%_6%,36%_72%)]'

/** The dot of a radio. */
const dot = 'ui:rounded-full ui:checked:before:size-1.5 ui:checked:before:rounded-full'

/** The text next to the input, and its description in soft text. */
const text = {
	content: 'ui:grid ui:gap-0.5',
	description: 'ui:text-sm ui:text-text-soft',
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
			'ui:h-(--ui-switch-height) ui:w-(--ui-switch-width) ui:rounded-full',
			// Unlike the box, an invalid switch keeps the danger border when checked.
			'ui:border-(length:--ui-border-width) ui:border-solid ui:border-control-border ui:checked:border-primary ui:aria-[invalid=true]:border-danger',
			'ui:bg-control ui:group-hover:not-disabled:not-checked:bg-control-hover ui:checked:bg-primary',
			'ui:before:m-0.5 ui:before:block ui:before:size-(--ui-switch-thumb) ui:before:rounded-full ui:before:bg-text-soft ui:checked:before:bg-primary-contrast',
			'ui:checked:before:[translate:var(--ui-switch-travel)] ui:[&:dir(rtl)]:checked:before:[translate:calc(-1*var(--ui-switch-travel))]',
			'ui:before:transition-[translate] ui:before:duration-(--ui-duration-fast) ui:before:ease-out ui:motion-reduce:before:transition-none ui:motion-reduce:before:duration-0',
		],
		...text,
	},
})

/** The <fieldset> of a group of radios: no frame of its own, and dimmed when disabled. */
const group = 'ui:m-0 ui:min-w-0 ui:p-0 ui:[border:0] ui:font-sans ui:text-text ui:disabled:cursor-not-allowed ui:disabled:opacity-(--ui-opacity-disabled)'

/** The visible <legend> of a group. */
const legend = 'ui:mb-2 ui:p-0 ui:text-sm ui:font-medium'

/** The track of a segmented control: a framed row whose segments are the labels. */
const track = 'ui:gap-0.5 ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-solid ui:border-control-border ui:bg-control ui:p-0.5'

/** A segment: the label of a radio, filled when checked. Its height and its text come from its size. */
const segment = [
	'ui:relative ui:rounded-md',
	'ui:transition-[background-color,color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
	'ui:[&:hover:not(:has(:disabled,:checked))]:bg-control-hover ui:has-checked:bg-primary-soft ui:has-checked:font-semibold ui:has-checked:text-primary-text',
	'ui:has-focus-visible:outline-(length:--ui-focus-ring-width) ui:has-focus-visible:outline-focus ui:has-focus-visible:outline-solid',
]

/** The input covers its segment, unseen: the label is the segment. */
const coveringInput = 'ui:absolute ui:inset-0 ui:size-full ui:[border:0] ui:opacity-(--ui-opacity-hidden)'

/** The look of <UIRadioGroup>: a list of radios, or a segmented control whose options are the labels. */
export const radioGroup = tv({
	slots: {
		base: group,
		legend,
		options: 'ui:flex ui:flex-wrap',
		option: label,
		input: [...input, box, dot],
	},
	variants: {
		variant: {
			default: {
				options: 'ui:gap-2',
				option: row,
				input: boxBorder,
			},
			segmented: {
				options: ['ui:w-fit', track],
				option: [...segment, 'ui:min-h-(--ui-control-height-sm) ui:px-3 ui:has-focus-visible:outline-offset-(--ui-focus-ring-offset)'],
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
		base: ['ui:max-w-full', group],
		legend,
		options: ['ui:flex ui:w-fit ui:max-w-full ui:flex-nowrap ui:overflow-x-auto ui:overscroll-x-contain ui:[scrollbar-width:thin]', track],
		option: [labelLayout, 'ui:font-sans ui:leading-tight ui:font-regular ui:text-text', labelState, 'ui:shrink-0 ui:justify-center ui:whitespace-nowrap', ...segment, 'ui:has-focus-visible:outline-offset-[calc(var(--ui-focus-ring-width)*-1)]'],
		input: [...input, coveringInput],
	},
	variants: {
		/** The size of the whole control, track included, is the one of a control of that size: a button beside it lines up. */
		size: {
			sm: { option: 'ui:min-h-[calc(var(--ui-control-height-sm)-var(--ui-space-1)-var(--ui-border-width)*2)] ui:px-2 ui:text-control-sm' },
			md: { option: 'ui:min-h-[calc(var(--ui-control-height-md)-var(--ui-space-1)-var(--ui-border-width)*2)] ui:px-3 ui:text-control-md' },
		},
		/** A legend only for screen readers: the group keeps its name. */
		hideLegend: {
			true: { legend: 'ui:absolute ui:size-(--ui-border-width) ui:overflow-hidden ui:whitespace-nowrap ui:[clip-path:inset(50%)]' },
			false: '',
		},
	},
	defaultVariants: {
		size: 'md',
		hideLegend: false,
	},
})
