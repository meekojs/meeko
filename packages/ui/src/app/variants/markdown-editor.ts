// The look of the frame of <UIMarkdownEditor>: its bar, the notice, the surface and what fills it before Crepe
// arrives. The theme of Crepe and the rules for its DOM stay in markdown-editor.css, under the class
// `ui-markdown-editor` of the root: that HTML is Milkdown's, and its own sheets, without a layer, arrive later.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

/** The look of <UIMarkdownEditor>. A disabled editor adds `markdownEditorDisabled`. */
export const markdownEditor = tv({
	slots: {
		base: 'flex min-w-0 flex-col gap-2 font-sans text-text',
		bar: 'flex min-h-(--ui-control-height-md) flex-wrap items-center gap-x-3 gap-y-2',
		label: 'text-md leading-snug font-medium',
		tools: 'flex items-center gap-2 text-xs text-text-soft',
		modes: 'ms-auto inline-flex gap-0.5 rounded-md bg-control p-0.5',
		mode: [
			'min-h-[calc(var(--ui-control-height-sm)-var(--ui-space-1))] cursor-pointer rounded-sm [border:0] px-2 py-0',
			'bg-transparent text-text-soft hover:text-text aria-pressed:bg-bg aria-pressed:text-text',
			'[font-family:inherit] text-xs font-medium',
			'transition-[background-color,color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
			focusRing,
		],
		notice: 'm-0 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-text',
		// The height is set from the first paint: the marker, Crepe and the text area scroll inside it. Its value,
		// with the public --ui-markdown-editor-height, lives in markdown-editor.css: the sheet of every app holds
		// these classes, and nothing in it names the editor.
		surface: [
			'relative box-border h-(--ui-editor-surface-height) overflow-hidden',
			'rounded-lg border-(length:--ui-border-width) border-border-strong bg-bg',
			'focus-within:outline-(length:--ui-focus-ring-width) focus-within:outline-solid focus-within:outline-focus focus-within:outline-offset-(--ui-focus-ring-offset)',
		],
		marker: 'grid content-start gap-3 p-6',
		markerText: 'text-sm text-text-soft',
		markerLine: 'h-3 rounded-xs bg-control',
		host: 'h-full overflow-auto overscroll-contain',
		code: [
			'box-border block size-full resize-none [border:0] bg-bg p-4 outline-0',
			'font-mono text-sm leading-relaxed text-text [font-variant-ligatures:none] [tab-size:2]',
		],
	},
})

/** What a disabled editor adds to its slots: it looks so, and the surface says it takes nothing. */
export const markdownEditorDisabled = {
	base: 'opacity-(--ui-opacity-disabled)',
	surface: 'cursor-not-allowed',
} as const

/** The lines of the marker get shorter, like the lines of a text. */
export const markdownEditorMarkerLines = ['', 'w-4/5', 'w-3/5'] as const
