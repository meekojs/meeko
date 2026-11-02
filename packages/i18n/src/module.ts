import type { RouteRecord } from '@meekojs/meeko/framework'

import { defineMeekoModule, matchRoute } from '@meekojs/meeko/framework'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import type { Catalog } from './messages'
import type { I18nCookie } from './runtime'

import { compileCatalog, messageParameters, messageTags } from './messages'
import { localizeRoutes, sitemapAlternates } from './routing'

/** Opciones de `@meekojs/i18n`, en la clave `i18n` de `meeko.config.ts`. */
export interface I18nModuleOptions {
	/** Idioma de las URL sin prefijo. */
	readonly defaultLocale: string
	/**
	 * Catálogo JSON, o catálogos por namespace, de cada idioma. `common` y los namespaces de `global`
	 * se cargan en todas las rutas.
	 */
	readonly catalogs: Readonly<Record<string, string | Readonly<Record<string, string>>>>
	/**
	 * Namespaces que se cargan siempre junto a `common`: en todas las rutas, sus versiones `/en/…` y
	 * la página de error, en SSR, prerender, hidratación y navegación de cliente. Sirve para los
	 * textos de un Shell compartido (`["shell"]`). Cada nombre debe existir en todos los idiomas.
	 */
	readonly global?: readonly string[]
	/**
	 * Namespaces que se cargan en todos los idiomas en cada documento, para escribir un texto en otro
	 * idioma que el de la página con `t(key, values, { locale })`, como una sugerencia de idioma escrita
	 * en el idioma sugerido. Añaden un chunk por idioma a cada documento: que sean pequeños. También se
	 * cargan en todas las rutas. Cada nombre debe existir en todos los idiomas y no puede ser `common`.
	 */
	readonly multilingual?: readonly string[]
	/**
	 * Namespaces adicionales por ID exacto de ruta, sin prefijo de idioma (`"/docs/[...slug]"`); se
	 * cargan de forma perezosa al entrar en la ruta y también en sus versiones `/en/…`.
	 */
	readonly routes?: Readonly<Record<string, readonly string[]>>
	/** Idiomas `rtl`; los demás usan `ltr`. */
	readonly directions?: Readonly<Record<string, 'ltr' | 'rtl'>>
	/**
	 * Estrategia de URL. `"prefix_except_default"` (la única, por defecto): el idioma por defecto no
	 * lleva prefijo (`/guide`) y los demás sí (`/en/guide`). El módulo genera las rutas `/en/…` a
	 * partir de las páginas existentes, sin duplicar archivos.
	 */
	readonly strategy?: 'prefix_except_default'
	/**
	 * IDs de ruta que no se localizan (sin versiones `/en/…` ni `hreflang`); `*` cubre cualquier
	 * texto, como `"/admin/*"`.
	 */
	readonly exclude?: readonly string[]
	/**
	 * Idiomas con traducción parcial: para cada uno, los únicos IDs de ruta (con `*`) que tienen
	 * versión en él. Por ejemplo, `{ ar: ["/playground"] }` genera `/ar/playground` y nada más.
	 */
	readonly partial?: Readonly<Record<string, readonly string[]>>
	/**
	 * Cookie que recuerda el idioma elegido al cambiarlo; sólo se usa para sugerir, nunca para
	 * redirigir. Por defecto `{ name: "meeko-locale" }`; `false` la desactiva.
	 */
	readonly cookie?: I18nCookie | false
	/** Añade `<link rel="alternate" hreflang>` y `x-default` al `<head>`. Por defecto `true`. */
	readonly hreflang?: boolean
	/**
	 * Añade `og:locale` y un `og:locale:alternate` por cada otra versión de la página. Por defecto
	 * `true`, con la región más probable de cada idioma (`es` da `es_ES`, `en` da `en_US`); un objeto
	 * elige la de algunos idiomas (`{ es: "es_MX" }`) y `false` lo desactiva. Un `og:locale` de la
	 * página o del layout gana.
	 */
	readonly ogLocale?: boolean | Readonly<Record<string, string>>
	/** Añade las versiones de cada URL (`xhtml:link`) al `sitemap.xml` de Meeko. Por defecto `true`. */
	readonly sitemap?: boolean
}

declare module '@meekojs/meeko/framework' {
	interface MeekoConfig {
		/** Opciones de `@meekojs/i18n`, que se registra con `modules: ["@meekojs/i18n"]`. */
		readonly i18n?: I18nModuleOptions
	}
}

const manifestId = 'virtual:meeko-i18n'
const resolvedManifest = '\0meeko-i18n:manifest'
const catalogPrefix = '\0meeko-i18n:catalog:'

/** Open Graph writes a locale as `language_TERRITORY`: the likeliest region of `es` gives `es_ES`. */
function openGraphLocale(locale: string): string {
	const { language, region } = new Intl.Locale(locale).maximize()
	return region ? `${language}_${region}` : language
}

export default defineMeekoModule<I18nModuleOptions>({
	// `modules: ["@meekojs/i18n"]` resolves this `./module` subpath; the options live in `i18n: { … }`.
	meta: { name: '@meekojs/i18n', configKey: 'i18n', compatibility: { meeko: '>=1.8 <2' } },
	setup(options, meeko) {
		if (!options.catalogs || typeof options.catalogs !== 'object' || Array.isArray(options.catalogs)) throw new TypeError('i18n: catalogs must be an object')
		const locales = Object.keys(options.catalogs)
		if (!locales.length || !locales.includes(options.defaultLocale)) throw new TypeError('i18n: defaultLocale must name a catalog')
		if (locales.some((locale) => !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(locale))) throw new TypeError('i18n: invalid locale tag')
		for (const locale of locales) {
			try {
				Intl.getCanonicalLocales(locale)
			} catch {
				throw new TypeError(`i18n: invalid locale ${locale}`)
			}
		}
		if (options.directions && Object.keys(options.directions).some((locale) => !locales.includes(locale))) throw new TypeError('i18n: direction has no catalog')
		if (options.directions && Object.values(options.directions).some((direction) => direction !== 'ltr' && direction !== 'rtl')) throw new TypeError('i18n: direction must be ltr or rtl')
		if (options.strategy !== undefined && options.strategy !== 'prefix_except_default') throw new TypeError('i18n: strategy must be prefix_except_default')
		const exclude = options.exclude ?? []
		if (!Array.isArray(exclude) || exclude.some((pattern) => typeof pattern !== 'string' || !pattern.startsWith('/'))) throw new TypeError('i18n: exclude must list route IDs that start with /')
		const partial = options.partial ?? {}
		for (const [locale, patterns] of Object.entries(partial)) {
			if (locale === options.defaultLocale || !locales.includes(locale) || !Array.isArray(patterns) || patterns.some((pattern) => typeof pattern !== 'string' || !pattern.startsWith('/'))) {
				throw new TypeError(`i18n: partial.${locale} must list route IDs of a locale other than the default`)
			}
		}
		const cookie = options.cookie === false ? false : { name: 'meeko-locale', ...options.cookie }
		if (cookie && (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookie.name) || (cookie.domain !== undefined && !/^[A-Za-z0-9.-]+$/.test(cookie.domain)) || (cookie.maxAge !== undefined && !(Number.isInteger(cookie.maxAge) && cookie.maxAge > 0)))) throw new TypeError('i18n: invalid cookie')
		if (typeof meeko.extendRoutes !== 'function') throw new TypeError('i18n: localized routes need Meeko 1.8 (meeko.extendRoutes)')
		const root = realpathSync(meeko.rootDir)
		const files = new Map<string, string>()
		const references = new Map<string, string[]>()
		const parameters = new Map<string, Readonly<Record<string, 'value' | 'number'>>>()
		const tags = new Map<string, readonly string[]>()
		let expectedNamespaces: string[] | undefined
		for (const [locale, input] of Object.entries(options.catalogs)) {
			const namespaces = typeof input === 'string' ? { common: input } : input
			if (!namespaces || typeof namespaces !== 'object' || Array.isArray(namespaces) || !namespaces.common) throw new TypeError(`i18n: ${locale} needs a common catalog`)
			const names = Object.keys(namespaces).sort()
			if (expectedNamespaces && (names.length !== expectedNamespaces.length || names.some((name, index) => name !== expectedNamespaces![index]))) throw new TypeError(`i18n: ${locale} has different namespaces`)
			expectedNamespaces ??= names
			for (const [namespace, path] of Object.entries(namespaces)) {
				if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(namespace) || typeof path !== 'string') throw new TypeError(`i18n: invalid namespace ${namespace}`)
				// The written path must stay in the project; a package linked in node_modules (pnpm) may
				// really live elsewhere, as a shared shell's catalogs (`node_modules/meeko-docs/locales/…`).
				const written = resolve(root, path)
				const inside = relative(root, written)
				if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new TypeError(`i18n: catalog ${locale}/${namespace} leaves the project`)
				const file = realpathSync(written)
				const linked = relative(root, file)
				if ((isAbsolute(linked) || linked === '..' || linked.startsWith(`..${sep}`)) && !inside.split(sep).includes('node_modules')) {
					throw new TypeError(`i18n: catalog ${locale}/${namespace} leaves the project`)
				}
				const catalog = compileCatalog(JSON.parse(readFileSync(file, 'utf8')) as unknown, file)
				const keys = Object.keys(catalog).sort()
				const reference = references.get(namespace)
				if (reference && (keys.length !== reference.length || keys.some((key, index) => key !== reference[index]))) throw new TypeError(`i18n: catalog ${locale}/${namespace} has different message keys`)
				references.set(namespace, keys)
				for (const key of keys) {
					const contract = messageParameters(catalog[key]!)
					const identity = `${namespace}:${key}`
					const previous = parameters.get(identity)
					if (previous && JSON.stringify(previous) !== JSON.stringify(contract)) throw new TypeError(`i18n: catalog ${locale}/${namespace} message ${key} has different parameters`)
					parameters.set(identity, contract)
					// Each language writes the sentence in its own order, with the same tags for the same snippets.
					const written = messageTags(catalog[key]!)
					const previousTags = tags.get(identity)
					if (previousTags && previousTags.join() !== written.join()) throw new TypeError(`i18n: catalog ${locale}/${namespace} message ${key} has different tags`)
					tags.set(identity, written)
				}
				files.set(`${locale}:${namespace}`, file)
			}
		}
		const global = options.global ?? []
		if (!Array.isArray(global)) throw new TypeError('i18n: global must list namespaces')
		for (const [index, name] of global.entries()) {
			if (typeof name !== 'string' || name === 'common' || !expectedNamespaces?.includes(name) || global.indexOf(name) !== index) {
				throw new TypeError(`i18n: global namespace ${String(name)} must be a namespace of every catalog, other than common and listed once`)
			}
		}
		const multilingual = options.multilingual ?? []
		if (!Array.isArray(multilingual)) throw new TypeError('i18n: multilingual must list namespaces')
		for (const [index, name] of multilingual.entries()) {
			if (typeof name !== 'string' || name === 'common' || !expectedNamespaces?.includes(name) || multilingual.indexOf(name) !== index) {
				throw new TypeError(`i18n: multilingual namespace ${String(name)} must be a namespace of every catalog, other than common and listed once`)
			}
		}
		const ogOption = options.ogLocale ?? true
		if (typeof ogOption === 'object') {
			for (const [locale, value] of Object.entries(ogOption)) {
				if (!locales.includes(locale) || typeof value !== 'string' || !/^[a-z]{2,3}(?:_[A-Za-z0-9]{2,8})*$/.test(value)) throw new TypeError(`i18n: ogLocale.${locale} must be a catalog's locale with a value like es_ES`)
			}
		} else if (typeof ogOption !== 'boolean') throw new TypeError('i18n: ogLocale must be a boolean or an object')
		const ogLocales = ogOption === false ? (false as const) : Object.fromEntries(locales.map((locale) => [locale, (ogOption === true ? undefined : ogOption[locale]) ?? openGraphLocale(locale)]))
		for (const [route, names] of Object.entries(options.routes ?? {})) {
			if (!route.startsWith('/') || !Array.isArray(names) || names.some((name) => !expectedNamespaces?.includes(name))) throw new TypeError(`i18n: invalid namespaces for route ${route}`)
		}
		const allKeys = new Set<string>()
		for (const [namespace, keys] of references)
			for (const key of keys) {
				if (allKeys.has(key)) throw new TypeError(`i18n: duplicate message key ${key} in ${namespace}`)
				allKeys.add(key)
			}
		const signatures = [...references]
			.flatMap(([namespace, keys]) =>
				keys.map((key) => {
					const fields = Object.entries(parameters.get(`${namespace}:${key}`)!)
						.map(([name, kind]) => `readonly ${JSON.stringify(name)}: ${kind === 'number' ? 'number' : 'import("@meekojs/i18n").I18nValue'}`)
						.join('; ')
					return [key, `    ${JSON.stringify(key)}: { ${fields} };`] as const
				}),
			)
			.sort(([a], [b]) => a.localeCompare(b))
		const tagSignatures = [...references]
			.flatMap(([namespace, keys]) =>
				keys.flatMap((key) => {
					const names = tags.get(`${namespace}:${key}`)!
					return names.length ? [[key, `    ${JSON.stringify(key)}: ${names.map((name) => JSON.stringify(name)).join(' | ')};`] as const] : []
				}),
			)
			.sort(([a], [b]) => a.localeCompare(b))
		const types = `// Generated by @meekojs/i18n. Do not edit.\nexport {};\ndeclare module "@meekojs/i18n" {\n  interface GeneratedI18nMessages {\n${signatures.map(([, declaration]) => declaration).join('\n')}\n  }\n  interface GeneratedI18nTags {\n${tagSignatures.map(([, declaration]) => declaration).join('\n')}\n  }\n  interface GeneratedI18nLocales {\n${locales.map((locale) => `    ${JSON.stringify(locale)}: true;`).join('\n')}\n  }\n}\n`
		meeko.addTypeTemplate('messages.d.ts', types)
		meeko.addVitePlugin({
			name: 'meeko:i18n',
			resolveId(id: string) {
				if (id === manifestId) return resolvedManifest
				return id.startsWith(catalogPrefix) ? id : undefined
			},
			load(this: { addWatchFile(file: string): void }, id: string) {
				if (id === resolvedManifest) {
					const entries = locales.map((locale) => `${JSON.stringify(locale)}: {${expectedNamespaces!.map((namespace) => `${JSON.stringify(namespace)}: () => import(${JSON.stringify(`${catalogPrefix}${locale}:${namespace}`)})`).join(',')}}`)
					return `export const catalogs = {${entries.join(',')}};\nexport const settings = ${JSON.stringify({ locales, defaultLocale: options.defaultLocale, directions: options.directions ?? {} })};`
				}
				if (!id.startsWith(catalogPrefix)) return undefined
				const key = id.slice(catalogPrefix.length)
				const file = files.get(key)
				if (!file) throw new TypeError(`i18n: unknown catalog ${key}`)
				this.addWatchFile(file)
				const catalog: Catalog = compileCatalog(JSON.parse(readFileSync(file, 'utf8')) as unknown, file)
				return `export default ${JSON.stringify(catalog)};`
			},
		})
		const routing = { locales, defaultLocale: options.defaultLocale, exclude, partial }
		// `/en/guide` reuses the page of `/guide`: same file, layouts and options, one route per locale.
		meeko.extendRoutes((routes) => localizeRoutes(routes, routing))
		if (options.sitemap !== false) {
			// The final manifest, with the routes of every module: a URL is judged by the route that serves it.
			let manifest: readonly RouteRecord[] = []
			meeko.hooks.hook('routes:resolved', ({ routes }) => {
				manifest = routes
			})
			meeko.hooks.hook('sitemap:resolved', ({ urls }) => {
				const pathnames = new Set(urls.map((url) => url.pathname))
				for (const [index, url] of urls.entries()) {
					const alternates = sitemapAlternates(url.pathname, matchRoute(manifest, url.pathname)?.route.id ?? null, pathnames, routing)
					if (alternates.length) urls[index] = { ...url, alternates }
				}
			})
		}
		const origin = meeko.config.site ?? process.env.MEEKO_PUBLIC_ORIGIN
		meeko.addPlugin({
			src: new URL('./plugin.js', import.meta.url),
			options: {
				defaultLocale: options.defaultLocale,
				locales,
				directions: options.directions ?? {},
				global,
				multilingual,
				routes: options.routes ?? {},
				exclude,
				partial,
				cookie,
				ogLocales,
				hreflang: options.hreflang !== false,
				dev: meeko.dev === true,
				...(origin ? { origin: new URL(origin).origin } : {}),
			},
		})
		meeko.addComponentsDir(new URL('./app/components', import.meta.url), { exclude: ['internal/**'] })
		meeko.addAutoImports([
			{ name: 'useI18n', from: '@meekojs/i18n', scope: 'app', componentOnly: true },
			{ name: 'usePageI18n', from: '@meekojs/i18n/server', scope: 'server' },
		])
	},
})
