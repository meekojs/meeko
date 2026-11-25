// The look of <UIStat>, <UISparkline> and <UIDescriptionList>: a term in small soft text over its value, in the
// text of the page. A value never widens its column: it breaks anywhere.
import { tv } from '../utils/theme'
import { focusRing } from './focus'

/** A <dl> in the text of the page. */
const list = 'm-0 grid min-w-0 font-sans text-md leading-normal font-regular text-text [overflow-wrap:anywhere]'

/** The term of a <dl>. */
const term = 'text-sm text-text-soft'

/** A value, and its figures in columns. */
const value = 'm-0 tabular-nums'

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
		base: [list, 'content-start gap-1'],
		label: term,
		/** The <UIHint> after the label, a space away from its text. */
		hint: 'ms-1',
		value: [value, 'text-2xl font-semibold tracking-tight'],
		detail,
		/** The change and its period, on one line that wraps. */
		change: 'm-0 flex flex-wrap items-baseline gap-x-1.5 text-sm text-text-soft',
		/** The arrow and the signed change, in the colour of its tone. */
		delta: 'inline-flex items-center gap-0.5 self-center font-medium tabular-nums',
		icon: '',
		period: '',
		trend: 'm-0 min-w-0',
		action: 'm-0 text-sm',
		link: ['rounded-xs font-medium text-primary-text underline decoration-current underline-offset-(--ui-underline-offset) hover:text-text', focusRing],
	},
	variants: {
		/**
		 * A key figure: the <dl> is a container, so its parts follow its width. Its intrinsic width stands in
		 * for that of its content, which a container does not give: in a row of flex items it keeps a size.
		 */
		kpi: {
			false: {},
			true: {
				base: '@container [contain-intrinsic-inline-size:var(--ui-stat-intrinsic-width)]',
				value: '@max-stat-narrow:text-xl',
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
				base: 'grid-cols-[minmax(0,1fr)_auto]',
				label: 'col-span-full',
				value: 'col-[1]',
				change: 'col-span-full',
				detail: 'col-span-full',
				trend: [
					'col-[2] row-[2] ms-4 w-(--ui-stat-trend-width) self-center',
					'@max-stat-narrow:col-span-full @max-stat-narrow:row-auto @max-stat-narrow:ms-0 @max-stat-narrow:w-auto',
				],
				action: 'col-span-full',
			},
		},
		/** Good, bad or neither: the direction of the change against the one that is good. */
		tone: {
			neutral: { delta: 'text-text' },
			success: { delta: 'text-success-text' },
			danger: { delta: 'text-danger-text' },
		},
		/** The arrow of a flat change points to the end of the line, in either direction of the text. */
		direction: {
			up: {},
			down: {},
			flat: { icon: 'rtl:[scale:-1_1]' },
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
			'block h-(--ui-sparkline-height) w-full max-w-full overflow-visible',
			'animate-[ui-sparkline-draw_var(--ui-sparkline-duration)_var(--ui-ease-out)_backwards] motion-reduce:animate-none',
		],
		area: 'fill-current [fill-opacity:var(--ui-sparkline-area-opacity)] stroke-none',
		line: 'fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:var(--ui-sparkline-stroke-width)] [vector-effect:non-scaling-stroke]',
	},
	variants: {
		tone: {
			neutral: { base: 'text-text-soft' },
			accent: { base: 'text-primary-text' },
			info: { base: 'text-info-text' },
			success: { base: 'text-success-text' },
			warning: { base: 'text-warning-text' },
			danger: { base: 'text-danger-text' },
		},
	},
})

/** The look of <UIDescriptionList>: one column, or up to three from a `compact` screen. */
export const descriptionList = tv({
	slots: {
		base: [list, 'gap-5'],
		item: 'grid content-start gap-1',
		label: term,
		value,
		code: 'font-mono text-(length:--ui-prose-code-size) [overflow-wrap:anywhere]',
		detail,
	},
	variants: {
		columns: {
			1: '',
			2: { base: 'compact:grid-cols-2' },
			3: { base: 'compact:grid-cols-3' },
		},
	},
	defaultVariants: {
		columns: 1,
	},
})
