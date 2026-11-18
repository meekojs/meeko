// The look of <UIStat>, <UISparkline> and <UIDescriptionList>: a term in small soft text over its value, in the
// text of the page. A value never widens its column: it breaks anywhere.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

/** A <dl> in the text of the page. */
const list = 'ui:m-0 ui:grid ui:min-w-0 ui:font-sans ui:text-md ui:leading-normal ui:font-regular ui:text-text ui:[overflow-wrap:anywhere]'

/** The term of a <dl>. */
const term = 'ui:text-sm ui:text-text-soft'

/** A value, and its figures in columns. */
const value = 'ui:m-0 ui:tabular-nums'

/** The context under a value. */
const detail = [value, term]

/**
 * The look of <UIStat>: a big value between its label and its context. With a change, a period, a trend or a
 * link it is a key figure (`kpi`): the <dl> becomes the container of its compact mode, below the width of
 * --container-stat-narrow, which follows the width of the stat and not that of the window. The variants are
 * not props: the component sets them from its content.
 */
export const stat = tv({
	slots: {
		base: [list, 'ui:content-start ui:gap-1'],
		label: term,
		value: [value, 'ui:text-2xl ui:font-semibold ui:tracking-tight'],
		detail,
		/** The change and its period, on one line that wraps. */
		change: 'ui:m-0 ui:flex ui:flex-wrap ui:items-baseline ui:gap-x-1.5 ui:text-sm ui:text-text-soft',
		/** The arrow and the signed change, in the colour of its tone. */
		delta: 'ui:inline-flex ui:items-center ui:gap-0.5 ui:self-center ui:font-medium ui:tabular-nums',
		icon: '',
		period: '',
		trend: 'ui:m-0 ui:min-w-0',
		action: 'ui:m-0 ui:text-sm',
		link: ['ui:rounded-xs ui:font-medium ui:text-primary-text ui:underline ui:decoration-current ui:underline-offset-(--ui-underline-offset) ui:hover:text-text', focusRing],
	},
	variants: {
		/**
		 * A key figure: the <dl> is a container, so its parts follow its width. Its intrinsic width stands in
		 * for that of its content, which a container does not give: in a row of flex items it keeps a size.
		 */
		kpi: {
			false: {},
			true: {
				base: 'ui:@container ui:[contain-intrinsic-inline-size:var(--ui-stat-intrinsic-width)]',
				value: 'ui:@max-stat-narrow:text-xl',
			},
		},
		/**
		 * With a trend: the sparkline goes beside the value, in a second column as wide as its token; below
		 * --container-stat-narrow it takes a row of its own, under the change, and the empty column takes no space
		 * because the gap is its margin.
		 */
		chart: {
			false: {},
			true: {
				base: 'ui:grid-cols-[minmax(0,1fr)_auto]',
				label: 'ui:col-span-full',
				value: 'ui:col-[1]',
				change: 'ui:col-span-full',
				detail: 'ui:col-span-full',
				trend: [
					'ui:col-[2] ui:row-[2] ui:ms-4 ui:w-(--ui-stat-trend-width) ui:self-center',
					'ui:@max-stat-narrow:col-span-full ui:@max-stat-narrow:row-auto ui:@max-stat-narrow:ms-0 ui:@max-stat-narrow:w-auto',
				],
				action: 'ui:col-span-full',
			},
		},
		/** Good, bad or neither: the direction of the change against the one that is good. */
		tone: {
			neutral: { delta: 'ui:text-text' },
			success: { delta: 'ui:text-success-text' },
			danger: { delta: 'ui:text-danger-text' },
		},
		/** The arrow of a flat change points to the end of the line, in either direction of the text. */
		direction: {
			up: {},
			down: {},
			flat: { icon: 'ui:rtl:[scale:-1_1]' },
		},
	},
	defaultVariants: {
		kpi: false,
		chart: false,
		tone: 'neutral',
		direction: 'flat',
	},
})

/**
 * The look of <UISparkline>: an <svg> as wide as its container and as tall as --ui-sparkline-height, whose
 * paths stretch to it while the stroke keeps its width (vector-effect). Without a tone, the current colour.
 * The series uncovers itself once from its start, when it is inserted, except with reduced motion: a clip of
 * the whole <svg>, because a dash of a stroke that does not scale is measured on the screen, not on the path.
 * The clip only lasts the animation (`backwards`), so it never cuts the round caps at the edges.
 */
export const sparkline = tv({
	slots: {
		base: [
			'ui:block ui:h-(--ui-sparkline-height) ui:w-full ui:max-w-full ui:overflow-visible',
			'ui:animate-[ui-sparkline-draw_var(--ui-sparkline-duration)_var(--ui-ease-out)_backwards] ui:motion-reduce:animate-none',
		],
		area: 'ui:fill-current ui:[fill-opacity:var(--ui-sparkline-area-opacity)] ui:stroke-none',
		line: 'ui:fill-none ui:stroke-current ui:[stroke-linecap:round] ui:[stroke-linejoin:round] ui:[stroke-width:var(--ui-sparkline-stroke-width)] ui:[vector-effect:non-scaling-stroke]',
	},
	variants: {
		tone: {
			neutral: { base: 'ui:text-text-soft' },
			accent: { base: 'ui:text-primary-text' },
			info: { base: 'ui:text-info-text' },
			success: { base: 'ui:text-success-text' },
			warning: { base: 'ui:text-warning-text' },
			danger: { base: 'ui:text-danger-text' },
		},
	},
})

/** The look of <UIDescriptionList>: one column, or up to three from a `compact` screen. */
export const descriptionList = tv({
	slots: {
		base: [list, 'ui:gap-5'],
		item: 'ui:grid ui:content-start ui:gap-1',
		label: term,
		value,
		code: 'ui:font-mono ui:text-(length:--ui-prose-code-size) ui:[overflow-wrap:anywhere]',
		detail,
	},
	variants: {
		columns: {
			1: '',
			2: { base: 'ui:compact:grid-cols-2' },
			3: { base: 'ui:compact:grid-cols-3' },
		},
	},
	defaultVariants: {
		columns: 1,
	},
})
