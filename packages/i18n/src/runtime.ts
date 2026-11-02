import type { I18n, I18nDirection, I18nMessageKey, I18nRichPart, I18nTranslateOptions } from './context'
import type { Catalog, Message, MessageParts, RichSegment } from './messages'

import { richSegments } from './messages'

type Values = Readonly<Record<string, string | number | boolean | null | undefined>>

/**
 * Idioma de una ruta: el primer segmento si es un idioma configurado; si no, el idioma por defecto.
 *
 * @param path Ruta (`pathname`), como `/en/guide`.
 * @param locales Idiomas configurados.
 * @param fallback Idioma de las rutas sin prefijo.
 * @returns El idioma de la ruta.
 * @example
 * ```ts
 * import { localeOf } from "@meekojs/i18n";
 *
 * localeOf("/en/guide", ["es", "en"], "es"); // "en"
 * localeOf("/guide", ["es", "en"], "es"); // "es"
 * ```
 */
export function localeOf(path: string, locales: readonly string[], fallback: string): string {
	const first = path.split('/')[1]
	return first && locales.includes(first) ? first : fallback
}

/**
 * Quita de una ruta el prefijo de idioma, si lo tiene; conserva la búsqueda y el fragmento.
 *
 * @param path Ruta interna, como `/en/guide?tab=a#b`.
 * @param locales Idiomas configurados.
 * @returns La ruta sin prefijo, como `/guide?tab=a#b`; `/en` da `/`.
 * @example
 * ```ts
 * import { stripLocale } from "@meekojs/i18n";
 *
 * stripLocale("/en/guide", ["es", "en"]); // "/guide"
 * ```
 */
export function stripLocale(path: string, locales: readonly string[]): string {
	const url = new URL(path, 'http://meeko.invalid')
	const segments = url.pathname.split('/')
	if (locales.includes(segments[1] ?? '')) segments.splice(1, 1)
	url.pathname = segments.join('/') || '/'
	return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Ruta equivalente de `path` en otro idioma, con la estrategia «idioma por defecto sin prefijo»:
 * `defaultLocale` no lleva prefijo y los demás idiomas sí. Sin `defaultLocale`, todos llevan
 * prefijo. Sustituye el prefijo que ya tenga y conserva la búsqueda y el fragmento.
 *
 * @param path Ruta interna, con o sin prefijo.
 * @param locale Idioma de destino.
 * @param locales Idiomas configurados.
 * @param defaultLocale Idioma que no lleva prefijo.
 * @returns La ruta relativa al origen.
 * @example
 * ```ts
 * import { localizedPath } from "@meekojs/i18n";
 *
 * localizedPath("/guide?tab=a", "en", ["es", "en"], "es"); // "/en/guide?tab=a"
 * localizedPath("/en/guide", "es", ["es", "en"], "es"); // "/guide"
 * ```
 */
export function localizedPath(path: string, locale: string, locales: readonly string[], defaultLocale?: string): string {
	const url = new URL(stripLocale(path, locales), 'http://meeko.invalid')
	if (locale !== defaultLocale) url.pathname = `/${locale}${url.pathname === '/' ? '' : url.pathname}`
	return `${url.pathname}${url.search}${url.hash}`
}

/** Preferences of an `Accept-Language` header, by decreasing quality; `*` and `q=0` are dropped. */
function acceptLanguage(header: string): string[] {
	return header
		.split(',')
		.map((part, index) => {
			const [tag = '', ...parameters] = part.trim().split(';')
			const quality = parameters.map((parameter) => /^\s*q\s*=\s*([\d.]+)\s*$/.exec(parameter)?.[1]).find(Boolean)
			return { tag: tag.trim(), quality: quality === undefined ? 1 : Number(quality), index }
		})
		.filter((entry) => entry.tag && entry.tag !== '*' && entry.quality > 0)
		.sort((left, right) => right.quality - left.quality || left.index - right.index)
		.map((entry) => entry.tag)
}

/**
 * Elige el idioma configurado que mejor encaja con las preferencias del usuario: primero una
 * coincidencia exacta y después el mismo idioma base (`en-US` elige `en`, `es` elige `es-MX`).
 *
 * @param preferences Una cabecera `Accept-Language` o una lista como `navigator.languages`.
 * @param locales Idiomas configurados.
 * @returns El idioma elegido o `undefined` si ninguno encaja.
 * @example
 * ```ts
 * import { negotiateLocale } from "@meekojs/i18n";
 *
 * negotiateLocale("en-US,en;q=0.9,es;q=0.8", ["es", "en"]); // "en"
 * negotiateLocale(navigator.languages, ["es", "en"]);
 * ```
 */
export function negotiateLocale(preferences: string | readonly string[] | null | undefined, locales: readonly string[]): string | undefined {
	if (!preferences) return undefined
	const wanted = typeof preferences === 'string' ? acceptLanguage(preferences) : preferences
	const lower = locales.map((locale) => locale.toLowerCase())
	for (const preference of wanted) {
		const tag = preference.toLowerCase()
		const exact = lower.indexOf(tag)
		if (exact >= 0) return locales[exact]
		const base = tag.split('-')[0]
		const related = lower.findIndex((locale) => locale === base || locale.split('-')[0] === base)
		if (related >= 0) return locales[related]
	}
	return undefined
}

/**
 * Cookie que recuerda el idioma elegido: su nombre y, para compartirla entre subdominios, su dominio.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { I18nCookie } from "@meekojs/i18n";
 *
 * const cookie: I18nCookie = { name: "meeko-locale", domain: "meekojs.com", maxAge: 31536000 };
 * ```
 */
export interface I18nCookie {
	/** Nombre de la cookie. */
	readonly name: string
	/**
	 * Atributo `Domain`, como `"meekojs.com"` para compartirla con sus subdominios. Se omite en un host
	 * que no pertenece a ese dominio (`localhost`, una vista previa), donde el navegador la rechazaría:
	 * allí la cookie queda en el host actual, sin configurar nada por entorno.
	 */
	readonly domain?: string
	/** Duración en segundos. */
	readonly maxAge?: number
}

/**
 * Lee el idioma de una cabecera `Cookie` o de `document.cookie`.
 *
 * @param cookies Texto de las cookies.
 * @param name Nombre de la cookie.
 * @param locales Idiomas configurados; otro valor se ignora.
 * @returns El idioma guardado o `undefined`.
 * @example
 * ```ts
 * import { readLocaleCookie } from "@meekojs/i18n";
 *
 * readLocaleCookie("theme=dark; meeko-locale=en", "meeko-locale", ["es", "en"]); // "en"
 * ```
 */
export function readLocaleCookie(cookies: string | null | undefined, name: string, locales: readonly string[]): string | undefined {
	for (const part of (cookies ?? '').split(';')) {
		const separator = part.indexOf('=')
		if (separator < 0 || part.slice(0, separator).trim() !== name) continue
		let value = part.slice(separator + 1).trim()
		try {
			value = decodeURIComponent(value)
		} catch {
			continue
		}
		return locales.includes(value) ? value : undefined
	}
	return undefined
}

/**
 * `Set-Cookie`/`document.cookie` text that remembers `locale`. `Domain` is left out when `hostname`
 * is not that domain or one of its subdomains: the browser would reject the whole cookie.
 */
export function localeCookie(cookie: I18nCookie, locale: string, hostname?: string): string {
	const domain = cookie.domain?.replace(/^\./, '').toLowerCase()
	const host = hostname?.toLowerCase()
	const shared = domain && (host === undefined || host === domain || host.endsWith(`.${domain}`))
	return [`${cookie.name}=${encodeURIComponent(locale)}`, 'Path=/', `Max-Age=${cookie.maxAge ?? 31_536_000}`, 'SameSite=Lax', ...(shared ? [`Domain=${domain}`] : [])].join('; ')
}

/**
 * Lo que necesita {@link createI18n}: el idioma, su catálogo y la configuración de rutas.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { CreateI18nOptions } from "@meekojs/i18n";
 *
 * const options: CreateI18nOptions = { locale: "es", catalog: {}, locales: ["es", "en"], defaultLocale: "es", path: () => "/" };
 * ```
 */
export interface CreateI18nOptions {
	/** Idioma de este documento. */
	readonly locale: string
	/** Mensajes compilados de los namespaces cargados. */
	readonly catalog: Catalog
	/** Mensajes de otros idiomas que admite `t(key, values, { locale })`, por idioma. */
	readonly foreign?: Readonly<Record<string, Catalog>>
	/** Idiomas configurados, en orden. */
	readonly locales: readonly string[]
	/** Idioma sin prefijo. */
	readonly defaultLocale: string
	/** Idiomas `rtl`; los demás son `ltr`. */
	readonly directions?: Readonly<Record<string, I18nDirection>>
	/** URL actual relativa al origen, con búsqueda y fragmento. */
	readonly path: () => string
	/** Si la página actual tiene versión en un idioma; por defecto, todos la tienen. */
	readonly available?: (locale: string) => boolean
	/** Navega a otra URL; por defecto no hace nada (servidor). */
	readonly navigate?: (path: string) => void
	/** Cookie que recuerda el idioma elegido; `false` la desactiva. */
	readonly cookie?: I18nCookie | false
	/** Texto de las cookies del navegador; por defecto, `document.cookie` si existe. */
	readonly cookies?: () => string
	/** Preferencias del navegador; por defecto, `navigator.languages` si existe. */
	readonly languages?: () => readonly string[]
	/**
	 * Texto de una clave sin mensaje en `catalog`, como la de un namespace no cargado. Sin ella, `t()`
	 * lanza `ReferenceError`. El plugin del módulo devuelve la clave y avisa una vez por clave.
	 */
	readonly missing?: (key: string, locale: string) => string
}

function render(parts: MessageParts, values: Values): string {
	let result = ''
	for (const part of parts) {
		if (typeof part === 'string') result += part
		else {
			const value = values[part.arg]
			if (value === undefined || value === null) throw new TypeError(`Missing i18n value ${part.arg}`)
			result += String(value)
		}
	}
	return result
}

/** Tags of each compiled form: a catalog's forms never change, so each one is split once. */
const segmentsOf = new WeakMap<MessageParts, readonly RichSegment[]>()

function segments(parts: MessageParts): readonly RichSegment[] {
	let split = segmentsOf.get(parts)
	if (!split) segmentsOf.set(parts, (split = richSegments(parts)))
	return split
}

/**
 * Crea el traductor de una petición o de una pestaña. Los formateadores `Intl` se reutilizan por
 * opciones. El plugin del módulo lo crea por ti; úsalo directamente en pruebas o en hosts propios.
 *
 * @param options Idioma, catálogo y configuración de rutas.
 * @returns El traductor.
 * @example
 * ```ts
 * import { createI18n } from "@meekojs/i18n";
 *
 * const i18n = createI18n({ locale: "en", catalog, locales: ["es", "en"], defaultLocale: "es", path: () => "/en/guide" });
 * i18n.switchLocalePath("es"); // "/guide"
 * ```
 */
export function createI18n(options: CreateI18nOptions): I18n {
	const { locale, catalog, locales, defaultLocale } = options
	if (!locales.includes(locale) || !locales.includes(defaultLocale)) throw new RangeError(`Unsupported locale ${locale}`)
	const directions = options.directions ?? {}
	const plurals = new Map<string, Intl.PluralRules>()
	const numbers = new Map<string, Intl.NumberFormat>()
	const dates = new Map<string, Intl.DateTimeFormat>()
	const names = new Map<string, Intl.DisplayNames>()
	const supported = (target: string): string => {
		if (!locales.includes(target)) throw new RangeError(`Unsupported locale ${target}`)
		return target
	}
	const browser = typeof document === 'undefined' ? undefined : document
	const cookies = options.cookies ?? (() => browser?.cookie ?? '')
	const languages = options.languages ?? (() => (typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])))
	const remember = (target: string): void => {
		if (options.cookie && browser) browser.cookie = localeCookie(options.cookie, target, browser.location?.hostname)
	}
	/** The form of `key` that applies to `values` in `target`, with the values it renders with. */
	const formOf = (key: string, values: Values, target: string): { readonly parts: MessageParts; readonly values: Values } | undefined => {
		const message = target === locale ? catalog[key] : options.foreign?.[target]?.[key]
		if (message === undefined) return undefined
		if (Array.isArray(message)) return { parts: message as MessageParts, values }
		const selected = message as Exclude<Message, readonly unknown[]>
		if ('plural' in selected) {
			const value = values[selected.plural]
			if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${key}: ${selected.plural} must be a finite number`)
			let rules = plurals.get(target)
			if (!rules) plurals.set(target, (rules = new Intl.PluralRules(target)))
			return { parts: selected.forms[`=${value}`] ?? selected.forms[rules.select(value)] ?? selected.forms.other!, values: { ...values, count: value } }
		}
		return { parts: selected.forms[String(values[selected.select])] ?? selected.forms.other!, values }
	}
	/** The text of a message that is not loaded, or the error without `missing`. */
	const absent = (key: string, target: string): string => {
		if (options.missing) return options.missing(key, target)
		throw new ReferenceError(`Missing i18n message ${key} for ${target}`)
	}
	// La firma pública correlaciona clave y valores; el runtime interpreta el catálogo ya validado.
	const request = (args: readonly unknown[]): { readonly values: Values; readonly target: string } => ({
		values: args[0] === undefined ? {} : (args[0] as Values),
		target: (args[1] as I18nTranslateOptions | undefined)?.locale === undefined ? locale : supported((args[1] as I18nTranslateOptions).locale!),
	})
	return {
		locale,
		defaultLocale,
		locales,
		dir: directions[locale] ?? 'ltr',
		t(key: string, ...args: readonly unknown[]) {
			const { values, target } = request(args)
			const form = formOf(key, values, target)
			return form ? render(form.parts, form.values) : absent(key, target)
		},
		has(key: string, translateOptions?: I18nTranslateOptions): key is I18nMessageKey {
			const target = translateOptions?.locale === undefined ? locale : supported(translateOptions.locale)
			const messages = target === locale ? catalog : options.foreign?.[target]
			return messages !== undefined && Object.hasOwn(messages, key)
		},
		rich(key: string, ...args: readonly unknown[]) {
			const { values, target } = request(args)
			const form = formOf(key, values, target)
			if (!form) return [{ text: absent(key, target) }]
			return segments(form.parts).map((segment): I18nRichPart => {
				const text = render(segment.parts, form.values)
				return segment.tag === undefined ? { text } : { tag: segment.tag, text }
			})
		},
		number(value, formatOptions) {
			const id = JSON.stringify(formatOptions ?? {})
			let formatter = numbers.get(id)
			if (!formatter) numbers.set(id, (formatter = new Intl.NumberFormat(locale, formatOptions)))
			return formatter.format(value)
		},
		date(value, formatOptions) {
			const id = JSON.stringify(formatOptions ?? {})
			let formatter = dates.get(id)
			if (!formatter) dates.set(id, (formatter = new Intl.DateTimeFormat(locale, formatOptions)))
			return formatter.format(value)
		},
		localePath(path, target = locale) {
			return localizedPath(path, supported(target), locales, defaultLocale)
		},
		switchLocalePath(target) {
			return localizedPath(options.path(), supported(target), locales, defaultLocale)
		},
		pageLocales() {
			return options.available ? locales.filter((target) => target === locale || options.available!(target)) : locales
		},
		localeName(target, display = target) {
			let formatter = names.get(display)
			if (!formatter) names.set(display, (formatter = new Intl.DisplayNames([display], { type: 'language' })))
			const name = formatter.of(supported(target)) ?? target
			return name.charAt(0).toLocaleUpperCase(display) + name.slice(1)
		},
		directionOf(target) {
			return directions[supported(target)] ?? 'ltr'
		},
		suggestedLocale() {
			// On a server `navigator` may exist (Node, Workers) but describes the host, not the reader.
			if (!browser && !options.cookies && !options.languages) return undefined
			const preferred = (options.cookie ? readLocaleCookie(cookies(), options.cookie.name, locales) : undefined) ?? negotiateLocale(languages(), locales)
			return preferred === undefined || preferred === locale ? undefined : preferred
		},
		rememberLocale(target) {
			remember(supported(target))
		},
		switchLocale(target) {
			remember(supported(target))
			options.navigate?.(localizedPath(options.path(), target, locales, defaultLocale))
		},
	}
}
