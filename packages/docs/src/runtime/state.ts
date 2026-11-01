import type { ContextKey, Signal } from '@meekojs/meeko'
import type { ModerationSite, SiteModeration } from 'meeko-docs-content/moderation/shared'

import { createContext, effect, inject, onMounted } from '@meekojs/meeko'
import { useRoute, useState } from '@meekojs/meeko/framework'
import { splitLocalePath } from 'meeko-docs-content/locale'
import { emptyModeration, fetchSiteModeration, isFeaturedPath, isHiddenPath, moderationEndpoint } from 'meeko-docs-content/moderation/shared'

export type { AnnouncementTone, ModerationSite, PublicAnnouncement, SiteModeration } from 'meeko-docs-content/moderation/shared'
export { announcementRole, dismissCookie, isFeaturedPath, isHiddenPath, moderationEndpoint } from 'meeko-docs-content/moderation/shared'

/** La moderación de la petición, que el plugin de servidor del módulo publica (opción `site`). */
export const docsModerationKey = createContext<SiteModeration>('meeko-docs moderation')

/** La web de la petición (opción `site`), que el plugin publica con la moderación para que el navegador sepa dónde pedirla. */
export const docsSiteKey = createContext<ModerationSite>('meeko-docs site')

/** Lo que publicó el plugin con `key` en esta petición; `fallback` en el navegador o en una web sin `site`. */
function provided<T>(key: ContextKey<T>, fallback: T): T {
	try {
		return inject(key)
	} catch {
		return fallback
	}
}

/** La última recarga de cada señal: una navegación se pide una vez aunque varios componentes la sigan, y sólo gana la respuesta más reciente. */
const refreshes = new WeakMap<object, { url: string; sequence: number }>()

/**
 * Vuelve a pedir la moderación a `endpoint()` después de cada navegación confirmada y escribe en
 * `target` lo que `pick` toma de ella. El estado de `useState` con clave fija no se renueva al
 * navegar (Meeko sólo añade las claves nuevas del payload), así que sin esto una sesión larga
 * conservaría las reglas y los avisos de la primera página. La hidratación usa el estado del
 * servidor, sin petición; un fallo o una respuesta inválida dejan lo que había. Llámese en el
 * `<script>` de un componente; en SSR no hace nada.
 *
 * @param target Señal que se actualiza (la de `useState`).
 * @param endpoint La ruta de la moderación de la web, o `null` si no hay ninguna.
 * @param pick La parte de la moderación que guarda `target`.
 * @example
 * ```ts
 * const announcements = useState('site:announcements', () => [])
 * refreshOnNavigation(announcements, () => moderationEndpoint('site'), (moderation) => moderation.announcements)
 * ```
 */
export function refreshOnNavigation<T>(target: Signal<T>, endpoint: () => string | null, pick: (moderation: SiteModeration) => T): void {
	const route = useRoute()
	const page = () => route.url.value.split('#')[0]!
	onMounted(() => {
		let last = page()
		return effect(() => {
			const current = page()
			if (current === last) return
			last = current
			const url = endpoint()
			if (url === null) return
			const previous = refreshes.get(target)
			if (previous?.url === current) return
			const sequence = (previous?.sequence ?? 0) + 1
			refreshes.set(target, { url: current, sequence })
			void fetchSiteModeration(url).then((moderation) => {
				if (moderation !== null && refreshes.get(target)?.sequence === sequence) target.value = pick(moderation)
			})
		})
	})
}

/**
 * Señal con la moderación de la web en el idioma de la página (`/en/…` es inglés): páginas ocultas
 * y destacadas desde el dashboard, y avisos vigentes que el lector no cerró. Las rutas ocultas y
 * destacadas de la moderación inglesa llevan el prefijo `/en`. En SSR la escribe el plugin de servidor y viaja en el estado,
 * así que el navegador hidrata la misma; después de cada navegación confirmada se pide otra vez al
 * servidor ({@link refreshOnNavigation}), así que una regla o un aviso nuevos llegan sin recargar.
 * Sin base de datos está vacía. Se llama en el `<script>` de un componente.
 *
 * @returns La señal compartida de la moderación.
 * @example
 * ```ts
 * import { isHiddenPath, useDocsModeration } from 'meeko-docs/state'
 *
 * const moderation = useDocsModeration()
 * const visible = computed(() => cards.filter((card) => !isHiddenPath(moderation.value, card.href)))
 * ```
 */
export function useDocsModeration() {
	const moderation = useState<SiteModeration>('meeko-docs:moderation', () => provided(docsModerationKey, emptyModeration))
	const site = useState<ModerationSite | null>('meeko-docs:site', () => provided<ModerationSite | null>(docsSiteKey as ContextKey<ModerationSite | null>, null))
	const route = useRoute()
	refreshOnNavigation(
		moderation,
		() => (site.value === null ? null : moderationEndpoint(site.value, splitLocalePath(route.path.value).locale)),
		(fresh) => fresh,
	)
	return moderation
}

/**
 * La navegación sin las páginas ocultas, con `featured` en las destacadas y sin los grupos que se
 * quedan vacíos.
 *
 * @param navigation Grupos de `app/utils/navigation.ts`.
 * @param moderation La moderación de {@link useDocsModeration}.
 * @returns La navegación moderada.
 * @example
 * ```ts
 * const groups = computed(() => moderateNavigation(props.navigation, moderation.value))
 * ```
 */
export function moderateNavigation<Item extends { readonly href: string }>(navigation: readonly { readonly title: string; readonly items: readonly Item[] }[], moderation: SiteModeration): { title: string; items: (Item & { featured: boolean })[] }[] {
	return navigation
		.map((group) => ({
			title: group.title,
			items: group.items.filter((item) => !isHiddenPath(moderation, item.href)).map((item) => ({ ...item, featured: isFeaturedPath(moderation, item.href) })),
		}))
		.filter((group) => group.items.length > 0)
}
