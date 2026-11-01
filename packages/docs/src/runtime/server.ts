import type { ModerationSite } from 'meeko-docs-content/moderation'

import { localizedPath, splitLocalePath } from 'meeko-docs-content/locale'
import { isHiddenPath, readSiteModeration } from 'meeko-docs-content/moderation'
import { routePath } from 'meeko-docs-content/moderation/shared'

/**
 * Si el dashboard oculta la página de `path` en `site`, también a través de los `aliases` de la
 * navegación (`/ar/playground` es `/playground`). El idioma sale de la ruta: `/en/…` aplica la
 * moderación inglesa (sus reglas y las globales), cuyas rutas ocultas llevan el prefijo `/en`. El middleware de ruta de servidor de cada web
 * responde entonces con `notFound()`. Sin base de datos, nunca oculta nada.
 *
 * @param site La web: `ui` o `i18n`.
 * @param path `url.pathname` de la petición, con su prefijo de idioma.
 * @param navigation Grupos de `app/utils/navigation.ts`, por sus alias.
 * @returns `true` si la página está oculta.
 * @example
 * ```ts
 * // app/middleware/moderation.server.ts
 * import { notFound } from '@meekojs/meeko/framework'
 * import { isModeratedOut } from 'meeko-docs/moderation'
 *
 * export default defineServerRouteMiddleware(async ({ url }) => {
 * 	if (await isModeratedOut('ui', url.pathname, navigation)) notFound()
 * })
 * ```
 */
export async function isModeratedOut(site: ModerationSite, path: string, navigation: readonly { readonly items: readonly { readonly href: string; readonly aliases?: readonly string[] }[] }[] = []): Promise<boolean> {
	// The language of the page as the router reads it: `/%65n/x` and `/en//x` are English too.
	const { locale } = splitLocalePath(routePath(path) ?? path)
	const moderation = await readSiteModeration(site, { locale })
	if (!moderation.hidden.length) return false
	const aliases = new Map<string, string>()
	for (const group of navigation) for (const item of group.items) for (const alias of item.aliases ?? []) aliases.set(localizedPath(alias, locale), localizedPath(item.href, locale))
	return isHiddenPath(moderation, path, aliases)
}
