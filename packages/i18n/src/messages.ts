/** The text and placeholders of one message or form. */
export type MessageParts = readonly (string | { readonly arg: string })[]

/** A compact catalog representation produced before Vite bundles the application. */
export type Message = MessageParts | { readonly plural: string; readonly forms: Readonly<Record<string, MessageParts>> } | { readonly select: string; readonly forms: Readonly<Record<string, MessageParts>> }

export type Catalog = Readonly<Record<string, Message>>

/** A run of a rich message: plain, or the content of a tag that `<I18nT>` gives to a snippet. */
export interface RichSegment {
	readonly tag?: string
	readonly parts: MessageParts
}

/** `<code>`, `</code>` and `<br/>`, with the names that `<snippet name>` accepts. */
const tagToken = /<(\/?)([A-Za-z_$][\w$]*(?:-[\w$]+)*)(\/?)>/g

type Token = { readonly kind: 'piece'; readonly piece: MessageParts[number] } | { readonly kind: 'open' | 'close' | 'void'; readonly name: string; readonly raw: string }

function tokenize(parts: MessageParts): Token[] {
	const tokens: Token[] = []
	for (const part of parts) {
		if (typeof part !== 'string') {
			tokens.push({ kind: 'piece', piece: part })
			continue
		}
		let end = 0
		for (const match of part.matchAll(tagToken)) {
			// `</x/>` is no tag, and `__proto__` or `constructor` could never name a snippet safely.
			if ((match[1] && match[3]) || match[2]! in Object.prototype) continue
			if (match.index > end) tokens.push({ kind: 'piece', piece: part.slice(end, match.index) })
			tokens.push({ kind: match[1] ? 'close' : match[3] ? 'void' : 'open', name: match[2]!, raw: match[0] })
			end = match.index + match[0].length
		}
		if (end < part.length) tokens.push({ kind: 'piece', piece: part.slice(end) })
	}
	return tokens
}

const literal = (token: Token): MessageParts[number] => (token.kind === 'piece' ? token.piece : token.raw)

/**
 * Splits a message by its tags, reading only the catalog's text: a placeholder is one opaque piece,
 * so a value never becomes a tag. A paired `<name>…</name>` and a `<name/>` are tags; anything else
 * that looks like one (`<T>` alone, an attribute) stays text, as `t()` shows it.
 *
 * @throws {TypeError} For a tag inside another tag: its snippet receives text, not markup.
 */
export function richSegments(parts: MessageParts): readonly RichSegment[] {
	const tokens = tokenize(parts)
	const segments: RichSegment[] = []
	let text: MessageParts[number][] = []
	const flush = (): void => {
		if (text.length) segments.push({ parts: text })
		text = []
	}
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index]!
		if (token.kind === 'void') {
			flush()
			segments.push({ tag: token.name, parts: [] })
			continue
		}
		const end = token.kind === 'open' ? tokens.findIndex((other, at) => at > index && other.kind === 'close' && other.name === token.name) : -1
		if (end < 0) {
			text.push(literal(token))
			continue
		}
		const inner = tokens.slice(index + 1, end)
		const nested = inner.find((other, at) => other.kind === 'void' || (other.kind === 'open' && inner.some((close, after) => after > at && close.kind === 'close' && close.name === other.name)))
		if (nested && nested.kind !== 'piece') throw new TypeError(`<${nested.name}> is nested inside <${(token as { name: string }).name}>; a tag cannot contain another tag`)
		flush()
		segments.push({ tag: (token as { name: string }).name, parts: inner.map(literal) })
		index = end
	}
	flush()
	return segments
}

/** The forms of a message: one for plain text, each form of a plural or a select. */
export function messageForms(message: Message): readonly MessageParts[] {
	return Array.isArray(message) ? [message as MessageParts] : Object.values((message as Exclude<Message, readonly unknown[]>).forms)
}

/** The tags of a message in any of its forms, sorted: the snippets that `<I18nT>` needs. */
export function messageTags(message: Message): readonly string[] {
	const tags = new Set<string>()
	for (const form of messageForms(message)) for (const segment of richSegments(form)) if (segment.tag !== undefined) tags.add(segment.tag)
	return [...tags].sort()
}

/** Parámetros requeridos por un mensaje, independientes del orden o de las categorías del idioma. */
export function messageParameters(message: Message): Readonly<Record<string, 'value' | 'number'>> {
	const parameters: Record<string, 'value' | 'number'> = Object.create(null)
	const structured = !Array.isArray(message) ? (message as Exclude<Message, readonly unknown[]>) : undefined
	const forms = structured ? Object.values(structured.forms) : [message as Extract<Message, readonly unknown[]>]
	for (const form of forms)
		for (const part of form) {
			if (typeof part === 'string' || (structured && 'plural' in structured && part.arg === 'count')) continue
			parameters[part.arg] = 'value'
		}
	if (structured && 'plural' in structured) parameters[structured.plural] = 'number'
	else if (structured) parameters[structured.select] = 'value'
	return Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)))
}

const placeholder = /\{([A-Za-z_][A-Za-z_0-9]*)\}/g

function parts(value: string): MessageParts {
	const result: Array<string | { readonly arg: string }> = []
	let end = 0
	for (const match of value.matchAll(placeholder)) {
		const start = match.index
		if (start > end) result.push(value.slice(end, start))
		result.push({ arg: match[1]! })
		end = start + match[0].length
	}
	if (end < value.length) result.push(value.slice(end))
	return result
}

/** Converts a JSON catalog into messages with no parsing work at render time. */
export function compileCatalog(source: unknown, file: string): Catalog {
	if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError(`${file}: catalog must be an object`)
	const catalog: Record<string, Message> = Object.create(null)
	const validated = (key: string, form: MessageParts): MessageParts => {
		try {
			richSegments(form)
		} catch (error) {
			throw new TypeError(`${file}: ${key}: ${(error as Error).message}`, { cause: error })
		}
		return form
	}
	const add = (key: string, value: unknown): void => {
		if (Object.hasOwn(catalog, key)) throw new TypeError(`${file}: duplicate message key ${key}`)
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			if (typeof value !== 'string') throw new TypeError(`${file}: ${key} must be a message`)
			catalog[key] = validated(key, parts(value))
			return
		}
		const object = value as Record<string, unknown>
		const kind = typeof object.plural === 'string' ? 'plural' : typeof object.select === 'string' ? 'select' : undefined
		if (kind) {
			if (!object.forms || typeof object.forms !== 'object' || Array.isArray(object.forms)) throw new TypeError(`${file}: ${key}.forms must be an object`)
			const forms: Record<string, MessageParts> = Object.create(null)
			for (const [name, text] of Object.entries(object.forms)) {
				if (typeof text !== 'string') throw new TypeError(`${file}: ${key}.forms.${name} must be text`)
				forms[name] = validated(`${key}.forms.${name}`, parts(text))
			}
			if (forms.other === undefined) throw new TypeError(`${file}: ${key}.forms.other is required`)
			catalog[key] = kind === 'plural' ? { plural: object.plural as string, forms } : { select: object.select as string, forms }
			return
		}
		for (const [name, child] of Object.entries(object)) add(key ? `${key}.${name}` : name, child)
	}
	for (const [key, value] of Object.entries(source)) add(key, value)
	return catalog
}
