import type { RouteRecord } from '@meekojs/meeko/framework'

import { localizedPath, negotiateLocale, stripLocale } from './runtime'

/** What the routing helpers need from the module options. */
export interface I18nRouting {
	readonly locales: readonly string[]
	readonly defaultLocale: string
	/** Route ID patterns that are not localized; `*` matches any run of characters. */
	readonly exclude: readonly string[]
	/** For a partially translated locale, the only route ID patterns that have a version in it. */
	readonly partial?: Readonly<Record<string, readonly string[]>>
}

/** Route ID of the page that a localized route reuses: `/en/guide` gives `/guide`. */
export function baseRouteId(id: string, locales: readonly string[]): string {
	return stripLocale(id, locales)
}

function matches(id: string, patterns: readonly string[]): boolean {
	return patterns.some((pattern) =>
		new RegExp(
			`^${pattern
				.split('*')
				.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
				.join('.*')}$`,
		).test(id),
	)
}

/**
 * Whether a route of the discovered manifest gets a version for each locale: it does not start
 * with a locale or a `[locale]` parameter and no `exclude` pattern names it.
 */
export function localizable(id: string, routing: I18nRouting): boolean {
	const first = id.split('/')[1] ?? ''
	return !routing.locales.includes(first) && first !== '[locale]' && !matches(id, routing.exclude)
}

/** Whether the localizable route `id` (without prefix) has a version in `locale`. */
export function hasLocaleVersion(id: string, locale: string, routing: I18nRouting): boolean {
	if (locale === routing.defaultLocale) return true
	const only = routing.partial?.[locale]
	return only === undefined || matches(id, only)
}

/** Whether `id` (with or without a locale prefix) belongs to a localized page. */
export function localizedRoute(id: string | null, routing: I18nRouting): boolean {
	if (id === null) return false
	const first = id.split('/')[1] ?? ''
	const base = routing.locales.includes(first) ? baseRouteId(id, routing.locales) : id
	return localizable(base, routing)
}

/** What a `<MeekoLink>` gives the link resolver of the plugin (`LinkResolveInput` of the core). */
export interface LocaleLink {
	readonly to: string
	readonly href: string
	readonly hreflang: string | undefined
}

/**
 * The href of a `<MeekoLink>` in a document of `locale`: `to="/guide"` gives `/en/guide` in
 * English and `/guide` in the default locale. `hreflang` picks another configured locale (exact or
 * by base language: `en-US` is `en`); an unknown one keeps the document's. The href stays as
 * `href()` built it when `to` already names a locale (`/en/guide`, `/[locale]/…`), when the route
 * is excluded, and when the target locale has no version of it (`partial`): the default version.
 * The prefix is added, never parsed out of the href, so a parameter equal to a locale is kept.
 */
export function localizeLink(link: LocaleLink, locale: string, routing: I18nRouting): string {
	const first = link.to.split('/')[1] ?? ''
	if (routing.locales.includes(first) || first === '[locale]' || !localizable(link.to, routing)) return link.href
	const target = link.hreflang === undefined ? locale : (negotiateLocale([link.hreflang], routing.locales) ?? locale)
	if (target === routing.defaultLocale || !hasLocaleVersion(link.to, target, routing)) return link.href
	const at = link.href.search(/[?#]/)
	const path = at < 0 ? link.href : link.href.slice(0, at)
	return `/${target}${path === '/' ? '' : path}${at < 0 ? '' : link.href.slice(at)}`
}

/** URL shape of a route ID, as the manifest compares them: parameter names do not count. */
function shape(id: string): string {
	return id.replace(/\[\.\.\.[^\]]+\]/g, '[...]').replace(/\[[^\].]+\]/g, '[]')
}

/**
 * The discovered routes plus, for each localizable route, one route per locale other than the
 * default with the same page file: `/guide` adds `/en/guide`. A page of the project at that URL
 * (such as `app/pages/en/legal.meeko`) wins over the generated route.
 */
export function localizeRoutes(routes: readonly RouteRecord[], routing: I18nRouting): RouteRecord[] {
	const shapes = new Set(routes.map((route) => shape(route.id)))
	const result = [...routes]
	for (const route of routes) {
		if (!localizable(route.id, routing)) continue
		for (const locale of routing.locales) {
			if (locale === routing.defaultLocale || !hasLocaleVersion(route.id, locale, routing)) continue
			const id = route.id === '/' ? `/${locale}` : `/${locale}${route.id}`
			if (shapes.has(shape(id))) continue
			shapes.add(shape(id))
			result.push({ ...route, id })
		}
	}
	return result
}

/**
 * Una versión de una URL en un idioma, o en `x-default`.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { LocaleAlternate } from "@meekojs/i18n";
 *
 * const english: LocaleAlternate = { hreflang: "en", pathname: "/en/guide" };
 * ```
 */
export interface LocaleAlternate {
	/** Idioma de la versión, o `x-default`. */
	readonly hreflang: string
	/** Ruta (`pathname`) de la versión. */
	readonly pathname: string
}

/**
 * Versiones de una URL en cada idioma, más `x-default` (la del idioma por defecto), en la forma que
 * pide `sitemapXml`. Sirve para un sitemap dinámico, sin `sitemap: true`, que quita páginas al
 * servirlo. Sin versiones en dos idiomas no declara ninguna.
 *
 * @param pathname Ruta de la URL, con o sin prefijo de idioma.
 * @param routing Idiomas configurados y el que no lleva prefijo.
 * @param available Si existe una versión, por su ruta y su idioma; por defecto, todas existen.
 * @returns Las versiones que existen y `x-default`, o una lista vacía.
 * @since 0.1.0
 * @example
 * ```ts
 * import { localeAlternates } from "@meekojs/i18n";
 *
 * localeAlternates("/en/guide", { locales: ["es", "en"], defaultLocale: "es" });
 * // [{ hreflang: "es", pathname: "/guide" }, { hreflang: "en", pathname: "/en/guide" }, { hreflang: "x-default", pathname: "/guide" }]
 * ```
 */
export function localeAlternates(pathname: string, routing: Pick<I18nRouting, 'defaultLocale' | 'locales'>, available?: (pathname: string, locale: string) => boolean): LocaleAlternate[] {
	const versions = routing.locales.map((locale) => ({ hreflang: locale, pathname: localizedPath(pathname, locale, routing.locales, routing.defaultLocale) }))
	const present = available ? versions.filter((version) => available(version.pathname, version.hreflang)) : versions
	if (present.length < 2) return []
	const fallback = present.find((version) => version.hreflang === routing.defaultLocale)
	return fallback ? [...present, { hreflang: 'x-default', pathname: fallback.pathname }] : present
}

/**
 * The versions the sitemap declares for a URL of the route `id`, by the same rules as the `<head>`:
 * none for a route that is not localized (`exclude`, or no route at all), even when a project has
 * pages at both URLs, and only the locales that have a version of it (`partial`) and an entry in
 * `pathnames`, the URLs of the sitemap.
 */
export function sitemapAlternates(pathname: string, id: string | null, pathnames: ReadonlySet<string>, routing: I18nRouting): LocaleAlternate[] {
	if (id === null || !localizedRoute(id, routing)) return []
	const base = baseRouteId(id, routing.locales)
	return localeAlternates(pathname, routing, (version, locale) => pathnames.has(version) && hasLocaleVersion(base, locale, routing))
}
