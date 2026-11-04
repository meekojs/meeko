import type { ContextKey } from '../core/reactivity'

import { findContext } from '../core/reactivity'

/**
 * Enlace que recibe un {@link LinkResolver}: la ruta de `to`, el `href` que construyó `href()` (o
 * el resolvedor anterior) y el `hreflang` del `<a>`, si lo tiene.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { LinkResolveInput } from "@meekojs/meeko/framework";
 *
 * const link: LinkResolveInput = { to: "/users/[id]", href: "/users/7?tab=perfil", hreflang: undefined };
 * ```
 */
export interface LinkResolveInput {
	/** ID de la ruta de `to`, sin sustituir los parámetros: `"/users/[id]"`. */
	readonly to: string
	/** `href` del enlace, con parámetros, búsqueda y fragmento: `"/users/7?tab=perfil"`. */
	readonly href: string
	/** Atributo `hreflang` del enlace (escrito, con `bind:hreflang` o en `bind`); `undefined` sin él. */
	readonly hreflang: string | undefined
}

/**
 * Resolvedor de enlaces que un plugin registra con `app.resolveLink`: recibe cada enlace de
 * `<MeekoLink>` y devuelve su `href` final, por ejemplo con un prefijo de idioma. Se ejecuta al
 * renderizar el enlace en el servidor, en la hidratación y en la navegación del cliente, así que
 * debe ser puro: el mismo enlace da el mismo `href` en los dos lados. El estado activo
 * (`aria-current`) se calcula con el `href` resuelto. `<MeekoLink bind:resolve="false">` lo omite.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import { definePlugin } from "@meekojs/meeko/framework";
 * import type { LinkResolver } from "@meekojs/meeko/framework";
 *
 * const withBase: LinkResolver = ({ href }) => `/docs${href}`;
 * export default definePlugin((app) => app.resolveLink(withBase));
 * ```
 */
export type LinkResolver = (link: LinkResolveInput) => string

/** Where the plugins publish their composed resolver; `Symbol.for` so two copies of Meeko agree. */
export const linkResolverKey = Symbol.for('meeko.link-resolver') as ContextKey<LinkResolver>

/**
 * @internal The resolver of the links of a component, read once in its setup: the one the plugins
 * published, or `undefined` outside an application or without resolvers.
 */
export function linkResolver(): LinkResolver | undefined {
	return findContext(linkResolverKey)
}

/**
 * @internal The `href` of a `<MeekoLink>`: what `href()` built, passed through the application's
 * resolver unless the link opts out with `bind:resolve="false"`. An empty `hreflang` is no hreflang.
 */
export function linkHref(resolver: LinkResolver | undefined, to: string, href: string, hreflang?: string | null, resolve?: boolean | null): string {
	if (!resolver || resolve === false) return href
	return resolver({ to, href, hreflang: typeof hreflang === 'string' && hreflang !== '' ? hreflang : undefined })
}

/** @internal The `hreflang` key of a `bind` spread on a `<MeekoLink>`, for its resolver. */
export function linkHreflang(spread: unknown): string | undefined {
	if (typeof spread !== 'object' || spread === null) return undefined
	const value = (spread as { readonly hreflang?: unknown }).hreflang
	return typeof value === 'string' && value !== '' ? value : undefined
}

/** A path with each segment in the encoding of `href()`, whether it arrives encoded or not. */
function encodedPath(path: string): string {
	return path
		.split('/')
		.map((segment) => {
			try {
				return encodeURIComponent(decodeURIComponent(segment))
			} catch {
				return segment
			}
		})
		.join('/')
}

/**
 * Whether `href` is the committed `path`: `"page"` when its path, without the query string or the
 * fragment, is that path; with `prefix`, `"true"` when the path is below it by whole segments
 * (`/dashboard` covers `/dashboard/stats`, not `/dashboards`). `/` only matches itself, or it would
 * cover every page. Both paths are compared in the encoding of `href()`, so `/categorías` and
 * `/categor%C3%ADas` are the same route.
 */
export function routeCurrent(path: string, href: string, prefix: boolean): 'page' | 'true' | false {
	const target = encodedPath(href.split(/[?#]/, 1)[0]!)
	const current = encodedPath(path)
	if (target === current) return 'page'
	if (!prefix) return false
	const base = target.replace(/\/+$/, '')
	return base !== '' && current.startsWith(`${base}/`) ? 'true' : false
}

/**
 * @internal The `aria-current` key of a `bind` spread on a `<MeekoLink>`, whatever its case, as the
 * spread writes attributes: the link's only binding of this attribute reads it through {@link linkCurrent}.
 */
export function linkSpreadCurrent(spread: unknown): unknown {
	if (typeof spread !== 'object' || spread === null) return undefined
	const key = Object.keys(spread).find((candidate) => candidate.toLowerCase() === 'aria-current')
	return key === undefined ? undefined : (spread as Record<string, unknown>)[key]
}

/**
 * @internal `aria-current` of a `<MeekoLink>`: a value of its own (`explicit`) wins, and `false`
 * writes no attribute. With `null` or `undefined`, the route decides: `"page"` when the path of its
 * href is the path of the committed route and, with `match="prefix"`, `"true"` when the route is
 * below it (see {@link routeCurrent}); no attribute otherwise.
 */
export function linkCurrent(route: { readonly path: { readonly value: string } }, href: string, match?: 'exact' | 'prefix', explicit?: unknown): unknown {
	return explicit ?? (routeCurrent(route.path.value, href, match === 'prefix') || undefined)
}
