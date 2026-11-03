// Sections of a `.meeko` and the tag around a position, from the text alone: they answer while a tag
// is being typed and the component does not parse. No dependencies, so the editor extension bundles
// this file without the language services of the server.

export interface Region {
	readonly contentStart: number
	readonly contentEnd: number
	/** Attributes of the opening tag, such as `scoped` in `<style scoped>`. */
	readonly attributes: string
}

/** `<template>` content: from its opening tag to the last `</template>`, as in the compiler. */
export function templateRegion(source: string): Region | undefined {
	const open = /<template(?=[\s>])([^>]*)>/.exec(source)
	if (!open) return undefined
	const contentStart = open.index + open[0].length
	const close = source.lastIndexOf('</template>')
	return { contentStart, contentEnd: close > contentStart ? close : source.length, attributes: open[1] ?? '' }
}

/** `<style>` content, outside the template. */
export function styleRegion(source: string): Region | undefined {
	const template = templateRegion(source)
	const pattern = /<style(?=[\s>])([^>]*)>/g
	for (const open of source.matchAll(pattern)) {
		if (template && open.index >= template.contentStart && open.index < template.contentEnd) continue
		const contentStart = open.index + open[0].length
		const close = source.indexOf('</style>', contentStart)
		return { contentStart, contentEnd: close < 0 ? source.length : close, attributes: open[1] ?? '' }
	}
	return undefined
}

/** The section whose content holds a position, with its first offset. */
export interface SectionAt {
	readonly name: 'script' | 'template' | 'style'
	readonly contentStart: number
}

/**
 * The section whose content holds `offset`; `undefined` at the top level of the file, in a comment
 * or in the opening tag of a section. Walks the sections in order, so a `<template>` written in a
 * string of the script opens nothing.
 */
export function sectionAt(source: string, offset: number): SectionAt | undefined {
	const start = /<!--|<(script|template|style)(?=[\s>])(?:[^>"']|"[^"]*"|'[^']*')*>/g
	for (let open = start.exec(source); open && open.index < offset; open = start.exec(source)) {
		const contentStart = open.index + open[0].length
		const name = open[1] as SectionAt['name'] | undefined
		if (!name) {
			const close = source.indexOf('-->', contentStart)
			if (close < 0) return undefined
			start.lastIndex = close + '-->'.length
			continue
		}
		if (offset < contentStart) return undefined
		const close = name === 'template' ? source.lastIndexOf('</template>') : source.indexOf(`</${name}`, contentStart)
		const contentEnd = close >= contentStart ? close : source.length
		if (offset <= contentEnd) return { name, contentStart }
		start.lastIndex = contentEnd
	}
	return undefined
}

/** Start tag around `offset` in the template, and the attribute value it is in, if any. */
export interface TagContext {
	readonly tag: string
	readonly tagStart: number
	/** End of the tag: its `>`, or where the next tag starts while it is unfinished. */
	readonly tagEnd: number
	readonly component: boolean
	/** The quoted value containing `offset`, with the name of its attribute. */
	readonly value?: { readonly attribute: string; readonly start: number }
}

export function tagAt(source: string, offset: number): TagContext | undefined {
	const template = templateRegion(source)
	if (!template || offset <= template.contentStart || offset > template.contentEnd) return undefined
	const tagStart = source.lastIndexOf('<', offset - 1)
	if (tagStart < template.contentStart) return undefined
	const tag = /^<([A-Za-z][\w$.-]*)/.exec(source.slice(tagStart, offset))?.[1]
	if (!tag) return undefined
	let quote: string | undefined
	let valueStart = 0
	let attribute = ''
	let lastName = ''
	for (let index = tagStart + 1 + tag.length; index < offset; index++) {
		const char = source[index]!
		if (quote) {
			if (char === quote) quote = undefined
			continue
		}
		if (char === '"' || char === "'") {
			quote = char
			valueStart = index + 1
			attribute = lastName
		} else if (char === '>') return undefined
		else if (/[^\s=]/.test(char)) {
			const name = /^[^\s=>"'/]+/.exec(source.slice(index))?.[0]
			if (name) {
				lastName = name
				index += name.length - 1
			}
		}
	}
	let tagEnd = source.length
	let inner: string | undefined = quote
	for (let index = offset; index < source.length; index++) {
		const char = source[index]!
		if (inner) {
			if (char === inner) inner = undefined
		} else if (char === '"' || char === "'") inner = char
		else if (char === '>' || char === '<') {
			tagEnd = index
			break
		}
	}
	return {
		tag,
		tagStart,
		tagEnd,
		component: /^[A-Z]/.test(tag) || tag === 'component',
		...(quote ? { value: { attribute, start: valueStart } } : {}),
	}
}
