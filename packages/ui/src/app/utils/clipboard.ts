/** How long the button of a code block shows the result of a copy, in milliseconds. */
export const copyFeedbackTime = 1600

/** Writes `text` to the clipboard, with a selection fallback where the Clipboard API is missing. */
export async function copyText(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text)
		return
	}
	const area = document.createElement('textarea')
	area.value = text
	area.setAttribute('readonly', '')
	area.style.position = 'fixed'
	area.style.opacity = '0'
	document.body.append(area)
	area.select()
	try {
		if (!document.execCommand('copy')) throw new Error('copy was rejected')
	} finally {
		area.remove()
	}
}

/** The texts of a copy button after it copies. */
export interface CopyFeedback {
	readonly copied: string
	readonly copyFailed: string
}

/**
 * Click handler of HTML that the component did not render, such as a Markdown snapshot: a click on a
 * `button[data-copy]` copies the code of its `.code-block`. One delegated listener serves every block.
 */
export function copyFromMarkup(event: MouseEvent, feedback: CopyFeedback): void {
	if (!(event.target instanceof Element)) return
	const button = event.target.closest<HTMLButtonElement>('button[data-copy]')
	const code = button?.closest('.code-block')?.querySelector('pre code')?.textContent
	if (!button || code === undefined || code === null) return
	const show = (label: string, state: 'done' | 'error'): void => {
		const idle = button.dataset.label ?? button.textContent ?? ''
		button.dataset.label = idle
		button.textContent = label
		button.dataset.state = state
		window.setTimeout(() => {
			button.textContent = idle
			delete button.dataset.state
		}, copyFeedbackTime)
	}
	copyText(code).then(
		() => show(feedback.copied, 'done'),
		() => show(feedback.copyFailed, 'error'),
	)
}
