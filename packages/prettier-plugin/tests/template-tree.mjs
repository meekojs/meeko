import { parseSfc, parseTemplate, scanInterpolations } from '@meekojs/meeko/parse'

// What the compiler renders from a template, without what a formatter may change: a run of whitespace
// counts as one space, and an expression or a class list counts by its content. A text node that
// appears, disappears or gains a space at an edge is a difference.
const collapse = (text) => text.replace(/[\t\n\f\r ]+/g, ' ')
const code = (text) => text.replace(/[\s;()]/g, '').replaceAll('"', "'").replace(/,(?=[\]}])/g, '')

function text(raw) {
	let result = ''
	let cursor = 0
	for (const segment of scanInterpolations(raw).segments) {
		result += `${collapse(raw.slice(cursor, segment.start))}{${code(segment.expression ?? '')}}`
		cursor = segment.end
	}
	return result + collapse(raw.slice(cursor))
}

function attribute({ name, value }) {
	if (name === 'class') return [name, [...new Set(value.split(/[\t\n\f\r ]+/).filter(Boolean))].join(' ')]
	return [name, /^(?:bind|on|if|each|model|ref)(?::|$)|^(?:is|args|snippet|params|html|style)$/.test(name) ? code(value) : value]
}

const isLineBreak = (node) => node.nodeName === '#text' && /^[\t\n\f\r ]*\n[\t\n\f\r ]*$/.test(node.value ?? '')
const isContent = (node) => node.nodeName !== '#comment' && (node.nodeName !== '#text' || Boolean(node.value?.trim()))

function tree(node, source) {
	if (node.nodeName === '#text') return text(source.slice(node.start, node.end))
	if (node.nodeName === '#comment') return `<!--${collapse(node.value ?? '').trim()}-->`
	let children = [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])]
	// The whitespace that the compiler itself drops, as `compileSnippets` does.
	if (node.tagName === 'snippet') {
		while (children.length && isLineBreak(children[0])) children = children.slice(1)
		while (children.length && isLineBreak(children.at(-1))) children = children.slice(0, -1)
	}
	if (node.componentName && !children.some((child) => child.tagName !== 'snippet' && isContent(child))) children = children.filter((child) => child.tagName === 'snippet')
	return { tag: node.tagName ?? node.nodeName, attrs: (node.attrs ?? []).map(attribute), children: children.map((child) => tree(child, source)) }
}

/** El árbol que el compilador lee de la plantilla de un componente, sin lo que puede cambiar el formato. */
export function templateTree(source, filename = 'Component.meeko') {
	const { template } = parseSfc(source, filename)
	return template ? tree(parseTemplate(source, template, filename), source) : null
}
