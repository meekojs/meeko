// The look of the frame of <UIMarkdownEditor>: its bar, the notice, the surface and what fills it before Crepe
// arrives. The theme of Crepe and the rules for its DOM stay in markdown-editor.css, under the class
// `ui-markdown-editor` of the root: that HTML is Milkdown's, and its own sheets, without a layer, arrive later.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

/** The look of <UIMarkdownEditor>. A disabled editor adds `markdownEditorDisabled`. */
export const markdownEditor = tv({
	slots: {
		base: 'ui:flex ui:min-w-0 ui:flex-col ui:gap-2 ui:font-sans ui:text-text',
		bar: 'ui:flex ui:min-h-(--ui-control-height-md) ui:flex-wrap ui:items-center ui:gap-x-3 ui:gap-y-2',
		label: 'ui:text-md ui:leading-snug ui:font-medium',
		tools: 'ui:flex ui:items-center ui:gap-2 ui:text-xs ui:text-text-soft',
		modes: 'ui:ms-auto ui:inline-flex ui:gap-0.5 ui:rounded-md ui:bg-control ui:p-0.5',
		mode: [
			'ui:min-h-[calc(var(--ui-control-height-sm)-var(--ui-space-1))] ui:cursor-pointer ui:rounded-sm ui:[border:0] ui:px-2 ui:py-0',
			'ui:bg-transparent ui:text-text-soft ui:hover:text-text ui:aria-pressed:bg-bg ui:aria-pressed:text-text',
			'ui:[font-family:inherit] ui:text-xs ui:font-medium',
			'ui:transition-[background-color,color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
			focusRing,
		],
		notice: 'ui:m-0 ui:rounded-md ui:bg-warning-soft ui:px-3 ui:py-2 ui:text-sm ui:text-warning-text',
		// The height is set from the first paint: the marker, Crepe and the text area scroll inside it. Its value,
		// with the public --ui-markdown-editor-height, lives in markdown-editor.css: the sheet of every app holds
		// these classes, and nothing in it names the editor.
		surface: [
			'ui:relative ui:box-border ui:h-(--ui-editor-surface-height) ui:overflow-hidden',
			'ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-border-strong ui:bg-bg',
			'ui:focus-within:outline-(length:--ui-focus-ring-width) ui:focus-within:outline-solid ui:focus-within:outline-focus ui:focus-within:outline-offset-(--ui-focus-ring-offset)',
		],
		marker: 'ui:grid ui:content-start ui:gap-3 ui:p-6',
		markerText: 'ui:text-sm ui:text-text-soft',
		markerLine: 'ui:h-3 ui:rounded-xs ui:bg-control',
		host: 'ui:h-full ui:overflow-auto ui:overscroll-contain',
		code: [
			'ui:box-border ui:block ui:size-full ui:resize-none ui:[border:0] ui:bg-bg ui:p-4 ui:outline-0',
			'ui:font-mono ui:text-sm ui:leading-relaxed ui:text-text ui:[font-variant-ligatures:none] ui:[tab-size:2]',
		],
	},
})

/** What a disabled editor adds to its slots: it looks so, and the surface says it takes nothing. */
export const markdownEditorDisabled = {
	base: 'ui:opacity-(--ui-opacity-disabled)',
	surface: 'ui:cursor-not-allowed',
} as const

/** The lines of the marker get shorter, like the lines of a text. */
export const markdownEditorMarkerLines = ['', 'ui:w-4/5', 'ui:w-3/5'] as const
