// Padlock of the design programme: packages/ui is the only source of design. Fails when apps/** or
// packages/docs/** write a colour, a font size, a font family or a font face of their own instead of
// reading the --ui-* tokens, or still read a removed --meeko-ui-* variable. Only real CSS counts: the
// stylesheets, the <style> of a component, its style attributes and the SVG colour attributes. Example
// code (attribute values such as `code="…"`, text, `<pre>`, TypeScript) is not CSS and is not read.
// It also fails on a space before punctuation that follows an element: the compiler keeps the text of
// a template as written, so `<code>x</code>⏎.` renders as `x .`. No dependencies: it runs before a build.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { designExceptions } from './design-tokens-exceptions.mjs'

/** Roots of the check, relative to the repository. */
export const designRoots = ['apps', 'packages/docs']

// Output, caches, public assets and tests: none of them is a source of the design of the application.
const skippedDirectories = new Set(['node_modules', 'dist', 'dist-static', 'coverage', 'artifacts', 'public', 'tests', '.meeko', '.output'])
const rawElements = new Set(['pre', 'script', 'style', 'textarea'])
// `fill="#123"` paints as much as `fill: #123`. A `.` before a letter is a word (`.md`), not punctuation.
const colorAttributes = new Set(['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'])
const leadingPunctuation = /^\s*\n\s*(?:[,;:)!?»”…]|\.(?![\p{L}\p{N}]))/u
const trailingPunctuation = /[(«“¿¡]\s*\n\s*$/u

const hexColor = /(?<![\w&-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi
const colorFunction = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi

function lineOf(text, index) {
	let line = 1
	for (let position = text.indexOf('\n'); position !== -1 && position < index; position = text.indexOf('\n', position + 1)) line++
	return line
}

/** Blanks the comments keeping every offset, so that a line number stays true. */
function blankComments(css) {
	return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
}

/**
 * The preludes and declarations of a stylesheet, with nesting: what ends in `{` is a prelude and what
 * ends in `;` or `}` is a declaration. A `;` or a brace inside a string or `url()` does not end anything.
 */
function cssSegments(source) {
	const css = blankComments(source)
	const segments = []
	let start = 0
	let quote = null
	let parentheses = 0
	for (let index = 0; index < css.length; index++) {
		const char = css[index]
		if (quote) {
			if (char === '\\') index++
			else if (char === quote) quote = null
			continue
		}
		if (char === '"' || char === "'") quote = char
		else if (char === '(') parentheses++
		else if (char === ')') parentheses = Math.max(0, parentheses - 1)
		else if (!parentheses && (char === '{' || char === ';' || char === '}')) {
			const text = css.slice(start, index)
			if (text.trim()) segments.push({ kind: char === '{' ? 'prelude' : 'declaration', text: text.trim(), offset: start + text.length - text.trimStart().length })
			start = index + 1
		}
	}
	if (css.slice(start).trim()) segments.push({ kind: 'declaration', text: css.slice(start).trim(), offset: start })
	return segments
}

/** A font value is fine if, without its `var(--ui-*)` and `calc()` wrappers, only a CSS-wide keyword remains or nothing. */
function readsFontToken(value) {
	const clean = value.replace(/\s*!important\s*$/i, '').trim()
	if (/^(?:inherit|initial|unset|revert|revert-layer)$/i.test(clean)) return true
	if (!/var\(\s*--ui-/.test(clean)) return false
	// Every var() must be a --ui-* token, also as a fallback; nothing with a unit may be left around them.
	if (/var\(\s*--(?!ui-)/.test(clean)) return false
	return !/(?<![\w-])\d*\.?\d+(?:px|r?em|ex|ch|pt|vw|vh|vmin|vmax|%)/i.test(clean.replace(/\bvar\([^()]*\)/g, ''))
}

/** Findings of one piece of real CSS, a stylesheet or a style attribute; `offset` is where it starts in the file. */
export function scanCss(css, offset = 0) {
	const findings = []
	const add = (rule, text, at) => findings.push({ rule, value: text.replace(/\s+/g, ' ').trim(), offset: offset + at })
	for (const segment of cssSegments(css)) {
		if (segment.text.includes('--meeko-ui-')) add('meeko-ui-variable', segment.text, segment.offset)
		if (segment.kind === 'prelude') {
			if (/^@font-face\b/i.test(segment.text)) add('font-face', '@font-face', segment.offset)
			continue
		}
		const colon = segment.text.indexOf(':')
		if (colon === -1) continue
		const property = segment.text.slice(0, colon).trim().toLowerCase()
		const value = segment.text.slice(colon + 1).trim()
		// A fragment in `url(#gradient)` and the text of a string are not colours.
		const paint = value.replace(/url\([^)]*\)/gi, 'url()').replace(/"[^"]*"|'[^']*'/g, '""')
		if ((paint.match(hexColor) ?? []).length) add('hex-color', segment.text, segment.offset)
		if ((paint.match(colorFunction) ?? []).length) add('color-function', segment.text, segment.offset)
		if ((property === 'font-size' || property === 'font-family' || property === 'font') && !readsFontToken(value)) add(property, segment.text, segment.offset)
	}
	return findings
}

/**
 * The tags, text and raw content of a template. A `>` inside an attribute value does not end its tag,
 * and a `<` inside `{expression}` does not start one.
 */
export function templateTokens(template) {
	const tokens = []
	let index = 0
	while (index < template.length) {
		if (template.startsWith('<!--', index)) {
			const end = template.indexOf('-->', index)
			index = end === -1 ? template.length : end + 3
			tokens.push({ type: 'comment', start: index, end: index })
			continue
		}
		const tag = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(template.slice(index, index + 128))
		if (tag) {
			let cursor = index + tag[0].length
			let quote = null
			const attributes = []
			let attributeStart = -1
			for (; cursor < template.length; cursor++) {
				const char = template[cursor]
				if (quote) {
					if (char === quote) {
						attributes.push({ name: template.slice(attributeStart, template.indexOf('=', attributeStart)).trim(), valueStart: template.indexOf('=', attributeStart) + 2, valueEnd: cursor })
						quote = null
						attributeStart = -1
					}
				} else if (char === '"' || char === "'") quote = char
				else if (char === '>') break
				else if (attributeStart === -1 && !/\s/.test(char) && char !== '/') attributeStart = cursor
				else if (attributeStart !== -1 && /\s/.test(char) && template[cursor + 1] !== '=' && !template.slice(attributeStart, cursor).includes('=')) attributeStart = -1
			}
			const selfClosing = template[cursor - 1] === '/'
			const end = cursor + 1
			tokens.push({ type: tag[1] ? 'close' : selfClosing ? 'self' : 'open', name: tag[2], start: index, end, attributes })
			index = end
			if (!tag[1] && !selfClosing && rawElements.has(tag[2])) {
				const close = template.indexOf(`</${tag[2]}`, index)
				const stop = close === -1 ? template.length : close
				tokens.push({ type: 'raw', name: tag[2], start: index, end: stop })
				index = stop
			}
			continue
		}
		let cursor = index
		let depth = 0
		let quote = null
		for (; cursor < template.length; cursor++) {
			const char = template[cursor]
			if (depth) {
				if (quote) {
					if (char === '\\') cursor++
					else if (char === quote) quote = null
				} else if (char === '"' || char === "'" || char === '`') quote = char
				else if (char === '{') depth++
				else if (char === '}') depth--
				continue
			}
			if (char === '{') depth = 1
			else if (char === '<' && /[A-Za-z/!]/.test(template[cursor + 1] ?? '')) break
		}
		tokens.push({ type: 'text', start: index, end: cursor })
		index = cursor === index ? index + 1 : cursor
	}
	return tokens
}

/** The string literals of a `bind:style` expression, and an object key such as `fontSize` with its value. */
function scanStyleExpression(expression, offset) {
	const findings = []
	for (const match of expression.matchAll(/'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)) {
		const literal = match[1] ?? match[2]
		const before = expression.slice(0, match.index)
		const key = /(?:^|[{,\s])(?:'?)(font-size|font-family|fontSize|fontFamily)(?:'?)\s*:\s*$/.exec(before)
		if (key) {
			const property = key[1].replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
			if (!readsFontToken(literal)) findings.push({ rule: property, value: `${property}: ${literal}`, offset: offset + match.index })
			continue
		}
		const prefix = /[;:]/.test(literal) ? literal : `x: ${literal}`
		for (const finding of scanCss(prefix, offset + match.index)) findings.push(finding)
	}
	return findings
}

/** Findings of a `.meeko`: its `<style>`, the style and colour attributes of its template and the text around its elements. */
export function scanMeeko(source) {
	const findings = []
	for (const match of source.matchAll(/^<style\b[^>]*>([\s\S]*?)^<\/style>/gm)) findings.push(...scanCss(match[1], match.index + match[0].indexOf('>') + 1))
	const open = /^<template\b[^>]*>/m.exec(source)
	const close = source.lastIndexOf('</template>')
	if (!open || close === -1) return findings
	const start = open.index + open[0].length
	const template = source.slice(start, close)
	const tokens = templateTokens(template)
	tokens.forEach((token, index) => {
		if (token.type === 'raw' && token.name === 'style') findings.push(...scanCss(template.slice(token.start, token.end), start + token.start))
		for (const attribute of token.attributes ?? []) {
			const value = template.slice(attribute.valueStart, attribute.valueEnd)
			const at = start + attribute.valueStart
			if (attribute.name === 'style') findings.push(...scanCss(value, at))
			else if (attribute.name === 'bind:style') findings.push(...scanStyleExpression(value, at))
			else if (colorAttributes.has(attribute.name) && (value.match(hexColor) || value.match(colorFunction))) findings.push({ rule: 'hex-color', value: `${attribute.name}="${value}"`, offset: at })
		}
		if (token.type !== 'text') return
		const text = template.slice(token.start, token.end)
		const previous = tokens[index - 1]
		const next = tokens[index + 1]
		if ((previous?.type === 'close' || previous?.type === 'self') && leadingPunctuation.test(text)) findings.push({ rule: 'space-before-punctuation', value: `</${previous.name}> ${text.trim().slice(0, 24)}`, offset: start + token.start })
		if ((next?.type === 'open' || next?.type === 'self') && trailingPunctuation.test(text)) findings.push({ rule: 'space-before-punctuation', value: `${text.trim().slice(-24)} <${next.name}>`, offset: start + token.end })
	})
	return findings
}

/**
 * Reads the files with `node:fs`, never with a glob, so that a name such as `[id].meeko` counts.
 */
function sourceFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		if (skippedDirectories.has(entry.name)) return []
		const path = join(directory, entry.name)
		if (entry.isDirectory()) return sourceFiles(path)
		return /\.(?:css|meeko)$/.test(entry.name) ? [path] : []
	})
}

/**
 * Runs the check on a repository. An exception covers one rule and one exact value of one file, and
 * one that nothing uses any more is an error too: the list cannot go stale.
 */
export function checkDesignTokens(root, { roots = designRoots, exceptions = designExceptions } = {}) {
	const violations = []
	const used = new Set()
	let files = 0
	for (const directory of roots) {
		for (const path of sourceFiles(resolve(root, directory))) {
			files++
			const file = relative(root, path).split(sep).join('/')
			const source = readFileSync(path, 'utf8')
			for (const finding of path.endsWith('.css') ? scanCss(source) : scanMeeko(source)) {
				const exception = exceptions.find((entry) => entry.file === file && entry.rule === finding.rule && entry.value === finding.value)
				if (exception) {
					used.add(exception)
					continue
				}
				violations.push({ file, line: lineOf(source, finding.offset), rule: finding.rule, value: finding.value })
			}
		}
	}
	const stale = exceptions.filter((entry) => !used.has(entry))
	return { files, violations, stale }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const root = fileURLToPath(new URL('../', import.meta.url))
	const { files, violations, stale } = checkDesignTokens(root)
	for (const { file, line, rule, value } of violations) console.error(`${file}:${line} ${rule}: ${value}`)
	for (const { file, rule, value } of stale) console.error(`scripts/design-tokens-exceptions.mjs: exception no longer used: ${file} ${rule}: ${value}`)
	if (violations.length || stale.length) {
		console.error(`\ndesign-tokens: ${violations.length} violation(s), ${stale.length} stale exception(s). Read the --ui-* tokens of packages/ui/DESIGN.md; if something is missing, add it to packages/ui.`)
		process.exit(1)
	}
	console.log(`design-tokens: ${files} files, no design outside the tokens.`)
}
