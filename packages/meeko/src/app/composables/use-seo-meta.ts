import type { HeadSource, SeoMetaInput } from '../../shared/head'

import { seoMetaHead } from '../../shared/head'
import { reader } from '../runtime/head'
import { useHead } from './use-head'

/**
 * Atajo tipado de {@link useHead} para SEO: cada campo produce la etiqueta correcta, `name` en
 * `description`, `robots`, `theme-color` y las de Twitter, `property` en las de Open Graph, y
 * `<link rel="canonical">` en `canonical`. Acepta un getter o una señal, igual que `useHead`, y se
 * puede llamar en los mismos sitios.
 *
 * @param input Campos de SEO, o un getter o una señal que los devuelven.
 * @since 1.2.0
 * @example
 * ```html
 * <script lang="ts">
 * const props = defineProps<{ data: { title: string; summary: string; cover: string } }>();
 * useSeoMeta(() => ({
 *   title: props.data.title,
 *   description: props.data.summary,
 *   ogTitle: props.data.title,
 *   ogImage: props.data.cover,
 *   twitterCard: "summary_large_image",
 * }));
 * </script>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#head-del-documento-document-usehead-y-useseometa
 */
export function useSeoMeta(input: HeadSource<SeoMetaInput>): void {
	const read = reader(input)
	useHead(() => seoMetaHead(read()))
}
