// The look of <UICheckbox>, <UISwitch> and <UIRadioGroup>: a label that holds a native input and its text.
// The browser's own box has a border of its own colour, and only --ui-color-control-border reaches 3:1 in
// both themes: the inputs drop their appearance and draw the box, except in forced colours, where the
// native control keeps every state visible. Each property is set by one part only.
import { tv } from 'tailwind-variants/lite'

/** The label: the whole row takes the click, and dims when its input is disabled. */
const label = [
	'ui:group ui:flex ui:items-center ui:gap-2',
	'ui:font-sans ui:text-md ui:leading-normal ui:font-regular ui:text-text',
	'ui:cursor-pointer ui:has-disabled:cursor-not-allowed ui:has-disabled:opacity-(--ui-opacity-disabled)',
]

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

/** The look of <UIRadioGroup>: a list of radios, or a segmented control whose options are the labels. */
export const radioGroup = tv({
	slots: {
		base: 'ui:m-0 ui:min-w-0 ui:p-0 ui:[border:0] ui:font-sans ui:text-text ui:disabled:cursor-not-allowed ui:disabled:opacity-(--ui-opacity-disabled)',
		legend: 'ui:mb-2 ui:p-0 ui:text-sm ui:font-medium',
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
				options: 'ui:w-fit ui:gap-0.5 ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-solid ui:border-control-border ui:bg-control ui:p-0.5',
				option: [
					'ui:relative ui:min-h-(--ui-control-height-sm) ui:rounded-md ui:px-3',
					'ui:transition-[background-color,color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
					'ui:[&:hover:not(:has(:disabled,:checked))]:bg-control-hover ui:has-checked:bg-primary-soft ui:has-checked:font-semibold ui:has-checked:text-primary-text',
					'ui:has-focus-visible:outline-(length:--ui-focus-ring-width) ui:has-focus-visible:outline-focus ui:has-focus-visible:outline-offset-(--ui-focus-ring-offset) ui:has-focus-visible:outline-solid',
				],
				// The input covers its option, unseen: the label is the segment.
				input: 'ui:absolute ui:inset-0 ui:size-full ui:[border:0] ui:opacity-(--ui-opacity-hidden)',
			},
		},
	},
	defaultVariants: {
		variant: 'default',
	},
})
