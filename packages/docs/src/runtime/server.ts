import type { ModerationSite } from 'meeko-docs-content/moderation'

import { isHiddenPath, readSiteModeration } from 'meeko-docs-content/moderation'

/**
 * Si el dashboard oculta la página de `path` en `site`, también a través de los `aliases` de la
 * navegación (`/en/playground` es `/playground`). El middleware de ruta de servidor de cada web
 * responde entonces con `notFound()`. Sin base de datos, nunca oculta nada.
 *
 * @param site La web: `ui` o `i18n`.
 * @param path `url.pathname` de la petición.
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
	const moderation = await readSiteModeration(site)
	if (!moderation.hidden.length) return false
	const aliases = new Map<string, string>()
	for (const group of navigation) for (const item of group.items) for (const alias of item.aliases ?? []) aliases.set(alias, item.href)
	return isHiddenPath(moderation, path, aliases)
}
