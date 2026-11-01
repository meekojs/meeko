/** Makes the browser save `text` as the file `name`; nothing is written by the server. */
export function downloadText(name: string, text: string, type = 'text/markdown;charset=utf-8'): void {
	const url = URL.createObjectURL(new Blob([text], { type }))
	const link = document.createElement('a')
	link.href = url
	link.download = name
	link.hidden = true
	document.body.append(link)
	link.click()
	link.remove()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}
