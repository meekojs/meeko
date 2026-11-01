import type { DocsLocale } from 'meeko-docs-content/locale'
import type { MetricsSite } from 'meeko-docs-content/metrics'

import { localizedPath } from 'meeko-docs-content/locale'
import { metricPath } from 'meeko-docs-content/metrics'

import { isModeratedOut } from '../runtime/server'

export { feedbackHandler, feedbackInput, feedbackSaved, metricsRateLimits, searchHandler, searchInput, viewHandler, viewInput } from 'meeko-docs-content/metrics'

/** Grupos de `app/utils/navigation.ts`, con sus alias. */
type Navigation = readonly { readonly items: readonly { readonly href: string; readonly aliases?: readonly string[] }[] }[]

/**
 * Las páginas que cuentan las métricas de una web `.meeko`: las de su navegación y sus alias (que
 * cuentan como su página), salvo las que oculta el dashboard. Lo usan los endpoints de
 * `server/api/docs/*.post.ts` para no guardar rutas inventadas. Rutas, alias y destinos se comparan
 * como los lee el router (`metricPath`): `/%62uttons` o `//buttons` cuentan como su página, y se
 * guarda siempre la ruta canónica de la página. Con `localized: true` en los handlers, `/en/buttons`
 * llega como `/buttons` en inglés y se comprueba con la moderación inglesa.
 *
 * @param site La web: `ui` o `i18n`.
 * @param navigation Grupos de `app/utils/navigation.ts`.
 * @returns La función `knownPath` de los handlers, que recibe la ruta ya canónica, sin prefijo, y su idioma: la ruta de la página (también la de un alias) o `false`.
 * @example
 * ```ts
 * // server/api/docs/views.post.ts
 * export default defineApiRoute({ body: viewInput, status: 204, rateLimit: metricsRateLimits.view, handler: viewHandler({ site: 'ui', localized: true, knownPath: navigationPaths('ui', navigation) }) })
 * ```
 */
export function navigationPaths(site: Exclude<MetricsSite, 'site'>, navigation: Navigation): (path: string, locale?: DocsLocale) => Promise<boolean | string> {
	const pages = new Map<string, string>()
	const add = (href: string, page: string | null) => {
		const key = metricPath(href)
		if (key !== null && page !== null) pages.set(key, page)
	}
	for (const group of navigation) {
		for (const item of group.items) {
			const page = metricPath(item.href)
			add(item.href, page)
			for (const alias of item.aliases ?? []) add(alias, page)
		}
	}
	// Los handlers ya pasan la ruta por metricPath; decodificarla otra vez leería `/a%2541` (la página
	// `/a%41`) como `/aA`.
	return async (path, locale = 'es') => {
		const page = pages.get(path)
		if (page === undefined || (await isModeratedOut(site, localizedPath(path, locale), navigation))) return false
		return page
	}
}
