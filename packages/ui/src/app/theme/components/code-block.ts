// The look of <UICodeBlock>: a frame with a header of the code colour and its code. What dresses HTML it does not
// write (a snapshot inside <UIProse>, the spans of Shiki) stays in prose.css and code.css. What the component
// decides by itself (its verdict, the state of the copy button, the height of the code) lives in its own
// constant, so that it never becomes a prop.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { focusRingInset } from '../base/focus'
import { inProse } from './card'

/** No transition when the reader asks for less motion. */
const still = 'motion-reduce:transition-none motion-reduce:duration-0'

/** The <pre> of a block, whether the component paints it or it comes in `html` or the snippet. */
const pre = [
	'm-0 rounded-none px-4 py-3 max-phone:px-3 overflow-auto',
	'font-mono text-sm leading-relaxed text-text [tab-size:2] [&_:is(code,span)]:[font-family:inherit]',
	focusRingInset,
].join(' ')

/**
 * Receta de `UICodeBlock`, con los slots `base`, `head`, `verdict`, `label`, `lang`, `copy`, `code` y `content`. Los
 * colores del marco y de su cabecera salen de `codeBlockTone`, y la altura y el ajuste del código de `codeBlockMode`.
 *
 * @example
 * ```ts
 * import { codeBlockTheme } from '@meekojs/ui/theme'
 *
 * const { base, head } = codeBlockTheme()
 * ```
 */
export const codeBlockTheme = defineTheme({
	slots: {
		base: [
			'm-0 min-w-0 overflow-hidden rounded-lg border-(length:--ui-border-width) bg-bg-subtle font-sans text-text',
			// Shiki writes its own background on the <pre>.
			'[&_.shiki]:bg-transparent!',
			inProse,
		],
		head: 'flex min-h-(--ui-control-height-md) items-center gap-2 border-b-(length:--ui-border-width) py-1 ps-4 pe-1.5 text-sm/[inherit]',
		verdict: 'inline-flex items-center gap-1 font-semibold',
		label: 'font-medium',
		lang: 'font-mono',
		// A button that needs the script waits for it (`codeBlockCopy.waiting`), in a header whose height is reserved.
		copy: [
			'ms-auto cursor-pointer rounded-sm [border:0] bg-transparent px-2 py-0.5 hover:bg-control-hover',
			'font-sans text-xs leading-normal font-medium',
			'transition-[color,background-color] duration-(--ui-duration-fast) ease-[ease]',
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

/** Variantes de la receta de `UICodeBlock`, derivadas de `codeBlockTheme`. */
export type CodeBlockThemeProps = ThemeVariants<typeof codeBlockTheme>

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
