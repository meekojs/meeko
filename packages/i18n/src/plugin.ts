import { definePlugin } from '@meekojs/meeko/framework'
import { catalogs } from 'virtual:meeko-i18n'

import type { I18nDirection } from './context'
import type { Message } from './messages'
import type { I18nCookie } from './runtime'

import { i18nContext } from './context'
import { baseRouteId, hasLocaleVersion, localeAlternates, localizedRoute, localizeLink } from './routing'
import { createI18n, localeCookie, localeOf } from './runtime'

interface Options {
	readonly defaultLocale: string
	readonly locales: readonly string[]
	readonly directions: Readonly<Record<string, I18nDirection>>
	/** Namespaces loaded with `common` on every route, the error page included. */
	readonly global: readonly string[]
	/** Namespaces also loaded in every other locale, for `t(key, values, { locale })`. */
	readonly multilingual: readonly string[]
	/** The Open Graph locale of each locale; `false` emits no `og:locale`. */
	readonly ogLocales: Readonly<Record<string, string>> | false
	readonly routes: Readonly<Record<string, readonly string[]>>
	readonly exclude: readonly string[]
	readonly partial: Readonly<Record<string, readonly string[]>>
	readonly cookie: I18nCookie | false
	/** Public origin for absolute `hreflang` URLs; without it, the request's or the tab's. */
	readonly origin?: string
	readonly hreflang: boolean
	/** `meeko dev`: missing messages are reported in the browser too. */
	readonly dev: boolean
}

/** Missing messages already reported by this server process or tab. */
const reported = new Set<string>()

export default definePlugin<Options>(async (app, options) => {
	const locale = localeOf(app.route.path.value, options.locales, options.defaultLocale)
	const loaders = catalogs[locale]
	if (!loaders) throw new RangeError(`i18n: missing catalog ${locale}`)
	const catalog: Record<string, Message> = Object.create(null)
	const loaded = new Set<string>()
	const load = async (routeId: string | null): Promise<void> => {
		// A localized route (`/en/guide`) loads the namespaces of the page it reuses (`/guide`); the
		// error page (`routeId` null) still gets `common` and the global namespaces.
		const names = ['common', ...options.global, ...options.multilingual, ...(options.routes[routeId === null ? '' : baseRouteId(routeId, options.locales)] ?? [])]
		for (const name of names) {
			if (loaded.has(name)) continue
			const module = loaders[name]
			if (!module) throw new RangeError(`i18n: missing ${locale}/${name}`)
			Object.assign(catalog, (await module()).default)
			loaded.add(name)
		}
	}
	await load(app.route.id.value)
	// Text written in another language (a suggestion in the suggested one) is known before rendering,
	// so `t(key, values, { locale })` stays synchronous and SSR and hydration agree.
	const foreign: Record<string, Record<string, Message>> = Object.create(null)
	if (options.multilingual.length) {
		await Promise.all(
			options.locales
				.filter((target) => target !== locale)
				.map(async (target) => {
					const messages: Record<string, Message> = Object.create(null)
					const modules = await Promise.all(options.multilingual.map((name) => catalogs[target]![name]!()))
					for (const module of modules) Object.assign(messages, module.default)
					foreign[target] = messages
				}),
		)
	}
	// A message outside the loaded namespaces renders its key instead of throwing: a throw would take
	// down the whole document, including the error page that reports another failure. It is reported
	// once per locale and key on the server (logs, prerender) and, in `meeko dev`, also in the browser.
	const missing = (key: string, target: string): string => {
		if ((options.dev || app.side === 'server') && !reported.has(`${target}:${key}`)) {
			reported.add(`${target}:${key}`)
			console.warn(`[meeko:i18n] Missing message ${key} for ${target} on ${app.route.path.value}: add its namespace to ${target === locale ? 'i18n.global or i18n.routes' : 'i18n.multilingual'}`)
		}
		return key
	}
	const routing = { locales: options.locales, defaultLocale: options.defaultLocale, exclude: options.exclude, partial: options.partial }
	// `<MeekoLink to="/guide">` points to the version in the document's locale (`/en/guide`), or in
	// the one of its `hreflang`; the same in SSR, hydration and client navigation.
	app.resolveLink((link) => localizeLink(link, locale, routing))
	app.provide(
		i18nContext,
		createI18n({
			locale,
			catalog,
			foreign,
			locales: options.locales,
			defaultLocale: options.defaultLocale,
			directions: options.directions,
			cookie: options.cookie,
			missing,
			path: () => app.route.url.value,
			available: (target) => {
				const id = app.route.id.value
				return id !== null && localizedRoute(id, routing) && hasLocaleVersion(baseRouteId(id, options.locales), target, routing)
			},
			navigate: (path) => {
				if (app.side === 'client') window.location.assign(path)
			},
		}),
	)
	const origin = options.origin ?? (app.request ? new URL(app.request.url).origin : typeof location === 'undefined' ? undefined : location.origin)
	app.addHead(() => {
		const htmlAttrs = { lang: locale, dir: options.directions[locale] ?? 'ltr' }
		const id = app.route.id.value
		const localized = id !== null && localizedRoute(id, routing)
		const base = localized ? baseRouteId(id, options.locales) : undefined
		const has = (version: string): boolean => base !== undefined && hasLocaleVersion(base, version, routing)
		const link =
			options.hreflang && origin && localized
				? localeAlternates(app.route.path.value, routing, (_, version) => has(version)).map((alternate) => ({
						rel: 'alternate',
						hreflang: alternate.hreflang,
						href: new URL(alternate.pathname, origin).href,
						key: `i18n-alternate-${alternate.hreflang}`,
					}))
				: []
		const ogLocales = options.ogLocales
		// Without a `key`, the og:locale of a page or layout replaces this one; each alternate has its
		// own, because they repeat one property.
		const meta = ogLocales
			? [
					{ property: 'og:locale', content: ogLocales[locale]! },
					...options.locales.filter((version) => version !== locale && has(version)).map((version) => ({ property: 'og:locale:alternate', content: ogLocales[version]!, key: `i18n-og-alternate-${version}` })),
				]
			: []
		return { htmlAttrs, ...(link.length ? { link } : {}), ...(meta.length ? { meta } : {}) }
	})
	if (app.side === 'client')
		app.beforeNavigate(async (url, routeId) => {
			const target = localeOf(url.pathname, options.locales, options.defaultLocale)
			if (target !== locale) {
				// Following a link to another language is an explicit choice: remember it, then load that document.
				if (options.cookie) document.cookie = localeCookie(options.cookie, target, location.hostname)
				window.location.assign(url.href)
				return false
			}
			await load(routeId)
		})
})
