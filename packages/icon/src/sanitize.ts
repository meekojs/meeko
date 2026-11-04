import type { IconData } from './index'

/**
 * Sanitizer for the project's own SVG files. It keeps an allowlist of shape, gradient and
 * clipping elements with their geometric and presentation attributes, and drops everything that
 * can run code, load a resource or style the page: `<script>`, `<style>`, `<foreignObject>`,
 * `<image>`, `<a>`, animations, `on*` handlers, `style`, `class` and any reference outside the
 * icon (`href` and `url(...)` only point at `#id`). Monochrome icons are normalized to
 * `currentColor`, so they take the color of the text.
 */

const elements = new Set([
	'circle',
	'clipPath',
	'defs',
	'ellipse',
	'g',
	'line',
	'linearGradient',
	'mask',
	'path',
	'pattern',
	'polygon',
	'polyline',
	'radialGradient',
	'rect',
	'stop',
	'symbol',
	'text',
	'tspan',
	'use',
])

const attributes = new Set([
	'clip-path',
	'clip-rule',
	'clipPathUnits',
	'color',
	'cx',
	'cy',
	'd',
	'display',
	'dominant-baseline',
	'dx',
	'dy',
	'fill',
	'fill-opacity',
	'fill-rule',
	'font-family',
	'font-size',
	'font-style',
	'font-weight',
	'fr',
	'fx',
	'fy',
	'gradientTransform',
	'gradientUnits',
	'height',
	'href',
	'id',
	'letter-spacing',
	'mask',
	'maskContentUnits',
	'maskUnits',
	'offset',
	'opacity',
	'paint-order',
	'pathLength',
	'patternContentUnits',
	'patternTransform',
	'patternUnits',
	'points',
	'preserveAspectRatio',
	'r',
	'rx',
	'ry',
	'shape-rendering',
	'spreadMethod',
	'stop-color',
	'stop-opacity',
	'stroke',
	'stroke-dasharray',
	'stroke-dashoffset',
	'stroke-linecap',
	'stroke-linejoin',
	'stroke-miterlimit',
	'stroke-opacity',
	'stroke-width',
	'text-anchor',
	'transform',
	'vector-effect',
	'viewBox',
	'visibility',
	'width',
	'x',
	'x1',
	'x2',
	'xlink:href',
	'y',
	'y1',
	'y2',
])

/** Presentation attributes of the root `<svg>` that its children inherit: kept on a wrapping `<g>`. */
const inherited = new Set(['clip-rule', 'color', 'fill', 'fill-opacity', 'fill-rule', 'opacity', 'stroke', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'stroke-width'])

/** Paint attributes whose colors decide whether an icon is monochrome. */
const paints = new Set(['color', 'fill', 'stop-color', 'stroke'])

/** Elements dropped with all their content. */
const dropped = new Set(['a', 'animate', 'animateMotion', 'animateTransform', 'audio', 'desc', 'discard', 'feImage', 'filter', 'foreignObject', 'iframe', 'image', 'metadata', 'script', 'set', 'style', 'title', 'video'])

interface Element {
	readonly attributes: Map<string, string>
	readonly children: Node[]
	readonly name: string
}
type Node = Element | string

/** An error that names the file and what is wrong with it. */
function invalid(file: string, message: string): never {
	throw new TypeError(`icon: ${file}: ${message}`)
}

function decode(value: string): string {
	return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code: string) => {
		const lower = code.toLowerCase()
		if (lower === 'amp') return '&'
		if (lower === 'lt') return '<'
		if (lower === 'gt') return '>'
		if (lower === 'quot') return '"'
		if (lower === 'apos') return "'"
		const point = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10)
		return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
	})
}

function escapeText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value: string): string {
	return escapeText(value).replaceAll('"', '&quot;')
}

/** Parses the markup of an SVG file into a tree; comments, CDATA and processing instructions are dropped. */
function parse(source: string, file: string): Element {
	const root: Element = { attributes: new Map(), children: [], name: '#root' }
	const stack: Element[] = [root]
	let index = 0
	while (index < source.length) {
		const open = source.indexOf('<', index)
		const text = source.slice(index, open < 0 ? source.length : open)
		if (text) stack.at(-1)!.children.push(decode(text))
		if (open < 0) break
		if (source.startsWith('<!--', open)) {
			const end = source.indexOf('-->', open + 4)
			if (end < 0) invalid(file, 'unclosed comment')
			index = end + 3
			continue
		}
		if (source.startsWith('<![CDATA[', open)) {
			const end = source.indexOf(']]>', open)
			if (end < 0) invalid(file, 'unclosed CDATA section')
			index = end + 3
			continue
		}
		if (source.startsWith('<?', open) || source.startsWith('<!', open)) {
			// A DOCTYPE with an internal subset can define entities: refuse it instead of guessing.
			const end = source.indexOf('>', open)
			if (end < 0) invalid(file, 'unclosed declaration')
			if (source.slice(open, end).includes('[')) invalid(file, 'DOCTYPE with an internal subset is not allowed')
			index = end + 1
			continue
		}
		if (source.startsWith('</', open)) {
			const end = source.indexOf('>', open)
			if (end < 0) invalid(file, 'unclosed end tag')
			const name = source.slice(open + 2, end).trim()
			const element = stack.pop()
			if (!element || element === root || element.name !== name) invalid(file, `unexpected </${name}>`)
			index = end + 1
			continue
		}
		const tag = /^<([A-Za-z][\w:.-]*)/.exec(source.slice(open))
		if (!tag) invalid(file, `invalid markup at offset ${open}`)
		const element: Element = { attributes: new Map(), children: [], name: tag[1]! }
		let cursor = open + tag[0].length
		const attribute = /\s*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y
		for (;;) {
			const close = /^\s*(\/?)>/.exec(source.slice(cursor))
			if (close) {
				cursor += close[0].length
				stack.at(-1)!.children.push(element)
				if (!close[1]) stack.push(element)
				break
			}
			attribute.lastIndex = cursor
			const match = attribute.exec(source)
			if (!match) invalid(file, `invalid attribute in <${element.name}>`)
			element.attributes.set(match[1]!, decode(match[2] ?? match[3] ?? match[4] ?? ''))
			cursor = attribute.lastIndex
		}
		index = cursor
	}
	if (stack.length > 1) invalid(file, `unclosed <${stack.at(-1)!.name}>`)
	return root
}

/** Whether an attribute value refers only to the icon itself. */
function safeValue(name: string, value: string): boolean {
	const lower = value.toLowerCase().replace(/\s+/g, '')
	if (/javascript:|vbscript:|data:|expression\(|@import|[<>]/.test(lower)) return false
	if (name === 'href' || name === 'xlink:href') return /^#[\w:.-]+$/.test(value.trim())
	for (const reference of lower.matchAll(/url\(([^)]*)\)/g)) if (!/^['"]?#[\w:.-]+['"]?$/.test(reference[1]!)) return false
	return true
}

function isColor(value: string): boolean {
	const lower = value.trim().toLowerCase()
	return !!lower && !['currentcolor', 'inherit', 'none', 'transparent'].includes(lower) && !lower.startsWith('url(')
}

/** The distinct colors of the paint attributes of a tree. */
function colors(nodes: readonly Node[], found: Set<string>): Set<string> {
	for (const node of nodes) {
		if (typeof node === 'string') continue
		for (const [name, value] of node.attributes) if (paints.has(name) && isColor(value)) found.add(value.trim().toLowerCase())
		colors(node.children, found)
	}
	return found
}

function serialize(nodes: readonly Node[], monochrome: boolean): string {
	let output = ''
	for (const node of nodes) {
		if (typeof node === 'string') {
			output += escapeText(node.replace(/\s+/g, ' '))
			continue
		}
		if (dropped.has(node.name) || !elements.has(node.name)) continue
		const kept: string[] = []
		for (const [name, raw] of node.attributes) {
			if (!attributes.has(name) || !safeValue(name, raw)) continue
			const value = monochrome && paints.has(name) && isColor(raw) ? 'currentColor' : raw
			kept.push(` ${name}="${escapeAttribute(value)}"`)
		}
		const children = serialize(node.children, monochrome)
		output += children ? `<${node.name}${kept.join('')}>${children}</${node.name}>` : `<${node.name}${kept.join('')}/>`
	}
	return output.replace(/>\s+</g, '><').trim()
}

function dimension(value: string | undefined): number | undefined {
	const match = value && /^\s*(\d*\.?\d+)(?:px)?\s*$/.exec(value)
	return match ? Number(match[1]) : undefined
}

/**
 * Cleans an SVG file of the project and returns its `viewBox` and content, ready to embed.
 *
 * @param source Text of the SVG file.
 * @param file Name of the file, for the errors.
 * @returns The icon, monochrome ones normalized to `currentColor`.
 * @throws {TypeError} If the file is not a single `<svg>` element or has no usable `viewBox`.
 */
export function sanitizeSvg(source: string, file: string): IconData {
	const root = parse(source.replace(/^\uFEFF/, ''), file)
	const svgs = root.children.filter((node): node is Element => typeof node !== 'string')
	if (svgs.length !== 1 || svgs[0]!.name !== 'svg') invalid(file, 'must contain exactly one <svg> element')
	const svg = svgs[0]!
	let viewBox = svg.attributes
		.get('viewBox')
		?.trim()
		.split(/[\s,]+/)
		.map(Number)
	if (!viewBox) {
		const width = dimension(svg.attributes.get('width'))
		const height = dimension(svg.attributes.get('height'))
		if (width && height) viewBox = [0, 0, width, height]
	}
	if (!viewBox || viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)) || viewBox[2]! <= 0 || viewBox[3]! <= 0) invalid(file, 'needs a viewBox (or a numeric width and height)')
	const monochrome = colors([svg], new Set()).size <= 1
	const wrapper = new Map<string, string>()
	for (const [name, value] of svg.attributes) if (inherited.has(name)) wrapper.set(name, value)
	const content: Element = wrapper.size ? { attributes: wrapper, children: svg.children, name: 'g' } : { attributes: new Map(), children: svg.children, name: '#fragment' }
	const body = content.name === 'g' ? serialize([content], monochrome) : serialize(content.children, monochrome)
	if (!body) invalid(file, 'has no drawable content after sanitizing')
	return [viewBox.join(' '), body]
}
