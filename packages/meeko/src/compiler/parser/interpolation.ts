/** Expresión `{...}` encontrada en un texto de plantilla, con posiciones relativas a ese texto. */
export interface InterpolationSegment {
	/** Posición de la llave de apertura. */
	start: number
	/** Posición siguiente a la llave de cierre. */
	end: number
	/** Expresión sin espacios exteriores; conserva el salto de línea que cierra un comentario `//` final. */
	expression: string
	/** Posición del primer carácter de `expression`. */
	expressionStart: number
}

/** Resultado de analizar las interpolaciones de un texto de plantilla. */
export interface InterpolationScan {
	segments: InterpolationSegment[]
	/** Posición de la llave de apertura de una interpolación que no se cierra. */
	unterminated?: number
}

interface CodeEnd {
	close: number
	lineCommentEnd: number
}

const regexKeywords = new Set(['await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'of', 'return', 'throw', 'typeof', 'void', 'yield'])
const regexPunctuators = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', ';', '+', '-', '*', '%', '<', '>', '~', '^'])
const wordCharacter = /[\p{ID_Continue}$\u200C\u200D]/u
const lineTerminator = /[\n\r\u2028\u2029]/

/**
 * Localiza expresiones `{...}` de un texto de plantilla respetando llaves anidadas, cadenas,
 * plantillas literales con `${...}`, comentarios y expresiones regulares de JavaScript.
 * Compilador y editor comparten este análisis para producir las mismas posiciones.
 */
export function scanInterpolations(text: string): InterpolationScan {
	const segments: InterpolationSegment[] = []
	let index = 0
	while (index < text.length) {
		const open = text.indexOf('{', index)
		if (open < 0) break
		const end = scanCode(text, open + 1)
		if (!end) return { segments, unterminated: open }
		segments.push(segment(text, open, end))
		index = end.close + 1
	}
	return { segments }
}

/**
 * Posición de la llave que cierra la interpolación abierta en `open`, con las mismas reglas que
 * `scanInterpolations`; `undefined` si el texto termina antes. El parser de plantillas la usa
 * para que un `<` de la expresión (`{a < b}`) no abra una etiqueta.
 */
export function interpolationClose(text: string, open: number): number | undefined {
	return scanCode(text, open + 1)?.close
}

function segment(text: string, open: number, { close, lineCommentEnd }: CodeEnd): InterpolationSegment {
	const raw = text.slice(open + 1, close)
	const trimmed = raw.trim()
	const expressionStart = open + 1 + (trimmed ? raw.length - raw.trimStart().length : 0)
	// Un comentario `//` al final necesita su salto de línea para no anular el código que lo rodea.
	const endsInLineComment = trimmed !== '' && lineCommentEnd >= expressionStart && !text.slice(lineCommentEnd, close).trim()
	const expression = endsInLineComment ? text.slice(expressionStart, lineCommentEnd + 1) : trimmed
	return { start: open, end: close + 1, expression, expressionStart }
}

/**
 * Indica si el final de `code` queda dentro de una cadena, una plantilla literal (también en sus
 * sustituciones `${...}`) o un comentario, con las mismas reglas que `scanInterpolations`. Una
 * cadena que se corta en su línea termina ahí, como en TypeScript: escribir una no apaga el resto
 * del bloque.
 *
 * @example
 * endsInLiteralOrComment("const a = 'ho") // true
 * endsInLiteralOrComment("const a = 'hola'; ") // false
 */
export function endsInLiteralOrComment(code: string): boolean {
	let previous = ''
	let index = 0
	while (index < code.length) {
		const step = codeStep(code, index, previous)
		if (step.end >= 0) {
			index = step.end
			previous = step.previous
			continue
		}
		const char = code[index]
		const newline = char === "'" || char === '"' ? findLineTerminator(code, index + 1) : -1
		if (newline < 0) return true
		index = newline + 1
		previous = 'value'
	}
	return false
}

interface CodeStep {
	/** Posición siguiente al token; -1 si es una cadena, plantilla o comentario sin terminar. */
	end: number
	/** Lo que decide si una `/` posterior abre una expresión regular. */
	previous: string
	/** Salto de línea que cierra el comentario `//` de este token. */
	lineCommentEnd?: number
}

/** Avanza un token de código. Las llaves son un token más: quien recorre lleva su profundidad. */
function codeStep(text: string, index: number, previous: string): CodeStep {
	const char = text[index]!
	const next = text[index + 1]
	if (char === '/' && next === '/') {
		const newline = findLineTerminator(text, index + 2)
		return newline < 0 ? { end: -1, previous } : { end: newline + 1, previous, lineCommentEnd: newline }
	}
	if (char === '/' && next === '*') {
		const close = text.indexOf('*/', index + 2)
		return { end: close < 0 ? -1 : close + 2, previous }
	}
	if (/\s/.test(char)) return { end: index + 1, previous }
	if (char === "'" || char === '"') return { end: skipString(text, index, char), previous: 'value' }
	if (char === '`') return { end: skipTemplate(text, index), previous: 'value' }
	const regexEnd = char === '/' && regexAllowed(previous) ? skipRegex(text, index) : -1
	if (regexEnd > 0) return { end: regexEnd, previous: 'value' }
	if (wordCharacter.test(char)) {
		let end = index + 1
		while (end < text.length && wordCharacter.test(text[end]!)) end++
		// `obj.return / 2` divides: a keyword used as a property name is a value.
		return { end, previous: previous !== '.' && regexKeywords.has(text.slice(index, end)) ? 'keyword' : 'value' }
	}
	// `i++ / 2` divides after a postfix update; a prefix update is followed by its operand.
	if ((char === '+' || char === '-') && next === char) return { end: index + 2, previous: 'value' }
	return { end: index + 1, previous: char }
}

/** Recorre código hasta la llave que cierra el nivel inicial; `undefined` si el texto termina antes. */
function scanCode(text: string, start: number): CodeEnd | undefined {
	let depth = 0
	let previous = ''
	let lineCommentEnd = -1
	let index = start
	while (index < text.length) {
		const char = text[index]!
		if (char === '}' && depth === 0) return { close: index, lineCommentEnd }
		if (char === '{') depth++
		else if (char === '}') depth--
		const step = codeStep(text, index, previous)
		if (step.end < 0) return undefined
		if (step.lineCommentEnd !== undefined) lineCommentEnd = step.lineCommentEnd
		index = step.end
		previous = step.previous
	}
	return undefined
}

function regexAllowed(previous: string): boolean {
	return previous === 'keyword' || regexPunctuators.has(previous)
}

function findLineTerminator(text: string, start: number): number {
	for (let index = start; index < text.length; index++) {
		if (lineTerminator.test(text[index]!)) return index
	}
	return -1
}

/** Devuelve la posición siguiente a la comilla de cierre, o -1 si la cadena no termina en la línea. */
function skipString(text: string, start: number, quote: string): number {
	for (let index = start + 1; index < text.length; index++) {
		const char = text[index]!
		// A line continuation may end in CRLF.
		if (char === '\\') index += text[index + 1] === '\r' && text[index + 2] === '\n' ? 2 : 1
		else if (char === quote) return index + 1
		else if (char === '\n' || char === '\r') return -1
	}
	return -1
}

/** Devuelve la posición siguiente al acento grave de cierre, incluidas sustituciones anidadas. */
function skipTemplate(text: string, start: number): number {
	let index = start + 1
	while (index < text.length) {
		const char = text[index]!
		if (char === '\\') index += 2
		else if (char === '`') return index + 1
		else if (char === '$' && text[index + 1] === '{') {
			const end = scanCode(text, index + 2)
			if (!end) return -1
			index = end.close + 1
		} else index++
	}
	return -1
}

/** Devuelve la posición siguiente a una expresión regular literal, o -1 si no es válida en la línea. */
function skipRegex(text: string, start: number): number {
	let inClass = false
	for (let index = start + 1; index < text.length; index++) {
		const char = text[index]!
		if (char === '\\') index++
		else if (lineTerminator.test(char)) return -1
		else if (char === '[') inClass = true
		else if (char === ']') inClass = false
		else if (char === '/' && !inClass) {
			let end = index + 1
			while (end < text.length && wordCharacter.test(text[end]!)) end++
			return end
		}
	}
	return -1
}
