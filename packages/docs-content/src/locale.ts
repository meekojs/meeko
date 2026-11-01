// The languages of the documentation, without any dependency: the browser imports it too (the
// public sites split their URLs with it), so it must stay free of `pg`, Node and the render.

/**
 * A language of the documentation. Spanish is the original and the default: its URLs have no
 * prefix. English is translated in `docs/en/**` and its URLs start with `/en/`.
 */
export type DocsLocale = 'en' | 'es'

/** The languages, the default first. */
export const docsLocales: readonly DocsLocale[] = ['es', 'en']

/** The language of the originals, whose URLs have no prefix. */
export const defaultLocale: DocsLocale = 'es'

/**
 * How the page of a translated language was made, against its Spanish original:
 *
 * - `translated`: the translation was made from the Spanish text that Git has now.
 * - `outdated`: the Spanish original changed after it was translated (or the translation does not
 *   say what it was translated from). The translation is still published.
 * - `missing`: there is no translation; the Spanish page is published in its place (`fallback`).
 */
export type TranslationStatus = 'missing' | 'outdated' | 'translated'

/** The translation statuses, in display order. */
export const translationStatuses: readonly TranslationStatus[] = ['translated', 'outdated', 'missing']

/**
 * The language of a page of a snapshot, as its payload carries it in `i18n`: what the site needs
 * to show the «sin traducir» notice and the alternate links.
 */
export interface PageLocale {
	readonly locale: DocsLocale
	/**
	 * Its {@link TranslationStatus} in a translated language, or `null` when it has nothing to
	 * translate (the home page, an index) or is the original.
	 */
	readonly status: TranslationStatus | null
	/** `true` when the content is the Spanish original because the translation is missing. */
	readonly fallback: boolean
}

/** Whether `value` is a {@link DocsLocale}. */
export function isDocsLocale(value: unknown): value is DocsLocale {
	return value === 'es' || value === 'en'
}

/**
 * `locale` checked, or {@link defaultLocale} when it is `undefined` or `null`: what every function
 * of the package does with its optional `locale`. Throws `TypeError` for another value.
 */
export function checkLocale(locale: string | null | undefined): DocsLocale {
	if (locale === undefined || locale === null) return defaultLocale
	if (!isDocsLocale(locale)) throw new TypeError(`Unknown documentation locale: ${locale}`)
	return locale
}

/** The URL prefix of a language: `''` for Spanish and `/en` for English. */
export function localePrefix(locale: DocsLocale): '' | '/en' {
	return locale === 'en' ? '/en' : ''
}

/**
 * The public URL of a page of `locale` from its path without prefix, keeping its query and
 * fragment: `/docs/api#x` is `/en/docs/api#x` in English, and `/` is `/en`. Spanish is unchanged.
 */
export function localizedPath(path: string, locale: DocsLocale): string {
	const prefix = localePrefix(locale)
	if (!prefix || !path.startsWith('/')) return path
	if (path === '/') return prefix
	if (path.startsWith('/?') || path.startsWith('/#')) return `${prefix}${path.slice(1)}`
	return `${prefix}${path}`
}

/**
 * The language of a public URL and its path without the prefix, keeping query and fragment:
 * `/en/docs/api` is `{ locale: 'en', path: '/docs/api' }`, `/en` is `{ locale: 'en', path: '/' }`
 * and any other path is Spanish as it is. Only a first segment exactly `en` is a prefix.
 */
export function splitLocalePath(href: string): { readonly locale: DocsLocale; readonly path: string } {
	const match = /^\/en(?=$|[/?#])/.exec(href)
	if (!match) return { locale: defaultLocale, path: href }
	const rest = href.slice(match[0].length)
	if (!rest || rest.startsWith('?') || rest.startsWith('#')) return { locale: 'en', path: `/${rest}` }
	return { locale: 'en', path: rest }
}

/**
 * The status of a translation: `missing` without one, `translated` when the hash it was translated
 * from is the hash of the original now, and `outdated` otherwise, also when it does not say.
 */
export function translationStatus(translation: { readonly sourceHash: string | null } | null, originalHash: string | null): TranslationStatus {
	if (!translation) return 'missing'
	return translation.sourceHash !== null && translation.sourceHash === originalHash ? 'translated' : 'outdated'
}
