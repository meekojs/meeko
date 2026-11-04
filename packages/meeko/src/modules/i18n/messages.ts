/** A compact catalog representation produced before Vite bundles the application. */
export type Message = readonly (string | { readonly arg: string })[] | { readonly plural: string; readonly forms: Readonly<Record<string, readonly (string | { readonly arg: string })[]>> } | { readonly select: string; readonly forms: Readonly<Record<string, readonly (string | { readonly arg: string })[]>> }

export type Catalog = Readonly<Record<string, Message>>

const placeholder = /\{([A-Za-z_][A-Za-z_0-9]*)\}/g

function parts(value: string): readonly (string | { readonly arg: string })[] {
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
	const add = (key: string, value: unknown): void => {
		if (Object.hasOwn(catalog, key)) throw new TypeError(`${file}: duplicate message key ${key}`)
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			if (typeof value !== 'string') throw new TypeError(`${file}: ${key} must be a message`)
			catalog[key] = parts(value)
			return
		}
		const object = value as Record<string, unknown>
		const kind = typeof object.plural === 'string' ? 'plural' : typeof object.select === 'string' ? 'select' : undefined
		if (kind) {
			if (!object.forms || typeof object.forms !== 'object' || Array.isArray(object.forms)) throw new TypeError(`${file}: ${key}.forms must be an object`)
			const forms: Record<string, readonly (string | { readonly arg: string })[]> = Object.create(null)
			for (const [name, text] of Object.entries(object.forms)) {
				if (typeof text !== 'string') throw new TypeError(`${file}: ${key}.forms.${name} must be text`)
				forms[name] = parts(text)
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
